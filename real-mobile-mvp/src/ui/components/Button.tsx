import { StyleSheet, Text, TouchableOpacity, type ViewStyle } from "react-native";
import { realTheme } from "../../theme/realTheme";

type Variant = "primary" | "secondary";

export function Button({
  label,
  onPress,
  disabled,
  variant = "primary",
  style,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: Variant;
  style?: ViewStyle;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.88}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.base,
        variant === "primary" ? styles.primary : styles.secondary,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.text, variant === "primary" ? styles.textPrimary : styles.textSecondary]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: realTheme.radius.pill,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  primary: {
    backgroundColor: realTheme.colors.green,
    borderColor: "rgba(0,0,0,0.25)",
    ...realTheme.shadow.glowGreen,
  },
  secondary: {
    backgroundColor: "rgba(18, 19, 22, 0.76)",
    borderColor: "rgba(53,226,20,0.26)",
  },
  disabled: {
    opacity: 0.5,
  },
  text: {
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 15,
    letterSpacing: 0.2,
  },
  textPrimary: {
    color: "#050607",
  },
  textSecondary: {
    color: realTheme.colors.text,
  },
});
