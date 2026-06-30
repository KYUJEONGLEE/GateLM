#!/usr/bin/env bash

if [[ -z "${BASH_VERSION:-}" ]]; then
  printf '%s\n' "[GateLM self-host] ERROR: bash is required. Run this script with bash." >&2
  exit 1
fi

SELFHOST_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELFHOST_DIR="$(cd "${SELFHOST_SCRIPT_DIR}/.." && pwd)"
SELFHOST_ENV_FILE="${SELFHOST_ENV_FILE:-${SELFHOST_DIR}/.env}"
SELFHOST_COMPOSE_FILE="${SELFHOST_COMPOSE_FILE:-${SELFHOST_DIR}/docker-compose.yml}"

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
  docker compose --env-file "${SELFHOST_ENV_FILE}" -f "${SELFHOST_COMPOSE_FILE}" "$@"
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
