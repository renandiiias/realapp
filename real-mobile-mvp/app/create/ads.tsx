import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState, useRef } from "react";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { ScrollView, StyleSheet, View, Animated, Pressable, Alert, ActivityIndicator, TextInput } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../../src/auth/AuthProvider";
import { useQueue } from "../../src/queue/QueueProvider";
import { pickVideoWithRecovery } from "../../src/services/videoPickerRecovery";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Field } from "../../src/ui/components/Field";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Title } from "../../src/ui/components/Typography";
import { SPACING, ANIMATION_DURATION } from "../../src/utils/constants";

type Step =
  | { id: "welcome"; type: "message" }
  | { id: "objective"; type: "input"; question: string; key: "objective" }
  | { id: "offer"; type: "input"; question: string; key: "offer" }
  | { id: "budget"; type: "choice"; question: string; key: "budget"; options: Array<{ label: string; value: string }> }
  | { id: "audience"; type: "input"; question: string; key: "audience" }
  | { id: "region"; type: "input"; question: string; key: "region" }
  | { id: "destinationWhatsApp"; type: "input"; question: string; key: "destinationWhatsApp" }
  | { id: "style"; type: "choice"; question: string; key: "style"; options: Array<{ label: string; value: string; subtitle: string }> }
  | { id: "media"; type: "media" }
  | { id: "review"; type: "review" };

const CONVERSATION_STEPS: Step[] = [
  { id: "welcome", type: "message" },
  { id: "objective", type: "input", question: "Qual o objetivo da campanha?", key: "objective" },
  { id: "offer", type: "input", question: "Qual a oferta principal?", key: "offer" },
  {
    id: "budget",
    type: "choice",
    question: "Quanto você quer investir por mês?",
    key: "budget",
    options: [
      { label: "Até R$ 500", value: "ate_500" },
      { label: "R$ 500 - R$ 1.500", value: "500_1500" },
      { label: "R$ 1.500 - R$ 5.000", value: "1500_5000" },
      { label: "Mais de R$ 5.000", value: "5000_mais" },
    ],
  },
  { id: "audience", type: "input", question: "Quem é seu público-alvo?", key: "audience" },
  { id: "region", type: "input", question: "Qual região quer alcançar?", key: "region" },
  { id: "destinationWhatsApp", type: "input", question: "Qual WhatsApp deve receber as mensagens?", key: "destinationWhatsApp" },
  {
    id: "style",
    type: "choice",
    question: "Qual estilo de criativo prefere?",
    key: "style",
    options: [
      { label: "Antes x Depois", value: "antes_depois", subtitle: "Mostra resultados" },
      { label: "Problema → Solução", value: "problema_solucao", subtitle: "Educacional" },
      { label: "Prova Social", value: "prova_social", subtitle: "Depoimentos reais" },
    ],
  },
  { id: "media", type: "media" },
  { id: "review", type: "review" },
];

interface ConversationData {
  objective: string;
  offer: string;
  budget: string;
  audience: string;
  region: string;
  destinationWhatsApp: string;
  style: string;
}

type LocalMedia = {
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  kind: "image" | "video";
};

type VideoPickerEventLogger = (event: string, level: DebugLevel, meta?: Record<string, unknown>) => void;

type DebugLevel = "info" | "warn" | "error";

type AdsBusinessBriefPrefill = Partial<ConversationData>;

type AdsBusinessBriefInput = {
  brief: string;
  currentData: ConversationData;
  companyContext?: {
    companyName?: string;
    offerSummary?: string;
    mainDifferential?: string;
    primarySalesChannel?: string;
    marketSegment?: string;
  };
};

function normalizeE164(raw: string): string | null {
  const cleaned = raw.replace(/[^\d+]/g, "");
  if (!cleaned) return null;
  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1).replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return null;
    return `+${digits}`;
  }
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return null;
  return `+${digits.length <= 11 ? `55${digits}` : digits}`;
}

function guessMime(kind: "image" | "video", uri: string): string {
  const lower = uri.toLowerCase();
  if (kind === "image") {
    if (lower.endsWith(".png")) return "image/png";
    if (lower.endsWith(".webp")) return "image/webp";
    return "image/jpeg";
  }
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".webm")) return "video/webm";
  return "video/mp4";
}

async function pickMedia(
  kind: "image" | "video",
  options?: { traceId?: string; onVideoPickerEvent?: VideoPickerEventLogger },
): Promise<LocalMedia | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert("Permissão", "Permita acesso à galeria para enviar criativo.");
    return null;
  }

  if (kind === "video") {
    try {
      const recovered = await pickVideoWithRecovery({
        traceId: options?.traceId || makeAdsTraceId("ads_picker"),
        maxSizeBytes: 30 * 1024 * 1024,
        log: ({ event, level, meta }) => options?.onVideoPickerEvent?.(event, level ?? "info", meta ?? {}),
      });
      if (!recovered) return null;
      return {
        uri: recovered.uri,
        fileName: recovered.fileName,
        mimeType: recovered.mimeType || guessMime("video", recovered.uri),
        sizeBytes: recovered.fileSize,
        kind: "video",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "");
      options?.onVideoPickerEvent?.("picker_attempt_failed", "warn", { reason: message });
      if (/oversize/i.test(message)) {
        Alert.alert("Arquivo inválido", "Use arquivo de até 30MB.");
        return null;
      }
      Alert.alert("Falha ao abrir vídeo", "Não foi possível recuperar o vídeo automaticamente.");
      return null;
    }
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: "images",
    quality: 1,
  });

  if (result.canceled || !result.assets?.[0]) return null;
  const selected = result.assets[0];
  const info = await FileSystem.getInfoAsync(selected.uri);
  const sizeBytes = typeof (info as { size?: number }).size === "number" ? (info as { size: number }).size : 0;
  if (!sizeBytes || sizeBytes > 30 * 1024 * 1024) {
    Alert.alert("Arquivo inválido", "Use arquivo de até 30MB.");
    return null;
  }

  const fileName = (selected.fileName || `${kind}_${Date.now()}`).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return {
    uri: selected.uri,
    fileName,
    mimeType: selected.mimeType || guessMime(kind, selected.uri),
    sizeBytes,
    kind,
  };
}

export default function AdsWizard() {
  const queue = useQueue();
  const auth = useAuth();
  const params = useLocalSearchParams<{ orderId?: string; prompt?: string }>();
  const orderId = typeof params.orderId === "string" ? params.orderId : undefined;
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [data, setData] = useState<ConversationData>({
    objective: prompt || "",
    offer: "",
    budget: "",
    audience: "",
    region: "",
    destinationWhatsApp: auth.companyProfile?.whatsappBusiness ?? "",
    style: "",
  });
  const [inputValue, setInputValue] = useState("");
  const [introComposerOpen, setIntroComposerOpen] = useState(false);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [media, setMedia] = useState<LocalMedia | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const traceIdRef = useRef(makeAdsTraceId());
  const queueApiBaseUrl = process.env.EXPO_PUBLIC_QUEUE_API_BASE_URL?.trim() || "";

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const scrollRef = useRef<ScrollView>(null);

  const currentStep = CONVERSATION_STEPS[currentStepIndex];

  const logClientEvent = (stage: string, event: string, meta?: Record<string, unknown>, level: "info" | "warn" | "error" = "info") => {
    void sendAdsClientLog({
      baseUrl: queueApiBaseUrl,
      traceId: traceIdRef.current,
      stage,
      event,
      level,
      meta,
    });
  };

  useEffect(() => {
    if (prompt) {
      setCurrentStepIndex(1);
    }
  }, [prompt]);

  useEffect(() => {
    logClientEvent("ads_wizard", "screen_opened", {
      hasOrderId: Boolean(orderId),
      hasPrompt: Boolean(prompt),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    fadeAnim.setValue(0);
    slideAnim.setValue(50);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: ANIMATION_DURATION.slow,
        useNativeDriver: true,
      }),
      Animated.spring(slideAnim, {
        toValue: 0,
        tension: 50,
        friction: 8,
        useNativeDriver: true,
      }),
    ]).start();

    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [currentStepIndex, fadeAnim, slideAnim]);

  const handleNext = (value?: string) => {
    if (!currentStep) return;

    if (currentStep.type === "input" && currentStep.key) {
      setData((prev) => ({ ...prev, [currentStep.key]: value || inputValue }));
      setInputValue("");
      logClientEvent("ads_wizard", "input_step_completed", {
        stepId: currentStep.id,
        key: currentStep.key,
      });
    } else if (currentStep.type === "choice" && currentStep.key && value) {
      setData((prev) => ({ ...prev, [currentStep.key]: value }));
      logClientEvent("ads_wizard", "choice_step_completed", {
        stepId: currentStep.id,
        key: currentStep.key,
        value,
      });
    }

    if (currentStepIndex < CONVERSATION_STEPS.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!media) {
      Alert.alert("Mídia obrigatória", "Selecione imagem ou vídeo para publicar o anúncio.");
      return;
    }

    const destinationWhatsApp = normalizeE164(data.destinationWhatsApp);
    if (!destinationWhatsApp) {
      Alert.alert("WhatsApp inválido", "Informe um WhatsApp válido, exemplo: +5511999999999");
      return;
    }

    setSubmitting(true);
    logClientEvent("ads_wizard", "submit_started", {
      hasMedia: Boolean(media),
      mediaKind: media?.kind ?? null,
    });
    const title = data.offer ? `Tráfego: ${data.offer.slice(0, 36)}` : "Tráfego (Meta)";
    const summary = `${data.objective} • ${data.budget} • ${data.region}`;
    const customerName = String(auth.companyProfile?.companyName || "").trim();
    const payloadBase = {
      objective: data.objective,
      offer: data.offer,
      budget: data.budget,
      audience: data.audience,
      region: data.region,
      destinationWhatsApp,
      style: data.style,
      preferredCreative: data.style,
      ...(customerName ? { customerName } : {}),
      mediaAssetIds: [] as string[],
    };

    let id = orderId;

    try {
      if (!id) {
        const created = await queue.createOrder({ type: "ads", title, summary, payload: payloadBase });
        id = created.id;
      } else {
        await queue.updateOrder(id, { title, summary, payload: payloadBase });
      }

      const base64Data = await FileSystem.readAsStringAsync(media.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const uploaded = await queue.uploadOrderAsset(id, {
        fileName: media.fileName,
        mimeType: media.mimeType,
        base64Data,
        kind: media.kind,
        sizeBytes: media.sizeBytes,
      });

      await queue.updateOrder(id, {
        payload: { ...payloadBase, mediaAssetIds: [uploaded.id] },
        title,
        summary,
      });

      if (!auth.profileProductionComplete) {
        router.push({ pathname: "/onboarding/ray-x", params: { mode: "production", pendingOrderId: id } });
        return;
      }

      await queue.submitOrder(id);
      logClientEvent("ads_wizard", "submit_succeeded", { orderId: id });
      router.navigate("/orders");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao enviar pedido.";
      logClientEvent(
        "ads_wizard",
        "submit_failed",
        {
          orderId: id ?? null,
          fingerprint: buildErrorFingerprint(error, "ads_submit"),
          message,
        },
        "error",
      );
      Alert.alert("Erro", message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleIntroSubmit = async (brief: string) => {
    if (!brief.trim() || intakeLoading) return;
    setIntakeLoading(true);
    logClientEvent("ads_wizard", "intro_brief_submitted", {
      chars: brief.trim().length,
    });

    try {
      const aiPrefill = await analyzeAdsBusinessBrief({
        brief: brief.trim(),
        currentData: data,
        companyContext: {
          companyName: auth.companyProfile?.companyName ?? "",
          offerSummary: auth.companyProfile?.offerSummary ?? "",
          mainDifferential: auth.companyProfile?.mainDifferential ?? "",
          primarySalesChannel: auth.companyProfile?.primarySalesChannel ?? "",
          marketSegment: auth.rayX?.marketSegment ?? "",
        },
      });

      const mergedDataSnapshot: ConversationData = {
        ...data,
        objective: aiPrefill.objective || data.objective || "Gerar novas conversas de clientes",
        offer: aiPrefill.offer || data.offer || "Oferta principal do negócio informada no chat",
        budget: aiPrefill.budget || data.budget || "500_1500",
        audience: aiPrefill.audience || data.audience || "Público descrito na conversa inicial",
        region: aiPrefill.region || data.region || "Região principal informada pelo cliente",
        destinationWhatsApp: aiPrefill.destinationWhatsApp || data.destinationWhatsApp || "",
        style: aiPrefill.style || data.style || "problema_solucao",
      };
      setData(mergedDataSnapshot);

      logClientEvent("ads_wizard", "intro_prefill_applied", {
        hasObjective: Boolean(aiPrefill.objective),
        hasOffer: Boolean(aiPrefill.offer),
        hasBudget: Boolean(aiPrefill.budget),
        hasAudience: Boolean(aiPrefill.audience),
        hasRegion: Boolean(aiPrefill.region),
        hasDestinationWhatsApp: Boolean(aiPrefill.destinationWhatsApp),
        hasStyle: Boolean(aiPrefill.style),
      });

      setIntroComposerOpen(false);
      const mediaIndex = CONVERSATION_STEPS.findIndex((item) => item.id === "media");
      setCurrentStepIndex(mediaIndex >= 0 ? mediaIndex : CONVERSATION_STEPS.length - 1);
    } catch (error) {
      logClientEvent(
        "ads_wizard",
        "intro_prefill_failed",
        {
          fingerprint: buildErrorFingerprint(error, "ads_intro_prefill"),
          fallbackToManual: true,
        },
        "warn",
      );
      setCurrentStepIndex(1);
    } finally {
      setIntakeLoading(false);
    }
  };

  const progress = ((currentStepIndex + 1) / CONVERSATION_STEPS.length) * 100;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.progressBar}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: `${progress}%`,
                opacity: fadeAnim,
              },
            ]}
          />
        </View>
        {currentStepIndex > 0 && (
          <Pressable onPress={handleBack} style={styles.backButton}>
            <Body style={styles.backText}>← Voltar</Body>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.stepContainer,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }],
            },
          ]}
        >
          {currentStep?.type === "message" && (
            <WelcomeStep
              introComposerOpen={introComposerOpen}
              onStartIntro={() => {
                setIntroComposerOpen(true);
                logClientEvent("ads_wizard", "intro_animation_started");
              }}
              onSubmitIntro={(brief) => void handleIntroSubmit(brief)}
              loading={intakeLoading}
            />
          )}

          {currentStep?.type === "input" && (
            <InputStep
              question={currentStep.question}
              value={inputValue || data[currentStep.key]}
              onChange={setInputValue}
              onNext={handleNext}
              placeholder={getPlaceholder(currentStep.key)}
            />
          )}

          {currentStep?.type === "choice" && (
            <ChoiceStep question={currentStep.question} options={currentStep.options} selected={data[currentStep.key]} onSelect={handleNext} />
          )}

          {currentStep?.type === "media" && (
            <MediaStep
              media={media}
              onPickImage={() => void pickMedia("image").then((item) => item && setMedia(item))}
              onPickVideo={() =>
                void pickMedia("video", {
                  traceId: traceIdRef.current,
                  onVideoPickerEvent: (event, level, meta) => {
                    logClientEvent("picker", event, meta, level);
                  },
                }).then((item) => item && setMedia(item))
              }
              onNext={() => handleNext()}
            />
          )}

          {currentStep?.type === "review" && <ReviewStep data={data} media={media} onSubmit={handleSubmit} submitting={submitting} onEdit={(stepId) => {
            const index = CONVERSATION_STEPS.findIndex((s) => s.id === stepId);
            if (index !== -1) setCurrentStepIndex(index);
          }} />}
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

function WelcomeStep({
  introComposerOpen,
  onStartIntro,
  onSubmitIntro,
  loading,
}: {
  introComposerOpen: boolean;
  onStartIntro: () => void;
  onSubmitIntro: (brief: string) => void;
  loading: boolean;
}) {
  const questions = [
    { id: "channel", text: "Oi, sou a Real. Por onde você quer que seus clientes te chamem?", suggestions: ["WhatsApp", "Instagram"] },
    { id: "business", text: "Perfeito. Agora me conta sobre seu negócio e sua principal oferta.", suggestions: [] },
    { id: "region", text: "Qual região você quer atingir primeiro?", suggestions: ["Minha cidade", "Capital + região metropolitana"] },
    { id: "audience", text: "Quem é o público ideal para esse anúncio?", suggestions: [] },
    { id: "budget", text: "Quanto você pretende investir por mês?", suggestions: ["Até R$ 500", "R$ 500 - R$ 1.500", "R$ 1.500 - R$ 5.000"] },
    { id: "destination", text: "Última: qual contato deve receber as mensagens?", suggestions: [] },
  ] as const;

  type QuestionId = (typeof questions)[number]["id"];
  type Message = { id: string; role: "assistant" | "user"; text: string };

  const [questionIndex, setQuestionIndex] = useState(0);
  const [followupCount, setFollowupCount] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<QuestionId, string>>>({});
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const chatOpacity = useRef(new Animated.Value(0)).current;
  const chatTranslateY = useRef(new Animated.Value(8)).current;
  const chatScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (!introComposerOpen) {
      setQuestionIndex(0);
      setFollowupCount(0);
      setAnswers({});
      setMessages([]);
      setDraft("");
      chatOpacity.setValue(0);
      chatTranslateY.setValue(8);
      return;
    }

    setMessages([{ id: "assistant-initial", role: "assistant", text: questions[0].text }]);
    Animated.parallel([
      Animated.timing(chatOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(chatTranslateY, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [chatOpacity, chatTranslateY, introComposerOpen]);

  useEffect(() => {
    if (!messages.length) return;
    const timer = setTimeout(() => chatScrollRef.current?.scrollToEnd({ animated: true }), 30);
    return () => clearTimeout(timer);
  }, [messages]);

  const currentQuestion = questions[questionIndex];

  const appendAssistant = (text: string) => {
    setMessages((prev) => [...prev, { id: `assistant-${Date.now()}-${prev.length}`, role: "assistant", text }]);
  };

  const normalizeBudgetText = (value: string): string => {
    const lower = value.toLowerCase();
    if (lower.includes("5000") || lower.includes("5.000") || lower.includes("5k")) return "Mais de R$ 5.000";
    if (lower.includes("1500") || lower.includes("1.500") || lower.includes("2.000") || lower.includes("3.000")) return "R$ 1.500 - R$ 5.000";
    if (lower.includes("500") || lower.includes("1.000")) return "R$ 500 - R$ 1.500";
    return "Até R$ 500";
  };

  const shouldAskFollowup = (questionId: QuestionId, answer: string, tries: number): string | null => {
    if (tries >= 2) return null;
    if (questionId === "channel") {
      const lower = answer.toLowerCase();
      if (!lower.includes("whatsapp") && !lower.includes("instagram")) return "Pode me responder só com WhatsApp ou Instagram para eu configurar certinho?";
    }
    if (questionId === "business" && answer.length < 22) return "Me ajuda com um pouco mais de detalhe: o que você vende e qual diferencial principal?";
    if (questionId === "region" && answer.length < 5) return "Pode detalhar melhor a região? Ex: cidade + bairro ou região metropolitana.";
    if (questionId === "audience" && answer.length < 12) return "Quem compra mais de você hoje? Faixa de idade, perfil ou interesse já ajuda.";
    if (questionId === "budget" && answer.length < 4) return "Me diz uma faixa aproximada mensal, tipo até R$500 ou R$500-R$1.500.";
    if (questionId === "destination" && answer.length < 5) return "Me passa o contato que deve receber as mensagens (número ou @).";
    return null;
  };

  const buildFinalBrief = (nextAnswers: Partial<Record<QuestionId, string>>): string => {
    const normalizedBudget = nextAnswers.budget ? normalizeBudgetText(nextAnswers.budget) : "Não informado";
    return [
      `Canal principal: ${nextAnswers.channel || "Não informado"}`,
      `Negócio e oferta: ${nextAnswers.business || "Não informado"}`,
      `Região alvo: ${nextAnswers.region || "Não informado"}`,
      `Público ideal: ${nextAnswers.audience || "Não informado"}`,
      `Investimento mensal: ${normalizedBudget}`,
      `Contato destino: ${nextAnswers.destination || "Não informado"}`,
    ].join(". ");
  };

  const submitAnswer = (rawValue: string) => {
    if (!currentQuestion || loading) return;
    const value = rawValue.trim();
    if (!value) return;
    setMessages((prev) => [...prev, { id: `user-${Date.now()}-${prev.length}`, role: "user", text: value }]);

    const followup = shouldAskFollowup(currentQuestion.id, value, followupCount);
    if (followup) {
      setFollowupCount((prev) => prev + 1);
      appendAssistant(followup);
      setDraft("");
      return;
    }

    const nextAnswers = { ...answers, [currentQuestion.id]: value };
    setAnswers(nextAnswers);
    setDraft("");
    setFollowupCount(0);

    if (questionIndex < questions.length - 1) {
      const nextIndex = questionIndex + 1;
      setQuestionIndex(nextIndex);
      appendAssistant(questions[nextIndex].text);
      return;
    }
    appendAssistant("Perfeito. Estou organizando tudo e pré-preenchendo sua campanha agora.");
    onSubmitIntro(buildFinalBrief(nextAnswers));
  };

  return (
    <View style={styles.welcomeContainer}>
      {!introComposerOpen ? (
        <>
          <View style={styles.iconContainer}>
            <Body style={styles.icon}>🚀</Body>
          </View>
          <View style={styles.introCard}>
            <Title style={styles.introTitle}>Clique em começar e vamos criar seu anúncio</Title>
            <Body style={styles.introSubtitle}>A Real te guia em perguntas simples e já preenche tudo para você.</Body>
            <Button label="Começar" onPress={onStartIntro} size="large" />
          </View>
        </>
      ) : (
        <Animated.View
          style={[
            styles.chatFullscreen,
            {
              opacity: chatOpacity,
              transform: [{ translateY: chatTranslateY }],
            },
          ]}
        >
          <Title style={styles.chatTitle}>Vamos criar seu anúncio</Title>
          <Body style={styles.chatSubtitle}>Conversa rápida. Eu te guio e já monto tudo para a campanha.</Body>

          <ScrollView ref={chatScrollRef} style={styles.chatMessagesScroll} contentContainerStyle={styles.chatMessagesContent} showsVerticalScrollIndicator={false}>
            {messages.map((item) => (
              <View key={item.id} style={item.role === "assistant" ? styles.botBubbleWrap : styles.userBubbleWrap}>
                <View style={item.role === "assistant" ? styles.botBubble : styles.userBubble}>
                  <Body style={styles.chatBubbleText}>{item.text}</Body>
                </View>
              </View>
            ))}

            {currentQuestion?.suggestions?.length ? (
              <View style={styles.quickOptions}>
                {currentQuestion.suggestions.map((suggestion) => (
                  <Pressable key={suggestion} style={styles.quickOptionChip} onPress={() => submitAnswer(suggestion)} disabled={loading}>
                    <Body style={styles.quickOptionText}>{suggestion}</Body>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </ScrollView>

          <View style={[styles.inputDockAds, { borderColor: inputFocused ? "rgba(69,255,102,0.72)" : "rgba(255,255,255,0.16)" }]}>
            <View style={styles.inputInnerAds}>
              <TextInput
                style={styles.dockInputAds}
                placeholder={loading ? "Analisando..." : "Digite sua resposta"}
                placeholderTextColor="rgba(237,237,238,0.38)"
                value={draft}
                onChangeText={setDraft}
                editable={!loading}
                returnKeyType="send"
                onSubmitEditing={() => submitAnswer(draft)}
                autoCapitalize="sentences"
                autoCorrect={false}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
              />
            </View>
            <Pressable style={[styles.sendButtonAds, (loading || !draft.trim()) && styles.buttonDisabledAds]} onPress={() => submitAnswer(draft)} disabled={loading || !draft.trim()}>
              {loading ? <ActivityIndicator color="#071306" size="small" /> : <Ionicons name="arrow-up" size={18} color="#071306" />}
            </Pressable>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

function InputStep({
  question,
  value,
  onChange,
  onNext,
  placeholder,
}: {
  question: string;
  value: string;
  onChange: (value: string) => void;
  onNext: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View style={styles.inputContainer}>
      <Title style={styles.question}>{question}</Title>
      <Field
        label=""
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        multiline={question.includes("público") || question.includes("região")}
        autoFocus
      />
      <Button label="Continuar" onPress={() => onNext(value)} disabled={!value.trim()} size="large" />
    </View>
  );
}

function ChoiceStep({
  question,
  options,
  selected,
  onSelect,
}: {
  question: string;
  options: Array<{ label: string; value: string; subtitle?: string }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.choiceContainer}>
      <Title style={styles.question}>{question}</Title>
      <View style={styles.options}>
        {options.map((option) => (
          <Pressable key={option.value} onPress={() => onSelect(option.value)} style={[styles.optionCard, selected === option.value && styles.optionCardSelected]}>
            <View style={styles.optionContent}>
              <Body style={selected === option.value ? styles.optionLabelActive : styles.optionLabel}>
                {option.label}
              </Body>
              {option.subtitle && <Body style={styles.optionSubtitle}>{option.subtitle}</Body>}
            </View>
            {selected === option.value && <Body style={styles.checkmark}>✓</Body>}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function MediaStep({
  media,
  onPickImage,
  onPickVideo,
  onNext,
}: {
  media: LocalMedia | null;
  onPickImage: () => void;
  onPickVideo: () => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.choiceContainer}>
      <Title style={styles.question}>Envie o criativo (imagem ou vídeo)</Title>
      <Body style={styles.mediaHint}>Esse arquivo será usado para publicar o anúncio na Meta.</Body>
      <View style={styles.options}>
        <Button label="Selecionar imagem" onPress={onPickImage} />
        <Button label="Selecionar vídeo" variant="secondary" onPress={onPickVideo} />
      </View>
      {media ? (
        <Card variant="subtle">
          <Body style={styles.mediaSelected}>Arquivo: {media.fileName}</Body>
          <Body style={styles.mediaSelected}>Tipo: {media.kind}</Body>
          <Body style={styles.mediaSelected}>Tamanho: {Math.round(media.sizeBytes / 1024)} KB</Body>
        </Card>
      ) : null}
      <Button label="Continuar" onPress={onNext} disabled={!media} size="large" />
    </View>
  );
}

function ReviewStep({
  data,
  media,
  onSubmit,
  submitting,
  onEdit,
}: {
  data: ConversationData;
  media: LocalMedia | null;
  onSubmit: () => void;
  submitting: boolean;
  onEdit: (stepId: string) => void;
}) {
  const budgetLabels: Record<string, string> = {
    ate_500: "Até R$ 500",
    "500_1500": "R$ 500 - R$ 1.500",
    "1500_5000": "R$ 1.500 - R$ 5.000",
    "5000_mais": "Mais de R$ 5.000",
  };

  const styleLabels: Record<string, string> = {
    antes_depois: "Antes x Depois",
    problema_solucao: "Problema → Solução",
    prova_social: "Prova Social",
  };

  return (
    <View style={styles.reviewContainer}>
      <View style={styles.iconContainer}>
        <Body style={styles.icon}>✨</Body>
      </View>
      <Title style={styles.reviewTitle}>Perfeito! Revise sua campanha</Title>

      <Card variant="subtle" style={styles.reviewCard}>
        <ReviewItem label="Objetivo" value={data.objective} onEdit={() => onEdit("objective")} />
        <ReviewItem label="Oferta" value={data.offer} onEdit={() => onEdit("offer")} />
        <ReviewItem label="Investimento" value={budgetLabels[data.budget] || data.budget} onEdit={() => onEdit("budget")} />
        <ReviewItem label="Público-alvo" value={data.audience} onEdit={() => onEdit("audience")} />
        <ReviewItem label="Região" value={data.region} onEdit={() => onEdit("region")} />
        <ReviewItem label="WhatsApp destino" value={data.destinationWhatsApp} onEdit={() => onEdit("destinationWhatsApp")} />
        <ReviewItem label="Estilo criativo" value={styleLabels[data.style] || data.style} onEdit={() => onEdit("style")} />
        <ReviewItem label="Mídia" value={media ? `${media.fileName} (${media.kind})` : "Não selecionada"} onEdit={() => onEdit("media")} />
      </Card>

      <Button label={submitting ? "Enviando..." : "Enviar para Real 🚀"} onPress={onSubmit} size="large" disabled={submitting} />
      {submitting ? <ActivityIndicator color={realTheme.colors.green} /> : null}
      <Body style={styles.reviewNote}>A Real vai criar, otimizar e acompanhar sua campanha. Você recebe atualizações em tempo real.</Body>
    </View>
  );
}

function ReviewItem({ label, value, onEdit }: { label: string; value: string; onEdit: () => void }) {
  return (
    <View style={styles.reviewItem}>
      <View style={styles.reviewItemContent}>
        <Body style={styles.reviewItemLabel}>{label}</Body>
        <Body style={styles.reviewItemValue}>{value}</Body>
      </View>
      <Pressable onPress={onEdit} hitSlop={8}>
        <Body style={styles.editButton}>Editar</Body>
      </Pressable>
    </View>
  );
}

function getPlaceholder(key: keyof ConversationData): string {
  const placeholders: Record<keyof ConversationData, string> = {
    objective: "Ex: Gerar leads qualificados",
    offer: "Ex: Consulta gratuita + material bônus",
    budget: "",
    audience: "Ex: Empresários de 30-50 anos interessados em marketing",
    region: "Ex: São Paulo - Capital e região metropolitana",
    destinationWhatsApp: "Ex: +5511999999999",
    style: "",
  };
  return placeholders[key];
}

const ZAI_BASE_URL = process.env.EXPO_PUBLIC_ZAI_BASE_URL?.replace(/\/+$/, "") || "https://api.z.ai/api/paas/v4";
const ZAI_API_KEY = process.env.EXPO_PUBLIC_ZAI_API_KEY;
const ZAI_MODEL = process.env.EXPO_PUBLIC_ZAI_MODEL || "glm-4.5-air";

function makeAdsTraceId(prefix = "ads"): string {
  const rand = Math.random().toString(16).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}

function maskLogValue(value: string): string {
  let sanitized = value;
  sanitized = sanitized.replace(/(bearer\s+)[a-z0-9._-]+/gi, "$1***");
  sanitized = sanitized.replace(/([?&](?:token|key|password|pwd|secret)=)[^&\s]+/gi, "$1***");
  sanitized = sanitized.replace(/\b\d{10,15}\b/g, (m) => `${m.slice(0, 2)}***${m.slice(-2)}`);
  return sanitized;
}

function sanitizeLogMeta(value: unknown, keyHint = ""): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (/(token|authorization|password|cookie|secret|api[_-]?key)/i.test(keyHint)) return "***";
    return maskLogValue(value).slice(0, 500);
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeLogMeta(item, keyHint));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeLogMeta(item, key);
    }
    return out;
  }
  return String(value).slice(0, 200);
}

function buildErrorFingerprint(error: unknown, context = ""): string {
  const message = error instanceof Error ? `${error.name}|${error.message}|${error.stack || ""}` : String(error);
  const raw = `${context}|${message}`.slice(0, 2000);
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  return `ads_${Math.abs(hash)}`;
}

async function sendAdsClientLog(params: {
  baseUrl: string;
  traceId: string;
  stage: string;
  event: string;
  level?: DebugLevel;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const safeBase = params.baseUrl.replace(/\/+$/, "");
  if (!safeBase) return;
  const payload = {
    trace_id: params.traceId,
    stage: params.stage,
    event: params.event,
    level: params.level ?? "info",
    ts_utc: new Date().toISOString(),
    meta: sanitizeLogMeta(params.meta ?? {}, "meta"),
  };
  try {
    await fetch(`${safeBase}/v1/debug/client-events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Logging must never block the wizard.
  }
}

function normalizeBudget(raw: unknown): ConversationData["budget"] | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "ate_500" || value === "500_1500" || value === "1500_5000" || value === "5000_mais") return value;
  if (/5000|5\.000|5k/.test(value)) return "5000_mais";
  if (/1500|1\.500|2\.000|3\.000|4\.000/.test(value)) return "1500_5000";
  if (/500|1000|1\.000/.test(value)) return "500_1500";
  return undefined;
}

function normalizeStyle(raw: unknown): ConversationData["style"] | undefined {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value === "antes_depois" || value === "problema_solucao" || value === "prova_social") return value;
  if (value.includes("antes") || value.includes("depois")) return "antes_depois";
  if (value.includes("problema") || value.includes("solu")) return "problema_solucao";
  if (value.includes("prova") || value.includes("depoimento")) return "prova_social";
  return undefined;
}

function normalizeFreeText(raw: unknown): string | undefined {
  const value = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!value) return undefined;
  return value.slice(0, 220);
}

function extractJson(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return raw.slice(firstBrace, lastBrace + 1);
  }
  return raw.trim();
}

function parsePrefill(raw: string): AdsBusinessBriefPrefill {
  try {
    const parsed = JSON.parse(extractJson(raw)) as Partial<Record<keyof ConversationData, unknown>>;
    return {
      objective: normalizeFreeText(parsed.objective),
      offer: normalizeFreeText(parsed.offer),
      budget: normalizeBudget(parsed.budget),
      audience: normalizeFreeText(parsed.audience),
      region: normalizeFreeText(parsed.region),
      destinationWhatsApp: normalizeFreeText(parsed.destinationWhatsApp),
      style: normalizeStyle(parsed.style),
    };
  } catch {
    return {};
  }
}

function heuristicPrefill(brief: string): AdsBusinessBriefPrefill {
  const oneLine = brief.replace(/\s+/g, " ").trim();
  const matchPhone = oneLine.match(/(\+?\d[\d\s().-]{8,}\d)/);
  return {
    objective: oneLine ? `Gerar mais conversas no WhatsApp para ${oneLine.slice(0, 65)}` : undefined,
    destinationWhatsApp: matchPhone ? matchPhone[1].replace(/\s+/g, "") : undefined,
  };
}

async function analyzeAdsBusinessBrief(input: AdsBusinessBriefInput): Promise<AdsBusinessBriefPrefill> {
  if (!ZAI_API_KEY) return heuristicPrefill(input.brief);
  const response = await fetch(`${ZAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ZAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: ZAI_MODEL,
      temperature: 0.1,
      max_tokens: 380,
      messages: [
        {
          role: "system",
          content:
            "Você recebe uma descrição de negócio para campanha de WhatsApp. Responda SOMENTE JSON com estes campos opcionais: objective, offer, budget, audience, region, destinationWhatsApp, style. Regras: budget deve ser um dos códigos [ate_500,500_1500,1500_5000,5000_mais]; style deve ser um dos códigos [antes_depois,problema_solucao,prova_social]. Se não souber um campo, omita.",
        },
        {
          role: "user",
          content: [
            `Brief do cliente: ${input.brief}`,
            `Dados já preenchidos: ${JSON.stringify(input.currentData)}`,
            `Contexto da empresa: ${JSON.stringify(input.companyContext ?? {})}`,
          ].join("\n"),
        },
      ],
    }),
  });
  if (!response.ok) return heuristicPrefill(input.brief);
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content?.trim() || "";
  if (!content) return heuristicPrefill(input.brief);
  const parsed = parsePrefill(content);
  if (Object.keys(parsed).length === 0) return heuristicPrefill(input.brief);
  return parsed;
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    gap: SPACING.sm,
  },
  progressBar: {
    height: 4,
    backgroundColor: "rgba(53, 226, 20, 0.1)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: realTheme.colors.green,
    borderRadius: 2,
  },
  backButton: {
    alignSelf: "flex-start",
  },
  backText: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
  content: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xl,
    paddingBottom: SPACING.xxl * 2,
  },
  stepContainer: {
    minHeight: 400,
  },
  welcomeContainer: {
    alignItems: "center",
    gap: SPACING.lg,
    paddingVertical: SPACING.xl,
  },
  intakeStage: {
    width: "100%",
    minHeight: 560,
    alignItems: "center",
  },
  introCard: {
    width: "100%",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(9, 13, 20, 0.92)",
    padding: SPACING.lg,
    alignItems: "center",
    gap: SPACING.md,
  },
  introTitle: {
    textAlign: "center",
    fontSize: 22,
  },
  introSubtitle: {
    textAlign: "center",
    color: realTheme.colors.muted,
    lineHeight: 20,
  },
  chatFullscreen: {
    width: "100%",
    minHeight: 540,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(9, 13, 20, 0.92)",
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  chatTitle: {
    fontSize: 22,
  },
  chatSubtitle: {
    color: realTheme.colors.muted,
  },
  chatMessagesScroll: {
    flex: 1,
    width: "100%",
    maxHeight: 380,
    marginTop: 4,
  },
  chatMessagesContent: {
    gap: 8,
    paddingBottom: 8,
  },
  botBubbleWrap: {
    alignItems: "flex-start",
  },
  userBubbleWrap: {
    alignItems: "flex-end",
  },
  botBubble: {
    maxWidth: "85%",
    borderRadius: 16,
    borderTopLeftRadius: 6,
    backgroundColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  userBubble: {
    maxWidth: "85%",
    borderRadius: 16,
    borderTopRightRadius: 6,
    backgroundColor: "rgba(53, 226, 20, 0.2)",
    borderWidth: 1,
    borderColor: "rgba(53, 226, 20, 0.42)",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  chatBubbleText: {
    color: realTheme.colors.text,
    fontSize: 14,
    lineHeight: 19,
  },
  quickOptions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 4,
    marginBottom: 2,
  },
  quickOptionChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(53, 226, 20, 0.45)",
    backgroundColor: "rgba(53, 226, 20, 0.08)",
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  quickOptionText: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 12,
  },
  inputDockAds: {
    borderRadius: 999,
    borderWidth: 2,
    backgroundColor: "rgba(8,13,20,0.96)",
    paddingHorizontal: 8,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  inputInnerAds: {
    flex: 1,
    minHeight: 38,
    borderRadius: 999,
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  dockInputAds: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 16,
    minHeight: 32,
  },
  sendButtonAds: {
    marginLeft: 8,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: realTheme.colors.green,
  },
  buttonDisabledAds: {
    opacity: 0.4,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(53, 226, 20, 0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: SPACING.md,
  },
  icon: {
    fontSize: 34,
    lineHeight: 38,
    textAlign: "center",
    includeFontPadding: false,
  },
  inputContainer: {
    gap: SPACING.xl,
    paddingTop: SPACING.lg,
  },
  question: {
    fontSize: 24,
    lineHeight: 32,
  },
  choiceContainer: {
    gap: SPACING.xl,
    paddingTop: SPACING.lg,
  },
  options: {
    gap: SPACING.md,
  },
  optionCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: SPACING.lg,
    borderRadius: realTheme.radius.md,
    borderWidth: 2,
    borderColor: "rgba(53, 226, 20, 0.2)",
    backgroundColor: "rgba(13, 15, 16, 0.6)",
  },
  optionCardSelected: {
    borderColor: realTheme.colors.green,
    backgroundColor: "rgba(53, 226, 20, 0.05)",
  },
  optionContent: {
    flex: 1,
    gap: SPACING.xs,
  },
  optionLabel: {
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 16,
  },
  optionLabelSelected: {
    color: realTheme.colors.green,
  },
  optionLabelActive: {
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 16,
    color: realTheme.colors.green,
  },
  optionSubtitle: {
    color: realTheme.colors.muted,
    fontSize: 13,
  },
  checkmark: {
    fontSize: 24,
    color: realTheme.colors.green,
  },
  mediaHint: {
    color: realTheme.colors.muted,
  },
  mediaSelected: {
    color: realTheme.colors.text,
  },
  reviewContainer: {
    gap: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  reviewTitle: {
    fontSize: 24,
    textAlign: "center",
  },
  reviewCard: {
    marginTop: SPACING.md,
  },
  reviewItem: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(53, 226, 20, 0.1)",
  },
  reviewItemContent: {
    flex: 1,
    gap: SPACING.xs,
  },
  reviewItemLabel: {
    color: realTheme.colors.muted,
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  reviewItemValue: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 15,
  },
  editButton: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  reviewNote: {
    textAlign: "center",
    color: realTheme.colors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
});
