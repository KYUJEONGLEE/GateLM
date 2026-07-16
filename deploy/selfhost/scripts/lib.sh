#!/usr/bin/env bash

if [[ -z "${BASH_VERSION:-}" ]]; then
  printf '%s\n' "[GateLM self-host] ERROR: bash is required. Run this script with bash." >&2
  exit 1
fi

SELFHOST_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELFHOST_DIR="$(cd "${SELFHOST_SCRIPT_DIR}/.." && pwd)"
SELFHOST_ENV_FILE="${SELFHOST_ENV_FILE:-${SELFHOST_DIR}/.env}"
SELFHOST_COMPOSE_FILE="${SELFHOST_COMPOSE_FILE:-${SELFHOST_DIR}/docker-compose.yml}"
SELFHOST_RAG_COMPOSE_FILE="${SELFHOST_RAG_COMPOSE_FILE:-${SELFHOST_DIR}/docker-compose.rag.yml}"
SELFHOST_COMPOSE_ARGS=(-f "${SELFHOST_COMPOSE_FILE}")

gatelm_log() {
  printf '%s\n' "[GateLM self-host] $*"
}

gatelm_warn() {
  printf '%s\n' "[GateLM self-host] WARNING: $*" >&2
}

gatelm_fail() {
  printf '%s\n' "[GateLM self-host] ERROR: $*" >&2
  exit 1
}

gatelm_trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "$value"
}

gatelm_unquote_env_value() {
  local value="$1"
  if [[ ${#value} -ge 2 ]]; then
    local first="${value:0:1}"
    local last="${value: -1}"
    if [[ "${first}" == '"' && "${last}" == '"' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "${first}" == "'" && "${last}" == "'" ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi
  printf '%s' "$value"
}

gatelm_require_file() {
  local file_path="$1"
  local guidance="$2"
  if [[ ! -f "${file_path}" ]]; then
    gatelm_fail "${guidance}"
  fi
}

gatelm_load_env() {
  gatelm_require_file \
    "${SELFHOST_ENV_FILE}" \
    ".env file was not found. From deploy/selfhost, run: cp .env.example .env, then edit the required values."

  local line key value
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    line="$(gatelm_trim "${line}")"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" != *=* ]] && continue

    key="$(gatelm_trim "${line%%=*}")"
    value="$(gatelm_trim "${line#*=}")"
    if [[ ! "${key}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      continue
    fi

    value="$(gatelm_unquote_env_value "${value}")"
    export "${key}=${value}"
  done < "${SELFHOST_ENV_FILE}"

  export TENANT_CHAT_RAG_ENABLED="${TENANT_CHAT_RAG_ENABLED:-false}"
  gatelm_configure_compose_files
}

gatelm_configure_compose_files() {
  SELFHOST_COMPOSE_ARGS=(-f "${SELFHOST_COMPOSE_FILE}")
  if [[ "${TENANT_CHAT_RAG_ENABLED:-false}" == "true" ]]; then
    SELFHOST_COMPOSE_ARGS+=(-f "${SELFHOST_RAG_COMPOSE_FILE}")
  fi
}

gatelm_require_env_vars() {
  local missing=()
  local name value
  for name in "$@"; do
    value="${!name-}"
    if [[ -z "${value}" ]]; then
      missing+=("${name}")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    gatelm_fail "Required .env values are missing: ${missing[*]}. Open deploy/selfhost/.env, fill them in, and run the script again."
  fi
}

gatelm_require_default_demo_ids() {
  [[ "${GATELM_DEMO_TENANT_ID-}" == "00000000-0000-4000-8000-000000000100" ]] || \
    gatelm_fail "GATELM_DEMO_TENANT_ID was changed. The current MVP seed supports the default demo UUIDs only."
  [[ "${GATELM_DEMO_PROJECT_ID-}" == "00000000-0000-4000-8000-000000000200" ]] || \
    gatelm_fail "GATELM_DEMO_PROJECT_ID was changed. The current MVP seed supports the default demo UUIDs only."
  [[ "${GATELM_DEMO_APPLICATION_ID-}" == "00000000-0000-4000-8000-000000000300" ]] || \
    gatelm_fail "GATELM_DEMO_APPLICATION_ID was changed. The current MVP seed supports the default demo UUIDs only."
  [[ "${GATELM_DEMO_API_KEY_ID-}" == "00000000-0000-4000-8000-000000000400" ]] || \
    gatelm_fail "GATELM_DEMO_API_KEY_ID was changed. The current MVP seed supports the default demo UUIDs only."
  [[ "${GATELM_DEMO_APP_TOKEN_ID-}" == "00000000-0000-4000-8000-000000000500" ]] || \
    gatelm_fail "GATELM_DEMO_APP_TOKEN_ID was changed. The current MVP seed supports the default demo UUIDs only."
}

gatelm_warn_placeholder_values() {
  local name value
  for name in "$@"; do
    value="${!name-}"
    if [[ "${value}" == *"replace-me"* || "${value}" == *"demo_only"* ]]; then
      gatelm_warn "${name} still looks like a placeholder. Local testing can continue, but replace it before exposing this stack."
    fi
  done
}

gatelm_require_strong_secret_values() {
  local name value compact marker
  for name in "$@"; do
    value="${!name-}"
    compact="$(
      printf '%s' "${value}" \
        | tr '[:upper:]' '[:lower:]' \
        | tr -d '[:space:]_-'
    )"
    if (( ${#value} < 32 )); then
      gatelm_fail "${name} must contain at least 32 characters."
    fi
    for marker in changeme demo devonly example fake local placeholder replaceme redacted test; do
      if [[ "${compact}" == *"${marker}"* ]]; then
        gatelm_fail "${name} must be replaced with a strong non-placeholder value."
      fi
    done
  done
  unset value compact marker
}

gatelm_require_opaque_ids() {
  local name value
  for name in "$@"; do
    value="${!name-}"
    if [[ ! "${value}" =~ ^[A-Za-z0-9_-]{1,128}$ || "${value}" == replace-me* ]]; then
      gatelm_fail "${name} must be a non-placeholder opaque ID."
    fi
  done
}

gatelm_validate_rag_runtime_env() {
  [[ "${TENANT_CHAT_RAG_ENABLED-}" == "true" || "${TENANT_CHAT_RAG_ENABLED-}" == "false" ]] || \
    gatelm_fail "TENANT_CHAT_RAG_ENABLED must be true or false."

  if [[ "${RAG_OBJECT_STORE_DRIVER-}" == "fake" ]]; then
    gatelm_fail "RAG_OBJECT_STORE_DRIVER=fake is not allowed in self-host deployments."
  fi
  local static_key
  for static_key in \
    AWS_ACCESS_KEY_ID \
    AWS_SECRET_ACCESS_KEY \
    AWS_SESSION_TOKEN \
    AWS_PROFILE \
    AWS_SHARED_CREDENTIALS_FILE
  do
    if [[ -n "${!static_key-}" ]]; then
      gatelm_fail "${static_key} is not allowed in self-host deployment configuration; use a workload identity."
    fi
  done

  if [[ "${TENANT_CHAT_RAG_ENABLED}" == "true" ]]; then
    [[ "${RAG_OBJECT_STORE_DRIVER-}" == "s3" ]] || \
      gatelm_fail "RAG_OBJECT_STORE_DRIVER must be s3 when Tenant Chat RAG is enabled."
    local name value
    for name in RAG_S3_REGION RAG_S3_BUCKET RAG_S3_KMS_KEY_ID; do
      value="${!name-}"
      if [[ -z "${value}" || "${value}" == *"replace-me"* ]]; then
        gatelm_fail "${name} must be configured before Tenant Chat RAG is enabled."
      fi
    done
  fi
}

gatelm_validate_selfhost_secret_files() {
  local tenant_dir="${SELFHOST_DIR}/.secrets/tenant-chat"
  local rag_dir="${SELFHOST_DIR}/.secrets/rag"
  local directory name path owner mode
  local expected_owner="${TENANT_CHAT_RUNTIME_UID}:${TENANT_CHAT_RUNTIME_GID}"
  local tenant_files=(
    signing.jwk.json
    jwks.json
    binding-hmac-keys.json
    content-keys.json
    cache-keysets.json
    usage-receipt-token
  )
  local rag_files=(
    content-wrapping-keys.json
    query-signing.jwk.json
    query-binding-hmac-keys.json
    worker-signing.jwk.json
    worker-binding-hmac-keys.json
    workload-jwks.json
    workload-binding-hmac-keys.json
    workload-identities.json
  )

  for directory in "${tenant_dir}" "${rag_dir}"; do
    [[ -d "${directory}" && ! -L "${directory}" ]] || \
      gatelm_fail "Required secret directory is missing or is a symlink: ${directory}"
  done

  for name in "${tenant_files[@]}"; do
    path="${tenant_dir}/${name}"
    [[ -f "${path}" && ! -L "${path}" && -s "${path}" ]] || \
      gatelm_fail "Required Tenant Chat secret file is missing, empty, or unsafe: ${path}"
  done
  for name in "${rag_files[@]}"; do
    path="${rag_dir}/${name}"
    [[ -f "${path}" && ! -L "${path}" && -s "${path}" ]] || \
      gatelm_fail "Required RAG secret file is missing, empty, or unsafe: ${path}"
  done

  # GNU/Linux bind-mounted file secrets retain host ownership and mode. Docker
  # Desktop platforms map these permissions differently, so their containers
  # remain the final readability check.
  if [[ "$(uname -s)" == "Linux" ]]; then
    for directory in "${tenant_dir}" "${rag_dir}"; do
      owner="$(stat -c '%u:%g' "${directory}" 2>/dev/null || true)"
      mode="$(stat -c '%a' "${directory}" 2>/dev/null || true)"
      [[ "${owner}" == "${expected_owner}" ]] || \
        gatelm_fail "Secret directories must be owned by TENANT_CHAT_RUNTIME_UID:GID."
      if [[ ! "${mode}" =~ ^[0-7]{3,4}$ ]] || (( (8#${mode} & 077) != 0 )); then
        gatelm_fail "Secret directory permissions are too open; expected 700."
      fi
    done
    for path in "${tenant_dir}"/* "${rag_dir}"/*; do
      owner="$(stat -c '%u:%g' "${path}" 2>/dev/null || true)"
      mode="$(stat -c '%a' "${path}" 2>/dev/null || true)"
      [[ "${owner}" == "${expected_owner}" ]] || \
        gatelm_fail "Secret files must be owned by TENANT_CHAT_RUNTIME_UID:GID."
      if [[ ! "${mode}" =~ ^[0-7]{3,4}$ ]] || (( (8#${mode} & 077) != 0 )); then
        gatelm_fail "Secret file permissions are too open; expected 600."
      fi
    done
  fi
}

gatelm_need_command() {
  local command_name="$1"
  local install_hint="$2"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    gatelm_fail "${command_name} is not installed or not on PATH. ${install_hint}"
  fi
}

gatelm_check_docker() {
  gatelm_need_command "docker" "Install Docker Engine or Docker Desktop, then open a new terminal."
  if ! docker compose version >/dev/null 2>&1; then
    gatelm_fail "Docker Compose v2 is not available. Install a recent Docker Desktop or Docker Compose plugin."
  fi
  if ! docker info >/dev/null 2>&1; then
    gatelm_fail "Docker is installed, but the Docker daemon is not reachable. Start Docker Desktop or the Docker service, then try again."
  fi
}

gatelm_need_curl() {
  gatelm_need_command "curl" "Install curl, then run the script again."
}

gatelm_compose() {
  docker compose \
    --env-file "${SELFHOST_ENV_FILE}" \
    "${SELFHOST_COMPOSE_ARGS[@]}" \
    "$@"
}

gatelm_validate_compose() {
  if ! gatelm_compose config >/dev/null 2>&1; then
    gatelm_fail "docker-compose.yml or .env is invalid. Check missing quotes, empty required values, and port number settings."
  fi
}

gatelm_wait_for_postgres() {
  gatelm_log "Waiting for PostgreSQL to be ready..."
  local attempt
  for ((attempt = 1; attempt <= 60; attempt++)); do
    if gatelm_compose exec -T postgres pg_isready -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
      gatelm_log "PostgreSQL is ready."
      return 0
    fi
    sleep 2
  done

  gatelm_fail "PostgreSQL did not become ready within 120 seconds. Check: docker compose --env-file .env logs postgres"
}

gatelm_wait_for_redis() {
  gatelm_log "Waiting for Redis to be ready..."
  local attempt
  for ((attempt = 1; attempt <= 60; attempt++)); do
    if gatelm_compose exec -T redis redis-cli ping >/dev/null 2>&1; then
      gatelm_log "Redis is ready."
      return 0
    fi
    sleep 2
  done

  gatelm_fail "Redis did not become ready within 120 seconds. Check: docker compose --env-file .env logs redis"
}

gatelm_wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-60}"

  gatelm_log "Waiting for ${name}..."
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl -fsS --max-time 3 "${url}" >/dev/null 2>&1; then
      gatelm_log "${name} is reachable."
      return 0
    fi
    sleep 2
  done

  gatelm_fail "${name} did not become reachable at ${url}. Check the matching service logs with docker compose --env-file .env logs <service>."
}

gatelm_wait_for_compose_service() {
  local name="$1"
  local service="$2"
  local attempts="${3:-60}"
  local attempt container_id state

  gatelm_log "Waiting for ${name}..."
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    container_id="$(gatelm_compose ps -q "${service}" 2>/dev/null || true)"
    if [[ -n "${container_id}" ]]; then
      state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
      if [[ "${state}" == "healthy" || "${state}" == "running" ]]; then
        gatelm_log "${name} is healthy."
        return 0
      fi
      if [[ "${state}" == "unhealthy" || "${state}" == "exited" || "${state}" == "dead" ]]; then
        gatelm_fail "${name} entered terminal state ${state}. Check: docker compose --env-file .env logs ${service}"
      fi
    fi
    sleep 2
  done

  gatelm_fail "${name} did not become healthy. Check: docker compose --env-file .env logs ${service}"
}
