export type OrderType = "ads" | "site" | "content";

export type OrderStatus =
  | "draft"
  | "waiting_payment"
  | "queued"
  | "in_progress"
  | "needs_approval"
  | "needs_info"
  | "blocked"
  | "done"
  | "failed";

export type OrderActor = "client" | "codex" | "ops";

export type DeliverableType =
  | "creative"
  | "copy"
  | "audience_summary"
  | "campaign_plan"
  | "wireframe"
  | "url_preview"
  | "calendar"
  | "posts"
  | "reels_script";

export type DeliverableStatus =
  | "draft"
  | "submitted"
  | "approved"
  | "changes_requested"
  | "published";

export type ApprovalStatus = "pending" | "approved" | "changes_requested";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

export type Order = {
  id: string;
  customerId: string;
  type: OrderType;
  status: OrderStatus;
  priority?: number;
  title: string;
  summary: string;
  payload: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type OrderEvent = {
  id: string;
  orderId: string;
  ts: string;
  actor: OrderActor;
  message: string;
  statusSnapshot?: OrderStatus;
};

export type Deliverable = {
  id: string;
  orderId: string;
  type: DeliverableType;
  status: DeliverableStatus;
  content: JsonValue;
  assetUrls: string[];
  updatedAt: string;
};

export type Approval = {
  deliverableId: string;
  status: ApprovalStatus;
  feedback: string;
  updatedAt: string;
};

export type OrderDetail = Order & {
  events: OrderEvent[];
  deliverables: Deliverable[];
  approvals: Approval[];
};

