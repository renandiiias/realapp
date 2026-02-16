import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { useQueue } from "../../src/queue/QueueProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Field } from "../../src/ui/components/Field";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

function parseLines(v: string): string[] {
  return v
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function SiteWizard() {
  const queue = useQueue();
  const auth = useAuth();
  const params = useLocalSearchParams<{ orderId?: string; prompt?: string }>();
  const orderId = typeof params.orderId === "string" ? params.orderId : undefined;
  const prompt = typeof params.prompt === "string" ? params.prompt.trim() : "";

  const editing = orderId ? queue.getOrder(orderId) : null;

  const [objective, setObjective] = useState("");
  const [cta, setCta] = useState("");
  const [headline, setHeadline] = useState("");
  const [sectionsRaw, setSectionsRaw] = useState("Hero\nBenefícios\nProva\nCTA");
  const [references, setReferences] = useState("");

  useEffect(() => {
    if (!editing) {
      if (prompt) {
        setObjective(prompt);
      }
      return;
    }
    setObjective(String(editing.payload.objective ?? ""));
    setCta(String(editing.payload.cta ?? ""));
    setHeadline(String(editing.payload.headline ?? ""));
    const sections = Array.isArray(editing.payload.sections) ? (editing.payload.sections as string[]) : [];
    setSectionsRaw(sections.length ? sections.join("\n") : String(editing.payload.sections ?? ""));
    setReferences(String(editing.payload.references ?? ""));
  }, [editing, prompt]);

  const sections = useMemo(() => parseLines(sectionsRaw), [sectionsRaw]);

  const title = useMemo(() => {
    if (headline.trim()) return `Site: ${headline.trim().slice(0, 36)}`;
    return "Site";
  }, [headline]);

  const summary = useMemo(() => {
    const bits = [objective && `Objetivo: ${objective}`, cta && `CTA: ${cta}`].filter(Boolean).join(" · ");
    return bits || "Pedido de site.";
  }, [objective, cta]);

  const buildPayload = () => ({
    objective: objective.trim(),
    cta: cta.trim(),
    headline: headline.trim(),
    sections,
    references: references.trim(),
  });

  const saveDraft = async () => {
    const payload = buildPayload();
    if (orderId) {
      await queue.updateOrder(orderId, { title, summary, payload });
      router.navigate("/orders");
      return;
    }
    const created = await queue.createOrder({ type: "site", title, summary, payload });
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

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <Kicker>Brief guiado</Kicker>
          <Title>Site</Title>
          <Body>Defina o foco da página e a Real organiza a execução.</Body>
        </Card>

        <Card>
          <SubTitle>Contexto</SubTitle>
          <Field label="Objetivo" value={objective} onChangeText={setObjective} placeholder="Ex.: capturar leads / vender" />
          <Field label="Headline" value={headline} onChangeText={setHeadline} placeholder="Ex.: Marketing sem frescura" />
          <Field label="CTA principal" value={cta} onChangeText={setCta} placeholder="Ex.: Falar no WhatsApp" />
          <Field
            label="Seções (1 por linha)"
            value={sectionsRaw}
            onChangeText={setSectionsRaw}
            placeholder="Hero, benefícios, prova..."
            multiline
          />
          <Field label="Referências" value={references} onChangeText={setReferences} placeholder="Cole links/ideias" multiline />
        </Card>

        <Card>
          <SubTitle>Preview wireframe (mock)</SubTitle>
          <Body style={styles.previewLine}>{summary}</Body>
          {!auth.profileProductionComplete ? (
            <Body style={styles.pending}>Para enviar para produção, complete seu cadastro no Raio-X.</Body>
          ) : null}
          <View style={styles.previewList}>
            {sections.length === 0 ? (
              <Body style={styles.muted}>Sem seções ainda.</Body>
            ) : (
              sections.map((s) => (
                <View key={s} style={styles.section}>
                  <Body style={styles.sectionText}>{s}</Body>
                </View>
              ))
            )}
          </View>
          <View style={styles.actions}>
            <Button label="Salvar rascunho" variant="secondary" onPress={saveDraft} style={styles.action} />
            <Button label="Enviar para Real" onPress={submit} style={styles.action} />
          </View>
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
  previewLine: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
  },
  previewList: {
    gap: 8,
    marginTop: 8,
  },
  section: {
    borderRadius: realTheme.radius.sm,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: realTheme.colors.panelSoft,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  sectionText: {
    color: realTheme.colors.text,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
  },
  action: {
    flex: 1,
  },
  muted: {
    color: realTheme.colors.muted,
  },
  pending: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
  },
});
