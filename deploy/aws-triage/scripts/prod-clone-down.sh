#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/prod-clone-lib.sh
source "${SCRIPT_DIR}/prod-clone-lib.sh"

role=""
while (( $# > 0 )); do
  case "$1" in
    --role)
      [[ $# -ge 2 ]] || clone_fail "--role requires edge, gateway, data, rag, or ai."
      role="$2"
      shift 2
      ;;
    *) clone_fail "Unknown option: $1" ;;
  esac
done
case "${role}" in edge|gateway|data|rag|ai) ;; *) clone_fail "A valid --role is required." ;; esac

perf_check_docker
clone_load_env
clone_validate_env
read -r -a services <<< "$(clone_role_services "${role}")"
clone_compose --profile "${role}" stop "${services[@]}"
clone_compose --profile "${role}" rm -f "${services[@]}"
clone_log "Stopped ${role} without deleting production-clone volumes."
