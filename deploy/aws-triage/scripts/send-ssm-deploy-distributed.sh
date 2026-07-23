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
pii_instance_id="${5:-}"
deploy_sha="${6:-}"
public_url="${7:-}"
chat_url="${8:-}"
operation="${9:-deploy}"
gateway_secondary_instance_id="${10:-}"
gateway_upstream_host="${11:-10.78.2.20}"
pii_secondary_instance_id="${12:-}"
pii_upstream_host="${13:-10.78.2.50}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
poll_interval_seconds="${GATELM_SSM_POLL_INTERVAL_SECONDS:-15}"
max_polls="${GATELM_SSM_MAX_POLLS:-480}"

declare -A instance_ids=(
  [edge]="${edge_instance_id}"
  [gateway-primary]="${gateway_instance_id}"
  [data]="${data_instance_id}"
  [ai]="${ai_instance_id}"
  [pii]="${pii_instance_id}"
)
declare -A app_roles=(
  [edge]=edge
  [gateway-primary]=gateway
  [data]=data
  [ai]=ai
  [pii]=pii
)
deploy_order=()
if [[ -n "${pii_secondary_instance_id}" ]]; then
  instance_ids[pii-secondary]="${pii_secondary_instance_id}"
  app_roles[pii-secondary]=pii
  deploy_order+=(pii-secondary)
fi
deploy_order+=(pii ai data)
if [[ -n "${gateway_secondary_instance_id}" ]]; then
  instance_ids[gateway-secondary]="${gateway_secondary_instance_id}"
  app_roles[gateway-secondary]=gateway
  deploy_order+=(gateway-secondary)
fi
deploy_order+=(gateway-primary edge)

for target in "${!instance_ids[@]}"; do
  [[ "${instance_ids[${target}]}" =~ ^i-[0-9a-f]{8,17}$ ]] || ssm_fail "Invalid ${target} EC2 instance id."
done
[[ "${deploy_sha}" =~ ^[0-9a-f]{40}$ ]] || ssm_fail "Invalid deployment SHA."
[[ "${public_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || ssm_fail "Public URL must be an HTTPS origin."
[[ "${chat_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || ssm_fail "Chat URL must be an HTTPS origin."
[[ "${operation}" == "deploy" || "${operation}" == "rollback" ]] || ssm_fail "Operation must be deploy or rollback."
[[ "${gateway_upstream_host}" == "10.78.2.20" || "${gateway_upstream_host}" == "10.78.2.10" ]] || \
  ssm_fail "Gateway upstream host must be 10.78.2.20 or 10.78.2.10."
[[ "${pii_upstream_host}" == "10.78.2.50" || "${pii_upstream_host}" == "10.78.2.11" ]] || \
  ssm_fail "PII upstream host must be 10.78.2.50 or 10.78.2.11."
[[ -n "${aws_region}" ]] || ssm_fail "AWS_REGION is required."
[[ "${poll_interval_seconds}" =~ ^[0-9]+$ ]] || ssm_fail "Invalid poll interval."
[[ "${max_polls}" =~ ^[1-9][0-9]*$ ]] || ssm_fail "Invalid poll count."

unique_count="$(printf '%s\n' "${instance_ids[@]}" | sort -u | wc -l | tr -d '[:space:]')"
expected_unique_count="${#instance_ids[@]}"
[[ "${unique_count}" == "${expected_unique_count}" ]] || \
  ssm_fail "Every production role target must use a distinct EC2 instance."

for command_name in aws base64 jq sort tr wc; do
  need_command "${command_name}"
done

for target in "${deploy_order[@]}"; do
  ping_status="$(aws ssm describe-instance-information \
    --region "${aws_region}" \
    --filters "Key=InstanceIds,Values=${instance_ids[${target}]}" \
    --query 'InstanceInformationList[0].PingStatus' \
    --output text)"
  [[ "${ping_status}" == "Online" ]] || \
    ssm_fail "${target} instance ${instance_ids[${target}]} is not online in Systems Manager (status: ${ping_status})."
done

send_role_command() {
  local target="$1" mode="$2"
  local role="${app_roles[${target}]}"
  local instance_id="${instance_ids[${target}]}"
  local mode_flag="" remote_script remote_script_base64 remote_command parameters_json command_id
  local status standard_output standard_error

  [[ "${mode}" == "deploy" || "${mode}" == "rollback" ]] || ssm_fail "Invalid role command mode."
  [[ "${mode}" == "rollback" ]] && mode_flag="--rollback"

  printf -v deploy_sha_q '%q' "${deploy_sha}"
  printf -v role_q '%q' "${role}"
  printf -v mode_flag_q '%q' "${mode_flag}"
  printf -v gateway_upstream_host_q '%q' "${gateway_upstream_host}"
  printf -v pii_upstream_host_q '%q' "${pii_upstream_host}"

  remote_script="$(cat <<EOF
set -euo pipefail
deploy_sha=${deploy_sha_q}
role=${role_q}
mode_flag=${mode_flag_q}
gateway_upstream_host=${gateway_upstream_host_q}
pii_upstream_host=${pii_upstream_host_q}
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
sudo -u ubuntu bash "\${script_path}" --role "\${role}" --sha "\${deploy_sha}" \
  --gateway-upstream-host "\${gateway_upstream_host}" \
  --pii-upstream-host "\${pii_upstream_host}" \${mode_flag}
EOF
)"

  remote_script_base64="$(printf '%s' "${remote_script}" | base64 | tr -d '\n')"
  remote_command="printf '%s' '${remote_script_base64}' | base64 --decode | bash"
  parameters_json="$(jq -cn --arg command "${remote_command}" \
    '{commands: [$command], executionTimeout: ["7200"]}')"

  ssm_log "Sending ${mode} ${deploy_sha} to ${target} (${instance_id}) with Gateway upstream ${gateway_upstream_host} and PII upstream ${pii_upstream_host}."
  command_id="$(aws ssm send-command \
    --region "${aws_region}" \
    --instance-ids "${instance_id}" \
    --document-name AWS-RunShellScript \
    --comment "GateLM distributed ${mode} ${deploy_sha} ${target}" \
    --parameters "${parameters_json}" \
    --timeout-seconds 600 \
    --query 'Command.CommandId' \
    --output text)"
  [[ -n "${command_id}" && "${command_id}" != "None" ]] || ssm_fail "SSM did not return a command id for ${target}."
  ssm_log "${target} SSM command id: ${command_id}"

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
      *) ssm_fail "Unexpected ${target} SSM command status: ${status}" ;;
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
  local index target rollback_failed=false
  for ((index = ${#completed_roles[@]} - 1; index >= 0; index -= 1)); do
    target="${completed_roles[${index}]}"
    if ! send_role_command "${target}" rollback; then
      ssm_log "Rollback failed for ${target}; manual intervention is required."
      rollback_failed=true
    fi
  done
  [[ "${rollback_failed}" == "false" ]]
}

if [[ "${operation}" == "rollback" ]]; then
  completed_roles=("${deploy_order[@]}")
  rollback_completed_roles || ssm_fail "Distributed rollback was incomplete."
  ssm_log "Distributed rollback completed for ${deploy_sha}. Database migrations were not reversed."
  exit 0
fi

for target in "${deploy_order[@]}"; do
  if ! send_role_command "${target}" deploy; then
    ssm_log "Deployment failed at ${target}; rolling back completed roles."
    rollback_completed_roles || true
    ssm_fail "Distributed deployment failed at ${target}."
  fi
  completed_roles+=("${target}")
done

ssm_log "Distributed deployment passed for ${deploy_sha}."
ssm_log "Public verification targets: ${public_url%/} and ${chat_url%/}."
