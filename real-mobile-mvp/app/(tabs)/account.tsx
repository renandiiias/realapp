import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { PROFILE_FIELD_LABELS } from "../../src/auth/profileReadiness";
import { useQueue } from "../../src/queue/QueueProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

type StatusKey = "minimum" | "production" | "tour";
const TAB_SAFE_SCROLL_BOTTOM = 120;

export default function Account() {
  const auth = useAuth();
  const queue = useQueue();
  const [selectedStatus, setSelectedStatus] = useState<StatusKey | null>(null);

  const missingForProduction = auth.missingForProduction.map((field) => PROFILE_FIELD_LABELS[field]).slice(0, 6);
  const missingForMinimum = auth.missingForMinimum.map((field) => PROFILE_FIELD_LABELS[field]).slice(0, 6);

  const statusConfig: Record<StatusKey, { label: string; ok: boolean; missing: string[] }> = useMemo(
    () => ({
      minimum: {
        label: "Cadastro mínimo",
        ok: auth.profileMinimumComplete,
        missing: missingForMinimum,
      },
      production: {
        label: "Cadastro de produção",
        ok: auth.profileProductionComplete,
        missing: missingForProduction,
      },
      tour: {
        label: "Tour guiado",
        ok: auth.appTourCompleted,
        missing: auth.appTourCompleted ? [] : ["Concluir o tour guiado do app"],
      },
    }),
    [auth.appTourCompleted, auth.profileMinimumComplete, auth.profileProductionComplete, missingForMinimum, missingForProduction],
  );

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollIndicatorInsets={{ bottom: TAB_SAFE_SCROLL_BOTTOM }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Card>
          <Kicker>Conta</Kicker>
          <Title>Central de gestão</Title>
          <Body>Edite cada área no lugar certo para não ficar tudo misturado.</Body>
        </Card>

        <Card>
          <SubTitle>Checklist</SubTitle>
          <View style={styles.statusList}>
            {(["minimum", "production", "tour"] as StatusKey[]).map((key) => (
              <Pressable key={key} onPress={() => setSelectedStatus(key)} style={styles.statusItem}>
                <View style={[styles.statusDot, statusConfig[key].ok ? styles.statusDotOk : styles.statusDotPending]} />
                <Body style={styles.statusLabel}>{statusConfig[key].label}</Body>
              </Pressable>
            ))}
          </View>

          {selectedStatus ? (
            <Body style={styles.statusHint}>
              {statusConfig[selectedStatus].ok
                ? "Tudo certo aqui."
                : `Falta: ${statusConfig[selectedStatus].missing.join(" · ")}`}
            </Body>
          ) : null}

          {!auth.appTourCompleted ? (
            <Button label="Fazer tour agora" variant="secondary" onPress={() => router.push("/onboarding/app-tour")} />
          ) : null}
        </Card>

        <Card>
          <SubTitle>Editar dados</SubTitle>
          <ManageRow
            title="Cadastro da empresa"
            hint="Dados da empresa, contato e links"
            onPress={() => router.push("/account/profile")}
          />
          <ManageRow
            title="Preferências de marketing"
            hint="Objetivo, budget, segmento e estratégia"
            onPress={() => router.push("/account/marketing")}
          />
          <ManageRow
            title="Investimento de anúncios"
            hint="Orçamento mensal e saldo pré-pago"
            onPress={() => router.push("/account/investment")}
          />
        </Card>

        <Card>
          <Kicker>Plano</Kicker>
          <Title>Assinatura</Title>
          <View style={styles.planRow}>
            <SubTitle>Status</SubTitle>
            <Body style={styles.value}>{queue.planActive ? "Ativo" : "Não ativo"}</Body>
          </View>
          <Button
            label={queue.planActive ? "Plano ativo" : "Já paguei (simular)"}
            onPress={() => queue.setPlanActive(true)}
            disabled={queue.planActive}
          />
          <Button label="Fazer upgrade do plano" variant="secondary" onPress={() => {}} />
        </Card>

        <Card>
          <SubTitle>Sessão</SubTitle>
          <Body style={styles.muted}>{auth.userEmail ? auth.userEmail : "Sem sessão ativa"}</Body>
          <Button
            label="Sair"
            variant="secondary"
            onPress={async () => {
              await auth.logout();
              router.replace("/welcome");
            }}
          />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function ManageRow({ title, hint, onPress }: { title: string; hint: string; onPress(): void }) {
  return (
    <TouchableOpacity style={styles.manageRow} activeOpacity={0.9} onPress={onPress}>
      <View style={styles.manageTextWrap}>
        <SubTitle style={styles.manageTitle}>{title}</SubTitle>
        <Body style={styles.manageHint}>{hint}</Body>
      </View>
      <Body style={styles.manageCta}>Abrir</Body>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: TAB_SAFE_SCROLL_BOTTOM,
    gap: 14,
  },
  muted: {
    color: realTheme.colors.muted,
  },
  statusList: {
    gap: 10,
  },
  statusItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    borderRadius: 999,
    paddingVertical: 9,
    paddingHorizontal: 12,
    backgroundColor: "rgba(18,19,22,0.7)",
  },
  statusDot: {
    width: 11,
    height: 11,
    borderRadius: 999,
  },
  statusDotOk: {
    backgroundColor: realTheme.colors.green,
  },
  statusDotPending: {
    backgroundColor: "#ff8e53",
  },
  statusLabel: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 14,
  },
  statusHint: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
    lineHeight: 18,
  },
  manageRow: {
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: "rgba(18,19,22,0.85)",
    borderRadius: realTheme.radius.md,
    paddingVertical: 11,
    paddingHorizontal: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  manageTextWrap: {
    flex: 1,
    gap: 2,
  },
  manageTitle: {
    fontSize: 16,
  },
  manageHint: {
    color: realTheme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  manageCta: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  planRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  value: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
  },
});
