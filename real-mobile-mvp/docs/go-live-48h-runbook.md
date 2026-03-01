# RealApp Go-live 48h Runbook (Cliente 1)

## Escopo do release
- Modelo: assinatura + saldo de tráfego.
- Recarga inicial: PIX manual (copia e cola).
- Mínimo de recarga: R$30.
- Recomendado no app: R$90.
- Fluxo principal do cliente: Ads.
- Site e editor de vídeo: preview interno (`renan.dyas01@gmail.com`).

## Variáveis obrigatórias

### queue-api
- `DATABASE_URL`
- `JWT_SECRET`
- `JWT_ISSUER`
- `JWT_AUDIENCE`
- `OPS_API_KEY`
- `WORKER_API_KEY`
- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
- `MERCADO_PAGO_ACCESS_TOKEN`
- `MERCADO_PAGO_WEBHOOK_SECRET`
- `MERCADO_PAGO_SUBSCRIPTION_PLAN_ID`
- `DEBUG_LOG_DIR`

### codex-worker
- `QUEUE_API_BASE_URL`
- `WORKER_API_KEY`
- `WORKER_ID`
- `TOPUP_RECONCILIATION_INTERVAL_MS`
- `REAL_ADS_ENABLED=true`
- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
- `DEBUG_LOG_DIR`

## Precheck (antes do deploy)
1. `auth-api` saudável.
2. `queue-api` saudável (`/health` e `/ready`).
3. `codex-worker` com heartbeat recente (`/v1/ops/worker-health`).
4. Banco com conectividade ok.
5. Credenciais Mercado Pago e Meta válidas.

## Backup obrigatório
1. Backup remoto dos `.env` de `auth-api`, `queue-api`, `codex-worker`.
2. Dump SQL das tabelas:
- `wallet_accounts`
- `wallet_ledger`
- `billing_topups`
- `billing_subscriptions`

## Deploy
1. Aplicar migration SQL (`queue-api/sql/002_billing_wallet.sql`).
2. Publicar `queue-api`.
3. Publicar `codex-worker`.
4. Publicar app Expo de release com `EXPO_PUBLIC_REQUIRE_QUEUE_API=true`.

## Postcheck
1. Criar topup PIX teste (`POST /v1/billing/topups/pix`) e validar retorno `pending`.
2. Simular webhook Mercado Pago e validar transição idempotente.
3. Validar `GET /v1/billing/wallet` com saldo atualizado após aprovação.
4. Criar pedido Ads e validar:
- `queued` quando plano ativo + saldo suficiente.
- `waiting_payment` com `missing_plan` ou `insufficient_balance`.
5. Validar ações de campanha:
- `pause`
- `resume`
- `stop` (terminal; não permite retomada)

## Rollback
1. Se healthcheck pós-deploy falhar:
- restaurar artefatos da versão anterior de `queue-api` e `codex-worker`;
- restaurar `.env` de backup.
2. Em falha de migration:
- rollback da migration apenas se ainda não houver escrita de ledger produtiva.
- nunca apagar histórico financeiro (`wallet_ledger`).

## Operação diária (cliente 1)
1. Monitorar logs JSONL UTC em `DEBUG_LOG_DIR`.
2. Reconciliar topups pendentes (worker faz polling automático a cada 60s).
3. Se necessário, forçar reconciliação via endpoint ops:
- `POST /v1/ops/billing/topups/reconcile`
4. Conferir erros recorrentes e incidentes:
- L1: 3 ocorrências/15 min
- L2: 5 ocorrências/15 min + relatório `incident-*.md`
- L3: 8 ocorrências/15 min com trace completo
