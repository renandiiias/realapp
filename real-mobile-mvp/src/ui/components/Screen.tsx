import { LinearGradient } from "expo-linear-gradient";
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TouchableWithoutFeedback,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../auth/AuthProvider";
import { realTheme } from "../../theme/realTheme";

export function Screen({
  children,
  style,
  plain,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  plain?: boolean;
}) {
  const { loggedIn } = useAuth();

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.safe}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          {plain ? (
            <View style={styles.plain}>
              <View style={[styles.inner, style]}>{children}</View>
            </View>
          ) : (
            <LinearGradient
              colors={["#080A0D", "#0B0F12", "#0A0D11"]}
              start={{ x: 0.05, y: 0.05 }}
              end={{ x: 0.95, y: 1 }}
              style={styles.gradient}
            >
              {loggedIn ? (
                <>
                  <Image source={require("../../../assets/real-symbol-source.png")} style={styles.symbolTop} resizeMode="contain" />
                  <Image
                    source={require("../../../assets/real-symbol-source.png")}
                    style={styles.symbolBottom}
                    resizeMode="contain"
                  />
                </>
              ) : null}
              <View style={[styles.inner, style]}>{children}</View>
            </LinearGradient>
          )}
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: realTheme.colors.bg,
  },
  gradient: {
    flex: 1,
  },
  plain: {
    flex: 1,
    backgroundColor: "#0A0D11",
  },
  inner: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 18,
    backgroundColor: "transparent",
  },
  symbolTop: {
    position: "absolute",
    width: 120,
    height: 120,
    top: -20,
    right: -24,
    opacity: 0.12,
    tintColor: realTheme.colors.green,
    transform: [{ rotate: "8deg" }],
  },
  symbolBottom: {
    position: "absolute",
    width: 128,
    height: 128,
    bottom: 26,
    left: -22,
    opacity: 0.1,
    tintColor: realTheme.colors.green,
    transform: [{ rotate: "-10deg" }],
  },
});
