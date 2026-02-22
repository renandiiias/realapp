import { router } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, View } from "react-native";
import {
  createManualEditorSession,
  fetchVideo,
  submitManualSourceJob,
  type VideoItem,
} from "../../src/services/videoEditorApi";
import { humanizeVideoError, mapVideoStatusToClientLabel } from "../../src/services/videoEditorPresenter";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

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

function hasAcceptedExtension(name: string): boolean {
  const lowered = name.toLowerCase();
  return ACCEPTED_EXTENSIONS.some((ext) => lowered.endsWith(ext));
}

function pickerErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  if (/PHPhotosErrorDomain/i.test(raw) && /3164/.test(raw)) {
    return "Nao consegui abrir esse video da galeria. Tente baixar o arquivo no iPhone (se estiver no iCloud) ou escolha outro video.";
  }
  return "Falha ao abrir video da galeria. Tente novamente.";
}

function isIosPhotos3164(error: unknown): boolean {
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return /PHPhotosErrorDomain/i.test(raw) && /3164/.test(raw);
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

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <Kicker>Editar sozinho</Kicker>
          <Title>Envie da galeria e abra o editor manual</Title>
          <Body>Este fluxo nao usa corte automatico. Ele prepara seu arquivo para abrir no editor manual.</Body>
        </Card>

        <Card>
          <SubTitle>1) Envie o video</SubTitle>
          <View style={styles.actions}>
            <Button label="Enviar da galeria" onPress={() => void pickVideoFromLibrary()} disabled={submitting} />
            <Button label="Escolher arquivo (fallback)" variant="secondary" onPress={() => void pickVideoWithDocumentPicker()} disabled={submitting} />
          </View>
          {picked ? (
            <View style={styles.meta}>
              <Body>Arquivo: {picked.name}</Body>
              <Body>Duracao: {picked.durationSeconds > 0 ? `${picked.durationSeconds.toFixed(2)}s` : "nao detectada"}</Body>
              {picked.sizeBytes ? <Body>Tamanho: {(picked.sizeBytes / (1024 * 1024)).toFixed(1)}MB</Body> : null}
            </View>
          ) : null}
        </Card>

        <Card>
          <SubTitle>2) Preparar para editor manual</SubTitle>
          <Body style={styles.hint}>{mapVideoStatusToClientLabel(video?.status, progress)}</Body>
          {video?.status === "PROCESSING" ? <Body style={styles.hint}>{Math.max(1, Math.round(progress * 100))}% concluido</Body> : null}
          <View style={styles.actions}>
            <Button label={submitting ? "Enviando..." : "Preparar video"} onPress={() => void submitManualSource()} disabled={!picked || submitting || !hasRemoteEditor} />
          </View>
        </Card>

        <Card>
          <SubTitle>3) Abrir editor manual</SubTitle>
          <View style={styles.actions}>
            <Button
              label={openingEditor ? "Abrindo..." : "Abrir editor manual"}
              onPress={() => void openManualEditor()}
              disabled={!video || video.status !== "COMPLETE" || openingEditor}
            />
          </View>
          {!hasRemoteEditor ? <Body style={styles.hint}>Backend de video nao configurado neste ambiente.</Body> : null}
          {submitting || openingEditor ? <ActivityIndicator color={realTheme.colors.green} style={styles.loader} /> : null}
          {error ? <Body style={styles.error}>{error}</Body> : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
    paddingBottom: 42,
  },
  actions: {
    marginTop: 10,
    gap: 10,
  },
  meta: {
    marginTop: 10,
    gap: 3,
  },
  hint: {
    marginTop: 6,
    color: realTheme.colors.muted,
  },
  loader: {
    marginTop: 8,
  },
  error: {
    marginTop: 8,
    color: "#ff7070",
  },
});
