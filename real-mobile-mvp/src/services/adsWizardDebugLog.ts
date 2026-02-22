type DebugLevel = "info" | "warn" | "error";

type ClientLogMeta = Record<string, unknown>;

function maskValue(value: string): string {
  let sanitized = value;
  sanitized = sanitized.replace(/(bearer\s+)[a-z0-9._-]+/gi, "$1***");
  sanitized = sanitized.replace(/([?&](?:token|key|password|pwd|secret)=)[^&\s]+/gi, "$1***");
  sanitized = sanitized.replace(/\b\d{10,15}\b/g, (m) => `${m.slice(0, 2)}***${m.slice(-2)}`);
  return sanitized;
}

function sanitizeMetaValue(value: unknown, keyHint = ""): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (/(token|authorization|password|cookie|secret|api[_-]?key)/i.test(keyHint)) return "***";
    return maskValue(value).slice(0, 500);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeMetaValue(item, keyHint));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = sanitizeMetaValue(v, k);
    }
    return out;
  }
  return String(value).slice(0, 300);
}

export function makeAdsTraceId(prefix = "ads"): string {
  const rand = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function buildErrorFingerprint(error: unknown, context = ""): string {
  const message = error instanceof Error ? `${error.name}|${error.message}|${error.stack || ""}` : String(error);
  const raw = `${context}|${message}`.slice(0, 2000);
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return `ads_${Math.abs(hash)}`;
}

export async function sendAdsClientLog(params: {
  baseUrl: string;
  traceId: string;
  stage: string;
  event: string;
  level?: DebugLevel;
  meta?: ClientLogMeta;
}): Promise<void> {
  const safeBase = params.baseUrl.replace(/\/+$/, "");
  if (!safeBase) return;

  const payload = {
    trace_id: params.traceId,
    stage: params.stage,
    event: params.event,
    level: params.level ?? "info",
    ts_utc: new Date().toISOString(),
    meta: sanitizeMetaValue(params.meta ?? {}, "meta"),
  };

  try {
    await fetch(`${safeBase}/v1/debug/client-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Logging must never break the campaign wizard.
  }
}
