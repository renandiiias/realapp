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
- `CLAIM_LEASE_SECONDS`
