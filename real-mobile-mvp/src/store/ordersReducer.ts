import type { ApprovalStatus, DeliverableStatus, Order, OrderDetail, OrderStatus } from "../queue/types";

export type OrdersState = {
  ordersById: Record<string, Order>;
  detailsById: Record<string, OrderDetail>;
};

export type OrdersAction =
  | { type: "UPSERT_ORDERS"; orders: Order[] }
  | { type: "UPSERT_DETAIL"; detail: OrderDetail }
  | { type: "SET_ORDER_STATUS"; orderId: string; status: OrderStatus }
  | {
      type: "APPLY_APPROVAL";
      orderId: string;
      deliverableId: string;
      status: Exclude<ApprovalStatus, "pending">;
      feedback?: string;
    };

export const initialOrdersState: OrdersState = {
  ordersById: {},
  detailsById: {},
};

export function ordersReducer(state: OrdersState, action: OrdersAction): OrdersState {
  switch (action.type) {
    case "UPSERT_ORDERS": {
      const next: OrdersState = {
        ...state,
        ordersById: { ...state.ordersById },
      };
      for (const o of action.orders) next.ordersById[o.id] = o;
      return next;
    }
    case "UPSERT_DETAIL": {
      return {
        ...state,
        ordersById: { ...state.ordersById, [action.detail.id]: action.detail },
        detailsById: { ...state.detailsById, [action.detail.id]: action.detail },
      };
    }
    case "SET_ORDER_STATUS": {
      const existing = state.ordersById[action.orderId];
      if (!existing) return state;
      const updatedOrder: Order = { ...existing, status: action.status, updatedAt: new Date().toISOString() };
      const updatedDetail = state.detailsById[action.orderId]
        ? { ...state.detailsById[action.orderId]!, status: action.status, updatedAt: updatedOrder.updatedAt }
        : null;
      return {
        ...state,
        ordersById: { ...state.ordersById, [action.orderId]: updatedOrder },
        detailsById: updatedDetail
          ? { ...state.detailsById, [action.orderId]: updatedDetail }
          : state.detailsById,
      };
    }
    case "APPLY_APPROVAL": {
      const detail = state.detailsById[action.orderId];
      if (!detail) return state;
      const nextDetail = applyApprovalToDetail(detail, action.deliverableId, action.status, action.feedback ?? "");
      return {
        ...state,
        ordersById: { ...state.ordersById, [nextDetail.id]: nextDetail },
        detailsById: { ...state.detailsById, [nextDetail.id]: nextDetail },
      };
    }
    default:
      return state;
  }
}

export function applyApprovalToDetail(
  detail: OrderDetail,
  deliverableId: string,
  status: Exclude<ApprovalStatus, "pending">,
  feedback: string,
): OrderDetail {
  const approvals = detail.approvals.map((a) =>
    a.deliverableId === deliverableId ? { ...a, status, feedback, updatedAt: new Date().toISOString() } : a,
  );

  const deliverableStatus: DeliverableStatus = status === "approved" ? "approved" : "changes_requested";
  const deliverables = detail.deliverables.map((d) =>
    d.id === deliverableId ? { ...d, status: deliverableStatus, updatedAt: new Date().toISOString() } : d,
  );

  // If all approvals are approved, the order can move forward (in the real system the worker resumes).
  const allApproved = approvals.length > 0 && approvals.every((a) => a.status === "approved");
  const nextStatus: OrderStatus = allApproved ? "in_progress" : detail.status;

  return {
    ...detail,
    status: nextStatus,
    approvals,
    deliverables,
    updatedAt: new Date().toISOString(),
  };
}

