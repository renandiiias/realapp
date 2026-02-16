import { StyleSheet, Text, View } from "react-native";
import type { OrderStatus } from "../../queue/types";
import { realTheme } from "../../theme/realTheme";

function label(status: OrderStatus): string {
  switch (status) {
    case "draft":
      return "Rascunho";
    case "waiting_payment":
      return "Aguardando ativação";
    case "queued":
      return "Preparando execução";
    case "in_progress":
      return "Em produção";
    case "needs_approval":
      return "Aguardando aprovação";
    case "needs_info":
      return "Aguardando info";
    case "blocked":
      return "Pausado";
    case "done":
      return "Concluído";
    case "failed":
      return "Erro final";
    default:
      return status;
  }
}

function bg(status: OrderStatus): string {
  if (status === "done") return realTheme.colors.neonSoft;
  if (status === "needs_approval" || status === "needs_info") return realTheme.colors.purpleSoft;
  if (status === "blocked" || status === "failed") return realTheme.colors.dangerSoft;
  if (status === "queued" || status === "in_progress") return "rgba(53, 226, 20, 0.12)";
  if (status === "waiting_payment") return "rgba(237, 237, 238, 0.12)";
  return "rgba(237, 237, 238, 0.08)";
}

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <View style={[styles.base, { backgroundColor: bg(status) }]}>
      <Text style={styles.text}>{label(status)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
  },
  text: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 12,
  },
});
