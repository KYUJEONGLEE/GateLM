#!/usr/bin/env bash

if [[ -z "${BASH_VERSION:-}" ]]; then
  printf '%s\n' "[GateLM prod clone] ERROR: bash is required." >&2
  exit 1
fi

PROD_CLONE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${PROD_CLONE_SCRIPT_DIR}/perf-lib.sh"

PROD_CLONE_BASE_ENV_FILE="${GATELM_PROD_CLONE_BASE_ENV_FILE:-${AWS_TRIAGE_DIR}/.env.prod-clone.base}"
PROD_CLONE_ENV_FILE="${GATELM_PROD_CLONE_ENV_FILE:-${AWS_TRIAGE_DIR}/.env.prod-clone}"
PROD_CLONE_COMPOSE_FILE="${AWS_TRIAGE_DIR}/docker-compose.prod-clone.yml"
PROD_CLONE_AUTH_CACHE_COMPOSE_FILE="${AWS_TRIAGE_DIR}/docker-compose.prod-clone.auth-cache.yml"
PROD_CLONE_RESTORE_COMPOSE_FILE="${AWS_TRIAGE_DIR}/docker-compose.prod-clone.restore.yml"
PROD_CLONE_PROJECT_NAME="gatelm-prod-clone"
PROD_CLONE_RESTORE_PROJECT_NAME="gatelm-prod-clone-restore"
PROD_CLONE_STATE_DIR="${GATELM_PROD_CLONE_STATE_DIR:-${AWS_TRIAGE_DIR}/.prod-clone-state}"
PROD_CLONE_DB_ATTESTATION=""

clone_log() {
  printf '%s\n' "[GateLM prod clone] $*"
}

clone_fail() {
  printf '%s\n' "[GateLM prod clone] ERROR: $*" >&2
  exit 1
}

clone_load_env_file() {
  local path="$1"
  local line key value
  [[ -f "${path}" && ! -L "${path}" ]] || clone_fail "Environment file is missing or is a symlink: ${path}"
  perf_assert_env_file_permissions "${path}" "Production-clone environment file"

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

clone_load_env() {
  clone_load_env_file "${PROD_CLONE_BASE_ENV_FILE}"
  clone_load_env_file "${PROD_CLONE_ENV_FILE}"
  PROD_CLONE_DB_ATTESTATION="${PROD_CLONE_STATE_DIR}/db-restore-${GATELM_PROD_CLONE_POSTGRES_VOLUME_NAME:-missing}.env"
}

clone_require_env() {
  local missing=()
  local name
  for name in "$@"; do
    [[ -n "${!name-}" ]] || missing+=("${name}")
  done
  (( ${#missing[@]} == 0 )) || clone_fail "Required values are missing: ${missing[*]}"
}

clone_validate_env() {
  local name value
  clone_require_env \
    GATELM_PROD_CLONE_SOURCE_SHA \
    GATELM_PROD_CLONE_DB_SOURCE_SHA \
    GATELM_PROD_CLONE_IMAGE_TAG \
    GATELM_PROD_CLONE_BUILD_CONTEXT \
    GATELM_PROD_CLONE_E5_BUNDLE_CONTEXT \
    GATELM_PROD_CLONE_EDGE_PRIVATE_IP \
    GATELM_PROD_CLONE_GATEWAY_PRIVATE_IP \
    GATELM_PROD_CLONE_DATA_PRIVATE_IP \
    GATELM_PROD_CLONE_AI_PRIVATE_IP \
    GATELM_PROD_CLONE_SECRET_ROOT \
    GATELM_PROD_CLONE_POSTGRES_VOLUME_NAME \
    GATELM_PROD_CLONE_REDIS_VOLUME_NAME \
    GATELM_PROD_CLONE_CADDY_DATA_VOLUME_NAME \
    GATELM_PROD_CLONE_CADDY_CONFIG_VOLUME_NAME \
    GATELM_PROD_CLONE_PHASE \
    GATELM_PROD_CLONE_ALLOW_LIVE_PROVIDER \
    GATELM_PROD_CLONE_ALLOW_SMTP \
    GATELM_PROD_CLONE_AUTH_CACHE_CONFIG \
    GATELM_PROD_CLONE_CADDYFILE \
    POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB

  [[ "${GATELM_PROD_CLONE_SOURCE_SHA}" =~ ^[a-f0-9]{40}$ ]] || \
    clone_fail "GATELM_PROD_CLONE_SOURCE_SHA must be a full lowercase Git SHA."
  [[ "${GATELM_PROD_CLONE_DB_SOURCE_SHA}" =~ ^[a-f0-9]{40}$ ]] || \
    clone_fail "GATELM_PROD_CLONE_DB_SOURCE_SHA must be a full lowercase Git SHA."
  [[ "${GATELM_PROD_CLONE_SOURCE_SHA}" == "${GATELM_PROD_CLONE_DB_SOURCE_SHA}" ]] || \
    clone_fail "Application and database source SHAs must match for controlled clone evidence."
  [[ "${GATELM_PROD_CLONE_IMAGE_TAG}" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$ ]] || \
    clone_fail "GATELM_PROD_CLONE_IMAGE_TAG is not a safe image tag."
  [[ "${GATELM_PROD_CLONE_BUILD_CONTEXT}" == /* ]] || \
    clone_fail "GATELM_PROD_CLONE_BUILD_CONTEXT must be absolute."
  [[ "${GATELM_PROD_CLONE_E5_BUNDLE_CONTEXT}" == /* ]] || \
    clone_fail "GATELM_PROD_CLONE_E5_BUNDLE_CONTEXT must be absolute."
  [[ "${GATELM_PROD_CLONE_SECRET_ROOT}" == /* ]] || \
    clone_fail "GATELM_PROD_CLONE_SECRET_ROOT must be absolute."
  for name in \
    GATELM_PROD_CLONE_POSTGRES_VOLUME_NAME \
    GATELM_PROD_CLONE_REDIS_VOLUME_NAME \
    GATELM_PROD_CLONE_CADDY_DATA_VOLUME_NAME \
    GATELM_PROD_CLONE_CADDY_CONFIG_VOLUME_NAME; do
    value="${!name}"
    [[ "${value}" =~ ^gatelm-prod-clone-[a-z0-9][a-z0-9_.-]{0,100}$ ]] || \
      clone_fail "${name} must stay inside the gatelm-prod-clone-* namespace."
  done
  [[ "${GATELM_PROD_CLONE_AUTH_CACHE_CONFIG}" == "true" || "${GATELM_PROD_CLONE_AUTH_CACHE_CONFIG}" == "false" ]] || \
    clone_fail "GATELM_PROD_CLONE_AUTH_CACHE_CONFIG must be true or false."
  if [[ "${GATELM_PROD_CLONE_SOURCE_SHA}" == "13d2964fe76e074e4e61f03ece588794fe0cc5e4" ]]; then
    [[ "${GATELM_PROD_CLONE_AUTH_CACHE_CONFIG}" == "false" ]] || \
      clone_fail "The 13d2964f topology baseline must not include the later auth-cache configuration."
  fi

  local -A seen_ips=()
  for name in \
    GATELM_PROD_CLONE_EDGE_PRIVATE_IP \
    GATELM_PROD_CLONE_GATEWAY_PRIVATE_IP \
    GATELM_PROD_CLONE_DATA_PRIVATE_IP \
    GATELM_PROD_CLONE_AI_PRIVATE_IP; do
    value="${!name}"
    perf_is_private_ipv4 "${value}" || clone_fail "${name} must be an RFC1918 IPv4 address."
    [[ -z "${seen_ips[${value}]+x}" ]] || clone_fail "Clone role private IPs must be distinct."
    seen_ips["${value}"]=1
  done

  case "${GATELM_PROD_CLONE_PHASE}" in
    benchmark|rehearsal)
      [[ "${GATELM_PROD_CLONE_ALLOW_LIVE_PROVIDER}" == "false" ]] || \
        clone_fail "Live Provider traffic must be disabled before production cutover."
      [[ "${GATELM_PROD_CLONE_ALLOW_SMTP}" == "false" ]] || \
        clone_fail "SMTP must be disabled before production cutover."
      [[ "${GATELM_DEMO_PROVIDER_MODE:-}" == "mock" ]] || \
        clone_fail "Non-production clone phases require GATELM_DEMO_PROVIDER_MODE=mock."
      [[ "${GATEWAY_DEFAULT_PROVIDER:-}" == "mock" ]] || \
        clone_fail "Non-production clone phases require GATEWAY_DEFAULT_PROVIDER=mock."
      [[ "${MOCK_PROVIDER_DEFAULT_LATENCY_MS:-}" == "100" ]] || \
        clone_fail "Formal clone benchmarks require exactly 100ms Mock latency."
      [[ -z "${OPENAI_API_KEY:-}" ]] || clone_fail "OPENAI_API_KEY must be empty in a private clone."
      [[ -z "${CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP:-}" ]] || \
        clone_fail "Control Plane Provider env mapping must be empty in a private clone."
      [[ -z "${GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP:-}" ]] || \
        clone_fail "Gateway Provider env mapping must be empty in a private clone."
      [[ "${SMTP_HOST:-}" == "127.0.0.1" && "${SMTP_PORT:-}" == "1" ]] || \
        clone_fail "Private clone SMTP must point to the closed local port 127.0.0.1:1."
      [[ "$(basename "${GATELM_PROD_CLONE_CADDYFILE}")" == "Caddyfile.prod-clone.rehearsal" ]] || \
        clone_fail "Private clone phases must use the internal-TLS rehearsal Caddyfile."
      ;;
    production)
      [[ "${GATELM_PROD_CLONE_ALLOW_LIVE_PROVIDER}" == "true" ]] || \
        clone_fail "Production phase requires explicit live Provider permission."
      [[ "${GATELM_PROD_CLONE_ALLOW_SMTP}" == "true" ]] || \
        clone_fail "Production phase requires explicit SMTP permission."
      [[ "$(basename "${GATELM_PROD_CLONE_CADDYFILE}")" == "Caddyfile.prod-clone.production" ]] || \
        clone_fail "Production phase must use the ACME Caddyfile."
      ;;
    *) clone_fail "GATELM_PROD_CLONE_PHASE must be benchmark, rehearsal, or production." ;;
  esac
}

clone_expected_ip() {
  case "$1" in
    edge) printf '%s\n' "${GATELM_PROD_CLONE_EDGE_PRIVATE_IP}" ;;
    gateway) printf '%s\n' "${GATELM_PROD_CLONE_GATEWAY_PRIVATE_IP}" ;;
    data|rag) printf '%s\n' "${GATELM_PROD_CLONE_DATA_PRIVATE_IP}" ;;
    ai) printf '%s\n' "${GATELM_PROD_CLONE_AI_PRIVATE_IP}" ;;
    *) clone_fail "Unknown clone role: $1" ;;
  esac
}

clone_expected_perf_marker() {
  case "$1" in
    edge) printf '%s\n' loadgen ;;
    gateway) printf '%s\n' gateway ;;
    data|rag) printf '%s\n' data ;;
    ai) printf '%s\n' mock ;;
    *) clone_fail "Unknown clone role: $1" ;;
  esac
}

clone_assert_role_host() {
  local role="$1"
  local expected_ip expected_marker host_ips marker
  expected_ip="$(clone_expected_ip "${role}")"
  expected_marker="$(clone_expected_perf_marker "${role}")"
  host_ips="$(hostname -I 2>/dev/null || true)"
  [[ " ${host_ips} " == *" ${expected_ip} "* ]] || \
    clone_fail "Role ${role} must run on ${expected_ip}; observed ${host_ips:-none}."
  [[ -f /etc/gatelm-perf-role ]] || clone_fail "Host role marker /etc/gatelm-perf-role is missing."
  marker="$(tr -d '[:space:]' < /etc/gatelm-perf-role)"
  [[ "${marker}" == "${expected_marker}" ]] || \
    clone_fail "Role marker ${marker:-empty} does not match ${expected_marker}."
}

clone_assert_build_source() {
  local role="$1"
  [[ -d "${GATELM_PROD_CLONE_BUILD_CONTEXT}/.git" || -f "${GATELM_PROD_CLONE_BUILD_CONTEXT}/.git" ]] || \
    clone_fail "Build context is not a Git checkout: ${GATELM_PROD_CLONE_BUILD_CONTEXT}"
  local actual_sha status
  actual_sha="$(git -C "${GATELM_PROD_CLONE_BUILD_CONTEXT}" rev-parse HEAD)"
  [[ "${actual_sha}" == "${GATELM_PROD_CLONE_SOURCE_SHA}" ]] || \
    clone_fail "Build source ${actual_sha} does not match ${GATELM_PROD_CLONE_SOURCE_SHA}."
  status="$(git -C "${GATELM_PROD_CLONE_BUILD_CONTEXT}" status --porcelain --untracked-files=all)"
  [[ -z "${status}" ]] || clone_fail "Build source contains tracked or untracked changes."
  if [[ "${role}" == "gateway" ]]; then
    [[ -d "${GATELM_PROD_CLONE_E5_BUNDLE_CONTEXT}" ]] || \
      clone_fail "E5 runtime bundle is missing: ${GATELM_PROD_CLONE_E5_BUNDLE_CONTEXT}"
  fi
}

clone_role_secret_files() {
  case "$1" in
    data)
      printf '%s\n' \
        tenant-chat/signing.jwk.json \
        tenant-chat/binding-hmac-keys.json \
        tenant-chat/content-keys.json \
        rag/content-wrapping-keys.json \
        rag/query-signing.jwk.json \
        rag/query-binding-hmac-keys.json
      ;;
    rag)
      printf '%s\n' \
        rag/content-wrapping-keys.json \
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
    edge|ai) ;;
    *) clone_fail "Unknown clone role: $1" ;;
  esac
}

clone_assert_role_secrets() {
  local role="$1"
  local relative path mode
  while IFS= read -r relative; do
    [[ -n "${relative}" ]] || continue
    path="${GATELM_PROD_CLONE_SECRET_ROOT}/${relative}"
    [[ -f "${path}" && ! -L "${path}" ]] || clone_fail "Required ${role} secret is missing: ${relative}"
    mode="$(stat -c '%a' "${path}" 2>/dev/null || true)"
    [[ "${mode}" == "600" ]] || clone_fail "Secret ${relative} must have mode 600, observed ${mode:-unknown}."
  done < <(clone_role_secret_files "${role}")
}

clone_role_services() {
  case "$1" in
    data) printf '%s\n' "postgres redis control-plane-api chat-api" ;;
    rag) printf '%s\n' "rag-worker" ;;
    gateway) printf '%s\n' "gateway-core" ;;
    ai) printf '%s\n' "ai-service mock-provider" ;;
    edge) printf '%s\n' "web chat-web caddy" ;;
    *) clone_fail "Unknown clone role: $1" ;;
  esac
}

clone_compose() {
  local compose_args=(
    --project-name "${PROD_CLONE_PROJECT_NAME}"
    --project-directory "${AWS_TRIAGE_DIR}"
    --env-file "${PROD_CLONE_BASE_ENV_FILE}"
    --env-file "${PROD_CLONE_ENV_FILE}"
    -f "${PROD_CLONE_COMPOSE_FILE}"
  )
  if [[ "${GATELM_PROD_CLONE_AUTH_CACHE_CONFIG}" == "true" ]]; then
    compose_args+=(-f "${PROD_CLONE_AUTH_CACHE_COMPOSE_FILE}")
  fi
  docker compose "${compose_args[@]}" "$@"
}

clone_restore_compose() {
  docker compose \
    --project-name "${PROD_CLONE_RESTORE_PROJECT_NAME}" \
    --project-directory "${AWS_TRIAGE_DIR}" \
    --env-file "${PROD_CLONE_BASE_ENV_FILE}" \
    --env-file "${PROD_CLONE_ENV_FILE}" \
    -f "${PROD_CLONE_RESTORE_COMPOSE_FILE}" \
    "$@"
}

clone_wait_for_service() {
  local role="$1"
  local service="$2"
  local attempts="${3:-90}"
  local container_id status attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    container_id="$(clone_compose --profile "${role}" ps -q "${service}" 2>/dev/null || true)"
    if [[ -n "${container_id}" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
      [[ "${status}" == "healthy" || "${status}" == "running" ]] && return 0
      if [[ "${status}" == "unhealthy" || "${status}" == "exited" || "${status}" == "dead" ]]; then
        clone_compose --profile "${role}" logs --tail=100 "${service}" >&2 || true
        clone_fail "${service} entered state ${status}."
      fi
    fi
    sleep 2
  done
  clone_fail "${service} did not become ready."
}

clone_assert_tcp() {
  local label="$1" host="$2" port="$3"
  timeout 5 bash -c "</dev/tcp/${host}/${port}" 2>/dev/null || \
    clone_fail "${label} is not reachable at ${host}:${port}."
}

clone_assert_db_attestation() {
  [[ -f "${PROD_CLONE_DB_ATTESTATION}" && ! -L "${PROD_CLONE_DB_ATTESTATION}" ]] || \
    clone_fail "Database restore attestation is missing: ${PROD_CLONE_DB_ATTESTATION}"
  grep -Eq '^GATELM_PROD_CLONE_DUMP_SHA256=[a-f0-9]{64}$' "${PROD_CLONE_DB_ATTESTATION}" || \
    clone_fail "Database restore attestation is malformed."
  grep -Fqx "GATELM_PROD_CLONE_POSTGRES_VOLUME_NAME=${GATELM_PROD_CLONE_POSTGRES_VOLUME_NAME}" "${PROD_CLONE_DB_ATTESTATION}" || \
    clone_fail "Database restore attestation belongs to a different volume."
}
