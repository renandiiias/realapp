# queue-api

API da fila de pedidos (cliente + ops + worker), com Postgres.

## Setup

```bash
cp .env.example .env
npm install
npm run db:migrate
npm start
```

## Endpoints cliente

- `GET /v1/entitlements/me`
- `POST /v1/entitlements/me`
- `GET /v1/billing/wallet`
- `POST /v1/billing/topups/pix`
- `GET /v1/billing/topups/:topupId`
- `POST /v1/orders`
- `PATCH /v1/orders/:id`
- `GET /v1/orders`
- `GET /v1/orders/:id`
- `POST /v1/orders/:id/submit`
- `POST /v1/orders/:id/info`
- `POST /v1/approvals/:deliverableId`
- `POST /v1/ads/publications/:orderId/pause`
- `POST /v1/ads/publications/:orderId/resume`
- `POST /v1/ads/publications/:orderId/stop`

## Endpoints ops/worker

- `POST /v1/ops/orders/claim`
- `POST /v1/ops/orders/:id/event`
- `POST /v1/ops/orders/:id/deliverables`
- `POST /v1/ops/orders/:id/complete`
- `POST /v1/ops/orders/:id/requeue`
- `POST /v1/ops/orders/:id/status`
- `GET /v1/ops/orders`
- `GET /v1/ops/customers`
- `GET /v1/ops/worker-health`
- `POST /v1/ops/worker/heartbeat`
- `GET /v1/ops/metrics`
- `POST /v1/ops/orders/:id/debit-ads-budget`
- `POST /v1/ops/billing/topups/reconcile`

## Webhooks

- `POST /webhook/mercadopago` (eventos `payment` e `preapproval`)
