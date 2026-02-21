import { LinearGradient } from "expo-linear-gradient";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { WebView } from "react-native-webview";
import {
  generateLiveSite,
  publishLiveSite,
  type LiveSiteGenerateResponse,
} from "../../src/services/siteBuilderApi";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";

type Message = {
  id: string;
  text: string;
  role: "user" | "system";
};

function nowId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function mergeCodeToHtml(code?: { html?: string; css?: string; js?: string } | null): string {
  const html = String(code?.html || "").trim();
  const css = String(code?.css || "").trim();
  const js = String(code?.js || "").trim();
  if (!html) return "";

  if (!/<html[\s>]/i.test(html)) {
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Preview</title>
  ${css ? `<style>${css}</style>` : ""}
</head>
<body>
${html}
${js ? `<script>${js}</script>` : ""}
</body>
</html>`;
  }

  let merged = html;
  if (css) {
    if (/<\/head>/i.test(merged)) merged = merged.replace(/<\/head>/i, `<style>${css}</style></head>`);
    else merged = `<style>${css}</style>${merged}`;
  }
  if (js) {
    if (/<\/body>/i.test(merged)) merged = merged.replace(/<\/body>/i, `<script>${js}</script></body>`);
    else merged = `${merged}<script>${js}</script>`;
  }
  return merged;
}

const HERO_PLACEHOLDERS = [
  "Digite aqui, como vc quer que seu site seja...",
  "Ex: quero um site todo azul com visual moderno",
  "Ex: landing page elegante para clínica estética",
  "Ex: site com foco em WhatsApp e conversão",
];

export default function SiteCreatorV2() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [docked, setDocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveSiteGenerateResponse | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState(HERO_PLACEHOLDERS[0]);
  const [webLoadError, setWebLoadError] = useState<string | null>(null);
  const floatY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatY, { toValue: -6, duration: 3000, useNativeDriver: true }),
        Animated.timing(floatY, { toValue: 0, duration: 3000, useNativeDriver: true }),
      ]),
    ).start();
  }, [floatY]);

  useEffect(() => {
    let placeholderIndex = 0;
    let charIndex = 1;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = true;

    const tick = () => {
      if (!active) return;
      const current = HERO_PLACEHOLDERS[placeholderIndex] || HERO_PLACEHOLDERS[0];
      const nextText = current.slice(0, Math.max(1, charIndex));
      setAnimatedPlaceholder(nextText);

      if (!deleting) {
        if (charIndex < current.length) {
          charIndex += 1;
          timer = setTimeout(tick, 38);
          return;
        }
        deleting = true;
        timer = setTimeout(tick, 1200);
        return;
      }

      if (charIndex > 16) {
        charIndex -= 1;
        timer = setTimeout(tick, 24);
        return;
      }

      deleting = false;
      placeholderIndex = (placeholderIndex + 1) % HERO_PLACEHOLDERS.length;
      timer = setTimeout(tick, 120);
    };

    timer = setTimeout(tick, 200);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const sendPrompt = async () => {
    const prompt = input.trim();
    if (!prompt || loading || publishing) return;

    setError(null);
    setWebLoadError(null);
    setInput("");
    setDocked(true);
    setMessages((prev) => [...prev, { id: nowId(), text: prompt, role: "user" }]);
    setLoading(true);

    try {
      const response = await generateLiveSite({
        prompt,
        previous: {
          slug: live?.slug,
          code: live?.code || undefined,
          builderSpec: live?.builderSpec,
        },
      });
      setLive(response);
      setPublishedUrl(null);
      setWebLoadError(null);
      setMessages((prev) => [
        ...prev,
        {
          id: nowId(),
          role: "system",
          text: "Preview atualizado. Digite ajustes para editar o site com IA.",
        },
      ]);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Falha ao gerar site.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const publish = async () => {
    if (!live?.builderSpec || !live.slug || publishing) return;
    setPublishing(true);
    setError(null);
    try {
      const response = await publishLiveSite({
        slug: live.slug,
        builderSpec: live.builderSpec,
      });
      setPublishedUrl(response.publicUrl);
      setMessages((prev) => [
        ...prev,
        {
          id: nowId(),
          role: "system",
          text: `Site publicado: ${response.publicUrl}`,
        },
      ]);
    } catch (publishError) {
      const message = publishError instanceof Error ? publishError.message : "Falha ao publicar.";
      setError(message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Screen plain style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View style={styles.canvas}>
          <View style={styles.bgGlowPrimary} />
          <View style={styles.bgGlowSecondary} />
          <LinearGradient
            colors={["#0A0D12", "#07090C"]}
            start={{ x: 0.5, y: 0 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.bgGradient}
          />
          {!docked ? (
            <Animated.View style={[styles.heroWrap, { transform: [{ translateY: floatY }] }]}>
              <Text style={styles.heroTitle}>Criador de{"\n"}Sites IA</Text>
              <View style={styles.promptWrap}>
                <View style={styles.glowHaloOuter} />
                <View style={styles.glowHaloDots} />
                <LinearGradient
                  colors={["rgba(69,255,102,0.45)", "rgba(69,255,102,0.95)", "rgba(69,255,102,0.45)"]}
                  start={{ x: 0, y: 0.5 }}
                  end={{ x: 1, y: 0.5 }}
                  style={styles.floatingInputWrap}
                >
                  <TextInput
                    value={input}
                    onChangeText={setInput}
                    onSubmitEditing={() => void sendPrompt()}
                    returnKeyType="send"
                    blurOnSubmit
                    placeholder={animatedPlaceholder}
                    placeholderTextColor="rgba(255,255,255,0.35)"
                    style={styles.floatingInput}
                  />
                </LinearGradient>
              </View>
              <Text style={styles.heroHint}>Pressione Enter para começar.</Text>
            </Animated.View>
          ) : null}

          {docked ? (
            <View style={styles.workArea}>
              {loading ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator color={realTheme.colors.green} size="large" />
                  <Text style={styles.loadingText}>Construindo seu site com IA...</Text>
                </View>
              ) : null}

              {!loading && (live?.code?.html || live?.previewUrl) ? (
                <View style={styles.previewWrap}>
                  <View style={styles.previewHeader}>
                    <Text style={styles.previewTitle}>Preview ao vivo</Text>
                    <Pressable style={styles.publishButton} onPress={() => void publish()} disabled={publishing}>
                      <Text style={styles.publishButtonText}>{publishing ? "Publicando..." : "Publicar"}</Text>
                    </Pressable>
                  </View>
                  <WebView
                    source={
                      live?.code?.html
                        ? { html: mergeCodeToHtml(live.code), baseUrl: live.previewUrl || "http://68.183.49.208/" }
                        : { uri: live?.previewUrl || "" }
                    }
                    onError={(event) => {
                      const desc = event.nativeEvent?.description || "Falha ao carregar preview.";
                      setWebLoadError(`Preview com falha de rede (${desc}).`);
                    }}
                    style={styles.webview}
                  />
                </View>
              ) : null}

              {publishedUrl ? <Text style={styles.okText}>Publicado: {publishedUrl}</Text> : null}
              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {webLoadError ? <Text style={styles.errorText}>{webLoadError}</Text> : null}

              <View style={styles.logWrap}>
                {messages.slice(-4).map((msg) => (
                  <Text key={msg.id} style={msg.role === "user" ? styles.userMsg : styles.systemMsg}>
                    {msg.role === "user" ? `Você: ${msg.text}` : msg.text}
                  </Text>
                ))}
              </View>
            </View>
          ) : null}
        </View>

        {docked ? (
          <View style={styles.bottomDock}>
            <TextInput
              value={input}
              onChangeText={setInput}
              onSubmitEditing={() => void sendPrompt()}
              returnKeyType="send"
              blurOnSubmit
              placeholder={animatedPlaceholder}
              placeholderTextColor="rgba(237,237,238,0.45)"
              style={styles.dockInput}
            />
            <Pressable style={styles.sendButton} onPress={() => void sendPrompt()} disabled={loading || publishing || !input.trim()}>
              <Text style={styles.sendButtonText}>{loading ? "..." : "Enviar"}</Text>
            </Pressable>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#07090C",
  },
  flex: {
    flex: 1,
  },
  canvas: {
    flex: 1,
    backgroundColor: "#07090C",
  },
  bgGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  bgGlowPrimary: {
    position: "absolute",
    width: 900,
    height: 600,
    borderRadius: 900,
    backgroundColor: "rgba(69,255,102,0.08)",
    left: -120,
    top: 120,
  },
  bgGlowSecondary: {
    position: "absolute",
    width: 700,
    height: 500,
    borderRadius: 700,
    backgroundColor: "rgba(69,255,102,0.05)",
    left: -20,
    top: 180,
  },
  heroWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    gap: 14,
  },
  heroTitle: {
    color: "#F4F6FB",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 64,
    lineHeight: 60,
    letterSpacing: -1.2,
    textAlign: "center",
  },
  promptWrap: {
    width: "100%",
    marginTop: 12,
  },
  heroHint: {
    color: "rgba(255,255,255,0.55)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 16,
    textShadowColor: "rgba(0,0,0,0.6)",
    textShadowRadius: 18,
  },
  floatingInputWrap: {
    width: "100%",
    borderRadius: 999,
    padding: 2,
    shadowColor: "rgba(0,0,0,0.85)",
    shadowOpacity: 0.55,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 14,
  },
  glowHaloOuter: {
    position: "absolute",
    left: -26,
    right: -26,
    top: -26,
    bottom: -26,
    borderRadius: 999,
    backgroundColor: "rgba(69,255,102,0.18)",
    opacity: 0.9,
  },
  glowHaloDots: {
    position: "absolute",
    left: -14,
    right: -14,
    top: -14,
    bottom: -14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(69,255,102,0.22)",
    opacity: 0.7,
  },
  floatingInput: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 18,
    minHeight: 58,
    borderRadius: 999,
    paddingHorizontal: 22,
    backgroundColor: "rgba(10,14,18,0.72)",
    borderWidth: 1,
    borderColor: "rgba(69,255,102,0.22)",
  },
  workArea: {
    flex: 1,
    paddingTop: 16,
    paddingHorizontal: 12,
    paddingBottom: 88,
    gap: 10,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 14,
  },
  loadingText: {
    color: "rgba(237,237,238,0.86)",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 14,
  },
  previewWrap: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "#0C1117",
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0A0F15",
  },
  previewTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 14,
  },
  publishButton: {
    borderRadius: 999,
    backgroundColor: realTheme.colors.green,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  publishButtonText: {
    color: "#071306",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 12,
  },
  webview: {
    flex: 1,
    backgroundColor: "#0C1117",
  },
  logWrap: {
    gap: 6,
    maxHeight: 92,
  },
  userMsg: {
    color: "#CBF7C3",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
  },
  systemMsg: {
    color: "rgba(237,237,238,0.78)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 12,
  },
  okText: {
    color: "#8CFF7A",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
  },
  errorText: {
    color: "#FF9090",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
  },
  bottomDock: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: Platform.OS === "ios" ? 28 : 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 2,
    borderColor: "rgba(53,226,20,0.55)",
    backgroundColor: "rgba(10,16,23,0.97)",
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dockInput: {
    flex: 1,
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 16,
    minHeight: 30,
  },
  sendButton: {
    borderRadius: 999,
    backgroundColor: realTheme.colors.green,
    paddingHorizontal: 24,
    paddingVertical: 11,
  },
  sendButtonText: {
    color: "#071306",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 18,
  },
});
