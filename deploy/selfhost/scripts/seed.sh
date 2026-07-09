#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/selfhost/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

gatelm_log "Starting GateLM self-host demo seed."
gatelm_load_env
gatelm_fail "Demo seed is disabled for self-host/prod-like deployments. Create real tenants, projects, applications, Gateway API keys, provider connections, and a published RuntimeSnapshot through the Console or admin API."
gatelm_require_env_vars \
  POSTGRES_USER \
  POSTGRES_PASSWORD \
  POSTGRES_DB \
  GATELM_DEMO_PROVIDER_MODE \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN \
  GATELM_DEMO_TENANT_ID \
  GATELM_DEMO_PROJECT_ID \
  GATELM_DEMO_APPLICATION_ID \
  GATELM_DEMO_API_KEY_ID \
  GATELM_DEMO_APP_TOKEN_ID
gatelm_require_default_demo_ids
gatelm_warn_placeholder_values \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN
gatelm_check_docker
gatelm_validate_compose

gatelm_wait_for_postgres

gatelm_log "Seeding demo tenant, project, application, credentials, provider, and RuntimeSnapshot."
if ! gatelm_compose run --rm --no-deps \
  -e GATELM_DEMO_PROVIDER_MODE \
  -e GATELM_DEMO_API_KEY \
  -e GATELM_DEMO_APP_TOKEN \
  -e GATELM_DEMO_OPENAI_BASE_URL \
  -e GATELM_DEMO_OPENAI_LOW_COST_MODEL \
  -e GATELM_DEMO_OPENAI_BALANCED_MODEL \
  control-plane-api \
  node dist/prisma/seed.js >/dev/null 2>&1; then
  gatelm_fail "Demo seed failed. Run migrate.sh first, then retry. Output is hidden so credentials and connection strings are not printed."
fi

if ! active_snapshot_count="$(
  gatelm_compose exec -T postgres psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tA -v ON_ERROR_STOP=1 \
    -c "select count(*) from active_runtime_snapshots where \"tenantId\" = '${GATELM_DEMO_TENANT_ID}'::uuid and \"projectId\" = '${GATELM_DEMO_PROJECT_ID}'::uuid and \"applicationId\" = '${GATELM_DEMO_APPLICATION_ID}'::uuid;" 2>/dev/null
)"; then
  gatelm_fail "Demo seed verification could not query active_runtime_snapshots. Run migrate.sh first, then retry seed.sh."
fi
active_snapshot_count="$(gatelm_trim "${active_snapshot_count}")"

if [[ "${active_snapshot_count}" != "1" ]]; then
  gatelm_fail "Demo seed completed, but the active RuntimeSnapshot pointer was not found. Re-run seed.sh; if it repeats, check control-plane-api image version."
fi

gatelm_log "Demo seed finished. Next run: bash scripts/smoke-test.sh"
