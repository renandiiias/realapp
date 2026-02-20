import { router, useLocalSearchParams } from "expo-router";
import { ResizeMode, Video } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, View } from "react-native";
import { useAuth } from "../../src/auth/AuthProvider";
import { useQueue } from "../../src/queue/QueueProvider";
import type { Deliverable, DeliverableType, OrderDetail, OrderStatus } from "../../src/queue/types";
import { realTheme } from "../../src/theme/realTheme";
import { Button } from "../../src/ui/components/Button";
import { Card } from "../../src/ui/components/Card";
import { Field } from "../../src/ui/components/Field";
import { Screen } from "../../src/ui/components/Screen";
import { StatusPill } from "../../src/ui/components/StatusPill";
import { Body, Kicker, SubTitle, Title } from "../../src/ui/components/Typography";

function prettyJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

function prettyLinesFromPayload(payload: Record<string, unknown>): string[] {
  return Object.entries(payload)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value)}`);
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

function deliverableLabel(type: DeliverableType): string {
  if (type === "copy") return "Copy";
  if (type === "creative") return "Criativo";
  if (type === "campaign_plan") return "Plano de campanha";
  if (type === "audience_summary") return "Publico";
  if (type === "wireframe") return "Wireframe";
  if (type === "url_preview") return "Preview URL";
  if (type === "calendar") return "Calendario";
  if (type === "posts") return "Posts";
  if (type === "reels_script") return "Roteiro Reels";
  return type;
}

function statusHeadline(status: OrderStatus): string {
  if (status === "waiting_payment") return "Aguardando ativação";
  if (status === "queued") return "Preparando execução";
  if (status === "in_progress") return "Em produção";
  if (status === "needs_approval") return "Precisa da sua aprovacao";
  if (status === "needs_info") return "Aguardando info";
  if (status === "done") return "Concluido";
  if (status === "failed") return "Erro final";
  if (status === "blocked") return "Pausado";
  return "Rascunho";
}

function editPath(order: OrderDetail): string {
  if (order.type === "ads") return `/create/ads?orderId=${order.id}`;
  if (order.type === "site") return `/create/site?orderId=${order.id}`;
  if (order.type === "video_editor") return `/create/video-editor?orderId=${order.id}`;
  return `/create/content?orderId=${order.id}`;
}

export default function OrderDetailScreen() {
  const auth = useAuth();
  const queue = useQueue();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const orderId = Array.isArray(params.id) ? params.id[0] : params.id;
  const detail = orderId ? queue.getOrder(orderId) : null;

  const [info, setInfo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedbackByDeliverable, setFeedbackByDeliverable] = useState<Record<string, string>>({});
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [downloadingUrl, setDownloadingUrl] = useState<string | null>(null);

  const timeline = useMemo(() => {
    if (!detail) return [];
    return [...detail.events].sort((a, b) => a.ts.localeCompare(b.ts));
  }, [detail]);

  const deliverables = useMemo(() => {
    if (!detail) return [];
    return [...detail.deliverables].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [detail]);

  if (!orderId) {
    return (
      <Screen>
        <Card>
          <Title>Pedido inválido</Title>
        </Card>
      </Screen>
    );
  }

  if (!detail) {
    return (
      <Screen>
        <Card>
          <Title>Carregando...</Title>
        </Card>
      </Screen>
    );
  }

  const approvalsById = new Map(detail.approvals.map((a) => [a.deliverableId, a]));

  const approve = async (d: Deliverable) => {
    await queue.setApproval(d.id, { status: "approved" });
  };

  const requestChanges = async (d: Deliverable) => {
    const feedback = (feedbackByDeliverable[d.id] ?? "").trim() || "Ajustar conforme briefing.";
    await queue.setApproval(d.id, { status: "changes_requested", feedback });
  };

  const sendInfo = async () => {
    const msg = info.trim();
    if (!msg) return;
    await queue.postOrderInfo(detail.id, msg);
    setInfo("");
  };

  const submit = async () => {
    if (!auth.profileProductionComplete) {
      router.push({ pathname: "/onboarding/ray-x", params: { mode: "production", pendingOrderId: detail.id } });
      return;
    }
    await queue.submitOrder(detail.id);
  };

  const assertUrlReachable = async (videoUrl: string) => {
    const head = await fetch(videoUrl, { method: "HEAD" });
    if (head.ok) return;

    if (head.status === 405 || head.status === 501) {
      const probe = await fetch(videoUrl, {
        method: "GET",
        headers: { Range: "bytes=0-1" },
      });
      if (probe.ok || probe.status === 206) return;
      throw new Error(`Video indisponivel no servidor (HTTP ${probe.status}).`);
    }

    throw new Error(`Video indisponivel no servidor (HTTP ${head.status}).`);
  };

  const openViewer = async (videoUrl: string) => {
    try {
      setError(null);
      await assertUrlReachable(videoUrl);
      setViewerUrl(videoUrl);
    } catch (openError) {
      const message = openError instanceof Error ? openError.message : "Nao foi possivel abrir o video.";
      setError(message);
    }
  };

  const buildFileName = (videoUrl: string) => {
    const match = videoUrl.match(/\/([^/?#]+\.mp4)(?:[?#]|$)/i);
    if (match?.[1]) return match[1];
    return `video_${Date.now()}.mp4`;
  };

  const downloadInsideApp = async (videoUrl: string) => {
    try {
      setError(null);
      setDownloadingUrl(videoUrl);
      await assertUrlReachable(videoUrl);

      const baseDir = FileSystem.cacheDirectory || FileSystem.documentDirectory;
      if (!baseDir) throw new Error("Armazenamento local indisponivel.");

      const targetPath = `${baseDir}${buildFileName(videoUrl)}`;
      const result = await FileSystem.downloadAsync(videoUrl, targetPath);

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(result.uri, {
          dialogTitle: "Salvar video",
          mimeType: "video/mp4",
          UTI: "public.mpeg-4",
        });
      } else {
        Alert.alert("Download concluido", `Arquivo salvo em: ${result.uri}`);
      }
    } catch (downloadError) {
      const message = downloadError instanceof Error ? downloadError.message : "Nao foi possivel baixar o video.";
      setError(message);
    } finally {
      setDownloadingUrl(null);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        <Card>
          <Kicker>Pedido</Kicker>
          <Title>{detail.title}</Title>
          <Body style={styles.summary}>{detail.summary}</Body>
          <View style={styles.actions}>
            <Button label="Ir para menu" variant="secondary" onPress={() => router.navigate("/home")} style={styles.action} />
            <Button label="Ver pedidos" variant="secondary" onPress={() => router.navigate("/orders")} style={styles.action} />
          </View>
          <View style={styles.statusRow}>
            <StatusPill status={detail.status} />
            <Body style={styles.statusText}>{statusHeadline(detail.status)}</Body>
          </View>

          {detail.status === "draft" ? (
            <>
              {!auth.profileProductionComplete ? (
                <Body style={styles.productionPending}>
                  Complete o cadastro de produção no Raio-X antes de enviar.
                </Body>
              ) : null}
              <View style={styles.actions}>
                <Button label="Editar" variant="secondary" onPress={() => router.push(editPath(detail))} style={styles.action} />
                <Button label="Enviar para a Real" onPress={submit} style={styles.action} />
              </View>
            </>
          ) : null}

          {detail.status === "waiting_payment" ? (
            <View style={styles.actions}>
              <Button label="Já paguei (simular)" onPress={() => queue.setPlanActive(true)} style={styles.action} />
            </View>
          ) : null}
        </Card>

        {detail.status === "needs_info" ? (
          <Card>
            <SubTitle>Pendências</SubTitle>
            <Body>Responda aqui pra Real retomar.</Body>
            <Field label="Sua resposta" value={info} onChangeText={setInfo} placeholder="Escreva direto, sem enrolar" multiline />
            <Button label="Enviar info" onPress={sendInfo} disabled={!info.trim()} />
          </Card>
        ) : null}

        <Card>
          <SubTitle>Entregas</SubTitle>
          {deliverables.length === 0 ? (
            <Body>Sem entregas ainda.</Body>
          ) : (
            <View style={styles.deliverables}>
              {deliverables.map((d) => {
                const approval = approvalsById.get(d.id);
                const isPending = approval?.status === "pending";
                const isTerminal = approval?.status === "approved" || approval?.status === "changes_requested";
                const videoUrl = d.type === "url_preview" ? extractVideoUrl(d) : null;
                return (
                  <View key={d.id} style={styles.deliverable}>
                    <View style={styles.deliverableTop}>
                      <SubTitle style={styles.deliverableTitle}>{deliverableLabel(d.type)}</SubTitle>
                      <Text style={styles.deliverableStatus}>{d.status}</Text>
                    </View>
                    <Text style={styles.mono}>{prettyJson(d.content)}</Text>
                    {videoUrl ? (
                      <View style={styles.videoActions}>
                        <Video
                          source={{ uri: videoUrl }}
                          style={styles.videoPlayer}
                          useNativeControls
                          resizeMode={ResizeMode.COVER}
                          isLooping={false}
                        />
                        <Button label="Ver video no app" variant="secondary" onPress={() => void openViewer(videoUrl)} />
                        <Button
                          label={downloadingUrl === videoUrl ? "Baixando..." : "Baixar no app"}
                          onPress={() => void downloadInsideApp(videoUrl)}
                          disabled={downloadingUrl === videoUrl}
                        />
                      </View>
                    ) : null}

                    {approval ? (
                      <Body style={styles.approvalMeta}>
                        Aprovação: {approval.status}
                        {approval.feedback ? ` · feedback: ${approval.feedback}` : ""}
                      </Body>
                    ) : null}

                    {isPending ? (
                      <View style={styles.approvalActions}>
                        <Button label="Aprovar" onPress={() => approve(d)} style={styles.action} />
                        <View style={styles.changeBlock}>
                          <Field
                            label="Feedback (se pedir ajuste)"
                            value={feedbackByDeliverable[d.id] ?? ""}
                            onChangeText={(v) =>
                              setFeedbackByDeliverable((prev) => ({
                                ...prev,
                                [d.id]: v,
                              }))
                            }
                            placeholder="Ex.: deixe mais direto e com CTA"
                          />
                          <Button label="Pedir ajuste" variant="secondary" onPress={() => requestChanges(d)} />
                        </View>
                      </View>
                    ) : isTerminal ? null : null}
                  </View>
                );
              })}
            </View>
          )}
        </Card>

        <Card>
          <SubTitle>Atualizações</SubTitle>
          {timeline.length === 0 ? (
            <Body>Sem eventos ainda.</Body>
          ) : (
            <View style={styles.timeline}>
              {timeline.map((e) => (
                <View key={e.id} style={styles.event}>
                  <Body style={styles.eventMeta}>
                    {new Date(e.ts).toLocaleString()} · {e.actor.toUpperCase()}
                  </Body>
                  <Body style={styles.eventMsg}>{e.message}</Body>
                </View>
              ))}
            </View>
          )}
        </Card>

        <Card>
          <SubTitle>Resumo do briefing</SubTitle>
          <View style={styles.briefList}>
            {prettyLinesFromPayload(detail.payload as Record<string, unknown>).map((line) => (
              <Body key={line} style={styles.briefLine}>
                {line}
              </Body>
            ))}
          </View>
        </Card>

        {error ? (
          <Card>
            <Body style={styles.errorText}>{error}</Body>
          </Card>
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(viewerUrl)} animationType="slide" transparent={false} onRequestClose={() => setViewerUrl(null)}>
        <View style={styles.viewerWrap}>
          {viewerUrl ? (
            <Video
              source={{ uri: viewerUrl }}
              style={styles.viewerPlayer}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              isLooping={false}
            />
          ) : null}
          <View style={styles.viewerActions}>
            {downloadingUrl === viewerUrl ? <ActivityIndicator color={realTheme.colors.green} /> : null}
            <Button
              label={viewerUrl && downloadingUrl === viewerUrl ? "Baixando..." : "Baixar no app"}
              onPress={() => (viewerUrl ? void downloadInsideApp(viewerUrl) : undefined)}
              disabled={!viewerUrl || downloadingUrl === viewerUrl}
              style={styles.viewerBtn}
            />
            <Button label="Fechar" variant="secondary" onPress={() => setViewerUrl(null)} style={styles.viewerBtn} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 42,
    gap: 14,
  },
  summary: {
    color: realTheme.colors.muted,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  statusText: {
    color: realTheme.colors.muted,
  },
  productionPending: {
    color: realTheme.colors.green,
    fontFamily: realTheme.fonts.bodyMedium,
    fontSize: 13,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
  },
  action: {
    flex: 1,
  },
  deliverables: {
    gap: 12,
  },
  deliverable: {
    borderWidth: 1,
    borderColor: realTheme.colors.line,
    backgroundColor: realTheme.colors.panelSoft,
    borderRadius: realTheme.radius.md,
    padding: 12,
    gap: 10,
  },
  deliverableTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  deliverableTitle: {
    fontSize: 16,
    flex: 1,
  },
  deliverableStatus: {
    color: realTheme.colors.muted,
    fontFamily: realTheme.fonts.bodySemiBold,
    fontSize: 12,
  },
  mono: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyRegular,
    fontSize: 13,
    lineHeight: 18,
  },
  approvalMeta: {
    color: realTheme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  approvalActions: {
    gap: 10,
  },
  videoActions: {
    gap: 8,
  },
  videoPlayer: {
    width: "100%",
    aspectRatio: 9 / 16,
    borderRadius: 10,
    backgroundColor: "#000",
  },
  viewerWrap: {
    flex: 1,
    backgroundColor: "#000",
    justifyContent: "center",
  },
  viewerPlayer: {
    width: "100%",
    aspectRatio: 9 / 16,
    backgroundColor: "#000",
  },
  viewerActions: {
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.78)",
  },
  viewerBtn: {
    width: "100%",
  },
  changeBlock: {
    gap: 8,
  },
  timeline: {
    gap: 10,
  },
  event: {
    borderTopWidth: 1,
    borderTopColor: realTheme.colors.line,
    paddingTop: 10,
    gap: 2,
  },
  eventMeta: {
    color: realTheme.colors.muted,
    fontSize: 12,
  },
  eventMsg: {
    color: realTheme.colors.text,
    fontFamily: realTheme.fonts.bodyMedium,
  },
  briefList: {
    gap: 6,
  },
  briefLine: {
    color: realTheme.colors.muted,
    fontSize: 13,
    lineHeight: 18,
  },
  errorText: {
    color: "#ff7f7f",
  },
});
