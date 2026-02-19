import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState, useRef } from "react";
import { ScrollView, StyleSheet, View, Animated, Pressable, Dimensions } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { useQueue } from "../../src/queue/QueueProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Field } from "../../src/ui/components/Field";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";
import { SPACING, ANIMATION_DURATION } from "../../src/utils/constants";

const { width } = Dimensions.get('window');

type Step =
  | { id: 'welcome'; type: 'message' }
  | { id: 'objective'; type: 'input'; question: string; key: 'objective' }
  | { id: 'offer'; type: 'input'; question: string; key: 'offer' }
  | { id: 'budget'; type: 'choice'; question: string; key: 'budget'; options: Array<{ label: string; value: string }> }
  | { id: 'audience'; type: 'input'; question: string; key: 'audience' }
  | { id: 'region'; type: 'input'; question: string; key: 'region' }
  | { id: 'style'; type: 'choice'; question: string; key: 'style'; options: Array<{ label: string; value: string; subtitle: string }> }
  | { id: 'review'; type: 'review' };

const CONVERSATION_STEPS: Step[] = [
  { id: 'welcome', type: 'message' },
  { id: 'objective', type: 'input', question: 'Qual o objetivo da campanha?', key: 'objective' },
  { id: 'offer', type: 'input', question: 'Qual a oferta principal?', key: 'offer' },
  {
    id: 'budget',
    type: 'choice',
    question: 'Quanto você quer investir por mês?',
    key: 'budget',
    options: [
      { label: 'Até R$ 500', value: 'ate_500' },
      { label: 'R$ 500 - R$ 1.500', value: '500_1500' },
      { label: 'R$ 1.500 - R$ 5.000', value: '1500_5000' },
      { label: 'Mais de R$ 5.000', value: '5000_mais' },
    ]
  },
  { id: 'audience', type: 'input', question: 'Quem é seu público-alvo?', key: 'audience' },
  { id: 'region', type: 'input', question: 'Qual região quer alcançar?', key: 'region' },
  {
    id: 'style',
    type: 'choice',
    question: 'Qual estilo de criativo prefere?',
    key: 'style',
    options: [
      { label: 'Antes x Depois', value: 'antes_depois', subtitle: 'Mostra resultados' },
      { label: 'Problema → Solução', value: 'problema_solucao', subtitle: 'Educacional' },
      { label: 'Prova Social', value: 'prova_social', subtitle: 'Depoimentos reais' },
    ]
  },
  { id: 'review', type: 'review' },
];

interface ConversationData {
  objective: string;
  offer: string;
  budget: string;
  audience: string;
  region: string;
  style: string;
}

export default function AdsWizard() {
  const queue = useQueue();
  const auth = useAuth();
  const params = useLocalSearchParams<{ orderId?: string; prompt?: string }>();
  const orderId = typeof params.orderId === "string" ? params.orderId : undefined;
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [data, setData] = useState<ConversationData>({
    objective: prompt || '',
    offer: '',
    budget: '',
    audience: '',
    region: '',
    style: '',
  });
  const [inputValue, setInputValue] = useState('');

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(50)).current;
  const scrollRef = useRef<ScrollView>(null);

  const currentStep = CONVERSATION_STEPS[currentStepIndex];

  useEffect(() => {
    if (prompt) {
      setCurrentStepIndex(1);
    }
  }, [prompt]);

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
  }, [currentStepIndex]);

  const handleNext = (value?: string) => {
    if (!currentStep) return;

    if (currentStep.type === 'input' && currentStep.key) {
      setData(prev => ({ ...prev, [currentStep.key]: value || inputValue }));
      setInputValue('');
    } else if (currentStep.type === 'choice' && currentStep.key && value) {
      setData(prev => ({ ...prev, [currentStep.key]: value }));
    }

    if (currentStepIndex < CONVERSATION_STEPS.length - 1) {
      setCurrentStepIndex(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  const handleSubmit = async () => {
    const title = data.offer ? `Tráfego: ${data.offer.slice(0, 36)}` : 'Tráfego (Meta)';
    const summary = `${data.objective} • ${data.budget} • ${data.region}`;
    const payload = {
      objective: data.objective,
      offer: data.offer,
      budget: data.budget,
      audience: data.audience,
      region: data.region,
      style: data.style,
      preferredCreative: data.style,
    };

    let id = orderId;

    if (!id) {
      const created = await queue.createOrder({ type: "ads", title, summary, payload });
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
                opacity: fadeAnim
              }
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
              transform: [{ translateY: slideAnim }]
            }
          ]}
        >
          {currentStep?.type === 'message' && (
            <WelcomeStep onNext={() => handleNext()} />
          )}

          {currentStep?.type === 'input' && (
            <InputStep
              question={currentStep.question}
              value={inputValue || data[currentStep.key]}
              onChange={setInputValue}
              onNext={handleNext}
              placeholder={getPlaceholder(currentStep.key)}
            />
          )}

          {currentStep?.type === 'choice' && (
            <ChoiceStep
              question={currentStep.question}
              options={currentStep.options}
              selected={data[currentStep.key]}
              onSelect={handleNext}
            />
          )}

          {currentStep?.type === 'review' && (
            <ReviewStep
              data={data}
              onSubmit={handleSubmit}
              onEdit={(stepId) => {
                const index = CONVERSATION_STEPS.findIndex(s => s.id === stepId);
                if (index !== -1) setCurrentStepIndex(index);
              }}
            />
          )}
        </Animated.View>
      </ScrollView>
    </Screen>
  );
}

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <View style={styles.welcomeContainer}>
      <View style={styles.iconContainer}>
        <Body style={styles.icon}>🚀</Body>
      </View>
      <Title style={styles.welcomeTitle}>Vamos criar sua campanha de tráfego</Title>
      <Body style={styles.welcomeText}>
        Em poucos passos, você define o objetivo e a Real cuida de toda a execução, desde a estratégia até a otimização.
      </Body>
      <Button label="Começar" onPress={onNext} size="large" />
    </View>
  );
}

function InputStep({
  question,
  value,
  onChange,
  onNext,
  placeholder
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
        multiline={question.includes('público') || question.includes('região')}
        autoFocus
      />
      <Button
        label="Continuar"
        onPress={() => onNext(value)}
        disabled={!value.trim()}
        size="large"
      />
    </View>
  );
}

function ChoiceStep({
  question,
  options,
  selected,
  onSelect
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
          <Pressable
            key={option.value}
            onPress={() => onSelect(option.value)}
            style={[
              styles.optionCard,
              selected === option.value && styles.optionCardSelected
            ]}
          >
            <View style={styles.optionContent}>
              <Body style={[
                styles.optionLabel,
                selected === option.value && styles.optionLabelSelected
              ]}>
                {option.label}
              </Body>
              {option.subtitle && (
                <Body style={styles.optionSubtitle}>{option.subtitle}</Body>
              )}
            </View>
            {selected === option.value && (
              <Body style={styles.checkmark}>✓</Body>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function ReviewStep({
  data,
  onSubmit,
  onEdit
}: {
  data: ConversationData;
  onSubmit: () => void;
  onEdit: (stepId: string) => void;
}) {
  const budgetLabels: Record<string, string> = {
    'ate_500': 'Até R$ 500',
    '500_1500': 'R$ 500 - R$ 1.500',
    '1500_5000': 'R$ 1.500 - R$ 5.000',
    '5000_mais': 'Mais de R$ 5.000',
  };

  const styleLabels: Record<string, string> = {
    'antes_depois': 'Antes x Depois',
    'problema_solucao': 'Problema → Solução',
    'prova_social': 'Prova Social',
  };

  return (
    <View style={styles.reviewContainer}>
      <View style={styles.iconContainer}>
        <Body style={styles.icon}>✨</Body>
      </View>
      <Title style={styles.reviewTitle}>Perfeito! Revise sua campanha</Title>

      <Card variant="subtle" style={styles.reviewCard}>
        <ReviewItem
          label="Objetivo"
          value={data.objective}
          onEdit={() => onEdit('objective')}
        />
        <ReviewItem
          label="Oferta"
          value={data.offer}
          onEdit={() => onEdit('offer')}
        />
        <ReviewItem
          label="Investimento"
          value={budgetLabels[data.budget] || data.budget}
          onEdit={() => onEdit('budget')}
        />
        <ReviewItem
          label="Público-alvo"
          value={data.audience}
          onEdit={() => onEdit('audience')}
        />
        <ReviewItem
          label="Região"
          value={data.region}
          onEdit={() => onEdit('region')}
        />
        <ReviewItem
          label="Estilo criativo"
          value={styleLabels[data.style] || data.style}
          onEdit={() => onEdit('style')}
        />
      </Card>

      <Button label="Enviar para Real 🚀" onPress={onSubmit} size="large" />
      <Body style={styles.reviewNote}>
        A Real vai criar, otimizar e acompanhar sua campanha. Você recebe atualizações em tempo real.
      </Body>
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
    objective: 'Ex: Gerar leads qualificados',
    offer: 'Ex: Consulta gratuita + material bônus',
    budget: '',
    audience: 'Ex: Empresários de 30-50 anos interessados em marketing',
    region: 'Ex: São Paulo - Capital e região metropolitana',
    style: '',
  };
  return placeholders[key];
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.md,
    gap: SPACING.sm,
  },
  progressBar: {
    height: 4,
    backgroundColor: 'rgba(53, 226, 20, 0.1)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: realTheme.colors.green,
    borderRadius: 2,
  },
  backButton: {
    alignSelf: 'flex-start',
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
    alignItems: 'center',
    gap: SPACING.lg,
    paddingVertical: SPACING.xl,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(53, 226, 20, 0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  icon: {
    fontSize: 40,
  },
  welcomeTitle: {
    textAlign: 'center',
    fontSize: 28,
  },
  welcomeText: {
    textAlign: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.lg,
    borderRadius: realTheme.radius.md,
    borderWidth: 2,
    borderColor: 'rgba(53, 226, 20, 0.2)',
    backgroundColor: 'rgba(13, 15, 16, 0.6)',
  },
  optionCardSelected: {
    borderColor: realTheme.colors.green,
    backgroundColor: 'rgba(53, 226, 20, 0.05)',
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
  optionSubtitle: {
    color: realTheme.colors.muted,
    fontSize: 13,
  },
  checkmark: {
    fontSize: 24,
    color: realTheme.colors.green,
  },
  reviewContainer: {
    gap: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  reviewTitle: {
    fontSize: 24,
    textAlign: 'center',
  },
  reviewCard: {
    marginTop: SPACING.md,
  },
  reviewItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(53, 226, 20, 0.1)',
  },
  reviewItemContent: {
    flex: 1,
    gap: SPACING.xs,
  },
  reviewItemLabel: {
    color: realTheme.colors.muted,
    fontSize: 12,
    textTransform: 'uppercase',
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
    textAlign: 'center',
    color: realTheme.colors.muted,
    fontSize: 13,
    lineHeight: 20,
  },
});
