import { DMSerifDisplay_400Regular } from "@expo-google-fonts/dm-serif-display";
import {
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
} from "@expo-google-fonts/montserrat";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { RealProviders } from "../src/providers/RealProviders";
import { realTheme } from "../src/theme/realTheme";
import { RealLogo } from "../src/ui/components/RealLogo";

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    DMSerifDisplay_400Regular,
  });

  if (!fontsLoaded) {
    return (
      <View style={styles.loading}>
        <StatusBar style="light" />
        <RealLogo width={180} />
        <ActivityIndicator color={realTheme.colors.green} style={styles.spinner} />
      </View>
    );
  }

  return (
    <RealProviders>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: realTheme.colors.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="welcome" />
        <Stack.Screen name="onboarding/ray-x" />
        <Stack.Screen name="onboarding/app-tour" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="create/ads" />
        <Stack.Screen name="create/site" />
        <Stack.Screen name="create/video-editor" />
        <Stack.Screen name="create/content" />
        <Stack.Screen name="account/profile" />
        <Stack.Screen name="account/marketing" />
        <Stack.Screen name="account/investment" />
        <Stack.Screen name="conversations/[thread]" />
        <Stack.Screen name="orders/[id]" />
      </Stack>
    </RealProviders>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: realTheme.colors.bg,
    paddingHorizontal: 24,
  },
  spinner: {
    marginTop: 18,
  },
});
