#!/usr/bin/env bash

if [[ -z "${BASH_VERSION:-}" ]]; then
  printf '%s\n' "[GateLM production distributed] ERROR: bash is required." >&2
  exit 1
fi

PRODUCTION_DISTRIBUTED_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${PRODUCTION_DISTRIBUTED_SCRIPT_DIR}/perf-lib.sh"

PRODUCTION_DISTRIBUTED_BASE_ENV_FILE="${GATELM_PRODUCTION_DISTRIBUTED_BASE_ENV_FILE:-${AWS_TRIAGE_DIR}/.env.production-distributed.base}"
PRODUCTION_DISTRIBUTED_ENV_FILE="${GATELM_PRODUCTION_DISTRIBUTED_ENV_FILE:-${AWS_TRIAGE_DIR}/.env.production-distributed}"
PRODUCTION_DISTRIBUTED_COMPOSE_FILE="${AWS_TRIAGE_DIR}/docker-compose.production.distributed.yml"
PRODUCTION_DISTRIBUTED_PII_COMPOSE_FILE="${AWS_TRIAGE_DIR}/docker-compose.production.pii.yml"
PRODUCTION_DISTRIBUTED_PII_MANIFEST="${AWS_TRIAGE_DIR}/pii-v36-model-manifest.sha256"
PRODUCTION_DISTRIBUTED_PROJECT_NAME="gatelm-production-distributed"
PRODUCTION_DISTRIBUTED_STATE_DIR="${GATELM_PRODUCTION_DISTRIBUTED_STATE_DIR:-${AWS_TRIAGE_DIR}/.production-distributed-state}"
PRODUCTION_DISTRIBUTED_DB_ATTESTATION=""

production_log() {
  printf '%s\n' "[GateLM production distributed] $*"
}

production_fail() {
  printf '%s\n' "[GateLM production distributed] ERROR: $*" >&2
  exit 1
}

production_load_env_file() {
  local path="$1"
  local line key value
  [[ -f "${path}" && ! -L "${path}" ]] || production_fail "Environment file is missing or is a symlink: ${path}"
  perf_assert_env_file_permissions "${path}" "Production distributed environment file"

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    line="$(perf_trim "${line}")"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" == *=* ]] || continue
    key="$(perf_trim "${line%%=*}")"
    value="$(perf_trim "${line#*=}")"
    [[ "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || continue
    value="$(perf_unquote_env_value "${value}")"
    export "${key}=${value}"
  done < "${path}"
}

production_load_env() {
  production_load_env_file "${PRODUCTION_DISTRIBUTED_BASE_ENV_FILE}"
  production_load_env_file "${PRODUCTION_DISTRIBUTED_ENV_FILE}"
  export GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP="${GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP:-10.78.2.50}"
  PRODUCTION_DISTRIBUTED_DB_ATTESTATION="${PRODUCTION_DISTRIBUTED_STATE_DIR}/db-restore-${GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME:-missing}.env"
}

production_require_env() {
  local missing=()
  local name
  for name in "$@"; do
    [[ -n "${!name-}" ]] || missing+=("${name}")
  done
  (( ${#missing[@]} == 0 )) || production_fail "Required values are missing: ${missing[*]}"
}

production_validate_env() {
  local name value
  production_require_env \
    GATELM_PRODUCTION_DISTRIBUTED_SOURCE_SHA \
    GATELM_PRODUCTION_DISTRIBUTED_DB_SOURCE_SHA \
    GATELM_PRODUCTION_DISTRIBUTED_IMAGE_TAG \
    GATELM_PRODUCTION_DISTRIBUTED_BUILD_CONTEXT \
    GATELM_PRODUCTION_DISTRIBUTED_E5_BUNDLE_CONTEXT \
    GATELM_PRODUCTION_DISTRIBUTED_EDGE_PRIVATE_IP \
    GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_PRIVATE_IP \
    GATELM_PRODUCTION_DISTRIBUTED_DATA_PRIVATE_IP \
    GATELM_PRODUCTION_DISTRIBUTED_AI_PRIVATE_IP \
    GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP \
    GATELM_PRODUCTION_DISTRIBUTED_PII_MODEL_DIR \
    GATELM_PRODUCTION_DISTRIBUTED_PII_ARTIFACT_S3_URI \
    GATELM_PRODUCTION_DISTRIBUTED_PII_ARTIFACT_SHA256 \
    GATELM_PRODUCTION_DISTRIBUTED_SECRET_ROOT \
    GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME \
    GATELM_PRODUCTION_DISTRIBUTED_REDIS_VOLUME_NAME \
    GATELM_PRODUCTION_DISTRIBUTED_CADDY_DATA_VOLUME_NAME \
    GATELM_PRODUCTION_DISTRIBUTED_CADDY_CONFIG_VOLUME_NAME \
    GATELM_PRODUCTION_DISTRIBUTED_PHASE \
    GATELM_PRODUCTION_DISTRIBUTED_LIVE_REQUESTS_ALLOWED \
    GATELM_PRODUCTION_DISTRIBUTED_CADDYFILE

  [[ "${GATELM_PRODUCTION_DISTRIBUTED_SOURCE_SHA}" =~ ^[a-f0-9]{40}$ ]] || \
    production_fail "GATELM_PRODUCTION_DISTRIBUTED_SOURCE_SHA must be a full lowercase Git SHA."
  [[ "${GATELM_PRODUCTION_DISTRIBUTED_DB_SOURCE_SHA}" =~ ^[a-f0-9]{40}$ ]] || \
    production_fail "GATELM_PRODUCTION_DISTRIBUTED_DB_SOURCE_SHA must be a full lowercase Git SHA."
  [[ "${GATELM_PRODUCTION_DISTRIBUTED_IMAGE_TAG}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$ ]] || \
    production_fail "GATELM_PRODUCTION_DISTRIBUTED_IMAGE_TAG is not a safe image tag."

  for name in \
    GATELM_PRODUCTION_DISTRIBUTED_BUILD_CONTEXT \
    GATELM_PRODUCTION_DISTRIBUTED_E5_BUNDLE_CONTEXT \
    GATELM_PRODUCTION_DISTRIBUTED_PII_MODEL_DIR \
    GATELM_PRODUCTION_DISTRIBUTED_SECRET_ROOT; do
    value="${!name}"
    [[ "${value}" == /* ]] || production_fail "${name} must be absolute."
  done

  for name in \
    GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME \
    GATELM_PRODUCTION_DISTRIBUTED_REDIS_VOLUME_NAME \
    GATELM_PRODUCTION_DISTRIBUTED_CADDY_DATA_VOLUME_NAME \
    GATELM_PRODUCTION_DISTRIBUTED_CADDY_CONFIG_VOLUME_NAME; do
    value="${!name}"
    [[ "${value}" =~ ^gatelm-production-distributed-[a-z0-9][a-z0-9_.-]{0,100}$ ]] || \
      production_fail "${name} must stay inside the gatelm-production-distributed-* namespace."
  done

  [[ "${GATELM_PRODUCTION_DISTRIBUTED_EDGE_PRIVATE_IP}" == "10.78.1.10" ]] || production_fail "Unexpected Edge IP."
  [[ "${GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_PRIVATE_IP}" == "10.78.2.20" ]] || production_fail "Unexpected Gateway IP."
  [[ "${GATELM_PRODUCTION_DISTRIBUTED_DATA_PRIVATE_IP}" == "10.78.2.30" ]] || production_fail "Unexpected Data IP."
  [[ "${GATELM_PRODUCTION_DISTRIBUTED_AI_PRIVATE_IP}" == "10.78.2.40" ]] || production_fail "Unexpected AI IP."
  [[ "${GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP}" == "10.78.2.50" ]] || production_fail "Unexpected PII IP."
  [[ "${GATELM_PRODUCTION_DISTRIBUTED_PII_MODEL_DIR}" == "/opt/gatelm/pii-v36/releases/171bbde0/model" ]] || \
    production_fail "Unexpected pinned PII model directory."
  [[ "${GATELM_PRODUCTION_DISTRIBUTED_PII_ARTIFACT_S3_URI}" =~ ^s3://[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]/pii/v36/[A-Za-z0-9._/-]+\.tar\.gz$ ]] || \
    production_fail "PII artifact URI must be a private s3:// bucket path under pii/v36/."
  [[ "${GATELM_PRODUCTION_DISTRIBUTED_PII_ARTIFACT_SHA256}" =~ ^[a-f0-9]{64}$ ]] || \
    production_fail "PII artifact SHA-256 must be lowercase hexadecimal."

  [[ "${GATEWAY_AUTH_CACHE_ENABLED:-true}" == "true" ]] || production_fail "Production auth cache must be enabled."
  [[ "${GATEWAY_AUTH_CACHE_TTL_MS:-5000}" == "5000" ]] || production_fail "Production auth cache TTL must be 5000ms."
  [[ "${GATEWAY_AUTH_CACHE_MAX_ENTRIES:-4096}" == "4096" ]] || production_fail "Unexpected production auth cache size."

  case "${GATELM_PRODUCTION_DISTRIBUTED_PHASE}" in
    rehearsal)
      [[ "${GATELM_PRODUCTION_DISTRIBUTED_SOURCE_SHA}" == "${GATELM_PRODUCTION_DISTRIBUTED_DB_SOURCE_SHA}" ]] || \
        production_fail "Application and restored database source SHAs must match during migration rehearsal."
      [[ "${GATELM_PRODUCTION_DISTRIBUTED_LIVE_REQUESTS_ALLOWED}" == "false" ]] || \
        production_fail "Rehearsal must block authenticated live requests."
      [[ "$(basename "${GATELM_PRODUCTION_DISTRIBUTED_CADDYFILE}")" == "Caddyfile.production-distributed.rehearsal" ]] || \
        production_fail "Rehearsal must use the internal-TLS Caddyfile."
      ;;
    production)
      [[ "${GATELM_PRODUCTION_DISTRIBUTED_LIVE_REQUESTS_ALLOWED}" == "true" ]] || \
        production_fail "Production cutover requires explicit live-request permission."
      [[ "$(basename "${GATELM_PRODUCTION_DISTRIBUTED_CADDYFILE}")" == "Caddyfile.production-distributed.production" ]] || \
        production_fail "Production cutover must use the ACME Caddyfile."
      ;;
    *) production_fail "GATELM_PRODUCTION_DISTRIBUTED_PHASE must be rehearsal or production." ;;
  esac
}

production_require_active_env() {
  local role="$1"
  shift
  local name value
  for name in "$@"; do
    value="${!name-}"
    [[ -n "${value}" && "${value}" != unused-for-* ]] || \
      production_fail "Active ${role} value is missing or placeholder-backed: ${name}"
  done
}

production_expected_ip() {
  case "$1" in
    edge) printf '%s\n' "${GATELM_PRODUCTION_DISTRIBUTED_EDGE_PRIVATE_IP}" ;;
    gateway) printf '%s\n' "${GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_PRIVATE_IP}" ;;
    data) printf '%s\n' "${GATELM_PRODUCTION_DISTRIBUTED_DATA_PRIVATE_IP}" ;;
    ai) printf '%s\n' "${GATELM_PRODUCTION_DISTRIBUTED_AI_PRIVATE_IP}" ;;
    pii) printf '%s\n' "${GATELM_PRODUCTION_DISTRIBUTED_PII_PRIVATE_IP}" ;;
    *) production_fail "Unknown production role: $1" ;;
  esac
}

production_assert_role_host() {
  local role="$1"
  local expected_ip host_ips marker
  expected_ip="$(production_expected_ip "${role}")"
  host_ips="$(hostname -I 2>/dev/null || true)"
  [[ " ${host_ips} " == *" ${expected_ip} "* ]] || \
    production_fail "Role ${role} must run on ${expected_ip}; observed ${host_ips:-none}."
  [[ -f /etc/gatelm-production-role ]] || production_fail "Host role marker is missing."
  marker="$(tr -d '[:space:]' < /etc/gatelm-production-role)"
  [[ "${marker}" == "${role}" ]] || production_fail "Role marker ${marker:-empty} does not match ${role}."
}

production_assert_build_source() {
  local role="$1"
  local actual_sha status
  [[ -d "${GATELM_PRODUCTION_DISTRIBUTED_BUILD_CONTEXT}/.git" || -f "${GATELM_PRODUCTION_DISTRIBUTED_BUILD_CONTEXT}/.git" ]] || \
    production_fail "Build context is not a Git checkout."
  actual_sha="$(git -c safe.directory="${GATELM_PRODUCTION_DISTRIBUTED_BUILD_CONTEXT}" -C "${GATELM_PRODUCTION_DISTRIBUTED_BUILD_CONTEXT}" rev-parse HEAD)"
  [[ "${actual_sha}" == "${GATELM_PRODUCTION_DISTRIBUTED_SOURCE_SHA}" ]] || \
    production_fail "Build source ${actual_sha} does not match ${GATELM_PRODUCTION_DISTRIBUTED_SOURCE_SHA}."
  status="$(git -c safe.directory="${GATELM_PRODUCTION_DISTRIBUTED_BUILD_CONTEXT}" -C "${GATELM_PRODUCTION_DISTRIBUTED_BUILD_CONTEXT}" status --porcelain --untracked-files=all)"
  [[ -z "${status}" ]] || production_fail "Build source contains tracked or untracked changes."
  if [[ "${role}" == "gateway" ]]; then
    [[ -d "${GATELM_PRODUCTION_DISTRIBUTED_E5_BUNDLE_CONTEXT}" ]] || \
      production_fail "E5 runtime bundle is missing: ${GATELM_PRODUCTION_DISTRIBUTED_E5_BUNDLE_CONTEXT}"
  fi
}

production_role_secret_files() {
  case "$1" in
    data)
      printf '%s\n' \
        tenant-chat/signing.jwk.json \
        tenant-chat/binding-hmac-keys.json \
        tenant-chat/content-keys.json \
        rag/content-wrapping-keys.json \
        rag/query-signing.jwk.json \
        rag/query-binding-hmac-keys.json \
        rag/worker-signing.jwk.json \
        rag/worker-binding-hmac-keys.json
      ;;
    gateway)
      printf '%s\n' \
        tenant-chat/jwks.json \
        tenant-chat/binding-hmac-keys.json \
        tenant-chat/cache-keysets.json \
        tenant-chat/usage-receipt-token \
        rag/workload-jwks.json \
        rag/workload-binding-hmac-keys.json \
        rag/workload-identities.json
      ;;
    edge|ai|pii) ;;
    *) production_fail "Unknown production role: $1" ;;
  esac
}

production_assert_role_secrets() {
  local role="$1"
  local relative path mode
  while IFS= read -r relative; do
    [[ -n "${relative}" ]] || continue
    path="${GATELM_PRODUCTION_DISTRIBUTED_SECRET_ROOT}/${relative}"
    [[ -f "${path}" && ! -L "${path}" ]] || production_fail "Required ${role} secret is missing: ${relative}"
    mode="$(stat -c '%a' "${path}" 2>/dev/null || true)"
    [[ "${mode}" == "600" ]] || production_fail "Secret ${relative} must have mode 600, observed ${mode:-unknown}."
  done < <(production_role_secret_files "${role}")
}

production_role_services() {
  case "$1" in
    data) printf '%s\n' "postgres redis control-plane-api chat-api rag-worker" ;;
    gateway) printf '%s\n' "gateway-core" ;;
    ai) printf '%s\n' "ai-service mock-provider" ;;
    pii) printf '%s\n' "pii-service" ;;
    edge) printf '%s\n' "web chat-web caddy" ;;
    *) production_fail "Unknown production role: $1" ;;
  esac
}

production_role_build_services() {
  case "$1" in
    data) printf '%s\n' "control-plane-api chat-api" ;;
    gateway) printf '%s\n' "gateway-core" ;;
    ai) printf '%s\n' "ai-service" ;;
    pii) printf '%s\n' "pii-service" ;;
    edge) printf '%s\n' "web chat-web" ;;
    *) production_fail "Unknown production role: $1" ;;
  esac
}

production_compose() {
  local role="$1"
  shift
  local profile_args=()
  local compose_file="${PRODUCTION_DISTRIBUTED_COMPOSE_FILE}"
  if [[ "${role}" == "data" ]]; then
    profile_args=(--profile data --profile rag)
  elif [[ "${role}" == "pii" ]]; then
    profile_args=(--profile pii)
    compose_file="${PRODUCTION_DISTRIBUTED_PII_COMPOSE_FILE}"
  else
    profile_args=(--profile "${role}")
  fi
  docker compose \
    --project-name "${PRODUCTION_DISTRIBUTED_PROJECT_NAME}" \
    --project-directory "${AWS_TRIAGE_DIR}" \
    --env-file "${PRODUCTION_DISTRIBUTED_BASE_ENV_FILE}" \
    --env-file "${PRODUCTION_DISTRIBUTED_ENV_FILE}" \
    -f "${compose_file}" \
    "${profile_args[@]}" \
    "$@"
}

production_assert_pii_model_artifact() {
  local model_dir="${GATELM_PRODUCTION_DISTRIBUTED_PII_MODEL_DIR}"
  local expected_files observed_files
  [[ -f "${PRODUCTION_DISTRIBUTED_PII_MANIFEST}" && ! -L "${PRODUCTION_DISTRIBUTED_PII_MANIFEST}" ]] || \
    production_fail "PII model manifest is missing or unsafe."
  [[ -d "${model_dir}" && ! -L "${model_dir}" ]] || \
    production_fail "PII model directory is missing or unsafe: ${model_dir}"
  (
    cd "${model_dir}"
    sha256sum --check "${PRODUCTION_DISTRIBUTED_PII_MANIFEST}" >/dev/null
  ) || production_fail "PII model artifact verification failed."
  expected_files="$(awk 'NF == 2 {print $2}' "${PRODUCTION_DISTRIBUTED_PII_MANIFEST}" | sort)"
  observed_files="$(find "${model_dir}" -maxdepth 1 -type f -printf '%f\n' | sort)"
  [[ "${observed_files}" == "${expected_files}" ]] || production_fail "PII model directory contains missing or unexpected files."
}

production_wait_for_service() {
  local role="$1" service="$2" attempts="${3:-120}"
  local container_id status attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    container_id="$(production_compose "${role}" ps -q "${service}" 2>/dev/null || true)"
    if [[ -n "${container_id}" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
      [[ "${status}" == "healthy" || "${status}" == "running" ]] && return 0
      if [[ "${status}" == "unhealthy" || "${status}" == "exited" || "${status}" == "dead" ]]; then
        production_compose "${role}" logs --tail=100 "${service}" >&2 || true
        production_fail "${service} entered state ${status}."
      fi
    fi
    sleep 2
  done
  production_fail "${service} did not become ready."
}

production_assert_tcp() {
  local label="$1" host="$2" port="$3"
  timeout 5 bash -c "</dev/tcp/${host}/${port}" 2>/dev/null || \
    production_fail "${label} is not reachable at ${host}:${port}."
}

production_assert_http_ready() {
  local label="$1" url="$2"
  curl --fail --silent --show-error --noproxy '*' --connect-timeout 3 --max-time 5 "${url}" >/dev/null || \
    production_fail "${label} is not ready at ${url}."
}

production_assert_db_attestation() {
  [[ -f "${PRODUCTION_DISTRIBUTED_DB_ATTESTATION}" && ! -L "${PRODUCTION_DISTRIBUTED_DB_ATTESTATION}" ]] || \
    production_fail "Database restore attestation is missing: ${PRODUCTION_DISTRIBUTED_DB_ATTESTATION}"
  grep -Eq '^GATELM_PRODUCTION_DISTRIBUTED_DUMP_SHA256=[a-f0-9]{64}$' "${PRODUCTION_DISTRIBUTED_DB_ATTESTATION}" || \
    production_fail "Database restore attestation is malformed."
  grep -Fqx "GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME=${GATELM_PRODUCTION_DISTRIBUTED_POSTGRES_VOLUME_NAME}" "${PRODUCTION_DISTRIBUTED_DB_ATTESTATION}" || \
    production_fail "Database restore attestation belongs to a different volume."
  grep -Fqx "GATELM_PRODUCTION_DISTRIBUTED_DB_SOURCE_SHA=${GATELM_PRODUCTION_DISTRIBUTED_DB_SOURCE_SHA}" "${PRODUCTION_DISTRIBUTED_DB_ATTESTATION}" || \
    production_fail "Database restore attestation belongs to a different source SHA."
}
