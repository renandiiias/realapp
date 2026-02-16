import { StyleSheet, Text, TouchableOpacity, type ViewStyle } from "react-native";
import { realTheme } from "../../theme/realTheme";

export function Chip({
  label,
  active,
  onPress,
  style,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  style?: ViewStyle;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.base, active ? styles.active : styles.inactive, style]}
    >
      <Text style={[styles.text, active ? styles.textActive : styles.textInactive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  active: {
    backgroundColor: realTheme.colors.neonSoft,
    borderColor: "rgba(53, 226, 20, 0.45)",
  },
  inactive: {
    backgroundColor: "rgba(18, 19, 22, 0.45)",
    borderColor: realTheme.colors.line,
  },
  text: {
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  textActive: {
    color: realTheme.colors.text,
  },
  textInactive: {
    color: realTheme.colors.muted,
  },
});
