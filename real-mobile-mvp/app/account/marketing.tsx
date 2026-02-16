import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useAuth, type RayXData } from "../../src/auth/AuthProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Field } from "../../src/ui/components/Field";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

const levelOptions: RayXData["knowledgeLevel"][] = ["iniciante", "intermediario", "avancado"];
const goalOptions: RayXData["mainGoal"][] = ["leads", "visibilidade"];
const budgetOptions: RayXData["monthlyBudget"][] = ["ate_200", "500_1000", "1000_5000"];

export default function AccountMarketingScreen() {
  const auth = useAuth();

  const [knowledgeLevel, setKnowledgeLevel] = useState<RayXData["knowledgeLevel"]>(auth.rayX?.knowledgeLevel ?? "iniciante");
  const [mainGoal, setMainGoal] = useState<RayXData["mainGoal"]>(auth.rayX?.mainGoal ?? "leads");
  const [monthlyBudget, setMonthlyBudget] = useState<RayXData["monthlyBudget"]>(auth.rayX?.monthlyBudget ?? "ate_200");
  const [marketSegment, setMarketSegment] = useState(auth.rayX?.marketSegment ?? "");

  const [offerSummary, setOfferSummary] = useState(auth.companyProfile?.offerSummary ?? "");
  const [mainDifferential, setMainDifferential] = useState(auth.companyProfile?.mainDifferential ?? "");
  const [primarySalesChannel, setPrimarySalesChannel] = useState(auth.companyProfile?.primarySalesChannel ?? "");
  const [competitorsReferences, setCompetitorsReferences] = useState(auth.companyProfile?.competitorsReferences ?? "");

  const canSave = useMemo(
    () =>
      [marketSegment, offerSummary, mainDifferential, primarySalesChannel, competitorsReferences].every((v) => v.trim().length >= 2),
    [marketSegment, offerSummary, mainDifferential, primarySalesChannel, competitorsReferences],
  );

  const save = async () => {
    await Promise.all([
      auth.updateRayX({
        knowledgeLevel,
        mainGoal,
        monthlyBudget,
        marketSegment: marketSegment.trim(),
      }),
      auth.updateCompanyProfile({
        offerSummary: offerSummary.trim(),
        mainDifferential: mainDifferential.trim(),
        primarySalesChannel: primarySalesChannel.trim(),
        competitorsReferences: competitorsReferences.trim(),
      }),
    ]);
    router.back();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <Kicker>Conta</Kicker>
          <Title>Preferências de marketing</Title>
          <Body>Ajuste objetivo, budget e direcionamento estratégico.</Body>
        </Card>

        <Card>
          <SubTitle>Raio-X</SubTitle>

          <Body style={styles.label}>Nível em marketing</Body>
          <View style={styles.optionRow}>
            {levelOptions.map((item) => (
              <Option key={item} label={item} active={knowledgeLevel === item} onPress={() => setKnowledgeLevel(item)} />
            ))}
          </View>

          <Body style={styles.label}>Meta principal</Body>
          <View style={styles.optionRow}>
            {goalOptions.map((item) => (
              <Option key={item} label={item} active={mainGoal === item} onPress={() => setMainGoal(item)} />
            ))}
          </View>

          <Body style={styles.label}>Budget mensal</Body>
          <View style={styles.optionRow}>
            {budgetOptions.map((item) => (
              <Option key={item} label={item.replace("_", "-")} active={monthlyBudget === item} onPress={() => setMonthlyBudget(item)} />
            ))}
          </View>

          <Field label="Segmento" value={marketSegment} onChangeText={setMarketSegment} placeholder="Ex.: clínica" />
        </Card>

        <Card>
          <SubTitle>Contexto estratégico</SubTitle>
          <Field label="Resumo da oferta" value={offerSummary} onChangeText={setOfferSummary} multiline />
          <Field label="Diferencial principal" value={mainDifferential} onChangeText={setMainDifferential} />
          <Field label="Canal principal de vendas" value={primarySalesChannel} onChangeText={setPrimarySalesChannel} />
          <Field label="Concorrentes / referências" value={competitorsReferences} onChangeText={setCompetitorsReferences} multiline />

          <View style={styles.actions}>
            <Button label="Voltar" variant="secondary" onPress={() => router.back()} style={styles.action} />
            <Button label="Salvar preferências" onPress={() => void save()} disabled={!canSave} style={styles.action} />
          </View>
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Option({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  return (
    <TouchableOpacity activeOpacity={0.9} onPress={onPress} style={[styles.option, active ? styles.optionActive : null]}>
      <Body style={active ? styles.optionTextActive : styles.optionText}>{label}</Body>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 42,
    gap: 14,
  },
  label: {
    color: realTheme.colors.muted,
    fontSize: 13,
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  option: {
    borderWidth: 1,
    borderColor: realTheme.colors.lineStrong,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: "rgba(18,19,22,0.8)",
  },
  optionActive: {
    borderColor: "rgba(53,226,20,0.9)",
    backgroundColor: "rgba(16,22,14,0.95)",
  },
  optionText: {
    color: realTheme.colors.text,
    fontSize: 13,
  },
  optionTextActive: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  action: {
    flex: 1,
  },
});
