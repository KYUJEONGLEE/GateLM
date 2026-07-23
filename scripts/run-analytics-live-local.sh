#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKTREE_KEY="$(printf '%s' "$REPO_ROOT" | cksum | awk '{print $1}')"
RUNTIME_DIR="${TMPDIR:-/tmp}/gatelm-analytics-live-${WORKTREE_KEY}"
PID_FILE="$RUNTIME_DIR/apps.pid"
PREPARE_LOG="$RUNTIME_DIR/prepare.log"
CONTROL_PLANE_LOG="$RUNTIME_DIR/control-plane.log"
GATEWAY_LOG="$RUNTIME_DIR/gateway.log"
WEB_LOG="$RUNTIME_DIR/web.log"

WEB_PORT="${ANALYTICS_WEB_PORT:-3100}"
CONTROL_PLANE_PORT="${ANALYTICS_CONTROL_PLANE_PORT:-3301}"
GATEWAY_PORT="${ANALYTICS_GATEWAY_PORT:-8800}"
POSTGRES_PORT="${ANALYTICS_POSTGRES_PORT:-5432}"
REDIS_PORT="${ANALYTICS_REDIS_PORT:-6379}"
CLICKHOUSE_HTTP_PORT="${ANALYTICS_CLICKHOUSE_HTTP_PORT:-18123}"
CLICKHOUSE_NATIVE_PORT="${ANALYTICS_CLICKHOUSE_NATIVE_PORT:-19000}"

CLICKHOUSE_CONTAINER="${ANALYTICS_CLICKHOUSE_CONTAINER:-gatelm-analytics-live-clickhouse}"
CLICKHOUSE_VOLUME="${ANALYTICS_CLICKHOUSE_VOLUME:-gatelm-analytics-live-clickhouse-data}"
CLICKHOUSE_IMAGE="${ANALYTICS_CLICKHOUSE_IMAGE:-clickhouse/clickhouse-server:24.8}"
CLICKHOUSE_USER="${ANALYTICS_CLICKHOUSE_USER:-gatelm_local}"

DEMO_TENANT_ID="${GATELM_DEMO_TENANT_ID:-00000000-0000-4000-8000-000000000100}"
DATABASE_URL="${DATABASE_URL:-postgresql://gatelm:gatelm@127.0.0.1:${POSTGRES_PORT}/gatelm?schema=public}"
REDIS_URL="${REDIS_URL:-redis://127.0.0.1:${REDIS_PORT}}"
MOCK_PROVIDER_BASE_URL="${MOCK_PROVIDER_BASE_URL:-http://127.0.0.1:8090}"
WEB_PREWARM="${ANALYTICS_WEB_PREWARM:-true}"

MODE="start"
DETACH=false
CLEANED_UP=false

usage() {
  cat <<'EOF'
GateLM Analytics live project traffic local runner

Usage:
  bash scripts/run-analytics-live-local.sh
  bash scripts/run-analytics-live-local.sh --detach
  bash scripts/run-analytics-live-local.sh --stop
  bash scripts/run-analytics-live-local.sh --stop-all
  bash scripts/run-analytics-live-local.sh --load

Modes:
  (default)   Start Control Plane, Gateway, Web, and stream their logs.
  --detach    Start the same services and return to the shell.
  --stop      Stop only the three host application processes.
  --stop-all  Stop the host processes and the dedicated ClickHouse container.
              The ClickHouse named volume is preserved.
  --load      Send a bounded local load to the running Gateway.

Optional port overrides:
  ANALYTICS_WEB_PORT=3100
  ANALYTICS_CONTROL_PLANE_PORT=3301
  ANALYTICS_GATEWAY_PORT=8800
  ANALYTICS_POSTGRES_PORT=5432
  ANALYTICS_REDIS_PORT=6379
  ANALYTICS_CLICKHOUSE_HTTP_PORT=18123
  ANALYTICS_CLICKHOUSE_NATIVE_PORT=19000
  ANALYTICS_WEB_PREWARM=true

Load mode:
  GATELM_LOAD_API_KEY       Project API key. Prompted securely when omitted.
  GATELM_LOAD_REQUESTS      Total requests, default 120.
  GATELM_LOAD_CONCURRENCY   Parallel requests, default 8.
  GATELM_LOAD_MODEL         Requested model, default auto.

This runner never executes database reset, seed, or migration commands.
It does not call another repository helper script or a package-level dev
lifecycle. PostgreSQL and Redis must already be reachable; their existing
data is reused.
EOF
}

log() {
  printf '[analytics-live] %s\n' "$*"
}

die() {
  printf '[analytics-live] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

port_is_open() {
  local port="$1"
  (echo >/dev/tcp/127.0.0.1/"$port") >/dev/null 2>&1
}

wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-90}"
  local index

  for ((index = 1; index <= attempts; index += 1)); do
    if curl --fail --silent --show-error --max-time 2 "$url" >/dev/null 2>&1; then
      log "$name ready: $url"
      return 0
    fi
    sleep 1
  done

  return 1
}

prewarm_web_route() {
  local label="$1"
  local path="$2"
  local status

  status="$(
    curl --silent --show-error \
      --max-time 180 \
      --cookie "gatelm_session=analytics-local-prewarm" \
      --output /dev/null \
      --write-out '%{http_code}' \
      "http://127.0.0.1:${WEB_PORT}${path}" \
      2>/dev/null
  )" || status="000"

  case "$status" in
    2??|3??|4??)
      log "Web pre-warmed: ${label} (HTTP ${status})"
      ;;
    *)
      tail -n 120 "$WEB_LOG" >&2 || true
      die "Web pre-warm failed for ${label} with HTTP ${status}."
      ;;
  esac
}

prewarm_web_routes() {
  if [[ "$WEB_PREWARM" != "true" ]]; then
    log "Web pre-warm skipped (ANALYTICS_WEB_PREWARM=${WEB_PREWARM})."
    return
  fi

  log "Pre-warming primary Console routes. This can take about a minute on the first run."
  prewarm_web_route "대시보드" "/tenants/${DEMO_TENANT_ID}/dashboard"
  prewarm_web_route "분석 · 사용량" "/tenants/${DEMO_TENANT_ID}/analytics?tab=usage&range=15m"
  prewarm_web_route "프로젝트" "/tenants/${DEMO_TENANT_ID}/projects"
  prewarm_web_route "요청 로그" "/tenants/${DEMO_TENANT_ID}/request-logs"
  prewarm_web_route "직원" "/tenants/${DEMO_TENANT_ID}/employees"
  prewarm_web_route "Provider" "/tenants/${DEMO_TENANT_ID}/provider-connections"
  prewarm_web_route "API Key" "/tenants/${DEMO_TENANT_ID}/api-keys"
  prewarm_web_route "분석 live BFF" "/api/analytics/live-usage?tenantId=${DEMO_TENANT_ID}&range=15m"
}

random_secret() {
  node -e "process.stdout.write(require('node:crypto').randomBytes(32).toString('hex'))"
}

container_env_value() {
  local container="$1"
  local key="$2"
  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" 2>/dev/null \
    | sed -n "s/^${key}=//p" \
    | head -n 1
}

stop_pid_tree() {
  local pid="$1"
  if command -v taskkill.exe >/dev/null 2>&1; then
    taskkill.exe //PID "$pid" //T //F >/dev/null 2>&1 || true
  else
    kill "$pid" >/dev/null 2>&1 || true
  fi
}

windows_port_pid() {
  local port="$1"
  powershell.exe -NoProfile -Command \
    "\$owner = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess; if (\$owner) { Write-Output \$owner }" \
    | tr -d '\r\n'
}

record_service_listener() {
  local name="$1"
  local port="$2"
  local owner
  owner="$(windows_port_pid "$port")"
  [[ "$owner" =~ ^[1-9][0-9]*$ ]] || die "Could not resolve the Windows listener PID for $name on port $port."

  printf '%s-listener:%s:%s:listener\n' "$name" "$owner" "$port" >>"$PID_FILE"
}

stop_apps() {
  if [[ ! -f "$PID_FILE" ]]; then
    log "No application PID file found."
    return 0
  fi

  while IFS=: read -r name pid port kind; do
    [[ -n "${pid:-}" ]] || continue
    log "Stopping $name (PID $pid)"
    stop_pid_tree "$pid"
    if [[ "${kind:-launcher}" == "launcher" ]] && [[ -n "${port:-}" ]] && port_is_open "$port"; then
      local owner
      owner="$(windows_port_pid "$port")"
      if [[ "$owner" =~ ^[1-9][0-9]*$ ]]; then
        log "Stopping $name listener fallback (PID $owner)"
        stop_pid_tree "$owner"
      fi
    fi
  done < "$PID_FILE"

  rm -f "$PID_FILE"
}

cleanup_once() {
  if [[ "$CLEANED_UP" == "true" ]]; then
    return
  fi
  CLEANED_UP=true
  stop_apps
}

ensure_port_free() {
  local name="$1"
  local port="$2"
  if port_is_open "$port"; then
    die "$name port $port is already in use. Change its ANALYTICS_*_PORT value or stop the conflicting process."
  fi
}

start_service() {
  local name="$1"
  local log_file="$2"
  local port="$3"
  shift 3

  log "Starting $name"
  (
    cd "$REPO_ROOT"
    exec "$@"
  ) >"$log_file" 2>&1 &
  local pid=$!
  printf '%s:%s:%s:launcher\n' "$name" "$pid" "$port" >> "$PID_FILE"
}

ensure_clickhouse() {
  local exists=false
  if docker inspect "$CLICKHOUSE_CONTAINER" >/dev/null 2>&1; then
    exists=true
  fi

  if [[ "$exists" == "true" ]]; then
    CLICKHOUSE_USER="$(container_env_value "$CLICKHOUSE_CONTAINER" CLICKHOUSE_USER)"
    CLICKHOUSE_USER="${CLICKHOUSE_USER:-gatelm_local}"
    CLICKHOUSE_PASSWORD="${ANALYTICS_CLICKHOUSE_PASSWORD:-$(container_env_value "$CLICKHOUSE_CONTAINER" CLICKHOUSE_PASSWORD)}"
    [[ -n "$CLICKHOUSE_PASSWORD" ]] || die "Could not recover the dedicated ClickHouse password."

    if [[ "$(docker inspect --format '{{.State.Running}}' "$CLICKHOUSE_CONTAINER")" != "true" ]]; then
      log "Starting existing ClickHouse container $CLICKHOUSE_CONTAINER"
      docker start "$CLICKHOUSE_CONTAINER" >/dev/null
    fi
  else
    ensure_port_free "ClickHouse HTTP" "$CLICKHOUSE_HTTP_PORT"
    ensure_port_free "ClickHouse native" "$CLICKHOUSE_NATIVE_PORT"
    CLICKHOUSE_PASSWORD="${ANALYTICS_CLICKHOUSE_PASSWORD:-$(random_secret)}"

    log "Creating dedicated ClickHouse container and persistent named volume"
    docker run --detach \
      --name "$CLICKHOUSE_CONTAINER" \
      --restart unless-stopped \
      --publish "127.0.0.1:${CLICKHOUSE_HTTP_PORT}:8123" \
      --publish "127.0.0.1:${CLICKHOUSE_NATIVE_PORT}:9000" \
      --env CLICKHOUSE_DB=analytics \
      --env "CLICKHOUSE_USER=${CLICKHOUSE_USER}" \
      --env "CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD}" \
      --env CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1 \
      --volume "${CLICKHOUSE_VOLUME}:/var/lib/clickhouse" \
      "$CLICKHOUSE_IMAGE" >/dev/null
  fi

  local index
  for ((index = 1; index <= 90; index += 1)); do
    if curl --fail --silent --show-error \
      --user "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
      "http://127.0.0.1:${CLICKHOUSE_HTTP_PORT}/ping" >/dev/null 2>&1; then
      log "ClickHouse ready: http://127.0.0.1:${CLICKHOUSE_HTTP_PORT}"
      bootstrap_clickhouse
      return
    fi
    sleep 1
  done

  docker logs --tail 80 "$CLICKHOUSE_CONTAINER" >&2 || true
  die "ClickHouse did not become ready."
}

bootstrap_clickhouse() {
  log "Ensuring the local-only ClickHouse mirror and one-second rollup schema"
  docker exec --interactive "$CLICKHOUSE_CONTAINER" \
    clickhouse-client \
      --user "$CLICKHOUSE_USER" \
      --password "$CLICKHOUSE_PASSWORD" \
      --multiquery >/dev/null <<'SQL'
CREATE DATABASE IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.llm_invocations
(
    request_id String,
    tenant_id UUID,
    project_id UUID,
    application_id UUID,
    employee_identity_hash String,
    provider LowCardinality(String),
    model LowCardinality(String),
    provider_id String,
    model_id String,
    requested_model LowCardinality(String),
    model_ref LowCardinality(String),
    routing_reason LowCardinality(String),
    status LowCardinality(String),
    http_status UInt16,
    prompt_tokens UInt32,
    completion_tokens UInt32,
    total_tokens UInt32,
    cost_micro_usd Int64,
    saved_cost_micro_usd Nullable(Int64),
    latency_ms UInt64,
    provider_latency_ms Nullable(UInt64),
    gateway_internal_latency_ms UInt64,
    ttft_ms Nullable(UInt64),
    stream UInt8,
    cache_status LowCardinality(String),
    cache_type LowCardinality(String),
    routing_category LowCardinality(String),
    routing_difficulty LowCardinality(String),
    terminal_status LowCardinality(String),
    fallback_outcome LowCardinality(String),
    safety_outcome LowCardinality(String),
    budget_outcome LowCardinality(String),
    masking_action LowCardinality(String),
    provider_called UInt8,
    budget_scope_type LowCardinality(String),
    budget_scope_id String,
    budget_scope_resolved_by LowCardinality(String),
    created_at DateTime64(3, 'UTC'),
    ingested_at DateTime64(3, 'UTC'),
    ingest_version UInt64
)
ENGINE = ReplacingMergeTree(ingest_version)
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, request_id);

CREATE TABLE IF NOT EXISTS analytics.llm_invocations_by_time
AS analytics.llm_invocations
ENGINE = ReplacingMergeTree(ingest_version)
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, created_at, request_id);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.llm_invocations_by_time_mv
TO analytics.llm_invocations_by_time
AS
SELECT *
FROM analytics.llm_invocations;

CREATE TABLE IF NOT EXISTS analytics.llm_invocations_dashboard_second_rollup
(
    tenant_id UUID,
    bucket DateTime('UTC'),
    project_id UUID,
    application_id UUID,
    provider LowCardinality(String),
    model LowCardinality(String),
    requested_model LowCardinality(String),
    terminal_status LowCardinality(String),
    cache_outcome LowCardinality(String),
    cache_type LowCardinality(String),
    fallback_outcome LowCardinality(String),
    safety_outcome LowCardinality(String),
    budget_outcome LowCardinality(String),
    masking_action LowCardinality(String),
    routing_category LowCardinality(String),
    routing_difficulty LowCardinality(String),
    routing_reason LowCardinality(String),
    budget_scope_type LowCardinality(String),
    budget_scope_id String,
    budget_scope_resolved_by LowCardinality(String),
    latency_eligible UInt8,
    provider_latency_eligible UInt8,
    ttft_eligible UInt8,
    requests SimpleAggregateFunction(sum, UInt64),
    prompt_tokens SimpleAggregateFunction(sum, UInt64),
    completion_tokens SimpleAggregateFunction(sum, UInt64),
    total_tokens SimpleAggregateFunction(sum, UInt64),
    cost_micro_usd SimpleAggregateFunction(sum, Int64),
    saved_cost_micro_usd SimpleAggregateFunction(sum, Int64),
    saved_cost_known_requests SimpleAggregateFunction(sum, UInt64),
    system_error_requests SimpleAggregateFunction(sum, UInt64),
    stream_requests SimpleAggregateFunction(sum, UInt64),
    latency_sum_ms SimpleAggregateFunction(sum, UInt64),
    ttft_sum_ms SimpleAggregateFunction(sum, UInt64),
    last_created_at SimpleAggregateFunction(max, DateTime64(3, 'UTC')),
    latency_quantiles AggregateFunction(quantilesTDigest(0.50, 0.95, 0.99), UInt64),
    gateway_latency_quantiles AggregateFunction(quantilesTDigest(0.50, 0.95, 0.99), UInt64),
    provider_latency_quantiles AggregateFunction(quantilesTDigest(0.50, 0.95, 0.99), UInt64),
    ttft_quantiles AggregateFunction(quantilesTDigest(0.50, 0.95, 0.99), UInt64)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(bucket)
ORDER BY
(
    tenant_id,
    bucket,
    project_id,
    application_id,
    provider,
    model,
    requested_model,
    terminal_status,
    cache_outcome,
    cache_type,
    fallback_outcome,
    safety_outcome,
    budget_outcome,
    masking_action,
    routing_category,
    routing_difficulty,
    routing_reason,
    budget_scope_type,
    budget_scope_id,
    budget_scope_resolved_by,
    latency_eligible,
    provider_latency_eligible,
    ttft_eligible
);

CREATE MATERIALIZED VIEW IF NOT EXISTS analytics.llm_invocations_dashboard_second_rollup_mv
TO analytics.llm_invocations_dashboard_second_rollup
AS
SELECT
    tenant_id,
    toStartOfSecond(created_at, 'UTC') AS bucket,
    project_id,
    application_id,
    provider,
    model,
    requested_model,
    terminal_status,
    multiIf(
        cache_status = 'hit', 'hit',
        cache_status = 'miss', 'miss',
        cache_status = 'error', 'error',
        cache_status = 'bypass', 'bypassed',
        'not_used'
    ) AS cache_outcome,
    cache_type,
    fallback_outcome,
    safety_outcome,
    budget_outcome,
    masking_action,
    routing_category,
    routing_difficulty,
    routing_reason,
    budget_scope_type,
    budget_scope_id,
    budget_scope_resolved_by,
    toUInt8(terminal_status IN ('success', 'failed')) AS latency_eligible,
    toUInt8(terminal_status IN ('success', 'failed') AND provider_latency_ms IS NOT NULL) AS provider_latency_eligible,
    toUInt8(stream = 1 AND ttft_ms IS NOT NULL) AS ttft_eligible,
    count() AS requests,
    sum(toUInt64(prompt_tokens)) AS prompt_tokens,
    sum(toUInt64(completion_tokens)) AS completion_tokens,
    sum(toUInt64(total_tokens)) AS total_tokens,
    sum(cost_micro_usd) AS cost_micro_usd,
    sum(ifNull(saved_cost_micro_usd, 0)) AS saved_cost_micro_usd,
    countIf(src.saved_cost_micro_usd IS NOT NULL) AS saved_cost_known_requests,
    countIf(http_status >= 500 OR terminal_status = 'failed') AS system_error_requests,
    countIf(stream = 1) AS stream_requests,
    sum(latency_ms) AS latency_sum_ms,
    sum(ifNull(ttft_ms, 0)) AS ttft_sum_ms,
    max(created_at) AS last_created_at,
    quantilesTDigestState(0.50, 0.95, 0.99)(latency_ms) AS latency_quantiles,
    quantilesTDigestState(0.50, 0.95, 0.99)(gateway_internal_latency_ms) AS gateway_latency_quantiles,
    quantilesTDigestState(0.50, 0.95, 0.99)(ifNull(provider_latency_ms, 0)) AS provider_latency_quantiles,
    quantilesTDigestState(0.50, 0.95, 0.99)(ifNull(ttft_ms, 0)) AS ttft_quantiles
FROM analytics.llm_invocations AS src
GROUP BY
    tenant_id,
    bucket,
    project_id,
    application_id,
    provider,
    model,
    requested_model,
    terminal_status,
    cache_outcome,
    cache_type,
    fallback_outcome,
    safety_outcome,
    budget_outcome,
    masking_action,
    routing_category,
    routing_difficulty,
    routing_reason,
    budget_scope_type,
    budget_scope_id,
    budget_scope_resolved_by,
    latency_eligible,
    provider_latency_eligible,
    ttft_eligible;
SQL
}

prepare_node_runtime() {
  log "Preparing workspace libraries without DB mutation"
  : > "$PREPARE_LOG"

  (
    cd "$REPO_ROOT"
    corepack pnpm --filter @gatelm/tenant-content-crypto build
    corepack pnpm --filter @gatelm/rag-config build
  ) >>"$PREPARE_LOG" 2>&1 || {
    tail -n 100 "$PREPARE_LOG" >&2 || true
    die "Node runtime preparation failed."
  }
}

start_stack() {
  require_command node
  require_command corepack
  require_command go
  require_command docker
  require_command curl
  require_command tail
  require_command powershell.exe

  docker info >/dev/null 2>&1 || die "Docker Desktop is not running."
  [[ -d "$REPO_ROOT/node_modules" ]] || die "node_modules is missing. Run 'corepack pnpm install --frozen-lockfile' once."

  port_is_open "$POSTGRES_PORT" || die "PostgreSQL is not reachable on 127.0.0.1:${POSTGRES_PORT}. Start the existing data container first."
  port_is_open "$REDIS_PORT" || die "Redis is not reachable on 127.0.0.1:${REDIS_PORT}. Start the existing data container first."
  ensure_port_free "Control Plane" "$CONTROL_PLANE_PORT"
  ensure_port_free "Gateway" "$GATEWAY_PORT"
  ensure_port_free "Web" "$WEB_PORT"

  mkdir -p "$RUNTIME_DIR"
  if [[ -f "$PID_FILE" ]]; then
    die "A previous PID file exists at $PID_FILE. Run this script with --stop first."
  fi
  : > "$PID_FILE"
  trap cleanup_once EXIT INT TERM

  ensure_clickhouse
  prepare_node_runtime

  local control_plane_token="${ANALYTICS_CONTROL_PLANE_TOKEN:-$(random_secret)}"
  local observability_token="${ANALYTICS_OBSERVABILITY_TOKEN:-$(random_secret)}"
  local auth_state_secret="${ANALYTICS_AUTH_STATE_SECRET:-$(random_secret)}"
  local identity_hmac_secret="${ANALYTICS_IDENTITY_HMAC_SECRET:-$(random_secret)}"

  start_service "control-plane" "$CONTROL_PLANE_LOG" "$CONTROL_PLANE_PORT" \
    env \
      NODE_ENV=development \
      CONTROL_PLANE_PORT="$CONTROL_PLANE_PORT" \
      CONTROL_PLANE_WEB_ORIGIN="http://localhost:${WEB_PORT}" \
      CONTROL_PLANE_AUTH_COOKIE_SECURE=false \
      CONTROL_PLANE_AUTH_DEV_AUTO_VERIFY=true \
      CONTROL_PLANE_ADMIN_AUTH_MODE=session_cookie \
      CONTROL_PLANE_AUTH_STATE_SECRET="$auth_state_secret" \
      CONTROL_PLANE_INTERNAL_SERVICE_TOKEN="$control_plane_token" \
      GATELM_DEMO_MOCK_PROVIDER_BASE_URL="$MOCK_PROVIDER_BASE_URL" \
      DATABASE_URL="$DATABASE_URL" \
      REDIS_URL="$REDIS_URL" \
    corepack pnpm --filter @gatelm/control-plane-api exec nest start

  if ! wait_for_http "Control Plane" "http://127.0.0.1:${CONTROL_PLANE_PORT}/healthz" 120; then
    tail -n 120 "$CONTROL_PLANE_LOG" >&2 || true
    die "Control Plane failed to start."
  fi
  record_service_listener "control-plane" "$CONTROL_PLANE_PORT"

  start_service "gateway" "$GATEWAY_LOG" "$GATEWAY_PORT" \
    env \
      DEPLOYMENT_MODE=development \
      GATEWAY_PORT="$GATEWAY_PORT" \
      DATABASE_URL="$DATABASE_URL" \
      GATEWAY_LOG_DATABASE_URL="$DATABASE_URL" \
      REDIS_URL="$REDIS_URL" \
      GATEWAY_RUNTIME_SNAPSHOT_MODE=strict \
      GATEWAY_CONTROL_PLANE_BASE_URL="http://127.0.0.1:${CONTROL_PLANE_PORT}" \
      GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN="$control_plane_token" \
      GATEWAY_OBSERVABILITY_AUTH_REQUIRED=true \
      GATEWAY_OBSERVABILITY_INTERNAL_TOKEN="$observability_token" \
      GATEWAY_RATE_LIMIT_BACKEND=redis \
      GATEWAY_RATE_LIMIT_ALGORITHM=token_bucket \
      GATEWAY_CLICKHOUSE_ANALYTICS_ENABLED=true \
      GATEWAY_CLICKHOUSE_ANALYTICS_PERFORMANCE_READ_ENABLED=true \
      GATEWAY_CLICKHOUSE_URL="http://127.0.0.1:${CLICKHOUSE_HTTP_PORT}" \
      GATEWAY_CLICKHOUSE_DATABASE=analytics \
      GATEWAY_CLICKHOUSE_TABLE=llm_invocations \
      GATEWAY_CLICKHOUSE_USERNAME="$CLICKHOUSE_USER" \
      GATEWAY_CLICKHOUSE_PASSWORD="$CLICKHOUSE_PASSWORD" \
      GATEWAY_CLICKHOUSE_ANALYTICS_READ_USERNAME="$CLICKHOUSE_USER" \
      GATEWAY_CLICKHOUSE_ANALYTICS_READ_PASSWORD="$CLICKHOUSE_PASSWORD" \
      GATEWAY_CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET="$identity_hmac_secret" \
      GATEWAY_AI_SAFETY_SIDECAR_ENABLED=false \
      MOCK_PROVIDER_BASE_URL="$MOCK_PROVIDER_BASE_URL" \
      GATELM_DEMO_TENANT_ID="$DEMO_TENANT_ID" \
    go run ./apps/gateway-core/cmd/gateway

  if ! wait_for_http "Gateway" "http://127.0.0.1:${GATEWAY_PORT}/healthz" 120; then
    tail -n 120 "$GATEWAY_LOG" >&2 || true
    die "Gateway failed to start."
  fi
  record_service_listener "gateway" "$GATEWAY_PORT"

  local range_json
  range_json="$(node -e '
    const to = new Date(Math.floor(Date.now() / 1000) * 1000);
    const from = new Date(to.getTime() - 15 * 60 * 1000);
    process.stdout.write(JSON.stringify({ from: from.toISOString(), to: to.toISOString() }));
  ')"
  local range_from
  local range_to
  range_from="$(node -e "const value=${range_json}; process.stdout.write(value.from)")"
  range_to="$(node -e "const value=${range_json}; process.stdout.write(value.to)")"

  curl --fail --silent --show-error \
    --header "X-GateLM-Observability-Token: ${observability_token}" \
    "http://127.0.0.1:${GATEWAY_PORT}/api/analytics/live-usage?tenantId=${DEMO_TENANT_ID}&from=${range_from}&to=${range_to}" \
    >/dev/null || {
      tail -n 120 "$GATEWAY_LOG" >&2 || true
      die "Gateway live-usage probe failed."
    }
  log "Gateway live-usage probe passed."

  start_service "web" "$WEB_LOG" "$WEB_PORT" \
    env \
      NODE_ENV=development \
      GATELM_CONTROL_PLANE_BASE_URL="http://127.0.0.1:${CONTROL_PLANE_PORT}" \
      GATELM_CONTROL_PLANE_PORT="$CONTROL_PLANE_PORT" \
      GATELM_GATEWAY_BASE_URL="http://127.0.0.1:${GATEWAY_PORT}" \
      GATEWAY_PORT="$GATEWAY_PORT" \
      GATELM_GATEWAY_OBSERVABILITY_INTERNAL_TOKEN="$observability_token" \
      GATEWAY_OBSERVABILITY_INTERNAL_TOKEN="$observability_token" \
      GATELM_DEMO_TENANT_ID="$DEMO_TENANT_ID" \
    corepack pnpm --filter @gatelm/web exec next dev \
      --hostname 0.0.0.0 \
      --port "$WEB_PORT"

  if ! wait_for_http "Web" "http://127.0.0.1:${WEB_PORT}/" 180; then
    tail -n 120 "$WEB_LOG" >&2 || true
    die "Web failed to start."
  fi
  record_service_listener "web" "$WEB_PORT"
  prewarm_web_routes

  printf '\n'
  log "Local stack is ready."
  log "Analytics: http://localhost:${WEB_PORT}/tenants/${DEMO_TENANT_ID}/analytics?tab=usage&range=15m"
  log "Gateway:   http://localhost:${GATEWAY_PORT}"
  log "Logs:      $RUNTIME_DIR"
  log "No reset, seed, or migration command was executed."
  printf '\n'

  if [[ "$DETACH" == "true" ]]; then
    trap - EXIT INT TERM
    log "Detached. Stop apps with: bash scripts/run-analytics-live-local.sh --stop"
    return
  fi

  log "Streaming logs. Press Ctrl+C to stop the three host apps."
  tail -n 20 -F "$CONTROL_PLANE_LOG" "$GATEWAY_LOG" "$WEB_LOG"
}

run_load() {
  require_command curl
  require_command xargs
  require_command seq

  local gateway_url="http://127.0.0.1:${GATEWAY_PORT}"
  curl --fail --silent --show-error --max-time 2 "$gateway_url/healthz" >/dev/null \
    || die "Gateway is not reachable at $gateway_url. Start the stack first."

  if [[ -z "${GATELM_LOAD_API_KEY:-}" ]]; then
    read -r -s -p "Project API key: " GATELM_LOAD_API_KEY
    printf '\n'
    export GATELM_LOAD_API_KEY
  fi
  [[ -n "$GATELM_LOAD_API_KEY" ]] || die "Project API key is required."

  export GATELM_LOAD_GATEWAY_URL="$gateway_url"
  export GATELM_LOAD_MODEL="${GATELM_LOAD_MODEL:-auto}"
  local request_count="${GATELM_LOAD_REQUESTS:-120}"
  local concurrency="${GATELM_LOAD_CONCURRENCY:-8}"
  [[ "$request_count" =~ ^[1-9][0-9]*$ ]] || die "GATELM_LOAD_REQUESTS must be a positive integer."
  [[ "$concurrency" =~ ^[1-9][0-9]*$ ]] || die "GATELM_LOAD_CONCURRENCY must be a positive integer."
  ((request_count <= 5000)) || die "GATELM_LOAD_REQUESTS must not exceed 5000."
  ((concurrency <= 64)) || die "GATELM_LOAD_CONCURRENCY must not exceed 64."

  mkdir -p "$RUNTIME_DIR"
  local result_file="$RUNTIME_DIR/load-status-$(date +%s).txt"
  log "Sending $request_count requests with concurrency $concurrency"

  seq 1 "$request_count" \
    | xargs -P "$concurrency" -I{} bash -c '
        payload=$(printf "{\"model\":\"%s\",\"messages\":[{\"role\":\"user\",\"content\":\"analytics live local load request %s\"}],\"stream\":false}" "$GATELM_LOAD_MODEL" "$1")
        curl --silent --show-error \
          --max-time 30 \
          --output /dev/null \
          --write-out "%{http_code}\n" \
          --header "Authorization: Bearer ${GATELM_LOAD_API_KEY}" \
          --header "X-GateLM-Feature-Id: analytics-live-local" \
          --header "Content-Type: application/json" \
          --data "$payload" \
          "${GATELM_LOAD_GATEWAY_URL}/v1/chat/completions" \
          || printf "000\n"
      ' _ {} > "$result_file"

  log "HTTP status summary:"
  sort "$result_file" | uniq -c
  log "Open the usage tab and enable Live view. ClickHouse rollup can take a moment to reflect the final batch."
}

case "${1:-}" in
  "")
    MODE="start"
    ;;
  --detach)
    MODE="start"
    DETACH=true
    ;;
  --stop)
    MODE="stop"
    ;;
  --stop-all)
    MODE="stop-all"
    ;;
  --load)
    MODE="load"
    ;;
  -h|--help)
    usage
    exit 0
    ;;
  *)
    usage >&2
    die "Unknown argument: $1"
    ;;
esac

mkdir -p "$RUNTIME_DIR"

case "$MODE" in
  start)
    start_stack
    ;;
  stop)
    stop_apps
    ;;
  stop-all)
    stop_apps
    if docker inspect "$CLICKHOUSE_CONTAINER" >/dev/null 2>&1; then
      log "Stopping dedicated ClickHouse container; named volume is preserved."
      docker stop "$CLICKHOUSE_CONTAINER" >/dev/null
    fi
    ;;
  load)
    run_load
    ;;
esac
