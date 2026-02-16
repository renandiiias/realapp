import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { fetchAdsDashboardSnapshot, type AdsDashboardSnapshot, type AdsRunningCreative } from "../../src/ads/dashboardApi";
import { useQueue } from "../../src/queue/QueueProvider";
import type { JsonObject, Order, OrderStatus } from "../../src/queue/types";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Chip } from "../../src/ui/components/Chip";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";
import { StatusPill } from "../../src/ui/components/StatusPill";

type Filter =
  | { id: "all"; label: string }
  | { id: "draft"; label: string; statuses: OrderStatus[] }
  | { id: "active"; label: string; statuses: OrderStatus[] }
  | { id: "done"; label: string; statuses: OrderStatus[] }
  | { id: "waiting_payment"; label: string; statuses: OrderStatus[] };

const filters: Filter[] = [
  { id: "all", label: "Todos" },
  {
    id: "active",
    label: "Ativos",
    statuses: ["queued", "in_progress", "needs_approval", "needs_info", "blocked"],
  },
  { id: "draft", label: "Rascunhos", statuses: ["draft"] },
  { id: "waiting_payment", label: "Ativação", statuses: ["waiting_payment"] },
  { id: "done", label: "Concluídos", statuses: ["done", "failed"] },
];

const liveStatuses: OrderStatus[] = ["in_progress", "needs_approval", "needs_info"];
const TAB_SAFE_SCROLL_BOTTOM = 120;

function formatWhen(isoTs: string): string {
  try {
    const d = new Date(isoTs);
    return d.toLocaleString();
  } catch {
    return isoTs;
  }
}

function formatBRL(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function orderTypeLabel(order: Order): string {
  if (order.type === "ads") return "Tráfego";
  if (order.type === "site") return "Site";
  return "Conteúdo";
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return matches
    .map((m) => Number(m.replace(".", "").replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n > 0);
}

function inferMonthlyBudget(payload: JsonObject): number {
  const budgetRaw = typeof payload.budget === "string" ? payload.budget.toLowerCase().trim() : "";
  const numbers = extractNumbers(budgetRaw);

  if (budgetRaw) {
    const avg = numbers.length > 1 ? numbers.reduce((acc, n) => acc + n, 0) / numbers.length : numbers[0] ?? 0;
    if (avg > 0) {
      if (budgetRaw.includes("/dia") || budgetRaw.includes(" dia") || budgetRaw.includes("diario") || budgetRaw.includes("diário")) {
        return avg * 30;
      }
      return avg;
    }
  }

  const monthlyBudget = typeof payload.monthlyBudget === "string" ? payload.monthlyBudget : "";
  if (monthlyBudget === "ate_200") return 200;
  if (monthlyBudget === "500_1000") return 750;
  if (monthlyBudget === "1000_5000") return 3000;

  return 1200;
}

function inferCpl(order: Order): number {
  const seed = hashString(order.id) % 22;
  const base = 26 + seed;

  if (order.status === "done") return Math.max(18, base - 5);
  if (order.status === "in_progress") return base;
  if (order.status === "needs_approval" || order.status === "needs_info") return base + 3;
  return base + 6;
}

function formatDateTime(iso?: string | null): string {
  if (!iso) return "sem atualização";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function fallbackRunningCreatives(orders: Order[]): AdsRunningCreative[] {
  const liveOrders = orders.filter((order) => liveStatuses.includes(order.status));
  return liveOrders.map((order, idx) => {
    const preferredCreative = typeof order.payload.preferredCreative === "string" ? order.payload.preferredCreative : "";
    const creativeName = preferredCreative.trim() || `Criativo ${idx + 1}`;
    return {
      id: `local-${order.id}`,
      name: creativeName,
      campaignName: order.title,
      status: "active",
      updatedAt: order.updatedAt,
    };
  });
}

export default function Orders() {
  const queue = useQueue();
  const [filter, setFilter] = useState<Filter>(filters[0]!);
  const [showLists, setShowLists] = useState(false);
  const [remoteSnapshot, setRemoteSnapshot] = useState<AdsDashboardSnapshot | null>(null);

  const list = useMemo(() => {
    if (filter.id === "all") return queue.orders;
    return queue.orders.filter((o) => filter.statuses.includes(o.status));
  }, [filter, queue.orders]);

  const adsOrders = useMemo(() => queue.orders.filter((o) => o.type === "ads"), [queue.orders]);

  const adsDashboard = useMemo(() => {
    const live = adsOrders.filter((order) => liveStatuses.includes(order.status));
    const monthlySpend = live.reduce((acc, order) => acc + inferMonthlyBudget(order.payload), 0);
    const leads = live.reduce((acc, order) => {
      const cpl = inferCpl(order);
      return acc + inferMonthlyBudget(order.payload) / cpl;
    }, 0);
    const cplAvg = live.length
      ? live.reduce((acc, order) => acc + inferCpl(order), 0) / live.length
      : 0;

    return {
      totalAds: adsOrders.length,
      liveAds: live.length,
      monthlySpend,
      estimatedLeads: leads,
      cplAvg,
      pendingApprovals: queue.listPendingApprovals().length,
    };
  }, [adsOrders, queue]);

  useEffect(() => {
    let disposed = false;

    const sync = async () => {
      try {
        const snapshot = await fetchAdsDashboardSnapshot();
        if (!disposed) setRemoteSnapshot(snapshot);
      } catch {
        if (!disposed) setRemoteSnapshot(null);
      }
    };

    void sync();
    const id = setInterval(() => {
      void sync();
    }, 60000);

    return () => {
      disposed = true;
      clearInterval(id);
    };
  }, []);

  const runningCreatives = useMemo(
    () => (remoteSnapshot?.creativesRunning?.length ? remoteSnapshot.creativesRunning : fallbackRunningCreatives(adsOrders)),
    [adsOrders, remoteSnapshot],
  );

  const kpi = useMemo(() => {
    if (remoteSnapshot) {
      return {
        liveAds: remoteSnapshot.activeCampaigns,
        monthlySpend: remoteSnapshot.monthlySpend,
        monthlyLeads: remoteSnapshot.monthlyLeads,
        cpl: remoteSnapshot.cpl,
        activeCreatives: remoteSnapshot.activeCreatives,
        updatedAt: remoteSnapshot.updatedAt,
        source: "server" as const,
      };
    }

    return {
      liveAds: adsDashboard.liveAds,
      monthlySpend: adsDashboard.monthlySpend,
      monthlyLeads: Math.round(adsDashboard.estimatedLeads),
      cpl: adsDashboard.cplAvg || null,
      activeCreatives: runningCreatives.length,
      updatedAt: null,
      source: "fallback" as const,
    };
  }, [adsDashboard, remoteSnapshot, runningCreatives.length]);

  if (!queue.planActive && queue.orders.length === 0) {
    return (
      <Screen>
        <View style={styles.content}>
          <Card>
            <Kicker>Acompanhar</Kicker>
            <Title>Ative para ver seu dashboard</Title>
            <Body>Com o plano ativo você acompanha os números-chave e os status em tempo real.</Body>
            <Button label="Ativar agora (simular)" onPress={() => queue.setPlanActive(true)} />
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollIndicatorInsets={{ bottom: TAB_SAFE_SCROLL_BOTTOM }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Card>
          <Kicker>Dashboard</Kicker>
          <Title>Anúncios</Title>
          <Body>
            Dados de performance vêm da base no servidor atualizada pelo Agent Gestor (quem cria e acompanha os anúncios).
          </Body>

          <View style={styles.kpiGrid}>
            <Kpi label="Campanhas no ar" value={String(kpi.liveAds)} hint={remoteSnapshot ? "fonte servidor" : `de ${adsDashboard.totalAds} campanhas`} />
            <Kpi label="Invest. mês" value={formatBRL(kpi.monthlySpend)} hint={kpi.source === "server" ? "real" : "fallback"} />
            <Kpi label="Leads/mês" value={String(Math.round(kpi.monthlyLeads))} hint={kpi.source === "server" ? "real" : "estimado"} />
            <Kpi label="CPL médio" value={kpi.cpl ? formatBRL(kpi.cpl) : "-"} hint={kpi.source === "server" ? "real" : "estimado"} />
            <Kpi label="Criativos ativos" value={String(kpi.activeCreatives)} hint="no ar agora" />
          </View>

          <View style={styles.secondaryRow}>
            <Body style={styles.secondaryText}>Aprovações pendentes: {adsDashboard.pendingApprovals}</Body>
            <Body style={styles.secondaryText}>Plano: {queue.planActive ? "ativo" : "pendente"}</Body>
            <Body style={styles.secondaryText}>
              Atualização: {formatDateTime(kpi.updatedAt)} · {kpi.source === "server" ? "base do servidor" : "fallback local"}
            </Body>
          </View>
        </Card>

        <Card>
          <SubTitle>Criativos rodando</SubTitle>
          <Body style={styles.creativeHint}>
            Aqui você vê exatamente quais criativos estão ativos na conta neste momento.
          </Body>
          {runningCreatives.length === 0 ? (
            <Body>Nenhum criativo ativo agora.</Body>
          ) : (
            <View style={styles.creativeList}>
              {runningCreatives.map((creative) => (
                <View key={creative.id} style={styles.creativeItem}>
                  <View style={styles.creativeMain}>
                    <Body style={styles.creativeName}>{creative.name}</Body>
                    <Body style={styles.creativeMeta}>
                      Campanha: {creative.campaignName}
                      {creative.adSetName ? ` · Conjunto: ${creative.adSetName}` : ""}
                    </Body>
                  </View>
                  <View style={styles.creativeRight}>
                    <Body style={creative.status === "active" ? styles.creativeBadgeActive : styles.creativeBadgePaused}>
                      {creative.status === "active" ? "Rodando" : creative.status}
                    </Body>
                    {typeof creative.spend === "number" ? <Body style={styles.creativeSpend}>{formatBRL(creative.spend)}</Body> : null}
                  </View>
                </View>
              ))}
            </View>
          )}
          <View style={styles.secondaryRow}>
            <Body style={styles.secondaryText}>Sync esperado: 1x por dia pelo Agent Gestor</Body>
          </View>
        </Card>

        <Card>
          <Pressable style={styles.listHeader} onPress={() => setShowLists((prev) => !prev)}>
            <View>
              <SubTitle>Listas de pedidos</SubTitle>
              <Body>Clique para {showLists ? "ocultar" : "abrir"} os detalhes.</Body>
            </View>
            <Body style={styles.expand}>{showLists ? "Ocultar" : "Ver listas"}</Body>
          </Pressable>

          {showLists ? (
            <>
              <View style={styles.filters}>
                {filters.map((f) => (
                  <Chip key={f.id} label={f.label} active={f.id === filter.id} onPress={() => setFilter(f)} />
                ))}
              </View>

              {list.length === 0 ? (
                <Body>Nenhum pedido nesse filtro.</Body>
              ) : (
                <View style={styles.list}>
                  {list.map((o) => (
                    <TouchableOpacity key={o.id} activeOpacity={0.9} onPress={() => router.push(`/orders/${o.id}`)}>
                      <View style={styles.item}>
                        <View style={styles.itemLeft}>
                          <SubTitle style={styles.itemTitle}>{o.title}</SubTitle>
                          <Body style={styles.itemMeta}>{orderTypeLabel(o)} · atualizado {formatWhen(o.updatedAt)}</Body>
                        </View>
                        <StatusPill status={o.status} />
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </>
          ) : null}
        </Card>
      </ScrollView>
    </Screen>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <View style={styles.kpiCard}>
      <Body style={styles.kpiLabel}>{label}</Body>
      <SubTitle style={styles.kpiValue}>{value}</SubTitle>
      <Body style={styles.kpiHint}>{hint}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: TAB_SAFE_SCROLL_BOTTOM,
    gap: 14,
  },
  kpiGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 4,
  },
  kpiCard: {
    width: "48.5%",
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.3)",
    borderRadius: realTheme.radius.md,
    backgroundColor: "rgba(15,18,16,0.82)",
    paddingVertical: 10,
    paddingHorizontal: 11,
    gap: 2,
  },
  kpiLabel: {
    color: realTheme.colors.muted,
    fontSize: 12,
    lineHeight: 16,
  },
  kpiValue: {
    fontSize: 20,
    lineHeight: 25,
  },
  kpiHint: {
    color: realTheme.colors.muted,
    fontSize: 11,
    lineHeight: 15,
  },
  secondaryRow: {
    marginTop: 2,
    gap: 2,
  },
  secondaryText: {
    color: realTheme.colors.muted,
    fontSize: 13,
  },
  creativeHint: {
    color: realTheme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  creativeList: {
    gap: 9,
    marginTop: 4,
  },
  creativeItem: {
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: "rgba(18,19,22,0.85)",
    borderRadius: realTheme.radius.md,
    paddingVertical: 10,
    paddingHorizontal: 11,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  creativeMain: {
    flex: 1,
    gap: 3,
  },
  creativeName: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 14,
    lineHeight: 19,
  },
  creativeMeta: {
    color: realTheme.colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  creativeRight: {
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 4,
  },
  creativeBadgeActive: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: realTheme.fonts.bodySemiBold,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    overflow: "hidden",
    textTransform: "uppercase",
    color: "#051006",
    backgroundColor: "rgba(53,226,20,0.95)",
  },
  creativeBadgePaused: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: realTheme.fonts.bodySemiBold,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
    overflow: "hidden",
    textTransform: "uppercase",
    color: "#f4f4f4",
    backgroundColor: "rgba(108,114,128,0.75)",
  },
  creativeSpend: {
    color: realTheme.colors.muted,
    fontSize: 11,
  },
  listHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  expand: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  filters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
  },
  list: {
    gap: 10,
    marginTop: 2,
  },
  item: {
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: "rgba(18,19,22,0.85)",
    borderRadius: realTheme.radius.md,
    padding: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  itemLeft: {
    flex: 1,
    gap: 4,
  },
  itemTitle: {
    fontSize: 16,
  },
  itemMeta: {
    color: realTheme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
});
