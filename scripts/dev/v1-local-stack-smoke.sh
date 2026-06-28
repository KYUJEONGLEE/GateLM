#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

POSTGRES_PORT="${POSTGRES_PORT:-5432}"
REDIS_PORT="${REDIS_PORT:-6379}"
MOCK_PROVIDER_PORT="${MOCK_PROVIDER_PORT:-8090}"
if [[ -z "${GATEWAY_PORT:-}" ]]; then
  GATEWAY_PORT="$((18080 + RANDOM % 1000))"
fi

DATABASE_URL="${DATABASE_URL:-postgresql://gatelm:gatelm@localhost:${POSTGRES_PORT}/gatelm?schema=public}"
REDIS_URL="${REDIS_URL:-redis://localhost:${REDIS_PORT}}"
MOCK_PROVIDER_BASE_URL="${MOCK_PROVIDER_BASE_URL:-http://localhost:${MOCK_PROVIDER_PORT}}"
GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://localhost:${GATEWAY_PORT}}"

DEMO_TENANT_ID="${GATELM_DEMO_TENANT_ID:-00000000-0000-4000-8000-000000000100}"
DEMO_PROJECT_ID="${GATELM_DEMO_PROJECT_ID:-00000000-0000-4000-8000-000000000200}"
DEMO_APPLICATION_ID="${GATELM_DEMO_APPLICATION_ID:-00000000-0000-4000-8000-000000000300}"

SMOKE_RATE_LIMIT_LIMIT="${GATELM_LOCAL_STACK_RATE_LIMIT_LIMIT:-4}"
RUN_ID="${GATELM_LOCAL_STACK_RUN_ID:-local_stack_$(date +%Y%m%d%H%M%S)}"
RUN_ID="$(printf "%s" "${RUN_ID}" | tr -c 'A-Za-z0-9_-' '_')"

GATEWAY_PID=""
LOG_DIR="${REPO_ROOT}/.tmp/local-stack-smoke"
GATEWAY_LOG="${LOG_DIR}/gateway-${RUN_ID}.log"

log_section() {
  printf "\n== %s ==\n" "$1"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf "Missing required command: %s\n" "$1" >&2
    exit 1
  fi
}

wait_until() {
  local label="$1"
  local attempts="$2"
  shift 2

  for _ in $(seq 1 "${attempts}"); do
    if "$@" >/dev/null 2>&1; then
      printf "%s ready\n" "${label}"
      return 0
    fi
    sleep 1
  done

  printf "%s did not become ready in time\n" "${label}" >&2
  return 1
}

wait_http() {
  local label="$1"
  local endpoint="$2"
  wait_until "${label}" 60 curl -fsS "${endpoint}"
}

cleanup() {
  local exit_code=$?
  if [[ -n "${GATEWAY_PID}" ]]; then
    if kill -0 "${GATEWAY_PID}" >/dev/null 2>&1; then
      kill "${GATEWAY_PID}" >/dev/null 2>&1 || true
      wait "${GATEWAY_PID}" >/dev/null 2>&1 || true
    fi
  fi

  if [[ ${exit_code} -ne 0 && -f "${GATEWAY_LOG}" ]]; then
    printf "\nGateway log tail (%s):\n" "${GATEWAY_LOG}" >&2
    tail -n 120 "${GATEWAY_LOG}" >&2 || true
  fi

  exit "${exit_code}"
}
trap cleanup EXIT

require_command docker
require_command go
require_command curl

log_section "GateLM v1 Local Stack Smoke"
printf "Run ID: %s\n" "${RUN_ID}"
printf "Gateway: %s\n" "${GATEWAY_BASE_URL}"
printf "Mock Provider: %s\n" "${MOCK_PROVIDER_BASE_URL}"
printf "Rate limit: %s requests / 60s fixed window\n" "${SMOKE_RATE_LIMIT_LIMIT}"

log_section "Start Docker dependencies"
docker compose up -d postgres redis mock-provider

wait_until "Postgres" 60 docker compose exec -T postgres pg_isready -U gatelm -d gatelm
wait_until "Redis" 60 docker compose exec -T redis redis-cli ping
wait_http "Mock Provider" "${MOCK_PROVIDER_BASE_URL}/healthz"

log_section "Apply migrations and seed"
migration_files=("${REPO_ROOT}"/db/migrations/*.sql)
cat "${migration_files[@]}" "${REPO_ROOT}/db/seeds/001_seed_p0_demo_data.sql" \
  | docker compose exec -T postgres psql -U gatelm -d gatelm -v ON_ERROR_STOP=1 >/dev/null

log_section "Reset local smoke data"
docker compose exec -T postgres psql -U gatelm -d gatelm -v ON_ERROR_STOP=1 >/dev/null <<SQL
delete from gateway_rate_limit_counters
where tenant_id = '${DEMO_TENANT_ID}'
  and application_id = '${DEMO_APPLICATION_ID}';

delete from p0_llm_invocation_logs
where tenant_id = '${DEMO_TENANT_ID}'
  and project_id = '${DEMO_PROJECT_ID}';
SQL

curl -fsS -X POST "${MOCK_PROVIDER_BASE_URL}/__mock/reset" >/dev/null
printf "PostgreSQL counters/logs and Mock Provider stats reset for local smoke scope.\n"

log_section "Start Gateway server"
if curl -fsS "${GATEWAY_BASE_URL}/healthz" >/dev/null 2>&1; then
  printf "Gateway endpoint already responds at %s before this smoke starts its own server.\n" "${GATEWAY_BASE_URL}" >&2
  printf "Stop the existing Gateway process, or rerun with another GATEWAY_PORT/GATEWAY_BASE_URL.\n" >&2
  exit 1
fi

mkdir -p "${LOG_DIR}"
(
  cd "${REPO_ROOT}/apps/gateway-core"
  env \
    GATEWAY_PORT="${GATEWAY_PORT}" \
    DATABASE_URL="${DATABASE_URL}" \
    REDIS_URL="${REDIS_URL}" \
    MOCK_PROVIDER_BASE_URL="${MOCK_PROVIDER_BASE_URL}" \
    GATEWAY_DEFAULT_PROVIDER="${GATEWAY_DEFAULT_PROVIDER:-mock}" \
    GATEWAY_DEFAULT_MODEL="${GATEWAY_DEFAULT_MODEL:-mock-balanced}" \
    GATEWAY_LOW_COST_MODEL="${GATEWAY_LOW_COST_MODEL:-mock-fast}" \
    GATEWAY_HIGH_QUALITY_MODEL="${GATEWAY_HIGH_QUALITY_MODEL:-mock-smart}" \
    GATEWAY_RATE_LIMIT_ENABLED="true" \
    GATEWAY_RATE_LIMIT_WINDOW_SECONDS="60" \
    GATEWAY_RATE_LIMIT_LIMIT="${SMOKE_RATE_LIMIT_LIMIT}" \
    GATEWAY_RUNTIME_CONFIG_HASH="hash_runtime_config_${RUN_ID}" \
    GATEWAY_SECURITY_POLICY_HASH="hash_security_policy_${RUN_ID}" \
    GATEWAY_ROUTING_POLICY_HASH="hash_routing_policy_${RUN_ID}" \
    GATEWAY_CACHE_POLICY_HASH="hash_cache_policy_${RUN_ID}" \
    GATEWAY_EXACT_CACHE_KEY_SECRET="cache_key_secret_${RUN_ID}" \
    GATELM_DEMO_TENANT_ID="${DEMO_TENANT_ID}" \
    GATELM_DEMO_PROJECT_ID="${DEMO_PROJECT_ID}" \
    GATELM_DEMO_APPLICATION_ID="${DEMO_APPLICATION_ID}" \
    go run ./cmd/gateway
) >"${GATEWAY_LOG}" 2>&1 &
GATEWAY_PID=$!

wait_http "Gateway healthz" "${GATEWAY_BASE_URL}/healthz"
wait_http "Gateway readyz" "${GATEWAY_BASE_URL}/readyz"

log_section "Run local stack integration smoke"
(
  cd "${REPO_ROOT}/apps/gateway-core"
  env \
    GATELM_LOCAL_STACK_SMOKE="1" \
    GATELM_LOCAL_STACK_RUN_ID="${RUN_ID}" \
    GATEWAY_BASE_URL="${GATEWAY_BASE_URL}" \
    MOCK_PROVIDER_BASE_URL="${MOCK_PROVIDER_BASE_URL}" \
    GATELM_DEMO_PROJECT_ID="${DEMO_PROJECT_ID}" \
    GATELM_DEMO_API_KEY="${GATELM_DEMO_API_KEY:-glm_api_test_redacted}" \
    GATELM_DEMO_APP_TOKEN="${GATELM_DEMO_APP_TOKEN:-glm_app_token_test_redacted}" \
    go test ./test/integration -run TestGatewayLocalStackSmoke -v
)

log_section "Done"
printf "Local stack smoke passed.\n"
printf "Gateway log: %s\n" "${GATEWAY_LOG}"
