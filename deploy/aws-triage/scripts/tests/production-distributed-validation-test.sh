#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy/aws-triage"
COMPOSE_PATH="${DEPLOY_DIR}/docker-compose.production.distributed.yml"
ENV_PATH="${DEPLOY_DIR}/production-distributed.env.example"
TEMPLATE_PATH="${DEPLOY_DIR}/aws/production-distributed.template.yml"
CD_TEMPLATE_PATH="${DEPLOY_DIR}/aws/github-actions-cd.template.json"
LIB_PATH="${DEPLOY_DIR}/scripts/production-distributed-lib.sh"
PREFLIGHT_PATH="${DEPLOY_DIR}/scripts/production-distributed-preflight.sh"
UP_PATH="${DEPLOY_DIR}/scripts/production-distributed-up.sh"
SMOKE_PATH="${DEPLOY_DIR}/scripts/production-distributed-smoke.sh"
DEPLOY_ROLE_PATH="${DEPLOY_DIR}/scripts/production-distributed-deploy-role.sh"
SEND_DEPLOY_PATH="${DEPLOY_DIR}/scripts/send-ssm-deploy-distributed.sh"
DB_EXPORT_PATH="${DEPLOY_DIR}/scripts/production-distributed-db-export.sh"
DB_RESTORE_PATH="${DEPLOY_DIR}/scripts/production-distributed-db-restore.sh"

for path in \
  "${COMPOSE_PATH}" "${ENV_PATH}" "${TEMPLATE_PATH}" "${CD_TEMPLATE_PATH}" "${LIB_PATH}" \
  "${PREFLIGHT_PATH}" "${UP_PATH}" "${SMOKE_PATH}" "${DEPLOY_ROLE_PATH}" "${SEND_DEPLOY_PATH}" \
  "${DB_EXPORT_PATH}" "${DB_RESTORE_PATH}" \
  "${DEPLOY_DIR}/Caddyfile.production-distributed.rehearsal" \
  "${DEPLOY_DIR}/Caddyfile.production-distributed.production"; do
  [[ -f "${path}" ]] || { echo "Missing production distributed artifact: ${path}" >&2; exit 1; }
done

grep -Fq 'name: gatelm-production-distributed' "${COMPOSE_PATH}"
grep -Fq 'profiles: [edge]' "${COMPOSE_PATH}"
grep -Fq 'profiles: [gateway]' "${COMPOSE_PATH}"
grep -Fq 'profiles: [data]' "${COMPOSE_PATH}"
grep -Fq 'profiles: [rag]' "${COMPOSE_PATH}"
grep -Fq 'profiles: [ai]' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AUTH_CACHE_ENABLED: ${GATEWAY_AUTH_CACHE_ENABLED:-true}' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AUTH_CACHE_TTL_MS: ${GATEWAY_AUTH_CACHE_TTL_MS:-5000}' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AUTH_CACHE_MAX_ENTRIES: ${GATEWAY_AUTH_CACHE_MAX_ENTRIES:-4096}' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_ENABLED: "true"' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_URL: http://${GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP:-172.31.32.156}:8001/internal/ai-safety/v1/detect' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_TIMEOUT_MS: "100"' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_MODEL_ID: gatelm/koelectra-small-v3-pii-ner' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_DETECTOR_SET: gatelm-koelectra-pii-ner-v1' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_MODE: enforce' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_PERSON_NAME_MODEL_ONLY: "true"' "${COMPOSE_PATH}"
grep -Fq 'GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP=172.31.32.156' "${ENV_PATH}"
grep -Fq 'production_assert_tcp "PII v3.6 Service" "${GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP}" 8001' "${PREFLIGHT_PATH}"
grep -Fq 'production_assert_http_ready "PII v3.6 Service" "http://${GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP}:8001/readyz"' "${PREFLIGHT_PATH}"
grep -Fq 'args+=(--check-dependencies)' "${DEPLOY_ROLE_PATH}"
grep -Fq '10.78.1.10' "${COMPOSE_PATH}"
grep -Fq '10.78.2.20' "${COMPOSE_PATH}"
grep -Fq '10.78.2.30' "${COMPOSE_PATH}"
grep -Fq '10.78.2.40' "${COMPOSE_PATH}"
grep -Fq 'FromPort: 8090' "${TEMPLATE_PATH}"
grep -Fq 'SourceSecurityGroupId: !Ref GatewaySecurityGroup' "${TEMPLATE_PATH}"
grep -Fq 'GATELM_PRODUCTION_DISTRIBUTED_LIVE_REQUESTS_ALLOWED=false' "${ENV_PATH}"
grep -Fq 'SendCommandToGateLMDistributedInstances' "${CD_TEMPLATE_PATH}"
grep -Fq '"MaxSessionDuration": 10800' "${CD_TEMPLATE_PATH}"
grep -Fq 'deploy_order=(ai data gateway edge)' "${SEND_DEPLOY_PATH}"
grep -Fq 'operation="${8:-deploy}"' "${SEND_DEPLOY_PATH}"
grep -Fq 'completed_roles=(ai data gateway edge)' "${SEND_DEPLOY_PATH}"
grep -Fq 'postgres-before.dump' "${DEPLOY_ROLE_PATH}"
grep -Fq 'Read-only role check passed' "${DEPLOY_ROLE_PATH}"
grep -Fq 'deployment is idempotent' "${DEPLOY_ROLE_PATH}"
grep -Fq 'Database migrations, if any, were not reversed.' "${DEPLOY_ROLE_PATH}"
grep -Fq 'production_compose "${role}" up -d "${infrastructure_services[@]}"' "${UP_PATH}"

if grep -Eq 'PROD_CLONE|prod-clone|10\.77|mock-provider-upstream|MOCK_SHAPER' \
  "${COMPOSE_PATH}" "${ENV_PATH}" "${LIB_PATH}" "${PREFLIGHT_PATH}" "${UP_PATH}" "${SMOKE_PATH}" \
  "${DEPLOY_ROLE_PATH}" "${SEND_DEPLOY_PATH}" "${DB_EXPORT_PATH}" "${DB_RESTORE_PATH}"; then
  echo 'Clone-only names or topology leaked into production distributed artifacts.' >&2
  exit 1
fi

if grep -Eq '0\.0\.0\.0:(3001|3003|5432|6379|8001|8080|8081|8090)' "${COMPOSE_PATH}"; then
  echo 'A private production service was bound to every host interface.' >&2
  exit 1
fi

grep -Fq 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' "${DB_EXPORT_PATH}"
grep -Fq 'refusing to overwrite' "${DB_RESTORE_PATH}"
grep -Fq 'ServerSideEncryption' "${DB_RESTORE_PATH}"
grep -Fq 'GATELM_PRODUCTION_DISTRIBUTED_DUMP_SHA256=' "${DB_RESTORE_PATH}"

bash -n \
  "${LIB_PATH}" "${PREFLIGHT_PATH}" "${UP_PATH}" "${SMOKE_PATH}" \
  "${DEPLOY_ROLE_PATH}" "${SEND_DEPLOY_PATH}" "${DB_EXPORT_PATH}" "${DB_RESTORE_PATH}"

echo 'Production distributed static validation passed.'
