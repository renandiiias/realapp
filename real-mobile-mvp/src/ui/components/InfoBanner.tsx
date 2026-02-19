import { StyleSheet, View } from "react-native";
import { realTheme } from "../../theme/realTheme";
import { Body } from "./Typography";

type Tone = "info" | "warning" | "success";

const toneConfig: Record<Tone, { border: string; bg: string; icon: string }> = {
  info: {
    border: "rgba(138, 171, 255, 0.52)",
    bg: "rgba(28, 44, 72, 0.45)",
    icon: "i",
  },
  warning: {
    border: "rgba(255, 189, 85, 0.68)",
    bg: "rgba(85, 58, 20, 0.4)",
    icon: "!",
  },
  success: {
    border: "rgba(53, 226, 20, 0.58)",
    bg: "rgba(20, 58, 16, 0.4)",
    icon: "✓",
  },
};

export function InfoBanner({
  message,
  tone = "info",
}: {
  message: string;
  tone?: Tone;
}) {
  const config = toneConfig[tone];
  return (
    <View style={[styles.wrap, { borderColor: config.border, backgroundColor: config.bg }]}>
      <View style={[styles.iconBubble, { borderColor: config.border }]}>
        <Body style={styles.icon}>{config.icon}</Body>
      </View>
      <Body style={styles.message}>{message}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: realTheme.radius.md,
    paddingVertical: 9,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  iconBubble: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  icon: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 11,
    lineHeight: 15,
  },
  message: {
    flex: 1,
    color: realTheme.colors.textSoft,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
  },
});
