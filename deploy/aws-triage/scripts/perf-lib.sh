#!/usr/bin/env bash

if [[ -z "${BASH_VERSION:-}" ]]; then
  printf '%s\n' "[GateLM perf] ERROR: bash is required." >&2
  exit 1
fi

PERF_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_TRIAGE_DIR="$(cd "${PERF_SCRIPT_DIR}/.." && pwd)"
# Referenced by scripts that source this library.
# shellcheck disable=SC2034
REPO_ROOT="$(cd "${AWS_TRIAGE_DIR}/../.." && pwd)"
PERF_ENV_FILE="${GATELM_PERF_ENV_FILE:-${AWS_TRIAGE_DIR}/.env.perf}"
PERF_PROJECT_NAME="gatelm-aws-perf"
PERF_POSTGRES_VOLUME="gatelm-aws-perf-postgres-data"
PERF_BASE_COMPOSE_FILE="${AWS_TRIAGE_DIR}/docker-compose.yml"
PERF_OVERRIDE_COMPOSE_FILE="${AWS_TRIAGE_DIR}/docker-compose.perf.yml"

perf_log() {
  printf '%s\n' "[GateLM perf] $*"
}

perf_warn() {
  printf '%s\n' "[GateLM perf] WARNING: $*" >&2
}

perf_fail() {
  printf '%s\n' "[GateLM perf] ERROR: $*" >&2
  exit 1
}

perf_trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s' "${value}"
}

perf_unquote_env_value() {
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
  printf '%s' "${value}"
}

perf_need_command() {
  local command_name="$1"
  local install_hint="$2"
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    perf_fail "${command_name} is not installed or not on PATH. ${install_hint}"
  fi
}

perf_check_docker() {
  perf_need_command "docker" "Install Docker Engine and Docker Compose v2."
  if ! docker compose version >/dev/null 2>&1; then
    perf_fail "Docker Compose v2 is not available."
  fi
  if ! docker info >/dev/null 2>&1; then
    perf_fail "Docker is installed, but the daemon is not reachable."
  fi
}

perf_load_env() {
  [[ -f "${PERF_ENV_FILE}" ]] || \
    perf_fail ".env.perf was not found. Run: bash scripts/perf-init.sh"

  local env_path env_dir prod_env_path line key value
  env_dir="$(cd "$(dirname "${PERF_ENV_FILE}")" && pwd)"
  env_path="${env_dir}/$(basename "${PERF_ENV_FILE}")"
  prod_env_path="${AWS_TRIAGE_DIR}/.env"
  [[ "${env_path}" != "${prod_env_path}" ]] || \
    perf_fail "The normal AWS .env cannot be used for the performance project."

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
  done < "${PERF_ENV_FILE}"
}

perf_require_env_vars() {
  local missing=()
  local name
  for name in "$@"; do
    if [[ -z "${!name-}" ]]; then
      missing+=("${name}")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    perf_fail "Required .env.perf values are missing: ${missing[*]}."
  fi
}

perf_validate_env() {
  perf_require_env_vars \
    POSTGRES_USER \
    POSTGRES_PASSWORD \
    POSTGRES_DB \
    CONTROL_PLANE_AUTH_STATE_SECRET \
    CONTROL_PLANE_INTERNAL_SERVICE_TOKEN \
    GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN \
    GATEWAY_EXACT_CACHE_KEY_SECRET \
    GATELM_DEMO_API_KEY \
    GATELM_DEMO_APP_TOKEN \
    GATELM_DEMO_TENANT_ID \
    GATELM_DEMO_PROJECT_ID \
    GATELM_DEMO_APPLICATION_ID \
    GATELM_DEMO_API_KEY_ID \
    GATELM_DEMO_APP_TOKEN_ID \
    GATELM_DEMO_PROVIDER_MODE \
    AWS_TRIAGE_GATEWAY_BIND \
    AWS_TRIAGE_CONTROL_PLANE_BIND \
    AWS_TRIAGE_GATEWAY_PORT

  local name value
  for name in \
    POSTGRES_PASSWORD \
    CONTROL_PLANE_AUTH_STATE_SECRET \
    CONTROL_PLANE_INTERNAL_SERVICE_TOKEN \
    GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN \
    GATEWAY_EXACT_CACHE_KEY_SECRET \
    GATELM_DEMO_API_KEY \
    GATELM_DEMO_APP_TOKEN; do
    value="${!name}"
    [[ "${value}" != *"replace-me"* ]] || \
      perf_fail "${name} is still a placeholder. Recreate .env.perf with perf-init.sh."
  done

  for name in \
    OPENAI_API_KEY \
    CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP \
    GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP \
    GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY; do
    [[ -z "${!name-}" ]] || \
      perf_fail "${name} must stay empty in the Mock performance environment."
  done

  [[ "${POSTGRES_USER}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || \
    perf_fail "POSTGRES_USER must contain only letters, digits, and underscores."
  [[ "${POSTGRES_DB}" == "gatelm_perf" ]] || \
    perf_fail "POSTGRES_DB must be gatelm_perf."
  [[ "${GATELM_DEMO_PROVIDER_MODE}" == "mock" ]] || \
    perf_fail "GATELM_DEMO_PROVIDER_MODE must be mock."
  [[ "${CONTROL_PLANE_INTERNAL_SERVICE_TOKEN}" == "${GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN}" ]] || \
    perf_fail "Control Plane and Gateway internal tokens must match."
  [[ "${AWS_TRIAGE_GATEWAY_BIND}" == "127.0.0.1" ]] || \
    perf_fail "The performance Gateway must bind to 127.0.0.1."
  [[ "${AWS_TRIAGE_CONTROL_PLANE_BIND}" == "127.0.0.1" ]] || \
    perf_fail "The performance Control Plane must bind to 127.0.0.1."
  [[ "${AWS_TRIAGE_GATEWAY_PORT}" != "8080" ]] || \
    perf_fail "The performance Gateway cannot use the normal stack port 8080."

  [[ "${GATELM_DEMO_TENANT_ID}" == "00000000-0000-4000-8000-000000000100" ]] || \
    perf_fail "The current seed requires the default performance tenant UUID."
  [[ "${GATELM_DEMO_PROJECT_ID}" == "00000000-0000-4000-8000-000000000200" ]] || \
    perf_fail "The current seed requires the default performance project UUID."
  [[ "${GATELM_DEMO_APPLICATION_ID}" == "00000000-0000-4000-8000-000000000300" ]] || \
    perf_fail "The current seed requires the default performance application UUID."
  [[ "${GATELM_DEMO_API_KEY_ID}" == "00000000-0000-4000-8000-000000000400" ]] || \
    perf_fail "The current seed requires the default performance API key UUID."
  [[ "${GATELM_DEMO_APP_TOKEN_ID}" == "00000000-0000-4000-8000-000000000500" ]] || \
    perf_fail "The current seed requires the default performance app token UUID."

  if command -v stat >/dev/null 2>&1; then
    local mode
    mode="$(stat -c '%a' "${PERF_ENV_FILE}" 2>/dev/null || true)"
    if [[ "${mode}" =~ ^[0-7]{3,4}$ ]] && (( (8#${mode} & 077) != 0 )); then
      perf_fail ".env.perf permissions are too open (${mode}). Run: chmod 600 .env.perf"
    fi
  fi
}

perf_compose() {
  docker compose \
    --project-name "${PERF_PROJECT_NAME}" \
    --project-directory "${AWS_TRIAGE_DIR}" \
    --env-file "${PERF_ENV_FILE}" \
    -f "${PERF_BASE_COMPOSE_FILE}" \
    -f "${PERF_OVERRIDE_COMPOSE_FILE}" \
    "$@"
}

perf_validate_compose() {
  if ! perf_compose config --quiet; then
    perf_fail "The performance Compose configuration is invalid."
  fi
}

perf_wait_for_service() {
  local service="$1"
  local attempts="${2:-60}"
  local container_id status attempt
  perf_log "Waiting for ${service}..."
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    container_id="$(perf_compose ps -q "${service}" 2>/dev/null || true)"
    if [[ -n "${container_id}" ]]; then
      status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
      if [[ "${status}" == "healthy" || "${status}" == "running" ]]; then
        perf_log "${service} is ${status}."
        return 0
      fi
      if [[ "${status}" == "unhealthy" || "${status}" == "exited" || "${status}" == "dead" ]]; then
        perf_compose logs --tail=80 "${service}" >&2 || true
        perf_fail "${service} entered state ${status}."
      fi
    fi
    sleep 2
  done
  perf_fail "${service} did not become ready within $((attempts * 2)) seconds."
}

perf_wait_for_http() {
  local name="$1"
  local url="$2"
  local attempts="${3:-60}"
  local attempt
  perf_need_command "curl" "Install curl."
  perf_log "Waiting for ${name}..."
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    if curl -fsS --max-time 3 "${url}" >/dev/null 2>&1; then
      perf_log "${name} is reachable."
      return 0
    fi
    sleep 2
  done
  perf_fail "${name} did not become reachable at ${url}."
}

perf_assert_isolated_postgres() {
  local container_id project_label volume_name
  container_id="$(perf_compose ps -q postgres)"
  [[ -n "${container_id}" ]] || perf_fail "The performance PostgreSQL container is not running."
  project_label="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "${container_id}")"
  volume_name="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql/data"}}{{.Name}}{{end}}{{end}}' "${container_id}")"
  [[ "${project_label}" == "${PERF_PROJECT_NAME}" ]] || \
    perf_fail "Refusing to bootstrap PostgreSQL from Compose project ${project_label}."
  [[ "${volume_name}" == "${PERF_POSTGRES_VOLUME}" ]] || \
    perf_fail "Refusing to bootstrap unexpected PostgreSQL volume ${volume_name}."
  perf_log "Isolated PostgreSQL project and volume verified."
}

perf_assert_no_live_provider_credentials() {
  local service
  for service in control-plane-api gateway-core; do
    # Variables are intentionally expanded inside the target container.
    # shellcheck disable=SC2016
    if ! perf_compose exec -T "${service}" sh -c \
      'test -z "${OPENAI_API_KEY:-}" && test -z "${CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP:-}" && test -z "${GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP:-}" && test -z "${GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY:-}"'; then
      perf_fail "Live Provider credentials are present in ${service}."
    fi
  done
  perf_log "Live Provider credentials are absent from runtime containers."
}
