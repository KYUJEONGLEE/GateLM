#!/usr/bin/env bash

set -euo pipefail

ssm_log() {
  printf '%s\n' "[GateLM distributed CD] $*"
}

ssm_fail() {
  printf '%s\n' "[GateLM distributed CD] ERROR: $*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || ssm_fail "$1 is required."
}

edge_instance_id="${1:-}"
gateway_instance_id="${2:-}"
data_instance_id="${3:-}"
ai_instance_id="${4:-}"
deploy_sha="${5:-}"
public_url="${6:-}"
chat_url="${7:-}"
operation="${8:-deploy}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
poll_interval_seconds="${GATELM_SSM_POLL_INTERVAL_SECONDS:-15}"
max_polls="${GATELM_SSM_MAX_POLLS:-480}"

declare -A instance_ids=(
  [edge]="${edge_instance_id}"
  [gateway]="${gateway_instance_id}"
  [data]="${data_instance_id}"
  [ai]="${ai_instance_id}"
)
deploy_order=(ai data gateway edge)

for role in edge gateway data ai; do
  [[ "${instance_ids[${role}]}" =~ ^i-[0-9a-f]{8,17}$ ]] || ssm_fail "Invalid ${role} EC2 instance id."
done
[[ "${deploy_sha}" =~ ^[0-9a-f]{40}$ ]] || ssm_fail "Invalid deployment SHA."
[[ "${public_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || ssm_fail "Public URL must be an HTTPS origin."
[[ "${chat_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || ssm_fail "Chat URL must be an HTTPS origin."
[[ "${operation}" == "deploy" || "${operation}" == "rollback" ]] || ssm_fail "Operation must be deploy or rollback."
[[ -n "${aws_region}" ]] || ssm_fail "AWS_REGION is required."
[[ "${poll_interval_seconds}" =~ ^[0-9]+$ ]] || ssm_fail "Invalid poll interval."
[[ "${max_polls}" =~ ^[1-9][0-9]*$ ]] || ssm_fail "Invalid poll count."

unique_count="$(printf '%s\n' "${instance_ids[@]}" | sort -u | wc -l | tr -d '[:space:]')"
[[ "${unique_count}" == "4" ]] || ssm_fail "Edge, Gateway, Data, and AI must use four distinct instances."

for command_name in aws base64 jq sort tr wc; do
  need_command "${command_name}"
done

for role in edge gateway data ai; do
  ping_status="$(aws ssm describe-instance-information \
    --region "${aws_region}" \
    --filters "Key=InstanceIds,Values=${instance_ids[${role}]}" \
    --query 'InstanceInformationList[0].PingStatus' \
    --output text)"
  [[ "${ping_status}" == "Online" ]] || \
    ssm_fail "${role} instance ${instance_ids[${role}]} is not online in Systems Manager (status: ${ping_status})."
done

send_role_command() {
  local role="$1" mode="$2"
  local instance_id="${instance_ids[${role}]}"
  local mode_flag="" remote_script remote_script_base64 remote_command parameters_json command_id
  local status standard_output standard_error

  [[ "${mode}" == "deploy" || "${mode}" == "rollback" ]] || ssm_fail "Invalid role command mode."
  [[ "${mode}" == "rollback" ]] && mode_flag="--rollback"

  printf -v deploy_sha_q '%q' "${deploy_sha}"
  printf -v role_q '%q' "${role}"
  printf -v mode_flag_q '%q' "${mode_flag}"

  remote_script="$(cat <<EOF
set -euo pipefail
deploy_sha=${deploy_sha_q}
role=${role_q}
mode_flag=${mode_flag_q}
repo=/home/ubuntu/GateLM
script_path=\$(mktemp /tmp/gatelm-production-distributed-deploy.XXXXXX)
cleanup() { rm -f "\${script_path}"; }
trap cleanup EXIT
sudo -u ubuntu git -C "\${repo}" fetch --no-tags origin main
resolved=\$(sudo -u ubuntu git -C "\${repo}" rev-parse "\${deploy_sha}^{commit}")
[[ "\${resolved}" == "\${deploy_sha}" ]]
sudo -u ubuntu git -C "\${repo}" show "\${deploy_sha}:deploy/aws-triage/scripts/production-distributed-deploy-role.sh" > "\${script_path}"
chown ubuntu:ubuntu "\${script_path}"
chmod 700 "\${script_path}"
sudo -u ubuntu bash "\${script_path}" --role "\${role}" --sha "\${deploy_sha}" \${mode_flag}
EOF
)"

  remote_script_base64="$(printf '%s' "${remote_script}" | base64 | tr -d '\n')"
  remote_command="printf '%s' '${remote_script_base64}' | base64 --decode | bash"
  parameters_json="$(jq -cn --arg command "${remote_command}" \
    '{commands: [$command], executionTimeout: ["7200"]}')"

  ssm_log "Sending ${mode} ${deploy_sha} to ${role} (${instance_id})."
  command_id="$(aws ssm send-command \
    --region "${aws_region}" \
    --instance-ids "${instance_id}" \
    --document-name AWS-RunShellScript \
    --comment "GateLM distributed ${mode} ${deploy_sha} ${role}" \
    --parameters "${parameters_json}" \
    --timeout-seconds 600 \
    --query 'Command.CommandId' \
    --output text)"
  [[ -n "${command_id}" && "${command_id}" != "None" ]] || ssm_fail "SSM did not return a command id for ${role}."
  ssm_log "${role} SSM command id: ${command_id}"

  status="Pending"
  for ((poll = 1; poll <= max_polls; poll += 1)); do
    status="$(aws ssm get-command-invocation \
      --region "${aws_region}" \
      --command-id "${command_id}" \
      --instance-id "${instance_id}" \
      --query Status --output text 2>/dev/null || true)"
    case "${status}" in
      Success) break ;;
      Pending|InProgress|Delayed|"") sleep "${poll_interval_seconds}" ;;
      Cancelled|Cancelling|TimedOut|Failed|Undeliverable|Terminated) break ;;
      *) ssm_fail "Unexpected ${role} SSM command status: ${status}" ;;
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
  [[ -z "${standard_output}" || "${standard_output}" == "None" ]] || printf '%s\n' "${standard_output}"
  [[ -z "${standard_error}" || "${standard_error}" == "None" ]] || printf '%s\n' "${standard_error}" >&2
  [[ "${status}" == "Success" ]] || return 1
}

completed_roles=()
rollback_completed_roles() {
  local index role rollback_failed=false
  for ((index = ${#completed_roles[@]} - 1; index >= 0; index -= 1)); do
    role="${completed_roles[${index}]}"
    if ! send_role_command "${role}" rollback; then
      ssm_log "Rollback failed for ${role}; manual intervention is required."
      rollback_failed=true
    fi
  done
  [[ "${rollback_failed}" == "false" ]]
}

if [[ "${operation}" == "rollback" ]]; then
  completed_roles=(ai data gateway edge)
  rollback_completed_roles || ssm_fail "Distributed rollback was incomplete."
  ssm_log "Distributed rollback completed for ${deploy_sha}. Database migrations were not reversed."
  exit 0
fi

for role in "${deploy_order[@]}"; do
  if ! send_role_command "${role}" deploy; then
    ssm_log "Deployment failed at ${role}; rolling back completed roles."
    rollback_completed_roles || true
    ssm_fail "Distributed deployment failed at ${role}."
  fi
  completed_roles+=("${role}")
done

ssm_log "Distributed deployment passed for ${deploy_sha}."
ssm_log "Public verification targets: ${public_url%/} and ${chat_url%/}."
