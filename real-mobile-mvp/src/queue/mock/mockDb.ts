import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Approval, Deliverable, Order, OrderAsset, OrderEvent } from "../types";

export type MockDbV1 = {
  version: 1;
  customer: {
    id: string;
    planActive: boolean;
    createdAt: string;
    updatedAt: string;
  };
  orders: Record<string, Order & { mock?: { phase: string; nextAt?: string } }>;
  events: Record<string, OrderEvent[]>;
  deliverables: Record<string, Deliverable[]>;
  approvals: Record<string, Approval[]>;
  assets: Record<string, OrderAsset[]>;
};

const STORAGE_KEY = "real:mock:db:v1";

export async function loadMockDb(createInitial: () => MockDbV1): Promise<MockDbV1> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const initial = createInitial();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
    return initial;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (parsed as any).version === 1
    ) {
      return parsed as MockDbV1;
    }
  } catch {
    // ignore, re-init below
  }

  const initial = createInitial();
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(initial));
  return initial;
}

export async function saveMockDb(db: MockDbV1): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}
