#!/usr/bin/env bash

set -euo pipefail

maintenance_log() {
  printf '%s\n' "[GateLM cache-keyset maintenance] $*"
}

maintenance_fail() {
  printf '%s\n' "[GateLM cache-keyset maintenance] ERROR: $*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || maintenance_fail "$1 is required."
}

instance_id="${1:-}"
target_sha="${2:-}"
action="${3:-check}"
backup_id="${4:-}"
canonical_id="${GATELM_CACHE_KEYSET_CANONICAL_ID:-tenant_chat_cache_keys_v1}"
source_id="${GATELM_CACHE_KEYSET_SOURCE_ID:-tenant-chat-local-cache-1}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
poll_interval_seconds="${GATELM_SSM_POLL_INTERVAL_SECONDS:-10}"
max_polls="${GATELM_SSM_MAX_POLLS:-120}"

[[ "${instance_id}" =~ ^i-[0-9a-f]{8,17}$ ]] || maintenance_fail "Invalid EC2 instance id."
[[ "${target_sha}" =~ ^[0-9a-f]{40}$ ]] || maintenance_fail "Invalid maintenance SHA."
[[ "${action}" =~ ^(check|apply|rollback)$ ]] || maintenance_fail "Action must be check, apply, or rollback."
[[ "${canonical_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]] || maintenance_fail "Invalid canonical cache key-set ID."
[[ "${source_id}" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$ ]] || maintenance_fail "Invalid source cache key-set ID."
[[ "${canonical_id}" != "${source_id}" ]] || maintenance_fail "Canonical and source cache key-set IDs must differ."
if [[ "${action}" == "rollback" ]]; then
  [[ "${backup_id}" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || maintenance_fail "Rollback requires a valid backup id."
else
  [[ -z "${backup_id}" ]] || maintenance_fail "backup_id is only accepted for rollback."
fi
[[ -n "${aws_region}" ]] || maintenance_fail "AWS_REGION is required."
[[ "${poll_interval_seconds}" =~ ^[0-9]+$ ]] || maintenance_fail "Invalid poll interval."
[[ "${max_polls}" =~ ^[1-9][0-9]*$ ]] || maintenance_fail "Invalid poll count."

for command_name in aws base64 jq tr; do
  need_command "${command_name}"
done

ping_status="$(aws ssm describe-instance-information \
  --region "${aws_region}" \
  --filters "Key=InstanceIds,Values=${instance_id}" \
  --query 'InstanceInformationList[0].PingStatus' \
  --output text)"
[[ "${ping_status}" == "Online" ]] || \
  maintenance_fail "Instance ${instance_id} is not online in Systems Manager (status: ${ping_status})."

printf -v target_sha_q '%q' "${target_sha}"
printf -v action_q '%q' "${action}"
printf -v backup_id_q '%q' "${backup_id}"
printf -v canonical_id_q '%q' "${canonical_id}"
printf -v source_id_q '%q' "${source_id}"

remote_template="$(cat <<'REMOTE'
set -Eeuo pipefail
umask 077

maintenance_log() {
  printf '%s\n' "[GateLM cache-keyset maintenance] $*"
}

maintenance_fail() {
  printf '%s\n' "[GateLM cache-keyset maintenance] ERROR: $*" >&2
  exit 1
}

repo=/home/ubuntu/GateLM
deploy_dir="${repo}/deploy/aws-triage"
env_file="${deploy_dir}/.env"
keysets_file="${deploy_dir}/.secrets/tenant-chat/cache-keysets.json"
compose_file="${deploy_dir}/docker-compose.yml"
backup_root=/home/ubuntu/gatelm-maintenance-backups/tenant-chat-cache-keyset
lock_file=/tmp/gatelm-production-deploy.lock
temporary_dir="$(mktemp -d /tmp/gatelm-cache-keyset-maintenance.XXXXXX)"
active_ids_file="${temporary_dir}/active-key-set-ids.txt"
tool_path="${temporary_dir}/deploy/aws-triage/scripts/reconcile-tenant-chat-cache-keyset.mjs"
apply_backup_id=""
apply_completed=false

cleanup() {
  rm -rf "${temporary_dir}"
}

compose() {
  sudo -u ubuntu env \
    TENANT_CHAT_RUNTIME_UID="${runtime_uid}" \
    TENANT_CHAT_RUNTIME_GID="${runtime_gid}" \
    docker compose --env-file "${env_file}" -f "${compose_file}" "$@"
}

wait_for_http() {
  local label="$1"
  local url="$2"
  local attempt
  for attempt in $(seq 1 36); do
    if curl --connect-timeout 5 --max-time 15 -fsS -o /dev/null "${url}"; then
      return 0
    fi
    sleep 5
  done
  maintenance_fail "Timed out waiting for ${label}."
}

restart_runtime() {
  compose config --quiet
  compose up -d --no-deps --force-recreate control-plane-api
  wait_for_http "Control Plane" "http://127.0.0.1:3001/healthz"
  compose up -d --no-deps --force-recreate gateway-core
  wait_for_http "Gateway health" "http://127.0.0.1:8080/healthz"
  wait_for_http "Gateway readiness" "http://127.0.0.1:8080/readyz"
}

rollback_failed_apply() {
  local exit_code=$?
  trap - ERR
  if [[ "${action}" == "apply" && "${apply_completed}" == "true" && -n "${apply_backup_id}" ]]; then
    maintenance_log "Apply failed after file reconciliation; applying compatibility rollback from backup ${apply_backup_id}."
    sudo -u ubuntu node "${tool_path}" \
      --mode=rollback \
      --env-file="${env_file}" \
      --keysets-file="${keysets_file}" \
      --backup-root="${backup_root}" \
      --canonical-id="${canonical_id}" \
      --source-id="${source_id}" \
      --backup-id="${apply_backup_id}" || true
    restart_runtime || true
  fi
  exit "${exit_code}"
}

trap cleanup EXIT
trap rollback_failed_apply ERR

for command_name in curl docker flock git node seq stat sudo tar; do
  command -v "${command_name}" >/dev/null 2>&1 || maintenance_fail "${command_name} is required on the target host."
done
[[ -d "${repo}/.git" ]] || maintenance_fail "GateLM repository is unavailable."
[[ -f "${env_file}" && ! -L "${env_file}" ]] || maintenance_fail "AWS environment file is unavailable or unsafe."
[[ -f "${keysets_file}" && ! -L "${keysets_file}" ]] || maintenance_fail "Tenant Chat cache key-set file is unavailable or unsafe."

exec 9>"${lock_file}"
flock -n 9 || maintenance_fail "Another production deployment or maintenance operation is running."

sudo -u ubuntu git -C "${repo}" fetch --no-tags origin main
actual_sha="$(sudo -u ubuntu git -C "${repo}" rev-parse FETCH_HEAD)"
[[ "${actual_sha}" == "${target_sha}" ]] || maintenance_fail "origin/main moved to ${actual_sha}."
sudo -u ubuntu git -C "${repo}" archive "${target_sha}" \
  scripts/dev/tenant-chat-cache-keyset.mjs \
  deploy/aws-triage/scripts/reconcile-tenant-chat-cache-keyset.mjs | tar -x -C "${temporary_dir}"
chown -R ubuntu:ubuntu "${temporary_dir}"

runtime_uid="$(stat -c '%u' "${keysets_file}")"
runtime_gid="$(stat -c '%g' "${keysets_file}")"
[[ "${runtime_uid}" =~ ^[0-9]+$ && "${runtime_gid}" =~ ^[0-9]+$ ]] || maintenance_fail "Could not resolve Tenant Chat runtime ownership."

compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1' > "${active_ids_file}" <<'SQL'
SELECT DISTINCT snapshot.snapshot_body #>> '{policies,cache,keySetId}'
FROM tenant_chat_active_runtime_snapshots AS active
JOIN tenant_chat_runtime_snapshots AS snapshot
  ON snapshot.snapshot_id = active.snapshot_id
 AND snapshot.tenant_id = active.tenant_id
WHERE snapshot.snapshot_body #>> '{policies,cache,enabled}' = 'true'
  AND snapshot.snapshot_body #>> '{policies,cache,keySetId}' IS NOT NULL
ORDER BY 1;
SQL
chown ubuntu:ubuntu "${active_ids_file}"

common_arguments=(
  --env-file="${env_file}"
  --keysets-file="${keysets_file}"
  --backup-root="${backup_root}"
  --canonical-id="${canonical_id}"
  --source-id="${source_id}"
  --active-key-set-ids-file="${active_ids_file}"
)

if [[ "${action}" == "rollback" ]]; then
  result="$(sudo -u ubuntu node "${tool_path}" "${common_arguments[@]}" --mode=rollback --backup-id="${backup_id}")"
  maintenance_log "result=${result}"
  restart_runtime
  maintenance_log "Rollback ${backup_id} completed."
  exit 0
fi

result="$(sudo -u ubuntu node "${tool_path}" "${common_arguments[@]}" --mode="${action}")"
maintenance_log "result=${result}"
if [[ "${action}" == "check" ]]; then
  maintenance_log "Read-only cache key-set check completed."
  exit 0
fi

apply_completed=true
apply_backup_id="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(value.backupId ?? "")' "${result}")"
changed="$(node -e 'const value=JSON.parse(process.argv[1]);process.stdout.write(String(value.changed === true))' "${result}")"
if [[ "${changed}" == "true" ]]; then
  [[ "${apply_backup_id}" =~ ^[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}$ ]] || maintenance_fail "Apply did not return a safe backup id."
  restart_runtime
else
  maintenance_log "Configuration was already aligned; runtime restart skipped."
fi
maintenance_log "Apply completed. Backup id: ${apply_backup_id:-none}"
REMOTE
)"

remote_script="$({
  printf 'target_sha=%s\n' "${target_sha_q}"
  printf 'action=%s\n' "${action_q}"
  printf 'backup_id=%s\n' "${backup_id_q}"
  printf 'canonical_id=%s\n' "${canonical_id_q}"
  printf 'source_id=%s\n' "${source_id_q}"
  printf '%s\n' "${remote_template}"
})"
remote_script_base64="$(printf '%s' "${remote_script}" | base64 | tr -d '\n')"
remote_command="printf '%s' '${remote_script_base64}' | base64 --decode | bash"
parameters_json="$(jq -cn --arg command "${remote_command}" '{commands: [$command], executionTimeout: ["1800"]}')"

maintenance_log "Sending ${action} command for ${target_sha} to ${instance_id}."
command_id="$(aws ssm send-command \
  --region "${aws_region}" \
  --instance-ids "${instance_id}" \
  --document-name AWS-RunShellScript \
  --comment "GateLM Tenant Chat cache key-set ${action} ${target_sha}" \
  --parameters "${parameters_json}" \
  --timeout-seconds 300 \
  --query 'Command.CommandId' \
  --output text)"
[[ -n "${command_id}" && "${command_id}" != "None" ]] || maintenance_fail "SSM did not return a command id."
maintenance_log "SSM command id: ${command_id}"

cancel_on_signal() {
  aws ssm cancel-command --region "${aws_region}" --command-id "${command_id}" >/dev/null 2>&1 || true
  exit 130
}
trap cancel_on_signal INT TERM

status="Pending"
for ((poll = 1; poll <= max_polls; poll += 1)); do
  status="$(aws ssm get-command-invocation \
    --region "${aws_region}" \
    --command-id "${command_id}" \
    --instance-id "${instance_id}" \
    --query Status \
    --output text 2>/dev/null || true)"
  case "${status}" in
    Success) break ;;
    Pending|InProgress|Delayed|"") sleep "${poll_interval_seconds}" ;;
    Cancelled|Cancelling|TimedOut|Failed|Undeliverable|Terminated) break ;;
    *) maintenance_fail "Unexpected SSM command status: ${status}" ;;
  esac
done

if [[ "${status}" == "Pending" || "${status}" == "InProgress" || "${status}" == "Delayed" || -z "${status}" ]]; then
  aws ssm cancel-command --region "${aws_region}" --command-id "${command_id}" >/dev/null 2>&1 || true
  status="TimedOut"
fi

standard_output="$(aws ssm get-command-invocation \
  --region "${aws_region}" --command-id "${command_id}" --instance-id "${instance_id}" \
  --query StandardOutputContent --output text 2>/dev/null || true)"
standard_error="$(aws ssm get-command-invocation \
  --region "${aws_region}" --command-id "${command_id}" --instance-id "${instance_id}" \
  --query StandardErrorContent --output text 2>/dev/null || true)"
if [[ -n "${standard_output}" && "${standard_output}" != "None" ]]; then printf '%s\n' "${standard_output}"; fi
if [[ -n "${standard_error}" && "${standard_error}" != "None" ]]; then printf '%s\n' "${standard_error}" >&2; fi
[[ "${status}" == "Success" ]] || maintenance_fail "SSM maintenance finished with status ${status}."
maintenance_log "SSM ${action} command completed successfully."
