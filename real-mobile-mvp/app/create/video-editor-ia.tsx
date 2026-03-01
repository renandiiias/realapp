import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import { Redirect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { canAccessInternalPreviews } from "../../src/auth/accessControl";
import { useAuth } from "../../src/auth/AuthProvider";
import { makeClientTraceId, sanitizeUri, sendVideoClientLog } from "../../src/services/videoEditorDebugLog";
import { fetchVideo, getDownloadUrl, submitVideoEditJob, type AiEditMode, type VideoItem } from "../../src/services/videoEditorApi";
import { pickVideoWithRecovery } from "../../src/services/videoPickerRecovery";
import { humanizeVideoError } from "../../src/services/videoEditorPresenter";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";

const MAX_VIDEO_SECONDS = 300;
const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".m4v"];

type FunnelStep = "upload" | "mode" | "style" | "processing" | "done";

type PickedVideo = {
  uri: string;
  name: string;
  mimeType: string;
  durationSeconds: number;
  sizeBytes?: number;
};

type SubtitleFontOption = {
  id: string;
  label: string;
  style: {
    fontFamily?: string;
    fontWeight?: "400" | "500" | "600" | "700";
    letterSpacing?: number;
  };
};

const SUBTITLE_FONT_OPTIONS: SubtitleFontOption[] = [
  { id: "Montserrat", label: "Montserrat", style: { fontFamily: realTheme.fonts.bodyBold } },
  { id: "DM Serif Display", label: "DM Serif Display", style: { fontFamily: realTheme.fonts.title } },
  { id: "Poppins", label: "Poppins", style: { fontFamily: "System", fontWeight: "600" } },
  { id: "Bebas Neue", label: "Bebas Neue", style: { fontFamily: "System", fontWeight: "700", letterSpacing: 0.8 } },
];

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
    return "Nao consegui abrir esse video da galeria agora. Tente novamente em alguns segundos.";
  }
  return "Falha ao abrir video da galeria.";
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
  const auth = useAuth();
  const hasInternalPreviewAccess = canAccessInternalPreviews(auth.userEmail);
  const [flowTraceId, setFlowTraceId] = useState(() => makeClientTraceId("ia"));
  const [funnelStep, setFunnelStep] = useState<FunnelStep>("upload");

  const [pickingVideo, setPickingVideo] = useState(false);
  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [aiMode, setAiMode] = useState<AiEditMode>("cut_captions");

  const [subtitleFont, setSubtitleFont] = useState("Montserrat");
  const [subtitleColor, setSubtitleColor] = useState("#57ef2f");

  const [video, setVideo] = useState<VideoItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);
  const [magicTick, setMagicTick] = useState(0);

  const videoApiBase = useMemo(() => {
    const raw = process.env.EXPO_PUBLIC_VIDEO_EDITOR_API_BASE_URL?.trim() ?? "";
    return raw ? raw.replace(/\/+$/, "") : "";
  }, []);
  const hasRemoteEditor = Boolean(videoApiBase);

  useEffect(() => {
    if (!hasRemoteEditor || !video || !videoApiBase) return;
    if (video.status !== "QUEUED" && video.status !== "PROCESSING") return;

    const timer = setInterval(() => {
      void fetchVideo(videoApiBase, video.id, flowTraceId)
        .then((current) => setVideo(current))
        .catch((refreshError) => {
          const message = refreshError instanceof Error ? refreshError.message : "Nao foi possivel atualizar o status.";
          setError(humanizeVideoError(message));
          void sendVideoClientLog({
            baseUrl: videoApiBase,
            traceId: flowTraceId,
            stage: "poll",
            event: "status_refresh_failed",
            level: "error",
            meta: { video_id: video.id, message },
          });
        });
    }, 2000);

    return () => clearInterval(timer);
  }, [hasRemoteEditor, video, videoApiBase, flowTraceId]);

  useEffect(() => {
    if (video?.status === "COMPLETE") setFunnelStep("done");
  }, [video?.status]);

  useEffect(() => {
    if (!(submitting || video?.status === "QUEUED" || video?.status === "PROCESSING")) return;
    const timer = setInterval(() => setMagicTick((v) => v + 1), 900);
    return () => clearInterval(timer);
  }, [submitting, video?.status]);

  const applyPicked = (
    asset: { uri: string; fileName?: string | null; mimeType?: string | null; duration?: number | null; fileSize?: number | null },
    traceId = flowTraceId,
  ) => {
    const durationSeconds = normalizeDuration(asset.duration);
    void sendVideoClientLog({
      baseUrl: videoApiBase,
      traceId,
      stage: "picker",
      event: "asset_received",
      meta: {
        uri: sanitizeUri(asset.uri),
        file_name: asset.fileName || null,
        mime: asset.mimeType || null,
        duration_seconds: durationSeconds,
        size_bytes: asset.fileSize ?? null,
      },
    });

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
    setFunnelStep("mode");
  };

  const pickVideoFromLibrary = async () => {
    if (pickingVideo || submitting) return;
    setPickingVideo(true);
    setError(null);
    const nextTraceId = makeClientTraceId("ia");
    setFlowTraceId(nextTraceId);

    try {
      void sendVideoClientLog({ baseUrl: videoApiBase, traceId: nextTraceId, stage: "picker", event: "image_library_permission_request_start" });
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: nextTraceId,
        stage: "picker",
        event: "image_library_permission_result",
        meta: { granted: permission.granted, canAskAgain: permission.canAskAgain, status: permission.status },
      });
      if (!permission.granted) {
        setError("Permissao de galeria negada.");
        return;
      }

      void sendVideoClientLog({ baseUrl: videoApiBase, traceId: nextTraceId, stage: "picker", event: "image_library_open_start" });
      const recovered = await pickVideoWithRecovery({
        traceId: nextTraceId,
        log: ({ event, level, meta }) =>
          sendVideoClientLog({
            baseUrl: videoApiBase,
            traceId: nextTraceId,
            stage: "picker",
            event,
            level,
            meta: meta ?? {},
          }),
      });
      if (!recovered) {
        return;
      }
      applyPicked(
        {
          uri: recovered.uri,
          fileName: recovered.fileName,
          mimeType: recovered.mimeType,
          duration: recovered.duration,
          fileSize: recovered.fileSize,
        },
        nextTraceId,
      );
    } catch (pickError) {
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: nextTraceId,
        stage: "picker",
        event: "image_library_failed_after_recovery",
        level: "warn",
        meta: { raw_error: pickError instanceof Error ? pickError.message : String(pickError ?? "") },
      });
      setError(pickerErrorMessage(pickError));
    } finally {
      setPickingVideo(false);
    }
  };

  const pickVideoSmart = async () => {
    await pickVideoFromLibrary();
  };

  const submit = async () => {
    if (!picked || submitting || !videoApiBase) return;
    setSubmitting(true);
    setError(null);
    setFunnelStep("processing");

    const styleInstruction =
      aiMode === "cut_captions"
        ? `Legendas premium: fonte=${subtitleFont}; cor=${subtitleColor}; contraste_alto=true; legibilidade_maxima=true`
        : "";

    try {
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "upload",
        event: "submit_video_edit_start",
        meta: {
          mode: aiMode,
          uri: sanitizeUri(picked.uri),
          file_name: picked.name,
          mime: picked.mimeType,
          size_bytes: picked.sizeBytes ?? null,
          subtitle_font: subtitleFont,
          subtitle_color: subtitleColor,
        },
      });

      const created = await submitVideoEditJob({
        baseUrl: videoApiBase,
        file: { uri: picked.uri, name: picked.name, type: picked.mimeType },
        mode: aiMode,
        instructions: styleInstruction,
        traceId: flowTraceId,
      });

      setVideo(created.video);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Nao foi possivel iniciar a edicao.";
      setError(humanizeVideoError(message));
      setFunnelStep(aiMode === "cut_captions" ? "style" : "mode");
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "upload",
        event: "submit_video_edit_failed",
        level: "error",
        meta: { message },
      });
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

  const magicMessages = [
    "Lendo ritmo e energia do video...",
    "Cortando pausas com inteligencia...",
    "Refinando transicoes para mais impacto...",
    "Aplicando legenda no estilo escolhido...",
    "Finalizando render com qualidade social...",
  ];

  const previewFontStyle = useMemo(() => {
    const selected = SUBTITLE_FONT_OPTIONS.find((font) => font.id === subtitleFont);
    return selected?.style ?? { fontFamily: realTheme.fonts.bodyBold };
  }, [subtitleFont]);

  if (!hasInternalPreviewAccess) {
    return <Redirect href="/create/ads" />;
  }

  return (
    <Screen plain style={styles.screen}>
      <LinearGradient colors={["#07090f", "#0a0d17", "#07090f"]} style={styles.bg}>
        <View style={styles.bgOrnamentA} />
        <View style={styles.bgOrnamentB} />

        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>Edicao com IA, nivel pro</Text>
            <Text style={styles.subtitle}>Fluxo inteligente para gerar resultado rapido, bonito e pronto para publicar.</Text>
          </View>

          <View style={styles.funnelRow}>
            <Text style={[styles.funnelStep, funnelStep === "upload" ? styles.funnelStepActive : null]}>1 Upload</Text>
            <Text style={[styles.funnelStep, funnelStep === "mode" ? styles.funnelStepActive : null]}>2 Modo</Text>
            <Text style={[styles.funnelStep, funnelStep === "style" ? styles.funnelStepActive : null]}>3 Legenda</Text>
            <Text style={[styles.funnelStep, funnelStep === "processing" ? styles.funnelStepActive : null]}>4 Magia</Text>
            <Text style={[styles.funnelStep, funnelStep === "done" ? styles.funnelStepActive : null]}>5 Pronto</Text>
          </View>

          {(funnelStep === "upload" || !picked) && (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Escolha o video</Text>
              <TouchableOpacity style={styles.greenButton} activeOpacity={0.9} onPress={() => void pickVideoSmart()} disabled={submitting || pickingVideo}>
                {pickingVideo ? <ActivityIndicator color="#0c2106" /> : <Ionicons name="play-circle" size={23} color="#0c2106" />}
                <Text style={styles.greenButtonText}>{submitting ? "Enviando..." : pickingVideo ? "Abrindo galeria..." : "Enviar video"}</Text>
              </TouchableOpacity>
              {picked ? <Text style={styles.meta}>Arquivo: {picked.name}</Text> : null}
            </View>
          )}

          {picked && funnelStep === "mode" && (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Escolha o tipo de edicao</Text>
              <View style={styles.modeRow}>
                <TouchableOpacity style={[styles.modeChip, aiMode === "cut" ? styles.modeChipActive : null]} onPress={() => setAiMode("cut")}>
                  <Text style={[styles.modeChipText, aiMode === "cut" ? styles.modeChipTextActive : null]}>Corte</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.modeChip, aiMode === "cut_captions" ? styles.modeChipActive : null]} onPress={() => setAiMode("cut_captions")}>
                  <Text style={[styles.modeChipText, aiMode === "cut_captions" ? styles.modeChipTextActive : null]}>Corte + Legendas</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.help}>Corte + legendas abre configuracao de estilo antes do processamento.</Text>
              <TouchableOpacity
                style={styles.cta}
                onPress={() => {
                  if (aiMode === "cut_captions") {
                    setFunnelStep("style");
                  } else {
                    void submit();
                  }
                }}
              >
                <MaterialCommunityIcons name="arrow-right-circle-outline" size={24} color="#0e2b09" />
                <Text style={styles.ctaText}>{aiMode === "cut_captions" ? "Continuar" : "Iniciar corte com IA"}</Text>
                <Ionicons name="chevron-forward" size={22} color="#0e2b09" />
              </TouchableOpacity>
            </View>
          )}

          {picked && funnelStep === "style" && aiMode === "cut_captions" && (
            <View style={styles.block}>
              <Text style={styles.blockTitle}>Escolha o estilo das legendas</Text>

              <Text style={styles.sectionLabel}>Fonte</Text>
              <View style={styles.choiceWrap}>
                {SUBTITLE_FONT_OPTIONS.map((font) => (
                  <TouchableOpacity key={font.id} style={[styles.choiceChip, subtitleFont === font.id ? styles.choiceChipActive : null]} onPress={() => setSubtitleFont(font.id)}>
                    <Text style={[styles.choiceChipText, subtitleFont === font.id ? styles.choiceChipTextActive : null, font.style]}>{font.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.sectionLabel}>Cor</Text>
              <View style={styles.colorRow}>
                {["#57ef2f", "#ffffff", "#ffd54a", "#66d9ff", "#ff7ad9"].map((color) => (
                  <TouchableOpacity key={color} style={[styles.colorDot, { backgroundColor: color }, subtitleColor === color ? styles.colorDotActive : null]} onPress={() => setSubtitleColor(color)} />
                ))}
              </View>

              <View style={styles.captionPreview}>
                <Text style={[styles.captionPreviewText, { color: subtitleColor }, previewFontStyle]}>Legenda premium no seu estilo</Text>
                <Text style={styles.captionPreviewMeta}>Fonte: {subtitleFont} · Cor: {subtitleColor}</Text>
              </View>

              <TouchableOpacity style={styles.cta} onPress={() => void submit()}>
                {submitting ? <ActivityIndicator color="#0e2b09" /> : <MaterialCommunityIcons name="magic-staff" size={24} color="#0e2b09" />}
                <Text style={styles.ctaText}>Iniciar edicao com IA</Text>
                <Ionicons name="chevron-forward" size={22} color="#0e2b09" />
              </TouchableOpacity>
            </View>
          )}

          {(funnelStep === "processing" || video?.status === "QUEUED" || video?.status === "PROCESSING") && (
            <View style={styles.magicBlock}>
              <Text style={styles.blockTitle}>Status da edicao</Text>
              <Text style={styles.magicTitle}>A IA esta trabalhando no seu video</Text>
              <Text style={styles.statusText}>{magicMessages[magicTick % magicMessages.length]}</Text>
              <View style={styles.magicProgressOuter}>
                <View style={[styles.magicProgressInner, { width: `${Math.max(8, Math.round((progress || (0.12 + ((magicTick % 8) * 0.09))) * 100))}%` }]} />
              </View>
              <View style={styles.timeline}>
                <Text style={[styles.timelineText, { color: stageColor("prepare") }]}>Preparar</Text>
                <Text style={[styles.timelineText, { color: stageColor("edit") }]}>Editar</Text>
                <Text style={[styles.timelineText, { color: stageColor("deliver") }]}>Entregar</Text>
                <Text style={[styles.timelineText, { color: stageColor("done") }]}>Pronto</Text>
              </View>
              <Text style={styles.meta}>{video?.status === "PROCESSING" ? `${Math.max(1, Math.round(progress * 100))}% concluido` : "Aguardando pipeline..."}</Text>
            </View>
          )}

          {(video?.status === "COMPLETE" || funnelStep === "done") && (
            <View style={styles.completeActions}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => void openViewer()}>
                <Text style={styles.secondaryBtnText}>Ver video no app</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => void downloadInsideApp()} disabled={Boolean(downloadingUrl)}>
                <Text style={styles.secondaryBtnText}>{downloadingUrl ? "Baixando..." : "Baixar no app"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  setPicked(null);
                  setVideo(null);
                  setFunnelStep("upload");
                }}
              >
                <Text style={styles.secondaryBtnText}>Novo video</Text>
              </TouchableOpacity>
            </View>
          )}

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
  bgOrnamentA: {
    position: "absolute",
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(87,239,47,0.08)",
    top: -90,
    right: -80,
  },
  bgOrnamentB: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: "rgba(63,138,255,0.08)",
    bottom: 80,
    left: -70,
  },
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
  funnelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(11,16,26,0.8)",
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  funnelStep: {
    color: "#8f98aa",
    fontSize: 11,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  funnelStepActive: {
    color: "#57ef2f",
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
    fontSize: 18,
    fontFamily: realTheme.fonts.bodyBold,
  },
  modeRow: {
    flexDirection: "row",
    gap: 10,
  },
  modeChip: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(24,30,42,0.92)",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  modeChipActive: {
    borderColor: "rgba(87,239,47,0.9)",
    backgroundColor: "rgba(68,214,39,0.2)",
  },
  modeChipText: {
    color: "#cad3e2",
    fontSize: 17,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  modeChipTextActive: {
    color: "#ecfff2",
  },
  help: {
    color: "#a8b1bf",
    fontSize: 14,
    lineHeight: 20,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  sectionLabel: {
    color: "#dce4f1",
    fontSize: 14,
    fontFamily: realTheme.fonts.bodySemiBold,
    marginTop: 4,
  },
  choiceWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  choiceChip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(20,26,38,0.88)",
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: "47%",
  },
  choiceChipActive: {
    borderColor: "rgba(87,239,47,0.8)",
    backgroundColor: "rgba(68,214,39,0.16)",
  },
  choiceChipText: {
    color: "#c9d2e2",
    fontSize: 12,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  choiceChipTextActive: {
    color: "#ecfff2",
  },
  colorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  colorDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.35)",
  },
  colorDotActive: {
    borderColor: "#ffffff",
    transform: [{ scale: 1.08 }],
  },
  captionPreview: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(13,18,29,0.95)",
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  captionPreviewText: {
    fontSize: 16,
    fontFamily: realTheme.fonts.bodyBold,
  },
  captionPreviewMeta: {
    color: "#9aa6bb",
    fontSize: 12,
    marginTop: 4,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  magicBlock: {
    borderRadius: 23,
    backgroundColor: "rgba(11,16,25,0.92)",
    borderWidth: 1,
    borderColor: "rgba(87,239,47,0.35)",
    padding: 14,
    gap: 8,
    shadowColor: "#57ef2f",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 4 },
  },
  magicTitle: {
    color: "#ecfff2",
    fontSize: 20,
    lineHeight: 24,
    fontFamily: realTheme.fonts.bodyBold,
  },
  magicProgressOuter: {
    height: 14,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  magicProgressInner: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#57ef2f",
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
  statusText: {
    color: "#cfd8e7",
    fontSize: 14,
    lineHeight: 20,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  cta: {
    marginTop: 4,
    borderRadius: 999,
    minHeight: 54,
    backgroundColor: "#57ef2f",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
  },
  ctaDisabled: {
    opacity: 0.5,
  },
  ctaText: {
    color: "#0e2b09",
    fontSize: 20,
    fontFamily: realTheme.fonts.bodyBold,
  },
  completeActions: {
    gap: 10,
    marginBottom: 8,
  },
  secondaryBtn: {
    borderRadius: 14,
    minHeight: 48,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(20,25,36,0.95)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  secondaryBtnText: {
    color: "#d9e2f1",
    fontSize: 16,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  meta: {
    color: "#95a5bb",
    fontSize: 12,
    lineHeight: 17,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  error: {
    color: "#ff8f8f",
    fontSize: 13,
    lineHeight: 18,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  viewerWrap: {
    flex: 1,
    backgroundColor: "#07090f",
    justifyContent: "center",
    padding: 16,
    gap: 14,
  },
  viewerPlayer: {
    width: "100%",
    aspectRatio: 9 / 16,
    backgroundColor: "#000",
    borderRadius: 16,
  },
  viewerActions: {
    gap: 10,
  },
});
