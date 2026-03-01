import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueueClient, CreateOrderInput, SetApprovalInput, SubmitResult, UpdateOrderInput, UploadOrderAssetInput } from "./QueueClient";
import type { Order, OrderAsset, OrderDetail } from "./types";
import { uuidv4 } from "../utils/uuid";

type Json = unknown;

const CUSTOMER_ID_KEY = "real:http:customer_id";
const PLAN_ACTIVE_KEY = "real:http:plan_active";
const AUTH_TOKEN_KEY = "real:auth:token";

async function getOrCreateCustomerId(): Promise<string> {
  const existing = await AsyncStorage.getItem(CUSTOMER_ID_KEY);
  if (existing) return existing;
  const id = uuidv4();
  await AsyncStorage.setItem(CUSTOMER_ID_KEY, id);
  return id;
}

async function readPlanActive(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(PLAN_ACTIVE_KEY);
  return raw === "true";
}

async function writePlanActive(active: boolean): Promise<void> {
  await AsyncStorage.setItem(PLAN_ACTIVE_KEY, active ? "true" : "false");
}

async function api<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  const res = await fetch(input, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401) {
      await AsyncStorage.removeItem(AUTH_TOKEN_KEY);
      throw new Error("http_401: Sessão expirada. Faça login novamente.");
    }
    const text = await res.text().catch(() => "");
    throw new Error(`http_${res.status}${text ? `: ${text}` : ""}`);
  }
  return (await res.json()) as T;
}

export class HttpQueueClient implements QueueClient {
  constructor(private readonly baseUrl: string) {}

  async getCustomerId(): Promise<string> {
    return getOrCreateCustomerId();
  }

  async getPlanActive(): Promise<boolean> {
    try {
      const remote = await api<{ planActive: boolean }>(`${this.baseUrl}/v1/entitlements/me`, { method: "GET" });
      await writePlanActive(remote.planActive);
      return remote.planActive;
    } catch {
      return readPlanActive();
    }
  }

  async setPlanActive(active: boolean): Promise<void> {
    await writePlanActive(active);
    await api<{ planActive: boolean }>(`${this.baseUrl}/v1/entitlements/me`, {
      method: "POST",
      body: JSON.stringify({ planActive: active } satisfies Json),
    });
  }

  async getWallet(): Promise<{
    planActive: boolean;
    walletBalance: number;
    currency: "BRL";
    minTopup: number;
    recommendedTopup: number;
  }> {
    return api(`${this.baseUrl}/v1/billing/wallet`, { method: "GET" });
  }

  async createPixTopup(amount: number): Promise<{
    topupId: string;
    status: "pending" | "approved" | "failed" | "expired";
    amount: number;
    pixCopyPaste: string;
    qrCodeBase64?: string;
    expiresAt?: string | null;
  }> {
    return api(`${this.baseUrl}/v1/billing/topups/pix`, {
      method: "POST",
      body: JSON.stringify({ amount } satisfies Json),
    });
  }

  async getTopupStatus(topupId: string): Promise<{
    topupId: string;
    status: "pending" | "approved" | "failed" | "expired";
    amount: number;
    approvedAt?: string | null;
    failureReason?: string | null;
    expiresAt?: string | null;
  }> {
    return api(`${this.baseUrl}/v1/billing/topups/${topupId}`, { method: "GET" });
  }

  async createOrder(input: CreateOrderInput): Promise<Order> {
    return api<Order>(`${this.baseUrl}/v1/orders`, {
      method: "POST",
      body: JSON.stringify(input satisfies Json),
    });
  }

  async updateOrder(orderId: string, input: UpdateOrderInput): Promise<Order> {
    return api<Order>(`${this.baseUrl}/v1/orders/${orderId}`, {
      method: "PATCH",
      body: JSON.stringify(input satisfies Json),
    });
  }

  async listOrders(): Promise<Order[]> {
    return api<Order[]>(`${this.baseUrl}/v1/orders`, { method: "GET" });
  }

  async getOrder(orderId: string): Promise<OrderDetail> {
    return api<OrderDetail>(`${this.baseUrl}/v1/orders/${orderId}`, { method: "GET" });
  }

  async uploadOrderAsset(orderId: string, input: UploadOrderAssetInput): Promise<OrderAsset> {
    return api<OrderAsset>(`${this.baseUrl}/v1/orders/${orderId}/assets`, {
      method: "POST",
      body: JSON.stringify(input satisfies Json),
    });
  }

  async listOrderAssets(orderId: string): Promise<OrderAsset[]> {
    return api<OrderAsset[]>(`${this.baseUrl}/v1/orders/${orderId}/assets`, { method: "GET" });
  }

  async submitOrder(orderId: string): Promise<SubmitResult> {
    return api<SubmitResult>(`${this.baseUrl}/v1/orders/${orderId}/submit`, { method: "POST" });
  }

  async postOrderInfo(orderId: string, message: string): Promise<OrderDetail> {
    return api<OrderDetail>(`${this.baseUrl}/v1/orders/${orderId}/info`, {
      method: "POST",
      body: JSON.stringify({ message } satisfies Json),
    });
  }

  async setApproval(deliverableId: string, input: SetApprovalInput): Promise<void> {
    await api(`${this.baseUrl}/v1/approvals/${deliverableId}`, {
      method: "POST",
      body: JSON.stringify(input satisfies Json),
    });
  }

  async pauseAdsPublication(orderId: string): Promise<void> {
    await api(`${this.baseUrl}/v1/ads/publications/${orderId}/pause`, { method: "POST" });
  }

  async resumeAdsPublication(orderId: string): Promise<void> {
    await api(`${this.baseUrl}/v1/ads/publications/${orderId}/resume`, { method: "POST" });
  }

  async stopAdsPublication(orderId: string): Promise<void> {
    await api(`${this.baseUrl}/v1/ads/publications/${orderId}/stop`, { method: "POST" });
  }
}
