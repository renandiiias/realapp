import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ImageBackground,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { useQueue } from "../../src/queue/QueueProvider";
import { autobuildSite } from "../../src/services/siteBuilderApi";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Title } from "../../src/ui/components/Typography";

type BuilderStage = 0 | 1 | 2 | 3 | 4;

type TemplateDef = {
  id: string;
  name: string;
  hint: string;
  hero: string;
};

type PaletteDef = {
  id: string;
  name: string;
  appBg: string;
  previewBg: string;
  sectionBg: string;
  sectionText: string;
  mutedText: string;
  accent: string;
  accentText: string;
};

type BuilderBlock = {
  id: string;
  label: string;
  title: string;
  body: string;
  buttonText?: string;
  enabled: boolean;
  origin: "default" | "custom";
};

type BuilderPayload = {
  businessName: string;
  segment: string;
  city: string;
  audience: string;
  offerSummary: string;
  mainDifferential: string;
  templateId: string;
  paletteId: string;
  headline: string;
  subheadline: string;
  ctaLabel: string;
  whatsappNumber: string;
  heroImageUrl: string;
  blocks: BuilderBlock[];
};

type CopySuggestion = {
  headline: string;
  subheadline: string;
  ctaLabel: string;
  offerLine: string;
  proofLine: string;
};

const DRAG_ROW_HEIGHT = 72;

const stages: Array<{ id: BuilderStage; title: string; subtitle: string }> = [
  { id: 0, title: "Contexto", subtitle: "Dados do negocio para montar a pagina." },
  { id: 1, title: "Visual", subtitle: "Escolha template e paleta." },
  { id: 2, title: "Copy", subtitle: "Texto pre-preenchido para ajuste rapido." },
  { id: 3, title: "Estrutura", subtitle: "Clique e arraste para reordenar blocos." },
  { id: 4, title: "Preview", subtitle: "Toque no bloco para editar seu conteudo." },
];

const templates: TemplateDef[] = [
  {
    id: "artisan",
    name: "Artesanal Premium",
    hint: "Quente e premium, focado em produto.",
    hero: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "clean",
    name: "Clean Conversao",
    hint: "Layout limpo e objetivo para leads.",
    hero: "https://images.unsplash.com/photo-1556740749-887f6717d7e4?auto=format&fit=crop&w=1200&q=80",
  },
  {
    id: "bold",
    name: "Bold Impact",
    hint: "Contraste e chamadas fortes.",
    hero: "https://images.unsplash.com/photo-1496449903678-68ddcb189a24?auto=format&fit=crop&w=1200&q=80",
  },
];

const palettes: PaletteDef[] = [
  {
    id: "forest",
    name: "Forest",
    appBg: "#0B1110",
    previewBg: "#121A18",
    sectionBg: "#E7E0D3",
    sectionText: "#1C1A18",
    mutedText: "#5B544A",
    accent: "#2E5D3E",
    accentText: "#ECF8F0",
  },
  {
    id: "midnight",
    name: "Midnight",
    appBg: "#0A111C",
    previewBg: "#131E2E",
    sectionBg: "#1E2D43",
    sectionText: "#EAF1FC",
    mutedText: "#A9BCD9",
    accent: "#8ED1FC",
    accentText: "#0A1E34",
  },
  {
    id: "sunset",
    name: "Sunset",
    appBg: "#1A100D",
    previewBg: "#2A1A15",
    sectionBg: "#FFEAE1",
    sectionText: "#2B1812",
    mutedText: "#8C5E4E",
    accent: "#D0613A",
    accentText: "#FFF4EE",
  },
];

function sanitizeWhats(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

function moveItemById(list: BuilderBlock[], id: string, targetIndex: number): BuilderBlock[] {
  const currentIndex = list.findIndex((item) => item.id === id);
  if (currentIndex < 0) return list;
  const safeTarget = Math.max(0, Math.min(targetIndex, list.length - 1));
  if (safeTarget === currentIndex) return list;

  const next = [...list];
  const [picked] = next.splice(currentIndex, 1);
  if (!picked) return list;
  next.splice(safeTarget, 0, picked);
  return next;
}

function buildSuggestion(input: {
  businessName: string;
  segment: string;
  city: string;
  audience: string;
  offerSummary: string;
  mainDifferential: string;
  goal?: string;
}): CopySuggestion {
  const business = input.businessName || "Sua empresa";
  const segment = input.segment || "seu negocio";
  const city = input.city ? ` em ${input.city}` : "";
  const audience = input.audience || "publico ideal";
  const offer = input.offerSummary || "uma oferta clara";
  const diff = input.mainDifferential || "agilidade no atendimento";
  const goal = input.goal === "visibilidade" ? "mais visibilidade" : "mais pedidos";

  return {
    headline: `${business}: ${goal}${city}`,
    subheadline: `Pagina de ${segment}, pensada para ${audience}, com foco em conversao no WhatsApp.`,
    ctaLabel: "Falar no WhatsApp",
    offerLine: `${offer}. Diferencial: ${diff}.`,
    proofLine: `Clientes destacam ${diff} e resultado rapido no primeiro contato.`,
  };
}

function buildDefaultBlocks(suggestion: CopySuggestion): BuilderBlock[] {
  return [
    {
      id: "hero",
      label: "Hero",
      title: suggestion.headline,
      body: suggestion.subheadline,
      buttonText: suggestion.ctaLabel,
      enabled: true,
      origin: "default",
    },
    {
      id: "benefits",
      label: "Beneficios",
      title: "Por que escolher",
      body: "Atendimento rapido; Processo simples; Resultado previsivel",
      enabled: true,
      origin: "default",
    },
    {
      id: "proof",
      label: "Prova",
      title: "Resultados e confianca",
      body: suggestion.proofLine,
      enabled: true,
      origin: "default",
    },
    {
      id: "offer",
      label: "Oferta",
      title: "Oferta principal",
      body: suggestion.offerLine,
      enabled: true,
      origin: "default",
    },
    {
      id: "faq",
      label: "FAQ",
      title: "Perguntas frequentes",
      body: "Qual prazo?; Como funciona pagamento?; Como comeco?",
      enabled: true,
      origin: "default",
    },
    {
      id: "cta",
      label: "CTA final",
      title: "Vamos conversar agora",
      body: "Clique no botao e fale com nosso time no WhatsApp.",
      buttonText: suggestion.ctaLabel,
      enabled: true,
      origin: "default",
    },
  ];
}

export default function SiteWebsiteBuilder() {
  const queue = useQueue();
  const auth = useAuth();
  const params = useLocalSearchParams<{ orderId?: string; prompt?: string }>();
  const orderId = typeof params.orderId === "string" ? params.orderId : undefined;
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  const editing = orderId ? queue.getOrder(orderId) : null;

  const [stage, setStage] = useState<BuilderStage>(0);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [segment, setSegment] = useState("");
  const [city, setCity] = useState("");
  const [audience, setAudience] = useState("");
  const [offerSummary, setOfferSummary] = useState("");
  const [mainDifferential, setMainDifferential] = useState("");

  const [templateId, setTemplateId] = useState<string>(templates[0]!.id);
  const [paletteId, setPaletteId] = useState<string>(palettes[0]!.id);

  const [headline, setHeadline] = useState("");
  const [subheadline, setSubheadline] = useState("");
  const [ctaLabel, setCtaLabel] = useState("");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");

  const [blocks, setBlocks] = useState<BuilderBlock[]>([]);
  const [customBlockName, setCustomBlockName] = useState("");
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);

  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicPrompt, setMagicPrompt] = useState(prompt);
  const [autoBuilding, setAutoBuilding] = useState(false);
  const [magicFeedback, setMagicFeedback] = useState<string | null>(null);

  const [copyTouched, setCopyTouched] = useState({ headline: false, subheadline: false, cta: false });
  const dragMetaRef = useRef<{ id: string; startIndex: number; currentIndex: number } | null>(null);
  const autoPromptBootstrappedRef = useRef(false);

  const suggestion = useMemo(
    () =>
      buildSuggestion({
        businessName: businessName.trim(),
        segment: segment.trim(),
        city: city.trim(),
        audience: audience.trim(),
        offerSummary: offerSummary.trim(),
        mainDifferential: mainDifferential.trim(),
        goal: auth.rayX?.mainGoal,
      }),
    [businessName, segment, city, audience, offerSummary, mainDifferential, auth.rayX?.mainGoal],
  );

  useEffect(() => {
    if (!auth.ready) return;
    if (businessName || segment || city || audience || offerSummary || mainDifferential || whatsappNumber) return;

    setBusinessName(auth.companyProfile?.companyName ?? "");
    setSegment(auth.rayX?.marketSegment ?? "");
    setCity(auth.companyProfile?.city ?? "");
    setAudience(auth.companyProfile?.targetAudience ?? "");
    setOfferSummary(auth.companyProfile?.offerSummary ?? prompt);
    setMainDifferential(auth.companyProfile?.mainDifferential ?? "");
    setWhatsappNumber(auth.companyProfile?.whatsappBusiness ?? "");
  }, [
    auth.ready,
    auth.companyProfile,
    auth.rayX,
    prompt,
    businessName,
    segment,
    city,
    audience,
    offerSummary,
    mainDifferential,
    whatsappNumber,
  ]);

  useEffect(() => {
    if (!prompt || magicPrompt.trim()) return;
    setMagicPrompt(prompt);
  }, [prompt, magicPrompt]);

  useEffect(() => {
    if (!copyTouched.headline) setHeadline(suggestion.headline);
    if (!copyTouched.subheadline) setSubheadline(suggestion.subheadline);
    if (!copyTouched.cta) setCtaLabel(suggestion.ctaLabel);
  }, [suggestion, copyTouched]);

  useEffect(() => {
    if (blocks.length > 0) return;
    setBlocks(buildDefaultBlocks(suggestion));
  }, [blocks.length, suggestion]);

  useEffect(() => {
    if (!editing) return;
    const payload = editing.payload as Record<string, unknown>;
    const builderRaw = payload.builder;
    if (!builderRaw || typeof builderRaw !== "object" || Array.isArray(builderRaw)) return;

    const builder = builderRaw as Partial<BuilderPayload>;
    if (typeof builder.businessName === "string") setBusinessName(builder.businessName);
    if (typeof builder.segment === "string") setSegment(builder.segment);
    if (typeof builder.city === "string") setCity(builder.city);
    if (typeof builder.audience === "string") setAudience(builder.audience);
    if (typeof builder.offerSummary === "string") setOfferSummary(builder.offerSummary);
    if (typeof builder.mainDifferential === "string") setMainDifferential(builder.mainDifferential);
    if (typeof builder.templateId === "string" && templates.some((item) => item.id === builder.templateId)) setTemplateId(builder.templateId);
    if (typeof builder.paletteId === "string" && palettes.some((item) => item.id === builder.paletteId)) setPaletteId(builder.paletteId);
    if (typeof builder.headline === "string") setHeadline(builder.headline);
    if (typeof builder.subheadline === "string") setSubheadline(builder.subheadline);
    if (typeof builder.ctaLabel === "string") setCtaLabel(builder.ctaLabel);
    if (typeof builder.whatsappNumber === "string") setWhatsappNumber(builder.whatsappNumber);
    if (typeof builder.heroImageUrl === "string") setHeroImageUrl(builder.heroImageUrl);

    if (Array.isArray(builder.blocks)) {
      const parsed = builder.blocks
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const raw = item as Partial<BuilderBlock>;
          if (typeof raw.id !== "string" || typeof raw.label !== "string") return null;
          return {
            id: raw.id,
            label: raw.label,
            title: typeof raw.title === "string" ? raw.title : raw.label,
            body: typeof raw.body === "string" ? raw.body : "",
            buttonText: typeof raw.buttonText === "string" ? raw.buttonText : undefined,
            enabled: Boolean(raw.enabled),
            origin: raw.origin === "custom" ? "custom" : "default",
          } as BuilderBlock;
        })
        .filter((item): item is BuilderBlock => Boolean(item));
      if (parsed.length > 0) setBlocks(parsed);
    }
  }, [editing]);

  const selectedTemplate = useMemo(() => templates.find((item) => item.id === templateId) ?? templates[0]!, [templateId]);
  const selectedPalette = useMemo(() => palettes.find((item) => item.id === paletteId) ?? palettes[0]!, [paletteId]);
  const progress = useMemo(() => ((stage + 1) / stages.length) * 100, [stage]);

  const enabledBlocks = useMemo(() => blocks.filter((item) => item.enabled), [blocks]);
  const selectedBlock = useMemo(() => blocks.find((item) => item.id === selectedBlockId) ?? null, [blocks, selectedBlockId]);

  useEffect(() => {
    if (!selectedBlockId && enabledBlocks[0]) {
      setSelectedBlockId(enabledBlocks[0].id);
      return;
    }
    if (selectedBlockId && !blocks.some((item) => item.id === selectedBlockId && item.enabled)) {
      setSelectedBlockId(enabledBlocks[0]?.id ?? null);
    }
  }, [selectedBlockId, enabledBlocks, blocks]);

  const canAdvance = useMemo(() => {
    if (stage === 0) return businessName.trim().length > 1 && segment.trim().length > 1;
    if (stage === 1) return Boolean(templateId) && Boolean(paletteId);
    if (stage === 2) return headline.trim().length > 4 && ctaLabel.trim().length > 2;
    if (stage === 3) return enabledBlocks.length > 0;
    return true;
  }, [stage, businessName, segment, templateId, paletteId, headline, ctaLabel, enabledBlocks.length]);

  const updateBlock = (id: string, patch: Partial<BuilderBlock>) => {
    setBlocks((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const applyBuilder = (next: BuilderPayload) => {
    setBusinessName(next.businessName ?? "");
    setSegment(next.segment ?? "");
    setCity(next.city ?? "");
    setAudience(next.audience ?? "");
    setOfferSummary(next.offerSummary ?? "");
    setMainDifferential(next.mainDifferential ?? "");
    if (templates.some((item) => item.id === next.templateId)) setTemplateId(next.templateId);
    if (palettes.some((item) => item.id === next.paletteId)) setPaletteId(next.paletteId);
    setHeadline(next.headline ?? "");
    setSubheadline(next.subheadline ?? "");
    setCtaLabel(next.ctaLabel ?? "");
    setWhatsappNumber(next.whatsappNumber ?? "");
    setHeroImageUrl(next.heroImageUrl ?? "");
    if (Array.isArray(next.blocks) && next.blocks.length > 0) {
      setBlocks(
        next.blocks.map((item) => ({
          id: item.id,
          label: item.label,
          title: item.title,
          body: item.body,
          buttonText: item.buttonText,
          enabled: item.enabled,
          origin: item.origin === "custom" ? "custom" : "default",
        })),
      );
    }
    setCopyTouched({ headline: true, subheadline: true, cta: true });
  };

  const syncCoreBlocksFromCopy = () => {
    setBlocks((prev) =>
      prev.map((item) => {
        if (item.id === "hero") {
          return { ...item, title: headline.trim() || item.title, body: subheadline.trim() || item.body, buttonText: ctaLabel.trim() || item.buttonText };
        }
        if (item.id === "cta") {
          return { ...item, buttonText: ctaLabel.trim() || item.buttonText };
        }
        if (item.id === "offer") {
          return { ...item, body: suggestion.offerLine };
        }
        if (item.id === "proof") {
          return { ...item, body: suggestion.proofLine };
        }
        return item;
      }),
    );
  };

  const regenerateCopy = () => {
    setHeadline(suggestion.headline);
    setSubheadline(suggestion.subheadline);
    setCtaLabel(suggestion.ctaLabel);
    setCopyTouched({ headline: false, subheadline: false, cta: false });
    syncCoreBlocksFromCopy();
  };

  const toggleBlock = (id: string) => {
    setBlocks((prev) => {
      const enabledCount = prev.filter((item) => item.enabled).length;
      return prev.map((item) => {
        if (item.id !== id) return item;
        if (item.enabled && enabledCount <= 1) return item;
        return { ...item, enabled: !item.enabled };
      });
    });
  };

  const addCustomBlock = () => {
    const label = customBlockName.trim();
    if (!label) return;
    const id = `custom_${Date.now()}`;
    setBlocks((prev) => [
      ...prev,
      {
        id,
        label,
        title: label,
        body: "Descreva este bloco aqui.",
        enabled: true,
        origin: "custom",
      },
    ]);
    setCustomBlockName("");
    setSelectedBlockId(id);
  };

  const removeCustomBlock = (id: string) => {
    setBlocks((prev) => {
      const target = prev.find((item) => item.id === id);
      if (!target || target.origin !== "custom") return prev;
      const next = prev.filter((item) => item.id !== id);
      if (next.some((item) => item.enabled)) return next;
      return next.map((item, idx) => (idx === 0 ? { ...item, enabled: true } : item));
    });
  };

  const createDragResponder = (blockId: string) =>
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderGrant: () => {
        const startIndex = blocks.findIndex((item) => item.id === blockId);
        if (startIndex < 0) return;
        dragMetaRef.current = { id: blockId, startIndex, currentIndex: startIndex };
        setDraggingId(blockId);
        setScrollEnabled(false);
      },
      onPanResponderMove: (_, gesture) => {
        const dragMeta = dragMetaRef.current;
        if (!dragMeta) return;
        const step = Math.trunc(gesture.dy / DRAG_ROW_HEIGHT);
        const target = Math.max(0, Math.min(dragMeta.startIndex + step, blocks.length - 1));
        if (target === dragMeta.currentIndex) return;

        setBlocks((prev) => moveItemById(prev, dragMeta.id, target));
        dragMeta.currentIndex = target;
      },
      onPanResponderRelease: () => {
        dragMetaRef.current = null;
        setDraggingId(null);
        setScrollEnabled(true);
      },
      onPanResponderTerminate: () => {
        dragMetaRef.current = null;
        setDraggingId(null);
        setScrollEnabled(true);
      },
    });

  const buildPayload = (): BuilderPayload => ({
    businessName: businessName.trim(),
    segment: segment.trim(),
    city: city.trim(),
    audience: audience.trim(),
    offerSummary: offerSummary.trim(),
    mainDifferential: mainDifferential.trim(),
    templateId,
    paletteId,
    headline: headline.trim(),
    subheadline: subheadline.trim(),
    ctaLabel: ctaLabel.trim(),
    whatsappNumber: sanitizeWhats(whatsappNumber),
    heroImageUrl: heroImageUrl.trim(),
    blocks,
  });

  const buildOrderData = () => {
    const payload = buildPayload();
    const enabledLabels = payload.blocks.filter((item) => item.enabled).map((item) => item.label);

    return {
      title: `Site: ${payload.businessName || payload.segment || "Novo"}`,
      summary: `${payload.segment || "Negocio"}${payload.city ? ` em ${payload.city}` : ""} · ${selectedTemplate.name}`,
      payload: {
        builder: payload,
        builderPrompt: magicPrompt.trim(),
        headline: payload.headline,
        cta: payload.ctaLabel,
        sections: enabledLabels,
        objective: `${payload.segment || "Negocio"}${payload.city ? ` em ${payload.city}` : ""}`,
      },
    };
  };

  const runAutobuilder = async () => {
    if (!magicPrompt.trim()) {
      setMagicFeedback("Descreva o que você quer antes de gerar.");
      return;
    }
    setMagicFeedback(null);
    setError(null);
    setAutoBuilding(true);
    try {
      const response = await autobuildSite({
        prompt: magicPrompt.trim(),
        context: {
          businessName: businessName.trim(),
          segment: segment.trim(),
          city: city.trim(),
          audience: audience.trim(),
          offerSummary: offerSummary.trim(),
          mainDifferential: mainDifferential.trim(),
          whatsappNumber: whatsappNumber.trim(),
        },
        currentBuilder: buildPayload(),
        forceRegenerate: true,
      });

      const spec = response.builderSpec as BuilderPayload;
      applyBuilder(spec);
      setStage(4);
      setMagicFeedback("Estrutura gerada automaticamente. Revise e publique.");
    } catch (autoError) {
      const message = autoError instanceof Error ? autoError.message : "Falha ao gerar automaticamente.";
      setMagicFeedback(message);
    } finally {
      setAutoBuilding(false);
    }
  };

  useEffect(() => {
    if (autoPromptBootstrappedRef.current) return;
    if (!prompt.trim()) return;
    if (!magicPrompt.trim()) return;
    if (autoBuilding) return;
    autoPromptBootstrappedRef.current = true;
    void runAutobuilder();
  }, [autoBuilding, magicPrompt, prompt]);

  const saveDraft = async () => {
    setError(null);
    setSavingDraft(true);
    try {
      const data = buildOrderData();
      if (orderId) {
        await queue.updateOrder(orderId, data);
      } else {
        await queue.createOrder({ type: "site", ...data });
      }
      router.navigate("/orders");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Falha ao salvar rascunho.";
      setError(message);
    } finally {
      setSavingDraft(false);
    }
  };

  const publish = async () => {
    setError(null);
    setPublishing(true);
    try {
      const data = buildOrderData();
      let targetId = orderId;
      if (!targetId) {
        const created = await queue.createOrder({ type: "site", ...data });
        targetId = created.id;
      } else {
        await queue.updateOrder(targetId, data);
      }

      if (!auth.profileProductionComplete) {
        router.push({ pathname: "/onboarding/ray-x", params: { mode: "production", pendingOrderId: targetId } });
        return;
      }

      await queue.submitOrder(targetId);
      router.navigate("/orders");
    } catch (publishError) {
      const message = publishError instanceof Error ? publishError.message : "Falha ao publicar.";
      setError(message);
    } finally {
      setPublishing(false);
    }
  };

  const heroSource = heroImageUrl.trim() || selectedTemplate.hero;

  const renderStage = () => {
    if (stage === 0) {
      return (
        <View style={styles.card}>
          <Title>{stages[0].title}</Title>
          <Body style={styles.helper}>{stages[0].subtitle}</Body>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Nome da empresa</Text>
            <TextInput
              value={businessName}
              onChangeText={setBusinessName}
              style={styles.input}
              placeholder="Ex.: Delicia Bakery"
              placeholderTextColor="rgba(237,237,238,0.45)"
            />
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Segmento</Text>
            <TextInput
              value={segment}
              onChangeText={setSegment}
              style={styles.input}
              placeholder="Ex.: Padaria artesanal"
              placeholderTextColor="rgba(237,237,238,0.45)"
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.fieldWrap, styles.half]}>
              <Text style={styles.label}>Cidade</Text>
              <TextInput value={city} onChangeText={setCity} style={styles.input} placeholder="Cidade" placeholderTextColor="rgba(237,237,238,0.45)" />
            </View>
            <View style={[styles.fieldWrap, styles.half]}>
              <Text style={styles.label}>Publico</Text>
              <TextInput value={audience} onChangeText={setAudience} style={styles.input} placeholder="Publico-alvo" placeholderTextColor="rgba(237,237,238,0.45)" />
            </View>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Oferta</Text>
            <TextInput value={offerSummary} onChangeText={setOfferSummary} style={styles.input} placeholder="Resumo da oferta" placeholderTextColor="rgba(237,237,238,0.45)" />
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Diferencial</Text>
            <TextInput value={mainDifferential} onChangeText={setMainDifferential} style={styles.input} placeholder="Principal diferencial" placeholderTextColor="rgba(237,237,238,0.45)" />
          </View>
        </View>
      );
    }

    if (stage === 1) {
      return (
        <View style={styles.card}>
          <Title>{stages[1].title}</Title>
          <Body style={styles.helper}>{stages[1].subtitle}</Body>

          <Text style={styles.groupLabel}>Template</Text>
          <View style={styles.templatesList}>
            {templates.map((template) => {
              const active = template.id === templateId;
              return (
                <Pressable key={template.id} onPress={() => setTemplateId(template.id)} style={[styles.templateCard, active ? styles.activeBorder : null]}>
                  <ImageBackground source={{ uri: template.hero }} style={styles.templateHero} imageStyle={styles.templateHeroImage}>
                    <LinearGradient
                      colors={["rgba(10,12,14,0.1)", "rgba(10,12,14,0.74)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={styles.templateOverlay}
                    >
                      <Text style={styles.templateName}>{template.name}</Text>
                    </LinearGradient>
                  </ImageBackground>
                  <Text style={styles.templateHint}>{template.hint}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.groupLabel}>Paleta</Text>
          <View style={styles.paletteRow}>
            {palettes.map((palette) => {
              const active = palette.id === paletteId;
              return (
                <Pressable key={palette.id} onPress={() => setPaletteId(palette.id)} style={[styles.paletteCard, active ? styles.activeBorder : null]}>
                  <View style={styles.paletteSwatchRow}>
                    <View style={[styles.swatch, { backgroundColor: palette.sectionBg }]} />
                    <View style={[styles.swatch, { backgroundColor: palette.sectionText }]} />
                    <View style={[styles.swatch, { backgroundColor: palette.accent }]} />
                  </View>
                  <Text style={styles.paletteName}>{palette.name}</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Imagem principal (URL opcional)</Text>
            <TextInput value={heroImageUrl} onChangeText={setHeroImageUrl} style={styles.input} placeholder="https://..." placeholderTextColor="rgba(237,237,238,0.45)" autoCapitalize="none" />
          </View>
        </View>
      );
    }

    if (stage === 2) {
      return (
        <View style={styles.card}>
          <Title>{stages[2].title}</Title>
          <Body style={styles.helper}>{stages[2].subtitle}</Body>

          <Pressable onPress={regenerateCopy} style={styles.aiButton}>
            <Ionicons name="sparkles" size={14} color="#091306" />
            <Text style={styles.aiButtonText}>Gerar copy novamente</Text>
          </Pressable>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Headline</Text>
            <TextInput
              value={headline}
              onChangeText={(value) => {
                setCopyTouched((prev) => ({ ...prev, headline: true }));
                setHeadline(value);
                updateBlock("hero", { title: value });
              }}
              style={styles.input}
              placeholder="Mensagem principal"
              placeholderTextColor="rgba(237,237,238,0.45)"
            />
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Subheadline</Text>
            <TextInput
              value={subheadline}
              onChangeText={(value) => {
                setCopyTouched((prev) => ({ ...prev, subheadline: true }));
                setSubheadline(value);
                updateBlock("hero", { body: value });
              }}
              style={[styles.input, styles.inputMulti]}
              multiline
              textAlignVertical="top"
              placeholder="Texto de apoio"
              placeholderTextColor="rgba(237,237,238,0.45)"
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.fieldWrap, styles.half]}>
              <Text style={styles.label}>CTA</Text>
              <TextInput
                value={ctaLabel}
                onChangeText={(value) => {
                  setCopyTouched((prev) => ({ ...prev, cta: true }));
                  setCtaLabel(value);
                  updateBlock("hero", { buttonText: value });
                  updateBlock("cta", { buttonText: value });
                }}
                style={styles.input}
                placeholder="Texto do botao"
                placeholderTextColor="rgba(237,237,238,0.45)"
              />
            </View>

            <View style={[styles.fieldWrap, styles.half]}>
              <Text style={styles.label}>WhatsApp</Text>
              <TextInput
                value={whatsappNumber}
                onChangeText={setWhatsappNumber}
                style={styles.input}
                keyboardType="phone-pad"
                placeholder="55119999..."
                placeholderTextColor="rgba(237,237,238,0.45)"
              />
            </View>
          </View>
        </View>
      );
    }

    if (stage === 3) {
      return (
        <View style={styles.card}>
          <Title>{stages[3].title}</Title>
          <Body style={styles.helper}>{stages[3].subtitle}</Body>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Adicionar bloco customizado</Text>
            <View style={styles.row}>
              <TextInput
                value={customBlockName}
                onChangeText={setCustomBlockName}
                style={[styles.input, styles.flexInput]}
                placeholder="Ex.: Como funciona"
                placeholderTextColor="rgba(237,237,238,0.45)"
              />
              <Button label="Adicionar" onPress={addCustomBlock} variant="secondary" />
            </View>
          </View>

          <View style={styles.blocksList}>
            {blocks.map((block) => {
              const dragging = draggingId === block.id;
              const dragResponder = createDragResponder(block.id);

              return (
                <View key={block.id} style={[styles.blockRow, !block.enabled ? styles.blockRowDisabled : null, dragging ? styles.draggingRow : null]}>
                  <Pressable onPress={() => toggleBlock(block.id)} style={[styles.blockToggle, block.enabled ? styles.blockToggleOn : null]}>
                    {block.enabled ? <Ionicons name="checkmark" size={14} color="#081306" /> : null}
                  </Pressable>

                  <View style={styles.blockTextWrap}>
                    <Text style={styles.blockLabel}>{block.label}</Text>
                    <Text style={styles.blockMeta}>{block.origin === "custom" ? "custom" : "padrao"}</Text>
                  </View>

                  <View {...dragResponder.panHandlers} style={styles.dragHandle}>
                    <Ionicons name="reorder-three" size={18} color={realTheme.colors.text} />
                  </View>

                  {block.origin === "custom" ? (
                    <Pressable onPress={() => removeCustomBlock(block.id)} style={styles.deleteBtn}>
                      <Ionicons name="trash-outline" size={14} color="#FF8D8D" />
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      );
    }

    return (
      <View style={styles.previewWrap}>
        <Title>{stages[4].title}</Title>
        <Body style={styles.helper}>{stages[4].subtitle}</Body>

        <View style={[styles.phoneShell, { backgroundColor: selectedPalette.previewBg }]}> 
          <View style={styles.phoneInner}>
            {enabledBlocks.map((block) => {
              if (block.id === "hero") {
                return (
                  <Pressable key={block.id} onPress={() => setSelectedBlockId(block.id)} style={[styles.siteSection, selectedBlockId === block.id ? styles.selectedSection : null]}>
                    <ImageBackground source={{ uri: heroSource }} style={styles.previewHero} imageStyle={styles.previewHeroImage}>
                      <LinearGradient colors={["rgba(11,12,14,0.72)", "rgba(11,12,14,0.2)", "rgba(11,12,14,0.84)"]} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.previewHeroOverlay}>
                        <Text style={styles.previewBrand}>{businessName || "Sua Marca"}</Text>
                        <Text style={styles.previewCaption}>{segment || "Seu segmento"}</Text>
                        <Text style={styles.previewHeroTitle}>{block.title}</Text>
                        <Text style={styles.previewHeroBody}>{block.body}</Text>
                        <View style={[styles.previewHeroButton, { backgroundColor: selectedPalette.accent }]}> 
                          <Text style={[styles.previewHeroButtonText, { color: selectedPalette.accentText }]}>{block.buttonText || ctaLabel || "Falar no WhatsApp"}</Text>
                        </View>
                      </LinearGradient>
                    </ImageBackground>
                  </Pressable>
                );
              }

              if (block.id === "benefits") {
                const items = block.body.split(";").map((value) => value.trim()).filter(Boolean).slice(0, 3);
                return (
                  <Pressable key={block.id} onPress={() => setSelectedBlockId(block.id)} style={[styles.siteSection, styles.cardSection, selectedBlockId === block.id ? styles.selectedSection : null, { backgroundColor: selectedPalette.sectionBg }]}>
                    <Text style={[styles.sectionTitleLarge, { color: selectedPalette.sectionText }]}>{block.title}</Text>
                    <View style={styles.metricRow}>
                      {items.map((item, index) => (
                        <View key={`${block.id}_${index}`} style={styles.metricCard}>
                          <Text style={styles.metricIcon}>+</Text>
                          <Text style={[styles.metricText, { color: selectedPalette.mutedText }]}>{item}</Text>
                        </View>
                      ))}
                    </View>
                  </Pressable>
                );
              }

              if (block.id === "proof") {
                return (
                  <Pressable key={block.id} onPress={() => setSelectedBlockId(block.id)} style={[styles.siteSection, styles.cardSection, selectedBlockId === block.id ? styles.selectedSection : null, { backgroundColor: selectedPalette.sectionBg }]}>
                    <Text style={[styles.sectionTitleLarge, { color: selectedPalette.sectionText }]}>{block.title}</Text>
                    <Text style={[styles.sectionBody, { color: selectedPalette.mutedText }]}>{block.body}</Text>
                    <View style={styles.proofPills}>
                      <View style={styles.proofPill}><Text style={styles.proofPillText}>+120 clientes</Text></View>
                      <View style={styles.proofPill}><Text style={styles.proofPillText}>4.9 avaliacao</Text></View>
                    </View>
                  </Pressable>
                );
              }

              if (block.id === "faq") {
                const lines = block.body.split(";").map((value) => value.trim()).filter(Boolean);
                return (
                  <Pressable key={block.id} onPress={() => setSelectedBlockId(block.id)} style={[styles.siteSection, styles.cardSection, selectedBlockId === block.id ? styles.selectedSection : null, { backgroundColor: selectedPalette.sectionBg }]}>
                    <Text style={[styles.sectionTitleLarge, { color: selectedPalette.sectionText }]}>{block.title}</Text>
                    {lines.map((line, index) => (
                      <View key={`${block.id}_${index}`} style={styles.faqRow}>
                        <Text style={[styles.faqQuestion, { color: selectedPalette.sectionText }]}>{line}</Text>
                        <Ionicons name="chevron-forward" size={14} color={selectedPalette.mutedText} />
                      </View>
                    ))}
                  </Pressable>
                );
              }

              return (
                <Pressable key={block.id} onPress={() => setSelectedBlockId(block.id)} style={[styles.siteSection, styles.cardSection, selectedBlockId === block.id ? styles.selectedSection : null, { backgroundColor: selectedPalette.sectionBg }]}>
                  <Text style={[styles.sectionTitleLarge, { color: selectedPalette.sectionText }]}>{block.title}</Text>
                  <Text style={[styles.sectionBody, { color: selectedPalette.mutedText }]}>{block.body}</Text>
                  {block.buttonText ? (
                    <View style={[styles.inlineButton, { backgroundColor: selectedPalette.accent }]}>
                      <Text style={[styles.inlineButtonText, { color: selectedPalette.accentText }]}>{block.buttonText}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>

        {selectedBlock ? (
          <View style={styles.editorCard}>
            <Text style={styles.editorTitle}>Editar bloco: {selectedBlock.label}</Text>

            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Titulo</Text>
              <TextInput
                value={selectedBlock.title}
                onChangeText={(value) => {
                  updateBlock(selectedBlock.id, { title: value });
                  if (selectedBlock.id === "hero") {
                    setCopyTouched((prev) => ({ ...prev, headline: true }));
                    setHeadline(value);
                  }
                }}
                style={styles.input}
                placeholder="Titulo do bloco"
                placeholderTextColor="rgba(237,237,238,0.45)"
              />
            </View>

            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Texto</Text>
              <TextInput
                value={selectedBlock.body}
                onChangeText={(value) => {
                  updateBlock(selectedBlock.id, { body: value });
                  if (selectedBlock.id === "hero") {
                    setCopyTouched((prev) => ({ ...prev, subheadline: true }));
                    setSubheadline(value);
                  }
                }}
                style={[styles.input, styles.inputMulti]}
                multiline
                textAlignVertical="top"
                placeholder="Descricao do bloco"
                placeholderTextColor="rgba(237,237,238,0.45)"
              />
            </View>

            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Texto do botao (opcional)</Text>
              <TextInput
                value={selectedBlock.buttonText ?? ""}
                onChangeText={(value) => {
                  updateBlock(selectedBlock.id, { buttonText: value || undefined });
                  if (selectedBlock.id === "hero" || selectedBlock.id === "cta") {
                    setCopyTouched((prev) => ({ ...prev, cta: true }));
                    setCtaLabel(value);
                  }
                }}
                style={styles.input}
                placeholder="Ex.: Quero conversar"
                placeholderTextColor="rgba(237,237,238,0.45)"
              />
            </View>
          </View>
        ) : null}

        {!auth.profileProductionComplete ? (
          <Body style={styles.pending}>Para publicar, complete seu cadastro no Raio-X.</Body>
        ) : null}
      </View>
    );
  };

  return (
    <Screen style={styles.screenDense}>
      <View style={[styles.page, { backgroundColor: selectedPalette.appBg }]}> 
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress}%` }]} />
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEnabled={scrollEnabled}
        >
          <View style={styles.magicCard}>
            <Title>Autobuilder</Title>
            <Body style={styles.helper}>Descreva o site em linguagem natural e o builder monta tudo para você.</Body>
            <TextInput
              value={magicPrompt}
              onChangeText={setMagicPrompt}
              style={[styles.input, styles.magicInput]}
              placeholder="Ex.: landing para clínica odontológica em SP com CTA para WhatsApp"
              placeholderTextColor="rgba(237,237,238,0.45)"
              multiline
              textAlignVertical="top"
            />
            <View style={styles.row}>
              <Button label={autoBuilding ? "Gerando..." : "Gerar automaticamente"} onPress={runAutobuilder} disabled={autoBuilding || !magicPrompt.trim()} />
            </View>
            {magicFeedback ? <Body style={styles.magicFeedback}>{magicFeedback}</Body> : null}
          </View>
          {renderStage()}
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </ScrollView>

        <View style={styles.footerActions}>
          {stage < 4 ? (
            <View style={styles.row}>
              <Button
                label="Voltar"
                variant="secondary"
                onPress={() => setStage((value) => (value > 0 ? ((value - 1) as BuilderStage) : value))}
                disabled={stage === 0}
                style={styles.action}
              />
              <Button
                label="Proximo"
                onPress={() => setStage((value) => (value < 4 ? ((value + 1) as BuilderStage) : value))}
                disabled={!canAdvance}
                style={styles.action}
              />
            </View>
          ) : (
            <>
              <View style={styles.row}>
                <Button label="Editar estrutura" variant="secondary" onPress={() => setStage(3)} style={styles.action} />
                <Button label="Publicar" onPress={publish} loading={publishing} style={styles.action} />
              </View>
              <Pressable onPress={saveDraft} disabled={savingDraft || publishing} style={styles.saveDraftTouch}>
                <Text style={styles.saveDraftText}>{savingDraft ? "Salvando..." : "Salvar rascunho"}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenDense: {
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
  },
  page: {
    flex: 1,
  },
  progressTrack: {
    height: 6,
    width: "100%",
    backgroundColor: "rgba(194,212,194,0.22)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: "#A3D695",
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingHorizontal: 10,
    paddingTop: 10,
    paddingBottom: 14,
    gap: 10,
  },
  card: {
    borderRadius: realTheme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(237,237,238,0.12)",
    backgroundColor: "rgba(9,12,15,0.56)",
    padding: 12,
    gap: 10,
  },
  magicCard: {
    borderRadius: realTheme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.36)",
    backgroundColor: "rgba(7,12,9,0.78)",
    padding: 12,
    gap: 10,
    shadowColor: realTheme.colors.green,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  magicInput: {
    minHeight: 94,
    fontSize: 15,
    lineHeight: 22,
  },
  magicFeedback: {
    color: "rgba(206,255,196,0.92)",
    fontSize: 12,
  },
  helper: {
    color: realTheme.colors.muted,
    fontSize: 13,
  },
  groupLabel: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 14,
  },
  fieldWrap: {
    gap: 6,
  },
  label: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  input: {
    borderRadius: realTheme.radius.sm,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: "rgba(17,20,24,0.92)",
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 14,
    paddingHorizontal: 11,
    paddingVertical: 11,
  },
  inputMulti: {
    minHeight: 88,
  },
  row: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
  },
  half: {
    flex: 1,
  },
  flexInput: {
    flex: 1,
  },
  templatesList: {
    gap: 10,
  },
  templateCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(237,237,238,0.12)",
    overflow: "hidden",
    backgroundColor: "rgba(16,20,26,0.85)",
  },
  activeBorder: {
    borderColor: "rgba(163,214,149,0.9)",
    shadowColor: "#9FDD8E",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  templateHero: {
    height: 108,
    justifyContent: "flex-end",
  },
  templateHeroImage: {
    opacity: 0.95,
  },
  templateOverlay: {
    padding: 10,
  },
  templateName: {
    color: "#FFFFFF",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 14,
  },
  templateHint: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  paletteRow: {
    flexDirection: "row",
    gap: 8,
  },
  paletteCard: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(237,237,238,0.12)",
    backgroundColor: "rgba(16,20,26,0.85)",
    padding: 8,
    gap: 6,
  },
  paletteSwatchRow: {
    flexDirection: "row",
    gap: 6,
  },
  swatch: {
    flex: 1,
    height: 18,
    borderRadius: 6,
  },
  paletteName: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
  },
  aiButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: realTheme.radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#A3D695",
  },
  aiButtonText: {
    color: "#091306",
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 12,
  },
  blocksList: {
    gap: 8,
  },
  blockRow: {
    minHeight: DRAG_ROW_HEIGHT,
    borderRadius: realTheme.radius.sm,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: "rgba(15,18,24,0.78)",
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  blockRowDisabled: {
    opacity: 0.58,
  },
  draggingRow: {
    borderColor: "rgba(163,214,149,0.9)",
    backgroundColor: "rgba(53,226,20,0.16)",
  },
  blockToggle: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(237,237,238,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  blockToggleOn: {
    borderColor: "rgba(163,214,149,0.95)",
    backgroundColor: "#A3D695",
  },
  blockTextWrap: {
    flex: 1,
    gap: 1,
  },
  blockLabel: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 14,
  },
  blockMeta: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 12,
  },
  dragHandle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(237,237,238,0.2)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,13,16,0.7)",
  },
  deleteBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewWrap: {
    gap: 10,
  },
  phoneShell: {
    borderRadius: 34,
    borderWidth: 1,
    borderColor: "rgba(245,255,246,0.2)",
    padding: 10,
    minHeight: 560,
    shadowColor: "#9DE58A",
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  phoneInner: {
    flex: 1,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0E1114",
    overflow: "hidden",
    gap: 8,
    paddingBottom: 10,
  },
  siteSection: {
    marginHorizontal: 10,
    borderRadius: 16,
    overflow: "hidden",
  },
  selectedSection: {
    borderWidth: 2,
    borderColor: "rgba(163,214,149,0.95)",
  },
  previewHero: {
    minHeight: 220,
    justifyContent: "flex-end",
  },
  previewHeroImage: {
    opacity: 0.95,
  },
  previewHeroOverlay: {
    padding: 14,
    gap: 4,
  },
  previewBrand: {
    color: "#EEE7D8",
    fontFamily: realTheme.fonts.title,
    fontSize: 28,
  },
  previewCaption: {
    color: "rgba(238,231,216,0.92)",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
  },
  previewHeroTitle: {
    color: "#F7F8FA",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 20,
    lineHeight: 26,
    marginTop: 6,
  },
  previewHeroBody: {
    color: "rgba(247,248,250,0.92)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 19,
  },
  previewHeroButton: {
    alignSelf: "flex-start",
    marginTop: 8,
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  previewHeroButtonText: {
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  cardSection: {
    padding: 12,
    gap: 8,
  },
  sectionTitleLarge: {
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 18,
    lineHeight: 24,
  },
  sectionBody: {
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 14,
    lineHeight: 21,
  },
  metricRow: {
    flexDirection: "row",
    gap: 8,
  },
  metricCard: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(14,18,22,0.16)",
    backgroundColor: "rgba(255,255,255,0.36)",
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: "center",
    gap: 4,
  },
  metricIcon: {
    color: "#173820",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 17,
  },
  metricText: {
    textAlign: "center",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 11,
    lineHeight: 14,
  },
  proofPills: {
    flexDirection: "row",
    gap: 8,
  },
  proofPill: {
    borderRadius: 999,
    backgroundColor: "rgba(46,93,62,0.12)",
    borderWidth: 1,
    borderColor: "rgba(46,93,62,0.3)",
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  proofPillText: {
    color: "#244A34",
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 12,
  },
  faqRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(0,0,0,0.08)",
  },
  faqQuestion: {
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
  },
  inlineButton: {
    marginTop: 4,
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inlineButtonText: {
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 12,
  },
  editorCard: {
    borderRadius: realTheme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(163,214,149,0.35)",
    backgroundColor: "rgba(12,16,18,0.88)",
    padding: 12,
    gap: 10,
  },
  editorTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 15,
  },
  pending: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
  },
  errorText: {
    color: "#FF7E7E",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
    paddingHorizontal: 4,
  },
  footerActions: {
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(8,11,14,0.96)",
    gap: 8,
  },
  action: {
    flex: 1,
  },
  saveDraftTouch: {
    alignSelf: "center",
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  saveDraftText: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
  },
});
