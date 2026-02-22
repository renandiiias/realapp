import { ResizeMode, Video } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, View } from "react-native";
import { humanizeVideoError, mapVideoStatusToClientLabel } from "../../src/services/videoEditorPresenter";
import {
  fetchVideo,
  getDownloadUrl,
  submitVideoEditJob,
  type AiEditMode,
  type VideoItem,
} from "../../src/services/videoEditorApi";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Chip } from "../../src/ui/components/Chip";
import { Field } from "../../src/ui/components/Field";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

const MAX_VIDEO_SECONDS = 300;
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

function hasAcceptedExtension(name: string): boolean {
  const lowered = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lowered.endsWith(ext));
}

function modeDescription(mode: AiEditMode): string {
  if (mode === "cut") {
    return "A IA remove pausas e entrega um video curto e objetivo.";
  }
  return "A IA faz os cortes e aplica legenda automatica em portugues.";
}

function stageFromVideo(video: VideoItem | null): "prepare" | "edit" | "deliver" | "done" | "failed" {
  if (!video) return "prepare";
  if (video.status === "QUEUED") return "prepare";
  if (video.status === "PROCESSING") {
    if ((video.progress || 0) >= 0.85) return "deliver";
    return "edit";
  }
  if (video.status === "COMPLETE") return "done";
  return "failed";
}

export default function VideoEditorCreateScreen() {
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [aiMode, setAiMode] = useState<AiEditMode>("cut_captions");
  const [stylePrompt, setStylePrompt] = useState("");

  const [video, setVideo] = useState<VideoItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [compatibilityNotice, setCompatibilityNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const videoApiBase = useMemo(() => {
    const raw = process.env.EXPO_PUBLIC_VIDEO_EDITOR_API_BASE_URL?.trim() ?? "";
    return raw ? raw.replace(/\/+$/, "") : "";
  }, []);
  const hasRemoteEditor = Boolean(videoApiBase);
  const manualEnabled = String(process.env.EXPO_PUBLIC_VIDEO_EDITOR_MANUAL_ENABLED || "true").toLowerCase() === "true";

  useEffect(() => {
    if (!hasRemoteEditor || !video || !videoApiBase) return;
    if (video.status !== "QUEUED" && video.status !== "PROCESSING") return;

    const timer = setInterval(() => {
      void fetchVideo(videoApiBase, video.id)
        .then((current) => {
          setVideo(current);
        })
        .catch((refreshError) => {
          const message = refreshError instanceof Error ? refreshError.message : "Nao foi possivel atualizar o status.";
          setError(humanizeVideoError(message));
        });
    }, 2000);

    return () => clearInterval(timer);
  }, [hasRemoteEditor, video, videoApiBase]);

  const canSubmit = Boolean(picked) && !submitting && hasRemoteEditor;
  const runSafe = (task: () => Promise<void>) => {
    void task().catch((taskError) => {
      setError(pickerErrorMessage(taskError));
    });
  };

  const applyPicked = (
    asset: {
      uri: string;
      fileName?: string | null;
      mimeType?: string | null;
      duration?: number | null;
      fileSize?: number | null;
      width?: number;
      height?: number;
    },
    source: "gallery" | "camera",
  ) => {
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
    setCompatibilityNotice(null);
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

  const submit = async () => {
    if (!picked || submitting) return;
    if (!hasRemoteEditor || !videoApiBase) {
      setError("Editor de video indisponivel neste ambiente agora.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setCompatibilityNotice(null);

    try {
      const created = await submitVideoEditJob({
        baseUrl: videoApiBase,
        file: {
          uri: picked.uri,
          name: picked.name,
          type: picked.mimeType,
        },
        mode: aiMode,
        instructions: stylePrompt,
      });
      setVideo(created.video);
      if (created.compatibilityMode) {
        setCompatibilityNotice(
          aiMode === "cut"
            ? "Modo aplicado com compatibilidade do servidor. Neste ambiente, o resultado pode incluir legenda."
            : "Modo aplicado com compatibilidade do servidor.",
        );
      }
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Nao foi possivel iniciar a edicao.";
      setError(humanizeVideoError(message));
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
      setError(humanizeVideoError(message));
    }
  };

  const refreshStatus = async () => {
    if (!video || !videoApiBase) return;
    setRefreshing(true);
    try {
      const current = await fetchVideo(videoApiBase, video.id);
      setVideo(current);
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : "Nao foi possivel atualizar o status.";
      setError(humanizeVideoError(message));
    } finally {
      setRefreshing(false);
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
      setError(humanizeVideoError(message));
    } finally {
      setDownloadingUrl(null);
    }
  };

  const stage = stageFromVideo(video);
  const progress = Math.max(0, Math.min(1, video?.progress ?? 0));

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <Kicker>Editor de video</Kicker>
          <Title>Edite com IA em poucos toques</Title>
          <Body>Envie seu video e escolha como a IA deve editar.</Body>
        </Card>

        <Card>
          <SubTitle>Escolha o video</SubTitle>
          <View style={styles.actions}>
            <Button label="Enviar video" onPress={() => runSafe(pickVideoFromLibrary)} style={styles.action} disabled={submitting} />
          </View>
          {picked ? (
            <View style={styles.pickedMeta}>
              <Body>Arquivo: {picked.name}</Body>
              <Body>Duracao: {picked.durationSeconds > 0 ? `${picked.durationSeconds.toFixed(2)}s` : "nao detectada"}</Body>
              <Body>Origem: {picked.source === "camera" ? "Camera" : "Galeria"}</Body>
              {picked.sizeBytes ? <Body>Tamanho: {(picked.sizeBytes / (1024 * 1024)).toFixed(1)}MB</Body> : null}
            </View>
          ) : null}
        </Card>

        <Card>
          <SubTitle>Editar com IA</SubTitle>
          <View style={styles.modeRow}>
            <Chip label="Corte" active={aiMode === "cut"} onPress={() => setAiMode("cut")} />
            <Chip label="Corte + Legenda" active={aiMode === "cut_captions"} onPress={() => setAiMode("cut_captions")} />
          </View>
          <Body style={styles.hint}>{modeDescription(aiMode)}</Body>
          <Field
            label="Instrucao de estilo (opcional)"
            value={stylePrompt}
            onChangeText={setStylePrompt}
            placeholder="Ex.: ritmo mais dinamico e foco nos pontos principais"
            multiline
          />
        </Card>

        <Card>
          <SubTitle>Status da edicao</SubTitle>
          <Body style={styles.statusMain}>{mapVideoStatusToClientLabel(video?.status, progress)}</Body>
          {video?.status === "PROCESSING" ? <Body style={styles.hint}>{Math.max(1, Math.round(progress * 100))}% concluido</Body> : null}
          {video?.status === "FAILED" && video.error?.message ? <Body style={styles.error}>{humanizeVideoError(video.error.message)}</Body> : null}
          <View style={styles.timeline}>
            <Body style={stage === "prepare" ? styles.timelineActive : styles.timelineItem}>Preparar</Body>
            <Body style={stage === "edit" ? styles.timelineActive : styles.timelineItem}>Editar</Body>
            <Body style={stage === "deliver" ? styles.timelineActive : styles.timelineItem}>Entregar</Body>
            <Body style={stage === "done" ? styles.timelineActive : stage === "failed" ? styles.timelineFailed : styles.timelineItem}>
              {stage === "failed" ? "Falha" : "Pronto"}
            </Body>
          </View>
          {compatibilityNotice ? <Body style={styles.compatibility}>{compatibilityNotice}</Body> : null}
          {video?.status === "COMPLETE" ? (
            <View style={styles.completeActions}>
              <Button label="Ver video no app" onPress={() => void openViewer()} variant="secondary" style={styles.downloadButton} />
              <Button
                label={downloadingUrl ? "Baixando..." : "Baixar no app"}
                onPress={() => void downloadInsideApp()}
                disabled={Boolean(downloadingUrl)}
                style={styles.downloadButton}
              />
              <Button
                label={refreshing ? "Atualizando..." : "Atualizar status"}
                onPress={() => void refreshStatus()}
                disabled={refreshing}
                variant="secondary"
                style={styles.downloadButton}
              />
              {manualEnabled ? <Body style={styles.hint}>Para ajuste manual: Criar -> Editor manual separado.</Body> : null}
            </View>
          ) : null}
        </Card>

        <Card>
          {submitting ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={realTheme.colors.green} />
              <Body>Iniciando edicao...</Body>
            </View>
          ) : (
            <Button label="Editar com IA" onPress={() => void submit()} disabled={!canSubmit} />
          )}
          {!hasRemoteEditor ? <Body style={styles.hint}>Editor de video indisponivel neste ambiente agora.</Body> : null}
          {error ? <Body style={styles.error}>{error}</Body> : null}
        </Card>
      </ScrollView>

      <Modal visible={Boolean(viewerUrl)} animationType="slide" transparent={false} onRequestClose={() => setViewerUrl(null)}>
        <View style={styles.viewerWrap}>
          {viewerUrl ? <Video source={{ uri: viewerUrl }} style={styles.viewerPlayer} useNativeControls resizeMode={ResizeMode.CONTAIN} isLooping={false} /> : null}
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
  modeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 4,
  },
  hint: {
    marginTop: 6,
    color: realTheme.colors.muted,
  },
  compatibility: {
    marginTop: 8,
    color: "#d7e8bf",
  },
  loadingWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusMain: {
    color: realTheme.colors.text,
    marginTop: 6,
    marginBottom: 4,
  },
  timeline: {
    flexDirection: "row",
    justifyContent: "space-between",
    flexWrap: "wrap",
    rowGap: 6,
    marginTop: 8,
    marginBottom: 6,
  },
  timelineItem: {
    color: realTheme.colors.muted,
    fontSize: 13,
  },
  timelineActive: {
    color: realTheme.colors.green,
    fontSize: 13,
  },
  timelineFailed: {
    color: "#ff7070",
    fontSize: 13,
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
