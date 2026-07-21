#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERF_SCRIPTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DIST_LIB_PATH="${PERF_SCRIPTS_DIR}/perf-distributed-lib.sh"
DIST_COMPOSE_PATH="${PERF_SCRIPTS_DIR}/../docker-compose.perf.distributed.yml"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

write_valid_env() {
  local path="$1"
  cat > "${path}" <<'EOF'
GATELM_PERF_TOPOLOGY=distributed
GATELM_PERF_TOPOLOGY_ID=111111111111111111111111
GATELM_PERF_GIT_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
GATELM_PERF_LOADGEN_PRIVATE_IP=10.77.1.10
GATELM_PERF_GATEWAY_PRIVATE_IP=10.77.1.20
GATELM_PERF_DATA_PRIVATE_IP=10.77.1.30
GATELM_PERF_MOCK_PRIVATE_IP=10.77.1.40
GATELM_PERF_GATEWAY_PORT=18080
GATELM_PERF_CONTROL_PLANE_PORT=3001
GATELM_PERF_POSTGRES_PORT=5432
GATELM_PERF_REDIS_PORT=6379
GATELM_PERF_MOCK_PORT=8090
POSTGRES_USER=gatelm_perf
POSTGRES_PASSWORD=test-postgres-secret
POSTGRES_DB=gatelm_perf
REDIS_PASSWORD=test-redis-secret
CONTROL_PLANE_AUTH_STATE_SECRET=test-auth-state-secret
CONTROL_PLANE_INTERNAL_SERVICE_TOKEN=test-internal-token
GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN=test-internal-token
TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN=test-tenant-token
GATEWAY_EXACT_CACHE_KEY_SECRET=test-cache-secret
GATELM_DEMO_API_KEY=gsk_perf_test
GATELM_DEMO_APP_TOKEN=gat_perf_test
GATELM_DEMO_TENANT_ID=00000000-0000-4000-8000-000000000100
GATELM_DEMO_PROJECT_ID=00000000-0000-4000-8000-000000000200
GATELM_DEMO_APPLICATION_ID=00000000-0000-4000-8000-000000000300
GATELM_DEMO_API_KEY_ID=00000000-0000-4000-8000-000000000400
GATELM_DEMO_APP_TOKEN_ID=00000000-0000-4000-8000-000000000500
GATELM_PERF_RUNTIME_RATE_LIMIT_LIMIT=100000
MOCK_PROVIDER_DEFAULT_LATENCY_MS=100
GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY=
CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP=
GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP=
OPENAI_API_KEY=
EOF
  chmod 600 "${path}"
}

validate_env() {
  local env_file="$1"
  # DIST_LIB_PATH is passed through env -i and expanded by the child Bash.
  # shellcheck disable=SC2016
  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-/tmp}" \
    GATELM_PERF_DISTRIBUTED_ENV_FILE="${env_file}" \
    DIST_LIB_PATH="${DIST_LIB_PATH}" \
    bash -c 'source "${DIST_LIB_PATH}"; dist_load_env; dist_validate_env'
}

write_attestation() {
  local path="$1"
  local role="$2"
  local private_ip="$3"
  local machine_hash="$4"
  printf '%s\n' \
    'GATELM_PERF_ATTESTATION_SCHEMA=gatelm.perf-distributed-attestation.v1' \
    "GATELM_PERF_ATTESTATION_ROLE=${role}" \
    'GATELM_PERF_ATTESTATION_TOPOLOGY_ID=111111111111111111111111' \
    'GATELM_PERF_ATTESTATION_GIT_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
    "GATELM_PERF_ATTESTATION_PRIVATE_IP=${private_ip}" \
    "GATELM_PERF_ATTESTATION_MACHINE_HASH=${machine_hash}" \
    > "${path}"
  chmod 600 "${path}"
}

verify_attestations() {
  local env_file="$1"
  local attestation_dir="$2"
  # DIST_LIB_PATH is passed through env -i and expanded by the child Bash.
  # shellcheck disable=SC2016
  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-/tmp}" \
    GATELM_PERF_DISTRIBUTED_ENV_FILE="${env_file}" \
    GATELM_PERF_DISTRIBUTED_ATTESTATION_DIR="${attestation_dir}" \
    DIST_LIB_PATH="${DIST_LIB_PATH}" \
    bash -c 'source "${DIST_LIB_PATH}"; dist_load_env; dist_validate_env; dist_verify_topology_attestations'
}

valid_env="${tmp_dir}/valid.env"
write_valid_env "${valid_env}"
validate_env "${valid_env}" >/dev/null
grep -Fq 'GATEWAY_AUTH_CACHE_TTL_MS: "5000"' "${DIST_COMPOSE_PATH}"
grep -Fq 'DASHBOARD_ROLLUP_BUILD_MODE: ${DASHBOARD_ROLLUP_BUILD_MODE:-legacy}' "${DIST_COMPOSE_PATH}"
grep -Fq 'GATEWAY_ANALYTICS_POLICY_IMPACT_READ_MODE: ${GATEWAY_ANALYTICS_POLICY_IMPACT_READ_MODE:-raw}' "${DIST_COMPOSE_PATH}"

attestation_dir="${tmp_dir}/attestations"
mkdir "${attestation_dir}"
write_attestation "${attestation_dir}/loadgen.attestation.env" loadgen 10.77.1.10 "$(printf '1%.0s' {1..64})"
write_attestation "${attestation_dir}/gateway.attestation.env" gateway 10.77.1.20 "$(printf '2%.0s' {1..64})"
write_attestation "${attestation_dir}/data.attestation.env" data 10.77.1.30 "$(printf '3%.0s' {1..64})"
write_attestation "${attestation_dir}/mock.attestation.env" mock 10.77.1.40 "$(printf '4%.0s' {1..64})"
printf '\n \t\n' >> "${attestation_dir}/loadgen.attestation.env"
verify_attestations "${valid_env}" "${attestation_dir}" >/dev/null

write_attestation "${attestation_dir}/mock.attestation.env" mock 10.77.1.40 "$(printf '3%.0s' {1..64})"
if verify_attestations "${valid_env}" "${attestation_dir}" > "${tmp_dir}/duplicate-host.out" 2>&1; then
  printf '%s\n' "expected duplicate host attestations to fail" >&2
  exit 1
fi
grep -Fq 'have the same machine identity' "${tmp_dir}/duplicate-host.out"
write_attestation "${attestation_dir}/mock.attestation.env" mock 10.77.1.40 "$(printf '4%.0s' {1..64})"

duplicate_env="${tmp_dir}/duplicate.env"
write_valid_env "${duplicate_env}"
sed -i 's/GATELM_PERF_MOCK_PRIVATE_IP=10.77.1.40/GATELM_PERF_MOCK_PRIVATE_IP=10.77.1.30/' "${duplicate_env}"
if validate_env "${duplicate_env}" > "${tmp_dir}/duplicate.out" 2>&1; then
  printf '%s\n' "expected duplicate role IPs to fail" >&2
  exit 1
fi
grep -Fq 'private IPs must be distinct' "${tmp_dir}/duplicate.out"

public_ip_env="${tmp_dir}/public-ip.env"
write_valid_env "${public_ip_env}"
sed -i 's/GATELM_PERF_MOCK_PRIVATE_IP=10.77.1.40/GATELM_PERF_MOCK_PRIVATE_IP=8.8.8.8/' "${public_ip_env}"
if validate_env "${public_ip_env}" > "${tmp_dir}/public-ip.out" 2>&1; then
  printf '%s\n' "expected a public role IP to fail" >&2
  exit 1
fi
grep -Fq 'must be an exact RFC1918 private IPv4 address' "${tmp_dir}/public-ip.out"

latency_env="${tmp_dir}/latency.env"
write_valid_env "${latency_env}"
sed -i 's/MOCK_PROVIDER_DEFAULT_LATENCY_MS=100/MOCK_PROVIDER_DEFAULT_LATENCY_MS=50/' "${latency_env}"
if validate_env "${latency_env}" > "${tmp_dir}/latency.out" 2>&1; then
  printf '%s\n' "expected non-100ms Mock latency to fail" >&2
  exit 1
fi
grep -Fq 'requires exactly 100ms Mock latency' "${tmp_dir}/latency.out"

live_key_env="${tmp_dir}/live-key.env"
write_valid_env "${live_key_env}"
sed -i 's/OPENAI_API_KEY=$/OPENAI_API_KEY=must-not-be-present/' "${live_key_env}"
if validate_env "${live_key_env}" > "${tmp_dir}/live-key.out" 2>&1; then
  printf '%s\n' "expected a live Provider key to fail" >&2
  exit 1
fi
grep -Fq 'OPENAI_API_KEY must stay empty' "${tmp_dir}/live-key.out"

printf '%s\n' "distributed performance validation tests passed"
