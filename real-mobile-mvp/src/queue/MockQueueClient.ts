import type {
  Approval,
  ApprovalStatus,
  OrderAsset,
  Deliverable,
  DeliverableStatus,
  DeliverableType,
  JsonObject,
  Order,
  OrderDetail,
  OrderStatus,
  OrderType,
} from "./types";
import type {
  CreateOrderInput,
  QueueClient,
  SetApprovalInput,
  SubmitResult,
  UploadOrderAssetInput,
  UpdateOrderInput,
} from "./QueueClient";
import { uuidv4 } from "../utils/uuid";
import { loadMockDb, saveMockDb, type MockDbV1 } from "./mock/mockDb";

type NowFn = () => Date;

function iso(now: Date): string {
  return now.toISOString();
}

function byUpdatedAtDesc(a: Order, b: Order): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

function isApprovalTerminal(status: ApprovalStatus): boolean {
  return status === "approved" || status === "changes_requested";
}

function requiresApproval(type: DeliverableType): boolean {
  return type === "creative" || type === "copy";
}

function getRequiredInfoMissing(order: Order): string | null {
  const p = order.payload ?? {};
  if (order.type === "ads") {
    if (!p.objective) return "Qual e o objetivo da campanha?";
    if (!p.offer) return "Qual e a oferta (o que estamos vendendo)?";
    if (!p.budget) return "Qual e o budget (diario ou mensal)?";
    if (!p.region) return "Qual e a regiao (cidade/estado/pais) para rodar?";
    return null;
  }
  if (order.type === "site") {
    if (!p.objective) return "Qual e o objetivo do site?";
    if (!p.cta) return "Qual e o CTA principal?";
    if (!p.sections) return "Quais secoes o site precisa ter?";
    return null;
  }
  if (order.type === "content") {
    if (!p.platforms) return "Quais plataformas?";
    if (!p.frequency) return "Qual frequencia (ex.: 3x por semana)?";
    if (!p.themes) return "Quais temas principais?";
    return null;
  }
  if (order.type === "video_editor") {
    if (!p.backendInputPath && !p.localUri) return "Envie o video para iniciar a edicao.";
    if (!p.durationSeconds) return "Qual a duracao do video?";
    return null;
  }
  return null;
}

function deliverableTitle(type: DeliverableType): string {
  switch (type) {
    case "creative":
      return "Criativo";
    case "copy":
      return "Copy";
    case "audience_summary":
      return "Publico (resumo)";
    case "campaign_plan":
      return "Plano de campanha";
    case "wireframe":
      return "Wireframe";
    case "url_preview":
      return "Preview URL";
    case "calendar":
      return "Calendario";
    case "posts":
      return "Posts";
    case "reels_script":
      return "Roteiro Reels";
    default:
      return type;
  }
}

function ensureEvent(db: MockDbV1, orderId: string): OrderEventList {
  if (!db.events[orderId]) {
    db.events[orderId] = [];
  }
  return db.events[orderId];
}

type OrderEventList = MockDbV1["events"][string];

function appendOrderEvent(
  db: MockDbV1,
  now: Date,
  input: {
    orderId: string;
    actor: "client" | "codex" | "ops";
    message: string;
    statusSnapshot?: OrderStatus;
  },
): void {
  const events = ensureEvent(db, input.orderId);
  events.push({
    id: uuidv4(),
    orderId: input.orderId,
    ts: iso(now),
    actor: input.actor,
    message: input.message,
    statusSnapshot: input.statusSnapshot,
  });
}

function getOrderDeliverables(db: MockDbV1, orderId: string): Deliverable[] {
  return db.deliverables[orderId] ?? [];
}

function setOrderDeliverables(db: MockDbV1, orderId: string, list: Deliverable[]): void {
  db.deliverables[orderId] = list;
}

function getOrderApprovals(db: MockDbV1, orderId: string): Approval[] {
  return db.approvals[orderId] ?? [];
}

function setOrderApprovals(db: MockDbV1, orderId: string, list: Approval[]): void {
  db.approvals[orderId] = list;
}

function upsertDeliverable(
  db: MockDbV1,
  now: Date,
  input: Omit<Deliverable, "updatedAt"> & { updatedAt?: string },
): void {
  const list = getOrderDeliverables(db, input.orderId);
  const idx = list.findIndex((d) => d.id === input.id);
  const updated: Deliverable = {
    ...input,
    updatedAt: input.updatedAt ?? iso(now),
  };
  if (idx === -1) {
    list.push(updated);
  } else {
    list[idx] = updated;
  }
  setOrderDeliverables(db, input.orderId, list);
}

function upsertApproval(
  db: MockDbV1,
  now: Date,
  orderId: string,
  approval: Omit<Approval, "updatedAt"> & { updatedAt?: string },
): void {
  const list = getOrderApprovals(db, orderId);
  const idx = list.findIndex((a) => a.deliverableId === approval.deliverableId);
  const updated: Approval = {
    ...approval,
    updatedAt: approval.updatedAt ?? iso(now),
  };
  if (idx === -1) {
    list.push(updated);
  } else {
    list[idx] = updated;
  }
  setOrderApprovals(db, orderId, list);
}

function generateAdsDeliverables(
  db: MockDbV1,
  now: Date,
  order: Order,
  isRevision: boolean,
): void {
  const baseCopy = [
    "Direto ao ponto. Oferta clara. CTA forte.",
    "SEM FRESCURA: promessa, prova, CTA.",
    "Curto, humano e objetivo. Sem enrolacao.",
  ];
  const copy = isRevision
    ? baseCopy.map((t, i) => `V${isRevision ? 2 : 1}.${i + 1} ${t}`)
    : baseCopy.map((t, i) => `V1.${i + 1} ${t}`);

  const concepts = [
    "Antes x Depois (resultado)",
    "3 erros + solucao (educacional)",
    "Prova social + oferta (direto)",
  ];

  const creative = isRevision
    ? concepts.map((t, i) => `V2.${i + 1} ${t}`)
    : concepts.map((t, i) => `V1.${i + 1} ${t}`);

  const preferredCopyRaw = typeof order.payload.preferredCopy === "string" ? order.payload.preferredCopy.trim() : "";
  const preferredCreativeRaw =
    typeof order.payload.preferredCreative === "string" ? order.payload.preferredCreative.trim() : "";

  const copyVariants = preferredCopyRaw ? [preferredCopyRaw, ...copy] : copy;
  const creativeConcepts = preferredCreativeRaw ? [preferredCreativeRaw, ...creative] : creative;

  upsertDeliverable(db, now, {
    id: `${order.id}:campaign_plan`,
    orderId: order.id,
    type: "campaign_plan",
    status: "submitted",
    content: {
      objective: order.payload.objective ?? "conversoes",
      budget: order.payload.budget ?? "R$ 50/dia",
      notes: "Plano inicial pra testar rapido e iterar.",
    },
    assetUrls: [],
  });

  upsertDeliverable(db, now, {
    id: `${order.id}:audience_summary`,
    orderId: order.id,
    type: "audience_summary",
    status: "submitted",
    content: {
      region: order.payload.region ?? "BR",
      audience: order.payload.audience ?? "amplo (com refinamento depois)",
    },
    assetUrls: [],
  });

  upsertDeliverable(db, now, {
    id: `${order.id}:creative`,
    orderId: order.id,
    type: "creative",
    status: "submitted",
    content: {
      concepts: creativeConcepts,
      chosen: preferredCreativeRaw || creativeConcepts[0],
    },
    assetUrls: [],
  });

  upsertDeliverable(db, now, {
    id: `${order.id}:copy`,
    orderId: order.id,
    type: "copy",
    status: "submitted",
    content: {
      variants: copyVariants,
      chosen: preferredCopyRaw || copyVariants[0],
    },
    assetUrls: [],
  });

  upsertApproval(db, now, order.id, {
    deliverableId: `${order.id}:creative`,
    status: "pending",
    feedback: "",
  });
  upsertApproval(db, now, order.id, {
    deliverableId: `${order.id}:copy`,
    status: "pending",
    feedback: "",
  });
}

function generateSiteDeliverables(db: MockDbV1, now: Date, order: Order): void {
  upsertDeliverable(db, now, {
    id: `${order.id}:wireframe`,
    orderId: order.id,
    type: "wireframe",
    status: "submitted",
    content: {
      sections: order.payload.sections ?? ["Hero", "Beneficios", "Prova", "CTA"],
    },
    assetUrls: [],
  });

  upsertDeliverable(db, now, {
    id: `${order.id}:copy`,
    orderId: order.id,
    type: "copy",
    status: "submitted",
    content: {
      headline: order.payload.headline ?? "Titulo forte e simples",
      cta: order.payload.cta ?? "Falar no WhatsApp",
    },
    assetUrls: [],
  });

  upsertDeliverable(db, now, {
    id: `${order.id}:url_preview`,
    orderId: order.id,
    type: "url_preview",
    status: "submitted",
    content: "https://preview.real.local/site",
    assetUrls: [],
  });

  // Site copy can be approved too; keeping approvals only for copy/creative.
  upsertApproval(db, now, order.id, {
    deliverableId: `${order.id}:copy`,
    status: "pending",
    feedback: "",
  });
}

function generateContentDeliverables(db: MockDbV1, now: Date, order: Order): void {
  upsertDeliverable(db, now, {
    id: `${order.id}:calendar`,
    orderId: order.id,
    type: "calendar",
    status: "submitted",
    content: [
      { day: "Seg", topic: "Dor/Problema" },
      { day: "Qua", topic: "Prova/Case" },
      { day: "Sex", topic: "Oferta + CTA" },
    ],
    assetUrls: [],
  });
  upsertDeliverable(db, now, {
    id: `${order.id}:posts`,
    orderId: order.id,
    type: "posts",
    status: "submitted",
    content: [
      { title: "3 erros comuns", hook: "SEM FRESCURA: isso ta te travando" },
      { title: "Antes e Depois", hook: "O que muda quando a oferta fica clara" },
    ],
    assetUrls: [],
  });
  upsertDeliverable(db, now, {
    id: `${order.id}:reels_script`,
    orderId: order.id,
    type: "reels_script",
    status: "submitted",
    content: {
      hook: "Se voce faz isso, ta jogando dinheiro fora.",
      beats: ["Problema", "Solucao", "Prova", "CTA"],
    },
    assetUrls: [],
  });
}

function generateVideoEditorDeliverables(db: MockDbV1, now: Date, order: Order): void {
  const inputDuration = Number(order.payload.durationSeconds || 0);
  const clampedDuration = Math.max(1, Math.min(15, Number.isFinite(inputDuration) ? inputDuration : 15));
  upsertDeliverable(db, now, {
    id: `${order.id}:url_preview`,
    orderId: order.id,
    type: "url_preview",
    status: "submitted",
    content: {
      kind: "video",
      summary: "Video editado com corte curto e preset social.",
      stylePrompt: order.payload.stylePrompt ?? "",
      durationSeconds: clampedDuration,
      outputUrl: "https://preview.real.local/video/final.mp4",
    },
    assetUrls: ["https://preview.real.local/video/final.mp4"],
  });
}

function getApproval(db: MockDbV1, orderId: string, deliverableId: string): Approval | null {
  const approvals = getOrderApprovals(db, orderId);
  return approvals.find((a) => a.deliverableId === deliverableId) ?? null;
}

function setDeliverableStatus(
  db: MockDbV1,
  now: Date,
  orderId: string,
  deliverableId: string,
  status: DeliverableStatus,
): void {
  const list = getOrderDeliverables(db, orderId);
  const idx = list.findIndex((d) => d.id === deliverableId);
  if (idx === -1) return;
  const d = list[idx]!;
  list[idx] = { ...d, status, updatedAt: iso(now) };
  setOrderDeliverables(db, orderId, list);
}

function allRequiredApprovalsApproved(db: MockDbV1, orderId: string): boolean {
  const deliverables = getOrderDeliverables(db, orderId).filter((d) => requiresApproval(d.type));
  if (deliverables.length === 0) return true;
  const approvals = getOrderApprovals(db, orderId);
  return deliverables.every((d) => approvals.some((a) => a.deliverableId === d.id && a.status === "approved"));
}

function anyRequiredApprovalsChangesRequested(db: MockDbV1, orderId: string): boolean {
  const deliverables = getOrderDeliverables(db, orderId).filter((d) => requiresApproval(d.type));
  const approvals = getOrderApprovals(db, orderId);
  return deliverables.some((d) => approvals.some((a) => a.deliverableId === d.id && a.status === "changes_requested"));
}

function ensureGeneratedDeliverables(db: MockDbV1, now: Date, order: Order, opts: { revision: boolean }): void {
  if (order.type === "ads") {
    generateAdsDeliverables(db, now, order, opts.revision);
    return;
  }
  if (order.type === "site") {
    generateSiteDeliverables(db, now, order);
    return;
  }
  if (order.type === "video_editor") {
    generateVideoEditorDeliverables(db, now, order);
    return;
  }
  generateContentDeliverables(db, now, order);
}

function needsApprovalForOrder(db: MockDbV1, orderId: string): boolean {
  const deliverables = getOrderDeliverables(db, orderId);
  if (deliverables.length === 0) return false;
  const requires = deliverables.filter((d) => requiresApproval(d.type));
  if (requires.length === 0) return false;
  const approvals = getOrderApprovals(db, orderId);
  return requires.some((d) => {
    const approval = approvals.find((a) => a.deliverableId === d.id);
    return !approval || !isApprovalTerminal(approval.status);
  });
}

function advanceOrderIfNeeded(db: MockDbV1, now: Date, orderId: string): void {
  const order = db.orders[orderId];
  if (!order) return;

  if (order.status === "waiting_payment") return;
  if (order.status === "blocked" || order.status === "failed" || order.status === "done") return;

  const planActive = db.customer.planActive;
  if (!planActive) return;

  const nextAt = order.mock?.nextAt ? new Date(order.mock.nextAt) : null;
  const due = nextAt ? now >= nextAt : false;

  const setStatus = (status: OrderStatus) => {
    order.status = status;
    order.updatedAt = iso(now);
  };

  if (order.status === "queued") {
    if (!order.mock?.nextAt) {
      order.mock = { phase: "queued", nextAt: iso(new Date(now.getTime() + 2500)) };
      return;
    }
    if (!due) return;
    setStatus("in_progress");
    order.mock = { phase: "working", nextAt: iso(new Date(now.getTime() + 6000)) };
    appendOrderEvent(db, now, {
      orderId,
      actor: "codex",
      message: "Peguei o pedido. Vou executar.",
      statusSnapshot: "in_progress",
    });
    return;
  }

  if (order.status === "in_progress") {
    if (!order.mock?.nextAt) {
      order.mock = { phase: "working", nextAt: iso(new Date(now.getTime() + 6000)) };
      return;
    }
    if (!due) return;

    if (order.mock?.phase === "finalizing") {
      setStatus("done");
      order.mock = { phase: "done" };
      appendOrderEvent(db, now, {
        orderId,
        actor: "codex",
        message: "Finalizado. Entregas prontas.",
        statusSnapshot: "done",
      });
      return;
    }

    if (order.mock?.phase === "iterating") {
      // Regenerate only the copy/creative on revisions, then request approval again.
      ensureGeneratedDeliverables(db, now, order, { revision: true });
      // Reset approvals to pending for required deliverables.
      for (const d of getOrderDeliverables(db, orderId).filter((dd) => requiresApproval(dd.type))) {
        upsertApproval(db, now, orderId, { deliverableId: d.id, status: "pending", feedback: "" });
        setDeliverableStatus(db, now, orderId, d.id, "submitted");
      }
      setStatus("needs_approval");
      order.mock = { phase: "waiting_approval" };
      appendOrderEvent(db, now, {
        orderId,
        actor: "codex",
        message: "Atualizei as entregas com base no feedback. Preciso de aprovacao de novo.",
        statusSnapshot: "needs_approval",
      });
      return;
    }

    const missing = getRequiredInfoMissing(order);
    if (missing) {
      setStatus("needs_info");
      order.mock = { phase: "needs_info" };
      appendOrderEvent(db, now, {
        orderId,
        actor: "codex",
        message: `Preciso de uma info pra seguir: ${missing}`,
        statusSnapshot: "needs_info",
      });
      return;
    }

    ensureGeneratedDeliverables(db, now, order, { revision: false });

    if (needsApprovalForOrder(db, orderId)) {
      setStatus("needs_approval");
      order.mock = { phase: "waiting_approval" };
      appendOrderEvent(db, now, {
        orderId,
        actor: "codex",
        message: "Entregas geradas. Preciso da sua aprovacao (copy/criativo).",
        statusSnapshot: "needs_approval",
      });
      return;
    }

    setStatus("done");
    order.mock = { phase: "done" };
    appendOrderEvent(db, now, {
      orderId,
      actor: "codex",
      message: "Finalizado. Entregas prontas.",
      statusSnapshot: "done",
    });
    return;
  }

  if (order.status === "needs_approval") {
    // If any changes were requested, go back to iteration.
    if (anyRequiredApprovalsChangesRequested(db, orderId)) {
      setStatus("in_progress");
      order.mock = { phase: "iterating", nextAt: iso(new Date(now.getTime() + 5500)) };
      appendOrderEvent(db, now, {
        orderId,
        actor: "codex",
        message: "Recebi seu feedback. Vou ajustar e te mando nova versao.",
        statusSnapshot: "in_progress",
      });
      return;
    }

    if (allRequiredApprovalsApproved(db, orderId)) {
      setStatus("in_progress");
      order.mock = { phase: "finalizing", nextAt: iso(new Date(now.getTime() + 2800)) };
      appendOrderEvent(db, now, {
        orderId,
        actor: "codex",
        message: "Aprovado. Vou finalizar.",
        statusSnapshot: "in_progress",
      });
    }
  }
}

function advanceAll(db: MockDbV1, now: Date): void {
  for (const id of Object.keys(db.orders)) {
    advanceOrderIfNeeded(db, now, id);
  }
}

function toOrderDetail(db: MockDbV1, orderId: string): OrderDetail {
  const order = db.orders[orderId];
  if (!order) {
    throw new Error("order_not_found");
  }
  return {
    ...order,
    events: db.events[orderId] ?? [],
    deliverables: db.deliverables[orderId] ?? [],
    approvals: db.approvals[orderId] ?? [],
    assets: db.assets[orderId] ?? [],
    adsPublication: null,
  };
}

export class MockQueueClient implements QueueClient {
  private readonly now: NowFn;

  constructor(opts?: { now?: NowFn }) {
    this.now = opts?.now ?? (() => new Date());
  }

  private async load(): Promise<MockDbV1> {
    const db = await loadMockDb(() => {
      const now = this.now();
      const customerId = uuidv4();
      const ts = iso(now);
      return {
        version: 1,
        customer: {
          id: customerId,
          planActive: false,
          walletBalance: 0,
          createdAt: ts,
          updatedAt: ts,
        },
        orders: {},
        events: {},
        deliverables: {},
        approvals: {},
        assets: {},
      };
    });
    if (!db.assets) {
      db.assets = {};
      await saveMockDb(db);
    }
    if (typeof db.customer.walletBalance !== "number") {
      db.customer.walletBalance = 0;
      await saveMockDb(db);
    }
    return db;
  }

  async getCustomerId(): Promise<string> {
    const db = await this.load();
    return db.customer.id;
  }

  async getPlanActive(): Promise<boolean> {
    const db = await this.load();
    return db.customer.planActive;
  }

  async setPlanActive(active: boolean): Promise<void> {
    const db = await this.load();
    const now = this.now();
    db.customer.planActive = active;
    db.customer.updatedAt = iso(now);

    if (active) {
      for (const id of Object.keys(db.orders)) {
        const order = db.orders[id]!;
        if (order.status === "waiting_payment") {
          order.status = "queued";
          order.updatedAt = iso(now);
          order.mock = { phase: "queued", nextAt: iso(new Date(now.getTime() + 2200)) };
          appendOrderEvent(db, now, {
            orderId: id,
            actor: "ops",
            message: "Pagamento confirmado. Pedido liberado para produção.",
            statusSnapshot: "queued",
          });
        }
      }
    }

    await saveMockDb(db);
  }

  async getWallet(): Promise<{
    planActive: boolean;
    walletBalance: number;
    currency: "BRL";
    minTopup: number;
    recommendedTopup: number;
  }> {
    const db = await this.load();
    return {
      planActive: db.customer.planActive,
      walletBalance: Number((db.customer.walletBalance || 0).toFixed(2)),
      currency: "BRL",
      minTopup: 30,
      recommendedTopup: 90,
    };
  }

  async createPixTopup(amount: number): Promise<{
    topupId: string;
    status: "pending" | "approved" | "failed" | "expired";
    amount: number;
    pixCopyPaste: string;
    qrCodeBase64?: string;
    expiresAt?: string | null;
  }> {
    const db = await this.load();
    const now = this.now();
    const topupId = uuidv4();
    const safeAmount = Number(amount) >= 30 ? Number(amount) : 30;
    db.customer.walletBalance = Number((db.customer.walletBalance + safeAmount).toFixed(2));
    db.customer.updatedAt = iso(now);
    await saveMockDb(db);
    return {
      topupId,
      status: "approved",
      amount: safeAmount,
      pixCopyPaste: `0002012658REALAPPPIX${topupId.replace(/-/g, "").slice(0, 20)}`,
      expiresAt: new Date(now.getTime() + 20 * 60 * 1000).toISOString(),
    };
  }

  async getTopupStatus(topupId: string): Promise<{
    topupId: string;
    status: "pending" | "approved" | "failed" | "expired";
    amount: number;
    approvedAt?: string | null;
    failureReason?: string | null;
    expiresAt?: string | null;
  }> {
    return {
      topupId,
      status: "approved",
      amount: 0,
      approvedAt: this.now().toISOString(),
      failureReason: null,
    };
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    const db = await this.load();
    const now = this.now();
    const id = uuidv4();
    const ts = iso(now);
    const order: Order = {
      id,
      customerId: db.customer.id,
      type: input.type,
      status: "draft",
      title: input.title,
      summary: input.summary,
      payload: input.payload,
      createdAt: ts,
      updatedAt: ts,
    };
    db.orders[id] = { ...order, mock: { phase: "draft" } };
    db.events[id] = [];
    db.deliverables[id] = [];
    db.approvals[id] = [];
    db.assets[id] = [];
    appendOrderEvent(db, now, {
      orderId: id,
      actor: "client",
      message: "Rascunho criado.",
      statusSnapshot: "draft",
    });
    await saveMockDb(db);
    return order;
  }

  async updateOrder(orderId: string, input: UpdateOrderInput): Promise<Order> {
    const db = await this.load();
    const now = this.now();
    const order = db.orders[orderId];
    if (!order) throw new Error("order_not_found");

    // For V1, we only allow updates while in draft or needs_info.
    if (order.status !== "draft" && order.status !== "needs_info") {
      return order;
    }

    db.orders[orderId] = {
      ...order,
      ...input,
      updatedAt: iso(now),
    };

    await saveMockDb(db);
    return db.orders[orderId]!;
  }

  async listOrders(): Promise<Order[]> {
    const db = await this.load();
    const now = this.now();
    advanceAll(db, now);
    await saveMockDb(db);
    return Object.values(db.orders).sort(byUpdatedAtDesc);
  }

  async getOrder(orderId: string): Promise<OrderDetail> {
    const db = await this.load();
    const now = this.now();
    advanceAll(db, now);
    await saveMockDb(db);
    return toOrderDetail(db, orderId);
  }

  async uploadOrderAsset(orderId: string, input: UploadOrderAssetInput): Promise<OrderAsset> {
    const db = await this.load();
    const now = this.now();
    const order = db.orders[orderId];
    if (!order) throw new Error("order_not_found");
    if (order.status !== "draft") throw new Error("asset_upload_only_draft");

    const mimeType = String(input.mimeType || "application/octet-stream").trim().toLowerCase();
    const inferredKind: OrderAsset["kind"] = mimeType.startsWith("video/") ? "video" : "image";
    const kind = input.kind || inferredKind;
    if (kind !== inferredKind) throw new Error("asset_kind_mismatch");

    const approximateSize = typeof input.sizeBytes === "number" && input.sizeBytes > 0 ? input.sizeBytes : input.base64Data.length;
    const asset: OrderAsset = {
      id: uuidv4(),
      orderId,
      kind,
      originalFileName: input.fileName || `asset_${Date.now()}`,
      mimeType,
      sizeBytes: approximateSize,
      createdAt: iso(now),
    };
    const current = db.assets[orderId] ?? [];
    db.assets[orderId] = [asset, ...current];
    order.updatedAt = iso(now);
    appendOrderEvent(db, now, {
      orderId,
      actor: "client",
      message: `Asset de anúncio enviado (${kind}).`,
      statusSnapshot: order.status,
    });
    await saveMockDb(db);
    return asset;
  }

  async listOrderAssets(orderId: string): Promise<OrderAsset[]> {
    const db = await this.load();
    if (!db.orders[orderId]) throw new Error("order_not_found");
    return db.assets[orderId] ?? [];
  }

  async submitOrder(orderId: string): Promise<SubmitResult> {
    const db = await this.load();
    const now = this.now();
    const order = db.orders[orderId];
    if (!order) throw new Error("order_not_found");

    if (order.status !== "draft" && order.status !== "needs_info") {
      return { orderId, status: order.status as SubmitResult["status"] };
    }

    const requiredBalance = order.type === "ads" ? 30 : 0;
    const hasEnoughBalance = db.customer.walletBalance >= requiredBalance;
    const status: SubmitResult["status"] = db.customer.planActive && hasEnoughBalance ? "queued" : "waiting_payment";
    order.status = status;
    order.updatedAt = iso(now);
    if (status === "queued") {
      order.mock = { phase: "queued", nextAt: iso(new Date(now.getTime() + 2200)) };
    } else {
      order.mock = { phase: "waiting_payment" };
    }

    appendOrderEvent(db, now, {
      orderId,
      actor: "client",
      message: "Enviado para a Real.",
      statusSnapshot: status,
    });
    if (status === "waiting_payment") {
      appendOrderEvent(db, now, {
        orderId,
        actor: "ops",
        message: "Aguardando ativação para iniciar a produção.",
        statusSnapshot: "waiting_payment",
      });
    }

    await saveMockDb(db);
    return {
      orderId,
      status,
      waitingReason: status === "waiting_payment" ? (!db.customer.planActive ? "missing_plan" : "insufficient_balance") : null,
      walletBalance: db.customer.walletBalance,
      requiredBalance,
    };
  }

  async postOrderInfo(orderId: string, message: string): Promise<OrderDetail> {
    const db = await this.load();
    const now = this.now();
    const order = db.orders[orderId];
    if (!order) throw new Error("order_not_found");

    appendOrderEvent(db, now, {
      orderId,
      actor: "client",
      message: `Info enviada: ${message}`,
      statusSnapshot: order.status,
    });

    if (order.status === "needs_info") {
      order.payload = { ...order.payload, info_response: message } as JsonObject;
      const nextStatus: Extract<OrderStatus, "queued" | "waiting_payment"> = db.customer.planActive
        ? "queued"
        : "waiting_payment";
      order.status = nextStatus;
      order.updatedAt = iso(now);
      order.mock = nextStatus === "queued" ? { phase: "queued", nextAt: iso(new Date(now.getTime() + 2200)) } : { phase: "waiting_payment" };

      appendOrderEvent(db, now, {
        orderId,
        actor: "codex",
        message: "Perfeito. Vou retomar a execucao.",
        statusSnapshot: nextStatus,
      });
    }

    advanceAll(db, now);
    await saveMockDb(db);
    return toOrderDetail(db, orderId);
  }

  async setApproval(deliverableId: string, input: SetApprovalInput): Promise<void> {
    const db = await this.load();
    const now = this.now();

    // Find the order by deliverable ID.
    const orderId = Object.keys(db.deliverables).find((oid) =>
      (db.deliverables[oid] ?? []).some((d) => d.id === deliverableId),
    );
    if (!orderId) throw new Error("deliverable_not_found");

    const approval = getApproval(db, orderId, deliverableId);
    if (!approval) {
      upsertApproval(db, now, orderId, {
        deliverableId,
        status: input.status,
        feedback: input.feedback ?? "",
      });
    } else {
      upsertApproval(db, now, orderId, {
        deliverableId,
        status: input.status,
        feedback: input.feedback ?? approval.feedback ?? "",
      });
    }

    if (input.status === "approved") {
      setDeliverableStatus(db, now, orderId, deliverableId, "approved");
      appendOrderEvent(db, now, {
        orderId,
        actor: "client",
        message: `${deliverableTitle(
          (db.deliverables[orderId] ?? []).find((d) => d.id === deliverableId)?.type ?? "copy",
        )} aprovado.`,
      });
    } else {
      setDeliverableStatus(db, now, orderId, deliverableId, "changes_requested");
      appendOrderEvent(db, now, {
        orderId,
        actor: "client",
        message: `Ajustes solicitados: ${input.feedback ?? "sem detalhes"}`,
      });
    }

    // Keep order in needs_approval; advance() will pick up changes/approval completion.
    advanceAll(db, now);
    await saveMockDb(db);
  }

  async pauseAdsPublication(orderId: string): Promise<void> {
    const db = await this.load();
    const now = this.now();
    const order = db.orders[orderId];
    if (!order) throw new Error("order_not_found");
    appendOrderEvent(db, now, {
      orderId,
      actor: "client",
      message: "Campanha pausada pelo cliente.",
      statusSnapshot: order.status,
    });
    await saveMockDb(db);
  }

  async resumeAdsPublication(orderId: string): Promise<void> {
    const db = await this.load();
    const now = this.now();
    const order = db.orders[orderId];
    if (!order) throw new Error("order_not_found");
    appendOrderEvent(db, now, {
      orderId,
      actor: "client",
      message: "Campanha retomada pelo cliente.",
      statusSnapshot: order.status,
    });
    await saveMockDb(db);
  }

  async stopAdsPublication(orderId: string): Promise<void> {
    const db = await this.load();
    const now = this.now();
    const order = db.orders[orderId];
    if (!order) throw new Error("order_not_found");
    order.status = "done";
    order.updatedAt = iso(now);
    appendOrderEvent(db, now, {
      orderId,
      actor: "client",
      message: "Campanha encerrada pelo cliente.",
      statusSnapshot: "done",
    });
    await saveMockDb(db);
  }
}
