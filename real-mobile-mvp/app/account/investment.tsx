import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { useQueue } from "../../src/queue/QueueProvider";
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
  const queue = useQueue();

  const [topUpInput, setTopUpInput] = useState("");
  const [topupId, setTopupId] = useState<string | null>(null);
  const [pixCopyPaste, setPixCopyPaste] = useState("");
  const [topupStatus, setTopupStatus] = useState<"pending" | "approved" | "failed" | "expired" | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [topupLoading, setTopupLoading] = useState(false);

  const adPrepaidBalance = useMemo(() => queue.walletBalance, [queue.walletBalance]);
  const quickAmounts = useMemo(() => {
    const list = [queue.recommendedTopup, 150, 300].filter((n) => n >= queue.minTopup);
    return Array.from(new Set(list));
  }, [queue.minTopup, queue.recommendedTopup]);

  useEffect(() => {
    if (!topupId || topupStatus !== "pending") return;
    const id = setInterval(() => {
      void (async () => {
        try {
          const status = await queue.getTopupStatus(topupId);
          setTopupStatus(status.status);
          if (status.status !== "pending") {
            if (status.status === "approved") Alert.alert("Recarga confirmada", "Saldo atualizado com sucesso.");
            clearInterval(id);
          }
        } catch {
          // no-op
        }
      })();
    }, 5000);
    return () => clearInterval(id);
  }, [queue, topupId, topupStatus]);

  const quickTopUp = async (amount: number) => {
    setTopupLoading(true);
    try {
      const topup = await queue.createPixTopup(amount);
      setTopupId(topup.topupId);
      setPixCopyPaste(topup.pixCopyPaste);
      setTopupStatus(topup.status);
      setExpiresAt(topup.expiresAt || null);
    } finally {
      setTopupLoading(false);
    }
  };

  const customTopUp = async () => {
    const parsed = parseMoney(topUpInput);
    if (!parsed || parsed < queue.minTopup) {
      Alert.alert("Valor inválido", `A recarga mínima é ${formatBRL(queue.minTopup)}.`);
      return;
    }
    await quickTopUp(parsed);
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
          <SubTitle>Saldo pré-pago</SubTitle>
          <View style={styles.balanceBox}>
            <Body style={styles.balanceLabel}>Disponível</Body>
            <SubTitle style={styles.balanceValue}>{formatBRL(adPrepaidBalance)}</SubTitle>
            <Body style={styles.balanceLabel}>Mínimo para ativar anúncio: {formatBRL(queue.minTopup)}</Body>
            <Body style={styles.balanceLabel}>Recomendado: {formatBRL(queue.recommendedTopup)}</Body>
          </View>

          <View style={styles.topUpRow}>
            {quickAmounts.map((amount) => (
              <Button
                key={amount}
                label={`Gerar PIX ${formatBRL(amount)}`}
                variant="secondary"
                onPress={() => void quickTopUp(amount)}
                style={styles.topUpBtn}
                disabled={topupLoading}
              />
            ))}
          </View>

          <Field label="Valor custom (mínimo R$30)" value={topUpInput} onChangeText={setTopUpInput} placeholder="Ex.: 120" />
          <Button
            label={topupLoading ? "Gerando PIX..." : "Gerar PIX custom"}
            onPress={() => void customTopUp()}
            disabled={!parseMoney(topUpInput) || topupLoading}
          />

          {pixCopyPaste ? (
            <View style={styles.pixBox}>
              <Body style={styles.balanceLabel}>PIX copia e cola</Body>
              <Body style={styles.pixCode}>{pixCopyPaste}</Body>
              <Body style={styles.balanceLabel}>Status: {topupStatus || "pending"}</Body>
              {expiresAt ? <Body style={styles.balanceLabel}>Expira em: {expiresAt}</Body> : null}
            </View>
          ) : null}

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
    flexWrap: "wrap",
    gap: 10,
  },
  topUpBtn: {
    minWidth: "48%",
    flexGrow: 1,
  },
  pixBox: {
    borderWidth: 1,
    borderColor: "rgba(205, 217, 238, 0.2)",
    borderRadius: realTheme.radius.md,
    backgroundColor: "rgba(9,12,18,0.4)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 6,
  },
  pixCode: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 12,
    lineHeight: 16,
  },
});
