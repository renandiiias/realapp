type DebugLevel = "info" | "warn" | "error";

type ClientLogMeta = Record<string, unknown>;

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
    meta: params.meta ?? {},
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
