import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { createManualEditorSession } from "../../src/services/videoEditorApi";
import { humanizeVideoError } from "../../src/services/videoEditorPresenter";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Field } from "../../src/ui/components/Field";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, Title } from "../../src/ui/components/Typography";

function extractVideoId(raw: string): string {
  const value = raw.trim();
  if (!value) return "";

  const contentMatch = value.match(/\/v1\/videos\/([^/]+)\/content(?:[?#]|$)/i);
  if (contentMatch?.[1]) return contentMatch[1];

  const directIdMatch = value.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  if (directIdMatch) return value;

  return "";
}

export default function VideoEditorManualHubScreen() {
  const [rawVideoId, setRawVideoId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoApiBase = useMemo(() => {
    const raw = process.env.EXPO_PUBLIC_VIDEO_EDITOR_API_BASE_URL?.trim() ?? "";
    return raw ? raw.replace(/\/+$/, "") : "";
  }, []);

  const normalizedVideoId = extractVideoId(rawVideoId);
  const canOpen = Boolean(videoApiBase && normalizedVideoId && !opening);

  const openManualEditor = async () => {
    if (!videoApiBase || !normalizedVideoId || opening) return;
    setOpening(true);
    setError(null);
    try {
      const session = await createManualEditorSession(videoApiBase, normalizedVideoId, orderId.trim() || undefined);
      router.push({
        pathname: "/create/video-editor-manual",
        params: {
          editorUrl: session.editorUrl,
          baseVideoId: normalizedVideoId,
          apiBase: videoApiBase,
        },
      });
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : "Nao foi possivel abrir o editor manual.";
      setError(humanizeVideoError(message));
    } finally {
      setOpening(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <Kicker>Editor manual</Kicker>
          <Title>Ajuste final em tela separada</Title>
          <Body>Cole o ID do video (ou URL /content) para abrir o editor manual em outra tela.</Body>
        </Card>

        <Card>
          <Field
            label="Video ID ou URL final"
            value={rawVideoId}
            onChangeText={setRawVideoId}
            placeholder="Ex.: 9a238ca5-... ou http://.../v1/videos/{id}/content"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field
            label="Order ID (opcional)"
            value={orderId}
            onChangeText={setOrderId}
            placeholder="Ex.: pedido da fila"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.actions}>
            <Button label={opening ? "Abrindo..." : "Abrir editor manual"} onPress={() => void openManualEditor()} disabled={!canOpen} />
          </View>
          {!videoApiBase ? <Body style={styles.hint}>Backend de video nao configurado neste ambiente.</Body> : null}
          {!normalizedVideoId && rawVideoId.trim() ? <Body style={styles.hint}>Nao consegui identificar um video ID valido.</Body> : null}
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
  },
  hint: {
    marginTop: 8,
    color: realTheme.colors.muted,
  },
  error: {
    marginTop: 8,
    color: "#ff7070",
  },
});
