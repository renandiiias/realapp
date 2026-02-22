import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";

export default function VideoEditorHubScreen() {
  return (
    <Screen plain style={styles.screen}>
      <LinearGradient colors={["#07090f", "#0a0d17", "#07090f"]} style={styles.bg}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>Como deseja editar?</Text>
            <Text style={styles.subtitle}>
              Envie seu video para <Text style={styles.green}>IA editor</Text> automaticamente ou ajuste manualmente.
            </Text>
          </View>

          <TouchableOpacity activeOpacity={0.92} onPress={() => router.push("/create/video-editor-ia")}>
            <LinearGradient colors={["rgba(52,226,20,0.24)", "rgba(52,226,20,0.06)"]} style={styles.choiceGlow}>
              <View style={styles.choiceCardActive}>
                <LinearGradient colors={["#1f2f12", "#0f140f"]} style={styles.iconWrapActive}>
                  <MaterialCommunityIcons name="robot-outline" size={34} color="#65f038" />
                </LinearGradient>
                <View style={styles.choiceBody}>
                  <Text style={styles.choiceTitle}>Edicao com IA</Text>
                  <Text style={styles.choiceText}>IA corta seu video automaticamente e adiciona legendas.</Text>
                </View>
                <Ionicons name="chevron-forward" size={24} color="#65f038" />
              </View>
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity activeOpacity={0.92} onPress={() => router.push("/create/video-editor-manual")}>
            <View style={styles.choiceCard}>
              <LinearGradient colors={["#161a25", "#0f1218"]} style={styles.iconWrap}>
                <MaterialCommunityIcons name="movie-edit-outline" size={30} color="#d8dee8" />
              </LinearGradient>
              <View style={styles.choiceBody}>
                <Text style={styles.choiceTitle}>Edicao manual</Text>
                <Text style={styles.choiceText}>Editor nativo no app, sem WebView e sem etapa intermediaria.</Text>
              </View>
              <Ionicons name="chevron-forward" size={24} color="#c4cad6" />
            </View>
          </TouchableOpacity>
        </ScrollView>
      </LinearGradient>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  bg: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 38,
    gap: 14,
  },
  header: {
    gap: 8,
    marginBottom: 6,
  },
  title: {
    color: "#f2f4f8",
    fontSize: 48,
    lineHeight: 52,
    letterSpacing: -0.8,
    fontFamily: realTheme.fonts.title,
  },
  subtitle: {
    color: "#b2bac8",
    fontSize: 14,
    lineHeight: 21,
    fontFamily: realTheme.fonts.bodyRegular,
  },
  green: {
    color: "#40e81f",
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  choiceGlow: {
    borderRadius: 26,
    padding: 1,
    shadowColor: "#4de729",
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
  },
  choiceCardActive: {
    borderRadius: 25,
    backgroundColor: "rgba(11,16,15,0.96)",
    borderWidth: 1,
    borderColor: "rgba(84,239,42,0.72)",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  choiceCard: {
    borderRadius: 25,
    backgroundColor: "rgba(12,15,24,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  iconWrapActive: {
    width: 62,
    height: 62,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWrap: {
    width: 62,
    height: 62,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  choiceBody: {
    flex: 1,
    gap: 3,
  },
  choiceTitle: {
    color: "#edf0f5",
    fontSize: 22,
    lineHeight: 26,
    fontFamily: realTheme.fonts.bodyBold,
    letterSpacing: -0.3,
  },
  choiceText: {
    color: "#b0b7c4",
    fontSize: 14,
    lineHeight: 19,
    fontFamily: realTheme.fonts.bodyRegular,
  },
});
