import { router } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useQueue } from "../../src/queue/QueueProvider";
import type { Deliverable, Order, OrderDetail, OrderEvent, OrderStatus } from "../../src/queue/types";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";
import { StatusPill } from "../../src/ui/components/StatusPill";

const TAB_SAFE_SCROLL_BOTTOM = 120;

type ChatMessage = {
  id: string;
  ts: string;
  text: string;
};

function deliverableLabel(type: Deliverable["type"]): string {
  if (type === "copy") return "Copy";
  if (type === "creative") return "Criativo";
  if (type === "campaign_plan") return "Plano de campanha";
  if (type === "audience_summary") return "Resumo de público";
  if (type === "wireframe") return "Wireframe";
  if (type === "url_preview") return "Preview";
  if (type === "calendar") return "Calendário";
  if (type === "posts") return "Posts";
  if (type === "reels_script") return "Roteiro";
  return type;
}

function statusLine(status: OrderStatus): string {
  if (status === "queued") return "Pedido entrou na fila de produção.";
  if (status === "in_progress") return "Estamos produzindo sua entrega agora.";
  if (status === "needs_info") return "Precisamos de uma informação para continuar.";
  if (status === "needs_approval") return "Há item aguardando sua aprovação no pedido.";
  if (status === "done") return "Pedido concluído com sucesso.";
  if (status === "failed") return "Tivemos um erro e o time já foi acionado.";
  if (status === "blocked") return "Pedido pausado temporariamente.";
  if (status === "waiting_payment") return "Aguardando ativação do plano.";
  return "Pedido salvo como rascunho.";
}

function buildMessages(order: Order, detail: OrderDetail): ChatMessage[] {
  const fromEvents: ChatMessage[] = detail.events
    .filter((event) => event.actor === "codex" || event.actor === "ops")
    .map((event: OrderEvent) => ({
      id: `ev_${event.id}`,
      ts: event.ts,
      text: event.message,
    }));

  const fromDeliverables: ChatMessage[] = detail.deliverables.map((deliverable) => ({
    id: `dlv_${deliverable.id}`,
    ts: deliverable.updatedAt,
    text: `Entrega pronta: ${deliverableLabel(deliverable.type)}.`,
  }));

  const syntheticStatus: ChatMessage = {
    id: `status_${order.id}_${order.updatedAt}`,
    ts: order.updatedAt,
    text: statusLine(order.status),
  };

  const merged = [...fromEvents, ...fromDeliverables, syntheticStatus].sort((a, b) => a.ts.localeCompare(b.ts));
  const unique = new Map<string, ChatMessage>();
  for (const item of merged) {
    const key = `${item.ts}_${item.text}`;
    if (!unique.has(key)) unique.set(key, item);
  }

  return [...unique.values()].slice(-6);
}

function relativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "agora";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function DeliveriesTab() {
  const queue = useQueue();

  const orders = [...queue.orders].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollIndicatorInsets={{ bottom: TAB_SAFE_SCROLL_BOTTOM }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.headerWrap}>
          <Text style={styles.title}>Entregas</Text>
          <Text style={styles.subtitle}>Canal da Real com atualizações e materiais prontos.</Text>
        </View>

        {orders.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Sem mensagens por enquanto</Text>
            <Text style={styles.emptyText}>Quando algo ficar pronto, aparece aqui no formato de chat.</Text>
          </View>
        ) : (
          <View style={styles.threads}>
            {orders.map((order) => {
              const detail = queue.getOrder(order.id);
              if (!detail) return null;
              const messages = buildMessages(order, detail);

              return (
                <TouchableOpacity key={order.id} activeOpacity={0.92} style={styles.threadCard} onPress={() => router.push(`/orders/${order.id}`)}>
                  <View style={styles.threadTop}>
                    <View style={styles.threadMeta}>
                      <Text style={styles.threadTitle}>{order.title}</Text>
                      <Text style={styles.threadSummary}>{order.summary}</Text>
                    </View>
                    <StatusPill status={order.status} />
                  </View>

                  <View style={styles.chatWrap}>
                    {messages.map((message) => (
                      <View key={message.id} style={styles.messageRow}>
                        <View style={styles.avatar}>
                          <Text style={styles.avatarText}>R</Text>
                        </View>
                        <View style={styles.bubbleWrap}>
                          <View style={styles.bubble}>
                            <Text style={styles.bubbleText}>{message.text}</Text>
                          </View>
                          <Text style={styles.time}>{relativeDate(message.ts)}</Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  <Text style={styles.openThread}>Abrir pedido</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: TAB_SAFE_SCROLL_BOTTOM,
    gap: 12,
  },
  headerWrap: {
    gap: 2,
    paddingHorizontal: 4,
  },
  title: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.4,
  },
  subtitle: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 14,
    lineHeight: 20,
  },
  emptyState: {
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    borderRadius: realTheme.radius.md,
    backgroundColor: "rgba(10,12,16,0.56)",
    paddingVertical: 16,
    paddingHorizontal: 14,
    gap: 4,
  },
  emptyTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 16,
  },
  emptyText: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 13,
  },
  threads: {
    gap: 12,
  },
  threadCard: {
    borderWidth: 1,
    borderColor: "rgba(163,214,149,0.28)",
    borderRadius: 18,
    backgroundColor: "rgba(8,11,14,0.68)",
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  threadTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  threadMeta: {
    flex: 1,
    gap: 1,
  },
  threadTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 16,
    lineHeight: 22,
  },
  threadSummary: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 12,
    lineHeight: 16,
  },
  chatWrap: {
    gap: 7,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(53,226,20,0.22)",
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.4)",
    marginBottom: 14,
  },
  avatarText: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 12,
  },
  bubbleWrap: {
    flex: 1,
    gap: 3,
  },
  bubble: {
    alignSelf: "flex-start",
    maxWidth: "96%",
    borderWidth: 1,
    borderColor: "rgba(205,217,238,0.2)",
    borderRadius: 14,
    borderBottomLeftRadius: 6,
    paddingVertical: 9,
    paddingHorizontal: 10,
    backgroundColor: "rgba(18,24,30,0.86)",
  },
  bubbleText: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  time: {
    color: "rgba(166,173,185,0.8)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 11,
    marginLeft: 2,
  },
  openThread: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
});
