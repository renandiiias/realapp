import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAuth } from "../src/auth/AuthProvider";
import { realTheme } from "../src/theme/realTheme";

export default function Index() {
  const { ready, loggedIn, profileMinimumComplete, appTourCompleted, guidedTourActive } = useAuth();

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={realTheme.colors.green} />
      </View>
    );
  }

  if (!loggedIn) return <Redirect href="/welcome" />;
  if (!profileMinimumComplete) return <Redirect href="/onboarding/ray-x?mode=initial" />;
  if (!appTourCompleted && !guidedTourActive) return <Redirect href="/onboarding/app-tour" />;
  return <Redirect href="/(tabs)/home" />;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: realTheme.colors.bg,
  },
});
