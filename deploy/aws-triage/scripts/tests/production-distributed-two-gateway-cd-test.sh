#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SEND_DEPLOY_PATH="${ROOT_DIR}/deploy/aws-triage/scripts/send-ssm-deploy-distributed.sh"
BOOTSTRAP_PATH="${ROOT_DIR}/deploy/aws-triage/scripts/bootstrap-production-gateway-secondary.sh"
TEST_ROOT="$(mktemp -d /tmp/gatelm-two-gateway-cd-test.XXXXXX)"
[[ "${TEST_ROOT}" == /tmp/gatelm-two-gateway-cd-test.* ]]
cleanup() {
  rm -rf -- "${TEST_ROOT}"
}
trap cleanup EXIT

MOCK_BIN="${TEST_ROOT}/bin"
AWS_LOG="${TEST_ROOT}/aws.log"
mkdir -p "${MOCK_BIN}"

cat > "${MOCK_BIN}/aws" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%q ' "$@" >> "${GATELM_TEST_AWS_LOG}"
printf '\n' >> "${GATELM_TEST_AWS_LOG}"
case "$*" in
  *"describe-instance-information"*) printf '%s\n' Online ;;
  *"send-command"*)
    count="$(grep -c '^ssm send-command ' "${GATELM_TEST_AWS_LOG}" || true)"
    printf 'command-%s\n' "${count}"
    ;;
  *"get-command-invocation"*"--query Status"*) printf '%s\n' Success ;;
  *"get-command-invocation"*) printf '%s\n' None ;;
  *"cancel-command"*) ;;
  *) printf 'Unexpected mocked AWS call: %s\n' "$*" >&2; exit 1 ;;
esac
EOF

cat > "${MOCK_BIN}/jq" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
command_value=""
while (( $# > 0 )); do
  if [[ "$1" == --arg && "${2:-}" == command && $# -ge 3 ]]; then
    command_value="$3"
    shift 3
    continue
  fi
  shift
done
if [[ -n "${command_value}" ]]; then
  [[ "${command_value}" =~ \047([A-Za-z0-9+/=]+)\047 ]]
  printf '%s' "${BASH_REMATCH[1]}" | base64 --decode | bash -n
fi
printf '%s\n' '{"commands":["mock"],"executionTimeout":["7200"]}'
EOF

chmod 700 "${MOCK_BIN}/aws" "${MOCK_BIN}/jq"
export GATELM_TEST_AWS_LOG="${AWS_LOG}"
export PATH="${MOCK_BIN}:${PATH}"
export AWS_REGION=ap-northeast-2
export GATELM_SSM_POLL_INTERVAL_SECONDS=1
export GATELM_SSM_MAX_POLLS=2

sha=0123456789abcdef0123456789abcdef01234567
bash "${SEND_DEPLOY_PATH}" \
  i-00000001 i-00000002 i-00000003 i-00000004 i-00000005 \
  "${sha}" https://gatelm.co.kr https://chat.gatelm.co.kr deploy \
  i-00000006 10.78.2.10 >/dev/null

[[ "$(grep -c '^ssm send-command ' "${AWS_LOG}")" == 6 ]]
secondary_line="$(grep -n 'gateway-secondary' "${AWS_LOG}" | head -n 1 | cut -d: -f1)"
primary_line="$(grep -n 'gateway-primary' "${AWS_LOG}" | head -n 1 | cut -d: -f1)"
[[ "${secondary_line}" =~ ^[0-9]+$ && "${primary_line}" =~ ^[0-9]+$ ]]
(( secondary_line < primary_line ))

: > "${AWS_LOG}"
bash "${SEND_DEPLOY_PATH}" \
  i-00000001 i-00000002 i-00000003 i-00000004 i-00000005 \
  "${sha}" https://gatelm.co.kr https://chat.gatelm.co.kr deploy \
  "" 10.78.2.20 >/dev/null
[[ "$(grep -c '^ssm send-command ' "${AWS_LOG}")" == 5 ]]
if grep -q 'gateway-secondary' "${AWS_LOG}"; then
  printf '%s\n' 'Secondary Gateway appeared in the backward-compatible five-target deploy.' >&2
  exit 1
fi

: > "${AWS_LOG}"
bash "${BOOTSTRAP_PATH}" \
  i-00000002 i-00000006 \
  gatelm-bootstrap-test-431772290654 \
  arn:aws:kms:ap-northeast-2:431772290654:key/00000000-0000-0000-0000-000000000000 \
  "${sha}" 10.78.2.20 >/dev/null
[[ "$(grep -c '^ssm send-command ' "${AWS_LOG}")" == 3 ]]
grep -Fq 'upload\ Gateway\ bootstrap\ bundle' "${AWS_LOG}"
grep -Fq 'bootstrap\ secondary\ Gateway' "${AWS_LOG}"
grep -Fq 'delete\ Gateway\ bootstrap\ bundle' "${AWS_LOG}"

echo 'Production distributed two-Gateway CD behavior passed.'
