import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useQueue } from "../../src/queue/QueueProvider";
import { buildThreads, DELIVERIES_LAST_SEEN_KEY, relativeDate } from "../../src/services/deliveriesChat";
import { sendQueueClientLog } from "../../src/services/queueDebugLog";
import { realTheme } from "../../src/theme/realTheme";
import { Screen } from "../../src/ui/components/Screen";

const TAB_SAFE_SCROLL_BOTTOM = 120;

export default function DeliveriesTab() {
  const queue = useQueue();
  const [lastSeenByThread, setLastSeenByThread] = useState<Record<string, string>>({});
  const queueApiBaseUrl = (process.env.EXPO_PUBLIC_QUEUE_API_BASE_URL || "").trim();
  const traceId = useMemo(() => `deliveries_list_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`, []);

  useEffect(() => {
    let mounted = true;
    const loadSeen = async () => {
      try {
        const raw = await AsyncStorage.getItem(DELIVERIES_LAST_SEEN_KEY);
        if (!raw || !mounted) return;
        const parsed = JSON.parse(raw) as Record<string, string>;
        if (parsed && typeof parsed === "object") setLastSeenByThread(parsed);
      } catch {
        // noop
      }
    };
    void loadSeen();
    return () => {
      mounted = false;
    };
  }, []);

  const threads = useMemo(() => {
    return buildThreads({
      orders: queue.orders,
      getOrder: queue.getOrder,
      lastSeenByThread,
    });
  }, [lastSeenByThread, queue.getOrder, queue.orders]);

  useEffect(() => {
    if (!queueApiBaseUrl) return;
    void sendQueueClientLog({
      baseUrl: queueApiBaseUrl,
      traceId,
      stage: "deliveries_whatsapp_list",
      event: "screen_opened",
      meta: {
        orderCount: queue.orders.length,
        threadUnread: Object.fromEntries(threads.map((t) => [t.thread.id, t.unreadCount])),
      },
    });
  }, [queue.orders.length, queueApiBaseUrl, threads, traceId]);

  const openThread = async (threadId: string, lastTs: string) => {
    if (lastTs) {
      const next = { ...lastSeenByThread, [threadId]: lastTs };
      setLastSeenByThread(next);
      await AsyncStorage.setItem(DELIVERIES_LAST_SEEN_KEY, JSON.stringify(next));
    }

    if (queueApiBaseUrl) {
      void sendQueueClientLog({
        baseUrl: queueApiBaseUrl,
        traceId,
        stage: "deliveries_whatsapp_list",
        event: "thread_opened",
        meta: { threadId, lastTs },
      });
    }

    router.push(`/conversations/${threadId}`);
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollIndicatorInsets={{ bottom: TAB_SAFE_SCROLL_BOTTOM }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.listWrap}>
          {threads.map((item) => (
            <TouchableOpacity key={item.thread.id} activeOpacity={0.9} style={styles.row} onPress={() => void openThread(item.thread.id, item.lastTs)}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{item.thread.avatar}</Text>
              </View>

              <View style={styles.mainCol}>
                <View style={styles.topLine}>
                  <Text numberOfLines={1} style={styles.name}>
                    {item.thread.name}
                  </Text>
                  <Text style={styles.date}>{item.lastTs ? relativeDate(item.lastTs) : ""}</Text>
                </View>
                <View style={styles.bottomLine}>
                  <Text numberOfLines={1} style={styles.preview}>
                    {item.previewText}
                  </Text>
                  {item.unreadCount > 0 ? (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{item.unreadCount > 99 ? "99+" : item.unreadCount}</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: TAB_SAFE_SCROLL_BOTTOM,
    justifyContent: "center",
    minHeight: "100%",
  },
  listWrap: {
    gap: 0,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(205,217,238,0.2)",
    backgroundColor: "rgba(8,11,14,0.72)",
    overflow: "hidden",
    alignSelf: "center",
    width: "100%",
    maxWidth: 560,
  },
  row: {
    minHeight: 82,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(205,217,238,0.13)",
  },
  avatar: {
    width: 54,
    height: 54,
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
    fontSize: 15,
  },
  mainCol: {
    flex: 1,
    gap: 3,
  },
  topLine: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  name: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyBold,
    fontSize: 16,
    flex: 1,
  },
  date: {
    color: "rgba(166,173,185,0.82)",
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 11,
  },
  bottomLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  preview: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
    flex: 1,
  },
  badge: {
    minWidth: 20,
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
    fontSize: 10,
  },
});
