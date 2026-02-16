import { LinearGradient } from "expo-linear-gradient";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { realTheme } from "../../theme/realTheme";

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return (
    <LinearGradient
      colors={["rgba(53,226,20,0.26)", "rgba(237,237,238,0.08)", "rgba(142,0,166,0.18)"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[styles.shell, style]}
    >
      <View style={styles.card}>{children}</View>
    </LinearGradient>
  );
}

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
    padding: 14,
    gap: 10,
  },
});
