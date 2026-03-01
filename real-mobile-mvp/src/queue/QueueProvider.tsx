import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { CreateOrderInput, QueueClient, SetApprovalInput, UpdateOrderInput, UploadOrderAssetInput } from "./QueueClient";
import type { Approval, Deliverable, Order, OrderAsset, OrderDetail, OrderStatus } from "./types";
import { HttpQueueClient } from "./HttpQueueClient";
import { MockQueueClient } from "./MockQueueClient";

type QueueCacheV1 = {
  version: 1;
  planActive: boolean;
  walletBalance: number;
  walletCurrency: "BRL";
  minTopup: number;
  recommendedTopup: number;
  orders: Order[];
  detailsById: Record<string, OrderDetail>;
  lastSyncAt: string | null;
};

const CACHE_KEY = "real:queue:cache:v1";

const defaultCache: QueueCacheV1 = {
  version: 1,
  planActive: false,
  walletBalance: 0,
  walletCurrency: "BRL",
  minTopup: 30,
  recommendedTopup: 90,
  orders: [],
  detailsById: {},
  lastSyncAt: null,
};

type QueueContextValue = {
  ready: boolean;
  loading: boolean;
  error: string | null;
  planActive: boolean;
  walletBalance: number;
  walletCurrency: "BRL";
  minTopup: number;
  recommendedTopup: number;
  orders: Order[];
  detailsById: Record<string, OrderDetail>;
  lastSyncAt: string | null;

  refresh(): Promise<void>;
  setPlanActive(active: boolean): Promise<void>;
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

  createOrder(input: CreateOrderInput): Promise<Order>;
  updateOrder(orderId: string, input: UpdateOrderInput): Promise<Order>;
  submitOrder(orderId: string): Promise<void>;
  uploadOrderAsset(orderId: string, input: UploadOrderAssetInput): Promise<OrderAsset>;
  listOrderAssets(orderId: string): Promise<OrderAsset[]>;
  postOrderInfo(orderId: string, message: string): Promise<void>;
  setApproval(deliverableId: string, input: SetApprovalInput): Promise<void>;
  pauseAdsPublication(orderId: string): Promise<void>;
  resumeAdsPublication(orderId: string): Promise<void>;
  stopAdsPublication(orderId: string): Promise<void>;

  // Convenience selectors for screens.
  getOrder(orderId: string): OrderDetail | null;
  listPendingApprovals(): Array<{ order: Order; deliverable: Deliverable; approval: Approval }>;
  countByStatus(status: OrderStatus): number;
};

const QueueContext = createContext<QueueContextValue | null>(null);

function pickClient(): QueueClient {
  const baseUrl = process.env.EXPO_PUBLIC_QUEUE_API_BASE_URL;
  const requireQueueApi = process.env.EXPO_PUBLIC_REQUIRE_QUEUE_API === "true";
  if (baseUrl && baseUrl.trim().length > 0) {
    return new HttpQueueClient(baseUrl.trim());
  }
  if (requireQueueApi) {
    throw new Error("EXPO_PUBLIC_QUEUE_API_BASE_URL é obrigatória neste ambiente.");
  }
  return new MockQueueClient();
}

function shouldFallbackToMock(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /http_401|http_403|unauthorized|forbidden/i.test(error.message);
}

async function isLocalDevSession(): Promise<boolean> {
  const token = await AsyncStorage.getItem("real:auth:token");
  return typeof token === "string" && token.startsWith("local-dev-");
}

async function loadCache(): Promise<QueueCacheV1> {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) return defaultCache;
  try {
    const parsed = JSON.parse(raw) as unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof parsed === "object" && parsed !== null && (parsed as any).version === 1) {
      return parsed as QueueCacheV1;
    }
  } catch {
    // ignore
  }
  return defaultCache;
}

async function saveCache(cache: QueueCacheV1): Promise<void> {
  await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(cache));
}

export function QueueProvider({ children }: { children: React.ReactNode }) {
  const requireQueueApi = process.env.EXPO_PUBLIC_REQUIRE_QUEUE_API === "true";
  const [client, setClient] = useState<QueueClient>(() => pickClient());
  const refreshingRef = useRef(false);
  const fallbackEnabledRef = useRef(false);

  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planActive, setPlanActiveState] = useState(false);
  const [walletBalance, setWalletBalance] = useState(0);
  const [walletCurrency, setWalletCurrency] = useState<"BRL">("BRL");
  const [minTopup, setMinTopup] = useState(30);
  const [recommendedTopup, setRecommendedTopup] = useState(90);
  const [orders, setOrders] = useState<Order[]>([]);
  const [detailsById, setDetailsById] = useState<Record<string, OrderDetail>>({});
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    const cache = await loadCache();
    setPlanActiveState(cache.planActive);
    setWalletBalance(cache.walletBalance ?? 0);
    setWalletCurrency(cache.walletCurrency ?? "BRL");
    setMinTopup(cache.minTopup ?? 30);
    setRecommendedTopup(cache.recommendedTopup ?? 90);
    setOrders(cache.orders);
    setDetailsById(cache.detailsById);
    setLastSyncAt(cache.lastSyncAt);
    setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setLoading(true);
    setError(null);
    try {
      if (!fallbackEnabledRef.current && client instanceof HttpQueueClient && (__DEV__ || !requireQueueApi)) {
        const token = await AsyncStorage.getItem("real:auth:token");
        const noRemoteSession = !token || token.startsWith("local-dev-");
        if (noRemoteSession) {
          fallbackEnabledRef.current = true;
          setClient(new MockQueueClient());
          return;
        }
      }

      const [wallet, list] = await Promise.all([client.getWallet(), client.listOrders()]);
      const details = await Promise.all(list.map((o) => client.getOrder(o.id)));
      const byId: Record<string, OrderDetail> = {};
      for (const d of details) byId[d.id] = d;

      const now = new Date().toISOString();
      const cache: QueueCacheV1 = {
        version: 1,
        planActive: wallet.planActive,
        walletBalance: wallet.walletBalance,
        walletCurrency: wallet.currency,
        minTopup: wallet.minTopup,
        recommendedTopup: wallet.recommendedTopup,
        orders: list,
        detailsById: byId,
        lastSyncAt: now,
      };
      await saveCache(cache);

      setPlanActiveState(wallet.planActive);
      setWalletBalance(wallet.walletBalance);
      setWalletCurrency(wallet.currency);
      setMinTopup(wallet.minTopup);
      setRecommendedTopup(wallet.recommendedTopup);
      setOrders(list);
      setDetailsById(byId);
      setLastSyncAt(now);
    } catch (e) {
      const canFallbackByPolicy = __DEV__ || !requireQueueApi || (await isLocalDevSession());
      if (canFallbackByPolicy && !fallbackEnabledRef.current && client instanceof HttpQueueClient && shouldFallbackToMock(e)) {
        fallbackEnabledRef.current = true;
        setClient(new MockQueueClient());
        setError("API indisponível para esta sessão. Rodando em modo local.");
        return;
      }
      setError(e instanceof Error ? e.message : "refresh_failed");
    } finally {
      setLoading(false);
      refreshingRef.current = false;
    }
  }, [client, requireQueueApi]);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!ready) return;
    void refresh();
    const id = setInterval(() => {
      void refresh();
    }, 7000);
    return () => clearInterval(id);
  }, [ready, refresh]);

  const setPlanActive = useCallback(
    async (active: boolean) => {
      setLoading(true);
      try {
        await client.setPlanActive(active);
        await refresh();
      } finally {
        setLoading(false);
      }
    },
    [client, refresh],
  );

  const createOrder = useCallback(
    async (input: CreateOrderInput) => {
      const created = await client.createOrder(input);
      await refresh();
      return created;
    },
    [client, refresh],
  );

  const updateOrder = useCallback(
    async (orderId: string, input: UpdateOrderInput) => {
      const updated = await client.updateOrder(orderId, input);
      await refresh();
      return updated;
    },
    [client, refresh],
  );

  const submitOrder = useCallback(
    async (orderId: string) => {
      await client.submitOrder(orderId);
      await refresh();
    },
    [client, refresh],
  );

  const uploadOrderAsset = useCallback(
    async (orderId: string, input: UploadOrderAssetInput) => {
      const asset = await client.uploadOrderAsset(orderId, input);
      await refresh();
      return asset;
    },
    [client, refresh],
  );

  const listOrderAssets = useCallback(
    async (orderId: string) => {
      return client.listOrderAssets(orderId);
    },
    [client],
  );

  const postOrderInfo = useCallback(
    async (orderId: string, message: string) => {
      await client.postOrderInfo(orderId, message);
      await refresh();
    },
    [client, refresh],
  );

  const setApproval = useCallback(
    async (deliverableId: string, input: SetApprovalInput) => {
      await client.setApproval(deliverableId, input);
      await refresh();
    },
    [client, refresh],
  );

  const getOrder = useCallback(
    (orderId: string) => {
      return detailsById[orderId] ?? null;
    },
    [detailsById],
  );

  const listPendingApprovals = useCallback(() => {
    const items: Array<{ order: Order; deliverable: Deliverable; approval: Approval }> = [];
    for (const order of orders) {
      const detail = detailsById[order.id];
      if (!detail) continue;
      for (const approval of detail.approvals) {
        if (approval.status !== "pending") continue;
        const deliverable = detail.deliverables.find((d) => d.id === approval.deliverableId);
        if (!deliverable) continue;
        items.push({ order, deliverable, approval });
      }
    }
    // Most recent first.
    return items.sort((a, b) => b.deliverable.updatedAt.localeCompare(a.deliverable.updatedAt));
  }, [detailsById, orders]);

  const countByStatus = useCallback(
    (status: OrderStatus) => orders.filter((o) => o.status === status).length,
    [orders],
  );

  const createPixTopup = useCallback(
    async (amount: number) => {
      const topup = await client.createPixTopup(amount);
      await refresh();
      return topup;
    },
    [client, refresh],
  );

  const getTopupStatus = useCallback(
    async (topupId: string) => {
      const status = await client.getTopupStatus(topupId);
      await refresh();
      return status;
    },
    [client, refresh],
  );

  const pauseAdsPublication = useCallback(
    async (orderId: string) => {
      await client.pauseAdsPublication(orderId);
      await refresh();
    },
    [client, refresh],
  );

  const resumeAdsPublication = useCallback(
    async (orderId: string) => {
      await client.resumeAdsPublication(orderId);
      await refresh();
    },
    [client, refresh],
  );

  const stopAdsPublication = useCallback(
    async (orderId: string) => {
      await client.stopAdsPublication(orderId);
      await refresh();
    },
    [client, refresh],
  );

  const value: QueueContextValue = {
    ready,
    loading,
    error,
    planActive,
    walletBalance,
    walletCurrency,
    minTopup,
    recommendedTopup,
    orders,
    detailsById,
    lastSyncAt,
    refresh,
    setPlanActive,
    createPixTopup,
    getTopupStatus,
    createOrder,
    updateOrder,
    submitOrder,
    uploadOrderAsset,
    listOrderAssets,
    postOrderInfo,
    setApproval,
    pauseAdsPublication,
    resumeAdsPublication,
    stopAdsPublication,
    getOrder,
    listPendingApprovals,
    countByStatus,
  };

  return <QueueContext.Provider value={value}>{children}</QueueContext.Provider>;
}

export function useQueue(): QueueContextValue {
  const ctx = useContext(QueueContext);
  if (!ctx) throw new Error("useQueue must be used within QueueProvider");
  return ctx;
}
