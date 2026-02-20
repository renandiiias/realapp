import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ImageBackground, Pressable, ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient as SvgLinearGradient, Path, Rect, Stop } from "react-native-svg";
import { fetchAdsDashboardSnapshot, type AdsDashboardSnapshot } from "../../src/ads/dashboardApi";
import { useQueue } from "../../src/queue/QueueProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Screen } from "../../src/ui/components/Screen";
import { Body, SubTitle, Title } from "../../src/ui/components/Typography";
import { getOrdersByType } from "../../src/services/orderService";
import { buildKPIData, calculateAdsDashboardMetrics, generateFallbackRunningCreatives } from "../../src/services/adsDashboardService";
import { formatBRL } from "../../src/utils/formatters";

const TAB_SAFE_SCROLL_BOTTOM = 120;

type PerformanceCard = {
  id: "ads" | "site" | "video_editor";
  title: string;
  status: "RODANDO" | "EM TESTE";
  tone: "running" | "testing";
  image: ImageSourcePropType;
  route: "/create/ads" | "/create/site" | "/create/video-editor";
};

const performanceCards: PerformanceCard[] = [
  {
    id: "ads",
    title: "Mensagens\nno WhatsApp",
    status: "RODANDO",
    tone: "running",
    image: {
      uri: "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=900&q=80",
    },
    route: "/create/ads",
  },
  {
    id: "site",
    title: "Página da sua\nempresa",
    status: "RODANDO",
    tone: "running",
    image: {
      uri: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?auto=format&fit=crop&w=900&q=80",
    },
    route: "/create/site",
  },
  {
    id: "video_editor",
    title: "Vídeo curto\ncriativo",
    status: "EM TESTE",
    tone: "testing",
    image: {
      uri: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=900&q=80",
    },
    route: "/create/video-editor",
  },
];

export default function Orders() {
  const queue = useQueue();
  const [remoteSnapshot, setRemoteSnapshot] = useState<AdsDashboardSnapshot | null>(null);

  const pendingApprovals = queue.listPendingApprovals().length;
  const adsOrders = useMemo(() => getOrdersByType(queue.orders, "ads"), [queue.orders]);
  const adsDashboard = useMemo(
    () => calculateAdsDashboardMetrics(queue.orders, pendingApprovals),
    [pendingApprovals, queue.orders],
  );

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
    () => (remoteSnapshot?.creativesRunning?.length ? remoteSnapshot.creativesRunning : generateFallbackRunningCreatives(adsOrders)),
    [adsOrders, remoteSnapshot],
  );

  const kpi = useMemo(() => {
    const normalizedRemote =
      remoteSnapshot && remoteSnapshot.updatedAt
        ? {
            activeCampaigns: remoteSnapshot.activeCampaigns,
            monthlySpend: remoteSnapshot.monthlySpend,
            monthlyLeads: remoteSnapshot.monthlyLeads,
            cpl: remoteSnapshot.cpl ?? 0,
            activeCreatives: remoteSnapshot.activeCreatives,
            updatedAt: remoteSnapshot.updatedAt,
          }
        : undefined;
    return buildKPIData(adsDashboard, runningCreatives, normalizedRemote);
  }, [adsDashboard, remoteSnapshot, runningCreatives]);

  const leads = Math.max(0, Math.round(kpi.monthlyLeads));
  const previousLeads = Math.max(1, Math.round(leads * 0.84));
  const diffLeads = Math.max(0, leads - previousLeads);
  const growthPct = previousLeads > 0 ? Math.max(0, Math.round((diffLeads / previousLeads) * 100)) : 0;
  const cpl = kpi.cpl ?? (leads > 0 ? kpi.monthlySpend / leads : 0);

  const insightText =
    cpl && cpl <= 50
      ? "Seu custo está bom. Se aumentar R$ 20/dia, pode gerar +18 contatos."
      : "O custo está acima da meta. Ajuste criativo + público para baixar CPL.";

  if (!queue.planActive && queue.orders.length === 0) {
    return (
      <Screen>
        <View style={styles.emptyWrap}>
          <Card>
            <Title>Ver resultados</Title>
            <Body>Ative para acompanhar contatos, custo por lead e desempenho dos ativos.</Body>
            <Button label="Ativar agora (simular)" onPress={() => queue.setPlanActive(true)} />
          </Card>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} scrollIndicatorInsets={{ bottom: TAB_SAFE_SCROLL_BOTTOM }}>
        <Card style={styles.growthCard}>
          <SubTitle style={styles.growthTitle}>Seu crescimento</SubTitle>
          <View style={styles.headlineRow}>
            <Title style={styles.leadsValue}>{leads || 82}</Title>
            <SubTitle style={styles.leadsLabel}>novos contatos</SubTitle>
          </View>
          <Body style={styles.monthText}>este mês</Body>
          <Body style={styles.cplText}>
            <Text style={styles.cplStrong}>{formatBRL(cpl || 44)}</Text> por contato
          </Body>

          <View style={styles.graphWrap}>
            <GrowthGraph />
          </View>

          <View style={styles.metricsStrip}>
            <Body style={styles.metricsItem}>
              ↑ {diffLeads || 23} <Text style={styles.metricsStrong}>+{growthPct || 16}%</Text> este mês
            </Body>
            <Body style={styles.metricsDivider}>|</Body>
            <Body style={styles.metricsItem}>↑ {formatBRL(kpi.monthlySpend || 1240)} este mês</Body>
          </View>
        </Card>

        <View style={styles.sectionHeader}>
          <SubTitle>Seus anúncios ativos</SubTitle>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.cardsRow}>
          {performanceCards.map((item) => (
            <Pressable key={item.id} style={styles.performanceCard} onPress={() => router.push(item.route)}>
              <ImageBackground source={item.image} style={styles.performanceImage} imageStyle={styles.performanceImageStyle} />
              <View style={styles.performanceBody}>
                <SubTitle style={styles.performanceTitle}>{item.title}</SubTitle>
                <View style={[styles.statusPill, item.tone === "testing" ? styles.testingPill : styles.runningPill]}>
                  <Text style={item.tone === "testing" ? styles.statusTestingText : styles.statusRunningText}>{item.status}</Text>
                </View>
                <Body style={styles.linkText}>Ver desempenho</Body>
              </View>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.sectionHeader}>
          <SubTitle>Sugestão do Real</SubTitle>
        </View>
        <Card style={styles.suggestionCard}>
          <Body style={styles.suggestionLead}>Seu custo está bom.</Body>
          <Body style={styles.suggestionBody}>{insightText}</Body>
          <Button label="Aumentar alcance" onPress={() => router.push("/create/ads")} />
        </Card>
      </ScrollView>
    </Screen>
  );
}

function GrowthGraph() {
  const points = [
    { x: 10, y: 132 },
    { x: 58, y: 122 },
    { x: 102, y: 104 },
    { x: 154, y: 97 },
    { x: 206, y: 80 },
    { x: 256, y: 58 },
    { x: 302, y: 34 },
  ];

  const linePath = `M ${points[0]!.x} ${points[0]!.y}
    C 34 128, 52 122, ${points[1]!.x} ${points[1]!.y}
    C 78 118, 96 108, ${points[2]!.x} ${points[2]!.y}
    C 126 98, 142 100, ${points[3]!.x} ${points[3]!.y}
    C 172 94, 188 86, ${points[4]!.x} ${points[4]!.y}
    C 228 72, 242 64, ${points[5]!.x} ${points[5]!.y}
    C 276 50, 292 42, ${points[6]!.x} ${points[6]!.y}`;

  const areaPath = `${linePath} L 302 152 L 10 152 Z`;

  return (
    <Svg width="100%" height="100%" viewBox="0 0 312 152" preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor="#A8F06A" stopOpacity="0.5" />
          <Stop offset="70%" stopColor="#86E84F" stopOpacity="0.16" />
          <Stop offset="100%" stopColor="#86E84F" stopOpacity="0" />
        </SvgLinearGradient>
        <SvgLinearGradient id="lineGlow" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0%" stopColor="#90E85E" stopOpacity="0.72" />
          <Stop offset="100%" stopColor="#D4FF8F" stopOpacity="1" />
        </SvgLinearGradient>
      </Defs>

      <Rect x="0" y="0" width="312" height="152" fill="rgba(8,12,20,0.66)" />

      {[184, 216, 248, 280].map((x, idx) => (
        <Rect key={`col-${x}`} x={x} y={56 - idx * 4} width="24" height={100 + idx * 8} rx="8" fill="rgba(160,238,99,0.08)" />
      ))}

      <Line x1="10" y1="132" x2="302" y2="132" stroke="rgba(255,255,255,0.12)" strokeWidth="1" />
      <Path d={areaPath} fill="url(#areaFill)" />
      <Path d={linePath} stroke="url(#lineGlow)" strokeWidth="4.5" fill="none" strokeLinecap="round" />
      <Path d={linePath} stroke="rgba(213,255,144,0.24)" strokeWidth="10" fill="none" strokeLinecap="round" />

      {points.slice(2).map((point) => (
        <Circle key={`dot-glow-${point.x}`} cx={point.x} cy={point.y} r="9" fill="rgba(187,245,110,0.22)" />
      ))}
      {points.slice(2).map((point) => (
        <Circle key={`dot-${point.x}`} cx={point.x} cy={point.y} r="5.4" fill="#CBFA8B" />
      ))}
    </Svg>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: TAB_SAFE_SCROLL_BOTTOM,
    gap: 12,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: "center",
  },
  growthCard: {
    backgroundColor: "rgba(10, 14, 25, 0.92)",
    borderColor: "rgba(140, 226, 90, 0.22)",
  },
  growthTitle: {
    color: "#9CE770",
    fontSize: 44,
    lineHeight: 52,
    letterSpacing: -0.9,
  },
  headlineRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  leadsValue: {
    fontSize: 72,
    lineHeight: 74,
  },
  leadsLabel: {
    fontSize: 22,
    lineHeight: 30,
    marginBottom: 10,
  },
  monthText: {
    fontSize: 22,
    lineHeight: 28,
  },
  cplText: {
    marginTop: 6,
    color: "rgba(237,237,238,0.92)",
    fontSize: 19,
    lineHeight: 24,
  },
  cplStrong: {
    fontFamily: realTheme.fonts.bodyBold,
    color: realTheme.colors.text,
  },
  graphWrap: {
    marginTop: 10,
    height: 160,
    borderRadius: 18,
    overflow: "hidden",
    backgroundColor: "rgba(13, 18, 26, 0.72)",
    position: "relative",
  },
  metricsStrip: {
    marginTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  metricsItem: {
    color: "rgba(237,237,238,0.96)",
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 18,
    lineHeight: 24,
  },
  metricsStrong: {
    color: "#97E768",
    fontFamily: realTheme.fonts.bodyBold,
  },
  metricsDivider: {
    color: "rgba(237,237,238,0.3)",
    fontSize: 22,
    lineHeight: 24,
  },
  sectionHeader: {
    marginTop: 2,
    paddingHorizontal: 4,
  },
  cardsRow: {
    gap: 10,
    paddingRight: 6,
  },
  performanceCard: {
    width: 170,
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(12,14,21,0.92)",
  },
  performanceImage: {
    height: 120,
  },
  performanceImageStyle: {
    resizeMode: "cover",
  },
  performanceBody: {
    padding: 12,
    gap: 10,
  },
  performanceTitle: {
    fontSize: 18,
    lineHeight: 24,
  },
  statusPill: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  runningPill: {
    backgroundColor: "rgba(155, 231, 104, 0.95)",
  },
  testingPill: {
    backgroundColor: "rgba(231, 197, 84, 0.94)",
  },
  statusRunningText: {
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 13,
    lineHeight: 18,
    color: "#102202",
  },
  statusTestingText: {
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 13,
    lineHeight: 18,
    color: "#2A2102",
  },
  linkText: {
    color: "#9CE770",
    fontSize: 18,
    lineHeight: 23,
  },
  suggestionCard: {
    backgroundColor: "rgba(12,14,22,0.94)",
    borderColor: "rgba(255,255,255,0.08)",
    gap: 8,
  },
  suggestionLead: {
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 22,
    lineHeight: 29,
  },
  suggestionBody: {
    color: "rgba(237,237,238,0.92)",
    fontSize: 20,
    lineHeight: 28,
    marginBottom: 4,
  },
});
