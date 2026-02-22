type DebugLevel = "info" | "warn" | "error";

type ClientLogMeta = Record<string, unknown>;

const SENSITIVE_KEY_RE = /(token|authorization|password|cookie|secret|api[_-]?key)/i;
const SENSITIVE_PATTERNS = [/bearer\s+[a-z0-9._-]+/gi, /sk-[a-z0-9]{12,}/gi];

export function makeClientTraceId(prefix = "mobile"): string {
  const rand = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

export function sanitizeUri(uri: string | undefined | null): string | null {
  if (!uri) return null;
  const lowered = uri.toLowerCase();
  if (lowered.startsWith("file://")) {
    return `file://${uri.split("/").slice(-2).join("/")}`;
  }
  if (lowered.startsWith("ph://")) {
    return `ph://${uri.slice(5, 24)}`;
  }
  if (lowered.startsWith("assets-library://")) {
    return "assets-library://...";
  }
  return uri.slice(0, 120);
}

function sanitizeMetaValue(value: unknown, keyHint = ""): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (SENSITIVE_KEY_RE.test(keyHint)) return "***";
    let out = value;
    for (const pattern of SENSITIVE_PATTERNS) {
      out = out.replace(pattern, "***");
    }
    return out.slice(0, 600);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => sanitizeMetaValue(item, keyHint));
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      next[k] = sanitizeMetaValue(v, k);
    }
    return next;
  }
  return String(value).slice(0, 120);
}

export async function sendVideoClientLog(params: {
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
    meta: sanitizeMetaValue(params.meta ?? {}, "meta"),
  };
  try {
    await fetch(`${safeBase}/v1/debug/client-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Never break product flow because of logging.
  }
}
