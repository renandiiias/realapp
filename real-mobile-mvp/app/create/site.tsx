import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { useQueue } from "../../src/queue/QueueProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Screen } from "../../src/ui/components/Screen";
import { FlowStepIndicator } from "../../src/ui/components/FlowStepIndicator";
import { Body, Kicker, Title } from "../../src/ui/components/Typography";

type Option = {
  id: string;
  title: string;
  hint: string;
  image: string;
};

type Category = {
  id: string;
  title: string;
  subtitle: string;
  options: [Option, Option];
};

type Stage = "briefing" | "sections" | "generating" | "copy" | "review";

type CopySection = {
  id: string;
  title: string;
  copy: string;
};

const briefingCategories: Category[] = [
  {
    id: "goal",
    title: "Meta principal",
    subtitle: "Qual resultado esse site precisa gerar primeiro?",
    options: [
      {
        id: "goal-leads",
        title: "Gerar leads",
        hint: "Captar contatos qualificados para comercial",
        image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1400&q=80",
      },
      {
        id: "goal-sales",
        title: "Gerar vendas",
        hint: "Levar para compra rápida com oferta clara",
        image: "https://images.unsplash.com/photo-1556740749-887f6717d7e4?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    id: "audience",
    title: "Perfil do público",
    subtitle: "Esse site fala mais com quem?",
    options: [
      {
        id: "audience-cold",
        title: "Público frio",
        hint: "Precisa educar e criar confiança do zero",
        image: "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?auto=format&fit=crop&w=1400&q=80",
      },
      {
        id: "audience-warm",
        title: "Público aquecido",
        hint: "Já conhece a marca e precisa de empurrão final",
        image: "https://images.unsplash.com/photo-1520607162513-77705c0f0d4a?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    id: "tone",
    title: "Tom de comunicação",
    subtitle: "Qual linguagem combina mais com sua marca?",
    options: [
      {
        id: "tone-authority",
        title: "Autoridade",
        hint: "Confiante, técnico e direto",
        image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1400&q=80",
      },
      {
        id: "tone-human",
        title: "Humano",
        hint: "Próximo, acolhedor e conversacional",
        image: "https://images.unsplash.com/photo-1529156069898-49953e39b3ac?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    id: "visual",
    title: "Direção visual",
    subtitle: "Que estética você quer no topo da página?",
    options: [
      {
        id: "visual-clean",
        title: "Clean premium",
        hint: "Mais branco, respiro e elegância",
        image: "https://images.unsplash.com/photo-1518005020951-eccb494ad742?auto=format&fit=crop&w=1400&q=80",
      },
      {
        id: "visual-bold",
        title: "Bold contraste",
        hint: "Mais impacto e energia visual",
        image: "https://images.unsplash.com/photo-1496449903678-68ddcb189a24?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    id: "cta",
    title: "Canal de conversão",
    subtitle: "Para onde o usuário vai ao clicar no CTA?",
    options: [
      {
        id: "cta-whatsapp",
        title: "WhatsApp",
        hint: "Conversa rápida com equipe",
        image: "https://images.unsplash.com/photo-1611746872915-64382b5c76da?auto=format&fit=crop&w=1400&q=80",
      },
      {
        id: "cta-form",
        title: "Formulário",
        hint: "Captação estruturada de lead",
        image: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
];

const sectionCategories: Category[] = [
  {
    id: "heroStyle",
    title: "Exemplo de Hero",
    subtitle: "Qual abertura você quer usar como base?",
    options: [
      {
        id: "heroStyle-statement",
        title: "Headline forte",
        hint: "Frase de impacto + subheadline curta",
        image: "https://images.unsplash.com/photo-1526498460520-4c246339dccb?auto=format&fit=crop&w=1400&q=80",
      },
      {
        id: "heroStyle-offer",
        title: "Hero com oferta",
        hint: "Benefício + condição especial",
        image: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    id: "proofStyle",
    title: "Exemplo de Prova",
    subtitle: "Como você quer mostrar credibilidade?",
    options: [
      {
        id: "proofStyle-cases",
        title: "Casos e histórias",
        hint: "Antes e depois com contexto",
        image: "https://images.unsplash.com/photo-1450101499163-c8848c66ca85?auto=format&fit=crop&w=1400&q=80",
      },
      {
        id: "proofStyle-metrics",
        title: "Resultados numéricos",
        hint: "Gráficos e indicadores objetivos",
        image: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    id: "offerStyle",
    title: "Exemplo de Oferta",
    subtitle: "Como apresentar a parte comercial?",
    options: [
      {
        id: "offerStyle-single",
        title: "Oferta única",
        hint: "Uma decisão clara",
        image: "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1400&q=80",
      },
      {
        id: "offerStyle-plans",
        title: "Planos comparados",
        hint: "Duas ou três opções",
        image: "https://images.unsplash.com/photo-1554224154-22dec7ec8818?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
  {
    id: "faqStyle",
    title: "Exemplo de FAQ",
    subtitle: "Que tipo de perguntas devem aparecer?",
    options: [
      {
        id: "faqStyle-short",
        title: "FAQ curto",
        hint: "Poucas dúvidas críticas",
        image: "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1400&q=80",
      },
      {
        id: "faqStyle-complete",
        title: "FAQ completo",
        hint: "Cobrir objeções em detalhe",
        image: "https://images.unsplash.com/photo-1552664730-d307ca884978?auto=format&fit=crop&w=1400&q=80",
      },
    ],
  },
];

function selectedOption(categories: Category[], map: Record<string, string>, categoryId: string): Option | null {
  const category = categories.find((item) => item.id === categoryId);
  if (!category) return null;
  return category.options.find((option) => option.id === map[categoryId]) ?? null;
}

function buildGeneratedCopy(
  briefingChoices: Record<string, string>,
  sectionChoices: Record<string, string>,
  prompt: string,
): CopySection[] {
  const goal = selectedOption(briefingCategories, briefingChoices, "goal")?.title ?? "Gerar resultados";
  const audience = selectedOption(briefingCategories, briefingChoices, "audience")?.title ?? "público ideal";
  const tone = briefingChoices.tone === "tone-authority" ? "autoridade" : "humano";

  const heroVariant = sectionChoices.heroStyle === "heroStyle-offer";
  const proofVariant = sectionChoices.proofStyle === "proofStyle-metrics";
  const offerVariant = sectionChoices.offerStyle === "offerStyle-plans";
  const faqVariant = sectionChoices.faqStyle === "faqStyle-complete";

  const heroCopy = heroVariant
    ? `Transforme ${goal.toLowerCase()} com uma oferta clara e acionável para ${audience.toLowerCase()}.`
    : `Uma mensagem forte para ${goal.toLowerCase()} e fazer ${audience.toLowerCase()} agir agora.`;

  const proofCopy = proofVariant
    ? "Resultados concretos: métricas reais, evolução consistente e impacto comprovado em números."
    : "Casos reais de clientes que aplicaram o método e atingiram resultados com segurança.";

  const offerCopy = offerVariant
    ? "Escolha o plano ideal para o seu momento e avance com uma estrutura comercial previsível."
    : "Uma proposta direta, com escopo claro e próximos passos definidos para começar imediatamente.";

  const faqCopy = faqVariant
    ? "Respondemos as principais dúvidas sobre prazo, investimento, escopo, suporte e próximos passos."
    : "As dúvidas essenciais para decisão rápida: prazo, investimento e como começar.";

  const ctaCopy = briefingChoices.cta === "cta-form"
    ? "Preencha o formulário e receba um plano de ação personalizado."
    : "Clique no WhatsApp e fale agora com nosso time.";

  return [
    { id: "hero", title: "Hero", copy: heroCopy },
    { id: "benefits", title: "Benefícios", copy: `Estrutura pensada para ${goal.toLowerCase()} com comunicação em tom ${tone}.` },
    { id: "proof", title: "Prova", copy: proofCopy },
    { id: "offer", title: "Oferta", copy: offerCopy },
    { id: "faq", title: "FAQ", copy: faqCopy },
    { id: "cta", title: "CTA", copy: ctaCopy },
    { id: "context", title: "Contexto", copy: prompt || "Projeto orientado por briefing visual e escolhas estratégicas da marca." },
  ];
}

export default function SiteWizard() {
  const queue = useQueue();
  const auth = useAuth();
  const params = useLocalSearchParams<{ orderId?: string; prompt?: string }>();
  const orderId = typeof params.orderId === "string" ? params.orderId : undefined;
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  const editing = orderId ? queue.getOrder(orderId) : null;

  const [stage, setStage] = useState<Stage>("briefing");
  const [briefingIndex, setBriefingIndex] = useState(0);
  const [sectionsIndex, setSectionsIndex] = useState(0);
  const [briefingChoices, setBriefingChoices] = useState<Record<string, string>>({});
  const [sectionChoices, setSectionChoices] = useState<Record<string, string>>({});
  const [copySections, setCopySections] = useState<CopySection[]>([]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  useEffect(() => {
    if (!editing) return;

    const payload = editing.payload as Record<string, unknown>;

    if (payload.selectedChoices && typeof payload.selectedChoices === "object" && !Array.isArray(payload.selectedChoices)) {
      setBriefingChoices(payload.selectedChoices as Record<string, string>);
    }

    if (payload.sectionChoices && typeof payload.sectionChoices === "object" && !Array.isArray(payload.sectionChoices)) {
      setSectionChoices(payload.sectionChoices as Record<string, string>);
    }

    if (Array.isArray(payload.generatedCopy)) {
      const valid = (payload.generatedCopy as unknown[])
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const raw = item as Record<string, unknown>;
          if (typeof raw.id !== "string" || typeof raw.title !== "string" || typeof raw.copy !== "string") return null;
          return { id: raw.id, title: raw.title, copy: raw.copy } as CopySection;
        })
        .filter((item): item is CopySection => Boolean(item));
      if (valid.length > 0) {
        setCopySections(valid);
        setStage("copy");
      }
    }
  }, [editing]);

  useEffect(() => {
    if (stage !== "generating") return;

    const id = setTimeout(() => {
      const generated = buildGeneratedCopy(briefingChoices, sectionChoices, prompt);
      setCopySections(generated);
      setStage("copy");
    }, 2400);

    return () => clearTimeout(id);
  }, [stage, briefingChoices, sectionChoices, prompt]);

  const totalFlowSteps = briefingCategories.length + sectionCategories.length + 3;

  const currentFlowStep = useMemo(() => {
    if (stage === "briefing") return briefingIndex + 1;
    if (stage === "sections") return briefingCategories.length + sectionsIndex + 1;
    if (stage === "generating") return briefingCategories.length + sectionCategories.length + 1;
    if (stage === "copy") return briefingCategories.length + sectionCategories.length + 2;
    return totalFlowSteps;
  }, [stage, briefingIndex, sectionsIndex, totalFlowSteps]);

  const stageLabel =
    stage === "briefing"
      ? "Briefing estratégico"
      : stage === "sections"
      ? "Escolha de seções"
      : stage === "generating"
      ? "IA escrevendo"
      : stage === "copy"
      ? "Edição da copy"
      : "Revisão e envio";

  const objective = useMemo(() => {
    const goal = selectedOption(briefingCategories, briefingChoices, "goal")?.title ?? "Gerar resultado";
    const audience = selectedOption(briefingCategories, briefingChoices, "audience")?.title ?? "público ideal";
    return prompt || `${goal} para ${audience.toLowerCase()}.`;
  }, [briefingChoices, prompt]);

  const headline = useMemo(() => {
    const visual = selectedOption(briefingCategories, briefingChoices, "visual")?.title ?? "Site";
    const tone = selectedOption(briefingCategories, briefingChoices, "tone")?.title ?? "direto";
    return `${visual} com linguagem ${tone.toLowerCase()}`;
  }, [briefingChoices]);

  const cta = useMemo(() => {
    const ctaId = briefingChoices.cta;
    if (ctaId === "cta-form") return "Quero receber proposta";
    return "Falar no WhatsApp";
  }, [briefingChoices]);

  const sections = useMemo(() => copySections.map((item) => item.title), [copySections]);

  const title = useMemo(() => `Site: ${headline.slice(0, 36)}`, [headline]);

  const summary = useMemo(() => {
    const chosen = Object.keys(briefingChoices).length + Object.keys(sectionChoices).length;
    return `Objetivo: ${objective} · Escolhas: ${chosen}`;
  }, [objective, briefingChoices, sectionChoices]);

  const buildPayload = () => ({
    objective,
    headline,
    cta,
    sections,
    selectedChoices: briefingChoices,
    sectionChoices,
    generatedCopy: copySections,
  });

  const saveDraft = async () => {
    const payload = buildPayload();
    if (orderId) {
      await queue.updateOrder(orderId, { title, summary, payload });
      router.navigate("/orders");
      return;
    }
    await queue.createOrder({ type: "site", title, summary, payload });
    router.navigate("/orders");
  };

  const submit = async () => {
    const payload = buildPayload();
    let id = orderId;

    if (!id) {
      const created = await queue.createOrder({ type: "site", title, summary, payload });
      id = created.id;
    } else {
      await queue.updateOrder(id, { title, summary, payload });
    }

    if (!auth.profileProductionComplete) {
      router.push({ pathname: "/onboarding/ray-x", params: { mode: "production", pendingOrderId: id } });
      return;
    }

    await queue.submitOrder(id);
    router.navigate("/orders");
  };

  const chooseBriefing = (optionId: string) => {
    const current = briefingCategories[briefingIndex];
    if (!current) return;
    setBriefingChoices((prev) => ({ ...prev, [current.id]: optionId }));

    if (briefingIndex >= briefingCategories.length - 1) {
      setStage("sections");
      setSectionsIndex(0);
      return;
    }
    setBriefingIndex((idx) => idx + 1);
  };

  const chooseSection = (optionId: string) => {
    const current = sectionCategories[sectionsIndex];
    if (!current) return;
    setSectionChoices((prev) => ({ ...prev, [current.id]: optionId }));

    if (sectionsIndex >= sectionCategories.length - 1) {
      setStage("generating");
      return;
    }
    setSectionsIndex((idx) => idx + 1);
  };

  const openEditor = (section: CopySection) => {
    setEditingId(section.id);
    setEditingText(section.copy);
  };

  const applyEdit = () => {
    if (!editingId) return;
    setCopySections((prev) => prev.map((item) => (item.id === editingId ? { ...item, copy: editingText.trim() || item.copy } : item)));
    setEditingId(null);
    setEditingText("");
  };

  const currentBriefing = briefingCategories[briefingIndex];
  const currentSection = sectionCategories[sectionsIndex];

  const renderChoicePair = (category: Category, onChoose: (optionId: string) => void) => (
    <>
      <TouchableOpacity activeOpacity={0.92} onPress={() => onChoose(category.options[0].id)} style={styles.choiceCard}>
        <ImageBackground source={{ uri: category.options[0].image }} style={styles.choiceImage} imageStyle={styles.choiceImageRadius}>
          <View style={styles.overlay}>
            <Text style={styles.choiceTag}>OPCAO A</Text>
            <Text style={styles.choiceTitle}>{category.options[0].title}</Text>
            <Text style={styles.choiceHint}>{category.options[0].hint}</Text>
          </View>
        </ImageBackground>
      </TouchableOpacity>

      <TouchableOpacity activeOpacity={0.92} onPress={() => onChoose(category.options[1].id)} style={styles.choiceCard}>
        <ImageBackground source={{ uri: category.options[1].image }} style={styles.choiceImage} imageStyle={styles.choiceImageRadius}>
          <View style={styles.overlay}>
            <Text style={styles.choiceTag}>OPCAO B</Text>
            <Text style={styles.choiceTitle}>{category.options[1].title}</Text>
            <Text style={styles.choiceHint}>{category.options[1].hint}</Text>
          </View>
        </ImageBackground>
      </TouchableOpacity>
    </>
  );

  return (
    <Screen style={styles.screenDense}>
      {stage === "briefing" && currentBriefing ? (
        <View style={styles.fullscreenWrap}>
          <View style={styles.topBar}>
            <Kicker>Briefing de site</Kicker>
            <Title>Este ou Aquele</Title>
            <Body style={styles.subtitle}>{currentBriefing.title}</Body>
            <Body style={styles.helper}>{currentBriefing.subtitle}</Body>
            <FlowStepIndicator step={currentFlowStep} total={totalFlowSteps} label={stageLabel} />
          </View>
          {renderChoicePair(currentBriefing, chooseBriefing)}
        </View>
      ) : null}

      {stage === "sections" && currentSection ? (
        <View style={styles.fullscreenWrap}>
          <View style={styles.topBar}>
            <Kicker>Modelo de seções</Kicker>
            <Title>Este ou Aquele</Title>
            <Body style={styles.subtitle}>{currentSection.title}</Body>
            <Body style={styles.helper}>{currentSection.subtitle}</Body>
            <FlowStepIndicator step={currentFlowStep} total={totalFlowSteps} label={stageLabel} />
          </View>
          {renderChoicePair(currentSection, chooseSection)}
        </View>
      ) : null}

      {stage === "generating" ? (
        <View style={styles.generatingWrap}>
          <View style={styles.topBar}>
            <Kicker>IA em ação</Kicker>
            <Title>Gerando sua copy</Title>
            <Body style={styles.helper}>Criando textos personalizados com base nas suas escolhas...</Body>
            <FlowStepIndicator step={currentFlowStep} total={totalFlowSteps} label={stageLabel} />
          </View>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={realTheme.colors.green} />
            <Text style={styles.loadingText}>Analisando briefing visual</Text>
            <Text style={styles.loadingText}>Escrevendo seções do site</Text>
            <Text style={styles.loadingText}>Ajustando tom e CTA</Text>
          </View>
        </View>
      ) : null}

      {stage === "copy" ? (
        <ScrollView contentContainerStyle={styles.reviewContent} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <Kicker>Copy gerada</Kicker>
            <Title>Edite seção por seção</Title>
            <Body style={styles.helper}>Toque no lápis para ajustar cada texto.</Body>
            <FlowStepIndicator step={currentFlowStep} total={totalFlowSteps} label={stageLabel} />
          </View>

          {copySections.map((section) => (
            <View key={section.id} style={styles.copyCard}>
              <View style={styles.copyHead}>
                <Text style={styles.copyTitle}>{section.title}</Text>
                <TouchableOpacity style={styles.editButton} onPress={() => openEditor(section)}>
                  <Ionicons name="pencil" size={14} color={realTheme.colors.text} />
                  <Text style={styles.editText}>Editar</Text>
                </TouchableOpacity>
              </View>

              {editingId === section.id ? (
                <>
                  <TextInput
                    value={editingText}
                    onChangeText={setEditingText}
                    style={styles.editorInput}
                    multiline
                    textAlignVertical="top"
                  />
                  <View style={styles.editorActions}>
                    <Button label="Cancelar" variant="secondary" onPress={() => setEditingId(null)} style={styles.action} />
                    <Button label="Salvar" onPress={applyEdit} style={styles.action} />
                  </View>
                </>
              ) : (
                <Text style={styles.copyText}>{section.copy}</Text>
              )}
            </View>
          ))}

          <Button label="Continuar para revisão" onPress={() => setStage("review")} />
        </ScrollView>
      ) : null}

      {stage === "review" ? (
        <ScrollView contentContainerStyle={styles.reviewContent} keyboardShouldPersistTaps="handled">
          <View style={styles.topBar}>
            <Kicker>Revisão final</Kicker>
            <Title>Enviar ou salvar</Title>
            <Body style={styles.helper}>Tudo pronto para seguir para produção.</Body>
            <FlowStepIndicator step={currentFlowStep} total={totalFlowSteps} label={stageLabel} />
          </View>

          <View style={styles.reviewRow}>
            <Text style={styles.reviewCategory}>Objetivo</Text>
            <Text style={styles.reviewChoice}>{objective}</Text>
          </View>

          <View style={styles.reviewRow}>
            <Text style={styles.reviewCategory}>Headline base</Text>
            <Text style={styles.reviewChoice}>{headline}</Text>
          </View>

          <View style={styles.reviewRow}>
            <Text style={styles.reviewCategory}>CTA principal</Text>
            <Text style={styles.reviewChoice}>{cta}</Text>
          </View>

          {!auth.profileProductionComplete ? (
            <Body style={styles.pending}>Para enviar, complete seu cadastro no Raio-X.</Body>
          ) : null}

          <View style={styles.reviewActionsRow}>
            <Button label="Voltar" variant="secondary" onPress={() => setStage("copy")} style={styles.action} />
            <Button label="Salvar rascunho" variant="secondary" onPress={saveDraft} style={styles.action} />
          </View>
          <Button label="Enviar para Real" onPress={submit} />
        </ScrollView>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenDense: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 10,
  },
  fullscreenWrap: {
    flex: 1,
    gap: 8,
  },
  topBar: {
    gap: 6,
    borderRadius: realTheme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(237,237,238,0.1)",
    backgroundColor: "rgba(10,12,15,0.4)",
    padding: 10,
  },
  subtitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 15,
  },
  helper: {
    color: realTheme.colors.muted,
    fontSize: 12,
  },
  choiceCard: {
    flex: 1,
    minHeight: 220,
  },
  choiceImage: {
    flex: 1,
    justifyContent: "flex-end",
  },
  choiceImageRadius: {
    borderRadius: realTheme.radius.md,
  },
  overlay: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: "rgba(4, 6, 8, 0.62)",
    borderBottomLeftRadius: realTheme.radius.md,
    borderBottomRightRadius: realTheme.radius.md,
    gap: 2,
  },
  choiceTag: {
    color: "rgba(237,237,238,0.88)",
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  choiceTitle: {
    color: "#FFFFFF",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 22,
    lineHeight: 26,
  },
  choiceHint: {
    color: "rgba(237,237,238,0.92)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  generatingWrap: {
    flex: 1,
    gap: 10,
  },
  loadingCard: {
    flex: 1,
    borderRadius: realTheme.radius.md,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: "rgba(15, 18, 24, 0.74)",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 18,
  },
  loadingText: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 14,
  },
  reviewContent: {
    paddingBottom: 28,
    gap: 10,
  },
  copyCard: {
    borderRadius: realTheme.radius.sm,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: "rgba(15, 18, 24, 0.74)",
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 8,
  },
  copyHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  copyTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 15,
  },
  editButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    borderRadius: realTheme.radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 9,
    backgroundColor: "rgba(20,22,28,0.8)",
  },
  editText: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
  },
  copyText: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
  },
  editorInput: {
    minHeight: 92,
    borderRadius: realTheme.radius.sm,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: realTheme.colors.panelSoft,
    paddingVertical: 10,
    paddingHorizontal: 10,
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 14,
  },
  editorActions: {
    flexDirection: "row",
    gap: 8,
  },
  reviewRow: {
    borderRadius: realTheme.radius.sm,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: "rgba(15, 18, 24, 0.74)",
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 3,
  },
  reviewCategory: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
  },
  reviewChoice: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  reviewActionsRow: {
    flexDirection: "row",
    gap: 8,
  },
  action: {
    flex: 1,
  },
  pending: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
  },
});
