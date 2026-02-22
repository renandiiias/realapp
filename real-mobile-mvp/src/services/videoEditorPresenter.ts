import type { VideoStatus } from "./videoEditorApi";

export function mapVideoStatusToClientLabel(status: VideoStatus | null | undefined, progress = 0): string {
  if (!status) return "Aguardando envio do video.";
  if (status === "QUEUED") return "Preparando sua edicao.";
  if (status === "PROCESSING") {
    if (progress < 0.35) return "Analisando e selecionando os melhores trechos.";
    if (progress < 0.85) return "Editando seu video com IA.";
    return "Finalizando o video para exportacao.";
  }
  if (status === "COMPLETE") return "Video pronto para visualizar e baixar.";
  if (status === "CANCELLED") return "A edicao foi cancelada.";
  return "Nao foi possivel concluir a edicao.";
}

export function humanizeVideoError(rawMessage: string): string {
  const clean = String(rawMessage || "").trim();
  if (!clean) return "Nao foi possivel editar seu video agora. Tente novamente.";

  const lowered = clean.toLowerCase();
  if (lowered.includes("9:16") || lowered.includes("vertical")) {
    return "Este video nao esta em 9:16. Envie um video vertical (ex.: 1080x1920).";
  }
  if (lowered.includes("50 mb") || lowered.includes("50mb") || lowered.includes("limite")) {
    return "Arquivo grande detectado. Use um arquivo menor e tente novamente.";
  }
  if (lowered.includes("formato") || lowered.includes("mp4") || lowered.includes("mov") || lowered.includes("codec")) {
    return "Formato invalido. Envie somente arquivos MP4 ou MOV.";
  }
  if (lowered.includes("timeout") || lowered.includes("demor")) {
    return "A edicao demorou mais que o esperado. Tente novamente em instantes.";
  }
  if (lowered.includes("not_configured") || lowered.includes("nao configur") || lowered.includes("indisponivel")) {
    return "O editor de video esta indisponivel neste ambiente agora.";
  }
  if (lowered.includes("http_") || lowered.includes("video_http_") || lowered.includes("traceback") || lowered.includes("{")) {
    return "Tivemos um erro tecnico ao editar seu video. Tente novamente.";
  }
  return clean;
}

export function buildVideoDeliverableSummary(content: unknown): string {
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    if (typeof content === "string" && content.trim()) {
      return "Video final pronto para visualizacao e download.";
    }
    return "Entrega de video pronta para visualizacao e download.";
  }

  const payload = content as {
    clipDurationSeconds?: unknown;
    durationSeconds?: unknown;
    subtitles?: { status?: unknown; enabled?: unknown } | unknown;
    stylePrompt?: unknown;
  };

  const lines: string[] = ["Video final processado para redes sociais."];

  const durationRaw =
    typeof payload.clipDurationSeconds === "number"
      ? payload.clipDurationSeconds
      : typeof payload.durationSeconds === "number"
        ? payload.durationSeconds
        : null;
  if (typeof durationRaw === "number" && Number.isFinite(durationRaw) && durationRaw > 0) {
    lines.push(`Duracao aproximada: ${durationRaw.toFixed(1)}s.`);
  }

  const subtitles = payload.subtitles;
  if (subtitles && typeof subtitles === "object" && !Array.isArray(subtitles)) {
    const subtitleStatus = String((subtitles as { status?: unknown }).status || "").toLowerCase();
    if (subtitleStatus === "applied") {
      lines.push("Legendas automaticas aplicadas.");
    } else if (subtitleStatus === "failed") {
      lines.push("Tentamos aplicar legendas, mas entregamos a melhor versao disponivel.");
    } else if (subtitleStatus === "disabled") {
      lines.push("Legendas nao aplicadas nesta versao.");
    }
  }

  if (typeof payload.stylePrompt === "string" && payload.stylePrompt.trim()) {
    lines.push("Estilo solicitado considerado na edicao.");
  }

  return lines.join(" ");
}
