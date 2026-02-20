import { router, useLocalSearchParams } from "expo-router";
import { Animated, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { PROFILE_FIELD_LABELS } from "../../src/auth/profileReadiness";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { RealLogo } from "../../src/ui/components/RealLogo";
import { Screen } from "../../src/ui/components/Screen";
import { realTheme } from "../../src/theme/realTheme";
import { Body } from "../../src/ui/components/Typography";
import { useEffect, useRef, useState } from "react";
import { routeWithIntent, targetToPath } from "../../src/ai/intentRouter";

const promptExamples = [
  "Preciso vender mais pelo WhatsApp",
  "Criar campanha para encher agenda esta semana",
  "Quero uma landing page pronta para vender",
  "Preciso de criativos e plano de anúncios no Meta",
];
const promptSuggestions = [
  "Preciso vender mais no WhatsApp",
  "Quero anúncios para vender mais este mês",
  "Quero uma landing page pronta para vender",
];
const quickServices: Array<{ id: "site" | "ads" | "video"; label: string; prompt: string }> = [
  { id: "site", label: "Criar site", prompt: "Quero criar um site" },
  { id: "ads", label: "Fazer anúncio", prompt: "Quero fazer um anúncio" },
  { id: "video", label: "Editar vídeo", prompt: "Quero editar um vídeo" },
];

export default function Home() {
  const auth = useAuth();
  const params = useLocalSearchParams<{ prompt?: string }>();
  const [prompt, setPrompt] = useState("");
  const [routing, setRouting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [typedPrompt, setTypedPrompt] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);

  const pulse = useRef(new Animated.Value(0)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;
  const ctaAppear = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const value = typeof params.prompt === "string" ? params.prompt.trim() : "";
    if (value) setPrompt(value);
  }, [params.prompt]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1900, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 1900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    const id = setInterval(() => setCursorVisible((v) => !v), 430);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const hasText = prompt.trim().length > 0;
    Animated.spring(ctaAppear, {
      toValue: hasText ? 1 : 0,
      useNativeDriver: true,
      friction: 8,
      tension: 70,
    }).start();
  }, [prompt, ctaAppear]);

  useEffect(() => {
    if (prompt.trim().length > 0) return;

    const sample = promptExamples[exampleIndex] ?? "";
    if (!sample) return;
    const speed = deleting ? 18 : 34;

    const timer = setTimeout(() => {
      if (!deleting) {
        if (typedPrompt.length < sample.length) {
          setTypedPrompt(sample.slice(0, typedPrompt.length + 1));
          return;
        }
        setDeleting(true);
        return;
      }

      if (typedPrompt.length > 0) {
        setTypedPrompt(sample.slice(0, typedPrompt.length - 1));
        return;
      }

      setDeleting(false);
      setExampleIndex((idx) => (idx + 1) % promptExamples.length);
    }, typedPrompt.length === sample.length && !deleting ? 1250 : speed);

    return () => clearTimeout(timer);
  }, [typedPrompt, deleting, exampleIndex, prompt]);

  const startFromPrompt = async () => {
    const clean = prompt.trim();
    if (!clean) return;

    setRouting(true);
    const result = await routeWithIntent(clean);
    const targetPath = targetToPath(result.target);

    setToast(result.message);
    Animated.sequence([
      Animated.timing(toastOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.delay(1200),
      Animated.timing(toastOpacity, { toValue: 0, duration: 180, useNativeDriver: true }),
    ]).start(() => {
      setToast(null);
      router.push({ pathname: targetPath as never, params: { prompt: clean } as never });
      setRouting(false);
    });
  };

  const applySuggestion = (value: string) => {
    setPrompt(value);
  };

  const pulseBorderColor = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: ["rgba(53,226,20,0.26)", "rgba(53,226,20,0.65)"],
  });
  const pulseShadowOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.1, 0.28],
  });
  const missingLabels = auth.missingForProduction.map((field) => PROFILE_FIELD_LABELS[field]).slice(0, 3);

  return (
    <Screen>
      <View style={styles.layout}>
        <View style={styles.logoWrap}>
          <RealLogo width={190} />
        </View>

        {!auth.profileProductionComplete ? (
          <Card>
            <Body style={styles.missingTitle}>Cadastro incompleto para colocar no ar</Body>
            <Body>
              Complete o cadastro de produção para enviar qualquer serviço.
              {missingLabels.length > 0 ? ` Faltam: ${missingLabels.join(" · ")}.` : ""}
            </Body>
            <Button
              label="Completar cadastro para produção"
              onPress={() => router.push("/onboarding/ray-x?mode=production")}
              variant="secondary"
            />
          </Card>
        ) : null}

        <View style={styles.formBlock}>
          <View style={styles.quickServicesRow}>
            {quickServices.map((item) => (
              <Text key={item.id} style={styles.quickServiceCard} onPress={() => setPrompt(item.prompt)}>
                {item.label}
              </Text>
            ))}
          </View>

          <Animated.View style={[styles.magicPulse, { borderColor: pulseBorderColor, shadowOpacity: pulseShadowOpacity }]}> 
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder=""
              style={styles.magicInput}
              multiline
            />
            {prompt.trim().length === 0 ? (
              <Text style={styles.typingHint}>
                {typedPrompt}
                <Text style={[styles.cursor, !cursorVisible && styles.cursorHidden]}>|</Text>
              </Text>
            ) : null}
          </Animated.View>

          <View style={styles.suggestions}>
            {promptSuggestions.map((item) => (
              <Text key={item} style={styles.suggestionChip} onPress={() => applySuggestion(item)}>
                {item}
              </Text>
            ))}
          </View>

          <Animated.View
            pointerEvents={prompt.trim() ? "auto" : "none"}
            style={[
              styles.ctaWrap,
              {
                opacity: ctaAppear,
                transform: [
                  {
                    translateY: ctaAppear.interpolate({
                      inputRange: [0, 1],
                      outputRange: [14, 0],
                    }),
                  },
                  {
                    scale: ctaAppear.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.94, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <Button label={routing ? "Iniciando..." : "Iniciar"} onPress={() => void startFromPrompt()} disabled={!prompt.trim() || routing} />
          </Animated.View>
        </View>
      </View>

      {toast ? (
        <Animated.View pointerEvents="none" style={[styles.toast, { opacity: toastOpacity }]}> 
          <Text style={styles.toastText}>{toast}</Text>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  layout: {
    flex: 1,
    justifyContent: "center",
    paddingBottom: 44,
    gap: 14,
  },
  logoWrap: {
    alignItems: "center",
    marginBottom: 38,
  },
  formBlock: {
    gap: 14,
    alignSelf: "center",
    width: "100%",
    maxWidth: 560,
  },
  quickServicesRow: {
    flexDirection: "row",
    gap: 8,
  },
  quickServiceCard: {
    flex: 1,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 14,
    backgroundColor: "rgba(13,16,22,0.78)",
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
    textAlign: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    overflow: "hidden",
  },
  missingTitle: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  magicPulse: {
    borderWidth: 1,
    borderRadius: 18,
    shadowColor: realTheme.colors.green,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  magicInput: {
    minHeight: 120,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    textAlignVertical: "top",
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 18,
    lineHeight: 26,
    backgroundColor: "rgba(11,12,14,0.7)",
  },
  typingHint: {
    position: "absolute",
    left: 14,
    right: 14,
    top: 12,
    color: "rgba(166,173,185,0.9)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 18,
    lineHeight: 26,
  },
  cursor: {
    color: realTheme.colors.green,
  },
  cursorHidden: {
    opacity: 0,
  },
  suggestions: {
    gap: 8,
  },
  suggestionChip: {
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    borderRadius: realTheme.radius.sm,
    backgroundColor: "rgba(16,18,22,0.72)",
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  toast: {
    position: "absolute",
    top: 94,
    left: 20,
    right: 20,
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "rgba(12,16,12,0.96)",
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.55)",
    shadowColor: realTheme.colors.green,
    shadowOpacity: 0.24,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  toastText: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
    textAlign: "center",
    fontSize: 14,
  },
  ctaWrap: {
    marginTop: 2,
  },
});
