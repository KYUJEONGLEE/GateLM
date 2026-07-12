#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${SCRIPT_DIR}/perf-lib.sh"

perf_check_docker
perf_load_env
perf_validate_env
perf_validate_compose
perf_assert_isolated_postgres
perf_wait_for_http \
  "Gateway readiness" \
  "http://127.0.0.1:${AWS_TRIAGE_GATEWAY_PORT}/readyz" \
  15
perf_assert_no_live_provider_credentials

if ! perf_compose exec -T control-plane-api node - < "${SCRIPT_DIR}/perf-preflight.mjs"; then
  perf_fail "Mock routing preflight failed. Do not run k6 against this environment."
fi

perf_log "Mock routing preflight passed."
