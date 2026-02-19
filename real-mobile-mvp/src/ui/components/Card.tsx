import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { realTheme } from "../../theme/realTheme";
import { memo, ReactNode } from "react";
import { SPACING } from "../../utils/constants";

export interface CardProps {
  children: ReactNode;
  style?: ViewStyle;
  variant?: 'default' | 'subtle';
  padding?: keyof typeof SPACING;
}

export const Card = memo(function Card({
  children,
  style,
  variant = 'default',
  padding = 'md',
}: CardProps) {
  const gradientColors = variant === 'default'
    ? ["rgba(53,226,20,0.26)", "rgba(237,237,238,0.08)", "rgba(142,0,166,0.18)"]
    : ["rgba(53,226,20,0.12)", "rgba(237,237,238,0.04)", "rgba(142,0,166,0.09)"];

  return (
    <LinearGradient
      colors={gradientColors}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.shell, style]}
    >
      <View style={[styles.card, { padding: SPACING[padding] }]}>{children}</View>
    </LinearGradient>
  );
});

const styles = StyleSheet.create({
  shell: {
    borderRadius: realTheme.radius.lg + 2,
    padding: 1,
    shadowColor: realTheme.colors.green,
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  card: {
    backgroundColor: "rgba(13, 15, 16, 0.94)",
    borderRadius: realTheme.radius.lg,
    gap: SPACING.sm,
  },
});
