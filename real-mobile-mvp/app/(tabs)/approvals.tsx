import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useQueue } from "../../src/queue/QueueProvider";
import type { Deliverable, Order, OrderDetail, OrderEvent, OrderType } from "../../src/queue/types";
import { sendQueueClientLog } from "../../src/services/queueDebugLog";
import { buildVideoDeliverableSummary } from "../../src/services/videoEditorPresenter";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";
import { StatusPill } from "../../src/ui/components/StatusPill";

const TAB_SAFE_SCROLL_BOTTOM = 120;
const LAST_SEEN_KEY = "real:deliveries:thread_seen:v2";

type ProfessionalThread = {
  id: "ads" | "site" | "video_editor";
  name: string;
  role: string;
  avatar: string;
  type: OrderType;
};

type ThreadMessage = {
  id: string;
  ts: string;
  actor: "client" | "professional" | "system";
  text: string;
  orderId: string;
  attachment?: {
    kind: "video" | "site";
    url: string;
    ctaPreview: string;
    ctaDownload: string;
  };
};

type ThreadData = {
  thread: ProfessionalThread;
  orders: Order[];
  messages: ThreadMessage[];
  lastTs: string;
  previewText: string;
  unreadCount: number;
};

const PROFESSIONAL_THREADS: ProfessionalThread[] = [
  {
    id: "ads",
    name: "Gestor de Tráfego",
    role: "Anúncios e campanhas",
    avatar: "GT",
    type: "ads",
  },
  {
    id: "site",
    name: "Desenvolvedor de Sites",
    role: "Landing pages e site",
    avatar: "DS",
    type: "site",
  },
  {
    id: "video_editor",
    name: "Editor de Vídeo",
    role: "Edição e finalização",
    avatar: "EV",
    type: "video_editor",
  },
];

function deliverableLabel(type: Deliverable["type"]): string {
  if (type === "copy") return "copy";
  if (type === "creative") return "criativo";
  if (type === "campaign_plan") return "plano de campanha";
  if (type === "audience_summary") return "resumo de público";
  if (type === "wireframe") return "wireframe";
  if (type === "url_preview") return "preview";
  if (type === "calendar") return "calendário";
  if (type === "posts") return "posts";
  if (type === "reels_script") return "roteiro";
  return type;
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

function isLikelyVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(mp4|mov)(?:[?#]|$)/.test(lower) || lower.includes("/media/storage/output/");
}

function normalizeVideoUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const publicBase = (process.env.EXPO_PUBLIC_VIDEO_EDITOR_API_BASE_URL || "").replace(/\/+$/, "");

  if (/^https?:\/\//.test(value)) {
    if (/^https?:\/\/preview\.real\.local(\/|$)/i.test(value) && publicBase) {
      return value.replace(/^https?:\/\/preview\.real\.local/i, publicBase);
    }
    return value;
  }

  if (value.startsWith("/media/storage/") && publicBase) {
    return `${publicBase}${value}`;
  }

  return null;
}

function extractVideoUrl(deliverable: Deliverable): string | null {
  const content = deliverable.content;
  const contentIsVideo =
    content && typeof content === "object" && !Array.isArray(content) && String((content as { kind?: unknown }).kind || "") === "video";

  if (typeof content === "string") {
    const normalized = normalizeVideoUrl(content);
    if (normalized && isLikelyVideoUrl(normalized)) return normalized;
  }
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const maybe = (content as { outputUrl?: unknown }).outputUrl;
    if (typeof maybe === "string") {
      const normalized = normalizeVideoUrl(maybe);
      if (normalized && (isLikelyVideoUrl(normalized) || contentIsVideo)) return normalized;
    }
  }
  for (const asset of deliverable.assetUrls) {
    const normalized = normalizeVideoUrl(asset);
    if (normalized && isLikelyVideoUrl(normalized)) return normalized;
  }
  return null;
}

function normalizeSiteUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  return null;
}

function extractSiteUrl(detail: OrderDetail, deliverable: Deliverable): string | null {
  if (detail.type !== "site" || deliverable.type !== "url_preview") return null;
  const content = deliverable.content;
  if (typeof content === "string") {
    const fromString = normalizeSiteUrl(content);
    if (fromString) return fromString;
  }
  if (content && typeof content === "object" && !Array.isArray(content)) {
    const maybeContent = content as {
      publicUrl?: unknown;
      previewUrl?: unknown;
      url?: unknown;
    };
    for (const candidate of [maybeContent.publicUrl, maybeContent.previewUrl, maybeContent.url]) {
      if (typeof candidate === "string") {
        const normalized = normalizeSiteUrl(candidate);
        if (normalized) return normalized;
      }
    }
  }
  for (const item of deliverable.assetUrls) {
    const normalized = normalizeSiteUrl(item);
    if (normalized) return normalized;
  }

  const publication = detail.sitePublication;
  if (typeof publication?.publicUrl === "string" && publication.publicUrl.trim()) return publication.publicUrl.trim();
  if (typeof publication?.previewUrl === "string" && publication.previewUrl.trim()) return publication.previewUrl.trim();
  return null;
}

function buildThreadMessages(order: Order, detail: OrderDetail): ThreadMessage[] {
  const clientPrompt: ThreadMessage = {
    id: `client_${order.id}`,
    ts: order.createdAt,
    actor: "client",
    orderId: order.id,
    text: `${order.title}. ${order.summary}`,
  };

  const fromEvents: ThreadMessage[] = detail.events
    .filter((event: OrderEvent) => event.actor === "codex" || event.actor === "ops" || event.actor === "client")
    .map((event) => ({
      id: `ev_${event.id}`,
      ts: event.ts,
      actor: event.actor === "client" ? "client" : "professional",
      orderId: order.id,
      text: event.message,
    }));

  const fromDeliverables: ThreadMessage[] = detail.deliverables.map((deliverable) => {
    const base: ThreadMessage = {
      id: `dlv_${deliverable.id}`,
      ts: deliverable.updatedAt,
      actor: "professional",
      orderId: order.id,
      text: `Entreguei ${deliverableLabel(deliverable.type)} para você revisar.`,
    };

    const videoUrl = deliverable.type === "url_preview" ? extractVideoUrl(deliverable) : null;
    if (videoUrl) {
      return {
        ...base,
        text: buildVideoDeliverableSummary(deliverable.content),
        attachment: {
          kind: "video",
          url: videoUrl,
          ctaPreview: "Preview",
          ctaDownload: "Baixar",
        },
      };
    }

    const siteUrl = extractSiteUrl(detail, deliverable);
    if (siteUrl) {
      return {
        ...base,
        attachment: {
          kind: "site",
          url: siteUrl,
          ctaPreview: "Abrir site",
          ctaDownload: "Abrir em nova aba",
        },
      };
    }

    return base;
  });

  const merged = [clientPrompt, ...fromEvents, ...fromDeliverables].sort((a, b) => a.ts.localeCompare(b.ts));
  const unique = new Map<string, ThreadMessage>();
  for (const item of merged) {
    const key = `${item.ts}_${item.text}_${item.actor}_${item.orderId}`;
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function calcUnread(messages: ThreadMessage[], seenTs: string | undefined): number {
  if (!seenTs) {
    return messages.filter((m) => m.actor !== "client").length;
  }
  return messages.filter((m) => m.actor !== "client" && m.ts > seenTs).length;
}

export default function DeliveriesTab() {
  const queue = useQueue();
  const [selectedThreadId, setSelectedThreadId] = useState<ProfessionalThread["id"]>("ads");
  const [lastSeenByThread, setLastSeenByThread] = useState<Record<string, string>>({});

  const queueApiBaseUrl = (process.env.EXPO_PUBLIC_QUEUE_API_BASE_URL || "").trim();
  const traceId = useMemo(() => `deliveries_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`, []);

  const logClientEvent = useCallback(
    (event: string, meta?: Record<string, unknown>, level: "info" | "warn" | "error" = "info") => {
      if (!queueApiBaseUrl) return;
      void sendQueueClientLog({
        baseUrl: queueApiBaseUrl,
        traceId,
        stage: "deliveries_inbox",
        event,
        level,
        meta,
      });
    },
    [queueApiBaseUrl, traceId],
  );

  useEffect(() => {
    let mounted = true;
    const loadSeen = async () => {
      try {
        const raw = await AsyncStorage.getItem(LAST_SEEN_KEY);
        if (!raw || !mounted) return;
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (parsed && typeof parsed === "object") {
          setLastSeenByThread(parsed);
        }
      } catch {
        // noop
      }
    };
    void loadSeen();
    return () => {
      mounted = false;
    };
  }, []);

  const markThreadSeen = useCallback(async (threadId: string, ts: string) => {
    setLastSeenByThread((prev) => {
      const next = { ...prev, [threadId]: ts };
      void AsyncStorage.setItem(LAST_SEEN_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const threads = useMemo<ThreadData[]>(() => {
    const orders = [...queue.orders].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return PROFESSIONAL_THREADS.map((thread) => {
      const typeOrders = orders.filter((order) => order.type === thread.type);
      const messages = typeOrders
        .flatMap((order) => {
          const detail = queue.getOrder(order.id);
          if (!detail) return [];
          return buildThreadMessages(order, detail);
        })
        .sort((a, b) => a.ts.localeCompare(b.ts));

      const lastMessage = messages[messages.length - 1];
      const lastTs = lastMessage?.ts || "";
      const previewText = lastMessage?.text || "Assim que você pedir um serviço, a conversa aparece aqui.";
      const unreadCount = calcUnread(messages, lastSeenByThread[thread.id]);

      return {
        thread,
        orders: typeOrders,
        messages,
        lastTs,
        previewText,
        unreadCount,
      };
    });
  }, [lastSeenByThread, queue]);

  useEffect(() => {
    logClientEvent("screen_opened", {
      totalOrders: queue.orders.length,
      threadCounts: Object.fromEntries(threads.map((item) => [item.thread.id, item.orders.length])),
    });
  }, [logClientEvent, queue.orders.length, threads]);

  const selectedThread = threads.find((thread) => thread.thread.id === selectedThreadId) ?? threads[0];

  const openThread = async (thread: ThreadData) => {
    setSelectedThreadId(thread.thread.id);
    if (thread.lastTs) {
      await markThreadSeen(thread.thread.id, thread.lastTs);
    }
    logClientEvent("thread_opened", {
      threadId: thread.thread.id,
      name: thread.thread.name,
      unreadCount: thread.unreadCount,
      messageCount: thread.messages.length,
    });
  };

  const openExternal = async (url: string, intent: "preview" | "download", threadId: string) => {
    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert("Não consegui abrir", "Esse link não está disponível agora.");
        logClientEvent("attachment_open_failed", { threadId, intent, reason: "cannot_open", url }, "warn");
        return;
      }
      await Linking.openURL(url);
      logClientEvent("attachment_opened", { threadId, intent, url });
    } catch (error) {
      const err = error instanceof Error ? error.message : String(error);
      logClientEvent("attachment_open_failed", { threadId, intent, error: err, url }, "error");
      Alert.alert("Erro ao abrir", "Tenta novamente em alguns segundos.");
    }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollIndicatorInsets={{ bottom: TAB_SAFE_SCROLL_BOTTOM }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.inboxList}>
          {threads.map((item) => {
            const isSelected = selectedThread.thread.id === item.thread.id;
            return (
              <TouchableOpacity key={item.thread.id} activeOpacity={0.92} style={[styles.threadCard, isSelected && styles.threadCardActive]} onPress={() => void openThread(item)}>
                <View style={styles.threadHeader}>
                  <View style={styles.threadIdentityWrap}>
                    <View style={styles.threadAvatar}>
                      <Text style={styles.threadAvatarText}>{item.thread.avatar}</Text>
                    </View>
                    <View style={styles.threadIdentityText}>
                      <Text style={styles.threadName}>{item.thread.name}</Text>
                      <Text style={styles.threadRole}>{item.thread.role}</Text>
                    </View>
                  </View>
                  <View style={styles.threadRight}>
                    {item.lastTs ? <Text style={styles.threadTime}>{relativeDate(item.lastTs)}</Text> : null}
                    {item.unreadCount > 0 ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <Text numberOfLines={2} style={styles.threadPreview}>
                  {item.previewText}
                </Text>
                {item.orders[0] ? (
                  <View style={styles.threadMetaRow}>
                    <StatusPill status={item.orders[0].status} />
                    <TouchableOpacity onPress={() => router.push(`/orders/${item.orders[0]?.id}`)}>
                      <Text style={styles.openThread}>Abrir último pedido</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <Text style={styles.emptyThreadHint}>Nenhum pedido enviado ainda.</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        <View style={styles.chatPanel}>
          <View style={styles.chatPanelHeader}>
            <View style={styles.threadAvatarLarge}>
              <Text style={styles.threadAvatarText}>{selectedThread.thread.avatar}</Text>
            </View>
            <View style={styles.chatPanelHeaderText}>
              <Text style={styles.threadName}>{selectedThread.thread.name}</Text>
              <Text style={styles.chatPanelSub}>Conversa automática com atualizações das entregas.</Text>
            </View>
          </View>

          {selectedThread.messages.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Conversa vazia por enquanto</Text>
              <Text style={styles.emptyText}>Quando você enviar um serviço, a conversa desse profissional aparece aqui automaticamente.</Text>
            </View>
          ) : (
            <View style={styles.chatWrap}>
              {selectedThread.messages.slice(-14).map((message) => {
                const fromClient = message.actor === "client";
                return (
                  <View key={message.id} style={[styles.messageRow, fromClient && styles.messageRowClient]}>
                    {!fromClient ? (
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>{selectedThread.thread.avatar}</Text>
                      </View>
                    ) : null}
                    <View style={[styles.bubbleWrap, fromClient && styles.bubbleWrapClient]}>
                      <View style={[styles.bubble, fromClient ? styles.bubbleClient : styles.bubblePro]}>
                        <Text style={styles.bubbleText}>{message.text}</Text>

                        {message.attachment ? (
                          <View style={styles.attachmentActions}>
                            <TouchableOpacity
                              activeOpacity={0.88}
                              style={styles.attachmentBtn}
                              onPress={() => void openExternal(message.attachment!.url, "preview", selectedThread.thread.id)}
                            >
                              <Text style={styles.attachmentBtnText}>{message.attachment.ctaPreview}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                              activeOpacity={0.88}
                              style={styles.attachmentBtnSecondary}
                              onPress={() => void openExternal(message.attachment!.url, "download", selectedThread.thread.id)}
                            >
                              <Text style={styles.attachmentBtnText}>{message.attachment.ctaDownload}</Text>
                            </TouchableOpacity>
                          </View>
                        ) : null}
                      </View>
                      <Text style={[styles.time, fromClient && styles.timeClient]}>{relativeDate(message.ts)}</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: TAB_SAFE_SCROLL_BOTTOM,
    gap: 14,
  },
  inboxList: {
    gap: 10,
  },
  threadCard: {
    borderWidth: 1,
    borderColor: "rgba(205,217,238,0.2)",
    borderRadius: 18,
    backgroundColor: "rgba(10,12,16,0.68)",
    paddingVertical: 11,
    paddingHorizontal: 12,
    gap: 8,
  },
  threadCardActive: {
    borderColor: "rgba(53,226,20,0.35)",
    backgroundColor: "rgba(10,20,12,0.66)",
  },
  threadHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  threadIdentityWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flex: 1,
  },
  threadIdentityText: {
    flex: 1,
    gap: 1,
  },
  threadAvatar: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(53,226,20,0.18)",
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.35)",
  },
  threadAvatarLarge: {
    width: 44,
    height: 44,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(53,226,20,0.2)",
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.35)",
  },
  threadAvatarText: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 12,
  },
  threadName: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 15,
    lineHeight: 20,
  },
  threadRole: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 12,
  },
  threadRight: {
    alignItems: "flex-end",
    gap: 4,
  },
  threadTime: {
    color: "rgba(166,173,185,0.82)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 11,
  },
  badge: {
    minWidth: 22,
    borderRadius: 999,
    backgroundColor: realTheme.colors.green,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: "#081009",
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 11,
  },
  threadPreview: {
    color: realTheme.colors.text,
    opacity: 0.9,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  threadMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  openThread: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 12,
  },
  emptyThreadHint: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 12,
  },
  chatPanel: {
    borderWidth: 1,
    borderColor: "rgba(53,226,20,0.24)",
    borderRadius: 20,
    backgroundColor: "rgba(8,11,14,0.68)",
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  chatPanelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(205,217,238,0.16)",
  },
  chatPanelHeaderText: {
    flex: 1,
    gap: 1,
  },
  chatPanelSub: {
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
    gap: 7,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  messageRowClient: {
    justifyContent: "flex-end",
  },
  avatar: {
    width: 26,
    height: 26,
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
    fontSize: 11,
  },
  bubbleWrap: {
    maxWidth: "88%",
    gap: 3,
  },
  bubbleWrapClient: {
    alignItems: "flex-end",
  },
  bubble: {
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 10,
    gap: 8,
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
  time: {
    color: "rgba(166,173,185,0.8)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 11,
    marginLeft: 2,
  },
  timeClient: {
    marginRight: 2,
  },
  attachmentActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
});
