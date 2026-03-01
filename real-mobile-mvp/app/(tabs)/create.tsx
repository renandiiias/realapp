import { router } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { ImageBackground, ScrollView, StyleSheet, Text, TouchableOpacity, View, type ImageSourcePropType } from "react-native";
import { canAccessInternalPreviews } from "../../src/auth/accessControl";
import { useAuth } from "../../src/auth/AuthProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";
import { Body } from "../../src/ui/components/Typography";

const serviceCards: Array<{
  id: string;
  title: string;
  hint?: string;
  route: string;
  image: ImageSourcePropType;
  ctaRight?: boolean;
}> = [
  {
    id: "ads",
    title: "Mais mensagens\nno WhatsApp",
    hint: "Atrair clientes com anúncios",
    route: "/create/ads",
    image: require("../../assets/services/site-whatsapp.png"),
    ctaRight: true,
  },
  {
    id: "site",
    title: "Seu site\npronto para vender",
    route: "/create/site",
    image: require("../../assets/services/ads-whatsapp.png"),
  },
  {
    id: "video_editor",
    title: "Editor de vídeo\nem um lugar",
    hint: "IA automática ou edição manual",
    route: "/create/video-editor",
    image: require("../../assets/services/video-camera.png"),
  },
];

export default function Create() {
  const auth = useAuth();
  const hasInternalPreviewAccess = canAccessInternalPreviews(auth.userEmail);
  const visibleCards = hasInternalPreviewAccess
    ? serviceCards
    : serviceCards.filter((item) => item.id === "ads");

  return (
    <Screen style={styles.screen} plain>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.list}>
          {visibleCards.map((item) => (
            <TouchableOpacity key={item.id} style={styles.card} activeOpacity={0.92} onPress={() => router.push(item.route as never)}>
              <ImageBackground source={item.image} style={styles.cardImage} imageStyle={styles.cardImageStyle}>
                <LinearGradient
                  colors={["rgba(4,8,14,0.82)", "rgba(4,8,14,0.48)", "rgba(4,8,14,0.88)"]}
                  start={{ x: 0, y: 0.2 }}
                  end={{ x: 1, y: 0.95 }}
                  style={styles.overlay}
                >
                  <View style={styles.cardContent}>
                    <View style={styles.textWrap}>
                      <Text style={styles.cardTitle}>{item.title}</Text>
                      {item.hint ? <Body style={styles.cardHint}>{item.hint}</Body> : null}
                    </View>

                    <View style={[styles.ctaButton, item.ctaRight ? styles.ctaRight : null]}>
                      <Text style={styles.ctaText}>Quero isso</Text>
                    </View>
                  </View>
                </LinearGradient>
              </ImageBackground>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingBottom: 0,
  },
  content: {
    paddingTop: 8,
    paddingBottom: 26,
    gap: 14,
  },
  list: {
    gap: 14,
  },
  card: {
    borderRadius: 30,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardImage: {
    minHeight: 220,
    justifyContent: "flex-end",
  },
  cardImageStyle: {
    borderRadius: 30,
  },
  overlay: {
    minHeight: 220,
    paddingVertical: 22,
    paddingHorizontal: 18,
    justifyContent: "flex-end",
  },
  cardContent: {
    gap: 14,
  },
  textWrap: {
    gap: 6,
    width: "86%",
  },
  cardTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 23,
    lineHeight: 31,
    letterSpacing: -0.4,
  },
  cardHint: {
    color: "rgba(237,237,238,0.9)",
    fontSize: 16,
    lineHeight: 24,
  },
  ctaButton: {
    alignSelf: "flex-start",
    backgroundColor: realTheme.colors.green,
    borderRadius: realTheme.radius.pill,
    paddingHorizontal: 30,
    paddingVertical: 11,
    shadowColor: realTheme.colors.green,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  ctaRight: {
    alignSelf: "flex-end",
  },
  ctaText: {
    color: "#071102",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 17,
    letterSpacing: -0.2,
  },
});
