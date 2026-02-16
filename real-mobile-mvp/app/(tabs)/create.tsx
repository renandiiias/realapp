import { router } from "expo-router";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useQueue } from "../../src/queue/QueueProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

const serviceCards: Array<{ id: "ads" | "site" | "content"; title: string; hint: string; route: string }> = [
  { id: "ads", title: "Tráfego", hint: "Leads e vendas", route: "/create/ads" },
  { id: "site", title: "Site", hint: "Landing de conversão", route: "/create/site" },
  { id: "content", title: "Conteúdo", hint: "Plano de presença", route: "/create/content" },
];

export default function Create() {
  const queue = useQueue();

  return (
    <Screen>
      <View style={styles.content}>
        <View style={styles.hero}>
          <Kicker>Serviços</Kicker>
          <Title>Escolha um caminho</Title>
        </View>

        <View style={styles.grid}>
          {serviceCards.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={[styles.tile, item.id === "content" ? styles.tileDisabled : null]}
              activeOpacity={item.id === "content" ? 1 : 0.9}
              onPress={() => {
                if (item.id === "content") return;
                router.push(item.route as never);
              }}
            >
              <View style={styles.tileTop}>
                <SubTitle>{item.title}</SubTitle>
                {item.id === "content" ? <Text style={styles.soonBadge}>Em breve</Text> : null}
              </View>
              <Body style={styles.hint}>{item.hint}</Body>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.planWrap}>
          <Body style={styles.plan}>Plano: {queue.planActive ? "ativo" : "pendente"}</Body>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 14,
  },
  hero: {
    gap: 4,
  },
  grid: {
    gap: 10,
  },
  tile: {
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.32)",
    backgroundColor: "rgba(15,16,19,0.9)",
    borderRadius: realTheme.radius.md,
    paddingVertical: 16,
    paddingHorizontal: 14,
    shadowColor: realTheme.colors.green,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  tileDisabled: {
    opacity: 0.78,
    borderColor: "rgba(237,237,238,0.22)",
  },
  tileTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  soonBadge: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  hint: {
    color: realTheme.colors.muted,
  },
  planWrap: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: realTheme.colors.line,
    paddingTop: 10,
  },
  plan: {
    color: realTheme.colors.muted,
    fontSize: 13,
  },
});
