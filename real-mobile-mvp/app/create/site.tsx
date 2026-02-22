import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Easing,
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
  type SiteCodeBundle,
} from "../../src/services/siteBuilderApi";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";

type UiState = "idle" | "generating" | "error" | "published";

const PLACEHOLDER_MESSAGES = [
  "Ex: site premium para clínica, agenda online e depoimentos...",
  "Ex: landing page azul, moderna, com CTA forte no WhatsApp...",
  "Ex: site para restaurante com cardápio, reservas e entrega...",
];

const MAGIC_LOADING_STEPS = [
  "Interpretando seu pedido em linguagem natural...",
  "Desenhando estrutura e estilo da página...",
  "Escrevendo HTML, CSS e JS com alta fidelidade...",
  "Preparando preview ao vivo para você revisar...",
];

const TYPOGRAPHY_ANTI_CLIP_STYLE = `
<style id="real-anti-clip">
  h1, h2, h3, .hero__title, .title {
    line-height: 1.16 !important;
    padding-top: 0.14em !important;
    padding-bottom: 0.08em !important;
    overflow: visible !important;
    text-rendering: geometricPrecision !important;
    -webkit-font-smoothing: antialiased !important;
  }
  .hero__content, .content {
    overflow: visible !important;
  }
  button, .btn, [class*="btn"], [class*="button"] {
    box-shadow: none !important;
    filter: none !important;
    text-shadow: none !important;
  }
</style>`;

function mergeCodeToHtml(code?: SiteCodeBundle | null): string {
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
  ${TYPOGRAPHY_ANTI_CLIP_STYLE}
  ${css ? `<style>${css}</style>` : ""}
</head>
<body>
${html}
${js ? `<script>${js}</script>` : ""}
</body>
</html>`;
  }

  let merged = html;
  if (/<\/head>/i.test(merged)) {
    merged = merged.replace(/<\/head>/i, `${TYPOGRAPHY_ANTI_CLIP_STYLE}</head>`);
  } else {
    merged = `${TYPOGRAPHY_ANTI_CLIP_STYLE}${merged}`;
  }
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

function phaseLabel(state: UiState, publishing: boolean): string {
  if (publishing) return "publicando";
  if (state === "generating") return "gerando";
  if (state === "published") return "publicado";
  if (state === "error") return "erro";
  return "pronto";
}

export default function SiteCreatorV3() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uiState, setUiState] = useState<UiState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [webLoadError, setWebLoadError] = useState<string | null>(null);
  const [live, setLive] = useState<LiveSiteGenerateResponse | null>(null);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [typedPlaceholder, setTypedPlaceholder] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const ringAnim = useRef(new Animated.Value(0)).current;
  const shimmerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let messageIndex = 0;
    let charIndex = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const message = PLACEHOLDER_MESSAGES[messageIndex] || "Digite aqui como você quer seu site...";
      if (!deleting) {
        charIndex = Math.min(message.length, charIndex + 1);
        setTypedPlaceholder(message.slice(0, charIndex));
        if (charIndex >= message.length) {
          deleting = true;
          timer = setTimeout(tick, 1200);
          return;
        }
        timer = setTimeout(tick, 38);
        return;
      }

      charIndex = Math.max(0, charIndex - 1);
      setTypedPlaceholder(message.slice(0, charIndex));
      if (charIndex <= 0) {
        deleting = false;
        messageIndex = (messageIndex + 1) % PLACEHOLDER_MESSAGES.length;
        timer = setTimeout(tick, 240);
        return;
      }
      timer = setTimeout(tick, 20);
    };

    timer = setTimeout(tick, 300);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!loading) {
      setLoadingStep(0);
      return;
    }
    const interval = setInterval(() => {
      setLoadingStep((prev) => (prev + 1) % MAGIC_LOADING_STEPS.length);
    }, 1400);
    return () => clearInterval(interval);
  }, [loading]);

  useEffect(() => {
    if (!loading) {
      pulseAnim.stopAnimation();
      ringAnim.stopAnimation();
      shimmerAnim.stopAnimation();
      pulseAnim.setValue(0);
      ringAnim.setValue(0);
      shimmerAnim.setValue(0);
      return;
    }

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1100,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const ringLoop = Animated.loop(
      Animated.timing(ringAnim, {
        toValue: 1,
        duration: 1700,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    );
    const shimmerLoop = Animated.loop(
      Animated.timing(shimmerAnim, {
        toValue: 1,
        duration: 1500,
        easing: Easing.inOut(Easing.linear),
        useNativeDriver: true,
      }),
    );

    pulseLoop.start();
    ringLoop.start();
    shimmerLoop.start();
    return () => {
      pulseLoop.stop();
      ringLoop.stop();
      shimmerLoop.stop();
      pulseAnim.setValue(0);
      ringAnim.setValue(0);
      shimmerAnim.setValue(0);
    };
  }, [loading, pulseAnim, ringAnim, shimmerAnim]);

  const coreScale = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.92, 1.08],
  });
  const coreOpacity = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 1],
  });
  const ringScale = ringAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.7, 1.9],
  });
  const ringOpacity = ringAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.55, 0.05],
  });
  const shimmerTranslateX = shimmerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-180, 220],
  });

  const mergedHtml = useMemo(() => mergeCodeToHtml(live?.code || null), [live?.code]);
  const hasPreview = Boolean(mergedHtml || live?.previewUrl);

  const webSource = useMemo(() => {
    if (mergedHtml) {
      return {
        html: mergedHtml,
        baseUrl: live?.previewUrl || "http://68.183.49.208/",
      };
    }
    if (live?.previewUrl) {
      return { uri: live.previewUrl };
    }
    return { html: "<!doctype html><html><body></body></html>", baseUrl: "http://68.183.49.208/" };
  }, [mergedHtml, live?.previewUrl]);

  const sendPrompt = async () => {
    const prompt = input.trim();
    if (!prompt || loading || publishing) return;

    setError(null);
    setWebLoadError(null);
    setUiState("generating");
    setLoading(true);
    setInput("");

    try {
      const response = await generateLiveSite({
        prompt,
        previous: {
          slug: live?.slug,
          code: live?.code || undefined,
        },
      });
      setLive(response);
      setPublishedUrl(null);
      setUiState("idle");
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Falha ao gerar site com IA.";
      setError(message);
      setUiState("error");
    } finally {
      setLoading(false);
    }
  };

  const publish = async () => {
    if (!live?.slug || publishing) return;
    if (!live.code) {
      setError("Nada para publicar ainda. Gere um preview primeiro.");
      setUiState("error");
      return;
    }

    setError(null);
    setPublishing(true);

    try {
      const response = await publishLiveSite({
        slug: live.slug,
        code: live.code,
      });
      setPublishedUrl(response.publicUrl);
      setUiState("published");
    } catch (publishError) {
      const message = publishError instanceof Error ? publishError.message : "Falha ao publicar site.";
      setError(message);
      setUiState("error");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Screen plain style={styles.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.flex}>
        <View style={styles.container}>
          <View style={styles.previewWrap}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle}>Preview ao vivo</Text>
              <View style={styles.previewActions}>
                <Text style={styles.phaseText}>{phaseLabel(uiState, publishing)}</Text>
                <Pressable
                  style={[styles.publishButton, (!hasPreview || publishing || loading) && styles.buttonDisabled]}
                  onPress={() => void publish()}
                  disabled={!hasPreview || publishing || loading}
                >
                  <Text style={styles.publishButtonText}>{publishing ? "Publicando..." : "Publicar"}</Text>
                </Pressable>
              </View>
            </View>

            <View style={styles.previewBody}>
              {loading && !hasPreview ? (
                <View style={styles.centerState}>
                  <View style={styles.magicLoaderWrap}>
                    <Animated.View
                      style={[
                        styles.magicRing,
                        {
                          opacity: ringOpacity,
                          transform: [{ scale: ringScale }],
                        },
                      ]}
                    />
                    <Animated.View
                      style={[
                        styles.magicCore,
                        {
                          opacity: coreOpacity,
                          transform: [{ scale: coreScale }],
                        },
                      ]}
                    />
                    <Text style={styles.magicTitle}>Construindo seu site com IA</Text>
                    <Text style={styles.magicText}>{MAGIC_LOADING_STEPS[loadingStep]}</Text>
                    <View style={styles.magicTrack}>
                      <Animated.View
                        style={[
                          styles.magicShimmer,
                          {
                            transform: [{ translateX: shimmerTranslateX }],
                          },
                        ]}
                      />
                    </View>
                  </View>
                </View>
              ) : null}

              {!loading && hasPreview ? (
                <WebView
                  source={webSource}
                  originWhitelist={["*"]}
                  style={styles.webview}
                  onError={(event) => {
                    const desc = event.nativeEvent?.description || "Falha ao carregar preview.";
                    setWebLoadError(`Preview com falha (${desc}). Tente gerar novamente.`);
                    setUiState("error");
                  }}
                />
              ) : null}

              {!loading && !hasPreview ? (
                <View style={styles.centerState}>
                  <Text style={styles.centerTitle}>Digite abaixo como seu site deve ser</Text>
                  <Text style={styles.centerText}>Resultado em cima, edição por prompt embaixo. Sem modo modular.</Text>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.statusWrap}>
            {publishedUrl ? <Text style={styles.okText}>Publicado: {publishedUrl}</Text> : null}
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
            {webLoadError ? <Text style={styles.errorText}>{webLoadError}</Text> : null}
          </View>

          <View style={styles.inputFloatWrap}>
            <View style={[styles.inputDock, inputFocused && styles.inputDockFocused]}>
              <View style={styles.inputInner}>
                <TextInput
                  value={input}
                  onChangeText={setInput}
                  onSubmitEditing={() => void sendPrompt()}
                  returnKeyType="send"
                  blurOnSubmit={false}
                  autoCorrect={false}
                  autoCapitalize="sentences"
                  placeholder={typedPlaceholder || "Digite aqui como você quer seu site..."}
                  placeholderTextColor="rgba(237,237,238,0.38)"
                  style={styles.dockInput}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                />
              </View>
              <Pressable
                style={[styles.sendButton, (!input.trim() || loading || publishing) && styles.buttonDisabled]}
                onPress={() => void sendPrompt()}
                disabled={loading || publishing || !input.trim()}
              >
                {loading ? (
                  <ActivityIndicator color="#071306" size="small" />
                ) : (
                  <Ionicons name="arrow-up" size={18} color="#071306" />
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: "#05070A",
  },
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: "#05070A",
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: Platform.OS === "ios" ? 22 : 12,
  },
  previewWrap: {
    flex: 1,
    borderRadius: 18,
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
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 15,
  },
  previewActions: {
    flexDirection: "row",
    alignItems: "center",
  },
  phaseText: {
    marginRight: 8,
    color: "rgba(237,237,238,0.55)",
    textTransform: "uppercase",
    letterSpacing: 0.7,
    fontSize: 10,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  publishButton: {
    borderRadius: 999,
    backgroundColor: realTheme.colors.green,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  publishButtonText: {
    color: "#071306",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 12,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  previewBody: {
    flex: 1,
    backgroundColor: "#0C1117",
  },
  webview: {
    flex: 1,
    backgroundColor: "#0C1117",
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  magicLoaderWrap: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  magicRing: {
    position: "absolute",
    width: 148,
    height: 148,
    borderRadius: 74,
    borderWidth: 1.5,
    borderColor: "rgba(69,255,102,0.4)",
  },
  magicCore: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(69,255,102,0.16)",
    borderWidth: 1,
    borderColor: "rgba(69,255,102,0.85)",
    shadowColor: "#45ff66",
    shadowOpacity: 0.35,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
    marginBottom: 18,
  },
  magicTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 17,
    textAlign: "center",
    marginBottom: 6,
  },
  magicText: {
    color: "rgba(237,237,238,0.76)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 13,
    textAlign: "center",
    marginBottom: 12,
    minHeight: 18,
  },
  magicTrack: {
    width: 230,
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(69,255,102,0.22)",
  },
  magicShimmer: {
    width: 110,
    height: "100%",
    borderRadius: 999,
    backgroundColor: "rgba(69,255,102,0.85)",
    opacity: 0.85,
  },
  centerTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 17,
    textAlign: "center",
    marginTop: 10,
  },
  centerText: {
    marginTop: 6,
    color: "rgba(237,237,238,0.68)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 14,
    textAlign: "center",
  },
  okText: {
    marginTop: 2,
    color: "#8CFF7A",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
  },
  errorText: {
    marginTop: 2,
    color: "#FF9090",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
  },
  statusWrap: {
    marginTop: 8,
    marginBottom: 10,
    minHeight: 16,
    justifyContent: "center",
    zIndex: 2,
  },
  inputFloatWrap: {
    marginTop: 10,
    position: "relative",
  },
  inputDock: {
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(8,13,20,0.96)",
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
  },
  inputDockFocused: {
    borderColor: "rgba(69,255,102,0.72)",
  },
  inputInner: {
    flex: 1,
    minHeight: 38,
    borderRadius: 999,
    backgroundColor: "transparent",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  dockInput: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 16,
    minHeight: 32,
  },
  sendButton: {
    marginLeft: 8,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: realTheme.colors.green,
    shadowOpacity: 0,
    elevation: 0,
  },
});
