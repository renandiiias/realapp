import type { ApprovalStatus, JsonObject, Order, OrderAsset, OrderDetail, OrderStatus, OrderType } from "./types";

export type CreateOrderInput = {
  type: OrderType;
  title: string;
  summary: string;
  payload: JsonObject;
};

export type UpdateOrderInput = Partial<Pick<Order, "title" | "summary" | "payload" | "priority">> & {
  status?: Extract<OrderStatus, "draft">;
};

export type SubmitResult = {
  orderId: string;
  status: Extract<OrderStatus, "queued" | "waiting_payment">;
  waitingReason?: "missing_plan" | "insufficient_balance" | null;
  walletBalance?: number;
  requiredBalance?: number;
};

export type SetApprovalInput = {
  status: Exclude<ApprovalStatus, "pending">;
  feedback?: string;
};

export type UploadOrderAssetInput = {
  fileName: string;
  mimeType: string;
  base64Data: string;
  kind?: "image" | "video";
  sizeBytes?: number;
};

export type QueueClient = {
  getCustomerId(): Promise<string>;

  // Customer state (mock/payment simulation).
  getPlanActive(): Promise<boolean>;
  setPlanActive(active: boolean): Promise<void>;
  getWallet(): Promise<{
    planActive: boolean;
    walletBalance: number;
    currency: "BRL";
    minTopup: number;
    recommendedTopup: number;
  }>;
  createPixTopup(amount: number): Promise<{
    topupId: string;
    status: "pending" | "approved" | "failed" | "expired";
    amount: number;
    pixCopyPaste: string;
    qrCodeBase64?: string;
    expiresAt?: string | null;
  }>;
  getTopupStatus(topupId: string): Promise<{
    topupId: string;
    status: "pending" | "approved" | "failed" | "expired";
    amount: number;
    approvedAt?: string | null;
    failureReason?: string | null;
    expiresAt?: string | null;
  }>;

  // Orders.
  createOrder(input: CreateOrderInput): Promise<Order>;
  updateOrder(orderId: string, input: UpdateOrderInput): Promise<Order>;
  listOrders(): Promise<Order[]>;
  getOrder(orderId: string): Promise<OrderDetail>;
  uploadOrderAsset(orderId: string, input: UploadOrderAssetInput): Promise<OrderAsset>;
  listOrderAssets(orderId: string): Promise<OrderAsset[]>;
  submitOrder(orderId: string): Promise<SubmitResult>;
  postOrderInfo(orderId: string, message: string): Promise<OrderDetail>;

  // Approvals.
  setApproval(deliverableId: string, input: SetApprovalInput): Promise<void>;
  pauseAdsPublication(orderId: string): Promise<void>;
  resumeAdsPublication(orderId: string): Promise<void>;
  stopAdsPublication(orderId: string): Promise<void>;
};
