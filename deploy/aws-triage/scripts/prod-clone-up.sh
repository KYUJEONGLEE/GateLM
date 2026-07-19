#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/prod-clone-lib.sh
source "${SCRIPT_DIR}/prod-clone-lib.sh"

role=""
build_images=false
while (( $# > 0 )); do
  case "$1" in
    --role)
      [[ $# -ge 2 ]] || clone_fail "--role requires edge, gateway1, gateway2, data, rag, or ai."
      role="$2"
      shift 2
      ;;
    --build)
      build_images=true
      shift
      ;;
    *) clone_fail "Unknown option: $1" ;;
  esac
done
case "${role}" in edge|gateway1|gateway2|data|rag|ai) ;; *) clone_fail "A valid --role is required." ;; esac

bash "${SCRIPT_DIR}/prod-clone-preflight.sh" --role "${role}"
clone_load_env

read -r -a services <<< "$(clone_role_services "${role}")"
profile="$(clone_role_profile "${role}")"
if [[ "${build_images}" == "true" ]]; then
  clone_log "Building ${role} images from exact source ${GATELM_PROD_CLONE_SOURCE_SHA}."
  clone_compose --profile "${profile}" build "${services[@]}"
fi

clone_log "Starting ${role}: ${services[*]}"
clone_compose --profile "${profile}" up -d --force-recreate "${services[@]}"
for service in "${services[@]}"; do
  clone_wait_for_service "${role}" "${service}"
done

clone_log "${role} role is healthy."
