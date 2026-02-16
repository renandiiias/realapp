import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Field } from "../../src/ui/components/Field";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

function parseMoney(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const numeric = Number(normalized.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Number(numeric.toFixed(2));
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
}

export default function AccountInvestmentScreen() {
  const auth = useAuth();

  const [adMonthlyInvestmentInput, setAdMonthlyInvestmentInput] = useState(
    typeof auth.companyProfile?.adMonthlyInvestment === "number" && auth.companyProfile.adMonthlyInvestment > 0
      ? String(auth.companyProfile.adMonthlyInvestment)
      : "",
  );
  const [topUpInput, setTopUpInput] = useState("");

  const adPrepaidBalance = useMemo(
    () => (typeof auth.companyProfile?.adPrepaidBalance === "number" ? auth.companyProfile.adPrepaidBalance : 0),
    [auth.companyProfile?.adPrepaidBalance],
  );

  const saveAdBudget = async () => {
    const parsed = parseMoney(adMonthlyInvestmentInput);
    await auth.updateCompanyProfile({
      adMonthlyInvestment: parsed ?? 0,
    });
  };

  const quickTopUp = async (amount: number) => {
    await auth.topUpAdPrepaidBalance(amount);
  };

  const customTopUp = async () => {
    const parsed = parseMoney(topUpInput);
    if (!parsed) return;
    await auth.topUpAdPrepaidBalance(parsed);
    setTopUpInput("");
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <Kicker>Conta</Kicker>
          <Title>Investimento de anúncios</Title>
          <Body>Defina orçamento mensal e abasteça saldo pré-pago de mídia.</Body>
        </Card>

        <Card>
          <SubTitle>Orçamento mensal (Meta)</SubTitle>
          <Field
            label="Valor mensal"
            value={adMonthlyInvestmentInput}
            onChangeText={setAdMonthlyInvestmentInput}
            placeholder="Ex.: 1500"
          />
          <Button label="Salvar investimento" onPress={() => void saveAdBudget()} disabled={!parseMoney(adMonthlyInvestmentInput)} />
        </Card>

        <Card>
          <SubTitle>Saldo pré-pago</SubTitle>
          <View style={styles.balanceBox}>
            <Body style={styles.balanceLabel}>Disponível</Body>
            <SubTitle style={styles.balanceValue}>{formatBRL(adPrepaidBalance)}</SubTitle>
          </View>

          <View style={styles.topUpRow}>
            <Button label="Abastecer R$500" variant="secondary" onPress={() => void quickTopUp(500)} style={styles.topUpBtn} />
            <Button label="Abastecer R$1000" variant="secondary" onPress={() => void quickTopUp(1000)} style={styles.topUpBtn} />
          </View>

          <Field label="Valor custom" value={topUpInput} onChangeText={setTopUpInput} placeholder="Ex.: 750" />
          <Button label="Abastecer agora" onPress={() => void customTopUp()} disabled={!parseMoney(topUpInput)} />

          <Button label="Voltar" variant="secondary" onPress={() => router.back()} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 42,
    gap: 14,
  },
  balanceBox: {
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.3)",
    borderRadius: realTheme.radius.md,
    backgroundColor: "rgba(15,18,16,0.82)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 3,
  },
  balanceLabel: {
    color: realTheme.colors.muted,
    fontSize: 12,
  },
  balanceValue: {
    fontSize: 22,
    lineHeight: 28,
  },
  topUpRow: {
    flexDirection: "row",
    gap: 10,
  },
  topUpBtn: {
    flex: 1,
  },
});
