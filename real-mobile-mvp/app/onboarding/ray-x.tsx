import { Redirect, router, useLocalSearchParams } from "expo-router";
import { useMemo, useRef, useState } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { useAuth, type CompanyProfile, type RayXData } from "../../src/auth/AuthProvider";
import { useQueue } from "../../src/queue/QueueProvider";
import {
  PROFILE_FIELD_LABELS,
  computeProfileReadiness,
} from "../../src/auth/profileReadiness";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { RealLogo } from "../../src/ui/components/RealLogo";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

type Option<T extends string> = {
  value: T;
  label: string;
};

type WizardMode = "initial" | "production";

type InitialStep =
  | "mainGoal"
  | "monthlyBudget"
  | "adMonthlyInvestment"
  | "marketSegment"
  | "companyName"
  | "instagram"
  | "whatsappBusiness"
  | "targetAudience"
  | "city";

type ProductionStep =
  | "knowledgeLevel"
  | "website"
  | "googleBusinessLink"
  | "offerSummary"
  | "mainDifferential"
  | "primarySalesChannel"
  | "competitorsReferences";

type Step = InitialStep | ProductionStep;

const levels: Option<RayXData["knowledgeLevel"]>[] = [
  { value: "iniciante", label: "Iniciante" },
  { value: "intermediario", label: "Intermediário" },
  { value: "avancado", label: "Avançado" },
];

const goals: Option<RayXData["mainGoal"]>[] = [
  { value: "leads", label: "Leads" },
  { value: "visibilidade", label: "Mais visibilidade" },
];

const budgets: Option<RayXData["monthlyBudget"]>[] = [
  { value: "ate_200", label: "R$200" },
  { value: "500_1000", label: "R$500 a R$1.000" },
  { value: "1000_5000", label: "R$1.000 a R$5.000" },
];

const initialSteps: InitialStep[] = [
  "mainGoal",
  "monthlyBudget",
  "adMonthlyInvestment",
  "marketSegment",
  "companyName",
  "instagram",
  "whatsappBusiness",
  "targetAudience",
  "city",
];

const productionSteps: ProductionStep[] = [
  "knowledgeLevel",
  "website",
  "googleBusinessLink",
  "offerSummary",
  "mainDifferential",
  "primarySalesChannel",
  "competitorsReferences",
];

function hasText(value: string): boolean {
  return value.trim().length >= 2;
}

function parseMoney(value: string): number | null {
  const normalized = value.replace(/\s/g, "").replace(/\./g, "").replace(",", ".");
  const numeric = Number(normalized.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Number(numeric.toFixed(2));
}

export default function RayXScreen() {
  const {
    ready,
    loggedIn,
    profileMinimumComplete,
    appTourCompleted,
    saveInitialOnboarding,
    saveProductionProfile,
    rayX,
    companyProfile,
    missingForProduction,
  } = useAuth();
  const queue = useQueue();
  const params = useLocalSearchParams<{ prompt?: string; pendingOrderId?: string; mode?: string }>();

  const mode: WizardMode = params.mode === "production" ? "production" : "initial";
  const steps: Step[] = mode === "production" ? productionSteps : initialSteps;

  const [stepIdx, setStepIdx] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [knowledgeLevel, setKnowledgeLevel] = useState<RayXData["knowledgeLevel"] | null>(rayX?.knowledgeLevel ?? null);
  const [mainGoal, setMainGoal] = useState<RayXData["mainGoal"] | null>(rayX?.mainGoal ?? null);
  const [monthlyBudget, setMonthlyBudget] = useState<RayXData["monthlyBudget"] | null>(rayX?.monthlyBudget ?? null);
  const [marketSegment, setMarketSegment] = useState(rayX?.marketSegment ?? "");

  const [companyName, setCompanyName] = useState(companyProfile?.companyName ?? "");
  const [instagram, setInstagram] = useState(companyProfile?.instagram ?? "");
  const [website, setWebsite] = useState(companyProfile?.website ?? "");
  const [googleBusinessLink, setGoogleBusinessLink] = useState(companyProfile?.googleBusinessLink ?? "");
  const [whatsappBusiness, setWhatsappBusiness] = useState(companyProfile?.whatsappBusiness ?? "");
  const [targetAudience, setTargetAudience] = useState(companyProfile?.targetAudience ?? "");
  const [city, setCity] = useState(companyProfile?.city ?? "");
  const [offerSummary, setOfferSummary] = useState(companyProfile?.offerSummary ?? "");
  const [mainDifferential, setMainDifferential] = useState(companyProfile?.mainDifferential ?? "");
  const [primarySalesChannel, setPrimarySalesChannel] = useState(companyProfile?.primarySalesChannel ?? "");
  const [competitorsReferences, setCompetitorsReferences] = useState(companyProfile?.competitorsReferences ?? "");
  const [adMonthlyInvestmentInput, setAdMonthlyInvestmentInput] = useState(
    typeof companyProfile?.adMonthlyInvestment === "number" && companyProfile.adMonthlyInvestment > 0
      ? String(companyProfile.adMonthlyInvestment)
      : "",
  );

  const fade = useRef(new Animated.Value(1)).current;

  const progress = useMemo(() => ((stepIdx + 1) / steps.length) * 100, [stepIdx, steps.length]);
  const currentStep = steps[stepIdx] ?? steps[0];

  const localReadiness = useMemo(
    () =>
      computeProfileReadiness({
        rayX: {
          knowledgeLevel: knowledgeLevel ?? undefined,
          mainGoal: mainGoal ?? undefined,
          monthlyBudget: monthlyBudget ?? undefined,
          marketSegment,
        },
        companyProfile: {
          companyName,
          instagram,
          website,
          googleBusinessLink,
          whatsappBusiness,
          targetAudience,
          city,
          offerSummary,
          mainDifferential,
          primarySalesChannel,
          competitorsReferences,
        },
      }),
    [
      knowledgeLevel,
      mainGoal,
      monthlyBudget,
      marketSegment,
      companyName,
      instagram,
      website,
      googleBusinessLink,
      whatsappBusiness,
      targetAudience,
      city,
      offerSummary,
      mainDifferential,
      primarySalesChannel,
      competitorsReferences,
    ],
  );

  const missingLabels = useMemo(
    () => missingForProduction.map((field) => PROFILE_FIELD_LABELS[field]).slice(0, 4),
    [missingForProduction],
  );

  const nextStep = (next: number) => {
    setError(null);
    Animated.sequence([
      Animated.timing(fade, { toValue: 0, duration: 110, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
    setStepIdx(next);
  };

  const pickOption = <T extends string>(setter: (value: T) => void, value: T) => {
    setter(value);
    if (stepIdx < steps.length - 1) {
      setTimeout(() => nextStep(stepIdx + 1), 110);
    }
  };

  const canContinueCurrentStep = useMemo(() => {
    switch (currentStep) {
      case "mainGoal":
        return Boolean(mainGoal);
      case "monthlyBudget":
        return Boolean(monthlyBudget);
      case "adMonthlyInvestment":
        return true;
      case "marketSegment":
        return hasText(marketSegment);
      case "companyName":
        return hasText(companyName);
      case "instagram":
        return hasText(instagram);
      case "whatsappBusiness":
        return hasText(whatsappBusiness);
      case "targetAudience":
        return hasText(targetAudience);
      case "city":
        return hasText(city);
      case "knowledgeLevel":
        return Boolean(knowledgeLevel);
      case "website":
        return hasText(website);
      case "googleBusinessLink":
        return hasText(googleBusinessLink);
      case "offerSummary":
        return hasText(offerSummary);
      case "mainDifferential":
        return hasText(mainDifferential);
      case "primarySalesChannel":
        return hasText(primarySalesChannel);
      case "competitorsReferences":
        return hasText(competitorsReferences);
      default:
        return false;
    }
  }, [
    currentStep,
    mainGoal,
    monthlyBudget,
    marketSegment,
    companyName,
    instagram,
    whatsappBusiness,
    targetAudience,
    city,
    knowledgeLevel,
    website,
    googleBusinessLink,
    offerSummary,
    mainDifferential,
    primarySalesChannel,
    competitorsReferences,
  ]);

  const goNext = () => {
    if (!canContinueCurrentStep) return;
    if (stepIdx >= steps.length - 1) return;
    nextStep(stepIdx + 1);
  };

  const goBack = () => {
    if (stepIdx === 0) return;
    nextStep(stepIdx - 1);
  };

  const finish = async () => {
    setError(null);
    setSaving(true);

    try {
      const pendingOrderId = typeof params.pendingOrderId === "string" ? params.pendingOrderId : "";
      const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";

      if (mode === "initial") {
        const adMonthlyInvestment = parseMoney(adMonthlyInvestmentInput);
        await saveInitialOnboarding({
          rayX: {
            mainGoal: mainGoal ?? undefined,
            monthlyBudget: monthlyBudget ?? undefined,
            marketSegment: marketSegment.trim(),
          },
          companyProfile: {
            companyName: companyName.trim(),
            instagram: instagram.trim(),
            whatsappBusiness: whatsappBusiness.trim(),
            targetAudience: targetAudience.trim(),
            city: city.trim(),
            adMonthlyInvestment: adMonthlyInvestment ?? undefined,
          },
        });

        if (!appTourCompleted) {
          router.replace({ pathname: "/onboarding/app-tour", params: prompt ? { prompt } : undefined });
          return;
        }

        router.navigate({ pathname: "/home", params: prompt ? { prompt } : undefined });
        return;
      }

      if (!knowledgeLevel || !mainGoal || !monthlyBudget) {
        throw new Error("Preencha as informações de marketing para liberar produção.");
      }

      const productionRayX: RayXData = {
        knowledgeLevel,
        mainGoal,
        monthlyBudget,
        marketSegment: marketSegment.trim(),
      };

      const productionCompany: CompanyProfile = {
        companyName: companyName.trim(),
        instagram: instagram.trim(),
        website: website.trim(),
        googleBusinessLink: googleBusinessLink.trim(),
        whatsappBusiness: whatsappBusiness.trim(),
        targetAudience: targetAudience.trim(),
        city: city.trim(),
        offerSummary: offerSummary.trim(),
        mainDifferential: mainDifferential.trim(),
        primarySalesChannel: primarySalesChannel.trim(),
        competitorsReferences: competitorsReferences.trim(),
        adMonthlyInvestment: parseMoney(adMonthlyInvestmentInput) ?? 0,
        adPrepaidBalance: typeof companyProfile?.adPrepaidBalance === "number" ? companyProfile.adPrepaidBalance : 0,
      };

      await saveProductionProfile(productionRayX, productionCompany);

      if (pendingOrderId) {
        await queue.submitOrder(pendingOrderId);
        router.navigate("/orders");
        return;
      }

      router.navigate("/home");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Não foi possível salvar. Tente novamente.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  if (!ready) return null;
  if (!loggedIn) return <Redirect href="/welcome" />;
  if (mode === "production" && !profileMinimumComplete) return <Redirect href="/onboarding/ray-x?mode=initial" />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <View style={styles.top}>
            <RealLogo width={132} />
            <Kicker>{mode === "initial" ? "Cadastro inicial" : "Cadastro para produção"}</Kicker>
          </View>
          <Title>{mode === "initial" ? "Vamos organizar sua base" : "Falta pouco para colocar no ar"}</Title>
          <Body style={styles.subtitle}>
            {mode === "initial"
              ? "Você responde o essencial agora e continua no app em seguida."
              : "Complete as infos finais para liberar produção de qualquer serviço."}
          </Body>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <Body style={styles.progressText}>Etapa {stepIdx + 1} de {steps.length}</Body>

          {mode === "production" && missingLabels.length > 0 ? (
            <Body style={styles.pending}>Ainda faltam: {missingLabels.join(" · ")}</Body>
          ) : null}
        </Card>

        <Animated.View style={{ opacity: fade }}>
          <Card>
            {currentStep === "mainGoal" ? (
              <>
                <SubTitle>Meta principal agora</SubTitle>
                <View style={styles.options}>
                  {goals.map((item) => (
                    <Pick
                      key={item.value}
                      label={item.label}
                      active={mainGoal === item.value}
                      onPress={() => pickOption(setMainGoal, item.value)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {currentStep === "monthlyBudget" ? (
              <>
                <SubTitle>Investimento para anúncios</SubTitle>
                <View style={styles.options}>
                  {budgets.map((item) => (
                    <Pick
                      key={item.value}
                      label={item.label}
                      active={monthlyBudget === item.value}
                      onPress={() => pickOption(setMonthlyBudget, item.value)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {currentStep === "marketSegment" ? (
              <InputStep
                title="Segmento"
                value={marketSegment}
                onChangeText={setMarketSegment}
                placeholder="Ex.: clínica odontológica"
                buttonLabel="Próxima etapa"
                onNext={goNext}
                canNext={canContinueCurrentStep}
              />
            ) : null}

            {currentStep === "adMonthlyInvestment" ? (
              <>
                <SubTitle>Investimento mensal para anúncios</SubTitle>
                <Body style={styles.stepHint}>
                  Esse valor vira o orçamento de mídia para subir campanhas na Meta. Você pode fazer depois na Conta.
                </Body>
                <TextInput
                  value={adMonthlyInvestmentInput}
                  onChangeText={setAdMonthlyInvestmentInput}
                  placeholder="Ex.: 1500"
                  placeholderTextColor="rgba(166,173,185,0.84)"
                  style={styles.input}
                  keyboardType="numeric"
                />
                <View style={styles.inlineActions}>
                  <Button label="Fazer depois" variant="secondary" onPress={goNext} style={styles.inlineAction} />
                  <Button
                    label="Salvar e seguir"
                    onPress={goNext}
                    disabled={!parseMoney(adMonthlyInvestmentInput)}
                    style={styles.inlineAction}
                  />
                </View>
              </>
            ) : null}

            {currentStep === "companyName" ? (
              <InputStep
                title="Nome da empresa"
                value={companyName}
                onChangeText={setCompanyName}
                placeholder="Ex.: Real Marketing"
                buttonLabel="Próxima etapa"
                onNext={goNext}
                canNext={canContinueCurrentStep}
              />
            ) : null}

            {currentStep === "instagram" ? (
              <InputStep
                title="Instagram da empresa"
                value={instagram}
                onChangeText={setInstagram}
                placeholder="Ex.: @suaempresa"
                buttonLabel="Próxima etapa"
                onNext={goNext}
                canNext={canContinueCurrentStep}
                autoCapitalize="none"
              />
            ) : null}

            {currentStep === "whatsappBusiness" ? (
              <InputStep
                title="WhatsApp da empresa"
                value={whatsappBusiness}
                onChangeText={setWhatsappBusiness}
                placeholder="Ex.: (17) 99999-9999"
                buttonLabel="Próxima etapa"
                onNext={goNext}
                canNext={canContinueCurrentStep}
              />
            ) : null}

            {currentStep === "targetAudience" ? (
              <InputStep
                title="Público-alvo"
                value={targetAudience}
                onChangeText={setTargetAudience}
                placeholder="Ex.: mulheres de 25 a 45 que buscam estética"
                buttonLabel="Próxima etapa"
                onNext={goNext}
                canNext={canContinueCurrentStep}
              />
            ) : null}

            {currentStep === "city" ? (
              <InputStep
                title="Cidade principal"
                value={city}
                onChangeText={setCity}
                placeholder="Ex.: São José do Rio Preto"
                buttonLabel={saving ? "Salvando..." : "Concluir etapa inicial"}
                onNext={finish}
                canNext={localReadiness.profileMinimumComplete && !saving}
              />
            ) : null}

            {currentStep === "knowledgeLevel" ? (
              <>
                <SubTitle>Nível em marketing</SubTitle>
                <View style={styles.options}>
                  {levels.map((item) => (
                    <Pick
                      key={item.value}
                      label={item.label}
                      active={knowledgeLevel === item.value}
                      onPress={() => pickOption(setKnowledgeLevel, item.value)}
                    />
                  ))}
                </View>
              </>
            ) : null}

            {currentStep === "website" ? (
              <InputStep
                title="Site"
                value={website}
                onChangeText={setWebsite}
                placeholder="https://seusite.com"
                buttonLabel="Próxima etapa"
                onNext={goNext}
                canNext={canContinueCurrentStep}
                autoCapitalize="none"
              />
            ) : null}

            {currentStep === "googleBusinessLink" ? (
              <InputStep
                title="Link da ficha do Google"
                value={googleBusinessLink}
                onChangeText={setGoogleBusinessLink}
                placeholder="https://g.page/..."
                buttonLabel="Próxima etapa"
                onNext={goNext}
                canNext={canContinueCurrentStep}
                autoCapitalize="none"
              />
            ) : null}

            {currentStep === "offerSummary" ? (
              <InputStep
                title="Resumo da sua oferta"
                value={offerSummary}
                onChangeText={setOfferSummary}
                placeholder="O que você vende e para quem"
                buttonLabel="Próxima etapa"
                onNext={goNext}
                canNext={canContinueCurrentStep}
                multiline
              />
            ) : null}

            {currentStep === "mainDifferential" ? (
              <InputStep
                title="Diferencial principal"
                value={mainDifferential}
                onChangeText={setMainDifferential}
                placeholder="Por que o cliente escolhe você"
                buttonLabel="Próxima etapa"
                onNext={goNext}
                canNext={canContinueCurrentStep}
              />
            ) : null}

            {currentStep === "primarySalesChannel" ? (
              <InputStep
                title="Canal principal de vendas"
                value={primarySalesChannel}
                onChangeText={setPrimarySalesChannel}
                placeholder="Ex.: WhatsApp, loja física, Instagram"
                buttonLabel="Próxima etapa"
                onNext={goNext}
                canNext={canContinueCurrentStep}
              />
            ) : null}

            {currentStep === "competitorsReferences" ? (
              <InputStep
                title="Concorrentes / referências"
                value={competitorsReferences}
                onChangeText={setCompetitorsReferences}
                placeholder="Links ou nomes dos concorrentes"
                buttonLabel={saving ? "Salvando..." : "Liberar produção"}
                onNext={finish}
                canNext={localReadiness.profileProductionComplete && !saving}
                multiline
              />
            ) : null}

            {error ? <Body style={styles.error}>{error}</Body> : null}

            <View style={styles.footer}>
              <Pressable onPress={goBack} disabled={stepIdx === 0}>
                <Body style={stepIdx === 0 ? styles.backDisabled : styles.back}>Voltar etapa</Body>
              </Pressable>
            </View>
          </Card>
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

function Pick({ label, active, onPress }: { label: string; active: boolean; onPress(): void }) {
  return (
    <Pressable onPress={onPress} style={[styles.pick, active ? styles.pickActive : null]}>
      <SubTitle>{label}</SubTitle>
    </Pressable>
  );
}

function InputStep({
  title,
  value,
  onChangeText,
  placeholder,
  buttonLabel,
  onNext,
  canNext,
  multiline,
  autoCapitalize,
}: {
  title: string;
  value: string;
  onChangeText(value: string): void;
  placeholder: string;
  buttonLabel: string;
  onNext(): void;
  canNext: boolean;
  multiline?: boolean;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <>
      <SubTitle>{title}</SubTitle>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(166,173,185,0.84)"
        style={[styles.input, multiline ? styles.inputMultiline : null]}
        multiline={multiline}
        autoCapitalize={autoCapitalize ?? "sentences"}
      />
      <Button label={buttonLabel} onPress={onNext} disabled={!canNext} />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 42,
    gap: 14,
  },
  top: {
    gap: 4,
  },
  subtitle: {
    color: realTheme.colors.muted,
  },
  stepHint: {
    color: realTheme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  progressTrack: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "rgba(237,237,238,0.12)",
    overflow: "hidden",
    marginTop: 2,
  },
  progressFill: {
    height: 10,
    borderRadius: 999,
    backgroundColor: realTheme.colors.green,
  },
  progressText: {
    color: realTheme.colors.muted,
    fontSize: 13,
  },
  pending: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
    lineHeight: 19,
  },
  options: {
    gap: 10,
  },
  pick: {
    borderWidth: 1.2,
    borderColor: "rgba(237,237,238,0.2)",
    backgroundColor: "rgba(18,19,22,0.9)",
    borderRadius: 20,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  pickActive: {
    borderColor: "rgba(53,226,20,0.95)",
    backgroundColor: "rgba(16,22,14,0.96)",
    shadowColor: realTheme.colors.green,
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.48)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 15,
    backgroundColor: "rgba(17,18,22,0.82)",
  },
  inputMultiline: {
    minHeight: 98,
    textAlignVertical: "top",
  },
  inlineActions: {
    flexDirection: "row",
    gap: 10,
  },
  inlineAction: {
    flex: 1,
  },
  footer: {
    paddingTop: 2,
    alignItems: "flex-start",
  },
  back: {
    color: realTheme.colors.muted,
    fontSize: 13,
    textDecorationLine: "underline",
  },
  backDisabled: {
    color: "rgba(166,173,185,0.45)",
    fontSize: 13,
  },
  error: {
    color: "#ff8080",
    fontSize: 13,
    lineHeight: 19,
  },
});
