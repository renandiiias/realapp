import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { ResizeMode, Video } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { createManualEditorSession, fetchVideo, getDownloadUrl, submitManualSourceJob, type VideoItem } from "../../src/services/videoEditorApi";
import { makeClientTraceId, sanitizeUri, sendVideoClientLog } from "../../src/services/videoEditorDebugLog";
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
type ToolTab = "cut" | "split" | "text";

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

async function launchLibraryWithTimeout(timeoutMs = 12000): Promise<any> {
  return Promise.race([
    ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["videos"],
      quality: 1,
      allowsEditing: false,
      allowsMultipleSelection: false,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
    }),
    new Promise<any>((_, reject) =>
      setTimeout(() => reject(new Error(`image_library_timeout_${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

export default function VideoEditorManualScreen() {
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

  const pickVideoWithDocumentPicker = async (): Promise<boolean> => {
    try {
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "picker",
        event: "document_picker_start",
      });
      const result = await DocumentPicker.getDocumentAsync({
        type: "video/*",
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) {
        void sendVideoClientLog({
          baseUrl: videoApiBase,
          traceId: flowTraceId,
          stage: "picker",
          event: "document_picker_canceled_or_empty",
        });
        return false;
      }
      const normalized = applyPicked(
        {
          uri: result.assets[0].uri,
          fileName: result.assets[0].name,
          mimeType: result.assets[0].mimeType,
          fileSize: result.assets[0].size,
        },
        flowTraceId,
      );
      if (!normalized) return false;
      setPicked(normalized);
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "picker",
        event: "document_picker_asset_ok",
        meta: { uri: sanitizeUri(normalized.uri), file_name: normalized.name, mime: normalized.mimeType, duration_seconds: normalized.durationSeconds },
      });
      await prepareManualEditor(normalized);
      return true;
    } catch (pickError) {
      const raw = pickError instanceof Error ? pickError.message : String(pickError ?? "");
      if (/Different document picking in progress/i.test(raw)) {
        await new Promise((r) => setTimeout(r, 700));
        try {
          const retry = await DocumentPicker.getDocumentAsync({
            type: "video/*",
            multiple: false,
            copyToCacheDirectory: true,
          });
          if (!retry.canceled && retry.assets?.[0]) {
            const normalizedRetry = applyPicked(
              {
                uri: retry.assets[0].uri,
                fileName: retry.assets[0].name,
                mimeType: retry.assets[0].mimeType,
                fileSize: retry.assets[0].size,
              },
              flowTraceId,
            );
            if (normalizedRetry) {
              setPicked(normalizedRetry);
              await prepareManualEditor(normalizedRetry);
              return true;
            }
          }
        } catch {
          // noop
        }
      }
      setError(pickerErrorMessage(pickError));
      void sendVideoClientLog({
        baseUrl: videoApiBase,
        traceId: flowTraceId,
        stage: "picker",
        event: "document_picker_failed",
        level: "error",
        meta: { raw_error: raw },
      });
      return false;
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
      const result = await launchLibraryWithTimeout();
      if (result.canceled || !result.assets?.[0]) {
        void sendVideoClientLog({
          baseUrl: videoApiBase,
          traceId: nextTraceId,
          stage: "picker",
          event: result.canceled ? "image_library_canceled" : "image_library_empty_assets",
        });
        return;
      }

      const normalized = applyPicked(result.assets[0], nextTraceId);
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
        event: "image_library_failed_fallback_document_picker",
        level: "warn",
        meta: { raw_error: pickError instanceof Error ? pickError.message : String(pickError ?? "") },
      });
      setStatus("Galeria instavel no iPhone. Abrindo fallback de arquivos...");
      await new Promise((r) => setTimeout(r, 700));
      const fallbackOk = await pickVideoWithDocumentPicker();
      if (!fallbackOk) setError(pickerErrorMessage(pickError));
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
  };

  const clearSplits = () => {
    setSplitPoints([]);
    syncSegments(cutStart, cutEnd, []);
    setStatus("Divisoes limpas.");
  };

  const markCutStart = () => {
    const next = Math.min(Math.max(0, positionSeconds), Math.max(0, cutEnd - 0.1));
    setCutStart(next);
    const filtered = splitPoints.filter((p) => p > next && p < cutEnd);
    setSplitPoints(filtered);
    syncSegments(next, cutEnd, filtered);
  };

  const markCutEnd = () => {
    const next = Math.max(positionSeconds, cutStart + 0.1);
    const bounded = durationSeconds ? Math.min(next, durationSeconds) : next;
    setCutEnd(bounded);
    const filtered = splitPoints.filter((p) => p > cutStart && p < bounded);
    setSplitPoints(filtered);
    syncSegments(cutStart, bounded, filtered);
  };

  const resetCut = () => {
    const end = durationSeconds || picked?.durationSeconds || 0;
    setCutStart(0);
    setCutEnd(end);
    setSplitPoints([]);
    syncSegments(0, end, []);
  };

  const useCurrentTimeForCaption = () => {
    const start = Math.max(0, positionSeconds);
    const end = Math.min(durationSeconds, start + 1.5);
    setCaptionStart(start.toFixed(2));
    setCaptionEnd(end.toFixed(2));
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
  };

  const deleteCaption = (id: string) => {
    setManualCaptions((prev) => prev.filter((c) => c.id !== id));
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

  return (
    <Screen plain style={styles.screen}>
      <LinearGradient colors={["#07090f", "#0a0d17", "#07090f"]} style={styles.bg}>
        <View style={styles.glowTop} />
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.topBar}>
            <TouchableOpacity style={styles.backIcon} onPress={() => router.back()} activeOpacity={0.9}>
              <Ionicons name="arrow-back" size={28} color="#eef2f8" />
            </TouchableOpacity>
            <Text style={styles.topTitle}>Editor Visual Pro</Text>
            <TouchableOpacity
              style={[styles.exportTopButton, !editorReady || exporting ? styles.exportTopDisabled : null]}
              onPress={() => void exportManual()}
              activeOpacity={0.9}
              disabled={!editorReady || exporting}
            >
              {exporting ? <ActivityIndicator color="#0d2507" size="small" /> : <Text style={styles.exportTopText}>Exportar</Text>}
            </TouchableOpacity>
          </View>

          {!editorReady ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Envie da galeria e abra o editor</Text>
              <Text style={styles.cardSubtitle}>Sem tela intermediaria. Um unico fluxo direto para editar manualmente.</Text>

              <TouchableOpacity style={styles.greenButton} activeOpacity={0.92} onPress={() => void pickVideoSmart()} disabled={loadingSource}>
                {loadingSource || pickingVideo ? <ActivityIndicator color="#102808" /> : <Ionicons name="play-circle" size={24} color="#102808" />}
                <Text style={styles.greenButtonText}>{loadingSource ? "Preparando..." : pickingVideo ? "Abrindo galeria..." : "Enviar da galeria"}</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.secondaryButton} activeOpacity={0.9} onPress={() => void pickVideoWithDocumentPicker()} disabled={loadingSource}>
                <Text style={styles.secondaryButtonText}>Escolher arquivo (fallback)</Text>
              </TouchableOpacity>

              {picked ? <Text style={styles.meta}>Arquivo: {picked.name}</Text> : null}
              <Text style={styles.statusText}>{status}</Text>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </View>
          ) : (
            <>
              <View style={styles.playerCard}>
                {playbackUrl ? (
                  <Video
                    ref={videoRef}
                    source={{ uri: playbackUrl }}
                    style={styles.player}
                    useNativeControls={false}
                    resizeMode={ResizeMode.COVER}
                    onLoad={(s) => {
                      const dur = (s.durationMillis || 0) / 1000;
                      ensureEditorSetupFromLoadedVideo(dur);
                      if (!cutEnd && dur > 0) setCutEnd(dur);
                    }}
                    onPlaybackStatusUpdate={(s) => {
                      if (!s.isLoaded) return;
                      setPositionSeconds((s.positionMillis || 0) / 1000);
                      if (!durationSeconds && s.durationMillis) setDurationSeconds((s.durationMillis || 0) / 1000);
                    }}
                  />
                ) : null}
              </View>

              <View style={styles.timerRow}>
                <Text style={styles.timerActive}>{formatTime(positionSeconds)}</Text>
                <View style={styles.timelineBarWrap}>
                  <View style={styles.timelineBarBg}>
                    <View style={[styles.timelineBarFill, { width: `${durationSeconds ? Math.max(2, Math.min(100, (positionSeconds / durationSeconds) * 100)) : 0}%` }]} />
                  </View>
                </View>
                <Text style={styles.timerMuted}>{formatTime(durationSeconds)}</Text>
              </View>

              <View style={styles.transportRow}>
                <TouchableOpacity style={styles.transportBtn} onPress={() => void videoRef.current?.setPositionAsync(Math.max(0, (positionSeconds - 1.5) * 1000))}>
                  <Ionicons name="play-back" size={22} color="#d8deea" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.transportPlay} onPress={() => void videoRef.current?.playAsync()}>
                  <Ionicons name="play" size={28} color="#56ee2f" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.transportBtn} onPress={() => void videoRef.current?.setPositionAsync(Math.min(durationSeconds, positionSeconds + 1.5) * 1000)}>
                  <Ionicons name="play-forward" size={22} color="#d8deea" />
                </TouchableOpacity>
              </View>

              <View style={styles.segmentCard}>
                <View style={styles.segmentHeader}>
                  <Text style={styles.segmentHeaderText}>{formatTime(cutStart)}</Text>
                  <Text style={styles.segmentHeaderText}>{formatTime(cutEnd || durationSeconds)}</Text>
                </View>

                <View style={styles.segmentList}>
                  {segments.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.segmentChip, s.enabled ? styles.segmentChipActive : null]}
                      onPress={() => toggleSegment(s.id)}
                      activeOpacity={0.9}
                    >
                      <Text style={[styles.segmentChipText, s.enabled ? styles.segmentChipTextActive : null]}>
                        {s.id} {formatTime(s.start)}-{formatTime(s.end)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.toolsCard}>
                <View style={styles.toolsTabs}>
                  <TouchableOpacity style={[styles.toolTab, tab === "cut" ? styles.toolTabActive : null]} onPress={() => setTab("cut")}>
                    <MaterialCommunityIcons name="content-cut" size={22} color={tab === "cut" ? "#5bf335" : "#a4adbc"} />
                    <Text style={[styles.toolTabText, tab === "cut" ? styles.toolTabTextActive : null]}>Cortar</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.toolTab, tab === "split" ? styles.toolTabActive : null]} onPress={() => setTab("split")}>
                    <MaterialCommunityIcons name="content-duplicate" size={22} color={tab === "split" ? "#5bf335" : "#a4adbc"} />
                    <Text style={[styles.toolTabText, tab === "split" ? styles.toolTabTextActive : null]}>Dividir</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.toolTab, tab === "text" ? styles.toolTabActive : null]} onPress={() => setTab("text")}>
                    <MaterialCommunityIcons name="format-text" size={22} color={tab === "text" ? "#5bf335" : "#a4adbc"} />
                    <Text style={[styles.toolTabText, tab === "text" ? styles.toolTabTextActive : null]}>Texto</Text>
                  </TouchableOpacity>
                </View>

                {tab === "cut" ? (
                  <View style={styles.toolBody}>
                    <Text style={styles.toolHint}>Defina o intervalo principal do corte pelo tempo atual.</Text>
                    <View style={styles.inlineButtons}>
                      <TouchableOpacity style={styles.smallAction} onPress={markCutStart}>
                        <Text style={styles.smallActionText}>Marcar inicio</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallAction} onPress={markCutEnd}>
                        <Text style={styles.smallActionText}>Marcar fim</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallAction} onPress={resetCut}>
                        <Text style={styles.smallActionText}>Resetar</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                {tab === "split" ? (
                  <View style={styles.toolBody}>
                    <Text style={styles.toolHint}>Divida em trechos e desligue os que nao quer no resultado final.</Text>
                    <View style={styles.inlineButtons}>
                      <TouchableOpacity style={styles.smallAction} onPress={addSplitAtCurrentTime}>
                        <Text style={styles.smallActionText}>Dividir no tempo atual</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.smallAction} onPress={clearSplits}>
                        <Text style={styles.smallActionText}>Limpar divisoes</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : null}

                {tab === "text" ? (
                  <View style={styles.toolBody}>
                    <View style={styles.captionModeRow}>
                      <TouchableOpacity style={[styles.captionModeChip, captionMode === "auto" ? styles.captionModeChipActive : null]} onPress={() => setCaptionMode("auto")}>
                        <Text style={[styles.captionModeText, captionMode === "auto" ? styles.captionModeTextActive : null]}>Legenda auto</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.captionModeChip, captionMode === "manual" ? styles.captionModeChipActive : null]}
                        onPress={() => setCaptionMode("manual")}
                      >
                        <Text style={[styles.captionModeText, captionMode === "manual" ? styles.captionModeTextActive : null]}>Legenda manual</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={[styles.captionModeChip, captionMode === "none" ? styles.captionModeChipActive : null]} onPress={() => setCaptionMode("none")}>
                        <Text style={[styles.captionModeText, captionMode === "none" ? styles.captionModeTextActive : null]}>Sem legenda</Text>
                      </TouchableOpacity>
                    </View>

                    {captionMode === "manual" ? (
                      <>
                        <View style={styles.manualRow}>
                          <View style={styles.manualInputWrap}>
                            <Text style={styles.inputLabel}>Inicio (s)</Text>
                            <TextInput style={styles.timeInput} value={captionStart} onChangeText={setCaptionStart} keyboardType="decimal-pad" />
                          </View>
                          <View style={styles.manualInputWrap}>
                            <Text style={styles.inputLabel}>Fim (s)</Text>
                            <TextInput style={styles.timeInput} value={captionEnd} onChangeText={setCaptionEnd} keyboardType="decimal-pad" />
                          </View>
                        </View>
                        <TextInput
                          style={styles.captionInput}
                          placeholder="Digite a legenda manual..."
                          placeholderTextColor="#7f8797"
                          value={captionDraft}
                          onChangeText={setCaptionDraft}
                        />
                        <View style={styles.inlineButtons}>
                          <TouchableOpacity style={styles.smallAction} onPress={useCurrentTimeForCaption}>
                            <Text style={styles.smallActionText}>Usar tempo atual</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.smallAction} onPress={addManualCaption}>
                            <Text style={styles.smallActionText}>Adicionar legenda</Text>
                          </TouchableOpacity>
                        </View>

                        <View style={styles.captionList}>
                          {manualCaptions.map((c) => (
                            <View key={c.id} style={styles.captionItem}>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.captionItemTime}>
                                  {formatTime(c.start)} - {formatTime(c.end)}
                                </Text>
                                <Text style={styles.captionItemText}>{c.text}</Text>
                              </View>
                              <TouchableOpacity onPress={() => deleteCaption(c.id)}>
                                <Text style={styles.captionDelete}>Excluir</Text>
                              </TouchableOpacity>
                            </View>
                          ))}
                          {!manualCaptions.length ? <Text style={styles.meta}>Sem legenda manual ainda.</Text> : null}
                        </View>
                      </>
                    ) : null}
                  </View>
                ) : null}
              </View>

              <View style={styles.bottomBar}>
                <TouchableOpacity style={styles.bottomAction} onPress={() => void videoRef.current?.setPositionAsync(Math.max(0, (positionSeconds - 2) * 1000))}>
                  <Ionicons name="play-back" size={22} color="#ced6e5" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.bottomPlay} onPress={() => void videoRef.current?.playAsync()}>
                  <Ionicons name="play" size={34} color="#57ef2f" />
                </TouchableOpacity>
                <TouchableOpacity style={styles.bottomAction} onPress={() => void videoRef.current?.setPositionAsync(Math.min(durationSeconds, positionSeconds + 2) * 1000)}>
                  <Ionicons name="play-forward" size={22} color="#ced6e5" />
                </TouchableOpacity>
              </View>

              <View style={styles.footerActions}>
                <TouchableOpacity style={styles.secondaryButton} onPress={() => void previewSegmented()}>
                  <Text style={styles.secondaryButtonText}>Preview editado</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.greenButton, exporting ? styles.disabled : null]} onPress={() => void exportManual()} disabled={exporting}>
                  {exporting ? <ActivityIndicator color="#102808" /> : <MaterialCommunityIcons name="content-save-check" size={22} color="#102808" />}
                  <Text style={styles.greenButtonText}>{exporting ? "Exportando..." : "Exportar versao manual"}</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.statusText}>{status}</Text>
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </>
          )}
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
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  backIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  topTitle: {
    color: "#eef2f8",
    fontSize: 50,
    lineHeight: 54,
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
  player: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#090d14",
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
  transportRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    backgroundColor: "rgba(12,16,24,0.88)",
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  transportBtn: {
    width: 58,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    backgroundColor: "rgba(20,25,36,0.9)",
  },
  transportPlay: {
    width: 74,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(87,239,47,0.52)",
    backgroundColor: "rgba(19,29,16,0.9)",
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
  toolsCard: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(11,16,24,0.92)",
    padding: 12,
    gap: 10,
  },
  toolsTabs: {
    flexDirection: "row",
    gap: 8,
  },
  toolTab: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    backgroundColor: "rgba(20,25,35,0.85)",
    minHeight: 62,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  toolTabActive: {
    borderColor: "rgba(87,239,47,0.75)",
    backgroundColor: "rgba(66,214,38,0.16)",
  },
  toolTabText: {
    color: "#a8b1c0",
    fontSize: 14,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  toolTabTextActive: {
    color: "#78f758",
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
  bottomBar: {
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
    width: 74,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(21,26,36,0.9)",
  },
  bottomPlay: {
    width: 180,
    height: 58,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(87,239,47,0.7)",
    backgroundColor: "rgba(19,29,16,0.94)",
    alignItems: "center",
    justifyContent: "center",
  },
  footerActions: {
    gap: 10,
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
