import { router } from "expo-router";
import { ScrollView, StyleSheet, TouchableOpacity, View } from "react-native";
import { useQueue } from "../../src/queue/QueueProvider";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Screen } from "../../src/ui/components/Screen";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";
import { StatusPill } from "../../src/ui/components/StatusPill";

function deliverableLabel(type: string): string {
  if (type === "copy") return "Copy";
  if (type === "creative") return "Criativo";
  return type;
}
const TAB_SAFE_SCROLL_BOTTOM = 120;

export default function Approvals() {
  const queue = useQueue();
  const items = queue.listPendingApprovals();

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        scrollIndicatorInsets={{ bottom: TAB_SAFE_SCROLL_BOTTOM }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <Card>
          <Kicker>Revisão</Kicker>
          <Title>Aprovações</Title>
          <Body>Somente copy/criativo. O resto a Real executa sem te travar.</Body>
        </Card>

        <Card>
          <SubTitle>Pendentes ({items.length})</SubTitle>
          {items.length === 0 ? (
            <Body>Nada pra aprovar agora.</Body>
          ) : (
            <View style={styles.list}>
              {items.map(({ order, deliverable }) => (
                <View key={deliverable.id} style={styles.item}>
                  <TouchableOpacity
                    activeOpacity={0.9}
                    style={styles.itemTop}
                    onPress={() => router.push(`/orders/${order.id}`)}
                  >
                    <View style={styles.itemLeft}>
                      <SubTitle style={styles.itemTitle}>{order.title}</SubTitle>
                      <Body style={styles.itemMeta}>{deliverableLabel(deliverable.type)}</Body>
                    </View>
                    <StatusPill status={order.status} />
                  </TouchableOpacity>
                  <View style={styles.actions}>
                    <Button
                      label="Aprovar"
                      onPress={() => queue.setApproval(deliverable.id, { status: "approved" })}
                      style={styles.action}
                    />
                    <Button
                      label="Pedir ajuste"
                      variant="secondary"
                      onPress={() =>
                        queue.setApproval(deliverable.id, {
                          status: "changes_requested",
                          feedback: "Ajustar conforme briefing.",
                        })
                      }
                      style={styles.action}
                    />
                  </View>
                </View>
              ))}
            </View>
          )}
        </Card>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: TAB_SAFE_SCROLL_BOTTOM,
    gap: 14,
  },
  list: {
    gap: 12,
  },
  item: {
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: realTheme.colors.panelSoft,
    borderRadius: realTheme.radius.md,
    padding: 12,
    gap: 10,
  },
  itemTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
  },
  itemLeft: {
    flex: 1,
    gap: 2,
  },
  itemTitle: {
    fontSize: 16,
  },
  itemMeta: {
    color: realTheme.colors.muted,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  action: {
    flex: 1,
  },
});
