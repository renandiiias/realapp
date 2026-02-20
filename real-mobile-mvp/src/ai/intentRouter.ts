export type RouteTarget =
  | "home"
  | "services"
  | "ads"
  | "site"
  | "video_editor"
  | "content"
  | "orders"
  | "approvals"
  | "account";

export type IntentResult = {
  target: RouteTarget;
  message: string;
};

const OPENROUTER_BASE_URL = process.env.EXPO_PUBLIC_OPENROUTER_BASE_URL?.replace(/\/+$/, "") || "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.EXPO_PUBLIC_OPENROUTER_MODEL || "qwen/qwen2.5-vl-72b-instruct:free";

const ZAI_BASE_URL = process.env.EXPO_PUBLIC_ZAI_BASE_URL?.replace(/\/+$/, "") || "https://api.z.ai/api/paas/v4";
const ZAI_API_KEY = process.env.EXPO_PUBLIC_ZAI_API_KEY;
const ZAI_MODEL = process.env.EXPO_PUBLIC_ZAI_MODEL || "glm-4.5-air";

function heuristic(prompt: string): IntentResult {
  const t = prompt.toLowerCase();
  if (t.includes("aprovar") || t.includes("aprovação") || t.includes("ajuste de criativo")) {
    return { target: "approvals", message: "Te levando para aprovações." };
  }
  if (t.includes("status") || t.includes("andamento") || t.includes("acompanhar") || t.includes("fila")) {
    return { target: "orders", message: "Te levando para acompanhar." };
  }
  if (t.includes("perfil") || t.includes("conta") || t.includes("cupom") || t.includes("plano")) {
    return { target: "account", message: "Te levando para conta." };
  }
  if (t.includes("site") || t.includes("landing")) {
    return { target: "site", message: "Te levando para criar site." };
  }
  if (t.includes("video") || t.includes("vídeo") || t.includes("reel") || t.includes("edição")) {
    return { target: "video_editor", message: "Te levando para editor de vídeo." };
  }
  if (t.includes("conteúdo") || t.includes("conteudo") || t.includes("reels") || t.includes("post")) {
    return { target: "content", message: "Conteúdo entra em breve. Te mostro a área." };
  }
  if (t.includes("serviço") || t.includes("servico") || t.includes("opções")) {
    return { target: "services", message: "Te levando para serviços." };
  }
  if (t.includes("anúncio") || t.includes("anuncio") || t.includes("tráfego") || t.includes("trafego") || t.includes("lead")) {
    return { target: "ads", message: "Te levando para tráfego." };
  }
  return { target: "ads", message: "Te levando para montar seu pedido." };
}

function parseResult(raw: string): IntentResult | null {
  try {
    const parsed = JSON.parse(raw) as Partial<IntentResult>;
    if (!parsed.target || !parsed.message) return null;
    const allowed: RouteTarget[] = ["home", "services", "ads", "site", "video_editor", "content", "orders", "approvals", "account"];
    if (!allowed.includes(parsed.target)) return null;
    return {
      target: parsed.target,
      message: String(parsed.message).split(/[.!?]/)[0]?.trim() + ".",
    };
  } catch {
    return null;
  }
}

async function callOpenRouter(prompt: string): Promise<IntentResult | null> {
  if (!OPENROUTER_API_KEY) return null;

  const res = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      temperature: 0.1,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            "Você é Z.ai da Real. Classifique o pedido para rota do app e responda em JSON puro: {\"target\":\"home|services|ads|site|video_editor|content|orders|approvals|account\",\"message\":\"frase curta\"}. Mensagem em português com no máximo uma frase.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  return parseResult(content);
}

async function callZai(prompt: string): Promise<IntentResult | null> {
  if (!ZAI_API_KEY) return null;

  const res = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ZAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: ZAI_MODEL,
      temperature: 0.1,
      max_tokens: 120,
      messages: [
        {
          role: "system",
          content:
            "Você é Z.ai da Real. Classifique o pedido para rota do app e responda em JSON puro: {\"target\":\"home|services|ads|site|video_editor|content|orders|approvals|account\",\"message\":\"frase curta\"}. Mensagem em português com no máximo uma frase.",
        },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!res.ok) return null;
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  return parseResult(content);
}

export async function routeWithIntent(prompt: string): Promise<IntentResult> {
  try {
    const byZai = await callZai(prompt);
    if (byZai) return byZai;

    const byOpenRouter = await callOpenRouter(prompt);
    if (byOpenRouter) return byOpenRouter;

    return heuristic(prompt);
  } catch {
    return heuristic(prompt);
  }
}

export function targetToPath(target: RouteTarget): string {
  switch (target) {
    case "home":
      return "/home";
    case "services":
      return "/create";
    case "ads":
      return "/create/ads";
    case "site":
      return "/create/site";
    case "video_editor":
      return "/create/video-editor";
    case "content":
      return "/create/content";
    case "orders":
      return "/orders";
    case "approvals":
      return "/approvals";
    case "account":
      return "/account";
    default:
      return "/home";
  }
}
