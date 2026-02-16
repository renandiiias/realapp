import type { ApprovalStatus, JsonObject, Order, OrderDetail, OrderStatus, OrderType } from "./types";

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
};

export type SetApprovalInput = {
  status: Exclude<ApprovalStatus, "pending">;
  feedback?: string;
};

export type QueueClient = {
  getCustomerId(): Promise<string>;

  // Customer state (mock/payment simulation).
  getPlanActive(): Promise<boolean>;
  setPlanActive(active: boolean): Promise<void>;

  // Orders.
  createOrder(input: CreateOrderInput): Promise<Order>;
  updateOrder(orderId: string, input: UpdateOrderInput): Promise<Order>;
  listOrders(): Promise<Order[]>;
  getOrder(orderId: string): Promise<OrderDetail>;
  submitOrder(orderId: string): Promise<SubmitResult>;
  postOrderInfo(orderId: string, message: string): Promise<OrderDetail>;

  // Approvals.
  setApproval(deliverableId: string, input: SetApprovalInput): Promise<void>;
};

