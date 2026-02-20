import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { useQueue } from "../../src/queue/QueueProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";

const TAB_SAFE_SCROLL_BOTTOM = 120;

type CheckItem = {
  id: "company" | "strategy" | "investment";
  title: string;
  subtitle?: string;
  done: boolean;
  route: "/account/profile" | "/account/marketing" | "/account/investment";
};

export default function Account() {
  const auth = useAuth();
  const queue = useQueue();

  const hasCompany = Boolean(
    auth.companyProfile?.companyName?.trim() &&
      auth.companyProfile?.whatsappBusiness?.trim() &&
      auth.companyProfile?.targetAudience?.trim() &&
      auth.companyProfile?.city?.trim(),
  );

  const hasStrategy = Boolean(
    auth.rayX?.marketSegment?.trim() && auth.rayX?.monthlyBudget && auth.companyProfile?.offerSummary?.trim(),
  );

  const hasInvestment = Boolean(
    (typeof auth.companyProfile?.adMonthlyInvestment === "number" && auth.companyProfile.adMonthlyInvestment > 0) ||
      (typeof auth.companyProfile?.adPrepaidBalance === "number" && auth.companyProfile.adPrepaidBalance > 0),
  );

  const checks: CheckItem[] = [
    {
      id: "company",
      title: "Dados da empresa",
      subtitle: "Dados da empresa e contato",
      done: hasCompany,
      route: "/account/profile",
    },
    {
      id: "strategy",
      title: "Estratégia definida",
      subtitle: "Segmento e orçamento",
      done: hasStrategy,
      route: "/account/marketing",
    },
    {
      id: "investment",
      title: "Investimento de anúncios",
      done: hasInvestment,
      route: "/account/investment",
    },
  ];

  const nextPending = checks.find((item) => !item.done);
  const systemReady = checks.every((item) => item.done) && auth.profileProductionComplete;

  const systemTitle = systemReady ? "Pronto para rodar anúncios" : "Ainda falta configurar";

  const resolveNow = () => {
    if (nextPending) {
      router.push(nextPending.route);
      return;
    }
    router.push("/account/investment");
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollIndicatorInsets={{ bottom: TAB_SAFE_SCROLL_BOTTOM }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Text style={styles.pageTitle}>Conta</Text>

        <View style={styles.statusWrap}>
          <Text style={styles.statusLabel}>Status do sistema</Text>
          <Text style={[styles.statusValue, systemReady ? styles.statusReady : styles.statusPending]}>{systemTitle}</Text>

          <TouchableOpacity style={styles.resolveButton} activeOpacity={0.9} onPress={resolveNow}>
            <Text style={styles.resolveText}>Resolver agora</Text>
            <Ionicons name="chevron-forward" size={26} color="#0A1207" />
          </TouchableOpacity>
        </View>

        <View style={styles.checklistWrap}>
          {checks.map((item) => (
            <TouchableOpacity key={item.id} style={styles.checkRow} activeOpacity={0.88} onPress={() => router.push(item.route)}>
              <View style={styles.checkIconWrap}>
                {item.done ? (
                  <Ionicons name="checkmark" size={22} color={realTheme.colors.green} />
                ) : (
                  <View style={styles.emptyCircle} />
                )}
              </View>

              <View style={styles.checkTextWrap}>
                <Text style={styles.checkTitle}>{item.title}</Text>
                {item.subtitle ? <Text style={styles.checkSubtitle}>{item.subtitle}</Text> : null}
              </View>

              <Ionicons name="chevron-forward" size={19} color="rgba(220,225,233,0.45)" />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Plano</Text>

        <View style={styles.planCard}>
          <View style={styles.planTop}>
            <View style={styles.planTextWrap}>
              <Text style={styles.planName}>Plano Pro</Text>
              <Text style={styles.planMuted}>Renova em 24/04</Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color="rgba(220,225,233,0.45)" />
          </View>

          <View style={styles.planBottom}>
            <Text style={styles.planMuted}>3 de 5 campanhas ativas</Text>
            <TouchableOpacity activeOpacity={0.85} onPress={() => queue.setPlanActive(true)}>
              <Text style={styles.planAction}>Gerenciar plano</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.userEmail}>{auth.userEmail || "usuario@email.com"}</Text>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={async () => {
            await auth.logout();
            router.replace("/welcome");
          }}
        >
          <Text style={styles.logout}>Sair</Text>
        </TouchableOpacity>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: TAB_SAFE_SCROLL_BOTTOM,
    gap: 14,
  },
  pageTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.3,
    marginTop: 2,
  },
  statusWrap: {
    gap: 8,
    paddingTop: 2,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(205, 217, 238, 0.16)",
  },
  statusLabel: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 17,
  },
  statusValue: {
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 17,
    lineHeight: 24,
  },
  statusReady: {
    color: realTheme.colors.green,
  },
  statusPending: {
    color: "#E8B35A",
  },
  resolveButton: {
    marginTop: 8,
    height: 58,
    borderRadius: 46,
    backgroundColor: realTheme.colors.green,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  resolveText: {
    color: "#0A1207",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 17,
    letterSpacing: -0.2,
  },
  checklistWrap: {
    borderTopWidth: 1,
    borderTopColor: "rgba(205, 217, 238, 0.16)",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 76,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(205, 217, 238, 0.16)",
    paddingVertical: 8,
  },
  checkIconWrap: {
    width: 28,
    alignItems: "center",
  },
  emptyCircle: {
    width: 18,
    height: 18,
    borderRadius: 99,
    borderWidth: 2,
    borderColor: "rgba(220,225,233,0.35)",
  },
  checkTextWrap: {
    flex: 1,
    gap: 1,
  },
  checkTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  checkSubtitle: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 18,
    marginTop: 8,
  },
  planCard: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(205, 217, 238, 0.2)",
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
    backgroundColor: "rgba(9,12,18,0.4)",
  },
  planTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  planTextWrap: {
    gap: 2,
  },
  planName: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 23,
  },
  planMuted: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 15,
  },
  planBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  planAction: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 16,
  },
  userEmail: {
    marginTop: 8,
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 16,
  },
  logout: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 18,
    marginBottom: 6,
  },
});
