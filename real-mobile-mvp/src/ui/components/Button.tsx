import { StyleSheet, Text, TouchableOpacity, type ViewStyle, ActivityIndicator, View } from "react-native";
import { realTheme } from "../../theme/realTheme";
import { TOUCH_TARGET_SIZE } from "../../utils/constants";
import { ReactNode } from "react";

type Variant = "primary" | "secondary";
type Size = "small" | "medium" | "large";

export interface ButtonProps {
  label?: string;
  children?: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: Variant;
  size?: Size;
  style?: ViewStyle;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}

export function Button({
  label,
  children,
  onPress,
  disabled,
  loading,
  variant = "primary",
  size = "medium",
  style,
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const content = children || label;

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      disabled={isDisabled}
      onPress={onPress}
      style={[
        styles.base,
        styles[size],
        variant === "primary" ? styles.primary : styles.secondary,
        isDisabled && styles.disabled,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || (typeof content === 'string' ? content : undefined)}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
    >
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color={variant === "primary" ? "#050607" : realTheme.colors.text} />
        </View>
      ) : (
        typeof content === 'string' ? (
          <Text style={[styles.text, styles[`text${size.charAt(0).toUpperCase() + size.slice(1)}` as 'textSmall' | 'textMedium' | 'textLarge'], variant === "primary" ? styles.textPrimary : styles.textSecondary]}>
            {content}
          </Text>
        ) : (
          content
        )
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: realTheme.radius.pill,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    minHeight: TOUCH_TARGET_SIZE,
  },
  small: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  medium: {
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  large: {
    paddingVertical: 16,
    paddingHorizontal: 24,
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
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontFamily: realTheme.fonts.bodyBold,
    letterSpacing: 0.2,
  },
  textSmall: {
    fontSize: 13,
  },
  textMedium: {
    fontSize: 15,
  },
  textLarge: {
    fontSize: 17,
  },
  textPrimary: {
    color: "#050607",
  },
  textSecondary: {
    color: realTheme.colors.text,
  },
});
