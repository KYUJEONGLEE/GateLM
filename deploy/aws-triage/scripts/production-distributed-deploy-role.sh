#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

deploy_log() {
  printf '%s\n' "[GateLM distributed deploy] $*"
}

deploy_warn() {
  printf '%s\n' "[GateLM distributed deploy] WARNING: $*" >&2
}

deploy_fail() {
  printf '%s\n' "[GateLM distributed deploy] ERROR: $*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || deploy_fail "$1 is required."
}

role=""
target_sha=""
gateway_upstream_host="10.78.2.20"
mode="deploy"
while (( $# > 0 )); do
  case "$1" in
    --role)
      [[ $# -ge 2 ]] || deploy_fail "--role requires edge, gateway, data, ai, or pii."
      role="$2"
      shift 2
      ;;
    --sha)
      [[ $# -ge 2 ]] || deploy_fail "--sha requires a full Git SHA."
      target_sha="$2"
      shift 2
      ;;
    --gateway-upstream-host)
      [[ $# -ge 2 ]] || deploy_fail "--gateway-upstream-host requires 10.78.2.20 or 10.78.2.10."
      gateway_upstream_host="$2"
      shift 2
      ;;
    --rollback)
      mode="rollback"
      shift
      ;;
    --check)
      mode="check"
      shift
      ;;
    *) deploy_fail "Unknown option: $1" ;;
  esac
done

case "${role}" in edge|gateway|data|ai|pii) ;; *) deploy_fail "A valid --role is required." ;; esac
[[ "${target_sha}" =~ ^[0-9a-f]{40}$ ]] || deploy_fail "A full lowercase Git SHA is required."
[[ "${gateway_upstream_host}" == "10.78.2.20" || "${gateway_upstream_host}" == "10.78.2.10" ]] || \
  deploy_fail "Gateway upstream host must be the primary Gateway or the internal NLB."

repo_dir="${GATELM_PRODUCTION_DISTRIBUTED_REPO_DIR:-/home/ubuntu/GateLM}"
orchestration_dir="${GATELM_PRODUCTION_DISTRIBUTED_ORCHESTRATION_DIR:-/home/ubuntu/gatelm-production-orchestration}"
env_file="${orchestration_dir}/.env.production-distributed"
state_root="${orchestration_dir}/.production-distributed-state/deployments"
gateway_upstream_state_key="${gateway_upstream_host//./-}"
state_dir="${state_root}/${target_sha}-${role}-upstream-${gateway_upstream_state_key}"
lock_file="/tmp/gatelm-production-distributed-${role}.lock"
cutover_started=false
deployment_succeeded=false

for command_name in awk bash chmod chown cp curl date df docker find flock git install mkdir mktemp mv rm sha256sum stat tar timeout tr; do
  need_command "${command_name}"
done
if [[ "${role}" == "gateway" || "${role}" == "ai" ]]; then
  need_command aws
fi
docker compose version >/dev/null 2>&1 || deploy_fail "Docker Compose v2 is required."
docker info >/dev/null 2>&1 || deploy_fail "Docker daemon is not reachable."

[[ -d "${repo_dir}/.git" ]] || deploy_fail "Git repository not found: ${repo_dir}"
[[ -d "${orchestration_dir}" && ! -L "${orchestration_dir}" ]] || \
  deploy_fail "Orchestration directory is missing or unsafe: ${orchestration_dir}"
[[ -f "${env_file}" && ! -L "${env_file}" ]] || deploy_fail "Production overlay is missing or unsafe."
[[ -f /etc/gatelm-production-role ]] || deploy_fail "Host role marker is missing."
observed_role="$(tr -d '[:space:]' < /etc/gatelm-production-role)"
[[ "${observed_role}" == "${role}" ]] || deploy_fail "Host role ${observed_role:-empty} does not match ${role}."

exec 9>"${lock_file}"
flock -n 9 || deploy_fail "Another ${role} deployment is already running."

mkdir -p "${state_root}"
chmod 700 "${state_root}"

run_git() {
  git -c safe.directory="${repo_dir}" -C "${repo_dir}" "$@"
}

set_env_value() {
  local key="$1" value="$2" temp found
  temp="$(mktemp "${env_file}.XXXXXX")"
  found="$(awk -F= -v key="${key}" '$1 == key {count += 1} END {print count + 0}' "${env_file}")"
  [[ "${found}" == "1" ]] || {
    rm -f "${temp}"
    deploy_fail "Expected exactly one ${key} entry in the production overlay."
  }
  awk -F= -v key="${key}" -v value="${value}" \
    '$1 == key {print key "=" value; next} {print}' "${env_file}" > "${temp}"
  chown --reference="${env_file}" "${temp}"
  chmod --reference="${env_file}" "${temp}"
  mv "${temp}" "${env_file}"
}

upsert_env_value() {
  local key="$1" value="$2" temp found
  temp="$(mktemp "${env_file}.XXXXXX")"
  found="$(awk -F= -v key="${key}" '$1 == key {count += 1} END {print count + 0}' "${env_file}")"
  [[ "${found}" == "0" || "${found}" == "1" ]] || {
    rm -f "${temp}"
    deploy_fail "Expected at most one ${key} entry in the production overlay."
  }
  awk -F= -v key="${key}" -v value="${value}" \
    'BEGIN {updated = 0} $1 == key {print key "=" value; updated = 1; next} {print} END {if (!updated) print key "=" value}' \
    "${env_file}" > "${temp}"
  chown --reference="${env_file}" "${temp}"
  chmod --reference="${env_file}" "${temp}"
  mv "${temp}" "${env_file}"
}

artifact_paths=(
  docker-compose.production.distributed.yml
  docker-compose.production.pii.yml
  Caddyfile.production-distributed.production
  Caddyfile.production-distributed.rehearsal
  scripts/perf-lib.sh
  scripts/prepare-gateway-e5-runtime-bundle.sh
  scripts/prepare-production-pii-model.sh
  pii-v36-model-manifest.sha256
  scripts/production-distributed-lib.sh
  scripts/production-distributed-preflight.sh
  scripts/production-distributed-up.sh
  scripts/production-distributed-smoke.sh
  scripts/production-distributed-deploy-role.sh
)

backup_artifacts() {
  local existing=() path
  for path in "${artifact_paths[@]}"; do
    [[ -f "${orchestration_dir}/${path}" ]] && existing+=("${path}")
  done
  (( ${#existing[@]} > 0 )) || deploy_fail "No orchestration artifacts are available to back up."
  tar -czf "${state_dir}/artifacts-before.tar.gz" -C "${orchestration_dir}" "${existing[@]}"
}

sync_artifacts() {
  local path source destination mode
  for path in "${artifact_paths[@]}"; do
    source="${repo_dir}/deploy/aws-triage/${path}"
    destination="${orchestration_dir}/${path}"
    [[ -f "${source}" && ! -L "${source}" ]] || deploy_fail "Target artifact is missing: ${source}"
    mode=0644
    [[ "${path}" == scripts/* ]] && mode=0755
    install -D -m "${mode}" "${source}" "${destination}"
  done
}

run_preflight() {
  local args=(--role "${role}")
  if [[ "${role}" == "gateway" ]]; then
    args+=(--check-dependencies)
  fi
  bash "${orchestration_dir}/scripts/production-distributed-preflight.sh" "${args[@]}"
}

restore_state() {
  local previous_sha
  [[ -f "${state_dir}/previous-sha" ]] || deploy_fail "Previous SHA evidence is missing."
  [[ -f "${state_dir}/env.before" ]] || deploy_fail "Previous environment overlay is missing."
  [[ -f "${state_dir}/artifacts-before.tar.gz" ]] || deploy_fail "Previous artifact backup is missing."
  previous_sha="$(tr -d '[:space:]' < "${state_dir}/previous-sha")"
  [[ "${previous_sha}" =~ ^[0-9a-f]{40}$ ]] || deploy_fail "Previous SHA evidence is malformed."

  cp -p "${state_dir}/env.before" "${env_file}"
  tar -xzf "${state_dir}/artifacts-before.tar.gz" -C "${orchestration_dir}"
  run_git checkout --detach "${previous_sha}" >/dev/null
  deploy_log "Restored ${role} repository and overlay to ${previous_sha}."
}

verify_role_containers() {
  local scripts_dir="${orchestration_dir}/scripts"
  local service container_id restart_count oom_killed
  # shellcheck source=/dev/null
  source "${scripts_dir}/production-distributed-lib.sh"
  production_load_env
  read -r -a services <<< "$(production_role_services "${role}")"
  for service in "${services[@]}"; do
    container_id="$(production_compose "${role}" ps -q "${service}")"
    [[ -n "${container_id}" ]] || deploy_fail "${service} has no running container."
    restart_count="$(docker inspect --format '{{.RestartCount}}' "${container_id}")"
    oom_killed="$(docker inspect --format '{{.State.OOMKilled}}' "${container_id}")"
    [[ "${restart_count}" == "0" ]] || deploy_fail "${service} restarted ${restart_count} times."
    [[ "${oom_killed}" == "false" ]] || deploy_fail "${service} was OOM-killed."
  done
}

rollback_role() {
  restore_state
  bash "${orchestration_dir}/scripts/production-distributed-up.sh" --role "${role}"
  verify_role_containers
  printf '%s\n' "rolled-back" > "${state_dir}/status"
  deploy_log "Rollback completed for ${role}. Database migrations, if any, were not reversed."
}

if [[ "${mode}" == "rollback" ]]; then
  [[ -d "${state_dir}" && ! -L "${state_dir}" ]] || deploy_fail "Deployment state is missing: ${state_dir}"
  rollback_role
  exit 0
fi

if [[ "${mode}" == "check" ]]; then
  [[ "$(run_git rev-parse HEAD)" == "${target_sha}" ]] || \
    deploy_fail "Current repository SHA does not match ${target_sha}."
  grep -Fqx "GATELM_PRODUCTION_DISTRIBUTED_SOURCE_SHA=${target_sha}" "${env_file}" || \
    deploy_fail "Current production overlay does not match ${target_sha}."
  run_preflight
  verify_role_containers
  deploy_log "Read-only role check passed for ${role} at ${target_sha}."
  exit 0
fi

on_exit() {
  local exit_code=$?
  trap - EXIT
  if (( exit_code != 0 )) && [[ "${deployment_succeeded}" != "true" && -d "${state_dir}" ]]; then
    set +e
    deploy_warn "Deployment failed for ${role}; restoring the previous application state."
    restore_state
    if [[ "${cutover_started}" == "true" ]]; then
      bash "${orchestration_dir}/scripts/production-distributed-up.sh" --role "${role}"
    fi
    printf '%s\n' "failed-restored" > "${state_dir}/status"
  fi
  exit "${exit_code}"
}
trap on_exit EXIT

if [[ -d "${state_dir}" && ! -L "${state_dir}" ]]; then
  previous_status="$(tr -d '[:space:]' < "${state_dir}/status" 2>/dev/null || true)"
  case "${previous_status}" in
    deployed)
      [[ "$(run_git rev-parse HEAD)" == "${target_sha}" ]] || \
        deploy_fail "A deployed state exists but the repository is not at ${target_sha}."
      grep -Fqx "GATELM_PRODUCTION_DISTRIBUTED_SOURCE_SHA=${target_sha}" "${env_file}" || \
        deploy_fail "A deployed state exists but the production overlay does not match ${target_sha}."
      verify_role_containers
      deployment_succeeded=true
      deploy_log "Role ${role} is already healthy at ${target_sha}; deployment is idempotent."
      exit 0
      ;;
    rolled-back|failed-restored)
      archived_state="${state_dir}.retry.$(date -u +%Y%m%dT%H%M%SZ)"
      [[ ! -e "${archived_state}" ]] || deploy_fail "Retry archive already exists: ${archived_state}"
      mv "${state_dir}" "${archived_state}"
      deploy_log "Archived previous ${previous_status} state before retrying ${role}."
      ;;
    *) deploy_fail "Deployment state already exists with an unsafe status: ${previous_status:-missing}" ;;
  esac
elif [[ -e "${state_dir}" ]]; then
  deploy_fail "Deployment state path is not a safe directory: ${state_dir}"
fi
mkdir "${state_dir}"
chmod 700 "${state_dir}"

tracked_changes="$(run_git status --porcelain --untracked-files=no)"
[[ -z "${tracked_changes}" ]] || deploy_fail "Tracked changes exist on the ${role} deployment host."

deploy_log "Fetching approved main SHA ${target_sha} for ${role}."
run_git fetch --no-tags origin main
resolved_target="$(run_git rev-parse "${target_sha}^{commit}")"
origin_main="$(run_git rev-parse FETCH_HEAD)"
[[ "${resolved_target}" == "${target_sha}" ]] || deploy_fail "Target SHA could not be resolved exactly."
[[ "${origin_main}" == "${target_sha}" ]] || deploy_fail "Target SHA is stale; origin/main is ${origin_main}."

previous_sha="$(run_git rev-parse HEAD)"
printf '%s\n' "${previous_sha}" > "${state_dir}/previous-sha"
cp -p "${env_file}" "${state_dir}/env.before"
backup_artifacts

available_kb="$(df -Pk "${repo_dir}" | awk 'NR == 2 {print $4}')"
[[ "${available_kb}" =~ ^[0-9]+$ ]] || deploy_fail "Could not read free disk space."
(( available_kb >= 5242880 )) || deploy_fail "At least 5 GiB of free disk is required."

run_git checkout --detach "${target_sha}" >/dev/null
sync_artifacts
set_env_value GATELM_PRODUCTION_DISTRIBUTED_SOURCE_SHA "${target_sha}"
set_env_value GATELM_PRODUCTION_DISTRIBUTED_IMAGE_TAG "${target_sha:0:12}"
upsert_env_value GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_UPSTREAM_HOST "${gateway_upstream_host}"

if [[ "${role}" == "gateway" || "${role}" == "ai" ]]; then
  # shellcheck source=/dev/null
  source "${orchestration_dir}/scripts/production-distributed-lib.sh"
  production_load_env
  routing_difficulty_token="$(aws ssm get-parameter \
    --name "${GATELM_ROUTING_DIFFICULTY_SERVICE_TOKEN_PARAMETER_NAME}" \
    --with-decryption \
    --query Parameter.Value \
    --output text)"
  [[ "${routing_difficulty_token}" =~ ^[a-f0-9]{64}$ ]] || \
    deploy_fail "Routing difficulty service token SecureString is missing or malformed."
  upsert_env_value GATEWAY_DIFFICULTY_REMOTE_SERVICE_TOKEN "${routing_difficulty_token}"
  unset routing_difficulty_token
fi

if [[ "${role}" == "gateway" ]]; then
  # shellcheck source=/dev/null
  source "${orchestration_dir}/scripts/production-distributed-lib.sh"
  production_load_env
  if [[ "${GATEWAY_CLICKHOUSE_ANALYTICS_ENABLED:-false}" == "true" ]]; then
    clickhouse_password="$(aws ssm get-parameter \
      --name "${GATELM_CLICKHOUSE_PASSWORD_PARAMETER_NAME:-/gatelm/production/clickhouse/password}" \
      --with-decryption \
      --query Parameter.Value \
      --output text)"
    [[ ${#clickhouse_password} -ge 16 ]] || \
      deploy_fail "ClickHouse password SecureString is missing or too short."
    clickhouse_identity_hmac_secret="$(aws ssm get-parameter \
      --name "${GATELM_CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET_PARAMETER_NAME:-/gatelm/production/clickhouse/employee-identity-hmac-secret}" \
      --with-decryption \
      --query Parameter.Value \
      --output text)"
    [[ ${#clickhouse_identity_hmac_secret} -ge 32 ]] || \
      deploy_fail "ClickHouse employee identity HMAC SecureString is missing or too short."
    upsert_env_value GATEWAY_CLICKHOUSE_PASSWORD "${clickhouse_password}"
    upsert_env_value GATEWAY_CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET "${clickhouse_identity_hmac_secret}"
    unset clickhouse_password clickhouse_identity_hmac_secret
  fi
  if [[ "${GATEWAY_CLICKHOUSE_ANALYTICS_PERFORMANCE_READ_ENABLED:-false}" == "true" ]]; then
    clickhouse_reader_password="$(aws ssm get-parameter \
      --name "${GATELM_CLICKHOUSE_READER_PASSWORD_PARAMETER_NAME:-/gatelm/production/clickhouse/reader-password}" \
      --with-decryption \
      --query Parameter.Value \
      --output text)"
    [[ ${#clickhouse_reader_password} -ge 16 ]] || \
      deploy_fail "ClickHouse reader password SecureString is missing or too short."
    upsert_env_value GATEWAY_CLICKHOUSE_ANALYTICS_READ_PASSWORD "${clickhouse_reader_password}"
    unset clickhouse_reader_password
  fi
fi

if [[ "${role}" == "data" ]]; then
  # shellcheck source=/dev/null
  source "${orchestration_dir}/scripts/production-distributed-lib.sh"
  production_load_env
  if [[ "${CLICKHOUSE_ANALYTICS_READ_ENABLED:-false}" == "true" ]]; then
    clickhouse_password="$(aws ssm get-parameter \
      --name "${GATELM_CLICKHOUSE_READER_PASSWORD_PARAMETER_NAME:-/gatelm/production/clickhouse/reader-password}" \
      --with-decryption \
      --query Parameter.Value \
      --output text)"
    [[ ${#clickhouse_password} -ge 16 ]] || \
      deploy_fail "ClickHouse password SecureString is missing or too short."
    clickhouse_identity_hmac_secret="$(aws ssm get-parameter \
      --name "${GATELM_CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET_PARAMETER_NAME:-/gatelm/production/clickhouse/employee-identity-hmac-secret}" \
      --with-decryption \
      --query Parameter.Value \
      --output text)"
    [[ ${#clickhouse_identity_hmac_secret} -ge 32 ]] || \
      deploy_fail "ClickHouse employee identity HMAC SecureString is missing or too short."
    upsert_env_value CLICKHOUSE_PASSWORD "${clickhouse_password}"
    upsert_env_value CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET "${clickhouse_identity_hmac_secret}"
    unset clickhouse_password clickhouse_identity_hmac_secret
  fi
fi

if [[ "${role}" == "ai" ]]; then
  deploy_log "Preparing the pinned AI Service E5 runtime bundle."
  bash "${repo_dir}/deploy/aws-triage/scripts/prepare-gateway-e5-runtime-bundle.sh" "${repo_dir}"
  routing_model_dir="${repo_dir}/.tmp/gateway-e5-runtime-bundle/multilingual-e5-small/614241f622f53c4eeff9890bdc4f31cfecc418b3"
  [[ -d "${routing_model_dir}" && ! -L "${routing_model_dir}" ]] || \
    deploy_fail "Prepared AI Service E5 model directory is missing or unsafe."
  find "${routing_model_dir}" -type d -exec chmod 0755 {} +
  find "${routing_model_dir}" -type f -exec chmod 0644 {} +
fi
if [[ "${role}" == "pii" ]]; then
  deploy_log "Preparing the pinned PII model bundle."
  bash "${orchestration_dir}/scripts/prepare-production-pii-model.sh"
fi

run_preflight
# shellcheck source=/dev/null
source "${orchestration_dir}/scripts/production-distributed-lib.sh"
production_load_env
read -r -a build_services <<< "$(production_role_build_services "${role}")"
export COMPOSE_PARALLEL_LIMIT=1
for service in "${build_services[@]}"; do
  deploy_log "Building ${service} for ${target_sha}."
  production_compose "${role}" build "${service}"
done

if [[ "${role}" == "data" ]]; then
  deploy_log "Creating the pre-migration PostgreSQL backup."
  # PostgreSQL variables intentionally expand inside the container.
  # shellcheck disable=SC2016
  production_compose data exec -T postgres sh -c \
    'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${state_dir}/postgres-before.dump"
  [[ -s "${state_dir}/postgres-before.dump" ]] || deploy_fail "PostgreSQL backup is empty."
  chmod 600 "${state_dir}/postgres-before.dump"
  production_compose data exec -T postgres pg_restore --list < "${state_dir}/postgres-before.dump" >/dev/null

  deploy_log "Applying Prisma migrations."
  production_compose data run --rm --no-deps control-plane-api \
    ./node_modules/.bin/prisma migrate deploy

  apply_sql_file() {
    local sql_file="$1"
    [[ -f "${sql_file}" ]] || deploy_fail "SQL migration file not found: ${sql_file}"
    # PostgreSQL variables intentionally expand inside the container.
    # shellcheck disable=SC2016
    production_compose data exec -T postgres sh -c \
      'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < "${sql_file}"
  }

  deploy_log "Applying idempotent Gateway and dashboard SQL."
  apply_sql_file "${repo_dir}/deploy/aws-triage/migrations/001_gateway_runtime_tables.sql"
  apply_sql_file "${repo_dir}/db/migrations/012_create_model_pricing_catalog_compat.sql"
  apply_sql_file "${repo_dir}/db/migrations/013_seed_openai_canonical_pricing_aliases.sql"
  apply_sql_file "${repo_dir}/db/seeds/002_seed_dashboard_pricing_catalog.sql"
  apply_sql_file "${repo_dir}/deploy/aws-triage/migrations/002_drop_legacy_selected_routing_columns.sql"
  apply_sql_file "${repo_dir}/deploy/aws-triage/migrations/003_add_p0_invocation_log_ttft.sql"
  apply_sql_file "${repo_dir}/deploy/aws-triage/migrations/004_add_p0_dashboard_rollup_indexes.sql"
  apply_sql_file "${repo_dir}/deploy/aws-triage/migrations/005_prepare_p0_monthly_partitioning.sql"
fi

cutover_started=true
bash "${orchestration_dir}/scripts/production-distributed-up.sh" --role "${role}"
verify_role_containers
printf '%s\n' "deployed" > "${state_dir}/status"
deployment_succeeded=true
deploy_log "Role ${role} deployed and verified at ${target_sha}."
