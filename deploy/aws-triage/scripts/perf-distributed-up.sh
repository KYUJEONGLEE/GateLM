#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-distributed-lib.sh
source "${SCRIPT_DIR}/perf-distributed-lib.sh"

role=""
build_images=false
bootstrap=false
while (( $# > 0 )); do
  case "$1" in
    --role)
      [[ $# -ge 2 ]] || perf_fail "--role requires data, gateway, or mock."
      role="$2"
      shift 2
      ;;
    --build)
      build_images=true
      shift
      ;;
    --bootstrap)
      bootstrap=true
      shift
      ;;
    *) perf_fail "Unknown option: $1" ;;
  esac
done

case "${role}" in data|gateway|mock) ;; *) perf_fail "--role must be data, gateway, or mock." ;; esac
[[ "${bootstrap}" == "false" || "${role}" == "data" ]] || \
  perf_fail "--bootstrap is valid only for the data role."

perf_check_docker
dist_load_env
dist_validate_env
dist_assert_git_sha
dist_assert_role_host "${role}"
dist_validate_compose "${role}"

case "${role}" in
  mock)
    perf_log "Pulling and starting the pinned Mock Provider..."
    dist_compose --profile mock pull mock-provider
    dist_compose --profile mock up -d mock-provider
    dist_wait_for_service mock mock-provider
    ;;
  data)
    if [[ "${build_images}" == "true" ]]; then
      perf_log "Building the Control Plane image from the verified Git SHA..."
      dist_compose --profile data build control-plane-api
    fi
    perf_log "Starting isolated PostgreSQL and Redis..."
    dist_compose --profile data up -d postgres redis
    dist_wait_for_service data postgres
    dist_wait_for_service data redis

    if [[ "${bootstrap}" == "true" ]]; then
      perf_log "Applying Control Plane migrations to the distributed performance database..."
      if ! dist_compose --profile data run --rm --no-deps control-plane-api \
        ./node_modules/.bin/prisma migrate deploy >/dev/null; then
        perf_fail "Control Plane migration failed."
      fi

      perf_log "Applying Gateway and dashboard compatibility tables..."
      dist_apply_sql_file "${AWS_TRIAGE_DIR}/migrations/001_gateway_runtime_tables.sql"
      dist_apply_sql_file "${AWS_TRIAGE_DIR}/migrations/003_add_p0_invocation_log_ttft.sql"
      dist_apply_sql_file "${AWS_TRIAGE_DIR}/migrations/004_add_p0_dashboard_rollup_indexes.sql"
      dist_apply_sql_file "${AWS_TRIAGE_DIR}/migrations/005_prepare_p0_monthly_partitioning.sql"
      dist_apply_sql_file "${REPO_ROOT}/db/migrations/012_create_model_pricing_catalog_compat.sql"
      dist_apply_sql_file "${REPO_ROOT}/db/migrations/013_seed_openai_canonical_pricing_aliases.sql"
      dist_apply_sql_file "${REPO_ROOT}/db/seeds/002_seed_dashboard_pricing_catalog.sql"

      perf_log "Publishing the isolated Mock RuntimeSnapshot..."
      if ! dist_compose --profile data run --rm --no-deps \
        -e NODE_ENV=development \
        -e GATELM_DEPLOYMENT_ENV=perf \
        -e GATELM_DEMO_PROVIDER_MODE=mock \
        -e GATELM_DEMO_MOCK_PROVIDER_BASE_URL="$(dist_mock_base_url)" \
        -e GATELM_PERF_RUNTIME_RATE_LIMIT_LIMIT="${GATELM_PERF_RUNTIME_RATE_LIMIT_LIMIT}" \
        control-plane-api node dist/prisma/seed.js >/dev/null 2>&1; then
        perf_fail "Mock bootstrap failed. Output was hidden to avoid credential disclosure."
      fi

      snapshot_count="$(dist_psql -tA -c "select count(*) from active_runtime_snapshots where \"tenantId\" = '${GATELM_DEMO_TENANT_ID}'::uuid and \"projectId\" = '${GATELM_DEMO_PROJECT_ID}'::uuid and \"applicationId\" = '${GATELM_DEMO_APPLICATION_ID}'::uuid;")"
      [[ "$(perf_trim "${snapshot_count}")" == "1" ]] || \
        perf_fail "Bootstrap did not create exactly one active RuntimeSnapshot."
    fi

    perf_log "Starting the Control Plane..."
    dist_compose --profile data up -d --force-recreate control-plane-api
    dist_wait_for_service data control-plane-api
    ;;
  gateway)
    if [[ "${build_images}" == "true" ]]; then
      perf_log "Building the Gateway image from the verified Git SHA..."
      dist_compose --profile gateway build gateway-core
    fi
    perf_log "Starting the dedicated Gateway node..."
    dist_compose --profile gateway up -d --force-recreate gateway-core
    dist_wait_for_service gateway gateway-core
    perf_wait_for_http "Gateway readiness" "$(dist_gateway_base_url)/readyz" 90
    ;;
esac

perf_log "Distributed ${role} role is ready."
