import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { LinearGradient } from "expo-linear-gradient";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { createManualEditorSession, fetchVideo, submitManualSourceJob, type VideoItem } from "../../src/services/videoEditorApi";
import { humanizeVideoError, mapVideoStatusToClientLabel } from "../../src/services/videoEditorPresenter";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";

const MAX_VIDEO_SECONDS = 300;
const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".m4v"];

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

function hasAcceptedExtension(name: string): boolean {
  const lowered = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lowered.endsWith(ext));
}

function pickerErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/PHPhotosErrorDomain/i.test(raw) && /3164/.test(raw)) {
    return "Nao consegui abrir esse video da galeria agora. Tente novamente em alguns segundos.";
  }
  return "Falha ao abrir video da galeria.";
}

function isIosPhotos3164(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return /PHPhotosErrorDomain/i.test(raw) && /3164/.test(raw);
}

function stageFromVideo(video: VideoItem | null): "prepare" | "process" | "done" | "failed" {
  if (!video) return "prepare";
  if (video.status === "QUEUED") return "prepare";
  if (video.status === "PROCESSING") return "process";
  if (video.status === "COMPLETE") return "done";
  return "failed";
}

export default function VideoEditorManualHubScreen() {
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [video, setVideo] = useState<VideoItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [openingEditor, setOpeningEditor] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const pickVideoWithDocumentPicker = async (): Promise<boolean> => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "video/*",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return false;
      const file = result.assets[0];
      applyPicked({
        uri: file.uri,
        fileName: file.name,
        mimeType: file.mimeType,
        fileSize: file.size,
      });
      return true;
    } catch (pickError) {
      setError(pickerErrorMessage(pickError));
      return false;
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
        mediaTypes: ["videos"],
        quality: 1,
        allowsEditing: false,
        allowsMultipleSelection: false,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
      });
      if (result.canceled) return;
      if (!result.assets?.[0]) {
        const fallbackOk = await pickVideoWithDocumentPicker();
        if (!fallbackOk) setError("Nao foi possivel carregar da galeria. Tente novamente pelo fallback.");
        return;
      }
      applyPicked(result.assets[0]);
    } catch (pickError) {
      const fallbackOk = await pickVideoWithDocumentPicker();
      if (fallbackOk) return;
      if (isIosPhotos3164(pickError)) {
        setError("Nao consegui abrir esse video da galeria. Use o fallback para arquivos do iCloud.");
        return;
      }
      setError(pickerErrorMessage(pickError));
    }
  };

  const pickVideoSmart = async () => {
    await pickVideoFromLibrary();
  };

  const submitManualSource = async () => {
    if (!picked || submitting || !videoApiBase) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await submitManualSourceJob({
        baseUrl: videoApiBase,
        file: {
          uri: picked.uri,
          name: picked.name,
          type: picked.mimeType,
        },
      });
      setVideo(created);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Nao foi possivel preparar o video para edicao manual.";
      setError(humanizeVideoError(message));
    } finally {
      setSubmitting(false);
    }
  };

  const openManualEditor = async () => {
    if (!videoApiBase || !video || video.status !== "COMPLETE" || openingEditor) return;
    setOpeningEditor(true);
    setError(null);
    try {
      const session = await createManualEditorSession(videoApiBase, video.id);
      router.push({
        pathname: "/create/video-editor-manual",
        params: {
          editorUrl: session.editorUrl,
          baseVideoId: video.id,
          apiBase: videoApiBase,
        },
      });
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : "Nao foi possivel abrir o editor manual.";
      setError(humanizeVideoError(message));
    } finally {
      setOpeningEditor(false);
    }
  };

  const progress = Math.max(0, Math.min(1, video?.progress ?? 0));
  const stage = stageFromVideo(video);
  const statusLabel = video ? mapVideoStatusToClientLabel(video.status, progress) : picked ? "Video carregado. Toque em preparar." : "Aguardando envio do video.";

  return (
    <Screen plain style={styles.screen}>
      <LinearGradient colors={["#07090f", "#0a0d17", "#07090f"]} style={styles.bg}>
        <View style={styles.glowTop} />
        <View style={styles.glowMiddle} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>Edite sozinho com nivel pro</Text>
            <Text style={styles.subtitle}>Envie da galeria, prepare e abra o editor visual sem sair do app.</Text>
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Escolha o video</Text>
            <TouchableOpacity style={styles.greenButton} activeOpacity={0.9} onPress={() => void pickVideoSmart()} disabled={submitting}>
              <Ionicons name="play-circle" size={22} color="#0c2106" />
              <Text style={styles.greenButtonText}>Enviar video</Text>
            </TouchableOpacity>
            {picked ? (
              <Text style={styles.meta}>
                Arquivo: {picked.name} · {picked.durationSeconds > 0 ? `${picked.durationSeconds.toFixed(1)}s` : "duracao nao detectada"}
              </Text>
            ) : null}
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Status da edicao</Text>
            <Text style={styles.status}>{statusLabel}</Text>
            {video?.status === "PROCESSING" ? <Text style={styles.meta}>{Math.max(1, Math.round(progress * 100))}% concluido</Text> : null}
            <View style={styles.timelineRow}>
              <Text style={[styles.timelineText, stage === "prepare" ? styles.timelineActive : null]}>Preparar</Text>
              <Text style={[styles.timelineText, stage === "process" ? styles.timelineActive : null]}>Processar</Text>
              <Text style={[styles.timelineText, stage === "done" ? styles.timelineActive : null]}>Pronto</Text>
              <Text style={[styles.timelineText, stage === "failed" ? styles.timelineFailed : null]}>Falha</Text>
            </View>
            <TouchableOpacity
              style={[styles.cta, !picked || submitting || !hasRemoteEditor ? styles.ctaDisabled : null]}
              activeOpacity={0.9}
              onPress={() => void submitManualSource()}
              disabled={!picked || submitting || !hasRemoteEditor}
            >
              {submitting ? <ActivityIndicator color="#0d2507" /> : <MaterialCommunityIcons name="movie-open-cog-outline" size={24} color="#0d2507" />}
              <Text style={styles.ctaText}>{submitting ? "Preparando..." : "Preparar para editor manual"}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.block}>
            <Text style={styles.blockTitle}>Editar sozinho</Text>
            <Text style={styles.help}>Depois de pronto, abra o editor visual para ajustar cortes com liberdade.</Text>
            <TouchableOpacity
              style={[styles.cta, !video || video.status !== "COMPLETE" || openingEditor ? styles.ctaDisabled : null]}
              activeOpacity={0.9}
              onPress={() => void openManualEditor()}
              disabled={!video || video.status !== "COMPLETE" || openingEditor}
            >
              {openingEditor ? <ActivityIndicator color="#0d2507" /> : <MaterialCommunityIcons name="wand-sparkles" size={24} color="#0d2507" />}
              <Text style={styles.ctaText}>{openingEditor ? "Abrindo..." : "Abrir editor visual"}</Text>
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {!hasRemoteEditor ? <Text style={styles.error}>Backend de video nao configurado neste ambiente.</Text> : null}
        </ScrollView>
      </LinearGradient>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bg: { flex: 1 },
  glowTop: {
    position: "absolute",
    top: -120,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(64,232,31,0.13)",
  },
  glowMiddle: {
    position: "absolute",
    top: 220,
    left: -130,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(42,93,239,0.08)",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 42,
    gap: 14,
  },
  header: {
    gap: 9,
    marginBottom: 2,
  },
  title: {
    color: "#f2f4f8",
    fontSize: 44,
    lineHeight: 48,
    letterSpacing: -0.7,
    fontFamily: realTheme.fonts.title,
  },
  subtitle: {
    color: "#b2bac8",
    fontSize: 14,
    lineHeight: 21,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  block: {
    borderRadius: 24,
    backgroundColor: "rgba(12,16,24,0.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    padding: 15,
    gap: 9,
  },
  blockTitle: {
    color: "#f4f6fa",
    fontSize: 22,
    lineHeight: 27,
    fontFamily: realTheme.fonts.bodyBold,
    letterSpacing: -0.3,
  },
  greenButton: {
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
    fontSize: 20,
    fontFamily: realTheme.fonts.bodyBold,
    letterSpacing: -0.3,
  },
  secondary: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(15,19,27,0.95)",
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryText: {
    color: "#dce3ed",
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 14,
  },
  status: {
    color: "#f2f5fa",
    fontSize: 15,
    lineHeight: 21,
    fontFamily: realTheme.fonts.bodyBold,
  },
  timelineRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    marginTop: 2,
  },
  timelineText: {
    color: "#8f98aa",
    fontSize: 14,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  timelineActive: {
    color: "#5cf031",
  },
  timelineFailed: {
    color: "#ff7979",
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
  help: {
    color: "#aeb6c4",
    fontSize: 13,
    lineHeight: 19,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  meta: {
    color: "#93a0b5",
    fontSize: 12,
    lineHeight: 17,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  error: {
    color: "#ff7f7f",
    fontSize: 12,
    lineHeight: 17,
    fontFamily: realTheme.fonts.bodyRegular,
  },
});
