#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${SCRIPT_DIR}/perf-lib.sh"

build_images=false
case "${1:-}" in
  "") ;;
  --build) build_images=true ;;
  *) perf_fail "Unknown option: $1. Supported option: --build" ;;
esac

perf_check_docker
perf_load_env
perf_validate_env
perf_validate_compose

if [[ "${build_images}" == "true" ]]; then
  perf_log "Building performance runtime images..."
  perf_compose build control-plane-api gateway-core ai-service
fi

perf_log "Starting isolated PostgreSQL, Redis, and Mock Provider..."
perf_compose up -d postgres redis mock-provider
perf_wait_for_service postgres
perf_wait_for_service redis
perf_wait_for_service mock-provider
perf_assert_isolated_postgres

perf_log "Applying Control Plane migrations to the isolated database..."
if ! perf_compose run --rm --no-deps control-plane-api \
  ./node_modules/.bin/prisma migrate deploy >/dev/null; then
  perf_fail "Control Plane migration failed. No normal-stack database was touched."
fi

apply_sql_file() {
  local sql_file="$1"
  [[ -f "${sql_file}" ]] || perf_fail "SQL file not found: ${sql_file}"
  # PostgreSQL variables are intentionally expanded inside the container.
  # shellcheck disable=SC2016
  if ! perf_compose exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < "${sql_file}"; then
    perf_fail "SQL migration failed: ${sql_file}"
  fi
}

perf_log "Applying Gateway and dashboard compatibility tables..."
apply_sql_file "${AWS_TRIAGE_DIR}/migrations/001_gateway_runtime_tables.sql"
apply_sql_file "${REPO_ROOT}/db/migrations/012_create_model_pricing_catalog_compat.sql"
apply_sql_file "${REPO_ROOT}/db/migrations/013_seed_openai_canonical_pricing_aliases.sql"
apply_sql_file "${REPO_ROOT}/db/seeds/002_seed_dashboard_pricing_catalog.sql"

perf_assert_isolated_postgres
perf_log "Publishing the isolated Mock RuntimeSnapshot..."
if ! perf_compose run --rm --no-deps \
  -e NODE_ENV=development \
  -e GATELM_DEPLOYMENT_ENV=perf \
  -e GATELM_DEMO_PROVIDER_MODE=mock \
  -e GATELM_DEMO_MOCK_PROVIDER_BASE_URL=http://mock-provider:8090 \
  control-plane-api node dist/prisma/seed.js >/dev/null 2>&1; then
  perf_fail "Mock bootstrap failed. Output was hidden to avoid credential disclosure."
fi

snapshot_count="$(perf_compose exec -T postgres psql \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -tA \
  -v ON_ERROR_STOP=1 \
  -c "select count(*) from active_runtime_snapshots where \"tenantId\" = '${GATELM_DEMO_TENANT_ID}'::uuid and \"projectId\" = '${GATELM_DEMO_PROJECT_ID}'::uuid and \"applicationId\" = '${GATELM_DEMO_APPLICATION_ID}'::uuid;")"
[[ "$(perf_trim "${snapshot_count}")" == "1" ]] || \
  perf_fail "The Mock bootstrap did not create exactly one active RuntimeSnapshot."

live_provider_count="$(perf_compose exec -T postgres psql \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  -tA \
  -v ON_ERROR_STOP=1 \
  -c "select count(*) from provider_connections where provider <> 'mock';")"
[[ "$(perf_trim "${live_provider_count}")" == "0" ]] || \
  perf_fail "A non-Mock Provider connection exists in the performance database."

perf_log "Starting the minimal performance runtime..."
perf_compose up -d ai-service
perf_compose up -d --force-recreate control-plane-api gateway-core
perf_wait_for_service ai-service
perf_wait_for_service control-plane-api
perf_wait_for_service gateway-core
perf_wait_for_http \
  "Gateway readiness" \
  "http://127.0.0.1:${AWS_TRIAGE_GATEWAY_PORT}/readyz"

bash "${SCRIPT_DIR}/perf-preflight.sh"

perf_log "Performance environment is ready at http://127.0.0.1:${AWS_TRIAGE_GATEWAY_PORT}."
perf_log "The normal AWS project, database, and Provider credentials were not modified."
