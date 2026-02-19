import { Order } from '../queue/types';
import { AdsRunningCreative } from '../ads/dashboardApi';
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
  activeCreatives: number;
  updatedAt: string | null;
  source: 'server' | 'fallback';
}

export function buildKPIData(
  metrics: AdsDashboardMetrics,
  runningCreatives: AdsRunningCreative[],
  remoteData?: {
    activeCampaigns: number;
    monthlySpend: number;
    monthlyLeads: number;
    cpl: number;
    activeCreatives: number;
    updatedAt: string;
  }
): KPIData {
  if (remoteData) {
    return {
      liveAds: remoteData.activeCampaigns,
      monthlySpend: remoteData.monthlySpend,
      monthlyLeads: remoteData.monthlyLeads,
      cpl: remoteData.cpl,
      activeCreatives: remoteData.activeCreatives,
      updatedAt: remoteData.updatedAt,
      source: 'server',
    };
  }

  return {
    liveAds: metrics.liveAds,
    monthlySpend: metrics.monthlySpend,
    monthlyLeads: Math.round(metrics.estimatedLeads),
    cpl: metrics.cplAvg || null,
    activeCreatives: runningCreatives.length,
    updatedAt: null,
    source: 'fallback',
  };
}
