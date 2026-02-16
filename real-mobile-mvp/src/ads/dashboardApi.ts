import AsyncStorage from "@react-native-async-storage/async-storage";

export type AdsRunningCreative = {
  id: string;
  name: string;
  campaignName: string;
  adSetName?: string;
  status: "active" | "paused" | "learning" | "ended";
  spend?: number;
  leads?: number;
  updatedAt?: string;
};

export type AdsDashboardSnapshot = {
  source: "remote";
  updatedAt: string | null;
  monthlySpend: number;
  monthlyLeads: number;
  cpl: number | null;
  activeCampaigns: number;
  activeCreatives: number;
  creativesRunning: AdsRunningCreative[];
};

type RawSnapshot = {
  updatedAt?: string;
  monthlySpend?: number;
  monthlyLeads?: number;
  cpl?: number | null;
  activeCampaigns?: number;
  activeCreatives?: number;
  creativesRunning?: Array<{
    id?: string;
    name?: string;
    campaignName?: string;
    adSetName?: string;
    status?: string;
    spend?: number;
    leads?: number;
    updatedAt?: string;
  }>;
};

const AUTH_TOKEN_KEY = "real:auth:token";

function normalizeStatus(value?: string): AdsRunningCreative["status"] {
  const input = String(value ?? "").trim().toLowerCase();
  if (input === "paused") return "paused";
  if (input === "learning") return "learning";
  if (input === "ended") return "ended";
  return "active";
}

function normalizeNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

function normalizeSnapshot(raw: RawSnapshot): AdsDashboardSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const creatives = Array.isArray(raw.creativesRunning) ? raw.creativesRunning : [];

  return {
    source: "remote",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null,
    monthlySpend: normalizeNumber(raw.monthlySpend),
    monthlyLeads: normalizeNumber(raw.monthlyLeads),
    cpl: typeof raw.cpl === "number" && Number.isFinite(raw.cpl) ? raw.cpl : null,
    activeCampaigns: normalizeNumber(raw.activeCampaigns),
    activeCreatives: normalizeNumber(raw.activeCreatives, creatives.length),
    creativesRunning: creatives
      .filter((c) => typeof c?.id === "string" && typeof c?.name === "string" && typeof c?.campaignName === "string")
      .map((c) => ({
        id: c.id!,
        name: c.name!,
        campaignName: c.campaignName!,
        adSetName: typeof c.adSetName === "string" ? c.adSetName : undefined,
        status: normalizeStatus(c.status),
        spend: typeof c.spend === "number" && Number.isFinite(c.spend) ? c.spend : undefined,
        leads: typeof c.leads === "number" && Number.isFinite(c.leads) ? c.leads : undefined,
        updatedAt: typeof c.updatedAt === "string" ? c.updatedAt : undefined,
      })),
  };
}

export async function fetchAdsDashboardSnapshot(): Promise<AdsDashboardSnapshot | null> {
  const baseUrl =
    process.env.EXPO_PUBLIC_ADS_DASHBOARD_API_BASE_URL?.trim() ||
    process.env.EXPO_PUBLIC_QUEUE_API_BASE_URL?.trim() ||
    "";
  if (!baseUrl) return null;

  const token = await AsyncStorage.getItem(AUTH_TOKEN_KEY);
  const res = await fetch(`${baseUrl}/v1/ads/dashboard`, {
    method: "GET",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) return null;

  const raw = (await res.json()) as RawSnapshot;
  return normalizeSnapshot(raw);
}
