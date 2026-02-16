import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { useQueue } from "../../src/queue/QueueProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Chip } from "../../src/ui/components/Chip";
import { Field } from "../../src/ui/components/Field";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

type VariantState = {
  copyOptions: string[];
  creativeOptions: string[];
  preferredCopy: string;
  preferredCreative: string;
};

function initialVariants(): VariantState {
  return {
    copyOptions: [],
    creativeOptions: [],
    preferredCopy: "",
    preferredCreative: "",
  };
}

export default function AdsWizard() {
  const queue = useQueue();
  const auth = useAuth();
  const params = useLocalSearchParams<{ orderId?: string; prompt?: string }>();
  const orderId = typeof params.orderId === "string" ? params.orderId : undefined;
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";

  const editing = orderId ? queue.getOrder(orderId) : null;

  const [objective, setObjective] = useState("");
  const [offer, setOffer] = useState("");
  const [budget, setBudget] = useState("");
  const [audience, setAudience] = useState("");
  const [region, setRegion] = useState("");
  const [references, setReferences] = useState("");
  const [variants, setVariants] = useState<VariantState>(initialVariants);

  useEffect(() => {
    if (!editing) {
      if (prompt) {
        setObjective(prompt);
      }
      return;
    }

    setObjective(String(editing.payload.objective ?? ""));
    setOffer(String(editing.payload.offer ?? ""));
    setBudget(String(editing.payload.budget ?? ""));
    setAudience(String(editing.payload.audience ?? ""));
    setRegion(String(editing.payload.region ?? ""));
    setReferences(String(editing.payload.references ?? ""));

    setVariants({
      copyOptions: Array.isArray(editing.payload.copyOptions) ? (editing.payload.copyOptions as string[]) : [],
      creativeOptions: Array.isArray(editing.payload.creativeOptions) ? (editing.payload.creativeOptions as string[]) : [],
      preferredCopy: String(editing.payload.preferredCopy ?? ""),
      preferredCreative: String(editing.payload.preferredCreative ?? ""),
    });
  }, [editing, prompt]);

  const title = useMemo(() => {
    if (offer.trim()) return `Tráfego: ${offer.trim().slice(0, 36)}`;
    return "Tráfego (Meta)";
  }, [offer]);

  const summary = useMemo(() => {
    const bits = [objective && `Objetivo: ${objective}`, budget && `Budget: ${budget}`, region && `Região: ${region}`]
      .filter(Boolean)
      .join(" · ");
    return bits || "Pedido de tráfego.";
  }, [objective, budget, region]);

  const generate = () => {
    const copyOptions = [
      "SEM FRESCURA: promessa + prova + CTA.",
      "Direto: o que é, pra quem é e próximo passo.",
      "Problema -> solução -> oferta.",
    ];
    const creativeOptions = [
      "Antes x Depois (resultado)",
      "3 erros + solução (educacional)",
      "Prova social (direto)",
    ];
    setVariants({
      copyOptions,
      creativeOptions,
      preferredCopy: copyOptions[0]!,
      preferredCreative: creativeOptions[0]!,
    });
  };

  const buildPayload = () => ({
    objective: objective.trim(),
    offer: offer.trim(),
    budget: budget.trim(),
    audience: audience.trim(),
    region: region.trim(),
    references: references.trim(),
    copyOptions: variants.copyOptions,
    creativeOptions: variants.creativeOptions,
    preferredCopy: variants.preferredCopy,
    preferredCreative: variants.preferredCreative,
  });

  const saveDraft = async () => {
    const payload = buildPayload();
    if (orderId) {
      await queue.updateOrder(orderId, { title, summary, payload });
      router.navigate("/orders");
      return;
    }
    const created = await queue.createOrder({ type: "ads", title, summary, payload });
    router.navigate("/orders");
  };

  const submit = async () => {
    const payload = buildPayload();
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

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <Kicker>Brief guiado</Kicker>
          <Title>Tráfego (Meta Ads)</Title>
          <Body>Define o objetivo aqui. A Real cuida da execução e te atualiza no caminho.</Body>
        </Card>

        <Card>
          <SubTitle>Contexto</SubTitle>
          <Field label="Objetivo" value={objective} onChangeText={setObjective} placeholder="Ex.: leads / vendas / WhatsApp" />
          <Field label="Oferta" value={offer} onChangeText={setOffer} placeholder="Ex.: consulta + bônus" />
          <Field label="Budget" value={budget} onChangeText={setBudget} placeholder="Ex.: R$ 80/dia" />
          <Field label="Público (alto nível)" value={audience} onChangeText={setAudience} placeholder="Ex.: interesse + lookalike" />
          <Field label="Região" value={region} onChangeText={setRegion} placeholder="Ex.: São José do Rio Preto" />
          <Field label="Referências" value={references} onChangeText={setReferences} placeholder="Cole links/ideias" multiline />
        </Card>

        <Card>
          <SubTitle>Criativo + Copy</SubTitle>
          <Body>Gera variações iniciais para escolher direção.</Body>
          <Button label="Gerar variações (mock)" onPress={generate} variant="secondary" />

          {variants.copyOptions.length > 0 ? (
            <View style={styles.variantsBlock}>
              <Body style={styles.label}>Copy</Body>
              <View style={styles.variants}>
                {variants.copyOptions.map((v) => (
                  <Chip
                    key={v}
                    label={v}
                    active={variants.preferredCopy === v}
                    onPress={() => setVariants((prev) => ({ ...prev, preferredCopy: v }))}
                  />
                ))}
              </View>
              <Body style={styles.label}>Criativo</Body>
              <View style={styles.variants}>
                {variants.creativeOptions.map((v) => (
                  <Chip
                    key={v}
                    label={v}
                    active={variants.preferredCreative === v}
                    onPress={() => setVariants((prev) => ({ ...prev, preferredCreative: v }))}
                  />
                ))}
              </View>
            </View>
          ) : null}
        </Card>

        <Card>
          <SubTitle>Resumo</SubTitle>
          <Body style={styles.preview}>{summary}</Body>
          {!auth.profileProductionComplete ? (
            <Body style={styles.companyPending}>
              Para colocar no ar, complete seu cadastro de produção no Raio-X.
            </Body>
          ) : null}
          <View style={styles.actions}>
            <Button label="Salvar rascunho" variant="secondary" onPress={saveDraft} style={styles.action} />
            <Button label="Enviar para Real" onPress={submit} style={styles.action} />
          </View>
          {!queue.planActive ? (
            <Body style={styles.paymentNote}>
              Sem plano ativo: você já pode enviar, e ativar depois para entrar em produção.
            </Body>
          ) : null}
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
  variantsBlock: {
    gap: 10,
  },
  variants: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  label: {
    color: realTheme.colors.muted,
  },
  preview: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 4,
  },
  action: {
    flex: 1,
  },
  paymentNote: {
    color: realTheme.colors.muted,
  },
  companyPending: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
  },
});
