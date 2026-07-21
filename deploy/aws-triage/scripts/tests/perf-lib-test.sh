#!/usr/bin/env bash
# shellcheck disable=SC2030,SC2031 # Negative cases intentionally isolate env mutations.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERF_SCRIPTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PERF_COMPOSE_PATH="${PERF_SCRIPTS_DIR}/../docker-compose.perf.yml"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${PERF_SCRIPTS_DIR}/perf-lib.sh"

grep -Fq 'GATEWAY_AUTH_CACHE_TTL_MS: ${GATELM_PERF_AUTH_CACHE_TTL_MS:-5000}' "${PERF_COMPOSE_PATH}"

[[ "$(perf_unquote_env_value 's3://synthetic-bucket/model.tar.gz')" == 's3://synthetic-bucket/model.tar.gz' ]]
[[ "$(perf_unquote_env_value '"s3://synthetic-bucket/model.tar.gz"')" == 's3://synthetic-bucket/model.tar.gz' ]]
[[ "$(perf_unquote_env_value "'s3://synthetic-bucket/model.tar.gz'")" == 's3://synthetic-bucket/model.tar.gz' ]]
[[ "$(perf_trim $'s3://synthetic-bucket/model.tar.gz\r')" == 's3://synthetic-bucket/model.tar.gz' ]]

for ip in 10.0.0.1 10.255.255.254 172.16.0.1 172.31.255.254 192.168.1.10; do
  perf_is_private_ipv4 "${ip}" || {
    printf '%s\n' "expected RFC1918 address to pass: ${ip}" >&2
    exit 1
  }
done

for ip in 0.0.0.0 8.8.8.8 127.0.0.1 169.254.1.1 172.15.0.1 172.32.0.1 192.169.0.1 256.1.1.1; do
  if perf_is_private_ipv4 "${ip}"; then
    printf '%s\n' "expected non-RFC1918 address to fail: ${ip}" >&2
    exit 1
  fi
done

first_hash="$(perf_machine_identity_hash run_machine_test_1)"
same_hash="$(perf_machine_identity_hash run_machine_test_1)"
other_hash="$(perf_machine_identity_hash run_machine_test_2)"
[[ "${first_hash}" =~ ^[a-f0-9]{64}$ ]]
[[ "${first_hash}" == "${same_hash}" ]]
[[ "${first_hash}" != "${other_hash}" ]]

set_valid_perf_env() {
  export POSTGRES_USER=gatelm_perf
  export POSTGRES_PASSWORD=test-password
  export POSTGRES_DB=gatelm_perf
  export CONTROL_PLANE_AUTH_STATE_SECRET=test-auth-state
  export CONTROL_PLANE_INTERNAL_SERVICE_TOKEN=test-internal-token
  export TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN=test-chat-control-plane-token-at-least-32-bytes
  export TENANT_CHAT_WEB_SERVICE_TOKEN=test-chat-web-token-at-least-32-bytes
  export TENANT_CHAT_ACCESS_JWT_SECRET=test-chat-access-secret-at-least-32-bytes
  export TENANT_CHAT_INTENT_SECRET=test-chat-intent-secret-at-least-32-bytes
  export GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN=test-internal-token
  export GATEWAY_OBSERVABILITY_INTERNAL_TOKEN=test-observability-token-at-least-32-bytes
  export GATEWAY_EXACT_CACHE_KEY_SECRET=test-cache-secret
  export GATELM_DEMO_API_KEY=gsk_perf_test
  export GATELM_DEMO_APP_TOKEN=gat_perf_test
  export GATELM_DEMO_TENANT_ID=00000000-0000-4000-8000-000000000100
  export GATELM_DEMO_PROJECT_ID=00000000-0000-4000-8000-000000000200
  export GATELM_DEMO_APPLICATION_ID=00000000-0000-4000-8000-000000000300
  export GATELM_DEMO_API_KEY_ID=00000000-0000-4000-8000-000000000400
  export GATELM_DEMO_APP_TOKEN_ID=00000000-0000-4000-8000-000000000500
  export GATELM_DEMO_PROVIDER_MODE=mock
  export AWS_TRIAGE_CONTROL_PLANE_BIND=127.0.0.1
  export AWS_TRIAGE_GATEWAY_PORT=18080
  export GATELM_PERF_RUNTIME_RATE_LIMIT_LIMIT=100000
  export OPENAI_API_KEY=
  export CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP=
  export GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP=
  export GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY=
}

set_valid_perf_env
export GATELM_PERF_REMOTE_LOADGEN_ENABLED=false
export AWS_TRIAGE_GATEWAY_BIND=127.0.0.1
perf_validate_env

set_valid_perf_env
export GATELM_PERF_REMOTE_LOADGEN_ENABLED=true
export AWS_TRIAGE_GATEWAY_BIND=10.10.0.25
perf_validate_env

if (
  set_valid_perf_env
  export GATELM_PERF_REMOTE_LOADGEN_ENABLED=true
  export AWS_TRIAGE_GATEWAY_BIND=0.0.0.0
  perf_validate_env
) >/dev/null 2>&1; then
  printf '%s\n' "expected wildcard Gateway binding to fail" >&2
  exit 1
fi

if (
  set_valid_perf_env
  export GATELM_PERF_REMOTE_LOADGEN_ENABLED=false
  export AWS_TRIAGE_GATEWAY_BIND=10.10.0.25
  perf_validate_env
) >/dev/null 2>&1; then
  printf '%s\n' "expected private Gateway binding without opt-in to fail" >&2
  exit 1
fi

if (
  set_valid_perf_env
  export GATELM_PERF_REMOTE_LOADGEN_ENABLED=false
  export AWS_TRIAGE_GATEWAY_BIND=127.0.0.1
  export GATEWAY_OBSERVABILITY_INTERNAL_TOKEN="${GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN}"
  perf_validate_env
) >/dev/null 2>&1; then
  printf '%s\n' "expected a reused observability token to fail" >&2
  exit 1
fi

if (
  set_valid_perf_env
  export GATELM_PERF_REMOTE_LOADGEN_ENABLED=false
  export AWS_TRIAGE_GATEWAY_BIND=127.0.0.1
  export GATEWAY_OBSERVABILITY_INTERNAL_TOKEN=too-short
  perf_validate_env
) >/dev/null 2>&1; then
  printf '%s\n' "expected a short observability token to fail" >&2
  exit 1
fi

printf '%s\n' "perf library tests passed"
