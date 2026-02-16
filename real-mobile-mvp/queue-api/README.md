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
- `POST /v1/orders`
- `PATCH /v1/orders/:id`
- `GET /v1/orders`
- `GET /v1/orders/:id`
- `POST /v1/orders/:id/submit`
- `POST /v1/orders/:id/info`
- `POST /v1/approvals/:deliverableId`

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
