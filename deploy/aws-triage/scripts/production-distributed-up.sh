#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/production-distributed-lib.sh
source "${SCRIPT_DIR}/production-distributed-lib.sh"

role=""
build_images=false
while (( $# > 0 )); do
  case "$1" in
    --role)
      [[ $# -ge 2 ]] || production_fail "--role requires edge, gateway, data, ai, or pii."
      role="$2"
      shift 2
      ;;
    --build)
      build_images=true
      shift
      ;;
    *) production_fail "Unknown option: $1" ;;
  esac
done
case "${role}" in edge|gateway|data|ai|pii) ;; *) production_fail "A valid --role is required." ;; esac

bash "${SCRIPT_DIR}/production-distributed-preflight.sh" --role "${role}"
production_load_env

read -r -a services <<< "$(production_role_services "${role}")"
if [[ "${build_images}" == "true" ]]; then
  read -r -a build_services <<< "$(production_role_build_services "${role}")"
  production_log "Building ${role} images from exact source ${GATELM_PRODUCTION_DISTRIBUTED_SOURCE_SHA}."
  production_compose "${role}" build "${build_services[@]}"
fi

production_log "Starting ${role}: ${services[*]}"
if [[ "${role}" == "data" ]]; then
  infrastructure_services=(postgres redis)
  application_services=(control-plane-api chat-api rag-worker)
  production_compose "${role}" up -d "${infrastructure_services[@]}"
  for service in "${infrastructure_services[@]}"; do
    production_wait_for_service "${role}" "${service}"
  done
  production_compose "${role}" up -d --force-recreate "${application_services[@]}"
else
  production_compose "${role}" up -d --force-recreate "${services[@]}"
fi
for service in "${services[@]}"; do
  production_wait_for_service "${role}" "${service}"
done

production_log "${role} role is healthy."
