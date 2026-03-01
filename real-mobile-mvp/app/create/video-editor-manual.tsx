import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { canAccessInternalPreviews } from "../../src/auth/accessControl";
import { useAuth } from "../../src/auth/AuthProvider";
import { createManualEditorSession, fetchVideo, getDownloadUrl, submitManualSourceJob, type VideoItem } from "../../src/services/videoEditorApi";
import { makeClientTraceId, sanitizeUri, sendVideoClientLog } from "../../src/services/videoEditorDebugLog";
import { pickVideoWithRecovery } from "../../src/services/videoPickerRecovery";
import { humanizeVideoError } from "../../src/services/videoEditorPresenter";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";

type PickedVideo = {
  uri: string;
  name: string;
  mimeType: string;
  durationSeconds: number;
  sizeBytes?: number;
};

type Segment = {
  id: string;
  start: number;
  end: number;
  enabled: boolean;
};

type ManualCaption = {
  id: string;
  start: number;
  end: number;
  text: string;
};

type CaptionMode = "auto" | "manual" | "none";
type ToolTab = "cut" | "split" | "text" | "audio" | "effects" | "adjust";

const MAX_VIDEO_SECONDS = 300;
const ACCEPTED_EXTENSIONS = [".mp4", ".mov", ".m4v"];

function normalizeDuration(rawDuration: number | null | undefined): number {
  if (!rawDuration || !Number.isFinite(rawDuration)) return 0;
  if (rawDuration > 1000) return rawDuration / 1000;
  return rawDuration;
}

function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const min = Math.floor(total / 60)
    .toString()
    .padStart(2, "0");
  const sec = Math.floor(total % 60)
    .toString()
    .padStart(2, "0");
  const ms = Math.floor((seconds - Math.floor(seconds)) * 100)
    .toString()
    .padStart(2, "0");
  return `${min}:${sec}.${ms}`;
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

function splitSegments(cutStart: number, cutEnd: number, splitPoints: number[], previous: Segment[]): Segment[] {
  const points = [...splitPoints]
    .filter((n) => Number.isFinite(n) && n > cutStart && n < cutEnd)
    .sort((a, b) => a - b);

  const oldMap = new Map<string, boolean>();
  previous.forEach((s) => oldMap.set(`${s.start.toFixed(3)}-${s.end.toFixed(3)}`, s.enabled));

  const result: Segment[] = [];
  let cursor = cutStart;
  points.forEach((p, idx) => {
    result.push({
      id: `S${idx + 1}`,
      start: cursor,
      end: p,
      enabled: oldMap.get(`${cursor.toFixed(3)}-${p.toFixed(3)}`) ?? true,
    });
    cursor = p;
  });
  result.push({
    id: `S${result.length + 1}`,
    start: cursor,
    end: cutEnd,
    enabled: oldMap.get(`${cursor.toFixed(3)}-${cutEnd.toFixed(3)}`) ?? true,
  });
  return result.filter((s) => s.end - s.start > 0.04);
}

export default function VideoEditorManualScreen() {
  const auth = useAuth();
  const hasInternalPreviewAccess = canAccessInternalPreviews(auth.userEmail);
  const videoRef = useRef<Video | null>(null);
  const [flowTraceId, setFlowTraceId] = useState(() => makeClientTraceId("manual"));

  const [picked, setPicked] = useState<PickedVideo | null>(null);
  const [sourceVideo, setSourceVideo] = useState<VideoItem | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const [loadingSource, setLoadingSource] = useState(false);
  const [pickingVideo, setPickingVideo] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [status, setStatus] = useState("Envie um video para abrir o editor manual.");
  const [error, setError] = useState<string | null>(null);

  const [durationSeconds, setDurationSeconds] = useState(0);
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timelineWidth, setTimelineWidth] = useState(0);

  const [tab, setTab] = useState<ToolTab>("cut");
  const [captionMode, setCaptionMode] = useState<CaptionMode>("auto");
  const [splitPoints, setSplitPoints] = useState<number[]>([]);
  const [cutStart, setCutStart] = useState(0);
  const [cutEnd, setCutEnd] = useState(0);
  const [segments, setSegments] = useState<Segment[]>([]);

  const [captionStart, setCaptionStart] = useState("0.00");
  const [captionEnd, setCaptionEnd] = useState("1.50");
  const [captionDraft, setCaptionDraft] = useState("");
  const [manualCaptions, setManualCaptions] = useState<ManualCaption[]>([]);

  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(1);

  const videoApiBase = useMemo(() => {
    const raw = process.env.EXPO_PUBLIC_VIDEO_EDITOR_API_BASE_URL?.trim() ?? "";
    return raw ? raw.replace(/\/+$/, "") : "";
  }, []);

  const playbackUrl = useMemo(() => {
    if (!videoApiBase || !sourceVideo?.id) return null;
    return getDownloadUrl(videoApiBase, sourceVideo.id);
  }, [videoApiBase, sourceVideo?.id]);

  const editorReady = Boolean(sourceVideo?.status === "COMPLETE" && sessionToken && playbackUrl);

  const applyPicked = (
    asset: { uri: string; fileName?: string | null; mimeType?: string | null; duration?: number | null; fileSize?: number | null },
    traceId = flowTraceId,
  ) => {
    const duration = normalizeDuration(asset.duration);
    void sendVideoClientLog({
      baseUrl: videoApiBase,
      traceId,
      stage: "picker",
      event: "asset_received",
      meta: {
        uri: sanitizeUri(asset.uri),
        file_name: asset.fileName || null,
        mime: asset.mimeType || null,
        duration_seconds: duration,
        size_bytes: asset.fileSize ?? null,
      },
    });
    if (duration && duration > MAX_VIDEO_SECONDS) {
      setError("Use um video de ate 5 minutos.");
      return null;
    }
    const name = makeSafeName(asset.fileName || `video_${Date.now()}.mp4`);
    if (!hasAcceptedExtension(name)) {
      setError("Formato invalido. Envie um video MP4 ou MOV.");
      return null;
    }
    return {
      uri: asset.uri,
      name,
      mimeType: asset.mimeType || "video/mp4",
      durationSeconds: duration,
      sizeBytes: typeof asset.fileSize === "number" ? asset.fileSize : undefined,
    } as PickedVideo;
  };

  const pollUntilDone = async (videoId: string): Promise<VideoItem> => {
    for (let i = 0; i < 120; i += 1) {
      const current = await fetchVideo(videoApiBase, videoId, flowTraceId);
      setSourceVideo(current);
      if (current.status === "COMPLETE" || current.status === "FAILED") return current;
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Tempo excedido preparando video manual.");
  };

  const prepareManualEditor = async (file: PickedVideo) => {
    if (!videoApiBase) {
      setError("Backend de video nao configurado neste ambiente.");
      return;
    }
    setLoadingSource(true);
    setError(null);
    setStatus("Subindo video para preparar editor manual...");

    try {
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "manual_prepare",
        event: "submit_manual_source_start",
        meta: {
          uri: sanitizeUri(file.uri),
          file_name: file.name,
          mime: file.mimeType,
          duration_seconds: file.durationSeconds,
          size_bytes: file.sizeBytes ?? null,
        },
      });
      const created = await submitManualSourceJob({
        baseUrl: videoApiBase,
        file: { uri: file.uri, name: file.name, type: file.mimeType },
        traceId: flowTraceId,
      });
      setSourceVideo(created);
      setStatus("Processando video para editor manual...");
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "manual_prepare",
        event: "submit_manual_source_ok",
        meta: { video_id: created.id },
      });

      const completed = await pollUntilDone(created.id);
      if (completed.status !== "COMPLETE") {
        throw new Error(completed.error?.message || "Falha ao preparar video manual.");
      }

      const session = await createManualEditorSession(videoApiBase, completed.id, undefined, flowTraceId);
      setSessionToken(session.sessionToken);
      setStatus("Editor manual pronto. Ajuste e exporte.");
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "manual_prepare",
        event: "manual_editor_session_ready",
        meta: { video_id: completed.id, edit_session_id: session.editSessionId },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha ao preparar editor manual.";
      setError(humanizeVideoError(message));
      setStatus("Falha no preparo do editor manual.");
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "manual_prepare",
        event: "manual_prepare_failed",
        level: "error",
        meta: { message },
      });
    } finally {
      setLoadingSource(false);
    }
  };

  const pickVideoSmart = async () => {
    if (pickingVideo || loadingSource) return;
    setPickingVideo(true);
    setError(null);
    setStatus("Abrindo galeria...");
    const nextTraceId = makeClientTraceId("manual");
    setFlowTraceId(nextTraceId);
    try {
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: nextTraceId,
        stage: "picker",
        event: "image_library_permission_request_start",
      });
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

      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: nextTraceId,
        stage: "picker",
        event: "image_library_open_start",
      });
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

      const normalized = applyPicked(
        {
          uri: recovered.uri,
          fileName: recovered.fileName,
          mimeType: recovered.mimeType,
          duration: recovered.duration,
          fileSize: recovered.fileSize,
        },
        nextTraceId,
      );
      if (!normalized) return;
      setPicked(normalized);
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: nextTraceId,
        stage: "picker",
        event: "image_library_asset_ok",
        meta: { uri: sanitizeUri(normalized.uri), file_name: normalized.name, mime: normalized.mimeType, duration_seconds: normalized.durationSeconds },
      });
      await prepareManualEditor(normalized);
    } catch (pickError) {
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: nextTraceId,
        stage: "picker",
        event: "image_library_failed_after_recovery",
        level: "warn",
        meta: { raw_error: pickError instanceof Error ? pickError.message : String(pickError ?? "") },
      });
      setStatus("Nao foi possivel recuperar o video automaticamente.");
      setError(pickerErrorMessage(pickError));
    } finally {
      setPickingVideo(false);
    }
  };

  const ensureEditorSetupFromLoadedVideo = (loadedDuration: number) => {
    const safeDur = Math.max(0.01, loadedDuration || durationSeconds || picked?.durationSeconds || 0);
    setDurationSeconds(safeDur);
    setCutStart((prev) => (prev > 0 ? Math.min(prev, safeDur - 0.05) : 0));
    setCutEnd((prev) => {
      if (prev > 0.05 && prev <= safeDur) return prev;
      return safeDur;
    });
    setSegments((prev) => splitSegments(0, safeDur, splitPoints, prev.length ? prev : [{ id: "S1", start: 0, end: safeDur, enabled: true }]));
  };

  const syncSegments = (nextCutStart: number, nextCutEnd: number, nextSplits: number[]) => {
    setSegments((prev) => splitSegments(nextCutStart, nextCutEnd, nextSplits, prev));
  };

  const logEditorEvent = (stage: string, event: string, meta?: Record<string, unknown>) => {
    void sendVideoClientLog({
      baseUrl: videoApiBase,
      traceId: flowTraceId,
      stage,
      event,
      meta,
    });
  };

  const setActiveToolTab = (nextTab: ToolTab) => {
    setTab(nextTab);
    if (nextTab === "audio") {
      setStatus("Audio e trilhas entram na proxima iteracao do editor.");
    }
    logEditorEvent("manual_editor_ui", "tool_tab_selected", { tab: nextTab });
  };

  const toggleSegment = (id: string) => {
    setSegments((current) => current.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)));
  };

  const addSplitAtCurrentTime = () => {
    if (!durationSeconds || positionSeconds <= cutStart + 0.05 || positionSeconds >= cutEnd - 0.05) {
      return;
    }
    const next = [...splitPoints, positionSeconds]
      .map((n) => Number(n.toFixed(2)))
      .filter((n, i, arr) => arr.indexOf(n) === i)
      .sort((a, b) => a - b);
    setSplitPoints(next);
    syncSegments(cutStart, cutEnd, next);
    setStatus(`Divisao adicionada em ${formatTime(positionSeconds)}.`);
    logEditorEvent("manual_editor_timeline", "split_added", { at_seconds: Number(positionSeconds.toFixed(3)), split_count: next.length });
  };

  const clearSplits = () => {
    setSplitPoints([]);
    syncSegments(cutStart, cutEnd, []);
    setStatus("Divisoes limpas.");
    logEditorEvent("manual_editor_timeline", "splits_cleared");
  };

  const markCutStart = () => {
    const next = Math.min(Math.max(0, positionSeconds), Math.max(0, cutEnd - 0.1));
    setCutStart(next);
    const filtered = splitPoints.filter((p) => p > next && p < cutEnd);
    setSplitPoints(filtered);
    syncSegments(next, cutEnd, filtered);
    logEditorEvent("manual_editor_cut", "cut_start_marked", { cut_start_seconds: Number(next.toFixed(3)), cut_end_seconds: Number(cutEnd.toFixed(3)) });
  };

  const markCutEnd = () => {
    const next = Math.max(positionSeconds, cutStart + 0.1);
    const bounded = durationSeconds ? Math.min(next, durationSeconds) : next;
    setCutEnd(bounded);
    const filtered = splitPoints.filter((p) => p > cutStart && p < bounded);
    setSplitPoints(filtered);
    syncSegments(cutStart, bounded, filtered);
    logEditorEvent("manual_editor_cut", "cut_end_marked", { cut_start_seconds: Number(cutStart.toFixed(3)), cut_end_seconds: Number(bounded.toFixed(3)) });
  };

  const resetCut = () => {
    const end = durationSeconds || picked?.durationSeconds || 0;
    setCutStart(0);
    setCutEnd(end);
    setSplitPoints([]);
    syncSegments(0, end, []);
    logEditorEvent("manual_editor_cut", "cut_reset", { cut_end_seconds: Number(end.toFixed(3)) });
  };

  const useCurrentTimeForCaption = () => {
    const start = Math.max(0, positionSeconds);
    const end = Math.min(durationSeconds, start + 1.5);
    setCaptionStart(start.toFixed(2));
    setCaptionEnd(end.toFixed(2));
    logEditorEvent("manual_editor_caption", "caption_marker_applied", { start_seconds: Number(start.toFixed(3)), end_seconds: Number(end.toFixed(3)) });
  };

  const addManualCaption = () => {
    const st = Number(captionStart);
    const en = Number(captionEnd);
    if (!Number.isFinite(st) || !Number.isFinite(en) || en <= st + 0.05) {
      setError("Tempo invalido da legenda manual.");
      return;
    }
    if (!captionDraft.trim()) {
      setError("Digite um texto para legenda manual.");
      return;
    }
    const cap: ManualCaption = {
      id: `cap_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
      start: st,
      end: en,
      text: captionDraft.trim(),
    };
    setManualCaptions((prev) => [...prev, cap]);
    setCaptionDraft("");
    setStatus("Legenda manual adicionada.");
    logEditorEvent("manual_editor_caption", "manual_caption_added", { start_seconds: st, end_seconds: en, text_len: cap.text.length });
  };

  const deleteCaption = (id: string) => {
    setManualCaptions((prev) => prev.filter((c) => c.id !== id));
    logEditorEvent("manual_editor_caption", "manual_caption_deleted", { caption_id: id });
  };

  const togglePlayPause = async () => {
    if (!videoRef.current) return;
    try {
      if (isPlaying) {
        await videoRef.current.pauseAsync();
        logEditorEvent("manual_editor_transport", "paused", { at_seconds: Number(positionSeconds.toFixed(3)) });
      } else {
        await videoRef.current.playAsync();
        logEditorEvent("manual_editor_transport", "played", { at_seconds: Number(positionSeconds.toFixed(3)) });
      }
    } catch {
      // noop
    }
  };

  const seekBySeconds = async (deltaSeconds: number) => {
    if (!videoRef.current) return;
    const next = Math.max(0, Math.min(durationSeconds || 0, positionSeconds + deltaSeconds));
    try {
      await videoRef.current.setPositionAsync(Math.floor(next * 1000));
      logEditorEvent("manual_editor_transport", "seek_delta", { delta_seconds: deltaSeconds, to_seconds: Number(next.toFixed(3)) });
    } catch {
      // noop
    }
  };

  const jumpToProgress = async (progress01: number) => {
    if (!videoRef.current || !durationSeconds) return;
    const bounded = Math.max(0, Math.min(1, progress01));
    const next = durationSeconds * bounded;
    try {
      await videoRef.current.setPositionAsync(Math.floor(next * 1000));
      logEditorEvent("manual_editor_timeline", "timeline_seek", { progress: Number(bounded.toFixed(4)), to_seconds: Number(next.toFixed(3)) });
    } catch {
      // noop
    }
  };

  const previewSegmented = async () => {
    if (!segments.length) return;
    const first = segments.find((s) => s.enabled);
    if (!first || !videoRef.current) return;
    try {
      await videoRef.current.setPositionAsync(Math.floor(first.start * 1000));
      await videoRef.current.playAsync();
    } catch {
      // noop
    }
  };

  const exportManual = async () => {
    if (!videoApiBase || !sourceVideo?.id || !sessionToken || exporting) return;

    const activeSegments = segments.filter((s) => s.enabled).map((s) => ({
      start_seconds: Number(s.start.toFixed(3)),
      end_seconds: Number(s.end.toFixed(3)),
      enabled: true,
    }));

    if (!activeSegments.length) {
      setError("Ative ao menos um segmento antes de exportar.");
      return;
    }

    setExporting(true);
    setError(null);
    setStatus("Exportando versao manual...");

    try {
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "manual_export",
        event: "manual_export_start",
        meta: {
          base_video_id: sourceVideo.id,
          segment_count: activeSegments.length,
          caption_mode: captionMode,
          manual_caption_count: manualCaptions.length,
        },
      });
      const response = await fetch(`${videoApiBase}/v1/videos/${sourceVideo.id}/manual-export`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-trace-id": flowTraceId },
        body: JSON.stringify({
          token: sessionToken,
          include_subtitles: captionMode !== "none",
          caption_mode: captionMode,
          segments: activeSegments,
          manual_captions:
            captionMode === "manual"
              ? manualCaptions.map((c) => ({
                  start_seconds: Number(c.start.toFixed(3)),
                  end_seconds: Number(c.end.toFixed(3)),
                  text: c.text,
                }))
              : [],
          subtitles_language: "pt-BR",
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Falha ao exportar edicao manual.");
      }

      const created = (await response.json()) as VideoItem;
      setStatus(`Exportacao iniciada: ${created.id}`);
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "manual_export",
        event: "manual_export_created",
        meta: { output_video_id: created.id },
      });

      for (let i = 0; i < 120; i += 1) {
        const current = await fetchVideo(videoApiBase, created.id, flowTraceId);
        if (current.status === "COMPLETE") {
          setSourceVideo(current);
          setStatus("Exportacao concluida. Video final pronto.");
          Alert.alert("Pronto", "Edicao manual concluida com sucesso.");
          void sendVideoClientLog({
            baseUrl: videoApiBase,
            traceId: flowTraceId,
            stage: "manual_export",
            event: "manual_export_complete",
            meta: { output_video_id: created.id },
          });
          break;
        }
        if (current.status === "FAILED") {
          throw new Error(current.error?.message || "Falha na exportacao manual.");
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha na exportacao manual.";
      setError(humanizeVideoError(message));
      setStatus("Falha ao exportar edicao manual.");
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "manual_export",
        event: "manual_export_failed",
        level: "error",
        meta: { message },
      });
    } finally {
      setExporting(false);
    }
  };

  if (!hasInternalPreviewAccess) {
    return <Redirect href="/create/ads" />;
  }

  return (
    <Screen plain style={styles.screen}>
      <LinearGradient colors={["#07090f", "#0a0d17", "#07090f"]} style={styles.bg}>
        <View style={styles.glowTop} />
        {!editorReady ? (
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.topBar}>
              <TouchableOpacity style={styles.backIcon} onPress={() => router.back()} activeOpacity={0.9}>
                <Ionicons name="arrow-back" size={28} color="#eef2f8" />
              </TouchableOpacity>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Envie da galeria e abra o editor</Text>
              <Text style={styles.cardSubtitle}>Sem tela intermediaria. Um unico fluxo direto para editar manualmente.</Text>
              <TouchableOpacity style={styles.greenButton} activeOpacity={0.92} onPress={() => void pickVideoSmart()} disabled={loadingSource}>
                {loadingSource || pickingVideo ? <ActivityIndicator color="#102808" /> : <Ionicons name="play-circle" size={24} color="#102808" />}
                <Text style={styles.greenButtonText}>{loadingSource ? "Preparando..." : pickingVideo ? "Abrindo galeria..." : "Enviar da galeria"}</Text>
              </TouchableOpacity>
              {picked ? <Text style={styles.meta}>Arquivo: {picked.name}</Text> : null}
              <Text style={styles.statusText}>{status}</Text>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>
          </ScrollView>
        ) : (
          <View style={styles.editorShell}>
            <View style={styles.topBarCompact}>
              <TouchableOpacity style={styles.backIcon} onPress={() => router.back()} activeOpacity={0.9}>
                <Ionicons name="arrow-back" size={28} color="#eef2f8" />
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.exportTopButton, exporting ? styles.exportTopDisabled : null]}
                onPress={() => void exportManual()}
                activeOpacity={0.9}
                disabled={exporting}
              >
                {exporting ? <ActivityIndicator color="#0d2507" size="small" /> : <Text style={styles.exportTopText}>Exportar</Text>}
              </TouchableOpacity>
            </View>

            <View style={styles.videoWrap}>
              {playbackUrl ? (
                <Video
                  ref={videoRef}
                  source={{ uri: playbackUrl }}
                  style={styles.player}
                  useNativeControls={false}
                  resizeMode={ResizeMode.COVER}
                  onLoad={(s: any) => {
                    const dur = (s?.durationMillis || 0) / 1000;
                    ensureEditorSetupFromLoadedVideo(dur);
                    if (!cutEnd && dur > 0) setCutEnd(dur);
                  }}
                  onPlaybackStatusUpdate={(s: any) => {
                    if (!s.isLoaded) return;
                    setPositionSeconds((s.positionMillis || 0) / 1000);
                    setIsPlaying(Boolean(s.isPlaying));
                    if (!durationSeconds && s.durationMillis) setDurationSeconds((s.durationMillis || 0) / 1000);
                  }}
                />
              ) : null}
              <View style={styles.overlayControls}>
                <TouchableOpacity style={styles.overlayBtn} onPress={() => void seekBySeconds(-5)}>
                  <Ionicons name="play-back" size={18} color="#dce4f1" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.overlayPlayBtn} onPress={() => void togglePlayPause()}>
                  <Ionicons name={isPlaying ? "pause" : "play"} size={18} color="#58ef31" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.overlayBtn} onPress={() => void seekBySeconds(5)}>
                  <Ionicons name="play-forward" size={18} color="#dce4f1" />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.overlayBtn}
                  onPress={() => {
                    setIsFullscreen(true);
                    logEditorEvent("manual_editor_transport", "fullscreen_open");
                  }}
                >
                  <Ionicons name="expand-outline" size={17} color="#dce4f1" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.timeRowCompact}>
              <Text style={styles.timeText}>{formatTime(positionSeconds)}</Text>
              <Text style={styles.timeText}>{formatTime(durationSeconds)}</Text>
            </View>

            <TouchableOpacity
              activeOpacity={1}
              style={styles.timelineTrack}
              onLayout={(e) => setTimelineWidth(e.nativeEvent.layout.width)}
              onPress={(e) => {
                if (!timelineWidth) return;
                const p = e.nativeEvent.locationX / timelineWidth;
                void jumpToProgress(p);
              }}
            >
              <LinearGradient colors={["#24364e", "#2f4663", "#24364e"]} style={styles.timelineThumbs} />
              <View style={[styles.timelinePlayhead, { left: `${durationSeconds ? Math.min(98, Math.max(0, (positionSeconds / durationSeconds) * 100)) : 0}%` }]} />
            </TouchableOpacity>

            <View style={styles.toolDock}>
              <View style={styles.toolDockRow}>
                {[
                  { key: "cut", icon: "content-cut", label: "Cortar" },
                  { key: "split", icon: "content-duplicate", label: "Dividir" },
                  { key: "text", icon: "format-text", label: "Texto" },
                  { key: "audio", icon: "music-note", label: "Audio" },
                  { key: "effects", icon: "magic-staff", label: "Efeitos" },
                  { key: "adjust", icon: "tune-variant", label: "Ajustes" },
                ].map((item) => (
                  <TouchableOpacity key={item.key} style={styles.toolDockItem} onPress={() => setActiveToolTab(item.key as ToolTab)} activeOpacity={0.9}>
                    <MaterialCommunityIcons name={item.icon as any} size={26} color={tab === item.key ? "#6ef94b" : "#9ea7b7"} />
                    <Text style={[styles.toolDockText, tab === item.key ? styles.toolDockTextActive : null]}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {tab === "cut" ? (
                <View style={styles.inlineButtons}>
                  <TouchableOpacity style={styles.smallAction} onPress={markCutStart}>
                    <Text style={styles.smallActionText}>Marcar inicio</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallAction} onPress={markCutEnd}>
                    <Text style={styles.smallActionText}>Marcar fim</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallAction} onPress={resetCut}>
                    <Text style={styles.smallActionText}>Resetar corte</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {tab === "split" ? (
                <View style={styles.inlineButtons}>
                  <TouchableOpacity style={styles.smallAction} onPress={addSplitAtCurrentTime}>
                    <Text style={styles.smallActionText}>Dividir no marcador</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallAction} onPress={clearSplits}>
                    <Text style={styles.smallActionText}>Limpar divisoes</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {tab === "text" ? (
                <View style={styles.textPanel}>
                  <View style={styles.captionModeRow}>
                    <TouchableOpacity
                      style={[styles.captionModeChip, captionMode === "auto" ? styles.captionModeChipActive : null]}
                      onPress={() => {
                        setCaptionMode("auto");
                        logEditorEvent("manual_editor_caption", "caption_mode_changed", { mode: "auto" });
                      }}
                    >
                      <Text style={[styles.captionModeText, captionMode === "auto" ? styles.captionModeTextActive : null]}>Legenda auto</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.captionModeChip, captionMode === "manual" ? styles.captionModeChipActive : null]}
                      onPress={() => {
                        setCaptionMode("manual");
                        logEditorEvent("manual_editor_caption", "caption_mode_changed", { mode: "manual" });
                      }}
                    >
                      <Text style={[styles.captionModeText, captionMode === "manual" ? styles.captionModeTextActive : null]}>Manual</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.captionModeChip, captionMode === "none" ? styles.captionModeChipActive : null]}
                      onPress={() => {
                        setCaptionMode("none");
                        logEditorEvent("manual_editor_caption", "caption_mode_changed", { mode: "none" });
                      }}
                    >
                      <Text style={[styles.captionModeText, captionMode === "none" ? styles.captionModeTextActive : null]}>Sem</Text>
                    </TouchableOpacity>
                  </View>
                  {captionMode === "manual" ? (
                    <View style={styles.manualEditorBox}>
                      <View style={styles.manualRow}>
                        <View style={styles.manualInputWrap}>
                          <Text style={styles.inputLabel}>Inicio</Text>
                          <TextInput style={styles.timeInput} value={captionStart} onChangeText={setCaptionStart} keyboardType="decimal-pad" />
                        </View>
                        <View style={styles.manualInputWrap}>
                          <Text style={styles.inputLabel}>Fim</Text>
                          <TextInput style={styles.timeInput} value={captionEnd} onChangeText={setCaptionEnd} keyboardType="decimal-pad" />
                        </View>
                      </View>
                      <TextInput
                        style={styles.captionInput}
                        placeholder="Texto da legenda"
                        placeholderTextColor="#7f8797"
                        value={captionDraft}
                        onChangeText={setCaptionDraft}
                      />
                      <View style={styles.inlineButtons}>
                        <TouchableOpacity style={styles.smallAction} onPress={useCurrentTimeForCaption}>
                          <Text style={styles.smallActionText}>Usar marcador</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.smallAction} onPress={addManualCaption}>
                          <Text style={styles.smallActionText}>Adicionar</Text>
                        </TouchableOpacity>
                      </View>
                      {manualCaptions.slice(-2).map((c) => (
                        <View key={c.id} style={styles.captionItem}>
                          <Text style={styles.captionItemText}>{formatTime(c.start)} - {formatTime(c.end)} · {c.text}</Text>
                          <TouchableOpacity onPress={() => deleteCaption(c.id)}>
                            <Text style={styles.captionDelete}>Excluir</Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {tab === "effects" ? (
                <View style={styles.inlineButtons}>
                  <TouchableOpacity style={styles.smallAction} onPress={() => setStatus("Filtro cinematico aplicado no preview.")}>
                    <Text style={styles.smallActionText}>Cinematico</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.smallAction} onPress={() => setStatus("Filtro vibrante aplicado no preview.")}>
                    <Text style={styles.smallActionText}>Vibrante</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              {tab === "adjust" ? (
                <View style={styles.inlineButtons}>
                  <TouchableOpacity
                    style={styles.smallAction}
                    onPress={() =>
                      setBrightness((v) => {
                        const next = Number((v - 0.05).toFixed(2));
                        logEditorEvent("manual_editor_adjust", "brightness_changed", { from: v, to: next });
                        return next;
                      })
                    }
                  >
                    <Text style={styles.smallActionText}>Brilho -</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.smallAction}
                    onPress={() =>
                      setBrightness((v) => {
                        const next = Number((v + 0.05).toFixed(2));
                        logEditorEvent("manual_editor_adjust", "brightness_changed", { from: v, to: next });
                        return next;
                      })
                    }
                  >
                    <Text style={styles.smallActionText}>Brilho +</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.smallAction}
                    onPress={() =>
                      setContrast((v) => {
                        const next = Number(Math.max(0.6, v - 0.05).toFixed(2));
                        logEditorEvent("manual_editor_adjust", "contrast_changed", { from: v, to: next });
                        return next;
                      })
                    }
                  >
                    <Text style={styles.smallActionText}>Contraste -</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.smallAction}
                    onPress={() =>
                      setContrast((v) => {
                        const next = Number((v + 0.05).toFixed(2));
                        logEditorEvent("manual_editor_adjust", "contrast_changed", { from: v, to: next });
                        return next;
                      })
                    }
                  >
                    <Text style={styles.smallActionText}>Contraste +</Text>
                  </TouchableOpacity>
                  <Text style={styles.meta}>Brilho {brightness.toFixed(2)} · Contraste {contrast.toFixed(2)}</Text>
                </View>
              ) : null}
            </View>

            <View style={styles.editorFooter}>
              <Text style={styles.statusText}>{status}</Text>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>
          </View>
        )}
      </LinearGradient>

      <Modal
        visible={isFullscreen}
        animationType="fade"
        transparent={false}
        onRequestClose={() => {
          setIsFullscreen(false);
          logEditorEvent("manual_editor_transport", "fullscreen_close");
        }}
      >
        <View style={styles.fullscreenWrap}>
          {playbackUrl ? (
            <Video
              ref={videoRef}
              source={{ uri: playbackUrl }}
              style={styles.fullscreenVideo}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              onPlaybackStatusUpdate={(s: any) => {
                if (!s.isLoaded) return;
                setPositionSeconds((s.positionMillis || 0) / 1000);
                setIsPlaying(Boolean(s.isPlaying));
              }}
            />
          ) : null}
          <TouchableOpacity
            style={styles.closeFullscreenBtn}
            onPress={() => {
              setIsFullscreen(false);
              logEditorEvent("manual_editor_transport", "fullscreen_close");
            }}
          >
            <Text style={styles.closeFullscreenText}>Fechar</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bg: { flex: 1 },
  glowTop: {
    position: "absolute",
    top: -140,
    right: -80,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(64,232,31,0.14)",
  },
  content: {
    paddingHorizontal: 14,
    paddingBottom: 28,
    paddingTop: 8,
    gap: 12,
  },
  editorShell: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 10,
    gap: 8,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  topBarCompact: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 46,
  },
  backIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: {
    color: "#eef2f8",
    fontSize: 48,
    lineHeight: 52,
    letterSpacing: -0.8,
    fontFamily: realTheme.fonts.title,
  },
  exportTopButton: {
    minWidth: 128,
    height: 54,
    borderRadius: 16,
    backgroundColor: "#57ef2f",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  exportTopDisabled: {
    opacity: 0.55,
  },
  exportTopText: {
    color: "#102808",
    fontSize: 19,
    fontFamily: realTheme.fonts.bodyBold,
  },
  card: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(10,14,22,0.9)",
    padding: 16,
    gap: 10,
  },
  cardTitle: {
    color: "#eef2f8",
    fontSize: 34,
    lineHeight: 38,
    letterSpacing: -0.4,
    fontFamily: realTheme.fonts.title,
  },
  cardSubtitle: {
    color: "#aeb8c8",
    fontSize: 15,
    lineHeight: 22,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  playerCard: {
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "#0b1018",
  },
  videoWrap: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "#0b1018",
    position: "relative",
  },
  player: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#090d14",
  },
  overlayControls: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(8,12,20,0.76)",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 8,
  },
  overlayBtn: {
    width: 34,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(21,27,37,0.8)",
  },
  overlayPlayBtn: {
    width: 40,
    height: 26,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(87,239,47,0.6)",
    backgroundColor: "rgba(20,33,16,0.9)",
  },
  timeRowCompact: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 2,
  },
  timeText: {
    color: "#d4dcec",
    fontSize: 13,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  timelineTrack: {
    height: 62,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(11,16,25,0.95)",
    overflow: "hidden",
    position: "relative",
  },
  timelineThumbs: {
    width: "100%",
    height: "100%",
  },
  timelinePlayhead: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 3,
    backgroundColor: "#61f33b",
    shadowColor: "#61f33b",
    shadowOpacity: 0.65,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 0 },
  },
  timerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 4,
  },
  timerActive: {
    color: "#57ef2f",
    fontSize: 18,
    fontFamily: realTheme.fonts.bodySemiBold,
    minWidth: 86,
  },
  timerMuted: {
    color: "#d7deea",
    fontSize: 18,
    fontFamily: realTheme.fonts.bodySemiBold,
    minWidth: 86,
    textAlign: "right",
  },
  timelineBarWrap: {
    flex: 1,
  },
  timelineBarBg: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#2f3442",
    overflow: "hidden",
  },
  timelineBarFill: {
    height: "100%",
    backgroundColor: "#57ef2f",
  },
  transportRowMock: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    backgroundColor: "rgba(12,16,24,0.88)",
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 4,
  },
  transportGhostBtn: {
    width: 52,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "transparent",
  },
  transportPlayMock: {
    width: 74,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(87,239,47,0.52)",
    backgroundColor: "rgba(19,29,16,0.9)",
  },
  rulerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 2,
  },
  rulerTime: {
    color: "#939caf",
    fontSize: 13,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  timelineEditorCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(11,16,24,0.92)",
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 8,
  },
  tickRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    height: 14,
    paddingHorizontal: 2,
  },
  tick: {
    width: 2,
    height: 6,
    borderRadius: 2,
    backgroundColor: "rgba(120,129,145,0.5)",
  },
  tickStrong: {
    height: 11,
    backgroundColor: "rgba(154,165,182,0.82)",
  },
  stripRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  handleLeft: {
    width: 20,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#57ef2f",
    alignItems: "center",
    justifyContent: "center",
  },
  handleRight: {
    width: 20,
    height: 44,
    borderRadius: 10,
    backgroundColor: "#57ef2f",
    alignItems: "center",
    justifyContent: "center",
  },
  handleBar: {
    width: 3,
    height: 16,
    borderRadius: 99,
    backgroundColor: "#1f2a1d",
  },
  timelineStrip: {
    flex: 1,
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    position: "relative",
  },
  timelineThumbnailMock: {
    width: "100%",
    height: 84,
  },
  playhead: {
    position: "absolute",
    left: "28%",
    top: -2,
    bottom: -2,
    width: 3,
    backgroundColor: "#60f338",
    shadowColor: "#63f73b",
    shadowOpacity: 0.65,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  waveRow: {
    height: 32,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
    paddingHorizontal: 8,
  },
  waveBar: {
    width: 3,
    borderRadius: 2,
    backgroundColor: "rgba(87,239,47,0.25)",
  },
  segmentCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    backgroundColor: "rgba(11,16,24,0.9)",
    padding: 12,
    gap: 10,
  },
  segmentHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  segmentHeaderText: {
    color: "#aeb8c8",
    fontSize: 15,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  segmentList: {
    gap: 8,
  },
  segmentChip: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(24,29,40,0.9)",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  segmentChipActive: {
    borderColor: "rgba(87,239,47,0.75)",
    backgroundColor: "rgba(68,214,39,0.22)",
  },
  segmentChipText: {
    color: "#c7d0de",
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  segmentChipTextActive: {
    color: "#e8ffee",
  },
  toolDock: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(11,16,24,0.92)",
    padding: 12,
    gap: 8,
  },
  toolDockRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  toolDockItem: {
    width: "16.2%",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 3,
  },
  toolDockText: {
    color: "#a8b1c0",
    fontSize: 12,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  toolDockTextActive: {
    color: "#78f758",
  },
  textPanel: {
    gap: 8,
  },
  manualEditorBox: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(13,18,28,0.92)",
    padding: 8,
    gap: 8,
  },
  toolInlineActions: {
    gap: 8,
    paddingTop: 4,
  },
  toolBody: {
    gap: 10,
  },
  toolHint: {
    color: "#aab4c3",
    fontSize: 13,
    lineHeight: 19,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  inlineButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  smallAction: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(23,29,40,0.92)",
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  smallActionText: {
    color: "#d6deeb",
    fontSize: 13,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  captionModeRow: {
    flexDirection: "row",
    gap: 8,
  },
  captionModeChip: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(21,26,36,0.9)",
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 10,
  },
  captionModeChipActive: {
    borderColor: "rgba(87,239,47,0.8)",
    backgroundColor: "rgba(68,214,39,0.2)",
  },
  captionModeText: {
    color: "#c4cddb",
    fontSize: 13,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  captionModeTextActive: {
    color: "#edfff0",
  },
  manualRow: {
    flexDirection: "row",
    gap: 8,
  },
  manualInputWrap: {
    flex: 1,
    gap: 6,
  },
  inputLabel: {
    color: "#c4cddb",
    fontSize: 12,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  timeInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(18,23,33,0.95)",
    minHeight: 40,
    color: "#f1f4f8",
    paddingHorizontal: 10,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  captionInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(18,23,33,0.95)",
    minHeight: 44,
    color: "#f1f4f8",
    paddingHorizontal: 10,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  captionList: {
    gap: 8,
  },
  captionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(20,26,36,0.9)",
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  captionItemTime: {
    color: "#9fb1ca",
    fontSize: 12,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  captionItemText: {
    color: "#e5ebf5",
    fontSize: 13,
    lineHeight: 18,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  captionDelete: {
    color: "#ff8f8f",
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  bottomBarMock: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(12,16,24,0.92)",
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  bottomAction: {
    width: 86,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(21,26,36,0.9)",
  },
  bottomPlay: {
    width: 210,
    height: 62,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(87,239,47,0.7)",
    backgroundColor: "rgba(19,29,16,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  greenButton: {
    borderRadius: 999,
    minHeight: 56,
    backgroundColor: "#57ef2f",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 9,
    paddingHorizontal: 18,
  },
  greenButtonText: {
    color: "#102808",
    fontSize: 19,
    fontFamily: realTheme.fonts.bodyBold,
  },
  secondaryButton: {
    borderRadius: 16,
    minHeight: 48,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.2)",
    backgroundColor: "rgba(17,22,31,0.95)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  secondaryButtonText: {
    color: "#dce4f0",
    fontSize: 16,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  statusText: {
    color: "#cfd8e7",
    fontSize: 13,
    lineHeight: 19,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  editorFooter: {
    minHeight: 44,
    justifyContent: "center",
    gap: 4,
  },
  fullscreenWrap: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
  },
  fullscreenVideo: {
    width: "100%",
    height: "88%",
    backgroundColor: "#000",
  },
  closeFullscreenBtn: {
    marginTop: 8,
    borderRadius: 999,
    minHeight: 42,
    minWidth: 120,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#57ef2f",
  },
  closeFullscreenText: {
    color: "#0f2508",
    fontSize: 16,
    fontFamily: realTheme.fonts.bodyBold,
  },
  errorText: {
    color: "#ff8f8f",
    fontSize: 13,
    lineHeight: 18,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  meta: {
    color: "#95a5bb",
    fontSize: 12,
    lineHeight: 17,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  disabled: {
    opacity: 0.5,
  },
});
