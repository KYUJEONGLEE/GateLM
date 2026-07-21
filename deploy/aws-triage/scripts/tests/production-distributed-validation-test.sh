#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
DEPLOY_DIR="${ROOT_DIR}/deploy/aws-triage"
COMPOSE_PATH="${DEPLOY_DIR}/docker-compose.production.distributed.yml"
PII_COMPOSE_PATH="${DEPLOY_DIR}/docker-compose.production.pii.yml"
PII_MANIFEST_PATH="${DEPLOY_DIR}/pii-v314-model-manifest.sha256"
ENV_PATH="${DEPLOY_DIR}/production-distributed.env.example"
TEMPLATE_PATH="${DEPLOY_DIR}/aws/production-distributed.template.yml"
CD_TEMPLATE_PATH="${DEPLOY_DIR}/aws/github-actions-cd.template.json"
LIB_PATH="${DEPLOY_DIR}/scripts/production-distributed-lib.sh"
PREFLIGHT_PATH="${DEPLOY_DIR}/scripts/production-distributed-preflight.sh"
UP_PATH="${DEPLOY_DIR}/scripts/production-distributed-up.sh"
SMOKE_PATH="${DEPLOY_DIR}/scripts/production-distributed-smoke.sh"
DEPLOY_ROLE_PATH="${DEPLOY_DIR}/scripts/production-distributed-deploy-role.sh"
SEND_DEPLOY_PATH="${DEPLOY_DIR}/scripts/send-ssm-deploy-distributed.sh"
BOOTSTRAP_GATEWAY_PATH="${DEPLOY_DIR}/scripts/bootstrap-production-gateway-secondary.sh"
PREPARE_PII_PATH="${DEPLOY_DIR}/scripts/prepare-production-pii-model.sh"
DB_EXPORT_PATH="${DEPLOY_DIR}/scripts/production-distributed-db-export.sh"
DB_RESTORE_PATH="${DEPLOY_DIR}/scripts/production-distributed-db-restore.sh"
TWO_GATEWAY_CD_TEST_PATH="${DEPLOY_DIR}/scripts/tests/production-distributed-two-gateway-cd-test.sh"
CLICKHOUSE_BACKFILL_PATH="${DEPLOY_DIR}/scripts/clickhouse-backfill-general-analytics.sh"
CLICKHOUSE_BACKFILL_TEST_PATH="${DEPLOY_DIR}/scripts/tests/clickhouse-backfill-general-analytics-test.sh"

for path in \
  "${COMPOSE_PATH}" "${PII_COMPOSE_PATH}" "${PII_MANIFEST_PATH}" "${ENV_PATH}" "${TEMPLATE_PATH}" "${CD_TEMPLATE_PATH}" "${LIB_PATH}" \
  "${PREFLIGHT_PATH}" "${UP_PATH}" "${SMOKE_PATH}" "${DEPLOY_ROLE_PATH}" "${SEND_DEPLOY_PATH}" \
  "${BOOTSTRAP_GATEWAY_PATH}" \
  "${PREPARE_PII_PATH}" "${DB_EXPORT_PATH}" "${DB_RESTORE_PATH}" \
  "${TWO_GATEWAY_CD_TEST_PATH}" "${CLICKHOUSE_BACKFILL_PATH}" "${CLICKHOUSE_BACKFILL_TEST_PATH}" \
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
grep -Fq 'profiles: [pii]' "${PII_COMPOSE_PATH}"
grep -Fq 'GATEWAY_AUTH_CACHE_ENABLED: ${GATEWAY_AUTH_CACHE_ENABLED:-true}' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AUTH_CACHE_TTL_MS: ${GATEWAY_AUTH_CACHE_TTL_MS:-5000}' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AUTH_CACHE_MAX_ENTRIES: ${GATEWAY_AUTH_CACHE_MAX_ENTRIES:-4096}' "${COMPOSE_PATH}"
grep -Fq 'TENANT_CHAT_GATEWAY_BASE_URL: http://${GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_UPSTREAM_HOST:-10.78.2.20}:8081' "${COMPOSE_PATH}"
grep -Fq 'RAG_WORKER_GATEWAY_BASE_URL: http://${GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_UPSTREAM_HOST:-10.78.2.20}:8081' "${COMPOSE_PATH}"
grep -Fq 'GATELM_GATEWAY_BASE_URL: http://${GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_UPSTREAM_HOST:-10.78.2.20}:8080' "${COMPOSE_PATH}"
grep -Fq 'dockerfile: infra/docker/gateway-core.Dockerfile' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED: "false"' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_DIFFICULTY_REMOTE_ENABLED: "true"' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_DIFFICULTY_REMOTE_URL: http://${GATELM_PRODUCTION_DISTRIBUTED_AI_PRIVATE_IP:-10.78.2.40}:8001/internal/routing/difficulty/v1/classify' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_DIFFICULTY_REMOTE_TIMEOUT_MS: ${GATEWAY_DIFFICULTY_REMOTE_TIMEOUT_MS:-250}' "${COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_ROUTING_DIFFICULTY_WORKER_COUNT: ${AI_SERVICE_ROUTING_DIFFICULTY_WORKER_COUNT:-4}' "${COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_ROUTING_DIFFICULTY_BATCH_SIZE: ${AI_SERVICE_ROUTING_DIFFICULTY_BATCH_SIZE:-1}' "${COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_ROUTING_DIFFICULTY_BATCH_MAX_WAIT_MS: ${AI_SERVICE_ROUTING_DIFFICULTY_BATCH_MAX_WAIT_MS:-0}' "${COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_ROUTING_DIFFICULTY_ONNX_INTRA_OP_THREADS: ${AI_SERVICE_ROUTING_DIFFICULTY_ONNX_INTRA_OP_THREADS:-1}' "${COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_ROUTING_DIFFICULTY_ONNX_INTER_OP_THREADS: ${AI_SERVICE_ROUTING_DIFFICULTY_ONNX_INTER_OP_THREADS:-1}' "${COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_ML_EXTRA: routing' "${COMPOSE_PATH}"
grep -Fq 'cpus: ${AI_SERVICE_CPU_LIMIT:-4.0}' "${COMPOSE_PATH}"
grep -Fq "urllib.request.urlopen('http://127.0.0.1:8001/readyz', timeout=2)" "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_ENABLED: "true"' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_URL: http://${GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP:-10.78.2.50}:8001/internal/ai-safety/v1/detect' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_TIMEOUT_MS: "100"' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_MODEL_ID: gatelm/koelectra-small-v3-pii-ner' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_DETECTOR_SET: gatelm-koelectra-pii-ner-v1' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_SIDECAR_MODE: enforce' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AI_SAFETY_PERSON_NAME_MODEL_ONLY: "true"' "${COMPOSE_PATH}"
grep -Fq 'GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP=10.78.2.50' "${ENV_PATH}"
grep -Fq 'GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_UPSTREAM_HOST=10.78.2.20' "${ENV_PATH}"
grep -Fq 'GATELM_PRODUCTION_DISTRIBUTED_PII_ARTIFACT_SHA256=fbecea25a4508696e42c36fa3b9f40cb3abd5be82f645860c011935d96df7f13' "${ENV_PATH}"
grep -Fq 'GATELM_ROUTING_DIFFICULTY_SERVICE_TOKEN_PARAMETER_NAME=/gatelm/production/routing-difficulty-service-token' "${ENV_PATH}"
grep -Fq 'AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES: email,organization_name,person_name,phone_number,postal_address,resident_registration_number' "${PII_COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_ML_EXTRA: pii' "${PII_COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_AI_SAFETY_ML_DETECTOR_THRESHOLDS: email=0.99,organization_name=0.90,person_name=0.90,phone_number=0.99,postal_address=0.90,resident_registration_number=0.99' "${PII_COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_AI_SAFETY_MICRO_BATCH_SIZE: "1"' "${PII_COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_AI_SAFETY_PERSON_NAME_MODEL_ONLY: "true"' "${PII_COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED: "true"' "${PII_COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_ONNX_INTRA_OP_THREADS: "4"' "${PII_COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_ONNX_INTER_OP_THREADS: "1"' "${PII_COMPOSE_PATH}"
grep -Fq 'AI_SERVICE_ONNX_ALLOW_SPINNING: "false"' "${PII_COMPOSE_PATH}"
grep -Fq 'cpus: "4.0"' "${PII_COMPOSE_PATH}"
grep -Fq 'python3 -c' "${PII_COMPOSE_PATH}"
grep -Fq 'TRANSFORMERS_OFFLINE: "1"' "${PII_COMPOSE_PATH}"
grep -Fq 'HF_HUB_OFFLINE: "1"' "${PII_COMPOSE_PATH}"
grep -Fq 'production_assert_pii_model_artifact' "${PREPARE_PII_PATH}"
grep -Fq 'aws s3 cp --only-show-errors' "${PREPARE_PII_PATH}"
grep -Fq 'config.json|./config.json' "${PREPARE_PII_PATH}"
[[ "$(wc -l < "${PII_MANIFEST_PATH}" | tr -d '[:space:]')" == "7" ]]
grep -Fq 'production_assert_tcp "PII v3.14 Service" "${GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP}" 8001' "${PREFLIGHT_PATH}"
grep -Fq 'production_assert_http_ready "PII v3.14 Service" "http://${GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP}:8001/readyz"' "${PREFLIGHT_PATH}"
grep -Fq 'production_assert_http_ready "AI Service routing runtime" "http://${GATELM_PRODUCTION_DISTRIBUTED_AI_PRIVATE_IP}:8001/readyz"' "${PREFLIGHT_PATH}"
grep -Fq 'production_assert_e5_runtime_bundle' "${LIB_PATH}"
grep -Fq 'if [[ "${role}" == "ai" ]]; then' "${DEPLOY_ROLE_PATH}"
grep -Fq 'Preparing the pinned AI Service E5 runtime bundle.' "${DEPLOY_ROLE_PATH}"
grep -Fq 'find "${routing_model_dir}" -type d -exec chmod 0755 {} +' "${DEPLOY_ROLE_PATH}"
grep -Fq 'find "${routing_model_dir}" -type f -exec chmod 0644 {} +' "${DEPLOY_ROLE_PATH}"
grep -Fq 'aws ssm get-parameter' "${DEPLOY_ROLE_PATH}"
grep -Fq 'upsert_env_value GATEWAY_DIFFICULTY_REMOTE_SERVICE_TOKEN' "${DEPLOY_ROLE_PATH}"
grep -Fq 'args+=(--check-dependencies)' "${DEPLOY_ROLE_PATH}"
grep -Fq '10.78.1.10' "${COMPOSE_PATH}"
grep -Fq '10.78.2.20' "${COMPOSE_PATH}"
grep -Fq '10.78.2.30' "${COMPOSE_PATH}"
grep -Fq '10.78.2.40' "${COMPOSE_PATH}"
grep -Fq '10.78.2.50' "${PII_COMPOSE_PATH}"
grep -Fq 'FromPort: 8090' "${TEMPLATE_PATH}"
grep -Fq 'SourceSecurityGroupId: !Ref GatewaySecurityGroup' "${TEMPLATE_PATH}"
grep -Fq 'PiiSecurityGroup:' "${TEMPLATE_PATH}"
grep -Fq 'PiiInstance:' "${TEMPLATE_PATH}"
grep -Fq 'GatewaySecondaryInstance:' "${TEMPLATE_PATH}"
grep -Fq 'PrivateIpAddress: 10.78.2.21' "${TEMPLATE_PATH}"
grep -Fq 'GatewayLoadBalancer:' "${TEMPLATE_PATH}"
grep -Fq 'PrivateIPv4Address: 10.78.2.10' "${TEMPLATE_PATH}"
grep -Fq 'GatewayPublicTargetGroup:' "${TEMPLATE_PATH}"
grep -Fq 'GatewayPrivateTargetGroup:' "${TEMPLATE_PATH}"
grep -Fq 'Key: stickiness.type' "${TEMPLATE_PATH}"
grep -Fq 'Value: source_ip' "${TEMPLATE_PATH}"
grep -Fq 'GatewayBootstrapBucket:' "${TEMPLATE_PATH}"
grep -Fq 'GatewayBootstrapKmsKey:' "${TEMPLATE_PATH}"
grep -Fq 'Default: c7i.xlarge' "${TEMPLATE_PATH}"
grep -Fq 'Four-vCPU compute-optimized host for RAG and authoritative E5 routing inference.' "${TEMPLATE_PATH}"
grep -Fq 'RoutingDifficultyServiceTokenParameterName:' "${TEMPLATE_PATH}"
grep -Fq 'PolicyName: GateLMRoutingDifficultyTokenRead' "${TEMPLATE_PATH}"
grep -Fq 'Action: ssm:GetParameter' "${TEMPLATE_PATH}"
grep -Fq 'PiiReleaseOwnershipAssociation:' "${TEMPLATE_PATH}"
grep -Fq 'install -d -o ubuntu -g ubuntu -m 0755 /opt/gatelm/pii-v314/releases' "${TEMPLATE_PATH}"
grep -Fq 'PrivateIpAddress: 10.78.2.50' "${TEMPLATE_PATH}"
grep -Fq 'PiiArtifactBucket:' "${TEMPLATE_PATH}"
grep -Fq 'GATELM_PRODUCTION_DISTRIBUTED_LIVE_REQUESTS_ALLOWED=false' "${ENV_PATH}"
grep -Fq 'SendCommandToGateLMDistributedInstances' "${CD_TEMPLATE_PATH}"
grep -Fq '"GatewaySecondaryInstanceId"' "${CD_TEMPLATE_PATH}"
grep -Fq '"MaxSessionDuration": 10800' "${CD_TEMPLATE_PATH}"
grep -Fq 'deploy_order=(pii ai data)' "${SEND_DEPLOY_PATH}"
grep -Fq 'deploy_order+=(gateway-secondary)' "${SEND_DEPLOY_PATH}"
grep -Fq 'deploy_order+=(gateway-primary edge)' "${SEND_DEPLOY_PATH}"
grep -Fq 'operation="${9:-deploy}"' "${SEND_DEPLOY_PATH}"
grep -Fq 'gateway_secondary_instance_id="${10:-}"' "${SEND_DEPLOY_PATH}"
grep -Fq 'gateway_upstream_host="${11:-10.78.2.20}"' "${SEND_DEPLOY_PATH}"
grep -Fq 's3api delete-object' "${BOOTSTRAP_GATEWAY_PATH}"
grep -Fq -- '--sse aws:kms' "${BOOTSTRAP_GATEWAY_PATH}"
grep -Fq 'cloud-init status --wait' "${BOOTSTRAP_GATEWAY_PATH}"
grep -Fq 'GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_PRIVATE_IP 10.78.2.21' "${BOOTSTRAP_GATEWAY_PATH}"
grep -Fq 'postgres-before.dump' "${DEPLOY_ROLE_PATH}"
grep -Fq 'pii_release_model_dir="/opt/gatelm/pii-v314/releases/8a5cb146/model"' "${DEPLOY_ROLE_PATH}"
grep -Fq 'pii_release_artifact_key="pii/v36/v314-8a5cb146/model.tar.gz"' "${DEPLOY_ROLE_PATH}"
grep -Fq 'pii_release_archive_sha256="fbecea25a4508696e42c36fa3b9f40cb3abd5be82f645860c011935d96df7f13"' "${DEPLOY_ROLE_PATH}"
grep -Fq 'promote_pii_release_env' "${DEPLOY_ROLE_PATH}"
grep -Fq 'source "${orchestration_dir}/scripts/perf-lib.sh"' "${DEPLOY_ROLE_PATH}"
grep -Fq 'current_uri="$(perf_unquote_env_value "${current_uri}")"' "${DEPLOY_ROLE_PATH}"
pii_uri="$(awk -F= '$1 == "GATELM_PRODUCTION_DISTRIBUTED_PII_ARTIFACT_S3_URI" {print $2}' "${ENV_PATH}")"
[[ "${pii_uri}" == "s3://gatelm-production-pii-artifacts-000000000000-ap-northeast-2/pii/v36/v314-8a5cb146/model.tar.gz" ]]
grep -Fq 'Read-only role check passed' "${DEPLOY_ROLE_PATH}"
grep -Fq 'deployment is idempotent' "${DEPLOY_ROLE_PATH}"
grep -Fq 'Database migrations, if any, were not reversed.' "${DEPLOY_ROLE_PATH}"
grep -Fq 'production_compose "${role}" up -d "${infrastructure_services[@]}"' "${UP_PATH}"

if grep -Eq 'PROD_CLONE|prod-clone|10\.77|mock-provider-upstream|MOCK_SHAPER' \
  "${COMPOSE_PATH}" "${PII_COMPOSE_PATH}" "${ENV_PATH}" "${LIB_PATH}" "${PREFLIGHT_PATH}" "${UP_PATH}" "${SMOKE_PATH}" \
  "${DEPLOY_ROLE_PATH}" "${SEND_DEPLOY_PATH}" "${PREPARE_PII_PATH}" "${DB_EXPORT_PATH}" "${DB_RESTORE_PATH}"; then
  echo 'Clone-only names or topology leaked into production distributed artifacts.' >&2
  exit 1
fi

if grep -Eq '0\.0\.0\.0:(3001|3003|5432|6379|8001|8080|8081|8090)' "${COMPOSE_PATH}" "${PII_COMPOSE_PATH}"; then
  echo 'A private production service was bound to every host interface.' >&2
  exit 1
fi

grep -Fq 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-acl' "${DB_EXPORT_PATH}"
grep -Fq 'refusing to overwrite' "${DB_RESTORE_PATH}"
grep -Fq 'ServerSideEncryption' "${DB_RESTORE_PATH}"
grep -Fq 'GATELM_PRODUCTION_DISTRIBUTED_DUMP_SHA256=' "${DB_RESTORE_PATH}"

bash -n \
  "${LIB_PATH}" "${PREFLIGHT_PATH}" "${UP_PATH}" "${SMOKE_PATH}" \
  "${DEPLOY_ROLE_PATH}" "${SEND_DEPLOY_PATH}" "${BOOTSTRAP_GATEWAY_PATH}" \
  "${PREPARE_PII_PATH}" "${DB_EXPORT_PATH}" "${DB_RESTORE_PATH}" \
  "${CLICKHOUSE_BACKFILL_PATH}" "${CLICKHOUSE_BACKFILL_TEST_PATH}"

bash "${TWO_GATEWAY_CD_TEST_PATH}"
bash "${CLICKHOUSE_BACKFILL_TEST_PATH}"

echo 'Production distributed static validation passed.'
