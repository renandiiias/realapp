import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Body } from "../../src/ui/components/Typography";

export default function AppTourBootstrap() {
  const { ready, loggedIn, profileMinimumComplete, startGuidedTour } = useAuth();
  const params = useLocalSearchParams<{ prompt?: string }>();

  useEffect(() => {
    if (!ready || !loggedIn || !profileMinimumComplete) return;
    startGuidedTour(0);
    const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
    router.navigate({ pathname: "/home", params: prompt ? { prompt } : undefined });
  }, [loggedIn, params.prompt, profileMinimumComplete, ready, startGuidedTour]);

  if (!ready) return null;
  if (!loggedIn) return <Redirect href="/welcome" />;
  if (!profileMinimumComplete) return <Redirect href="/onboarding/ray-x?mode=initial" />;

  return (
    <View style={styles.loading}>
      <ActivityIndicator color={realTheme.colors.green} />
      <Body style={styles.text}>Iniciando tour guiado...</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: realTheme.colors.bg,
    gap: 12,
  },
  text: {
    color: realTheme.colors.muted,
  },
});
