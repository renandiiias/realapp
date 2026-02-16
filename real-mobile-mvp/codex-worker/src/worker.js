require("dotenv").config();

const QUEUE_API_BASE_URL = (process.env.QUEUE_API_BASE_URL || "http://localhost:3334").replace(/\/+$/, "");
const WORKER_API_KEY = process.env.WORKER_API_KEY;
const WORKER_ID = process.env.WORKER_ID || `codex-worker-${process.pid}`;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const CLAIM_LEASE_SECONDS = Number(process.env.CLAIM_LEASE_SECONDS || 120);

if (!WORKER_API_KEY) {
  throw new Error("WORKER_API_KEY é obrigatória.");
}

function log(level, message, meta = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, workerId: WORKER_ID, message, ...meta }));
}

async function api(path, init = {}) {
  const res = await fetch(`${QUEUE_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": WORKER_API_KEY,
      ...(init.headers || {}),
    },
  });
  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!res.ok) {
    throw new Error(`http_${res.status}:${data.error || raw || "unknown"}`);
  }
  return data;
}

function missingInfo(order) {
  const p = order.payload || {};
  if (order.type === "ads") {
    if (!p.objective) return "Qual é o objetivo da campanha?";
    if (!p.offer) return "Qual é a oferta?";
    if (!p.budget) return "Qual é o investimento?";
    if (!p.region) return "Qual é a região da campanha?";
    return null;
  }
  if (order.type === "site") {
    if (!p.objective) return "Qual é o objetivo do site?";
    if (!p.cta) return "Qual é o CTA principal?";
    return null;
  }
  if (order.type === "content") {
    if (!p.platforms) return "Quais plataformas devem ser usadas?";
    if (!p.frequency) return "Qual frequência de postagem?";
    return null;
  }
  return null;
}

async function heartbeat(lastError, claimed) {
  try {
    await api("/v1/ops/worker/heartbeat", {
      method: "POST",
      body: JSON.stringify({ workerId: WORKER_ID, lastError: lastError || undefined, claimed: Boolean(claimed) }),
    });
  } catch (error) {
    log("warn", "heartbeat_failed", { error: String(error) });
  }
}

async function processOrder(order) {
  const orderId = order.id;
  const needInfo = missingInfo(order);

  await api(`/v1/ops/orders/${orderId}/event`, {
    method: "POST",
    body: JSON.stringify({ message: "Iniciando execução do pedido.", statusSnapshot: "in_progress" }),
  });

  if (needInfo) {
    await api(`/v1/ops/orders/${orderId}/complete`, {
      method: "POST",
      body: JSON.stringify({ status: "needs_info", message: `Precisamos de mais dados: ${needInfo}` }),
    });
    return;
  }

  if (order.type === "ads") {
    await api(`/v1/ops/orders/${orderId}/deliverables`, {
      method: "POST",
      body: JSON.stringify({
        deliverables: [
          {
            type: "campaign_plan",
            status: "submitted",
            content: {
              objective: order.payload.objective,
              budget: order.payload.budget,
              notes: "Plano inicial com foco em teste rápido e otimização contínua.",
            },
            assetUrls: [],
          },
          {
            type: "audience_summary",
            status: "submitted",
            content: {
              region: order.payload.region,
              audience: order.payload.audience || "público amplo inicial",
            },
            assetUrls: [],
          },
          {
            type: "creative",
            status: "submitted",
            content: {
              concepts: ["Antes x Depois", "Oferta Direta", "Prova Social"],
            },
            assetUrls: [],
          },
          {
            type: "copy",
            status: "submitted",
            content: {
              variants: [
                "Direto ao ponto: oferta + prova + CTA.",
                "SEM FRESCURA: o problema, a solução e o próximo passo.",
              ],
            },
            assetUrls: [],
          },
        ],
      }),
    });

    await api(`/v1/ops/orders/${orderId}/complete`, {
      method: "POST",
      body: JSON.stringify({ status: "needs_approval", message: "Copy e criativo prontos para aprovação." }),
    });
    return;
  }

  if (order.type === "site") {
    await api(`/v1/ops/orders/${orderId}/deliverables`, {
      method: "POST",
      body: JSON.stringify({
        deliverables: [
          {
            type: "wireframe",
            status: "submitted",
            content: {
              sections: order.payload.sections || ["Hero", "Prova", "Oferta", "CTA"],
            },
            assetUrls: [],
          },
          {
            type: "copy",
            status: "submitted",
            content: {
              headline: order.payload.headline || "Título principal",
              cta: order.payload.cta,
            },
            assetUrls: [],
          },
          {
            type: "url_preview",
            status: "submitted",
            content: "https://preview.real.local/site",
            assetUrls: [],
          },
        ],
      }),
    });

    await api(`/v1/ops/orders/${orderId}/complete`, {
      method: "POST",
      body: JSON.stringify({ status: "needs_approval", message: "Copy da landing pronta para aprovação." }),
    });
    return;
  }

  await api(`/v1/ops/orders/${orderId}/deliverables`, {
    method: "POST",
    body: JSON.stringify({
      deliverables: [
        {
          type: "calendar",
          status: "submitted",
          content: [
            { day: "Seg", topic: "Dor" },
            { day: "Qua", topic: "Prova" },
            { day: "Sex", topic: "Oferta" },
          ],
          assetUrls: [],
        },
        {
          type: "posts",
          status: "submitted",
          content: [{ title: "Post 1" }, { title: "Post 2" }],
          assetUrls: [],
        },
        {
          type: "reels_script",
          status: "submitted",
          content: {
            hook: "Se você faz isso, está perdendo dinheiro.",
            beats: ["Problema", "Solução", "CTA"],
          },
          assetUrls: [],
        },
      ],
    }),
  });

  await api(`/v1/ops/orders/${orderId}/complete`, {
    method: "POST",
    body: JSON.stringify({ status: "done", message: "Plano de conteúdo finalizado." }),
  });
}

async function loop() {
  while (true) {
    let hadClaim = false;
    try {
      const claimed = await api("/v1/ops/orders/claim", {
        method: "POST",
        body: JSON.stringify({ workerId: WORKER_ID, leaseSeconds: CLAIM_LEASE_SECONDS }),
      });

      if (!claimed.order) {
        await heartbeat(null, false);
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
        continue;
      }

      hadClaim = true;
      const order = claimed.order;
      log("info", "order_claimed", { orderId: order.id, type: order.type, status: order.status, attempt: claimed.claim?.attempt });
      await heartbeat(null, true);
      await processOrder(order);
      log("info", "order_processed", { orderId: order.id });
    } catch (error) {
      log("error", "loop_error", { error: String(error) });
      await heartbeat(String(error), hadClaim);
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

log("info", "worker_started", { queueApi: QUEUE_API_BASE_URL, pollMs: POLL_INTERVAL_MS });
loop().catch((error) => {
  log("error", "worker_fatal", { error: String(error) });
  process.exit(1);
});
