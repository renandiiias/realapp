require("dotenv").config();

const QUEUE_API_BASE_URL = (process.env.QUEUE_API_BASE_URL || "http://localhost:3334").replace(/\/+$/, "");
const WORKER_API_KEY = process.env.WORKER_API_KEY;
const WORKER_ID = process.env.WORKER_ID || `codex-worker-${process.pid}`;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);
const CLAIM_LEASE_SECONDS = Number(process.env.CLAIM_LEASE_SECONDS || 120);
const VIDEO_EDITOR_API_BASE_URL = (process.env.VIDEO_EDITOR_API_BASE_URL || "").replace(/\/+$/, "");
const VIDEO_EDITOR_PUBLIC_BASE_URL = (process.env.VIDEO_EDITOR_PUBLIC_BASE_URL || VIDEO_EDITOR_API_BASE_URL).replace(/\/+$/, "");

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

async function videoApi(path, init = {}) {
  if (!VIDEO_EDITOR_API_BASE_URL) {
    throw new Error("video_editor_api_not_configured");
  }
  const res = await fetch(`${VIDEO_EDITOR_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
  const raw = await res.text();
  const data = raw ? JSON.parse(raw) : {};
  if (!res.ok) {
    throw new Error(`video_http_${res.status}:${data.detail || data.error || raw || "unknown"}`);
  }
  return data;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildVideoOutputUrl(outputPath) {
  if (!VIDEO_EDITOR_PUBLIC_BASE_URL || !outputPath) return null;
  const name = String(outputPath).split(/[\\/]/).pop();
  if (!name) return null;
  return `${VIDEO_EDITOR_PUBLIC_BASE_URL}/media/storage/output/${encodeURIComponent(name)}`;
}

async function waitVideoJob(jobId, timeoutMs = 5 * 60 * 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = await videoApi(`/jobs/${jobId}`, { method: "GET" });
    if (job.status === "succeeded") return job;
    if (job.status === "failed") throw new Error(`video_job_failed:${job.error || "unknown"}`);
    await sleep(1500);
  }
  throw new Error("video_job_timeout");
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
  if (order.type === "video_editor") {
    if (!VIDEO_EDITOR_API_BASE_URL) return "Backend de vídeo não configurado no worker.";
    if (!p.backendInputPath) return "Faltou o arquivo enviado (backendInputPath).";
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

async function processVideoEditorOrder(order) {
  const orderId = order.id;
  const inputPath = String(order.payload.backendInputPath || "");
  const inputDuration = Number(order.payload.durationSeconds || 15);
  const clipEnd = Math.max(1, Math.min(15, Number.isFinite(inputDuration) ? inputDuration : 15));

  const autoEdit = await videoApi("/jobs/auto-edit", {
    method: "POST",
    body: JSON.stringify({
      input_path: inputPath,
      max_duration_seconds: clipEnd,
      remove_silence: true,
      silence_noise_db: -35,
      silence_min_duration: 0.35,
      padding_before: 0.08,
      padding_after: 0.12,
      min_segment_duration: 0.2,
      output_name: `auto_${orderId}.mp4`,
    }),
  });
  const autoResult = await waitVideoJob(autoEdit.job_id);
  const editedOutput = autoResult?.result?.output_path;
  if (!editedOutput) throw new Error("video_auto_edit_missing_output");

  let renderInputPath = editedOutput;
  let subtitles = { enabled: true, status: "skipped" };
  const autoCaptions = order?.payload?.autoCaptions !== false;

  if (autoCaptions) {
    try {
      await api(`/v1/ops/orders/${orderId}/event`, {
        method: "POST",
        body: JSON.stringify({
          message: "Gerando legendas automáticas.",
          statusSnapshot: "in_progress",
        }),
      });

      const subtitleGenerate = await videoApi("/jobs/subtitles/generate", {
        method: "POST",
        body: JSON.stringify({
          input_path: editedOutput,
          language: "pt",
          max_chars_per_line: 36,
          output_name: `subs_${orderId}.srt`,
        }),
      });
      const subtitleResult = await waitVideoJob(subtitleGenerate.job_id, 8 * 60 * 1000);
      const subtitlesPath = subtitleResult?.result?.output_path;
      if (!subtitlesPath) throw new Error("video_subtitles_missing_output");

      const subtitleBurn = await videoApi("/jobs/subtitles/burn", {
        method: "POST",
        body: JSON.stringify({
          input_path: editedOutput,
          subtitles_path: subtitlesPath,
          style: {
            font_name: "Arial",
            font_size: 52,
            primary_color: "&H00FFFFFF",
            outline_color: "&H00000000",
            outline: 3,
            shadow: 1,
            alignment: 2,
            margin_v: 88,
          },
          output_name: `captioned_${orderId}.mp4`,
        }),
      });
      const burnResult = await waitVideoJob(subtitleBurn.job_id, 8 * 60 * 1000);
      const captionedOutput = burnResult?.result?.output_path;
      if (!captionedOutput) throw new Error("video_subtitles_burn_missing_output");

      renderInputPath = captionedOutput;
      subtitles = {
        enabled: true,
        status: "applied",
        subtitlesPath,
        captionedOutput,
      };
    } catch (error) {
      subtitles = {
        enabled: true,
        status: "failed",
        error: String(error),
      };
      await api(`/v1/ops/orders/${orderId}/event`, {
        method: "POST",
        body: JSON.stringify({
          message: "Falha ao aplicar legendas. Entregando vídeo sem legenda nesta execução.",
          statusSnapshot: "in_progress",
        }),
      });
    }
  } else {
    subtitles = { enabled: false, status: "disabled" };
  }

  const delivered = await videoApi("/jobs/deliver", {
    method: "POST",
    body: JSON.stringify({
      input_path: renderInputPath,
      preset: "social",
      width: 1080,
      height: 1920,
      output_name: `final_${orderId}.mp4`,
    }),
  });
  const deliveredResult = await waitVideoJob(delivered.job_id);
  const finalOutput = deliveredResult?.result?.output_path;
  if (!finalOutput) throw new Error("video_deliver_missing_output");

  const outputUrl = buildVideoOutputUrl(finalOutput);

  await api(`/v1/ops/orders/${orderId}/deliverables`, {
    method: "POST",
    body: JSON.stringify({
      deliverables: [
        {
          type: "url_preview",
          status: "submitted",
          content: {
            kind: "video",
            outputPath: finalOutput,
            outputUrl,
            stylePrompt: order.payload.stylePrompt || "",
            clipDurationSeconds: clipEnd,
            subtitles,
          },
          assetUrls: outputUrl ? [outputUrl] : [],
        },
      ],
    }),
  });

  await api(`/v1/ops/orders/${orderId}/complete`, {
    method: "POST",
    body: JSON.stringify({
      status: "done",
      message: outputUrl
        ? subtitles.status === "applied"
          ? "Vídeo final com legendas pronto para download."
          : "Vídeo final pronto para download."
        : "Vídeo final pronto no servidor (sem URL pública configurada).",
    }),
  });
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

  if (order.type === "video_editor") {
    await processVideoEditorOrder(order);
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
        await sleep(POLL_INTERVAL_MS);
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
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

log("info", "worker_started", {
  queueApi: QUEUE_API_BASE_URL,
  pollMs: POLL_INTERVAL_MS,
  videoApi: VIDEO_EDITOR_API_BASE_URL || null,
});
loop().catch((error) => {
  log("error", "worker_fatal", { error: String(error) });
  process.exit(1);
});
