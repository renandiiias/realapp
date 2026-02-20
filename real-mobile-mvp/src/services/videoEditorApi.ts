export type VideoStatus = "QUEUED" | "PROCESSING" | "COMPLETE" | "FAILED" | "CANCELLED";

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

type TemplateListResponse = {
  object: "list";
  data: CaptionTemplate[];
};

async function parseResponse<T>(response: Response): Promise<T> {
  if (response.ok) {
    return response.json() as Promise<T>;
  }

  let message = "Erro inesperado ao processar a solicitacao.";
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") {
      message = payload.detail;
    } else if (payload?.detail?.message) {
      message = payload.detail.message;
    }
  } catch {
    // noop
  }
  throw new Error(message);
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

export async function fetchVideo(baseUrl: string, videoId: string): Promise<VideoItem> {
  const safeBase = cleanBaseUrl(baseUrl);
  const response = await fetch(`${safeBase}/v1/videos/${videoId}`);
  return parseResponse<VideoItem>(response);
}

export function getDownloadUrl(baseUrl: string, videoId: string): string {
  const safeBase = cleanBaseUrl(baseUrl);
  return `${safeBase}/v1/videos/${videoId}/content`;
}
