import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { humanizeVideoError, mapVideoStatusToClientLabel } from "../../src/services/videoEditorPresenter";
import { fetchVideo, getDownloadUrl, submitVideoEditJob, type AiEditMode, type VideoItem } from "../../src/services/videoEditorApi";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";

const MAX_VIDEO_SECONDS = 300;
const ACCEPTED_EXTENSIONS = [".mp4", ".mov"];

type PickedVideo = {
  uri: string;
  name: string;
  mimeType: string;
  durationSeconds: number;
  sizeBytes?: number;
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

export default function VideoEditorIaScreen() {
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [aiMode, setAiMode] = useState<AiEditMode>("cut_captions");
  const [stylePrompt, setStylePrompt] = useState("");

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
    if (!hasRemoteEditor || !video || !videoApiBase) return;
    if (video.status !== "QUEUED" && video.status !== "PROCESSING") return;

    const timer = setInterval(() => {
      void fetchVideo(videoApiBase, video.id)
        .then((current) => setVideo(current))
        .catch((refreshError) => {
          const message = refreshError instanceof Error ? refreshError.message : "Nao foi possivel atualizar o status.";
          setError(humanizeVideoError(message));
        });
    }, 2000);

    return () => clearInterval(timer);
  }, [hasRemoteEditor, video, videoApiBase]);

  const applyPicked = (asset: { uri: string; fileName?: string | null; mimeType?: string | null; duration?: number | null; fileSize?: number | null }) => {
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

    setPicked({
      uri: asset.uri,
      name: guessedName,
      mimeType: asset.mimeType || "video/mp4",
      durationSeconds,
      sizeBytes: typeof asset.fileSize === "number" ? asset.fileSize : undefined,
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
      applyPicked({
        uri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType,
        fileSize: file.size,
      });
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
      applyPicked(result.assets[0]);
    } catch (pickError) {
      if (isIosPhotos3164(pickError)) {
        await pickVideoWithDocumentPicker();
        return;
      }
      setError(pickerErrorMessage(pickError));
    }
  };

  const submit = async () => {
    if (!picked || submitting || !videoApiBase) return;
    setSubmitting(true);
    setError(null);
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

  const buildFileName = (url: string) => {
    const match = url.match(/\/([^/?#]+\.mp4)(?:[?#]|$)/i);
    if (match?.[1]) return match[1];
    return `video_${Date.now()}.mp4`;
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

  const stageColor = (key: string) => {
    if (stage === "failed") return key === "failed" ? "#ff6f6f" : "#7f8695";
    if (key === stage) return "#57ef2f";
    if (key === "failed") return "#7f8695";
    return "#9ba4b5";
  };

  return (
    <Screen plain style={styles.screen}>
      <LinearGradient colors={["#07090f", "#0a0d17", "#07090f"]} style={styles.bg}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={styles.header}>
            <Text style={styles.title}>Edite de forma facil com IA!</Text>
            <Text style={styles.subtitle}>Envie seu video e escolha como a IA deve edita-lo de forma rapida e automatica.</Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Escolha o video</Text>
            <TouchableOpacity style={styles.greenButton} activeOpacity={0.9} onPress={() => void pickVideoFromLibrary()} disabled={submitting}>
              <Ionicons name="play-circle" size={23} color="#0c2106" />
              <Text style={styles.greenButtonText}>{submitting ? "Enviando..." : "Enviar video"}</Text>
            </TouchableOpacity>
            <TouchableOpacity activeOpacity={0.9} onPress={() => void pickVideoWithDocumentPicker()}>
              <Text style={styles.fallback}>Escolher arquivo (fallback)</Text>
            </TouchableOpacity>
            {picked ? (
              <Text style={styles.meta}>Arquivo: {picked.name} · {picked.durationSeconds > 0 ? `${picked.durationSeconds.toFixed(1)}s` : "duracao nao detectada"}</Text>
            ) : null}
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Escolha o tipo de edicao</Text>
            <View style={styles.modeRow}>
              <TouchableOpacity style={[styles.modeChip, aiMode === "cut" ? styles.modeChipActive : null]} onPress={() => setAiMode("cut")}>
                <Text style={[styles.modeChipText, aiMode === "cut" ? styles.modeChipTextActive : null]}>Corte</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modeChip, aiMode === "cut_captions" ? styles.modeChipActive : null]}
                onPress={() => setAiMode("cut_captions")}
              >
                <Text style={[styles.modeChipText, aiMode === "cut_captions" ? styles.modeChipTextActive : null]}>Corte + Legenda</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.help}>A IA remove pausas e adiciona legendas automaticas no video.</Text>
            <Text style={styles.label}>Instrucao opcional de estilo</Text>
            <TextInput
              style={styles.input}
              value={stylePrompt}
              onChangeText={setStylePrompt}
              placeholder="Ex.: estilo dinamico e direto"
              placeholderTextColor="#70798a"
            />
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Status da edicao</Text>
            <Text style={styles.statusText}>{mapVideoStatusToClientLabel(video?.status, progress)}</Text>
            <View style={styles.timeline}>
              <Text style={[styles.timelineText, { color: stageColor("prepare") }]}>Preparar</Text>
              <Text style={[styles.timelineText, { color: stageColor("edit") }]}>Editando</Text>
              <Text style={[styles.timelineText, { color: stageColor("deliver") }]}>Entregar</Text>
              <Text style={[styles.timelineText, { color: stageColor("done") }]}>Pronto</Text>
            </View>
            {video?.status === "PROCESSING" ? <Text style={styles.meta}>{Math.max(1, Math.round(progress * 100))}% concluido</Text> : null}
          </View>

          <TouchableOpacity
            style={[styles.cta, !picked || submitting || !hasRemoteEditor ? styles.ctaDisabled : null]}
            activeOpacity={0.9}
            onPress={() => void submit()}
            disabled={!picked || submitting || !hasRemoteEditor}
          >
            {submitting ? <ActivityIndicator color="#0e2b09" /> : <MaterialCommunityIcons name="robot-outline" size={25} color="#0e2b09" />}
            <Text style={styles.ctaText}>{submitting ? "Iniciando..." : "Iniciar edicao com IA"}</Text>
            <Ionicons name="chevron-forward" size={24} color="#0e2b09" />
          </TouchableOpacity>

          {video?.status === "COMPLETE" ? (
            <View style={styles.completeActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => void openViewer()}>
                <Text style={styles.secondaryBtnText}>Ver video no app</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => void downloadInsideApp()} disabled={Boolean(downloadingUrl)}>
                <Text style={styles.secondaryBtnText}>{downloadingUrl ? "Baixando..." : "Baixar no app"}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!hasRemoteEditor ? <Text style={styles.error}>Editor de video indisponivel neste ambiente.</Text> : null}
        </ScrollView>
      </LinearGradient>

      <Modal visible={Boolean(viewerUrl)} animationType="slide" transparent={false} onRequestClose={() => setViewerUrl(null)}>
        <View style={styles.viewerWrap}>
          {viewerUrl ? <Video source={{ uri: viewerUrl }} style={styles.viewerPlayer} useNativeControls resizeMode={ResizeMode.CONTAIN} isLooping={false} /> : null}
          <View style={styles.viewerActions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => void downloadInsideApp()}>
              <Text style={styles.secondaryBtnText}>{downloadingUrl ? "Baixando..." : "Baixar no app"}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={() => setViewerUrl(null)}>
              <Text style={styles.secondaryBtnText}>Fechar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bg: { flex: 1 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 40,
    gap: 14,
  },
  header: {
    gap: 8,
  },
  title: {
    color: "#eef2f8",
    fontSize: 42,
    lineHeight: 44,
    letterSpacing: -0.6,
    fontFamily: realTheme.fonts.title,
  },
  subtitle: {
    color: "#afb7c5",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  block: {
    borderRadius: 23,
    backgroundColor: "rgba(12,16,24,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    padding: 14,
    gap: 8,
  },
  blockTitle: {
    color: "#f0f3f8",
    fontSize: 22,
    lineHeight: 27,
    fontFamily: realTheme.fonts.bodyBold,
    letterSpacing: -0.4,
  },
  greenButton: {
    marginTop: 2,
    borderRadius: 999,
    backgroundColor: "#57ef2f",
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  greenButtonText: {
    color: "#0c2106",
    fontSize: 24,
    fontFamily: realTheme.fonts.bodyBold,
    letterSpacing: -0.3,
  },
  fallback: {
    color: "#a7b1c1",
    fontSize: 12,
    textDecorationLine: "underline",
  },
  meta: {
    color: "#93a0b5",
    fontSize: 12,
    lineHeight: 17,
  },
  modeRow: {
    flexDirection: "row",
    gap: 10,
  },
  modeChip: {
    flex: 1,
    minHeight: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(22,27,39,0.92)",
  },
  modeChipActive: {
    backgroundColor: "rgba(87,239,47,0.24)",
    borderColor: "rgba(87,239,47,0.72)",
  },
  modeChipText: {
    color: "#c6cdd9",
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  modeChipTextActive: {
    color: "#ddffe0",
  },
  help: {
    color: "#a7b0be",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
  label: {
    color: "#e7ebf1",
    fontSize: 14,
    fontFamily: realTheme.fonts.bodySemiBold,
    marginTop: 4,
  },
  input: {
    minHeight: 50,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(18,22,30,0.96)",
    paddingHorizontal: 12,
    color: "#edf1f6",
    fontFamily: realTheme.fonts.bodyRegular,
  },
  statusText: {
    color: "#cdd5e1",
    fontSize: 13,
    lineHeight: 18,
  },
  timeline: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 2,
  },
  timelineText: {
    fontSize: 12,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  cta: {
    borderRadius: 999,
    backgroundColor: "#57ef2f",
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    shadowColor: "#53ef2b",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  ctaDisabled: {
    opacity: 0.5,
  },
  ctaText: {
    color: "#0d2507",
    fontSize: 18,
    fontFamily: realTheme.fonts.bodyBold,
  },
  completeActions: {
    gap: 8,
  },
  secondaryBtn: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(15,19,27,0.95)",
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryBtnText: {
    color: "#dce3ed",
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  error: {
    color: "#ff7f7f",
    fontSize: 12,
    lineHeight: 17,
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
});
