import { router } from "expo-router";
import { ResizeMode, Video } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, View } from "react-native";
import type { JsonObject } from "../../src/queue/types";
import { useQueue } from "../../src/queue/QueueProvider";
import { fetchTemplates, fetchVideo, getDownloadUrl, submitCaptionJob, type CaptionTemplate, type VideoItem } from "../../src/services/videoEditorApi";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Field } from "../../src/ui/components/Field";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

const MAX_VIDEO_SECONDS = 300;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".mp4", ".mov"];

type PickedVideo = {
  uri: string;
  name: string;
  mimeType: string;
  durationSeconds: number;
  source: "gallery" | "camera";
  sizeBytes?: number;
  width?: number;
  height?: number;
};

function normalizeDuration(rawDuration: number | null | undefined): number {
  if (!rawDuration || !Number.isFinite(rawDuration)) return 0;
  if (rawDuration > 1000) return rawDuration / 1000;
  return rawDuration;
}

function makeSafeName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return `video_${Date.now()}.mp4`;
  return trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

function pickerErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/PHPhotosErrorDomain/i.test(raw) && /3164/.test(raw)) {
    return "Nao consegui abrir esse video da galeria. Tente baixar o arquivo no iPhone (se estiver no iCloud) ou escolha outro video.";
  }
  return "Falha ao abrir video da galeria/camera. Tente novamente.";
}

function isIosPhotos3164(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return /PHPhotosErrorDomain/i.test(raw) && /3164/.test(raw);
}

function getFriendlyError(raw: string): string {
  const lowered = raw.toLowerCase();
  if (lowered.includes("9:16") || lowered.includes("vertical")) {
    return "Este video nao esta em 9:16. Envie um video vertical (ex.: 1080x1920).";
  }
  if (lowered.includes("50 mb") || lowered.includes("50mb") || lowered.includes("limite")) {
    return "O arquivo passou do limite permitido. Use um video de ate 50MB.";
  }
  if (lowered.includes("formato") || lowered.includes("mp4") || lowered.includes("mov")) {
    return "Formato invalido. Envie somente arquivos MP4 ou MOV.";
  }
  return raw;
}

function hasAcceptedExtension(name: string): boolean {
  const lowered = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lowered.endsWith(ext));
}

function inferPhase(video: VideoItem | null): "upload" | "queued" | "processing" | "complete" | "failed" {
  if (!video) return "upload";
  if (video.status === "QUEUED") return "queued";
  if (video.status === "PROCESSING") return "processing";
  if (video.status === "COMPLETE") return "complete";
  return "failed";
}

function progressLabel(video: VideoItem | null): string {
  if (!video) return "Aguardando envio";
  if (video.status === "QUEUED") return "Na fila";
  if (video.status === "PROCESSING") return `Processando (${Math.round(video.progress * 100)}%)`;
  if (video.status === "COMPLETE") return "Pronto para baixar";
  return video.error?.message || "Falha ao processar";
}

export default function VideoEditorCreateScreen() {
  const queue = useQueue();
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [stylePrompt, setStylePrompt] = useState("");

  const [templates, setTemplates] = useState<CaptionTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [loadingTemplates, setLoadingTemplates] = useState(false);

  const [video, setVideo] = useState<VideoItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);

  const videoApiBase = useMemo(() => {
    const raw = process.env.EXPO_PUBLIC_VIDEO_EDITOR_API_BASE_URL?.trim() ?? "";
    return raw ? raw.replace(/\/+$/, "") : "";
  }, []);
  const hasRemoteEditor = Boolean(videoApiBase);

  useEffect(() => {
    if (!hasRemoteEditor || !videoApiBase) return;
    let mounted = true;
    setLoadingTemplates(true);
    setError(null);

    void fetchTemplates(videoApiBase)
      .then((data) => {
        if (!mounted) return;
        setTemplates(data);
        if (data.length > 0) {
          setSelectedTemplate((current) => (current ? current : data[0]!.id));
        }
      })
      .catch((templateError) => {
        if (!mounted) return;
        const message = templateError instanceof Error ? templateError.message : "Nao foi possivel carregar templates.";
        setError(getFriendlyError(message));
      })
      .finally(() => {
        if (!mounted) return;
        setLoadingTemplates(false);
      });

    return () => {
      mounted = false;
    };
  }, [hasRemoteEditor, videoApiBase]);

  useEffect(() => {
    if (!hasRemoteEditor || !video || !videoApiBase) return;
    if (video.status !== "QUEUED" && video.status !== "PROCESSING") return;

    const timer = setInterval(() => {
      void fetchVideo(videoApiBase, video.id)
        .then((current) => {
          setVideo(current);
        })
        .catch(() => {
          setError("Nao foi possivel atualizar o progresso.");
        });
    }, 2000);

    return () => clearInterval(timer);
  }, [hasRemoteEditor, video, videoApiBase]);

  const canSubmit = Boolean(picked) && !submitting;
  const runSafe = (task: () => Promise<void>) => {
    void task().catch((taskError) => {
      setError(pickerErrorMessage(taskError));
    });
  };

  const applyPicked = (asset: {
    uri: string;
    fileName?: string | null;
    mimeType?: string | null;
    duration?: number | null;
    fileSize?: number | null;
    width?: number;
    height?: number;
  }, source: "gallery" | "camera") => {
    const durationSeconds = normalizeDuration(asset.duration);
    if (durationSeconds && durationSeconds > MAX_VIDEO_SECONDS) {
      setError("Use um video de ate 5 minutos.");
      return;
    }

    const guessedName = makeSafeName(asset.fileName || `video_${Date.now()}.mp4`);
    if (!hasAcceptedExtension(guessedName)) {
      setError("Formato invalido. Envie um video MP4 ou MOV.");
      return;
    }

    const guessedType = asset.mimeType || "video/mp4";
    const fileSize = typeof asset.fileSize === "number" ? asset.fileSize : undefined;
    if (fileSize && fileSize > MAX_VIDEO_BYTES) {
      setError("Arquivo acima do limite de 50MB.");
      return;
    }

    setPicked({
      uri: asset.uri,
      name: guessedName,
      mimeType: guessedType,
      durationSeconds,
      source,
      sizeBytes: fileSize,
      width: asset.width,
      height: asset.height,
    });
    setVideo(null);
    setError(null);
  };

  const pickVideoWithDocumentPicker = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "video/*",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return;
      const file = result.assets[0];
      applyPicked(
        {
          uri: file.uri,
          fileName: file.name,
          mimeType: file.mimeType,
          fileSize: file.size,
        },
        "gallery",
      );
    } catch (pickError) {
      setError(pickerErrorMessage(pickError));
    }
  };

  const pickVideoFromLibrary = async () => {
    setError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setError("Permissao de galeria negada.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      applyPicked(result.assets[0], "gallery");
    } catch (pickError) {
      if (isIosPhotos3164(pickError)) {
        await pickVideoWithDocumentPicker();
        return;
      }
      setError(pickerErrorMessage(pickError));
    }
  };

  const recordVideoNow = async () => {
    setError(null);
    try {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        setError("Permissao de camera negada.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        videoMaxDuration: MAX_VIDEO_SECONDS,
        quality: 1,
      });
      if (result.canceled || !result.assets?.[0]) return;
      applyPicked(result.assets[0], "camera");
    } catch (cameraError) {
      setError(pickerErrorMessage(cameraError));
    }
  };

  const submitFallbackOrder = async () => {
    if (!picked) return;
    const payload: JsonObject = {
      source: picked.source,
      originalFileName: picked.name,
      durationSeconds: Math.round((picked.durationSeconds || 0) * 1000) / 1000,
      maxDurationSeconds: 15,
      stylePrompt: stylePrompt.trim(),
      localUri: picked.uri,
    };

    const created = await queue.createOrder({
      type: "video_editor",
      title: "Editor de Video ate 15s",
      summary: stylePrompt.trim() ? `Edicao social curta: ${stylePrompt.trim()}` : "Edicao social curta com corte e entrega final.",
      payload,
    });
    await queue.submitOrder(created.id);
    router.push(`/orders/${created.id}`);
  };

  const submit = async () => {
    if (!picked || submitting) return;
    setSubmitting(true);
    setError(null);

    try {
      if (hasRemoteEditor && videoApiBase) {
        const templateId = selectedTemplate || templates[0]?.id || "";
        if (!templateId) {
          throw new Error("Editor ainda carregando. Tente novamente em alguns segundos.");
        }

        const created = await submitCaptionJob({
          baseUrl: videoApiBase,
          file: {
            uri: picked.uri,
            name: picked.name,
            type: picked.mimeType,
          },
          templateId,
          instructions: stylePrompt,
        });
        setVideo(created);
      } else {
        await submitFallbackOrder();
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Nao foi possivel iniciar o processamento.";
      setError(getFriendlyError(message));
    } finally {
      setSubmitting(false);
    }
  };

  const assertUrlReachable = async (url: string) => {
    const head = await fetch(url, { method: "HEAD" });
    if (head.ok) return;

    if (head.status === 405 || head.status === 501) {
      const probe = await fetch(url, { method: "GET", headers: { Range: "bytes=0-1" } });
      if (probe.ok || probe.status === 206) return;
      throw new Error(`Arquivo indisponivel no servidor (HTTP ${probe.status}).`);
    }

    throw new Error(`Arquivo indisponivel no servidor (HTTP ${head.status}).`);
  };

  const buildFileName = (url: string) => {
    const match = url.match(/\/([^/?#]+\.mp4)(?:[?#]|$)/i);
    if (match?.[1]) return match[1];
    return `video_${Date.now()}.mp4`;
  };

  const resolveVideoUrl = () => {
    if (!videoApiBase || !video || video.status !== "COMPLETE") return null;
    return getDownloadUrl(videoApiBase, video.id);
  };

  const openViewer = async () => {
    const url = resolveVideoUrl();
    if (!url) return;
    try {
      setError(null);
      await assertUrlReachable(url);
      setViewerUrl(url);
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : "Nao foi possivel abrir o video.";
      setError(getFriendlyError(message));
    }
  };

  const downloadInsideApp = async () => {
    const url = resolveVideoUrl();
    if (!url) return;

    try {
      setError(null);
      setDownloadingUrl(url);
      await assertUrlReachable(url);

      const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!baseDir) throw new Error("Armazenamento local indisponivel.");

      const targetPath = `${baseDir}${buildFileName(url)}`;
      const result = await FileSystem.downloadAsync(url, targetPath);
      const canShare = await Sharing.isAvailableAsync();

      if (canShare) {
        await Sharing.shareAsync(result.uri, {
          dialogTitle: "Salvar video",
          mimeType: "video/mp4",
          UTI: "public.mpeg-4",
        });
      } else {
        Alert.alert("Download concluido", `Arquivo salvo em: ${result.uri}`);
      }
    } catch (downloadError) {
      const message = downloadError instanceof Error ? downloadError.message : "Nao foi possivel baixar o video.";
      setError(getFriendlyError(message));
    } finally {
      setDownloadingUrl(null);
    }
  };

  const phase = inferPhase(video);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <Kicker>Legendagem automatica PT-BR</Kicker>
          <Title>Video captions em 1 clique</Title>
          <Body>Envie video vertical e receba o arquivo final pronto.</Body>
        </Card>

        <Card>
          <SubTitle>Escolha o video</SubTitle>
          <View style={styles.actions}>
            <Button label="Enviar da galeria" onPress={() => runSafe(pickVideoFromLibrary)} style={styles.action} disabled={submitting} />
            <Button label="Gravar agora" onPress={() => runSafe(recordVideoNow)} variant="secondary" style={styles.action} disabled={submitting} />
            <Button
              label="Escolher arquivo (fallback)"
              onPress={() => runSafe(pickVideoWithDocumentPicker)}
              variant="secondary"
              style={styles.action}
              disabled={submitting}
            />
          </View>
          {picked ? (
            <View style={styles.pickedMeta}>
              <Body>Arquivo: {picked.name}</Body>
              <Body>Duração: {picked.durationSeconds > 0 ? `${picked.durationSeconds.toFixed(2)}s` : "não detectada"}</Body>
              <Body>Origem: {picked.source === "camera" ? "Camera" : "Galeria"}</Body>
              {picked.sizeBytes ? <Body>Tamanho: {(picked.sizeBytes / (1024 * 1024)).toFixed(1)}MB</Body> : null}
            </View>
          ) : null}
        </Card>

        <Card>
          <SubTitle>Estilo da edicao (opcional)</SubTitle>
          <Field
            label="Instrução de estilo"
            value={stylePrompt}
            onChangeText={setStylePrompt}
            placeholder="Ex.: legenda maior e mais dinamica"
            multiline
          />
          <Body style={styles.hint}>
            {hasRemoteEditor
              ? "Backend de captioning ativo. O app vai processar e liberar download ao concluir."
              : "Sem backend remoto configurado: o app vai cair no fluxo local de pedido."}
          </Body>
        </Card>

        {hasRemoteEditor ? (
          <Card>
            <SubTitle>Status do job</SubTitle>
            <Body style={styles.statusMain}>{progressLabel(video)}</Body>
            <View style={styles.timeline}>
              <Body style={phase === "upload" ? styles.timelineActive : styles.timelineItem}>upload</Body>
              <Body style={phase === "queued" ? styles.timelineActive : styles.timelineItem}>queued</Body>
              <Body style={phase === "processing" ? styles.timelineActive : styles.timelineItem}>processing</Body>
              <Body style={phase === "complete" ? styles.timelineActive : phase === "failed" ? styles.timelineFailed : styles.timelineItem}>
                {phase === "failed" ? "failed" : "complete"}
              </Body>
            </View>
            {video ? <Body>ID: {video.id}</Body> : <Body>Nenhum job iniciado ainda.</Body>}
            {video?.status === "COMPLETE" ? (
              <View style={styles.completeActions}>
                <Button label="Ver video no app" onPress={() => void openViewer()} variant="secondary" style={styles.downloadButton} />
                <Button
                  label={downloadingUrl ? "Baixando..." : "Baixar no app"}
                  onPress={() => void downloadInsideApp()}
                  disabled={Boolean(downloadingUrl)}
                  style={styles.downloadButton}
                />
              </View>
            ) : null}
          </Card>
        ) : null}

        <Card>
          {submitting ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={realTheme.colors.green} />
              <Body>{hasRemoteEditor ? "Enviando e iniciando processamento..." : "Enviando e criando pedido..."}</Body>
            </View>
          ) : (
            <Button
              label={hasRemoteEditor ? "Enviar video e processar" : "Enviar para edicao"}
              onPress={() => void submit()}
              disabled={!canSubmit}
            />
          )}
          {error ? <Body style={styles.error}>{error}</Body> : null}
        </Card>
      </ScrollView>

      <Modal visible={Boolean(viewerUrl)} animationType="slide" transparent={false} onRequestClose={() => setViewerUrl(null)}>
        <View style={styles.viewerWrap}>
          {viewerUrl ? (
            <Video source={{ uri: viewerUrl }} style={styles.viewerPlayer} useNativeControls resizeMode={ResizeMode.CONTAIN} isLooping={false} />
          ) : null}
          <View style={styles.viewerActions}>
            {downloadingUrl === viewerUrl ? <ActivityIndicator color={realTheme.colors.green} /> : null}
            <Button
              label={viewerUrl && downloadingUrl === viewerUrl ? "Baixando..." : "Baixar no app"}
              onPress={() => void downloadInsideApp()}
              disabled={!viewerUrl || downloadingUrl === viewerUrl}
              style={styles.viewerBtn}
            />
            <Button label="Fechar" variant="secondary" onPress={() => setViewerUrl(null)} style={styles.viewerBtn} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    paddingBottom: 42,
  },
  actions: {
    marginTop: 8,
    gap: 10,
  },
  action: {
    width: "100%",
  },
  pickedMeta: {
    marginTop: 10,
    gap: 2,
  },
  hint: {
    marginTop: 8,
    color: realTheme.colors.muted,
  },
  loadingWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusMain: {
    color: realTheme.colors.text,
    marginTop: 6,
    marginBottom: 10,
  },
  timeline: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    rowGap: 6,
    marginBottom: 10,
  },
  timelineItem: {
    color: realTheme.colors.muted,
    fontSize: 13,
    textTransform: "lowercase",
  },
  timelineActive: {
    color: realTheme.colors.green,
    fontSize: 13,
    textTransform: "lowercase",
  },
  timelineFailed: {
    color: "#ff7070",
    fontSize: 13,
    textTransform: "lowercase",
  },
  downloadButton: {
    width: "100%",
  },
  completeActions: {
    marginTop: 10,
    gap: 10,
  },
  viewerWrap: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
  },
  viewerPlayer: {
    width: "100%",
    aspectRatio: 9 / 16,
    backgroundColor: "#000",
  },
  viewerActions: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.78)",
  },
  viewerBtn: {
    width: "100%",
  },
  error: {
    marginTop: 8,
    color: "#ff7070",
  },
});
