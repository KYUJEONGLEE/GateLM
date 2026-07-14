#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${SCRIPT_DIR}/perf-lib.sh"

output_path="${GATELM_PERF_DISTRIBUTED_ENV_FILE:-${AWS_TRIAGE_DIR}/.env.perf.distributed}"
[[ ! -e "${output_path}" ]] || perf_fail "${output_path} already exists and was not overwritten."
perf_need_command "openssl" "Install openssl."

perf_require_env_vars \
  GATELM_PERF_LOADGEN_PRIVATE_IP \
  GATELM_PERF_GATEWAY_PRIVATE_IP \
  GATELM_PERF_DATA_PRIVATE_IP \
  GATELM_PERF_MOCK_PRIVATE_IP

local_ip_name=""
for local_ip_name in \
  GATELM_PERF_LOADGEN_PRIVATE_IP \
  GATELM_PERF_GATEWAY_PRIVATE_IP \
  GATELM_PERF_DATA_PRIVATE_IP \
  GATELM_PERF_MOCK_PRIVATE_IP; do
  perf_is_private_ipv4 "${!local_ip_name}" || \
    perf_fail "${local_ip_name} must be an exact RFC1918 private IPv4 address."
done

git_sha="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
[[ "${git_sha}" =~ ^[a-f0-9]{40}$ ]] || perf_fail "Could not resolve a full Git SHA."

umask 077
topology_id="$(openssl rand -hex 12)"
postgres_password="$(openssl rand -hex 24)"
redis_password="$(openssl rand -hex 24)"
auth_state_secret="$(openssl rand -hex 32)"
internal_service_token="$(openssl rand -hex 32)"
tenant_service_token="$(openssl rand -hex 32)"
cache_key_secret="$(openssl rand -hex 32)"
demo_api_key="gsk_perf_$(openssl rand -hex 24)"
demo_app_token="gat_perf_$(openssl rand -hex 24)"

cat > "${output_path}" <<EOF
GATELM_PERF_TOPOLOGY=distributed
GATELM_PERF_TOPOLOGY_ID=${topology_id}
GATELM_PERF_GIT_SHA=${git_sha}
GATELM_PERF_LOADGEN_PRIVATE_IP=${GATELM_PERF_LOADGEN_PRIVATE_IP}
GATELM_PERF_GATEWAY_PRIVATE_IP=${GATELM_PERF_GATEWAY_PRIVATE_IP}
GATELM_PERF_DATA_PRIVATE_IP=${GATELM_PERF_DATA_PRIVATE_IP}
GATELM_PERF_MOCK_PRIVATE_IP=${GATELM_PERF_MOCK_PRIVATE_IP}
GATELM_PERF_GATEWAY_PORT=18080
GATELM_PERF_CONTROL_PLANE_PORT=3001
GATELM_PERF_POSTGRES_PORT=5432
GATELM_PERF_REDIS_PORT=6379
GATELM_PERF_MOCK_PORT=8090
POSTGRES_USER=gatelm_perf
POSTGRES_PASSWORD=${postgres_password}
POSTGRES_DB=gatelm_perf
REDIS_PASSWORD=${redis_password}
CONTROL_PLANE_AUTH_STATE_SECRET=${auth_state_secret}
CONTROL_PLANE_INTERNAL_SERVICE_TOKEN=${internal_service_token}
GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN=${internal_service_token}
TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN=${tenant_service_token}
GATEWAY_EXACT_CACHE_KEY_SECRET=${cache_key_secret}
GATELM_DEMO_API_KEY=${demo_api_key}
GATELM_DEMO_APP_TOKEN=${demo_app_token}
GATELM_DEMO_TENANT_ID=00000000-0000-4000-8000-000000000100
GATELM_DEMO_PROJECT_ID=00000000-0000-4000-8000-000000000200
GATELM_DEMO_APPLICATION_ID=00000000-0000-4000-8000-000000000300
GATELM_DEMO_API_KEY_ID=00000000-0000-4000-8000-000000000400
GATELM_DEMO_APP_TOKEN_ID=00000000-0000-4000-8000-000000000500
GATELM_PERF_RUNTIME_RATE_LIMIT_LIMIT=100000
MOCK_PROVIDER_DEFAULT_LATENCY_MS=100
GATELM_PERF_PROVIDER_MAX_IDLE_CONNS=1024
GATELM_PERF_PROVIDER_MAX_IDLE_CONNS_PER_HOST=512
GATELM_PERF_PROVIDER_MAX_CONNS_PER_HOST=512
GATELM_PERF_DATABASE_MAX_CONNS=32
GATELM_PERF_DATABASE_MIN_CONNS=4
GATELM_PERF_LOG_DATABASE_MAX_CONNS=8
GATELM_PERF_LOG_DATABASE_MIN_CONNS=2
GATELM_PERF_ASYNC_LOG_QUEUE_SIZE=20000
GATELM_PERF_ASYNC_LOG_WORKER_COUNT=4
GATELM_PERF_ASYNC_LOG_BATCH_SIZE=100
GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY=
CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP=
GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP=
OPENAI_API_KEY=
EOF

chmod 600 "${output_path}"
unset topology_id postgres_password redis_password auth_state_secret internal_service_token
unset tenant_service_token cache_key_secret demo_api_key demo_app_token
perf_log "Created ${output_path} with mode 600 for Git SHA ${git_sha}."
perf_log "Secret values were not printed."
