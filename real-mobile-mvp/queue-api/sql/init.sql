create extension if not exists pgcrypto;

create type order_type as enum ('ads', 'site', 'content', 'video_editor');
create type order_status as enum ('draft', 'waiting_payment', 'queued', 'in_progress', 'needs_approval', 'needs_info', 'blocked', 'done', 'failed');
create type order_actor as enum ('client', 'codex', 'ops');
create type deliverable_type as enum ('creative', 'copy', 'audience_summary', 'campaign_plan', 'wireframe', 'url_preview', 'calendar', 'posts', 'reels_script');
create type deliverable_status as enum ('draft', 'submitted', 'approved', 'changes_requested', 'published');
create type approval_status as enum ('pending', 'approved', 'changes_requested');

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  type order_type not null,
  status order_status not null default 'draft',
  priority integer,
  title text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  ts timestamptz not null default now(),
  actor order_actor not null,
  message text not null,
  status_snapshot order_status
);

create table if not exists deliverables (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  type deliverable_type not null,
  status deliverable_status not null default 'draft',
  content jsonb not null default '{}'::jsonb,
  asset_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id, type)
);

create table if not exists approvals (
  deliverable_id uuid primary key references deliverables(id) on delete cascade,
  status approval_status not null default 'pending',
  feedback text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists entitlements (
  customer_id uuid primary key,
  plan_active boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists worker_claims (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  worker_id text not null,
  attempt integer not null default 1,
  claimed_at timestamptz not null default now(),
  lease_until timestamptz not null,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_worker_claim_open on worker_claims(order_id) where released_at is null;

create table if not exists worker_health (
  worker_id text primary key,
  last_poll_at timestamptz,
  last_claim_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_status_created on orders(status, created_at);
create index if not exists idx_orders_customer_updated on orders(customer_id, updated_at desc);
create index if not exists idx_order_events_order_ts on order_events(order_id, ts);
create index if not exists idx_deliverables_order_updated on deliverables(order_id, updated_at desc);

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at before update on orders for each row execute function set_updated_at();

drop trigger if exists trg_deliverables_updated_at on deliverables;
create trigger trg_deliverables_updated_at before update on deliverables for each row execute function set_updated_at();

drop trigger if exists trg_entitlements_updated_at on entitlements;
create trigger trg_entitlements_updated_at before update on entitlements for each row execute function set_updated_at();

drop trigger if exists trg_worker_health_updated_at on worker_health;
create trigger trg_worker_health_updated_at before update on worker_health for each row execute function set_updated_at();
