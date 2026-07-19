#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/prod-clone-lib.sh
source "${SCRIPT_DIR}/prod-clone-lib.sh"

role=""
check_dependencies=false
while (( $# > 0 )); do
  case "$1" in
    --role)
      [[ $# -ge 2 ]] || clone_fail "--role requires edge, gateway1, gateway2, data, rag, or ai."
      role="$2"
      shift 2
      ;;
    --check-dependencies)
      check_dependencies=true
      shift
      ;;
    *) clone_fail "Unknown option: $1" ;;
  esac
done
case "${role}" in edge|gateway1|gateway2|data|rag|ai) ;; *) clone_fail "A valid --role is required." ;; esac

perf_check_docker
clone_load_env
clone_validate_env
clone_assert_role_host "${role}"
clone_assert_build_source "${role}"
clone_assert_role_secrets "${role}"
profile="$(clone_role_profile "${role}")"
clone_compose --profile "${profile}" config --quiet

free_kb="$(df -Pk "${GATELM_PROD_CLONE_BUILD_CONTEXT}" | awk 'NR == 2 {print $4}')"
[[ "${free_kb}" =~ ^[0-9]+$ && "${free_kb}" -ge 8388608 ]] || \
  clone_fail "At least 8 GiB of free disk is required for role ${role}."

if [[ "${role}" == "data" ]]; then
  clone_assert_db_attestation
  command -v aws >/dev/null 2>&1 || clone_fail "AWS CLI is required on the Data host."
  aws sts get-caller-identity --output text --query Account >/dev/null
  aws s3api head-bucket --bucket "${RAG_S3_BUCKET}" >/dev/null
fi

if [[ "${check_dependencies}" == "true" ]]; then
  case "${role}" in
    edge)
      clone_assert_tcp "Gateway 1 public data plane" "${GATELM_PROD_CLONE_GATEWAY_1_PRIVATE_IP}" 8080
      if [[ "${GATELM_PROD_CLONE_GATEWAY_COUNT}" == "2" ]]; then
        clone_assert_tcp "Gateway 2 public data plane" "${GATELM_PROD_CLONE_GATEWAY_2_PRIVATE_IP}" 8080
      fi
      clone_assert_tcp "Control Plane" "${GATELM_PROD_CLONE_DATA_PRIVATE_IP}" 3001
      clone_assert_tcp "Chat API" "${GATELM_PROD_CLONE_DATA_PRIVATE_IP}" 3003
      ;;
    gateway1|gateway2)
      clone_assert_tcp "Control Plane" "${GATELM_PROD_CLONE_DATA_PRIVATE_IP}" 3001
      clone_assert_tcp "PostgreSQL" "${GATELM_PROD_CLONE_DATA_PRIVATE_IP}" 5432
      clone_assert_tcp "Redis" "${GATELM_PROD_CLONE_DATA_PRIVATE_IP}" 6379
      clone_assert_tcp "AI Service" "${GATELM_PROD_CLONE_AI_PRIVATE_IP}" 8001
      clone_assert_tcp "Mock Provider" "${GATELM_PROD_CLONE_AI_PRIVATE_IP}" 8090
      ;;
    rag)
      clone_assert_tcp "PostgreSQL" "${GATELM_PROD_CLONE_DATA_PRIVATE_IP}" 5432
      clone_assert_tcp "Private Gateway load balancer" "${GATELM_PROD_CLONE_GATEWAY_LB_PRIVATE_IP}" 8081
      clone_assert_tcp "AI Service" "${GATELM_PROD_CLONE_AI_PRIVATE_IP}" 8001
      ;;
    data)
      clone_assert_tcp "AI Service" "${GATELM_PROD_CLONE_AI_PRIVATE_IP}" 8001
      clone_assert_tcp "Private Gateway load balancer" "${GATELM_PROD_CLONE_GATEWAY_LB_PRIVATE_IP}" 8081
      ;;
    ai) ;;
  esac
fi

clone_log "${role} preflight passed for ${GATELM_PROD_CLONE_SOURCE_SHA} (${GATELM_PROD_CLONE_PHASE})."
