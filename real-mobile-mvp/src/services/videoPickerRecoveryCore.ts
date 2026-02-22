export type PickerLogLevel = "info" | "warn" | "error";

export type PickerLogPayload = {
  event: string;
  level?: PickerLogLevel;
  meta?: Record<string, unknown>;
};

export type PickerLogFn = (payload: PickerLogPayload) => void | Promise<void>;

export type PickerAsset = {
  uri: string;
  fileName?: string | null;
  mimeType?: string | null;
  duration?: number | null;
  fileSize?: number | null;
};

export type PickerResult = {
  canceled: boolean;
  assets?: PickerAsset[] | null;
};

export type VideoPickerSource = "gallery_preserve" | "gallery_compat" | "gallery_default" | "document_auto";

export type RecoveredVideoAsset = {
  uri: string;
  fileName: string;
  mimeType: string;
  duration: number;
  fileSize: number;
  source: VideoPickerSource;
};

export type GalleryAttempt = {
  id: Exclude<VideoPickerSource, "document_auto">;
  options: Record<string, unknown>;
};

export type PickerRecoveryDeps = {
  platform: string;
  launchImageLibraryAsync: (options: Record<string, unknown>) => Promise<PickerResult>;
  getDocumentAsync: (options: Record<string, unknown>) => Promise<PickerResult>;
  copyAsync: (params: { from: string; to: string }) => Promise<void>;
  getInfoAsync: (uri: string) => Promise<{ exists?: boolean; size?: number | null }>;
  cacheDirectory?: string | null;
  documentDirectory?: string | null;
  sleepMs: (ms: number) => Promise<void>;
  nowMs: () => number;
  random: () => number;
};

export type PickVideoWithRecoveryInput = {
  traceId: string;
  galleryAttempts: GalleryAttempt[];
  documentPickerOptions: Record<string, unknown>;
  timeoutMs?: number;
  maxSizeBytes?: number;
  log?: PickerLogFn;
  deps: PickerRecoveryDeps;
};

let pickerMutex: Promise<void> = Promise.resolve();

export function __resetPickerRecoveryMutexForTests(): void {
  pickerMutex = Promise.resolve();
}

function makeSafeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return `video_${Date.now()}.mp4`;
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function normalizeDuration(rawDuration: number | null | undefined): number {
  if (!rawDuration || !Number.isFinite(rawDuration)) return 0;
  if (rawDuration > 1000) return rawDuration / 1000;
  return rawDuration;
}

function guessExtension(uri: string, mimeType: string | undefined | null): string {
  const fromUri = uri.toLowerCase();
  if (fromUri.endsWith(".mov")) return ".mov";
  if (fromUri.endsWith(".m4v")) return ".m4v";
  if (fromUri.endsWith(".mp4")) return ".mp4";
  const mime = (mimeType || "").toLowerCase();
  if (mime.includes("quicktime")) return ".mov";
  if (mime.includes("x-m4v")) return ".m4v";
  return ".mp4";
}

function guessMime(uri: string, mimeType: string | undefined | null): string {
  if (mimeType?.trim()) return mimeType;
  const lower = uri.toLowerCase();
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".m4v")) return "video/x-m4v";
  return "video/mp4";
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(String(error ?? "unknown_picker_error"));
}

async function emit(log: PickerLogFn | undefined, payload: PickerLogPayload): Promise<void> {
  if (!log) return;
  await log(payload);
}

async function withPickerMutex<T>(fn: () => Promise<T>): Promise<T> {
  const previous = pickerMutex;
  let release!: () => void;
  pickerMutex = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`image_library_timeout_${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function buildStagedTargetName(asset: PickerAsset, deps: PickerRecoveryDeps): string {
  const safeFromAsset = makeSafeName(asset.fileName || "");
  const hasExt = /\.[a-zA-Z0-9]{2,5}$/.test(safeFromAsset);
  const ext = hasExt ? "" : guessExtension(asset.uri, asset.mimeType);
  return `picker_stage_${deps.nowMs()}_${Math.floor(deps.random() * 1_000_000)}_${safeFromAsset || `video${ext}`}`;
}

async function stageAsset(input: {
  source: VideoPickerSource;
  asset: PickerAsset;
  traceId: string;
  deps: PickerRecoveryDeps;
  maxSizeBytes?: number;
  log?: PickerLogFn;
}): Promise<RecoveredVideoAsset> {
  const { asset, deps, maxSizeBytes, source, log } = input;
  const baseDir = deps.cacheDirectory || deps.documentDirectory;
  if (!baseDir) {
    throw new Error("picker_stage_directory_unavailable");
  }

  const targetName = buildStagedTargetName(asset, deps);
  const targetUri = `${baseDir}${targetName}`;

  await emit(log, {
    event: "picker_stage_copy_start",
    meta: {
      source,
      trace_id: input.traceId,
      from_uri: asset.uri,
      target_name: targetName,
    },
  });

  try {
    await deps.copyAsync({ from: asset.uri, to: targetUri });
  } catch (error) {
    await emit(log, {
      event: "picker_stage_copy_failed",
      level: "warn",
      meta: {
        source,
        trace_id: input.traceId,
        from_uri: asset.uri,
        error: toError(error).message,
      },
    });
    throw toError(error);
  }

  const info = await deps.getInfoAsync(targetUri);
  const exists = info?.exists === true;
  const size = typeof info?.size === "number" ? info.size : typeof asset.fileSize === "number" ? asset.fileSize : 0;
  if (!exists || size <= 0) {
    await emit(log, {
      event: "picker_stage_copy_failed",
      level: "warn",
      meta: {
        source,
        trace_id: input.traceId,
        target_uri: targetUri,
        exists,
        size,
        error: "picker_stage_copy_invalid_size",
      },
    });
    throw new Error("picker_stage_copy_invalid_size");
  }
  if (typeof maxSizeBytes === "number" && size > maxSizeBytes) {
    await emit(log, {
      event: "picker_stage_copy_failed",
      level: "warn",
      meta: {
        source,
        trace_id: input.traceId,
        target_uri: targetUri,
        size,
        max_size_bytes: maxSizeBytes,
        error: "picker_stage_copy_oversize",
      },
    });
    throw new Error(`picker_stage_copy_oversize_${size}`);
  }

  const fileName = makeSafeName(asset.fileName || targetName);
  const mimeType = guessMime(fileName, asset.mimeType);
  const duration = normalizeDuration(asset.duration);

  await emit(log, {
    event: "picker_stage_copy_ok",
    meta: {
      source,
      trace_id: input.traceId,
      staged_uri: targetUri,
      file_name: fileName,
      size_bytes: size,
      duration_seconds: duration,
    },
  });

  return {
    uri: targetUri,
    fileName,
    mimeType,
    duration,
    fileSize: size,
    source,
  };
}

export async function pickVideoWithRecoveryCore(input: PickVideoWithRecoveryInput): Promise<RecoveredVideoAsset | null> {
  const timeoutMs = input.timeoutMs ?? 12_000;
  const failures: Array<{ source: string; reason: string }> = [];

  return withPickerMutex(async () => {
    for (const attempt of input.galleryAttempts) {
      await emit(input.log, {
        event: "picker_attempt_start",
        meta: {
          trace_id: input.traceId,
          source: attempt.id,
          platform: input.deps.platform,
        },
      });

      let result: PickerResult;
      try {
        result = await withTimeout(input.deps.launchImageLibraryAsync(attempt.options), timeoutMs);
      } catch (error) {
        const message = toError(error).message;
        failures.push({ source: attempt.id, reason: message });
        await emit(input.log, {
          event: "picker_attempt_failed",
          level: "warn",
          meta: {
            trace_id: input.traceId,
            source: attempt.id,
            reason: message,
          },
        });
        continue;
      }

      if (result.canceled) {
        await emit(input.log, {
          event: "picker_attempt_failed",
          meta: {
            trace_id: input.traceId,
            source: attempt.id,
            reason: "canceled",
          },
        });
        return null;
      }

      const firstAsset = result.assets?.[0];
      if (!firstAsset) {
        failures.push({ source: attempt.id, reason: "empty_assets" });
        await emit(input.log, {
          event: "picker_attempt_failed",
          level: "warn",
          meta: {
            trace_id: input.traceId,
            source: attempt.id,
            reason: "empty_assets",
          },
        });
        continue;
      }

      try {
        const staged = await stageAsset({
          source: attempt.id,
          asset: firstAsset,
          traceId: input.traceId,
          deps: input.deps,
          maxSizeBytes: input.maxSizeBytes,
          log: input.log,
        });
        if (failures.length > 0) {
          await emit(input.log, {
            event: "picker_attempt_recovered",
            meta: {
              trace_id: input.traceId,
              recovered_by: attempt.id,
              failures,
            },
          });
        }
        return staged;
      } catch (error) {
        const message = toError(error).message;
        failures.push({ source: attempt.id, reason: message });
        await emit(input.log, {
          event: "picker_attempt_failed",
          level: "warn",
          meta: {
            trace_id: input.traceId,
            source: attempt.id,
            reason: message,
          },
        });
      }
    }

    await emit(input.log, {
      event: "picker_auto_document_start",
      meta: {
        trace_id: input.traceId,
        failures,
      },
    });

    let docResult: PickerResult;
    try {
      docResult = await input.deps.getDocumentAsync(input.documentPickerOptions);
    } catch (error) {
      const message = toError(error).message;
      if (/Different document picking in progress/i.test(message)) {
        await input.deps.sleepMs(700);
        try {
          docResult = await input.deps.getDocumentAsync(input.documentPickerOptions);
        } catch (retryError) {
          const retryMessage = toError(retryError).message;
          await emit(input.log, {
            event: "picker_auto_document_failed",
            level: "error",
            meta: {
              trace_id: input.traceId,
              reason: retryMessage,
              failures,
            },
          });
          throw toError(retryError);
        }
      } else {
        await emit(input.log, {
          event: "picker_auto_document_failed",
          level: "error",
          meta: {
            trace_id: input.traceId,
            reason: message,
            failures,
          },
        });
        throw toError(error);
      }
    }

    if (docResult.canceled) {
      await emit(input.log, {
        event: "picker_auto_document_failed",
        meta: {
          trace_id: input.traceId,
          reason: "canceled",
          failures,
        },
      });
      return null;
    }

    const docAsset = docResult.assets?.[0];
    if (!docAsset) {
      await emit(input.log, {
        event: "picker_auto_document_failed",
        level: "warn",
        meta: {
          trace_id: input.traceId,
          reason: "empty_assets",
          failures,
        },
      });
      throw new Error("picker_auto_document_empty_assets");
    }

    const staged = await stageAsset({
      source: "document_auto",
      asset: docAsset,
      traceId: input.traceId,
      deps: input.deps,
      maxSizeBytes: input.maxSizeBytes,
      log: input.log,
    });

    await emit(input.log, {
      event: "picker_auto_document_ok",
      meta: {
        trace_id: input.traceId,
        source: staged.source,
        file_name: staged.fileName,
      },
    });

    if (failures.length > 0) {
      await emit(input.log, {
        event: "picker_attempt_recovered",
        meta: {
          trace_id: input.traceId,
          recovered_by: "document_auto",
          failures,
        },
      });
    }

    return staged;
  });
}
