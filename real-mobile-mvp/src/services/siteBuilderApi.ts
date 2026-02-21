import AsyncStorage from "@react-native-async-storage/async-storage";

const AUTH_TOKEN_KEY = "real:auth:token";

export type SiteBuilderBlock = {
  id: string;
  label: string;
  title: string;
  body: string;
  buttonText?: string;
  enabled: boolean;
  origin: "default" | "custom";
};

export type SiteBuilderSpec = {
  businessName: string;
  segment: string;
  city: string;
  audience: string;
  offerSummary: string;
  mainDifferential: string;
  templateId: string;
  paletteId: string;
  headline: string;
  subheadline: string;
  ctaLabel: string;
  whatsappNumber: string;
  heroImageUrl: string;
  customHtml?: string;
  customCss?: string;
  customJs?: string;
  blocks: SiteBuilderBlock[];
};

export type SiteAutobuildRequest = {
  prompt: string;
  context?: Partial<Omit<SiteBuilderSpec, "blocks">>;
  currentBuilder?: SiteBuilderSpec;
  forceRegenerate?: boolean;
};

export type SiteAutobuildResponse = {
  builderSpec: SiteBuilderSpec;
  meta?: {
    engine?: string;
    vendorPresent?: boolean;
    generatedAt?: string;
  };
};

export type SiteCodeBundle = {
  html: string;
  css?: string;
  js?: string;
};

export type LiveSiteGenerateRequest = {
  prompt: string;
  previous?: {
    slug?: string | null;
    code?: SiteCodeBundle | null;
  };
};

export type LiveSiteGenerateResponse = {
  slug: string;
  previewUrl: string;
  publicUrl: string | null;
  code?: SiteCodeBundle | null;
  meta?: {
    engine?: string;
    aiEnabled?: boolean;
    generatedAt?: string;
    retryCount?: number;
    deprecated?: string;
  };
};

export type LiveSitePublishRequest = {
  slug: string;
  code: SiteCodeBundle;
};

export type LiveSitePublishResponse = {
  slug: string;
  publicUrl: string;
  stage: "published";
};

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  return {
    "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function extractError(response: Response): Promise<string> {
  const fallback = "Falha ao gerar automaticamente o site.";
  try {
    const payload = await response.json();
    if (response.status === 401) {
      await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
      return "Sessão expirada. Faça login novamente.";
    }
    if (typeof payload?.message === "string" && payload.message.trim()) return payload.message.trim();
    if (typeof payload?.error === "string" && payload.error.trim()) return payload.error.trim();
  } catch {
    // no-op
  }
  if (response.status === 401) {
    await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
    return "Sessão expirada. Faça login novamente.";
  }
  return fallback;
}

function resolveQueueApiBaseUrl(): string {
  const queueBase = String(process.env.EXPO_PUBLIC_QUEUE_API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (queueBase) return queueBase;

  const authBase = String(process.env.EXPO_PUBLIC_AUTH_API_BASE_URL || "").trim().replace(/\/+$/, "");
  if (authBase) {
    // Common setup: auth on :3333 and queue on :3334.
    return authBase.replace(/:3333$/, ":3334");
  }

  return "";
}

export async function autobuildSite(payload: SiteAutobuildRequest): Promise<SiteAutobuildResponse> {
  const baseUrl = resolveQueueApiBaseUrl();
  if (!baseUrl) {
    throw new Error("API de fila não configurada para autobuilder de site.");
  }

  const response = await fetch(`${baseUrl}/v1/site/autobuild`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await extractError(response));
  }

  return response.json() as Promise<SiteAutobuildResponse>;
}

export async function generateLiveSite(payload: LiveSiteGenerateRequest): Promise<LiveSiteGenerateResponse> {
  const baseUrl = resolveQueueApiBaseUrl();
  if (!baseUrl) {
    throw new Error("API de fila não configurada para geração de site.");
  }

  const response = await fetch(`${baseUrl}/v1/site/live/generate`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await extractError(response));
  }

  return response.json() as Promise<LiveSiteGenerateResponse>;
}

export async function publishLiveSite(payload: LiveSitePublishRequest): Promise<LiveSitePublishResponse> {
  const baseUrl = resolveQueueApiBaseUrl();
  if (!baseUrl) {
    throw new Error("API de fila não configurada para publicação de site.");
  }

  const response = await fetch(`${baseUrl}/v1/site/live/publish`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await extractError(response));
  }

  return response.json() as Promise<LiveSitePublishResponse>;
}
