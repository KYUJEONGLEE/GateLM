#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-distributed-lib.sh
source "${SCRIPT_DIR}/perf-distributed-lib.sh"

[[ "${1:-}" == "--role" && $# -eq 2 ]] || \
  perf_fail "Usage: bash scripts/perf-distributed-down.sh --role <data|gateway|mock>"
role="$2"
case "${role}" in data|gateway|mock) ;; *) perf_fail "Unknown distributed role: ${role}" ;; esac

perf_check_docker
dist_load_env
dist_validate_env
dist_assert_role_host "${role}"

read -r -a services <<< "$(dist_role_services "${role}")"
dist_compose --profile "${role}" stop "${services[@]}"
perf_log "Stopped distributed ${role} containers without deleting volumes or images."
