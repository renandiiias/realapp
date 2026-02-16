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

export default function Home() {
  const auth = useAuth();
  const params = useLocalSearchParams<{ prompt?: string }>();
  const [prompt, setPrompt] = useState("");
  const [routing, setRouting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const pulse = useRef(new Animated.Value(0)).current;
  const toastOpacity = useRef(new Animated.Value(0)).current;

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
          <Animated.View style={[styles.magicPulse, { borderColor: pulseBorderColor, shadowOpacity: pulseShadowOpacity }]}>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              placeholder="Descreve em uma frase o que você precisa"
              placeholderTextColor="rgba(166,173,185,0.84)"
              style={styles.magicInput}
              multiline
            />
          </Animated.View>

          <Button label={routing ? "Direcionando..." : "Começar agora"} onPress={() => void startFromPrompt()} disabled={!prompt.trim() || routing} />
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
});
