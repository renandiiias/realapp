export type VideoStatus = "QUEUED" | "PROCESSING" | "COMPLETE" | "FAILED" | "CANCELLED";
export type AiEditMode = "cut" | "cut_captions";

export type ApiError = {
  code: string;
  message: string;
};

export type VideoItem = {
  id: string;
  object: "video";
  status: VideoStatus;
  created_at: string;
  completed_at: string | null;
  progress: number;
  error: ApiError | null;
  source_video_id: string | null;
  caption_template_id: string | null;
};

export type CaptionTemplate = {
  id: string;
  object: "caption_template";
  name: string;
  preview_url: string;
  ass_style_json: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
};

export type ManualEditorSession = {
  editorUrl: string;
  sessionToken: string;
  expiresAt: string;
  editSessionId: string;
};

type TemplateListResponse = {
  object: "list";
  data: CaptionTemplate[];
};

async function extractErrorMessage(response: Response): Promise<string> {
  let message = "Erro inesperado ao processar a solicitacao.";
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") {
      message = payload.detail;
    } else if (payload?.detail?.message) {
      message = payload.detail.message;
    } else if (typeof payload?.error === "string") {
      message = payload.error;
    }
  } catch {
    // noop
  }
  return message;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }
  throw new Error(await extractErrorMessage(response));
}

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export async function fetchTemplates(baseUrl: string): Promise<CaptionTemplate[]> {
  const safeBase = cleanBaseUrl(baseUrl);
  const response = await fetch(`${safeBase}/v1/videos/captions/templates`);
  const payload = await parseResponse<TemplateListResponse>(response);
  return payload.data;
}

export async function submitCaptionJob(params: {
  baseUrl: string;
  file: { uri: string; name: string; type: string };
  templateId?: string;
  instructions?: string;
}): Promise<VideoItem> {
  const safeBase = cleanBaseUrl(params.baseUrl);
  const body = new FormData();
  if (params.templateId?.trim()) {
    body.append("caption_template_id", params.templateId.trim());
  }
  body.append(
    "video",
    {
      uri: params.file.uri,
      name: params.file.name,
      type: params.file.type,
    } as unknown as Blob,
  );
  body.append("language", "pt-BR");
  if (params.instructions?.trim()) {
    body.append("instructions", params.instructions.trim());
  }

  const response = await fetch(`${safeBase}/v1/videos/captions`, {
    method: "POST",
    body,
  });
  return parseResponse<VideoItem>(response);
}

export async function submitVideoEditJob(params: {
  baseUrl: string;
  file: { uri: string; name: string; type: string };
  mode: AiEditMode;
  instructions?: string;
}): Promise<{ video: VideoItem; compatibilityMode: boolean }> {
  const safeBase = cleanBaseUrl(params.baseUrl);

  const editsBody = new FormData();
  editsBody.append(
    "video",
    {
      uri: params.file.uri,
      name: params.file.name,
      type: params.file.type,
    } as unknown as Blob,
  );
  editsBody.append("mode", params.mode);
  editsBody.append("language", "pt-BR");
  if (params.instructions?.trim()) {
    editsBody.append("style_prompt", params.instructions.trim());
  }

  const editsResponse = await fetch(`${safeBase}/v1/videos/edits`, {
    method: "POST",
    body: editsBody,
  });

  if (editsResponse.ok) {
    const created = (await editsResponse.json()) as VideoItem;
    return { video: created, compatibilityMode: false };
  }

  if (editsResponse.status !== 404 && editsResponse.status !== 405) {
    throw new Error(await extractErrorMessage(editsResponse));
  }

  const legacyBody = new FormData();
  legacyBody.append(
    "video",
    {
      uri: params.file.uri,
      name: params.file.name,
      type: params.file.type,
    } as unknown as Blob,
  );
  legacyBody.append("language", "pt-BR");
  if (params.instructions?.trim()) {
    legacyBody.append("instructions", params.instructions.trim());
  }
  const legacyResponse = await fetch(`${safeBase}/v1/videos/captions`, {
    method: "POST",
    body: legacyBody,
  });
  const legacyCreated = await parseResponse<VideoItem>(legacyResponse);
  return { video: legacyCreated, compatibilityMode: true };
}

export async function submitManualSourceJob(params: {
  baseUrl: string;
  file: { uri: string; name: string; type: string };
  language?: string;
}): Promise<VideoItem> {
  const safeBase = cleanBaseUrl(params.baseUrl);
  const body = new FormData();
  body.append(
    "video",
    {
      uri: params.file.uri,
      name: params.file.name,
      type: params.file.type,
    } as unknown as Blob,
  );
  body.append("language", params.language?.trim() || "pt-BR");

  const response = await fetch(`${safeBase}/v1/videos/manual-source`, {
    method: "POST",
    body,
  });
  return parseResponse<VideoItem>(response);
}

export async function fetchVideo(baseUrl: string, videoId: string): Promise<VideoItem> {
  const safeBase = cleanBaseUrl(baseUrl);
  const response = await fetch(`${safeBase}/v1/videos/${videoId}`);
  return parseResponse<VideoItem>(response);
}

export async function createManualEditorSession(baseUrl: string, videoId: string, orderId?: string): Promise<ManualEditorSession> {
  const safeBase = cleanBaseUrl(baseUrl);
  const response = await fetch(`${safeBase}/v1/videos/${videoId}/editor-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ order_id: orderId || null }),
  });
  return parseResponse<ManualEditorSession>(response);
}

export function getDownloadUrl(baseUrl: string, videoId: string): string {
  const safeBase = cleanBaseUrl(baseUrl);
  return `${safeBase}/v1/videos/${videoId}/content`;
}
