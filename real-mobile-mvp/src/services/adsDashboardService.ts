import { Order } from '../queue/types';
import { AdsDashboardDailyPoint, AdsRunningCreative } from '../ads/dashboardApi';
import { inferMonthlyBudget, inferCpl, getLiveOrders, getOrdersByType } from './orderService';

export interface AdsDashboardMetrics {
  totalAds: number;
  liveAds: number;
  monthlySpend: number;
  estimatedLeads: number;
  cplAvg: number;
  pendingApprovals: number;
}

export function calculateAdsDashboardMetrics(
  orders: Order[],
  pendingApprovalsCount: number
): AdsDashboardMetrics {
  const adsOrders = getOrdersByType(orders, 'ads');
  const live = getLiveOrders(adsOrders);

  const monthlySpend = live.reduce((acc, order) => acc + inferMonthlyBudget(order.payload), 0);

  const leads = live.reduce((acc, order) => {
    const cpl = inferCpl(order);
    return acc + inferMonthlyBudget(order.payload) / cpl;
  }, 0);

  const cplAvg = live.length ? live.reduce((acc, order) => acc + inferCpl(order), 0) / live.length : 0;

  return {
    totalAds: adsOrders.length,
    liveAds: live.length,
    monthlySpend,
    estimatedLeads: leads,
    cplAvg,
    pendingApprovals: pendingApprovalsCount,
  };
}

export function generateFallbackRunningCreatives(orders: Order[]): AdsRunningCreative[] {
  const liveOrders = getLiveOrders(orders);

  return liveOrders.map((order, idx) => {
    const preferredCreative =
      typeof order.payload.preferredCreative === 'string' ? order.payload.preferredCreative : '';
    const creativeName = preferredCreative.trim() || `Criativo ${idx + 1}`;

    return {
      id: `local-${order.id}`,
      name: creativeName,
      campaignName: order.title,
      status: 'active',
      updatedAt: order.updatedAt,
    };
  });
}

export interface KPIData {
  liveAds: number;
  monthlySpend: number;
  monthlyLeads: number;
  cpl: number | null;
  previousMonthSpend: number;
  previousMonthLeads: number;
  previousMonthCpl: number | null;
  activeCreatives: number;
  updatedAt: string | null;
  dailySeries: AdsDashboardDailyPoint[];
  stale: boolean;
  source: 'server' | 'fallback';
}

function buildZeroDailySeries(now = new Date()): AdsDashboardDailyPoint[] {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const today = now.getUTCDate();
  const out: AdsDashboardDailyPoint[] = [];
  for (let day = 1; day <= today; day += 1) {
    const date = new Date(Date.UTC(year, month, day));
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    out.push({
      date: `${date.getUTCFullYear()}-${m}-${d}`,
      spend: 0,
      leads: 0,
    });
  }
  return out;
}

export function buildKPIData(
  _metrics: AdsDashboardMetrics,
  _runningCreatives: AdsRunningCreative[],
  remoteData?: {
    activeCampaigns: number;
    monthlySpend: number;
    monthlyLeads: number;
    cpl: number | null;
    previousMonthSpend: number;
    previousMonthLeads: number;
    previousMonthCpl: number | null;
    activeCreatives: number;
    updatedAt: string | null;
    dailySeries: AdsDashboardDailyPoint[];
    stale: boolean;
  }
): KPIData {
  if (remoteData) {
    return {
      liveAds: remoteData.activeCampaigns,
      monthlySpend: remoteData.monthlySpend,
      monthlyLeads: remoteData.monthlyLeads,
      cpl: remoteData.cpl,
      previousMonthSpend: remoteData.previousMonthSpend,
      previousMonthLeads: remoteData.previousMonthLeads,
      previousMonthCpl: remoteData.previousMonthCpl,
      activeCreatives: remoteData.activeCreatives,
      updatedAt: remoteData.updatedAt,
      dailySeries: Array.isArray(remoteData.dailySeries) ? remoteData.dailySeries : buildZeroDailySeries(),
      stale: remoteData.stale === true,
      source: 'server',
    };
  }

  return {
    liveAds: 0,
    monthlySpend: 0,
    monthlyLeads: 0,
    cpl: null,
    previousMonthSpend: 0,
    previousMonthLeads: 0,
    previousMonthCpl: null,
    activeCreatives: 0,
    updatedAt: null,
    dailySeries: buildZeroDailySeries(),
    stale: false,
    source: 'fallback',
  };
}

export function buildGrowthData(monthlyLeads: number, previousMonthLeads: number): { diffLeads: number; growthPct: number } {
  const diffLeads = Math.round(monthlyLeads - previousMonthLeads);
  const growthPct = previousMonthLeads > 0 ? Math.round((diffLeads / previousMonthLeads) * 100) : 0;
  return { diffLeads, growthPct };
}

export function buildScaleProjection(monthlySpend: number, cpl: number | null): { dailyIncrease: number; extraLeads: number } {
  if (!cpl || cpl <= 0 || monthlySpend <= 0) {
    return { dailyIncrease: 0, extraLeads: 0 };
  }

  const baseDaily = monthlySpend / 30;
  const suggested = Math.max(5, Math.round((baseDaily * 0.15) / 5) * 5);
  const extraLeads = Math.max(0, Math.round((suggested * 30) / cpl));
  return {
    dailyIncrease: suggested,
    extraLeads,
  };
}
