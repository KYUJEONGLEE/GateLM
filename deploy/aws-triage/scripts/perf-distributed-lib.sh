#!/usr/bin/env bash

if [[ -z "${BASH_VERSION:-}" ]]; then
  printf '%s\n' "[GateLM perf] ERROR: bash is required." >&2
  exit 1
fi

DIST_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${DIST_SCRIPT_DIR}/perf-lib.sh"

DIST_ENV_FILE="${GATELM_PERF_DISTRIBUTED_ENV_FILE:-${AWS_TRIAGE_DIR}/.env.perf.distributed}"
DIST_COMPOSE_FILE="${AWS_TRIAGE_DIR}/docker-compose.perf.distributed.yml"
DIST_PROJECT_NAME="gatelm-perf-distributed"
DIST_ATTESTATION_DIR="${GATELM_PERF_DISTRIBUTED_ATTESTATION_DIR:-${REPO_ROOT}/reports/perf/distributed-attestations}"
PERF_ENV_FILE="${DIST_ENV_FILE}"
export PERF_ENV_FILE

dist_gateway_base_url() {
  printf 'http://%s:%s' "${GATELM_PERF_GATEWAY_PRIVATE_IP}" "${GATELM_PERF_GATEWAY_PORT}"
}

dist_control_plane_base_url() {
  printf 'http://%s:%s' "${GATELM_PERF_DATA_PRIVATE_IP}" "${GATELM_PERF_CONTROL_PLANE_PORT}"
}

dist_mock_base_url() {
  printf 'http://%s:%s' "${GATELM_PERF_MOCK_PRIVATE_IP}" "${GATELM_PERF_MOCK_PORT}"
}

dist_role_services() {
  case "$1" in
    data) printf '%s\n' "postgres redis control-plane-api" ;;
    gateway) printf '%s\n' "gateway-core" ;;
    mock) printf '%s\n' "mock-provider" ;;
    *) perf_fail "Unknown distributed role: $1" ;;
  esac
}

dist_expected_role_ip() {
  case "$1" in
    data) printf '%s\n' "${GATELM_PERF_DATA_PRIVATE_IP}" ;;
    gateway) printf '%s\n' "${GATELM_PERF_GATEWAY_PRIVATE_IP}" ;;
    mock) printf '%s\n' "${GATELM_PERF_MOCK_PRIVATE_IP}" ;;
    loadgen) printf '%s\n' "${GATELM_PERF_LOADGEN_PRIVATE_IP}" ;;
    *) perf_fail "Unknown distributed role: $1" ;;
  esac
}

dist_load_env() {
  [[ -f "${DIST_ENV_FILE}" ]] || \
    perf_fail "Distributed environment file was not found: ${DIST_ENV_FILE}"
  PERF_ENV_FILE="${DIST_ENV_FILE}"
  export PERF_ENV_FILE
  perf_load_env
}

dist_validate_env() {
  perf_require_env_vars \
    GATELM_PERF_TOPOLOGY \
    GATELM_PERF_TOPOLOGY_ID \
    GATELM_PERF_GIT_SHA \
    GATELM_PERF_LOADGEN_PRIVATE_IP \
    GATELM_PERF_GATEWAY_PRIVATE_IP \
    GATELM_PERF_DATA_PRIVATE_IP \
    GATELM_PERF_MOCK_PRIVATE_IP \
    GATELM_PERF_GATEWAY_PORT \
    GATELM_PERF_CONTROL_PLANE_PORT \
    GATELM_PERF_POSTGRES_PORT \
    GATELM_PERF_REDIS_PORT \
    GATELM_PERF_MOCK_PORT \
    POSTGRES_USER \
    POSTGRES_PASSWORD \
    POSTGRES_DB \
    REDIS_PASSWORD \
    CONTROL_PLANE_AUTH_STATE_SECRET \
    CONTROL_PLANE_INTERNAL_SERVICE_TOKEN \
    GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN \
    TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN \
    GATEWAY_EXACT_CACHE_KEY_SECRET \
    GATELM_DEMO_API_KEY \
    GATELM_DEMO_APP_TOKEN \
    GATELM_DEMO_TENANT_ID \
    GATELM_DEMO_PROJECT_ID \
    GATELM_DEMO_APPLICATION_ID \
    GATELM_DEMO_API_KEY_ID \
    GATELM_DEMO_APP_TOKEN_ID \
    GATELM_PERF_RUNTIME_RATE_LIMIT_LIMIT \
    MOCK_PROVIDER_DEFAULT_LATENCY_MS

  [[ "${GATELM_PERF_TOPOLOGY}" == "distributed" ]] || \
    perf_fail "GATELM_PERF_TOPOLOGY must be distributed."
  [[ "${GATELM_PERF_TOPOLOGY_ID}" =~ ^[a-f0-9]{24}$ ]] || \
    perf_fail "GATELM_PERF_TOPOLOGY_ID must be a 24-character lowercase hex identifier."
  [[ "${GATELM_PERF_GIT_SHA}" =~ ^[a-f0-9]{40}$ ]] || \
    perf_fail "GATELM_PERF_GIT_SHA must be a full lowercase Git SHA."
  [[ "${POSTGRES_USER}" == "gatelm_perf" && "${POSTGRES_DB}" == "gatelm_perf" ]] || \
    perf_fail "Distributed performance data must use the isolated gatelm_perf database."
  [[ "${CONTROL_PLANE_INTERNAL_SERVICE_TOKEN}" == "${GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN}" ]] || \
    perf_fail "Control Plane and Gateway internal tokens must match."
  [[ "${MOCK_PROVIDER_DEFAULT_LATENCY_MS}" == "100" ]] || \
    perf_fail "The formal distributed scenario requires exactly 100ms Mock latency."
  [[ "${GATELM_PERF_RUNTIME_RATE_LIMIT_LIMIT}" == "100000" ]] || \
    perf_fail "The formal distributed scenario requires a 100000 request RuntimeSnapshot limit."

  local name value
  for name in \
    GATELM_PERF_LOADGEN_PRIVATE_IP \
    GATELM_PERF_GATEWAY_PRIVATE_IP \
    GATELM_PERF_DATA_PRIVATE_IP \
    GATELM_PERF_MOCK_PRIVATE_IP; do
    value="${!name}"
    perf_is_private_ipv4 "${value}" || \
      perf_fail "${name} must be an exact RFC1918 private IPv4 address."
  done

  local -A seen_ips=()
  for value in \
    "${GATELM_PERF_LOADGEN_PRIVATE_IP}" \
    "${GATELM_PERF_GATEWAY_PRIVATE_IP}" \
    "${GATELM_PERF_DATA_PRIVATE_IP}" \
    "${GATELM_PERF_MOCK_PRIVATE_IP}"; do
    [[ -z "${seen_ips[${value}]+x}" ]] || \
      perf_fail "Distributed role private IPs must be distinct."
    seen_ips["${value}"]=1
  done

  for name in \
    POSTGRES_PASSWORD \
    REDIS_PASSWORD \
    CONTROL_PLANE_AUTH_STATE_SECRET \
    CONTROL_PLANE_INTERNAL_SERVICE_TOKEN \
    TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN \
    GATEWAY_EXACT_CACHE_KEY_SECRET \
    GATELM_DEMO_API_KEY \
    GATELM_DEMO_APP_TOKEN; do
    value="${!name}"
    [[ "${value}" != *"replace-me"* ]] || \
      perf_fail "${name} is still a placeholder."
  done

  for name in \
    OPENAI_API_KEY \
    CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP \
    GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP \
    GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY; do
    [[ -z "${!name-}" ]] || \
      perf_fail "${name} must stay empty in the Mock performance environment."
  done

  [[ "${GATELM_PERF_GATEWAY_PORT}" == "18080" ]] || perf_fail "Gateway port must be 18080."
  [[ "${GATELM_PERF_CONTROL_PLANE_PORT}" == "3001" ]] || perf_fail "Control Plane port must be 3001."
  [[ "${GATELM_PERF_POSTGRES_PORT}" == "5432" ]] || perf_fail "PostgreSQL port must be 5432."
  [[ "${GATELM_PERF_REDIS_PORT}" == "6379" ]] || perf_fail "Redis port must be 6379."
  [[ "${GATELM_PERF_MOCK_PORT}" == "8090" ]] || perf_fail "Mock Provider port must be 8090."
  perf_assert_env_file_permissions "${DIST_ENV_FILE}" "Distributed environment file"
}

dist_assert_git_sha() {
  local actual_sha
  actual_sha="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
  [[ "${actual_sha}" == "${GATELM_PERF_GIT_SHA}" ]] || \
    perf_fail "Repository SHA ${actual_sha} does not match distributed SHA ${GATELM_PERF_GIT_SHA}."
  git -C "${REPO_ROOT}" diff --quiet || \
    perf_fail "Tracked working-tree changes prevent exact Git SHA evidence."
  git -C "${REPO_ROOT}" diff --cached --quiet || \
    perf_fail "Staged changes prevent exact Git SHA evidence."
  perf_log "Exact Git SHA verified (${actual_sha})."
}

dist_assert_role_host() {
  local role="$1"
  local expected_ip host_ips
  expected_ip="$(dist_expected_role_ip "${role}")"
  host_ips="$(hostname -I 2>/dev/null || true)"
  if [[ -z "${host_ips}" ]] && command -v ip >/dev/null 2>&1; then
    host_ips="$(ip -4 -o addr show scope global | awk '{print $4}' | cut -d/ -f1 | tr '\n' ' ')"
  fi
  [[ " ${host_ips} " == *" ${expected_ip} "* ]] || \
    perf_fail "Role ${role} must run on host private IP ${expected_ip}; observed: ${host_ips:-none}."
  perf_log "Role ${role} private IP verified (${expected_ip})."
}

dist_compose() {
  docker compose \
    --project-name "${DIST_PROJECT_NAME}" \
    --project-directory "${AWS_TRIAGE_DIR}" \
    --env-file "${DIST_ENV_FILE}" \
    -f "${DIST_COMPOSE_FILE}" \
    "$@"
}

dist_validate_compose() {
  local role="$1"
  if ! dist_compose --profile "${role}" config --quiet; then
    perf_fail "Distributed Compose configuration is invalid for role ${role}."
  fi
}

dist_wait_for_service() {
  local role="$1"
  local service="$2"
  local attempts="${3:-90}"
  local container_id status attempt
  perf_log "Waiting for ${service} on ${role} host..."
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    container_id="$(dist_compose --profile "${role}" ps -q "${service}" 2>/dev/null || true)"
    if [[ -n "${container_id}" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
      if [[ "${status}" == "healthy" || "${status}" == "running" ]]; then
        perf_log "${service} is ${status}."
        return 0
      fi
      if [[ "${status}" == "unhealthy" || "${status}" == "exited" || "${status}" == "dead" ]]; then
        dist_compose --profile "${role}" logs --tail=100 "${service}" >&2 || true
        perf_fail "${service} entered state ${status}."
      fi
    fi
    sleep 2
  done
  perf_fail "${service} did not become ready."
}

dist_psql() {
  perf_need_command "psql" "Install postgresql-client."
  PGPASSWORD="${POSTGRES_PASSWORD}" psql \
    -h "${GATELM_PERF_DATA_PRIVATE_IP}" \
    -p "${GATELM_PERF_POSTGRES_PORT}" \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    -v ON_ERROR_STOP=1 \
    "$@"
}

dist_apply_sql_file() {
  local sql_file="$1"
  [[ -f "${sql_file}" ]] || perf_fail "SQL file not found: ${sql_file}"
  dist_psql -q < "${sql_file}" || perf_fail "SQL migration failed: ${sql_file}"
}

dist_write_attestation() {
  local role="$1"
  local output_path machine_hash
  output_path="${DIST_ATTESTATION_DIR}/${role}.attestation.env"
  machine_hash="$(perf_machine_identity_hash "topology_${GATELM_PERF_TOPOLOGY_ID}")"

  umask 077
  mkdir -p "${DIST_ATTESTATION_DIR}"
  chmod 700 "${DIST_ATTESTATION_DIR}"
  printf '%s\n' \
    'GATELM_PERF_ATTESTATION_SCHEMA=gatelm.perf-distributed-attestation.v1' \
    "GATELM_PERF_ATTESTATION_ROLE=${role}" \
    "GATELM_PERF_ATTESTATION_TOPOLOGY_ID=${GATELM_PERF_TOPOLOGY_ID}" \
    "GATELM_PERF_ATTESTATION_GIT_SHA=${GATELM_PERF_GIT_SHA}" \
    "GATELM_PERF_ATTESTATION_PRIVATE_IP=$(dist_expected_role_ip "${role}")" \
    "GATELM_PERF_ATTESTATION_MACHINE_HASH=${machine_hash}" \
    > "${output_path}"
  chmod 600 "${output_path}"
  perf_log "Wrote safe ${role} topology attestation: ${output_path}"
}

dist_read_attestation() {
  local expected_role="$1"
  local path="$2"
  local line key value
  local schema="" role="" topology_id="" git_sha="" private_ip="" machine_hash=""

  [[ -f "${path}" && ! -L "${path}" ]] || \
    perf_fail "Distributed ${expected_role} attestation is missing or is a symbolic link."
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    [[ -n "${line}" && "${line}" == *=* ]] || \
      perf_fail "Distributed ${expected_role} attestation contains a malformed line."
    key="${line%%=*}"
    value="${line#*=}"
    case "${key}" in
      GATELM_PERF_ATTESTATION_SCHEMA) schema="${value}" ;;
      GATELM_PERF_ATTESTATION_ROLE) role="${value}" ;;
      GATELM_PERF_ATTESTATION_TOPOLOGY_ID) topology_id="${value}" ;;
      GATELM_PERF_ATTESTATION_GIT_SHA) git_sha="${value}" ;;
      GATELM_PERF_ATTESTATION_PRIVATE_IP) private_ip="${value}" ;;
      GATELM_PERF_ATTESTATION_MACHINE_HASH) machine_hash="${value}" ;;
      *) perf_fail "Unexpected key in distributed ${expected_role} attestation: ${key}" ;;
    esac
  done < "${path}"

  [[ "${schema}" == "gatelm.perf-distributed-attestation.v1" ]] || \
    perf_fail "Distributed ${expected_role} attestation schema is invalid."
  [[ "${role}" == "${expected_role}" ]] || \
    perf_fail "Distributed attestation role mismatch for ${expected_role}."
  [[ "${topology_id}" == "${GATELM_PERF_TOPOLOGY_ID}" ]] || \
    perf_fail "Distributed ${expected_role} attestation topology ID mismatch."
  [[ "${git_sha}" == "${GATELM_PERF_GIT_SHA}" ]] || \
    perf_fail "Distributed ${expected_role} attestation Git SHA mismatch."
  [[ "${private_ip}" == "$(dist_expected_role_ip "${expected_role}")" ]] || \
    perf_fail "Distributed ${expected_role} attestation private IP mismatch."
  [[ "${machine_hash}" =~ ^[a-f0-9]{64}$ ]] || \
    perf_fail "Distributed ${expected_role} attestation machine hash is invalid."
  DIST_ATTESTATION_MACHINE_HASH="${machine_hash}"
}

dist_verify_topology_attestations() {
  local role machine_hash
  local -A seen_hashes=()
  for role in loadgen gateway data mock; do
    dist_read_attestation "${role}" "${DIST_ATTESTATION_DIR}/${role}.attestation.env"
    machine_hash="${DIST_ATTESTATION_MACHINE_HASH}"
    [[ -z "${seen_hashes[${machine_hash}]+x}" ]] || \
      perf_fail "Distributed roles ${seen_hashes[${machine_hash}]} and ${role} have the same machine identity."
    seen_hashes["${machine_hash}"]="${role}"
  done
  perf_log "Four distinct role hosts and one exact Git SHA were verified."
}

dist_assert_runtime_configuration() {
  local expected_policy actual_policy provider_state
  expected_policy="true|application|60|${GATELM_PERF_RUNTIME_RATE_LIMIT_LIMIT}"
  actual_policy="$(dist_psql -tA -c "select concat_ws('|', rs.\"snapshotBody\" #>> '{policies,rateLimit,enabled}', rs.\"snapshotBody\" #>> '{policies,rateLimit,scope}', rs.\"snapshotBody\" #>> '{policies,rateLimit,windowSeconds}', rs.\"snapshotBody\" #>> '{policies,rateLimit,limit}') from active_runtime_snapshots ars join runtime_snapshots rs on rs.id = ars.\"runtimeSnapshotId\" where ars.\"tenantId\" = '${GATELM_DEMO_TENANT_ID}'::uuid and ars.\"projectId\" = '${GATELM_DEMO_PROJECT_ID}'::uuid and ars.\"applicationId\" = '${GATELM_DEMO_APPLICATION_ID}'::uuid;")"
  [[ "$(perf_trim "${actual_policy}")" == "${expected_policy}" ]] || \
    perf_fail "Active distributed RuntimeSnapshot rate limit is not ${expected_policy}."

  provider_state="$(dist_psql -tA -c "select concat_ws('|', count(*) filter (where provider = 'mock'), count(*) filter (where provider <> 'mock'), min(case when provider = 'mock' then \"baseUrl\" end)) from provider_connections;")"
  [[ "$(perf_trim "${provider_state}")" == "1|0|$(dist_mock_base_url)" ]] || \
    perf_fail "Distributed provider catalog is not isolated to the private Mock endpoint."
  perf_log "Distributed RuntimeSnapshot and Mock-only provider catalog verified."
}

dist_assert_no_live_provider_credentials() {
  local role="$1"
  local service
  case "${role}" in
    data) service=control-plane-api ;;
    gateway) service=gateway-core ;;
    *) perf_fail "Live Provider credential inspection is unsupported for role ${role}." ;;
  esac

  # Variables are intentionally expanded inside the target container.
  # shellcheck disable=SC2016
  if ! dist_compose --profile "${role}" exec -T "${service}" sh -c \
    'test -z "${OPENAI_API_KEY:-}" && test -z "${CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP:-}" && test -z "${GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP:-}" && test -z "${GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY:-}"'; then
    perf_fail "Live Provider credentials are present in distributed ${service}."
  fi
  perf_log "Live Provider credentials are absent from distributed ${service}."
}
