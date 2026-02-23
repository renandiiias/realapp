import type { Order } from "../queue/types";

type DebugLevel = "info" | "warn" | "error";

type LogMeta = Record<string, unknown>;

const SENSITIVE_KEY_RE = /(token|authorization|password|cookie|secret|api[_-]?key)/i;
const SENSITIVE_PATTERNS = [/bearer\s+[a-z0-9._-]+/gi, /sk-[a-z0-9]{12,}/gi];

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

function compactStack(raw: string): string {
  return raw
    .split("\n")
    .slice(0, 8)
    .map((line) => line.trim())
    .join("|");
}

export function buildErrorFingerprint(error: unknown, context: string): string {
  const err = error instanceof Error ? error : new Error(typeof error === "string" ? error : "unknown_error");
  const parts = [context, err.name || "Error", err.message || "no_message", compactStack(err.stack || "")];
  return parts.join("::").slice(0, 900);
}

function withOrderHints(meta: LogMeta): LogMeta {
  const order = meta.order as Order | undefined;
  if (!order) return meta;
  return {
    ...meta,
    order: {
      id: order.id,
      type: order.type,
      status: order.status,
      updatedAt: order.updatedAt,
      title: order.title,
    },
  };
}

export async function sendQueueClientLog(params: {
  baseUrl: string;
  traceId: string;
  stage: string;
  event: string;
  level?: DebugLevel;
  fingerprint?: string;
  meta?: LogMeta;
}): Promise<void> {
  const safeBase = params.baseUrl.replace(/\/+$/, "");
  if (!safeBase) return;
  const payload = {
    trace_id: params.traceId,
    stage: params.stage,
    event: params.event,
    level: params.level ?? "info",
    fingerprint: params.fingerprint || null,
    meta: sanitizeMetaValue(withOrderHints(params.meta ?? {}), "meta"),
  };
  try {
    await fetch(`${safeBase}/v1/debug/client-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Never block user flow because of log transport failures.
  }
}
