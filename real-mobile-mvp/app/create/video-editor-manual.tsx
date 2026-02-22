import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { WebView } from "react-native-webview";
import { fetchVideo, type VideoItem } from "../../src/services/videoEditorApi";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";

type ManualMessage =
  | { type: "manual_export_started"; videoId: string }
  | { type: "manual_export_queued"; baseVideoId: string; videoId: string }
  | { type: "manual_export_failed"; videoId: string; error: string };

function statusColor(status: string): string {
  if (/falha|erro/i.test(status)) return "#ff7f7f";
  if (/concluida|pronto/i.test(status)) return "#57ef2f";
  return "#cdd5e1";
}

export default function VideoEditorManualScreen() {
  const params = useLocalSearchParams<{ editorUrl?: string | string[]; baseVideoId?: string | string[]; apiBase?: string | string[] }>();
  const editorUrl = Array.isArray(params.editorUrl) ? params.editorUrl[0] : params.editorUrl;
  const baseVideoId = Array.isArray(params.baseVideoId) ? params.baseVideoId[0] : params.baseVideoId;
  const apiBase = Array.isArray(params.apiBase) ? params.apiBase[0] : params.apiBase;

  const [status, setStatus] = useState("Editor manual pronto.");
  const [exportVideo, setExportVideo] = useState<VideoItem | null>(null);
  const [polling, setPolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const canRenderWeb = useMemo(() => Boolean(editorUrl && /^https?:\/\//.test(editorUrl)), [editorUrl]);

  const stopPolling = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setPolling(false);
  };

  useEffect(() => {
    return () => stopPolling();
  }, []);

  const startPollingVideo = (videoId: string) => {
    if (!apiBase) {
      setStatus("API de video indisponivel para atualizar status.");
      return;
    }

    stopPolling();
    setPolling(true);
    timerRef.current = setInterval(() => {
      void fetchVideo(apiBase, videoId)
        .then((current) => {
          setExportVideo(current);
          if (current.status === "COMPLETE") {
            setStatus("Exportacao manual concluida. Volte para visualizar e baixar.");
            stopPolling();
          } else if (current.status === "FAILED") {
            setStatus(`Falha na exportacao manual: ${current.error?.message || "erro"}`);
            stopPolling();
          } else {
            const pct = Math.max(1, Math.round((current.progress || 0) * 100));
            setStatus(`Exportacao manual em andamento (${pct}%).`);
          }
        })
        .catch((error) => {
          setStatus(`Erro ao consultar exportacao manual: ${String(error)}`);
        });
    }, 2000);
  };

  const handleMessage = (rawData: string) => {
    try {
      const parsed = JSON.parse(rawData) as ManualMessage;
      if (parsed.type === "manual_export_started") {
        setStatus(`Exportacao manual iniciada para ${parsed.videoId}.`);
      } else if (parsed.type === "manual_export_queued") {
        setStatus(`Exportacao manual enfileirada: ${parsed.videoId}.`);
        startPollingVideo(parsed.videoId);
      } else if (parsed.type === "manual_export_failed") {
        setStatus(`Falha na exportacao manual: ${parsed.error}`);
      }
    } catch {
      setStatus("Mensagem invalida recebida do editor manual.");
    }
  };

  return (
    <Screen plain style={styles.screen}>
      <LinearGradient colors={["#07090f", "#0a0d17", "#07090f"]} style={styles.bg}>
        <View style={styles.glowTop} />

        <View style={styles.headerCard}>
          <View style={styles.headerTopRow}>
            <Text style={styles.kicker}>Editor manual</Text>
            {polling ? <ActivityIndicator color="#57ef2f" size="small" /> : null}
          </View>
          <Text style={styles.title}>Ajuste fino no seu video</Text>
          <Text style={[styles.status, { color: statusColor(status) }]}>{status}</Text>
          <View style={styles.metaRow}>
            {baseVideoId ? (
              <View style={styles.metaChip}>
                <Ionicons name="videocam" size={14} color="#9fd7ff" />
                <Text style={styles.metaChipText}>Base: {baseVideoId}</Text>
              </View>
            ) : null}
            {exportVideo?.id ? (
              <View style={styles.metaChip}>
                <MaterialCommunityIcons name="movie-check-outline" size={14} color="#57ef2f" />
                <Text style={styles.metaChipText}>Export: {exportVideo.id}</Text>
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.webWrap}>
          {canRenderWeb && editorUrl ? (
            <WebView
              source={{ uri: editorUrl }}
              style={styles.web}
              onMessage={(event) => handleMessage(event.nativeEvent.data)}
              javaScriptEnabled
              domStorageEnabled
              mediaPlaybackRequiresUserAction={false}
              allowsInlineMediaPlayback
              startInLoadingState
              renderLoading={() => (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="large" color="#57ef2f" />
                  <Text style={styles.loadingText}>Carregando editor visual...</Text>
                </View>
              )}
            />
          ) : (
            <View style={styles.emptyState}>
              <MaterialCommunityIcons name="alert-circle-outline" size={26} color="#ff8d8d" />
              <Text style={styles.emptyText}>Nao foi possivel abrir o editor manual neste ambiente.</Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={styles.backButton} activeOpacity={0.9} onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={20} color="#102808" />
          <Text style={styles.backButtonText}>Voltar</Text>
        </TouchableOpacity>
      </LinearGradient>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bg: {
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 16,
    gap: 10,
  },
  glowTop: {
    position: "absolute",
    top: -120,
    left: -80,
    width: 240,
    height: 240,
    borderRadius: 120,
    backgroundColor: "rgba(64,232,31,0.12)",
  },
  headerCard: {
    borderRadius: 20,
    backgroundColor: "rgba(10,14,22,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    padding: 12,
    gap: 8,
  },
  headerTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  kicker: {
    color: "#88ff67",
    fontSize: 12,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  title: {
    color: "#f1f4fa",
    fontSize: 31,
    lineHeight: 34,
    letterSpacing: -0.4,
    fontFamily: realTheme.fonts.title,
  },
  status: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  metaRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  metaChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.17)",
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: "rgba(17,21,30,0.82)",
  },
  metaChipText: {
    color: "#b6becd",
    fontSize: 12,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  webWrap: {
    flex: 1,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.13)",
    backgroundColor: "rgba(8,11,16,0.9)",
  },
  web: {
    flex: 1,
    backgroundColor: "#090d14",
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#090d14",
  },
  loadingText: {
    color: "#c8d1e0",
    fontSize: 14,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    gap: 8,
  },
  emptyText: {
    color: "#d5dce8",
    textAlign: "center",
    fontSize: 14,
    lineHeight: 20,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  backButton: {
    minHeight: 50,
    borderRadius: 999,
    backgroundColor: "#57ef2f",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    shadowColor: "#53ef2b",
    shadowOpacity: 0.38,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
  },
  backButtonText: {
    color: "#102808",
    fontSize: 18,
    fontFamily: realTheme.fonts.bodyBold,
    letterSpacing: -0.2,
  },
});
