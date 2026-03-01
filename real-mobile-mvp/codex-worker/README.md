# codex-worker

Worker que consome a fila da Queue API e processa pedidos.

## Setup

```bash
cp .env.example .env
npm install
npm start
```

## Variáveis

- `QUEUE_API_BASE_URL`
- `WORKER_API_KEY`
- `WORKER_ID`
- `POLL_INTERVAL_MS`
- `TOPUP_RECONCILIATION_INTERVAL_MS`
- `CLAIM_LEASE_SECONDS`
- `VIDEO_EDITOR_API_BASE_URL`
- `VIDEO_EDITOR_PUBLIC_BASE_URL`
- `SITE_BUILDER_API_BASE_URL`
- `DEBUG_LOG_DIR`
- `REAL_ADS_ENABLED`
- `META_ACCESS_TOKEN`
- `META_AD_ACCOUNT_ID`
- `META_GRAPH_VERSION`
