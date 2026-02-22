import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import { fetchVideo, type VideoItem } from "../../src/services/videoEditorApi";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, Title } from "../../src/ui/components/Typography";

type ManualMessage =
  | { type: "manual_export_started"; videoId: string }
  | { type: "manual_export_queued"; baseVideoId: string; videoId: string }
  | { type: "manual_export_failed"; videoId: string; error: string };

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
    <Screen>
      <View style={styles.content}>
        <Card>
          <Kicker>Editor manual</Kicker>
          <Title>Refine seu video sem sair do app</Title>
          <Body>{status}</Body>
          {baseVideoId ? <Body style={styles.meta}>Base: {baseVideoId}</Body> : null}
          {exportVideo?.id ? <Body style={styles.meta}>Exportando: {exportVideo.id}</Body> : null}
          {polling ? <ActivityIndicator color={realTheme.colors.green} style={styles.loader} /> : null}
        </Card>

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
            />
          ) : (
            <Card>
              <Body>Nao foi possivel abrir o editor manual neste ambiente.</Body>
            </Card>
          )}
        </View>

        <Card>
          <Button label="Voltar para o editor" onPress={() => router.back()} variant="secondary" />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    paddingBottom: 16,
    flex: 1,
  },
  meta: {
    marginTop: 4,
    color: realTheme.colors.muted,
  },
  loader: {
    marginTop: 8,
  },
  webWrap: {
    flex: 1,
    minHeight: 500,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
  web: {
    flex: 1,
    backgroundColor: "#0b0b0c",
  },
});
