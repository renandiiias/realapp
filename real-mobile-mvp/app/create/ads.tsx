import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState, useRef } from "react";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { ScrollView, StyleSheet, View, Animated, Pressable, Alert, ActivityIndicator, TextInput, type LayoutChangeEvent } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { useQueue } from "../../src/queue/QueueProvider";
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

async function pickMedia(kind: "image" | "video"): Promise<LocalMedia | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert("Permissão", "Permita acesso à galeria para enviar criativo.");
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: kind === "image" ? "images" : "videos",
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
  const [introBrief, setIntroBrief] = useState("");
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

  const resolveNextStepAfterPrefill = (snapshot: ConversationData): number => {
    const mediaIndex = CONVERSATION_STEPS.findIndex((item) => item.id === "media");
    const firstMissing = CONVERSATION_STEPS.findIndex((item, index) => {
      if (index === 0) return false;
      if (item.type !== "input" && item.type !== "choice") return false;
      const value = snapshot[item.key];
      return !String(value || "").trim();
    });
    if (firstMissing >= 0) return firstMissing;
    return mediaIndex >= 0 ? mediaIndex : 1;
  };

  const handleIntroSubmit = async () => {
    if (!introBrief.trim() || intakeLoading) return;
    setIntakeLoading(true);
    logClientEvent("ads_wizard", "intro_brief_submitted", {
      chars: introBrief.trim().length,
    });

    try {
      const aiPrefill = await analyzeAdsBusinessBrief({
        brief: introBrief.trim(),
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
        objective: aiPrefill.objective || data.objective,
        offer: aiPrefill.offer || data.offer,
        budget: aiPrefill.budget || data.budget,
        audience: aiPrefill.audience || data.audience,
        region: aiPrefill.region || data.region,
        destinationWhatsApp: aiPrefill.destinationWhatsApp || data.destinationWhatsApp,
        style: aiPrefill.style || data.style,
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
      setCurrentStepIndex(resolveNextStepAfterPrefill(mergedDataSnapshot));
      setIntroBrief("");
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
              introBrief={introBrief}
              onChangeIntroBrief={setIntroBrief}
              onSubmitIntro={() => void handleIntroSubmit()}
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
              onPickVideo={() => void pickMedia("video").then((item) => item && setMedia(item))}
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
  introBrief,
  onChangeIntroBrief,
  onSubmitIntro,
  loading,
}: {
  introComposerOpen: boolean;
  onStartIntro: () => void;
  introBrief: string;
  onChangeIntroBrief: (value: string) => void;
  onSubmitIntro: () => void;
  loading: boolean;
}) {
  const [stageWidth, setStageWidth] = useState(0);
  const [composerReady, setComposerReady] = useState(false);
  const composerWidth = useRef(new Animated.Value(176)).current;
  const composerX = useRef(new Animated.Value(0)).current;
  const composerY = useRef(new Animated.Value(0)).current;
  const composerBorder = useRef(new Animated.Value(999)).current;

  useEffect(() => {
    if (!introComposerOpen) {
      setComposerReady(false);
      composerWidth.setValue(176);
      composerX.setValue(0);
      composerY.setValue(0);
      composerBorder.setValue(999);
      return;
    }

    const finalWidth = Math.max(220, stageWidth - SPACING.md * 1.4);
    setComposerReady(false);
    Animated.sequence([
      Animated.parallel([
        Animated.timing(composerWidth, {
          toValue: 54,
          duration: 220,
          useNativeDriver: false,
        }),
        Animated.timing(composerBorder, {
          toValue: 999,
          duration: 220,
          useNativeDriver: false,
        }),
      ]),
      Animated.parallel([
        Animated.timing(composerX, {
          toValue: 118,
          duration: 320,
          useNativeDriver: true,
        }),
        Animated.timing(composerY, {
          toValue: 156,
          duration: 320,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(composerX, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(composerWidth, {
          toValue: finalWidth,
          duration: 300,
          useNativeDriver: false,
        }),
        Animated.timing(composerBorder, {
          toValue: 22,
          duration: 300,
          useNativeDriver: false,
        }),
      ]),
    ]).start(() => {
      setComposerReady(true);
    });
  }, [composerBorder, composerWidth, composerX, composerY, introComposerOpen, stageWidth]);

  const onLayoutStage = (event: LayoutChangeEvent) => {
    setStageWidth(event.nativeEvent.layout.width);
  };

  return (
    <View style={styles.welcomeContainer}>
      <View style={styles.iconContainer}>
        <Body style={styles.icon}>🚀</Body>
      </View>
      <Title style={styles.welcomeTitle}>Vamos criar sua campanha de tráfego</Title>
      <Body style={styles.welcomeText}>
        Em poucos passos, você define o objetivo e a Real cuida de toda a execução, desde a estratégia até a otimização.
      </Body>
      <View style={styles.intakeStage} onLayout={onLayoutStage}>
        {!introComposerOpen ? (
          <Button label="Começar" onPress={onStartIntro} size="large" />
        ) : (
          <>
            <Title style={styles.intakeQuestion}>Me conte mais sobre o seu negócio.</Title>
            <Body style={styles.intakeQuestionHint}>Com isso eu já adianto e pré-preencho sua campanha.</Body>
            <Animated.View
              style={[
                styles.intakeComposer,
                {
                  width: composerWidth,
                  borderRadius: composerBorder,
                  transform: [{ translateX: composerX }, { translateY: composerY }],
                },
              ]}
            >
              {composerReady ? (
                <>
                  <TextInput
                    style={styles.intakeInput}
                    placeholder="Ex.: Clínica estética, foco em harmonização, zona sul de SP..."
                    placeholderTextColor="rgba(166,173,185,0.78)"
                    value={introBrief}
                    onChangeText={onChangeIntroBrief}
                    editable={!loading}
                    multiline
                    maxLength={700}
                  />
                  <Pressable style={[styles.intakeSend, loading && styles.intakeSendDisabled]} onPress={onSubmitIntro} disabled={loading || !introBrief.trim()}>
                    <Body style={styles.intakeSendText}>{loading ? "..." : "↑"}</Body>
                  </Pressable>
                </>
              ) : (
                <Body style={styles.intakeTravelArrow}>↑</Body>
              )}
            </Animated.View>
          </>
        )}
      </View>
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
    minHeight: 260,
    alignItems: "center",
  },
  intakeQuestion: {
    textAlign: "center",
    fontSize: 21,
    marginTop: SPACING.md,
  },
  intakeQuestionHint: {
    textAlign: "center",
    color: realTheme.colors.muted,
    marginTop: SPACING.sm,
    paddingHorizontal: SPACING.sm,
  },
  intakeComposer: {
    position: "absolute",
    minHeight: 56,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.sm,
    backgroundColor: "rgba(10, 14, 18, 0.96)",
    borderWidth: 1,
    borderColor: "rgba(53, 226, 20, 0.35)",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: SPACING.sm,
    shadowColor: realTheme.colors.green,
    shadowOpacity: 0.22,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 9,
  },
  intakeTravelArrow: {
    color: realTheme.colors.text,
    fontSize: 20,
    width: "100%",
    textAlign: "center",
    paddingVertical: 8,
  },
  intakeInput: {
    flex: 1,
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
    minHeight: 40,
    maxHeight: 104,
    paddingVertical: 4,
    textAlignVertical: "top",
  },
  intakeSend: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: realTheme.colors.green,
  },
  intakeSendDisabled: {
    opacity: 0.4,
  },
  intakeSendText: {
    color: "#061101",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 16,
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
    fontSize: 40,
  },
  welcomeTitle: {
    textAlign: "center",
    fontSize: 28,
  },
  welcomeText: {
    textAlign: "center",
    color: realTheme.colors.muted,
    lineHeight: 24,
    paddingHorizontal: SPACING.md,
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
