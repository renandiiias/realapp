import { StyleSheet, View } from "react-native";
import { realTheme } from "../../theme/realTheme";
import { Body } from "./Typography";

export function FlowStepIndicator({
  step,
  total,
  label,
}: {
  step: number;
  total: number;
  label?: string;
}) {
  const safeTotal = total <= 0 ? 1 : total;
  const safeStep = Math.max(1, Math.min(step, safeTotal));
  const pct = Math.round((safeStep / safeTotal) * 100);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Body style={styles.meta}>Etapa {safeStep} de {safeTotal}</Body>
        <Body style={styles.meta}>{pct}%</Body>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${pct}%` }]} />
      </View>
      {label ? <Body style={styles.label}>{label}</Body> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 5,
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  meta: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
  },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "rgba(205, 217, 238, 0.18)",
    overflow: "hidden",
  },
  fill: {
    height: 8,
    borderRadius: 999,
    backgroundColor: realTheme.colors.green,
  },
  label: {
    color: realTheme.colors.textSoft,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
  },
});
