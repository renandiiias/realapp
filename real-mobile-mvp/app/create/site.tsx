import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
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
import { Body, Kicker, Title } from "../../src/ui/components/Typography";

type BuilderStage = 0 | 1 | 2 | 3 | 4;

type SectionDef = {
  id: string;
  label: string;
  hint: string;
};

type TemplateDef = {
  id: string;
  name: string;
  hint: string;
  hero: string;
  chip: string;
  chipText: string;
};

type BuilderPayload = {
  businessName: string;
  segment: string;
  city: string;
  templateId: string;
  headline: string;
  subheadline: string;
  ctaLabel: string;
  whatsappNumber: string;
  heroImageUrl: string;
  enabledSections: string[];
};

const stages: Array<{ id: BuilderStage; label: string; title: string; subtitle: string }> = [
  { id: 0, label: "Negocio", title: "Dados do negocio", subtitle: "Base para montar sua pagina." },
  { id: 1, label: "Visual", title: "Direcao visual", subtitle: "Escolha o estilo principal." },
  { id: 2, label: "Conteudo", title: "Texto principal", subtitle: "Edite mensagem, CTA e contato." },
  { id: 3, label: "Blocos", title: "Estrutura da pagina", subtitle: "Ative os blocos que quer publicar." },
  { id: 4, label: "Publicar", title: "Preview final", subtitle: "Revise e publique sua pagina." },
];

const templates: TemplateDef[] = [
  {
    id: "artisan",
    name: "Artesanal Premium",
    hint: "Look quente, foco em produto e WhatsApp.",
    hero: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1200&q=80",
    chip: "#E7E0D3",
    chipText: "#1C1A18",
  },
  {
    id: "clean",
    name: "Clean Conversao",
    hint: "Visual limpo, legibilidade alta, CTA forte.",
    hero: "https://images.unsplash.com/photo-1556740749-887f6717d7e4?auto=format&fit=crop&w=1200&q=80",
    chip: "#E5EDF6",
    chipText: "#101821",
  },
  {
    id: "bold",
    name: "Bold Contraste",
    hint: "Mais impacto visual e oferta em destaque.",
    hero: "https://images.unsplash.com/photo-1496449903678-68ddcb189a24?auto=format&fit=crop&w=1200&q=80",
    chip: "#F5D6CD",
    chipText: "#26150F",
  },
];

const allSections: SectionDef[] = [
  { id: "hero", label: "Hero", hint: "Abertura com promessa + CTA" },
  { id: "benefits", label: "Beneficios", hint: "Motivos para escolher sua oferta" },
  { id: "proof", label: "Prova", hint: "Depoimentos, numeros, resultados" },
  { id: "offer", label: "Oferta", hint: "Condicao comercial e chamada" },
  { id: "faq", label: "FAQ", hint: "Duvidas comuns antes da compra" },
];

const defaultSections = allSections.map((item) => item.id);

function sanitizeWhats(raw: string): string {
  return raw.replace(/[^\d]/g, "");
}

function includesSection(list: string[], id: string): boolean {
  return list.includes(id);
}

export default function SiteWebsiteBuilder() {
  const queue = useQueue();
  const auth = useAuth();
  const params = useLocalSearchParams<{ orderId?: string; prompt?: string }>();
  const orderId = typeof params.orderId === "string" ? params.orderId : undefined;
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";
  const editing = orderId ? queue.getOrder(orderId) : null;

  const [stage, setStage] = useState<BuilderStage>(0);
  const [businessName, setBusinessName] = useState("");
  const [segment, setSegment] = useState("");
  const [city, setCity] = useState("");

  const [templateId, setTemplateId] = useState<string>(templates[0]!.id);

  const [headline, setHeadline] = useState("Sua pagina pronta para vender mais no WhatsApp");
  const [subheadline, setSubheadline] = useState("Atraia clientes certos com mensagem clara e botao de acao imediato.");
  const [ctaLabel, setCtaLabel] = useState("Pedir no WhatsApp");
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [heroImageUrl, setHeroImageUrl] = useState("");

  const [enabledSections, setEnabledSections] = useState<string[]>(defaultSections);

  const [savingDraft, setSavingDraft] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    const payload = editing.payload as Record<string, unknown>;

    const builder = payload.builder;
    if (builder && typeof builder === "object" && !Array.isArray(builder)) {
      const data = builder as Partial<BuilderPayload>;
      if (typeof data.businessName === "string") setBusinessName(data.businessName);
      if (typeof data.segment === "string") setSegment(data.segment);
      if (typeof data.city === "string") setCity(data.city);
      if (typeof data.templateId === "string" && templates.some((item) => item.id === data.templateId)) setTemplateId(data.templateId);
      if (typeof data.headline === "string") setHeadline(data.headline);
      if (typeof data.subheadline === "string") setSubheadline(data.subheadline);
      if (typeof data.ctaLabel === "string") setCtaLabel(data.ctaLabel);
      if (typeof data.whatsappNumber === "string") setWhatsappNumber(data.whatsappNumber);
      if (typeof data.heroImageUrl === "string") setHeroImageUrl(data.heroImageUrl);
      if (Array.isArray(data.enabledSections)) {
        const valid = data.enabledSections.filter((item): item is string => typeof item === "string");
        if (valid.length > 0) setEnabledSections(valid);
      }
      return;
    }

    if (typeof payload.headline === "string") setHeadline(payload.headline);
    if (typeof payload.cta === "string") setCtaLabel(payload.cta);
    if (Array.isArray(payload.sections)) {
      const mapped = payload.sections
        .map((item) => String(item).toLowerCase())
        .map((value) => allSections.find((section) => section.label.toLowerCase() === value)?.id)
        .filter((item): item is string => Boolean(item));
      if (mapped.length > 0) setEnabledSections(mapped);
    }
  }, [editing]);

  useEffect(() => {
    if (!prompt) return;
    setSubheadline((current) => (current === "Atraia clientes certos com mensagem clara e botao de acao imediato." ? prompt : current));
  }, [prompt]);

  const selectedTemplate = useMemo(() => templates.find((item) => item.id === templateId) ?? templates[0]!, [templateId]);

  const progress = useMemo(() => {
    return Math.round(((stage + 1) / stages.length) * 100);
  }, [stage]);

  const canAdvance = useMemo(() => {
    if (stage === 0) return businessName.trim().length > 1 && segment.trim().length > 1;
    if (stage === 1) return Boolean(templateId);
    if (stage === 2) return headline.trim().length > 4 && ctaLabel.trim().length > 2;
    if (stage === 3) return enabledSections.length > 0;
    return true;
  }, [stage, businessName, segment, templateId, headline, ctaLabel, enabledSections]);

  const buildPayload = (): BuilderPayload => ({
    businessName: businessName.trim(),
    segment: segment.trim(),
    city: city.trim(),
    templateId,
    headline: headline.trim(),
    subheadline: subheadline.trim(),
    ctaLabel: ctaLabel.trim(),
    whatsappNumber: sanitizeWhats(whatsappNumber),
    heroImageUrl: heroImageUrl.trim(),
    enabledSections,
  });

  const orderTitle = useMemo(() => {
    const name = businessName.trim() || segment.trim() || "Website Builder";
    return `Site: ${name}`;
  }, [businessName, segment]);

  const orderSummary = useMemo(() => {
    const location = city.trim() ? ` em ${city.trim()}` : "";
    return `${segment.trim() || "Negocio"}${location} · Template ${selectedTemplate.name}`;
  }, [segment, city, selectedTemplate.name]);

  const buildOrderData = () => {
    const payload = buildPayload();
    return {
      title: orderTitle,
      summary: orderSummary,
      payload: {
        builder: payload,
        headline: payload.headline,
        cta: payload.ctaLabel,
        sections: payload.enabledSections,
        objective: `${payload.segment || "Negocio"}${payload.city ? ` em ${payload.city}` : ""}`,
      },
    };
  };

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

  const goNext = () => {
    if (!canAdvance || stage >= 4) return;
    setStage((stage + 1) as BuilderStage);
  };

  const goBack = () => {
    if (stage <= 0) return;
    setStage((stage - 1) as BuilderStage);
  };

  const toggleSection = (sectionId: string) => {
    setEnabledSections((prev) => {
      if (prev.includes(sectionId)) {
        if (prev.length === 1) return prev;
        return prev.filter((item) => item !== sectionId);
      }
      return [...prev, sectionId];
    });
  };

  const previewHero = heroImageUrl.trim() || selectedTemplate.hero;
  const stageMeta = stages[stage];

  const renderStage = () => {
    if (stage === 0) {
      return (
        <View style={styles.card}>
          <Kicker>Etapa 1</Kicker>
          <Title>{stageMeta.title}</Title>
          <Body style={styles.helper}>{stageMeta.subtitle}</Body>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Nome do negocio</Text>
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

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Cidade (opcional)</Text>
            <TextInput
              value={city}
              onChangeText={setCity}
              style={styles.input}
              placeholder="Ex.: Rio de Janeiro"
              placeholderTextColor="rgba(237,237,238,0.45)"
            />
          </View>
        </View>
      );
    }

    if (stage === 1) {
      return (
        <View style={styles.card}>
          <Kicker>Etapa 2</Kicker>
          <Title>{stageMeta.title}</Title>
          <Body style={styles.helper}>{stageMeta.subtitle}</Body>

          <View style={styles.templatesList}>
            {templates.map((template) => {
              const active = template.id === templateId;
              return (
                <TouchableOpacity
                  key={template.id}
                  onPress={() => setTemplateId(template.id)}
                  activeOpacity={0.9}
                  style={[styles.templateCard, active ? styles.templateCardActive : null]}
                >
                  <ImageBackground source={{ uri: template.hero }} style={styles.templateHero} imageStyle={styles.templateHeroImage}>
                    <LinearGradient
                      colors={["rgba(9,11,14,0.1)", "rgba(9,11,14,0.76)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 1 }}
                      style={styles.templateOverlay}
                    >
                      <View style={[styles.templateChip, { backgroundColor: template.chip }]}> 
                        <Text style={[styles.templateChipText, { color: template.chipText }]}>{template.name}</Text>
                      </View>
                    </LinearGradient>
                  </ImageBackground>
                  <Text style={styles.templateHint}>{template.hint}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      );
    }

    if (stage === 2) {
      return (
        <View style={styles.card}>
          <Kicker>Etapa 3</Kicker>
          <Title>{stageMeta.title}</Title>
          <Body style={styles.helper}>{stageMeta.subtitle}</Body>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Headline</Text>
            <TextInput
              value={headline}
              onChangeText={setHeadline}
              style={styles.input}
              placeholder="Mensagem principal"
              placeholderTextColor="rgba(237,237,238,0.45)"
            />
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Subheadline</Text>
            <TextInput
              value={subheadline}
              onChangeText={setSubheadline}
              style={[styles.input, styles.inputMulti]}
              multiline
              textAlignVertical="top"
              placeholder="Complemento da oferta"
              placeholderTextColor="rgba(237,237,238,0.45)"
            />
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Texto do botao CTA</Text>
            <TextInput
              value={ctaLabel}
              onChangeText={setCtaLabel}
              style={styles.input}
              placeholder="Ex.: Pedir no WhatsApp"
              placeholderTextColor="rgba(237,237,238,0.45)"
            />
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>WhatsApp (somente numeros)</Text>
            <TextInput
              value={whatsappNumber}
              onChangeText={setWhatsappNumber}
              style={styles.input}
              keyboardType="phone-pad"
              placeholder="Ex.: 5521999998888"
              placeholderTextColor="rgba(237,237,238,0.45)"
            />
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Imagem principal (URL opcional)</Text>
            <TextInput
              value={heroImageUrl}
              onChangeText={setHeroImageUrl}
              style={styles.input}
              placeholder="https://..."
              placeholderTextColor="rgba(237,237,238,0.45)"
              autoCapitalize="none"
            />
          </View>
        </View>
      );
    }

    if (stage === 3) {
      return (
        <View style={styles.card}>
          <Kicker>Etapa 4</Kicker>
          <Title>{stageMeta.title}</Title>
          <Body style={styles.helper}>{stageMeta.subtitle}</Body>

          <View style={styles.sectionsList}>
            {allSections.map((section) => {
              const active = includesSection(enabledSections, section.id);
              return (
                <TouchableOpacity
                  key={section.id}
                  onPress={() => toggleSection(section.id)}
                  activeOpacity={0.9}
                  style={[styles.sectionRow, active ? styles.sectionRowActive : null]}
                >
                  <View style={styles.sectionTextWrap}>
                    <Text style={styles.sectionLabel}>{section.label}</Text>
                    <Text style={styles.sectionHint}>{section.hint}</Text>
                  </View>
                  <View style={[styles.sectionCheck, active ? styles.sectionCheckActive : null]}>
                    {active ? <Ionicons name="checkmark" size={15} color="#061005" /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Body style={styles.info}>Minimo de 1 bloco ativo para publicar.</Body>
        </View>
      );
    }

    return (
      <View style={styles.previewWrap}>
        <View style={styles.builderHeader}>
          <Text style={styles.brand}>Real*</Text>
          <Text style={styles.builderTitle}>Criando sua pagina</Text>
          <Text style={styles.builderStep}>Passo {stage + 1} de 5</Text>
          <View style={styles.builderProgressTrack}>
            <View style={[styles.builderProgressFill, { width: `${progress}%` }]} />
          </View>
        </View>

        <View style={styles.phoneShell}>
          <View style={styles.phoneInner}>
            <ImageBackground source={{ uri: previewHero }} style={styles.previewHero} imageStyle={styles.previewHeroImage}>
              <LinearGradient
                colors={["rgba(11,12,14,0.76)", "rgba(11,12,14,0.2)", "rgba(11,12,14,0.84)"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={styles.previewHeroOverlay}
              >
                <Text style={styles.previewBrand}>{businessName.trim() || "Sua Marca"}</Text>
                <Text style={styles.previewCaption}>{segment.trim() || "Seu negocio"}</Text>
              </LinearGradient>
            </ImageBackground>

            <View style={[styles.previewCopyCard, { backgroundColor: selectedTemplate.chip }]}> 
              <Text style={[styles.previewHeadline, { color: selectedTemplate.chipText }]}>{headline.trim() || "Sua headline"}</Text>
              <Text style={[styles.previewSub, { color: `${selectedTemplate.chipText}DD` }]}>{subheadline.trim() || "Seu texto de apoio"}</Text>

              <View style={styles.sectionPillsWrap}>
                {enabledSections.map((sectionId) => {
                  const section = allSections.find((item) => item.id === sectionId);
                  if (!section) return null;
                  return (
                    <View key={sectionId} style={styles.sectionPill}>
                      <Text style={styles.sectionPillText}>{section.label}</Text>
                    </View>
                  );
                })}
              </View>

              <View style={styles.previewWhatsButton}>
                <Text style={styles.previewWhatsText}>{ctaLabel.trim() || "Falar no WhatsApp"}</Text>
              </View>
            </View>
          </View>
        </View>

        {!auth.profileProductionComplete ? (
          <Body style={styles.pending}>Para publicar, complete seu cadastro no Raio-X.</Body>
        ) : null}
      </View>
    );
  };

  return (
    <Screen style={styles.screenDense}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={styles.progressCard}>
          <View style={styles.progressTopRow}>
            <Text style={styles.progressTitle}>Website Builder</Text>
            <Text style={styles.progressPct}>{progress}%</Text>
          </View>
          <Text style={styles.progressMeta}>Etapa {stage + 1} de {stages.length} · {stageMeta.label}</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
        </View>

        {renderStage()}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>

      <View style={styles.footerActions}>
        {stage < 4 ? (
          <View style={styles.row}>
            <Button label="Voltar" variant="secondary" onPress={goBack} disabled={stage === 0} style={styles.action} />
            <Button label="Proximo" onPress={goNext} disabled={!canAdvance} style={styles.action} />
          </View>
        ) : (
          <>
            <View style={styles.row}>
              <Button label="Editar bloco" variant="secondary" onPress={() => setStage(3)} style={styles.action} />
              <Button label="Publicar" onPress={publish} loading={publishing} style={styles.action} />
            </View>
            <TouchableOpacity onPress={saveDraft} disabled={savingDraft || publishing} style={styles.saveDraftTouch}>
              <Text style={styles.saveDraftText}>{savingDraft ? "Salvando..." : "Salvar rascunho"}</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screenDense: {
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 10,
  },
  content: {
    paddingBottom: 122,
    gap: 10,
  },
  progressCard: {
    borderRadius: realTheme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(198,255,175,0.2)",
    backgroundColor: "rgba(9,12,15,0.66)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 6,
  },
  progressTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  progressTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 16,
  },
  progressPct: {
    color: "#9FDD8E",
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  progressMeta: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 12,
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: "rgba(194,212,194,0.2)",
    overflow: "hidden",
  },
  progressFill: {
    height: 7,
    borderRadius: 999,
    backgroundColor: "#A3D695",
  },
  card: {
    borderRadius: realTheme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(237,237,238,0.1)",
    backgroundColor: "rgba(10,12,15,0.45)",
    padding: 12,
    gap: 10,
  },
  helper: {
    color: realTheme.colors.muted,
    fontSize: 13,
  },
  fieldWrap: {
    gap: 5,
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
    minHeight: 90,
  },
  templatesList: {
    gap: 10,
  },
  templateCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(237,237,238,0.12)",
    overflow: "hidden",
    backgroundColor: "rgba(17,20,24,0.85)",
  },
  templateCardActive: {
    borderColor: "rgba(163,214,149,0.9)",
    shadowColor: "#9FDD8E",
    shadowOpacity: 0.16,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  templateHero: {
    height: 116,
    justifyContent: "flex-end",
  },
  templateHeroImage: {
    opacity: 0.95,
  },
  templateOverlay: {
    padding: 10,
  },
  templateChip: {
    alignSelf: "flex-start",
    borderRadius: realTheme.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  templateChipText: {
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 12,
  },
  templateHint: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  sectionsList: {
    gap: 8,
  },
  sectionRow: {
    borderRadius: realTheme.radius.sm,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: "rgba(15,18,24,0.76)",
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  sectionRowActive: {
    borderColor: "rgba(163,214,149,0.8)",
    backgroundColor: "rgba(53,226,20,0.12)",
  },
  sectionTextWrap: {
    flex: 1,
    gap: 1,
  },
  sectionLabel: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 14,
  },
  sectionHint: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 12,
  },
  sectionCheck: {
    width: 24,
    height: 24,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(237,237,238,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  sectionCheckActive: {
    borderColor: "rgba(163,214,149,0.95)",
    backgroundColor: "#A3D695",
  },
  info: {
    color: realTheme.colors.muted,
    fontSize: 12,
  },
  previewWrap: {
    gap: 12,
  },
  builderHeader: {
    borderRadius: realTheme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(198,255,175,0.22)",
    backgroundColor: "rgba(7,9,12,0.6)",
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 4,
  },
  brand: {
    color: "#A3D695",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 30,
    letterSpacing: -0.7,
  },
  builderTitle: {
    color: "#A3D695",
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 32,
    letterSpacing: -0.4,
  },
  builderStep: {
    color: "#D4D9DF",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 18,
    marginTop: 4,
  },
  builderProgressTrack: {
    marginTop: 4,
    height: 6,
    width: "100%",
    borderRadius: 999,
    backgroundColor: "rgba(194,212,194,0.2)",
    overflow: "hidden",
  },
  builderProgressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: "#A3D695",
  },
  phoneShell: {
    borderRadius: 34,
    borderWidth: 1,
    borderColor: "rgba(245,255,246,0.17)",
    backgroundColor: "rgba(8,11,14,0.76)",
    padding: 10,
    minHeight: 520,
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
    backgroundColor: "#0B0E12",
    overflow: "hidden",
  },
  previewHero: {
    height: 250,
    justifyContent: "flex-end",
  },
  previewHeroImage: {
    opacity: 0.95,
  },
  previewHeroOverlay: {
    padding: 14,
    gap: 2,
  },
  previewBrand: {
    color: "#EEE7D8",
    fontFamily: realTheme.fonts.title,
    fontSize: 30,
  },
  previewCaption: {
    color: "rgba(238,231,216,0.92)",
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
  },
  previewCopyCard: {
    margin: 12,
    marginTop: -16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(8,15,11,0.2)",
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 8,
  },
  previewHeadline: {
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 21,
    lineHeight: 28,
    letterSpacing: -0.2,
  },
  previewSub: {
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 21,
  },
  sectionPillsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  sectionPill: {
    borderRadius: realTheme.radius.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(10,14,12,0.2)",
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  sectionPillText: {
    color: "#122015",
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 12,
  },
  previewWhatsButton: {
    marginTop: 6,
    borderRadius: realTheme.radius.pill,
    backgroundColor: "#2E5D3E",
    paddingVertical: 12,
    alignItems: "center",
  },
  previewWhatsText: {
    color: "#ECF8F0",
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 18,
    letterSpacing: -0.2,
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
  },
  footerActions: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    gap: 8,
    borderRadius: realTheme.radius.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(8,11,14,0.94)",
    padding: 10,
  },
  row: {
    flexDirection: "row",
    gap: 10,
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
