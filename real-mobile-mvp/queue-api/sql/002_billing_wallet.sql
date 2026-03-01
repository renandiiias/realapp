create table if not exists wallet_accounts (
  customer_id uuid primary key,
  balance_brl numeric(12,2) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  entry_type text not null check (entry_type in ('topup_credit', 'ad_debit', 'manual_adjust')),
  amount_brl numeric(12,2) not null,
  reference_type text,
  reference_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists billing_topups (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  amount_brl numeric(12,2) not null check (amount_brl > 0),
  status text not null check (status in ('pending', 'approved', 'failed', 'expired')),
  provider text not null default 'mercadopago',
  provider_payment_id text,
  pix_copy_paste text,
  qr_code_base64 text,
  expires_at timestamptz,
  approved_at timestamptz,
  failure_reason text,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists billing_subscriptions (
  customer_id uuid primary key,
  status text not null default 'inactive' check (status in ('inactive', 'active', 'past_due', 'canceled')),
  provider_preapproval_id text,
  plan_id text,
  current_period_end timestamptz,
  raw_payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_wallet_ledger_customer_created on wallet_ledger(customer_id, created_at desc);
create index if not exists idx_billing_topups_customer_created on billing_topups(customer_id, created_at desc);
create unique index if not exists uq_billing_topups_provider_payment_id on billing_topups(provider, provider_payment_id) where provider_payment_id is not null;
create unique index if not exists uq_wallet_ledger_order_debit on wallet_ledger(reference_type, reference_id, entry_type)
  where reference_type = 'order' and entry_type = 'ad_debit';

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_wallet_accounts_updated_at on wallet_accounts;
create trigger trg_wallet_accounts_updated_at before update on wallet_accounts for each row execute function set_updated_at();

drop trigger if exists trg_billing_topups_updated_at on billing_topups;
create trigger trg_billing_topups_updated_at before update on billing_topups for each row execute function set_updated_at();

drop trigger if exists trg_billing_subscriptions_updated_at on billing_subscriptions;
create trigger trg_billing_subscriptions_updated_at before update on billing_subscriptions for each row execute function set_updated_at();
