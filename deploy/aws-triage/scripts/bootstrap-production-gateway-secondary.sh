#!/usr/bin/env bash

set -Eeuo pipefail

bootstrap_log() {
  printf '%s\n' "[GateLM Gateway bootstrap] $*"
}

bootstrap_fail() {
  printf '%s\n' "[GateLM Gateway bootstrap] ERROR: $*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || bootstrap_fail "$1 is required."
}

primary_instance_id="${1:-}"
secondary_instance_id="${2:-}"
bootstrap_bucket="${3:-}"
bootstrap_kms_key_arn="${4:-}"
target_sha="${5:-}"
gateway_upstream_host="${6:-10.78.2.20}"
aws_region="${AWS_REGION:-${AWS_DEFAULT_REGION:-}}"
poll_interval_seconds="${GATELM_SSM_POLL_INTERVAL_SECONDS:-15}"
max_polls="${GATELM_SSM_MAX_POLLS:-480}"

[[ "${primary_instance_id}" =~ ^i-[0-9a-f]{8,17}$ ]] || bootstrap_fail "Invalid primary Gateway instance id."
[[ "${secondary_instance_id}" =~ ^i-[0-9a-f]{8,17}$ ]] || bootstrap_fail "Invalid secondary Gateway instance id."
[[ "${primary_instance_id}" != "${secondary_instance_id}" ]] || bootstrap_fail "Gateway instance ids must be distinct."
[[ "${bootstrap_bucket}" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || bootstrap_fail "Invalid bootstrap bucket name."
[[ "${bootstrap_kms_key_arn}" =~ ^arn:[a-z0-9-]+:kms:[a-z0-9-]+:[0-9]{12}:key/[0-9a-f-]{36}$ ]] || \
  bootstrap_fail "Invalid bootstrap KMS key ARN."
[[ "${target_sha}" =~ ^[0-9a-f]{40}$ ]] || bootstrap_fail "Target SHA must be a full lowercase Git SHA."
[[ "${gateway_upstream_host}" == "10.78.2.20" || "${gateway_upstream_host}" == "10.78.2.10" ]] || \
  bootstrap_fail "Gateway upstream host must be 10.78.2.20 or 10.78.2.10."
[[ -n "${aws_region}" ]] || bootstrap_fail "AWS_REGION is required."
[[ "${poll_interval_seconds}" =~ ^[1-9][0-9]*$ ]] || bootstrap_fail "Invalid poll interval."
[[ "${max_polls}" =~ ^[1-9][0-9]*$ ]] || bootstrap_fail "Invalid poll count."

for command_name in aws base64 date jq tr; do
  need_command "${command_name}"
done

for instance_id in "${primary_instance_id}" "${secondary_instance_id}"; do
  ping_status="$(aws ssm describe-instance-information \
    --region "${aws_region}" \
    --filters "Key=InstanceIds,Values=${instance_id}" \
    --query 'InstanceInformationList[0].PingStatus' \
    --output text)"
  [[ "${ping_status}" == "Online" ]] || \
    bootstrap_fail "Gateway instance ${instance_id} is not online in Systems Manager (status: ${ping_status})."
done

send_and_wait() {
  local instance_id="$1" label="$2" remote_script="$3"
  local encoded command parameters_json command_id status standard_output standard_error

  encoded="$(printf '%s' "${remote_script}" | base64 | tr -d '\n')"
  command="printf '%s' '${encoded}' | base64 --decode | bash"
  parameters_json="$(jq -cn --arg command "${command}" \
    '{commands: [$command], executionTimeout: ["7200"]}')"
  command_id="$(aws ssm send-command \
    --region "${aws_region}" \
    --instance-ids "${instance_id}" \
    --document-name AWS-RunShellScript \
    --comment "GateLM ${label}" \
    --parameters "${parameters_json}" \
    --timeout-seconds 600 \
    --query 'Command.CommandId' \
    --output text)"
  [[ -n "${command_id}" && "${command_id}" != "None" ]] || bootstrap_fail "SSM did not return a command id for ${label}."
  bootstrap_log "${label} SSM command id: ${command_id}"

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
      *) bootstrap_fail "Unexpected ${label} SSM command status: ${status}" ;;
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
  [[ "${status}" == "Success" ]]
}

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
object_key="gateway-bootstrap/${secondary_instance_id}/${target_sha}-${timestamp}.tar.gz"
bundle_uploaded=false

cleanup_bundle() {
  local exit_code=$?
  trap - EXIT
  if [[ "${bundle_uploaded}" == "true" ]]; then
    set +e
    printf -v bucket_q '%q' "${bootstrap_bucket}"
    printf -v object_key_q '%q' "${object_key}"
    cleanup_script="$(cat <<EOF
set -euo pipefail
aws s3api delete-object --bucket ${bucket_q} --key ${object_key_q} >/dev/null
EOF
)"
    if send_and_wait "${primary_instance_id}" "delete Gateway bootstrap bundle" "${cleanup_script}"; then
      bootstrap_log "Deleted the exact encrypted bootstrap object."
    else
      bootstrap_log "WARNING: bootstrap object cleanup failed; the one-day lifecycle rule remains the safety net."
    fi
    set -e
  fi
  exit "${exit_code}"
}
trap cleanup_bundle EXIT

printf -v bucket_q '%q' "${bootstrap_bucket}"
printf -v object_key_q '%q' "${object_key}"
printf -v kms_key_q '%q' "${bootstrap_kms_key_arn}"

upload_script="$(cat <<EOF
set -Eeuo pipefail
umask 077
orch=/home/ubuntu/gatelm-production-orchestration
secret_root=/home/ubuntu/gatelm-production-secrets
bundle=\$(mktemp /dev/shm/gatelm-gateway-bootstrap.XXXXXX.tar.gz)
cleanup() { rm -f "\${bundle}"; }
trap cleanup EXIT
[[ -f "\${orch}/.env.production-distributed.base" && ! -L "\${orch}/.env.production-distributed.base" ]]
[[ -f "\${orch}/.env.production-distributed" && ! -L "\${orch}/.env.production-distributed" ]]
[[ -d "\${secret_root}" && ! -L "\${secret_root}" ]]
[[ "\$(stat -c '%a' "\${orch}/.env.production-distributed.base")" == 600 ]]
[[ "\$(stat -c '%a' "\${orch}/.env.production-distributed")" == 600 ]]
[[ "\$(find "\${secret_root}" -xdev -type f ! -perm 600 | wc -l)" == 0 ]]
tar -czf "\${bundle}" -C /home/ubuntu \
  gatelm-production-orchestration/.env.production-distributed.base \
  gatelm-production-orchestration/.env.production-distributed \
  gatelm-production-secrets
aws s3 cp "\${bundle}" "s3://${bucket_q}/${object_key_q}" \
  --only-show-errors \
  --sse aws:kms \
  --sse-kms-key-id ${kms_key_q}
EOF
)"

bootstrap_log "Uploading an encrypted, short-lived bootstrap bundle from the primary Gateway."
send_and_wait "${primary_instance_id}" "upload Gateway bootstrap bundle" "${upload_script}" || \
  bootstrap_fail "Primary Gateway bootstrap upload failed."
bundle_uploaded=true

printf -v target_sha_q '%q' "${target_sha}"
printf -v gateway_upstream_host_q '%q' "${gateway_upstream_host}"
download_script="$(cat <<EOF
set -Eeuo pipefail
umask 077
bucket=${bucket_q}
object_key=${object_key_q}
kms_key=${kms_key_q}
target_sha=${target_sha_q}
gateway_upstream_host=${gateway_upstream_host_q}
repo=/home/ubuntu/GateLM
orch=/home/ubuntu/gatelm-production-orchestration
secret_root=/home/ubuntu/gatelm-production-secrets
bundle=\$(mktemp /dev/shm/gatelm-gateway-bootstrap.XXXXXX.tar.gz)
stage=\$(mktemp -d /home/ubuntu/gatelm-gateway-bootstrap.XXXXXX)
cleanup() {
  rm -f "\${bundle}"
  if [[ "\${stage}" == /home/ubuntu/gatelm-gateway-bootstrap.* && -d "\${stage}" ]]; then
    rm -rf -- "\${stage}"
  fi
}
trap cleanup EXIT

cloud-init status --wait >/dev/null
[[ "\$(tr -d '[:space:]' < /etc/gatelm-production-role)" == gateway ]]
[[ ! -e "\${orch}" && ! -e "\${secret_root}" ]]

read -r encryption observed_kms_key < <(aws s3api head-object \
  --bucket "\${bucket}" --key "\${object_key}" \
  --query '[ServerSideEncryption,SSEKMSKeyId]' --output text)
[[ "\${encryption}" == aws:kms && "\${observed_kms_key}" == "\${kms_key}" ]]
aws s3 cp "s3://\${bucket}/\${object_key}" "\${bundle}" --only-show-errors

if tar -tzf "\${bundle}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  printf '%s\n' 'Unsafe path in Gateway bootstrap archive.' >&2
  exit 1
fi
tar -tzf "\${bundle}" | grep -Fxq gatelm-production-orchestration/.env.production-distributed.base
tar -tzf "\${bundle}" | grep -Fxq gatelm-production-orchestration/.env.production-distributed
tar -tzf "\${bundle}" | grep -Eq '^gatelm-production-secrets/.+'
if tar -tzf "\${bundle}" | grep -Ev \
  '^(gatelm-production-orchestration/\.env\.production-distributed(\.base)?|gatelm-production-secrets(/.*)?)$' >/dev/null; then
  printf '%s\n' 'Unexpected path in Gateway bootstrap archive.' >&2
  exit 1
fi
tar -xzf "\${bundle}" -C "\${stage}"

if [[ -d "\${repo}/.git" ]]; then
  [[ -z "\$(git -c safe.directory="\${repo}" -C "\${repo}" status --porcelain --untracked-files=all)" ]]
else
  [[ -d "\${repo}" && -z "\$(find "\${repo}" -mindepth 1 -maxdepth 1 -print -quit)" ]]
  rmdir "\${repo}"
  sudo -u ubuntu git clone --no-tags https://github.com/KYUJEONGLEE/GateLM.git "\${repo}"
fi
sudo -u ubuntu git -C "\${repo}" fetch --no-tags origin main
resolved=\$(sudo -u ubuntu git -C "\${repo}" rev-parse "\${target_sha}^{commit}")
current_main=\$(sudo -u ubuntu git -C "\${repo}" rev-parse FETCH_HEAD)
[[ "\${resolved}" == "\${target_sha}" && "\${current_main}" == "\${target_sha}" ]]
sudo -u ubuntu git -C "\${repo}" checkout --detach "\${target_sha}" >/dev/null

install -d -o ubuntu -g ubuntu -m 0755 "\${orch}"
cp -a "\${repo}/deploy/aws-triage/." "\${orch}/"
install -o ubuntu -g ubuntu -m 0600 \
  "\${stage}/gatelm-production-orchestration/.env.production-distributed.base" \
  "\${orch}/.env.production-distributed.base"
install -o ubuntu -g ubuntu -m 0600 \
  "\${stage}/gatelm-production-orchestration/.env.production-distributed" \
  "\${orch}/.env.production-distributed"
install -d -o ubuntu -g ubuntu -m 0700 "\${secret_root}"
cp -a "\${stage}/gatelm-production-secrets/." "\${secret_root}/"
chown -R ubuntu:ubuntu "\${secret_root}" "\${orch}"
find "\${secret_root}" -type d -exec chmod 0700 {} +
find "\${secret_root}" -type f -exec chmod 0600 {} +

replace_env_value() {
  local key="\$1" value="\$2" file="\$3" temp found
  temp=\$(mktemp "\${file}.XXXXXX")
  found=\$(awk -F= -v key="\${key}" '\$1 == key {count += 1} END {print count + 0}' "\${file}")
  [[ "\${found}" == 1 ]]
  awk -F= -v key="\${key}" -v value="\${value}" \
    '\$1 == key {print key "=" value; next} {print}' "\${file}" > "\${temp}"
  chown ubuntu:ubuntu "\${temp}"
  chmod 0600 "\${temp}"
  mv "\${temp}" "\${file}"
}
replace_env_value GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_PRIVATE_IP 10.78.2.21 \
  "\${orch}/.env.production-distributed"

sudo -u ubuntu bash "\${repo}/deploy/aws-triage/scripts/production-distributed-deploy-role.sh" \
  --role gateway \
  --sha "\${target_sha}" \
  --gateway-upstream-host "\${gateway_upstream_host}"
EOF
)"

bootstrap_log "Bootstrapping and deploying the secondary Gateway without exposing secret values."
send_and_wait "${secondary_instance_id}" "bootstrap secondary Gateway ${target_sha}" "${download_script}" || \
  bootstrap_fail "Secondary Gateway bootstrap failed."

bootstrap_log "Secondary Gateway bootstrap and exact-SHA deployment passed."
