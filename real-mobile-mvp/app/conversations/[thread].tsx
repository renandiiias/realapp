import AsyncStorage from "@react-native-async-storage/async-storage";
import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useQueue } from "../../src/queue/QueueProvider";
import { buildThreads, DELIVERIES_LAST_SEEN_KEY, PROFESSIONAL_THREADS, relativeDate } from "../../src/services/deliveriesChat";
import { sendQueueClientLog } from "../../src/services/queueDebugLog";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";
import { StatusPill } from "../../src/ui/components/StatusPill";

const TAB_SAFE_SCROLL_BOTTOM = 120;

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ thread?: string }>();
  const threadId = typeof params.thread === "string" ? params.thread : "";
  const queue = useQueue();

  const queueApiBaseUrl = (process.env.EXPO_PUBLIC_QUEUE_API_BASE_URL || "").trim();
  const traceId = useMemo(() => `conversation_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`, []);

  const threads = useMemo(() => {
    return buildThreads({
      orders: queue.orders,
      getOrder: queue.getOrder,
      lastSeenByThread: {},
    });
  }, [queue.getOrder, queue.orders]);

  const thread = threads.find((t) => t.thread.id === threadId);
  const professional = PROFESSIONAL_THREADS.find((t) => t.id === threadId);

  useEffect(() => {
    if (!thread) return;
    if (thread.lastTs) {
      const markSeen = async () => {
        try {
          const raw = await AsyncStorage.getItem(DELIVERIES_LAST_SEEN_KEY);
          const seen = raw ? (JSON.parse(raw) as Record<string, string>) : {};
          const next = { ...seen, [thread.thread.id]: thread.lastTs };
          await AsyncStorage.setItem(DELIVERIES_LAST_SEEN_KEY, JSON.stringify(next));
        } catch {
          // noop
        }
      };
      void markSeen();
    }

    if (queueApiBaseUrl) {
      void sendQueueClientLog({
        baseUrl: queueApiBaseUrl,
        traceId,
        stage: "deliveries_conversation",
        event: "screen_opened",
        meta: {
          threadId: thread.thread.id,
          messageCount: thread.messages.length,
          orderCount: thread.orders.length,
        },
      });
    }
  }, [queueApiBaseUrl, thread, traceId]);

  const openExternal = async (url: string, intent: "preview" | "download") => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert("Não consegui abrir", "Esse link não está disponível agora.");
        return;
      }
      await Linking.openURL(url);

      if (queueApiBaseUrl && threadId) {
        void sendQueueClientLog({
          baseUrl: queueApiBaseUrl,
          traceId,
          stage: "deliveries_conversation",
          event: "attachment_opened",
          meta: { threadId, intent, url },
        });
      }
    } catch (error) {
      if (queueApiBaseUrl && threadId) {
        void sendQueueClientLog({
          baseUrl: queueApiBaseUrl,
          traceId,
          stage: "deliveries_conversation",
          event: "attachment_open_failed",
          level: "error",
          meta: {
            threadId,
            intent,
            url,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
      Alert.alert("Erro ao abrir", "Tenta novamente em alguns segundos.");
    }
  };

  if (!professional) {
    return (
      <Screen>
        <View style={styles.fallbackWrap}>
          <Text style={styles.fallbackTitle}>Conversa não encontrada</Text>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Text style={styles.backBtnText}>Voltar</Text>
          </TouchableOpacity>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} scrollIndicatorInsets={{ bottom: TAB_SAFE_SCROLL_BOTTOM }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtnInline}>
            <Text style={styles.backBtnText}>Voltar</Text>
          </TouchableOpacity>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{professional.avatar}</Text>
          </View>
          <View style={styles.headerText}>
            <Text style={styles.name}>{professional.name}</Text>
            <Text style={styles.role}>{professional.role}</Text>
          </View>
        </View>

        {!thread || thread.messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>Sem conversa ainda</Text>
            <Text style={styles.emptyText}>Quando você enviar um serviço desse profissional, as mensagens aparecem aqui.</Text>
          </View>
        ) : (
          <>
            <View style={styles.chatWrap}>
              {thread.messages.map((message) => {
                const fromClient = message.actor === "client";
                return (
                  <View key={message.id} style={[styles.messageRow, fromClient && styles.messageRowClient]}>
                    <View style={[styles.bubble, fromClient ? styles.bubbleClient : styles.bubblePro]}>
                      <Text style={styles.orderHint}>{message.orderTitle}</Text>
                      <Text style={styles.bubbleText}>{message.text}</Text>

                      {message.attachment ? (
                        <View style={styles.attachmentActions}>
                          <TouchableOpacity style={styles.attachmentBtn} onPress={() => void openExternal(message.attachment!.url, "preview")}>
                            <Text style={styles.attachmentBtnText}>{message.attachment.ctaPreview}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.attachmentBtnSecondary} onPress={() => void openExternal(message.attachment!.url, "download")}>
                            <Text style={styles.attachmentBtnText}>{message.attachment.ctaDownload}</Text>
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                    <Text style={styles.time}>{relativeDate(message.ts)}</Text>
                  </View>
                );
              })}
            </View>

            <View style={styles.detailsWrap}>
              <Text style={styles.detailsTitle}>Detalhes dos jobs</Text>
              {thread.orders.map((order) => (
                <View key={order.id} style={styles.detailCard}>
                  <View style={styles.detailTop}>
                    <Text style={styles.detailTitle}>{order.title}</Text>
                    <StatusPill status={order.status} />
                  </View>
                  <Text style={styles.detailSummary}>{order.summary}</Text>
                </View>
              ))}
            </View>
          </>
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
  fallbackWrap: {
    paddingVertical: 28,
    gap: 12,
    alignItems: "flex-start",
  },
  fallbackTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "rgba(205,217,238,0.2)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(8,11,14,0.72)",
  },
  backBtnInline: {
    paddingRight: 2,
    paddingVertical: 4,
  },
  backBtn: {
    borderWidth: 1,
    borderColor: "rgba(205,217,238,0.28)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  backBtnText: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 13,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(53,226,20,0.18)",
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.35)",
  },
  avatarText: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 14,
  },
  headerText: {
    flex: 1,
    gap: 1,
  },
  name: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 16,
  },
  role: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 12,
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
  chatWrap: {
    gap: 8,
  },
  messageRow: {
    alignItems: "flex-start",
    gap: 4,
  },
  messageRowClient: {
    alignItems: "flex-end",
  },
  bubble: {
    maxWidth: "88%",
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: 10,
    gap: 6,
  },
  bubblePro: {
    borderColor: "rgba(205,217,238,0.2)",
    borderBottomLeftRadius: 6,
    backgroundColor: "rgba(18,24,30,0.86)",
  },
  bubbleClient: {
    borderColor: "rgba(53,226,20,0.32)",
    borderBottomRightRadius: 6,
    backgroundColor: "rgba(18,44,20,0.72)",
  },
  bubbleText: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  orderHint: {
    color: "rgba(166,173,185,0.9)",
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 10,
    textTransform: "uppercase",
  },
  time: {
    color: "rgba(166,173,185,0.8)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 11,
  },
  attachmentActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  attachmentBtn: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(53,226,20,0.24)",
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.42)",
  },
  attachmentBtnSecondary: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(205,217,238,0.18)",
    borderWidth: 1,
    borderColor: "rgba(205,217,238,0.24)",
  },
  attachmentBtnText: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 12,
  },
  detailsWrap: {
    marginTop: 6,
    gap: 8,
  },
  detailsTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 15,
  },
  detailCard: {
    borderWidth: 1,
    borderColor: "rgba(205,217,238,0.2)",
    borderRadius: 12,
    backgroundColor: "rgba(8,11,14,0.68)",
    paddingVertical: 10,
    paddingHorizontal: 10,
    gap: 5,
  },
  detailTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  detailTitle: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 14,
    flex: 1,
  },
  detailSummary: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 12,
  },
});
