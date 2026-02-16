#!/usr/bin/env bash
set -euo pipefail

AUTH_BASE_URL="${AUTH_BASE_URL:-http://68.183.49.208:3333}"
QUEUE_BASE_URL="${QUEUE_BASE_URL:-http://68.183.49.208:3334}"
OPS_API_KEY="${OPS_API_KEY:-}"

if [[ -z "${OPS_API_KEY}" ]]; then
  echo "ERROR: OPS_API_KEY não definido"
  exit 1
fi

auth_health=$(curl -fsS "${AUTH_BASE_URL}/health")
queue_health=$(curl -fsS "${QUEUE_BASE_URL}/health")
ready=$(curl -fsS "${QUEUE_BASE_URL}/ready")
worker_health=$(curl -fsS "${QUEUE_BASE_URL}/v1/ops/worker-health" -H "x-api-key: ${OPS_API_KEY}")
metrics=$(curl -fsS "${QUEUE_BASE_URL}/v1/ops/metrics" -H "x-api-key: ${OPS_API_KEY}")
queued_count=$(curl -fsS "${QUEUE_BASE_URL}/v1/ops/orders?status=queued" -H "x-api-key: ${OPS_API_KEY}" | node -e 'const x=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String(Array.isArray(x)?x.length:0));')
in_progress_count=$(curl -fsS "${QUEUE_BASE_URL}/v1/ops/orders?status=in_progress" -H "x-api-key: ${OPS_API_KEY}" | node -e 'const x=JSON.parse(require("fs").readFileSync(0,"utf8")); process.stdout.write(String(Array.isArray(x)?x.length:0));')

echo "auth_health=${auth_health}"
echo "queue_health=${queue_health}"
echo "queue_ready=${ready}"
echo "queued=${queued_count} in_progress=${in_progress_count}"
echo "metrics=${metrics}"
echo "worker_health=${worker_health}"
