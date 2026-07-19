#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/production-distributed-lib.sh
source "${SCRIPT_DIR}/production-distributed-lib.sh"

role=""
check_dependencies=false
while (( $# > 0 )); do
  case "$1" in
    --role)
      [[ $# -ge 2 ]] || production_fail "--role requires edge, gateway, data, or ai."
      role="$2"
      shift 2
      ;;
    --check-dependencies)
      check_dependencies=true
      shift
      ;;
    *) production_fail "Unknown option: $1" ;;
  esac
done
case "${role}" in edge|gateway|data|ai) ;; *) production_fail "A valid --role is required." ;; esac

perf_check_docker
production_load_env
production_validate_env
production_assert_role_host "${role}"
production_assert_build_source "${role}"
production_assert_role_secrets "${role}"

case "${role}" in
  edge)
    production_require_active_env edge \
      GATELM_GATEWAY_API_KEY GATEWAY_OBSERVABILITY_INTERNAL_TOKEN TENANT_CHAT_WEB_SERVICE_TOKEN
    ;;
  gateway)
    production_require_active_env gateway \
      POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
      GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN GATEWAY_OBSERVABILITY_INTERNAL_TOKEN
    ;;
  data)
    production_require_active_env data \
      POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
      AI_SERVICE_RAG_SERVICE_TOKEN CONTROL_PLANE_AUTH_STATE_SECRET CONTROL_PLANE_INTERNAL_SERVICE_TOKEN \
      RAG_OBJECT_STORE_DRIVER RAG_QUERY_EMBEDDING_ACTIVE_KID RAG_S3_BUCKET RAG_S3_KMS_KEY_ID RAG_S3_REGION \
      RAG_WORKER_EMBEDDING_ACTIVE_KID SMTP_FROM SMTP_HOST TENANT_CHAT_ACCESS_JWT_SECRET \
      TENANT_CHAT_CACHE_KEY_SET_ID TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN TENANT_CHAT_INTENT_SECRET \
      TENANT_CHAT_WEB_SERVICE_TOKEN TENANT_CHAT_WORKLOAD_ACTIVE_KID
    ;;
  ai)
    production_require_active_env ai AI_SERVICE_RAG_SERVICE_TOKEN
    ;;
esac

production_compose "${role}" config --quiet

free_kb="$(df -Pk "${GATELM_PRODUCTION_DISTRIBUTED_BUILD_CONTEXT}" | awk 'NR == 2 {print $4}')"
[[ "${free_kb}" =~ ^[0-9]+$ && "${free_kb}" -ge 8388608 ]] || \
  production_fail "At least 8 GiB of free disk is required for role ${role}."

if [[ "${role}" == "data" ]]; then
  production_assert_db_attestation
  command -v aws >/dev/null 2>&1 || production_fail "AWS CLI is required on the Data host."
  aws sts get-caller-identity --output text --query Account >/dev/null
  aws s3api head-bucket --bucket "${RAG_S3_BUCKET}" >/dev/null
fi

if [[ "${check_dependencies}" == "true" ]]; then
  case "${role}" in
    edge)
      production_assert_tcp "Gateway public data plane" "${GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_PRIVATE_IP}" 8080
      production_assert_tcp "Control Plane" "${GATELM_PRODUCTION_DISTRIBUTED_DATA_PRIVATE_IP}" 3001
      production_assert_tcp "Chat API" "${GATELM_PRODUCTION_DISTRIBUTED_DATA_PRIVATE_IP}" 3003
      ;;
    gateway)
      production_assert_tcp "Control Plane" "${GATELM_PRODUCTION_DISTRIBUTED_DATA_PRIVATE_IP}" 3001
      production_assert_tcp "PostgreSQL" "${GATELM_PRODUCTION_DISTRIBUTED_DATA_PRIVATE_IP}" 5432
      production_assert_tcp "Redis" "${GATELM_PRODUCTION_DISTRIBUTED_DATA_PRIVATE_IP}" 6379
      production_assert_tcp "AI Service" "${GATELM_PRODUCTION_DISTRIBUTED_AI_PRIVATE_IP}" 8001
      production_assert_tcp "Mock Provider" "${GATELM_PRODUCTION_DISTRIBUTED_AI_PRIVATE_IP}" 8090
      ;;
    data)
      production_assert_tcp "Private Gateway" "${GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_PRIVATE_IP}" 8081
      production_assert_tcp "AI Service" "${GATELM_PRODUCTION_DISTRIBUTED_AI_PRIVATE_IP}" 8001
      ;;
    ai) ;;
  esac
fi

production_log "${role} preflight passed for ${GATELM_PRODUCTION_DISTRIBUTED_SOURCE_SHA} (${GATELM_PRODUCTION_DISTRIBUTED_PHASE})."
