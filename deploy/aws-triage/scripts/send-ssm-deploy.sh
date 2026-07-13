#!/usr/bin/env bash

set -euo pipefail

ssm_log() {
  printf '%s\n' "[GateLM CD] $*"
}

ssm_fail() {
  printf '%s\n' "[GateLM CD] ERROR: $*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || ssm_fail "$1 is required."
}

instance_id="${1:-}"
deploy_sha="${2:-}"
public_url="${3:-}"
chat_url="${4:-}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
poll_interval_seconds="${GATELM_SSM_POLL_INTERVAL_SECONDS:-15}"
max_polls="${GATELM_SSM_MAX_POLLS:-480}"

[[ "${instance_id}" =~ ^i-[0-9a-f]{8,17}$ ]] || ssm_fail "Invalid EC2 instance id."
[[ "${deploy_sha}" =~ ^[0-9a-f]{40}$ ]] || ssm_fail "Invalid deployment SHA."
[[ "${public_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || \
  ssm_fail "Public URL must be an HTTPS origin."
[[ "${chat_url}" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] || \
  ssm_fail "Chat URL must be an HTTPS origin."
[[ -n "${aws_region}" ]] || ssm_fail "AWS_REGION is required."
[[ "${poll_interval_seconds}" =~ ^[0-9]+$ ]] || ssm_fail "Invalid poll interval."
[[ "${max_polls}" =~ ^[1-9][0-9]*$ ]] || ssm_fail "Invalid poll count."

for command_name in aws base64 jq tr; do
  need_command "${command_name}"
done

ping_status="$(aws ssm describe-instance-information \
  --region "${aws_region}" \
  --filters "Key=InstanceIds,Values=${instance_id}" \
  --query 'InstanceInformationList[0].PingStatus' \
  --output text)"
[[ "${ping_status}" == "Online" ]] || \
  ssm_fail "Instance ${instance_id} is not online in Systems Manager (status: ${ping_status})."

printf -v deploy_sha_q '%q' "${deploy_sha}"
printf -v public_url_q '%q' "${public_url%/}"
printf -v chat_url_q '%q' "${chat_url%/}"

remote_script="$(cat <<EOF
set -euo pipefail
deploy_sha=${deploy_sha_q}
public_url=${public_url_q}
chat_url=${chat_url_q}
repo=/home/ubuntu/GateLM
script_path=\$(mktemp /tmp/gatelm-deploy-main.XXXXXX)
cleanup() { rm -f "\${script_path}"; }
trap cleanup EXIT
sudo -u ubuntu git -C "\${repo}" fetch --no-tags origin main
actual_sha=\$(sudo -u ubuntu git -C "\${repo}" rev-parse FETCH_HEAD)
if [[ "\${actual_sha}" != "\${deploy_sha}" ]]; then
  echo "[GateLM CD] ERROR: origin/main moved to \${actual_sha}." >&2
  exit 1
fi
sudo -u ubuntu git -C "\${repo}" show "\${deploy_sha}:deploy/aws-triage/scripts/deploy-main.sh" > "\${script_path}"
chown ubuntu:ubuntu "\${script_path}"
chmod 700 "\${script_path}"
sudo -u ubuntu env \
  GATELM_REPO_DIR="\${repo}" \
  GATELM_DEPLOY_PUBLIC_URL="\${public_url}" \
  GATELM_DEPLOY_CHAT_URL="\${chat_url}" \
  bash "\${script_path}" "\${deploy_sha}"
EOF
)"

remote_script_base64="$(printf '%s' "${remote_script}" | base64 | tr -d '\n')"
remote_command="printf '%s' '${remote_script_base64}' | base64 --decode | bash"

parameters_json="$(jq -cn \
  --arg command "${remote_command}" \
  '{commands: [$command], executionTimeout: ["7200"]}')"

ssm_log "Sending deployment ${deploy_sha} to ${instance_id}."
command_id="$(aws ssm send-command \
  --region "${aws_region}" \
  --instance-ids "${instance_id}" \
  --document-name AWS-RunShellScript \
  --comment "GateLM production deploy ${deploy_sha}" \
  --parameters "${parameters_json}" \
  --timeout-seconds 600 \
  --query 'Command.CommandId' \
  --output text)"
[[ -n "${command_id}" && "${command_id}" != "None" ]] || ssm_fail "SSM did not return a command id."
ssm_log "SSM command id: ${command_id}"

cancel_on_signal() {
  ssm_log "Cancelling SSM command ${command_id}."
  aws ssm cancel-command \
    --region "${aws_region}" \
    --command-id "${command_id}" >/dev/null 2>&1 || true
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
    Success)
      break
      ;;
    Pending|InProgress|Delayed|"")
      sleep "${poll_interval_seconds}"
      ;;
    Cancelled|Cancelling|TimedOut|Failed|Undeliverable|Terminated)
      break
      ;;
    *)
      ssm_fail "Unexpected SSM command status: ${status}"
      ;;
  esac
done

if [[ "${status}" == "Pending" || "${status}" == "InProgress" || "${status}" == "Delayed" || -z "${status}" ]]; then
  aws ssm cancel-command \
    --region "${aws_region}" \
    --command-id "${command_id}" >/dev/null 2>&1 || true
  status="TimedOut"
fi

standard_output="$(aws ssm get-command-invocation \
  --region "${aws_region}" \
  --command-id "${command_id}" \
  --instance-id "${instance_id}" \
  --query StandardOutputContent \
  --output text 2>/dev/null || true)"
standard_error="$(aws ssm get-command-invocation \
  --region "${aws_region}" \
  --command-id "${command_id}" \
  --instance-id "${instance_id}" \
  --query StandardErrorContent \
  --output text 2>/dev/null || true)"

if [[ -n "${standard_output}" && "${standard_output}" != "None" ]]; then
  printf '%s\n' "${standard_output}"
fi
if [[ -n "${standard_error}" && "${standard_error}" != "None" ]]; then
  printf '%s\n' "${standard_error}" >&2
fi

[[ "${status}" == "Success" ]] || ssm_fail "SSM deployment finished with status ${status}."
ssm_log "Deployment command completed successfully."
