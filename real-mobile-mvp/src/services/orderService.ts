import { Order, OrderStatus, JsonObject } from '../queue/types';

export function orderTypeLabel(order: Order): string {
  if (order.type === 'ads') return 'Tráfego';
  if (order.type === 'site') return 'Site';
  return 'Conteúdo';
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(?:[.,]\d+)?/g) ?? [];
  return matches
    .map((m) => Number(m.replace('.', '').replace(',', '.')))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function inferMonthlyBudget(payload: JsonObject): number {
  const budgetRaw = typeof payload.budget === 'string' ? payload.budget.toLowerCase().trim() : '';
  const numbers = extractNumbers(budgetRaw);

  if (budgetRaw) {
    const avg = numbers.length > 1 ? numbers.reduce((acc, n) => acc + n, 0) / numbers.length : numbers[0] ?? 0;
    if (avg > 0) {
      if (
        budgetRaw.includes('/dia') ||
        budgetRaw.includes(' dia') ||
        budgetRaw.includes('diario') ||
        budgetRaw.includes('diário')
      ) {
        return avg * 30;
      }
      return avg;
    }
  }

  const monthlyBudget = typeof payload.monthlyBudget === 'string' ? payload.monthlyBudget : '';
  if (monthlyBudget === 'ate_200') return 200;
  if (monthlyBudget === '500_1000') return 750;
  if (monthlyBudget === '1000_5000') return 3000;

  return 1200;
}

export function inferCpl(order: Order): number {
  const seed = hashString(order.id) % 22;
  const base = 26 + seed;

  if (order.status === 'done') return Math.max(18, base - 5);
  if (order.status === 'in_progress') return base;
  if (order.status === 'needs_approval' || order.status === 'needs_info') return base + 3;
  return base + 6;
}

export function filterOrdersByStatus(orders: Order[], statuses?: OrderStatus[]): Order[] {
  if (!statuses) return orders;
  return orders.filter((o) => statuses.includes(o.status));
}

export function getOrdersByType(orders: Order[], type: Order['type']): Order[] {
  return orders.filter((o) => o.type === type);
}

export const LIVE_STATUSES: OrderStatus[] = ['in_progress', 'needs_approval', 'needs_info'];

export function getLiveOrders(orders: Order[]): Order[] {
  return orders.filter((order) => LIVE_STATUSES.includes(order.status));
}

export interface OrderFilter {
  id: string;
  label: string;
  statuses?: OrderStatus[];
}

export const ORDER_FILTERS: OrderFilter[] = [
  { id: 'all', label: 'Todos' },
  {
    id: 'active',
    label: 'Ativos',
    statuses: ['queued', 'in_progress', 'needs_approval', 'needs_info', 'blocked'],
  },
  { id: 'draft', label: 'Rascunhos', statuses: ['draft'] },
  { id: 'waiting_payment', label: 'Ativação', statuses: ['waiting_payment'] },
  { id: 'done', label: 'Concluídos', statuses: ['done', 'failed'] },
];
