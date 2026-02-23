import { buildVideoDeliverableSummary } from "./videoEditorPresenter";
import type { Deliverable, Order, OrderDetail, OrderEvent, OrderType } from "../queue/types";

export const DELIVERIES_LAST_SEEN_KEY = "real:deliveries:thread_seen:v2";

export type ProfessionalThread = {
  id: "ads" | "site" | "video_editor";
  name: string;
  role: string;
  avatar: string;
  type: OrderType;
};

export type ThreadMessage = {
  id: string;
  ts: string;
  actor: "client" | "professional" | "system";
  text: string;
  orderId: string;
  orderTitle: string;
  attachment?: {
    kind: "video" | "site";
    url: string;
    ctaPreview: string;
    ctaDownload: string;
  };
};

export type ThreadData = {
  thread: ProfessionalThread;
  orders: Order[];
  messages: ThreadMessage[];
  lastTs: string;
  previewText: string;
  unreadCount: number;
};

export const PROFESSIONAL_THREADS: ProfessionalThread[] = [
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

export function relativeDate(isoDate: string): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return "agora";
  return date.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

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
    orderTitle: order.title,
    text: `${order.title}. ${order.summary}`,
  };

  const fromEvents: ThreadMessage[] = detail.events
    .filter((event: OrderEvent) => event.actor === "codex" || event.actor === "ops" || event.actor === "client")
    .map((event) => ({
      id: `ev_${event.id}`,
      ts: event.ts,
      actor: event.actor === "client" ? "client" : "professional",
      orderId: order.id,
      orderTitle: order.title,
      text: event.message,
    }));

  const fromDeliverables: ThreadMessage[] = detail.deliverables.map((deliverable) => {
    const base: ThreadMessage = {
      id: `dlv_${deliverable.id}`,
      ts: deliverable.updatedAt,
      actor: "professional",
      orderId: order.id,
      orderTitle: order.title,
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
          ctaDownload: "Abrir",
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

export function buildThreads(params: {
  orders: Order[];
  getOrder: (orderId: string) => OrderDetail | null;
  lastSeenByThread: Record<string, string>;
}): ThreadData[] {
  const orders = [...params.orders].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return PROFESSIONAL_THREADS.map((thread) => {
    const typeOrders = orders.filter((order) => order.type === thread.type);
    const messages = typeOrders
      .flatMap((order) => {
        const detail = params.getOrder(order.id);
        if (!detail) return [];
        return buildThreadMessages(order, detail);
      })
      .sort((a, b) => a.ts.localeCompare(b.ts));

    const lastMessage = messages[messages.length - 1];
    return {
      thread,
      orders: typeOrders,
      messages,
      lastTs: lastMessage?.ts || "",
      previewText: lastMessage?.text || "Quando você pedir algo, a conversa aparece aqui.",
      unreadCount: calcUnread(messages, params.lastSeenByThread[thread.id]),
    };
  });
}
