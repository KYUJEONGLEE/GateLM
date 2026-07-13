#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

deploy_log() {
  printf '%s\n' "[GateLM deploy] $*"
}

deploy_warn() {
  printf '%s\n' "[GateLM deploy] WARNING: $*" >&2
}

deploy_fail() {
  printf '%s\n' "[GateLM deploy] ERROR: $*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || deploy_fail "$1 is required."
}

target_sha="${1:-${GATELM_DEPLOY_SHA:-}}"
[[ "${target_sha}" =~ ^[0-9a-f]{40}$ ]] || \
  deploy_fail "A full 40-character lowercase Git SHA is required."

repo_dir="${GATELM_REPO_DIR:-/home/ubuntu/GateLM}"
deploy_dir="${repo_dir}/deploy/aws-triage"
compose_file="${deploy_dir}/docker-compose.yml"
env_file="${deploy_dir}/.env"
backup_root="${GATELM_DEPLOY_BACKUP_ROOT:-/home/ubuntu/gatelm-deploy-backups}"
log_root="${GATELM_DEPLOY_LOG_ROOT:-/home/ubuntu/gatelm-deploy-logs}"
lock_file="${GATELM_DEPLOY_LOCK_FILE:-/tmp/gatelm-production-deploy.lock}"
public_url="${GATELM_DEPLOY_PUBLIC_URL:-https://gatelm.co.kr}"
chat_url="${GATELM_DEPLOY_CHAT_URL:-https://chat.gatelm.co.kr}"
public_url="${public_url%/}"
chat_url="${chat_url%/}"
minimum_free_kb="${GATELM_DEPLOY_MINIMUM_FREE_KB:-5242880}"

build_services=(
  ai-service
  control-plane-api
  gateway-core
  web
  chat-api
  chat-web
)
runtime_services=(
  ai-service
  control-plane-api
  gateway-core
  web
  chat-api
  chat-web
)
all_services=(
  postgres
  redis
  mock-provider
  ai-service
  control-plane-api
  gateway-core
  web
  chat-api
  chat-web
)

[[ "${public_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || \
  deploy_fail "GATELM_DEPLOY_PUBLIC_URL must be an HTTPS origin."
[[ "${chat_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || \
  deploy_fail "GATELM_DEPLOY_CHAT_URL must be an HTTPS origin."
[[ "${minimum_free_kb}" =~ ^[0-9]+$ ]] || \
  deploy_fail "GATELM_DEPLOY_MINIMUM_FREE_KB must be an integer."

for command_name in awk curl date df docker flock git install sha256sum stat tee; do
  need_command "${command_name}"
done

[[ -d "${repo_dir}/.git" ]] || deploy_fail "Git repository not found: ${repo_dir}"
[[ -f "${compose_file}" ]] || deploy_fail "Compose file not found: ${compose_file}"
[[ -f "${env_file}" ]] || deploy_fail "Deployment environment file not found: ${env_file}"
docker compose version >/dev/null 2>&1 || deploy_fail "Docker Compose v2 is required."
docker info >/dev/null 2>&1 || deploy_fail "Docker daemon is not reachable."

env_mode="$(stat -c '%a' "${env_file}" 2>/dev/null || true)"
if [[ "${env_mode}" =~ ^[0-7]{3,4}$ ]] && (( (8#${env_mode} & 077) != 0 )); then
  deploy_fail "${env_file} permissions are too open (${env_mode}); expected 600."
fi

exec 9>"${lock_file}"
flock -n 9 || deploy_fail "Another production deployment is already running."

mkdir -p "${backup_root}" "${log_root}"
chmod 700 "${backup_root}" "${log_root}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_id="${timestamp}-${target_sha:0:12}"
log_file="${log_root}/${run_id}.log"
exec > >(tee -a "${log_file}") 2>&1

compose() {
  docker compose --env-file "${env_file}" -f "${compose_file}" "$@"
}

wait_for_service() {
  local service="$1"
  local attempts="${2:-60}"
  local delay_seconds="${3:-5}"
  local container_id state attempt

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    container_id="$(compose ps -q "${service}" 2>/dev/null || true)"
    if [[ -n "${container_id}" ]]; then
      state="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${container_id}" 2>/dev/null || true)"
      if [[ "${state}" == "healthy" || "${state}" == "running" ]]; then
        return 0
      fi
      if [[ "${state}" == "unhealthy" || "${state}" == "exited" || "${state}" == "dead" ]]; then
        deploy_warn "${service} entered terminal state: ${state}"
        return 1
      fi
    fi
    sleep "${delay_seconds}"
  done

  deploy_warn "Timed out waiting for ${service}."
  return 1
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local attempts="${3:-30}"
  local delay_seconds="${4:-5}"
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl --connect-timeout 5 --max-time 15 -fsS -o /dev/null "${url}"; then
      return 0
    fi
    sleep "${delay_seconds}"
  done

  deploy_warn "Timed out waiting for ${label}: ${url}"
  return 1
}

wait_for_postgres() {
  local attempts="${1:-30}"
  local delay_seconds="${2:-1}"
  local attempt

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if compose exec -T postgres pg_isready >/dev/null 2>&1; then
      return 0
    fi
    sleep "${delay_seconds}"
  done

  deploy_warn "Timed out waiting for PostgreSQL to accept connections."
  return 1
}

apply_sql_file() {
  local sql_file="$1"
  [[ -f "${sql_file}" ]] || deploy_fail "SQL migration file not found: ${sql_file}"
  # PostgreSQL variables are intentionally expanded inside the container.
  # shellcheck disable=SC2016
  compose exec -T postgres sh -c \
    'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -q' < "${sql_file}"
}

previous_sha=""
backup_dir=""
rollback_manifest=""
deployment_succeeded=false
cutover_started=false

restore_previous_application() {
  local restore_failed=false
  local service image_ref image_id

  if [[ -s "${rollback_manifest}" ]]; then
    deploy_warn "Restoring image tags from the pre-deployment manifest."
    while IFS=$'\t' read -r service image_ref image_id; do
      if ! docker image inspect "${image_id}" >/dev/null 2>&1 || \
        ! docker image tag "${image_id}" "${image_ref}"; then
        deploy_warn "Could not restore ${service} image ${image_id}."
        restore_failed=true
      fi
    done < "${rollback_manifest}"
  fi

  if [[ -n "${previous_sha}" ]]; then
    if ! git -C "${repo_dir}" checkout --detach "${previous_sha}" >/dev/null 2>&1; then
      deploy_warn "Could not restore repository checkout ${previous_sha}."
      restore_failed=true
    fi
  fi

  if [[ "${cutover_started}" == "true" ]]; then
    deploy_warn "Recreating the previous application images after failed health checks."
    if ! compose up -d --force-recreate --remove-orphans "${runtime_services[@]}"; then
      restore_failed=true
    else
      for service in "${all_services[@]}"; do
        if ! wait_for_service "${service}" 36 5; then
          restore_failed=true
        fi
      done
      wait_for_http "restored Control Plane" "http://127.0.0.1:3001/healthz" 24 5 || restore_failed=true
      wait_for_http "restored Gateway" "http://127.0.0.1:8080/readyz" 24 5 || restore_failed=true
      wait_for_http "restored Web Console" "http://127.0.0.1:3000/" 24 5 || restore_failed=true
      wait_for_http "restored Tenant Chat" "http://127.0.0.1:3002/login" 24 5 || restore_failed=true
    fi
  else
    deploy_warn "Cutover had not started; existing containers were left running."
  fi

  if [[ "${restore_failed}" == "true" ]]; then
    deploy_warn "Application rollback was incomplete. Use backup: ${backup_dir:-not-created}"
    return 1
  fi

  deploy_warn "Previous application state restored. Database changes were not reversed."
  return 0
}

on_exit() {
  local exit_code=$?
  trap - EXIT

  if (( exit_code != 0 )) && [[ "${deployment_succeeded}" != "true" ]]; then
    set +e
    deploy_warn "Deployment ${run_id} failed with exit code ${exit_code}."
    restore_previous_application
    deploy_warn "Database backup: ${backup_dir:-not-created}"
    deploy_warn "Deployment log: ${log_file}"
  fi

  exit "${exit_code}"
}
trap on_exit EXIT

deploy_log "Starting deployment ${run_id}."

tracked_changes="$(git -C "${repo_dir}" status --porcelain --untracked-files=no)"
[[ -z "${tracked_changes}" ]] || deploy_fail "Tracked changes exist on the deployment host."

git -C "${repo_dir}" fetch --no-tags origin main
resolved_target="$(git -C "${repo_dir}" rev-parse "${target_sha}^{commit}")"
origin_main="$(git -C "${repo_dir}" rev-parse FETCH_HEAD)"
[[ "${resolved_target}" == "${target_sha}" ]] || deploy_fail "Target SHA could not be resolved exactly."
[[ "${origin_main}" == "${target_sha}" ]] || \
  deploy_fail "Target SHA is stale; origin/main is ${origin_main}."

previous_sha="$(git -C "${repo_dir}" rev-parse HEAD)"
available_kb="$(df -Pk "${repo_dir}" | awk 'NR == 2 {print $4}')"
[[ "${available_kb}" =~ ^[0-9]+$ ]] || deploy_fail "Could not read free disk space."
(( available_kb >= minimum_free_kb )) || \
  deploy_fail "Insufficient disk space: ${available_kb} KiB available, ${minimum_free_kb} KiB required."

compose config --quiet

backup_dir="${backup_root}/${run_id}"
rollback_manifest="${backup_dir}/rollback-images.tsv"
mkdir -p "${backup_dir}"
chmod 700 "${backup_dir}"
printf '%s\n' "${previous_sha}" > "${backup_dir}/previous-sha.txt"
printf '%s\n' "${target_sha}" > "${backup_dir}/target-sha.txt"
install -m 600 "${env_file}" "${backup_dir}/aws-triage.env"

for service in "${runtime_services[@]}"; do
  container_id="$(compose ps -q "${service}")"
  [[ -n "${container_id}" ]] || deploy_fail "Running container not found for ${service}."
  image_ref="$(docker inspect --format '{{.Config.Image}}' "${container_id}")"
  image_id="$(docker inspect --format '{{.Image}}' "${container_id}")"
  [[ -n "${image_ref}" && "${image_id}" =~ ^sha256:[0-9a-f]{64}$ ]] || \
    deploy_fail "Could not capture rollback image for ${service}."
  printf '%s\t%s\t%s\n' "${service}" "${image_ref}" "${image_id}" >> "${rollback_manifest}"
done

deploy_log "Creating PostgreSQL backup."
# PostgreSQL variables are intentionally expanded inside the container.
# shellcheck disable=SC2016
compose exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "${backup_dir}/postgres.dump"
[[ -s "${backup_dir}/postgres.dump" ]] || deploy_fail "PostgreSQL backup is empty."
compose exec -T postgres pg_restore --list < "${backup_dir}/postgres.dump" >/dev/null
sha256sum "${backup_dir}/postgres.dump" > "${backup_dir}/postgres.dump.sha256"

git -C "${repo_dir}" checkout --detach "${target_sha}"
compose config --quiet

export COMPOSE_PARALLEL_LIMIT=1
deploy_log "Building application images sequentially."
for service in "${build_services[@]}"; do
  deploy_log "Building ${service}."
  compose build "${service}"
done

deploy_log "Ensuring infrastructure services are healthy."
compose up -d postgres redis mock-provider
for service in postgres redis mock-provider; do
  wait_for_service "${service}"
done
deploy_log "Waiting for PostgreSQL to accept connections."
wait_for_postgres || deploy_fail "PostgreSQL is not ready for migrations."

deploy_log "Applying Prisma migrations."
compose run --rm --no-deps control-plane-api \
  ./node_modules/.bin/prisma migrate deploy

deploy_log "Applying idempotent Gateway and pricing SQL."
apply_sql_file "${deploy_dir}/migrations/001_gateway_runtime_tables.sql"
apply_sql_file "${repo_dir}/db/migrations/012_create_model_pricing_catalog_compat.sql"
apply_sql_file "${repo_dir}/db/migrations/013_seed_openai_canonical_pricing_aliases.sql"
apply_sql_file "${repo_dir}/db/seeds/002_seed_dashboard_pricing_catalog.sql"
apply_sql_file "${deploy_dir}/migrations/002_drop_legacy_selected_routing_columns.sql"

cutover_started=true
deploy_log "Recreating application services."
compose up -d --force-recreate --remove-orphans "${runtime_services[@]}"

for service in "${all_services[@]}"; do
  wait_for_service "${service}"
done

wait_for_http "Control Plane" "http://127.0.0.1:3001/healthz"
wait_for_http "Gateway health" "http://127.0.0.1:8080/healthz"
wait_for_http "Gateway readiness" "http://127.0.0.1:8080/readyz"
wait_for_http "Web Console" "http://127.0.0.1:3000/"
wait_for_http "Tenant Chat" "http://127.0.0.1:3002/login"
wait_for_http "public Web Console" "${public_url}" || \
  deploy_warn "Public Web Console is not reachable from this host."
wait_for_http "public Tenant Chat" "${chat_url}/login" || \
  deploy_warn "Public Tenant Chat is not reachable from this host."

gateway_auth_status="$(curl --connect-timeout 5 --max-time 15 -sS -o /dev/null -w '%{http_code}' \
  -X POST "http://127.0.0.1:8080/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  --data '{"model":"deployment-check","messages":[{"role":"user","content":"authentication-boundary-check"}]}' || true)"
[[ "${gateway_auth_status}" == "401" ]] || \
  deploy_fail "Unauthenticated Gateway request returned ${gateway_auth_status}, expected 401."

chat_auth_status="$(curl --connect-timeout 5 --max-time 15 -sS -o /dev/null -w '%{http_code}' \
  "http://127.0.0.1:3002/api/tenant-chat/auth/session" || true)"
[[ "${chat_auth_status}" == "401" ]] || \
  deploy_fail "Unauthenticated Tenant Chat session returned ${chat_auth_status}, expected 401."

for service in "${runtime_services[@]}"; do
  container_id="$(compose ps -q "${service}")"
  restart_count="$(docker inspect --format '{{.RestartCount}}' "${container_id}")"
  oom_killed="$(docker inspect --format '{{.State.OOMKilled}}' "${container_id}")"
  [[ "${restart_count}" == "0" ]] || deploy_fail "${service} restarted ${restart_count} times."
  [[ "${oom_killed}" == "false" ]] || deploy_fail "${service} was OOM-killed."
done

cat > "${backup_dir}/deployment-evidence.json" <<EOF
{
  "runId": "${run_id}",
  "previousSha": "${previous_sha}",
  "deployedSha": "${target_sha}",
  "gatewayUnauthenticatedStatus": 401,
  "tenantChatUnauthenticatedStatus": 401,
  "status": "passed"
}
EOF

deployment_succeeded=true
deploy_log "Deployment passed for ${target_sha}."
deploy_log "Backup: ${backup_dir}"
deploy_log "Log: ${log_file}"
