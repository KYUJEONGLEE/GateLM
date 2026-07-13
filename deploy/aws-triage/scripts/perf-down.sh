#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${SCRIPT_DIR}/perf-lib.sh"

perf_check_docker
perf_load_env
perf_validate_env
perf_validate_compose

perf_log "Stopping only the ${PERF_PROJECT_NAME} containers..."
perf_compose stop
perf_log "Performance containers stopped. The isolated PostgreSQL and Redis volumes were preserved."
perf_log "No normal-stack container or volume was changed."
