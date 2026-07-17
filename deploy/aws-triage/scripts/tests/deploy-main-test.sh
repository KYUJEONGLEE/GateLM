#!/usr/bin/env bash

set -euo pipefail

TEST_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_DIR="$(cd "${TEST_DIR}/.." && pwd)"
AWS_TRIAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${AWS_TRIAGE_DIR}/../.." && pwd)"
DEPLOY_SCRIPT="${SCRIPT_DIR}/deploy-main.sh"
SSM_SCRIPT="${SCRIPT_DIR}/send-ssm-deploy.sh"
E5_BUNDLE_SCRIPT="${SCRIPT_DIR}/prepare-gateway-e5-runtime-bundle.sh"
E5_QUANTIZER_DOCKERFILE="${REPO_ROOT}/infra/docker/e5-artifact-quantizer.Dockerfile"
E5_QUANTIZER_SCRIPT="${REPO_ROOT}/scripts/routing_difficulty_model/quantize_e5_onnx.py"
E5_QUANTIZER_REQUIREMENTS="${REPO_ROOT}/scripts/routing_difficulty_model/e5-quantizer-requirements.lock.txt"
WORKFLOW_FILE="${REPO_ROOT}/.github/workflows/deploy-production.yml"
MAINTENANCE_WORKFLOW_FILE="${REPO_ROOT}/.github/workflows/tenant-chat-cache-keyset-maintenance.yml"
MAINTENANCE_SSM_SCRIPT="${SCRIPT_DIR}/send-ssm-cache-keyset-maintenance.sh"
TEMPLATE_FILE="${AWS_TRIAGE_DIR}/aws/github-actions-cd.template.json"
COMPOSE_FILE="${AWS_TRIAGE_DIR}/docker-compose.yml"

fail() {
  printf '%s\n' "[deploy-main-test] ERROR: $*" >&2
  exit 1
}

assert_fails_with() {
  local expected="$1"
  shift
  local output status

  set +e
  output="$("$@" 2>&1)"
  status=$?
  set -e

  (( status != 0 )) || fail "Command unexpectedly succeeded: $*"
  grep -Fq "${expected}" <<<"${output}" || \
    fail "Expected failure text was not found: ${expected}"
}

for file in "${DEPLOY_SCRIPT}" "${SSM_SCRIPT}" "${MAINTENANCE_SSM_SCRIPT}" "${E5_BUNDLE_SCRIPT}"; do
  bash -n "${file}"
done
if python3 --version >/dev/null 2>&1; then
  PYTHON_COMMAND=(python3)
elif py -3.12 --version >/dev/null 2>&1; then
  PYTHON_COMMAND=(py -3.12)
else
  fail "Python 3.12 is required to verify the E5 quantizer"
fi
for file in "${E5_QUANTIZER_DOCKERFILE}" "${E5_QUANTIZER_SCRIPT}" "${E5_QUANTIZER_REQUIREMENTS}"; do
  [[ -f "${file}" && ! -L "${file}" ]] || fail "Pinned E5 quantizer material is missing: ${file}"
done
"${PYTHON_COMMAND[@]}" -m py_compile "${E5_QUANTIZER_SCRIPT}"
"${PYTHON_COMMAND[@]}" "${E5_QUANTIZER_SCRIPT}" --help >/dev/null

bootstrap_probe="$(printf '%s' 'set -euo pipefail; printf probe-ok' | base64 | tr -d '\n')"
probe_output="$(sh -c "printf '%s' '${bootstrap_probe}' | base64 --decode | bash")"
[[ "${probe_output}" == "probe-ok" ]] || \
  fail "The POSIX shell wrapper did not hand the payload to bash"

assert_fails_with \
  "A full 40-character lowercase Git SHA is required" \
  bash "${DEPLOY_SCRIPT}" invalid-sha
assert_fails_with \
  "Invalid EC2 instance id" \
  bash "${SSM_SCRIPT}" invalid 0000000000000000000000000000000000000000 https://gatelm.co.kr https://chat.gatelm.co.kr
assert_fails_with \
  "Invalid deployment SHA" \
  bash "${SSM_SCRIPT}" i-0123456789abcdef0 invalid https://gatelm.co.kr https://chat.gatelm.co.kr
assert_fails_with \
  "Invalid maintenance SHA" \
  bash "${MAINTENANCE_SSM_SCRIPT}" i-0123456789abcdef0 invalid check
assert_fails_with \
  "Public URL must be an HTTPS origin" \
  bash "${SSM_SCRIPT}" i-0123456789abcdef0 0000000000000000000000000000000000000000 http://gatelm.co.kr https://chat.gatelm.co.kr

node - "${TEMPLATE_FILE}" <<'NODE'
const fs = require("node:fs");
const templatePath = process.argv[2];
const template = JSON.parse(fs.readFileSync(templatePath, "utf8"));
const resources = template.Resources ?? {};

if (resources.GitHubDeployRole?.Type !== "AWS::IAM::Role") {
  throw new Error("GitHubDeployRole is missing");
}
if (resources.GateLMEc2SsmInstanceProfile?.Type !== "AWS::IAM::InstanceProfile") {
  throw new Error("GateLMEc2SsmInstanceProfile is missing");
}

const trust = resources.GitHubDeployRole.Properties.AssumeRolePolicyDocument;
const trustJson = JSON.stringify(trust);
if (!trustJson.includes("token.actions.githubusercontent.com:sub")) {
  throw new Error("OIDC subject restriction is missing");
}
if (!trustJson.includes(":environment:${GitHubEnvironment}")) {
  throw new Error("OIDC trust is not restricted to the GitHub environment");
}

const policies = resources.GitHubDeployRole.Properties.Policies ?? [];
const policyJson = JSON.stringify(policies);
if (!policyJson.includes("AWS-RunShellScript") || !policyJson.includes("${DeploymentInstanceId}")) {
  throw new Error("SSM SendCommand is not restricted to the deployment instance and document");
}
NODE

grep -Fq "workflow_run:" "${WORKFLOW_FILE}" || fail "workflow_run trigger is missing"
grep -Fq "id-token: write" "${WORKFLOW_FILE}" || fail "OIDC permission is missing"
grep -Fq "name: production" "${WORKFLOW_FILE}" || fail "production environment is missing"
grep -Fq "517a711dbcd0e402f90c77e7e2f81e849156e31d" "${WORKFLOW_FILE}" || \
  fail "AWS credentials action is not pinned"
for required_smoke_secret in \
  'secrets.TENANT_CHAT_SMOKE_EMAIL' \
  'secrets.TENANT_CHAT_SMOKE_PASSWORD'
do
  grep -Fq "${required_smoke_secret}" "${WORKFLOW_FILE}" || \
    fail "Required Tenant Chat smoke secret is missing: ${required_smoke_secret}"
done
grep -Fq "workflow_dispatch:" "${MAINTENANCE_WORKFLOW_FILE}" || \
  fail "Cache key-set maintenance must be manually dispatched"
grep -Fq "name: production" "${MAINTENANCE_WORKFLOW_FILE}" || \
  fail "Cache key-set maintenance must use the protected production environment"
grep -Fq "id-token: write" "${MAINTENANCE_WORKFLOW_FILE}" || \
  fail "Cache key-set maintenance requires OIDC permission"
grep -Fq "TENANT_CHAT_SMOKE_VERIFY_CACHE: \"true\"" "${MAINTENANCE_WORKFLOW_FILE}" || \
  fail "Cache key-set apply must verify an exact-cache miss followed by a hit"
grep -Fq "send-ssm-cache-keyset-maintenance.sh" "${MAINTENANCE_WORKFLOW_FILE}" || \
  fail "Cache key-set maintenance must use the reviewed SSM sender"
unexpected_secret_references="$(
  grep -oE 'secrets\.[A-Za-z_][A-Za-z0-9_]*' "${WORKFLOW_FILE}" | \
    sort -u | \
    grep -Fvx \
      -e 'secrets.TENANT_CHAT_SMOKE_EMAIL' \
      -e 'secrets.TENANT_CHAT_SMOKE_PASSWORD' || true
)"
[[ -z "${unexpected_secret_references}" ]] || \
  fail "The deployment workflow contains an unexpected GitHub secret reference: ${unexpected_secret_references}"

grep -Fq 'wait_for_postgres || deploy_fail' "${DEPLOY_SCRIPT}" || \
  fail "PostgreSQL readiness must be verified before migrations"
grep -Fq 'validate_tenant_chat_secrets' "${DEPLOY_SCRIPT}" || \
  fail "Tenant Chat secret files must be validated before the image build"
grep -Fq 'validate-tenant-chat-cache-keyset.mjs' "${DEPLOY_SCRIPT}" || \
  fail "Tenant Chat cache key-set identity must be validated before the image build"
grep -Fq 'TENANT_CHAT_CACHE_KEY_SET_ID: ${TENANT_CHAT_CACHE_KEY_SET_ID:?TENANT_CHAT_CACHE_KEY_SET_ID is required}' "${COMPOSE_FILE}" || \
  fail "Production Compose must require an explicit Tenant Chat cache key-set ID"
grep -Fq 'export TENANT_CHAT_RUNTIME_UID="${secret_owner_uid}"' "${DEPLOY_SCRIPT}" || \
  fail "Tenant Chat secret owner UID must be passed to Compose"
grep -Fq 'export TENANT_CHAT_RUNTIME_GID="${secret_owner_gid}"' "${DEPLOY_SCRIPT}" || \
  fail "Tenant Chat secret owner GID must be passed to Compose"
grep -Fq 'Tenant Chat secret files must share one owner UID and GID.' "${DEPLOY_SCRIPT}" || \
  fail "Tenant Chat secret files must have consistent ownership"
grep -Fq 'content-keys.json' "${DEPLOY_SCRIPT}" || \
  fail "Tenant Chat content keys must be validated before the image build"
grep -Fq 'tenant-chat-secrets' "${DEPLOY_SCRIPT}" || \
  fail "Tenant Chat secrets must be backed up with the database"
grep -Fq 'install -m 600' "${DEPLOY_SCRIPT}" || \
  fail "Tenant Chat secret backups must use restrictive file permissions"
grep -Fq 'wait_for_chat_api_readiness' "${DEPLOY_SCRIPT}" || \
  fail "Deployment must verify Chat API database and key continuity"
grep -Fq 'Chat API readiness did not verify database and key continuity.' "${DEPLOY_SCRIPT}" || \
  fail "A key continuity failure must fail the deployment"
grep -Fq 'gatelm/rollback:${run_id}-${service}' "${DEPLOY_SCRIPT}" || \
  fail "Rollback images must be protected by a dedicated Docker tag"
grep -Fq 'cleanup_rollback_tags' "${DEPLOY_SCRIPT}" || \
  fail "Temporary rollback image tags must be cleaned up"
grep -Fq 'bash "${gateway_e5_bundle_script}" "${repo_dir}"' "${DEPLOY_SCRIPT}" || \
  fail "Deployment must prepare the pinned Gateway E5 bundle before image builds"
for required_setting in \
  'dockerfile: infra/docker/gateway-core-e5-runtime.Dockerfile' \
  'difficulty_e5: ../../.tmp/gateway-e5-runtime-bundle' \
  'GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED: "true"' \
  'GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS: ${GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS:-100}' \
  'GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED: "false"'
do
  grep -Fq "${required_setting}" "${COMPOSE_FILE}" || \
    fail "Gateway E5 production Compose setting is missing: ${required_setting}"
done
for pinned_material in \
  '614241f622f53c4eeff9890bdc4f31cfecc418b3' \
  'onnx/model.onnx' \
  'ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665' \
  'a374ca7b87cdafc3c2a4b8b3c7db4a6500803ced02c750351d5fa80f60e94a94' \
  '--network none' \
  '--read-only' \
  '--cap-drop ALL' \
  ':/input/model.onnx:ro' \
  ':/output:rw' \
  'https://github.com/microsoft/onnxruntime/releases/download/v1.22.1/Microsoft.ML.OnnxRuntime.1.22.1.nupkg' \
  'c31e13e0840ca01f8064490a73ae2198979ae3ea48f606171616e2901fe6d3b0' \
  '2ee0ed327f6cf2b860182bc4f2feb905c44a596cd120a05c510da6e4044a3e58' \
  'sha256sum --check difficulty-e5-gateway-image.linux-amd64.v2.sha256'
do
  grep -Fq -- "${pinned_material}" "${E5_BUNDLE_SCRIPT}" || \
    fail "Gateway E5 bundle preparation pin is missing: ${pinned_material}"
done
if grep -Fq '"generated/model.dynamic-qint8-matmul.onnx|' "${E5_BUNDLE_SCRIPT}"; then
  fail "Generated E5 ONNX artifact must not be downloaded from Hugging Face"
fi
if grep -Fq 'https://www.nuget.org/api/v2/package/Microsoft.ML.OnnxRuntime/1.22.1' "${E5_BUNDLE_SCRIPT}"; then
  fail "Production E5 bundle must use the digest-pinned GitHub release asset"
fi
grep -Fq 'python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7' \
  "${E5_QUANTIZER_DOCKERFILE}" || fail "E5 quantizer base image must be digest-pinned"
grep -Fq 'RUN chmod 0444 ./quantize_e5_onnx.py' "${E5_QUANTIZER_DOCKERFILE}" || \
  fail "E5 quantizer script must remain readable under the production checkout umask"
grep -Fq 'onnxruntime==1.22.1' "${E5_QUANTIZER_REQUIREMENTS}" || \
  fail "E5 quantizer ONNX Runtime dependency must be pinned"
grep -Fq 'op_types_to_quantize=["MatMul"]' "${E5_QUANTIZER_SCRIPT}" || \
  fail "E5 quantizer must preserve the pinned MatMul-only profile"
grep -Fq 'TemporaryDirectory(prefix="gatelm-e5-quantize-")' "${E5_QUANTIZER_SCRIPT}" || \
  fail "E5 quantizer must use its writable scratch mount for shape inference"
grep -Fq 'shutil.copyfile(args.source, working_source)' "${E5_QUANTIZER_SCRIPT}" || \
  fail "E5 quantizer must not run shape inference beside the read-only source"
for required_setting in \
  'TENANT_CHAT_PRIVATE_GATEWAY_ENABLED: "true"' \
  'TENANT_CHAT_GATEWAY_BASE_URL: http://gateway-core:8081' \
  'TENANT_CHAT_WORKLOAD_SIGNING_JWK_FILE: /run/secrets/tenant-chat/signing.jwk.json' \
  'TENANT_CHAT_WORKLOAD_JWKS_FILE: /run/secrets/tenant-chat/jwks.json' \
  'TENANT_CHAT_BINDING_HMAC_KEYS_FILE: /run/secrets/tenant-chat/binding-hmac-keys.json' \
  'TENANT_CHAT_CONTENT_KEYS_FILE: /run/secrets/tenant-chat/content-keys.json'
do
  grep -Fq "${required_setting}" "${COMPOSE_FILE}" || \
    fail "Tenant Chat production Compose setting is missing: ${required_setting}"
done
[[ "$(grep -v '^[[:space:]]*#' "${COMPOSE_FILE}" | grep -Fc 'target: /run/secrets/tenant-chat/content-keys.json')" == "1" ]] || \
  fail "Tenant Chat content keys must be mounted only into Chat API"
[[ "$(grep -Fc 'user: "${TENANT_CHAT_RUNTIME_UID:-1000}:${TENANT_CHAT_RUNTIME_GID:-1000}"' "${COMPOSE_FILE}")" == "2" ]] || \
  fail "Gateway and Chat API must run as the Tenant Chat secret owner"
grep -Fq 'http://127.0.0.1:8080/v1/chat/completions' "${DEPLOY_SCRIPT}" || \
  fail "Gateway authentication boundary must be verified through loopback"
grep -Fq 'http://127.0.0.1:3002/api/tenant-chat/auth/session' "${DEPLOY_SCRIPT}" || \
  fail "Tenant Chat authentication boundary must be verified through loopback"
grep -Fq 'Public Web Console is not reachable from this host.' "${DEPLOY_SCRIPT}" || \
  fail "Public reachability failures must remain non-fatal on the target host"
[[ "$(grep -Fc 'rev-parse FETCH_HEAD' "${DEPLOY_SCRIPT}")" == "1" ]] || \
  fail "Target deployment must validate the SHA fetched in the current command"
[[ "$(grep -Fc 'rev-parse FETCH_HEAD' "${SSM_SCRIPT}")" == "1" ]] || \
  fail "SSM bootstrap must validate the SHA fetched in the current command"
[[ "$(grep -Fc 'capture_http_status' "${DEPLOY_SCRIPT}")" == "3" ]] || \
  fail "Authentication probes must use the shared status capture path"
grep -Fq 'status="000"' "${DEPLOY_SCRIPT}" || \
  fail "Empty HTTP status values must be normalized to 000"
# Runtime services are captured once for rollback and checked once after cutover.
# shellcheck disable=SC2016
runtime_service_loops="$(grep -Fc 'for service in "${runtime_services[@]}"; do' "${DEPLOY_SCRIPT}")"
[[ "${runtime_service_loops}" == "2" ]] || \
  fail "Restart and OOM checks must be limited to recreated runtime services"
# The generated remote script must retain these variables for the target shell.
# shellcheck disable=SC2016
grep -Fq 'bash "\${script_path}" "\${deploy_sha}"' "${SSM_SCRIPT}" || \
  fail "SSM bootstrap must invoke the temporary script through bash"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT
fake_bin="${tmp_dir}/bin"
fake_log="${tmp_dir}/aws.log"
mkdir -p "${fake_bin}"

cat > "${fake_bin}/aws" <<'FAKE_AWS'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" >> "${FAKE_AWS_LOG}"

joined=" $* "
if [[ "${joined}" == *" ssm describe-instance-information "* ]]; then
  printf '%s\n' Online
elif [[ "${joined}" == *" ssm send-command "* ]]; then
  printf '%s\n' 00000000-0000-4000-8000-000000000001
elif [[ "${joined}" == *" ssm get-command-invocation "* && "${joined}" == *" StandardOutputContent "* ]]; then
  printf '%s\n' deployment-output
elif [[ "${joined}" == *" ssm get-command-invocation "* && "${joined}" == *" StandardErrorContent "* ]]; then
  printf '%s\n' None
elif [[ "${joined}" == *" ssm get-command-invocation "* ]]; then
  printf '%s\n' Success
elif [[ "${joined}" == *" ssm cancel-command "* ]]; then
  :
else
  printf '%s\n' "Unexpected fake aws invocation: $*" >&2
  exit 1
fi
FAKE_AWS
chmod +x "${fake_bin}/aws"

if ! command -v jq >/dev/null 2>&1; then
  cat > "${fake_bin}/jq" <<'FAKE_JQ'
#!/usr/bin/env bash
set -euo pipefail
[[ "${1:-}" == "-cn" && "${2:-}" == "--arg" && "${3:-}" == "command" ]] || exit 1
printf '%s' "$4" | node -e 'const fs=require("node:fs");const command=fs.readFileSync(0,"utf8");process.stdout.write(JSON.stringify({commands:[command],executionTimeout:["7200"]}))'
FAKE_JQ
  chmod +x "${fake_bin}/jq"
fi

PATH="${fake_bin}:${PATH}" \
FAKE_AWS_LOG="${fake_log}" \
AWS_REGION=ap-northeast-2 \
GATELM_SSM_POLL_INTERVAL_SECONDS=0 \
bash "${SSM_SCRIPT}" \
  i-0123456789abcdef0 \
  0000000000000000000000000000000000000000 \
  https://gatelm.co.kr \
  https://chat.gatelm.co.kr >/dev/null

grep -Fq "AWS-RunShellScript" "${fake_log}" || fail "SSM document was not sent"
node - "${fake_log}" <<'NODE'
const fs = require("node:fs");
const logPath = process.argv[2];
const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/);
const parametersLine = lines.find((line) => line.startsWith('{"commands":'));

if (!parametersLine) {
  throw new Error("SSM parameters JSON was not sent");
}

const parameters = JSON.parse(parametersLine);
const command = parameters.commands?.[0];
const match = command?.match(
  /^printf '%s' '([A-Za-z0-9+/=]+)' \| base64 --decode \| bash$/,
);

if (!match) {
  throw new Error("SSM command is not a POSIX-safe Bash bootstrap");
}

const remoteScript = Buffer.from(match[1], "base64").toString("utf8");
if (!/^set -euo pipefail\r?\n/.test(remoteScript)) {
  throw new Error("Decoded deployment payload is not a Bash script");
}
if (remoteScript.includes('\\"')) {
  throw new Error("Remote Bash arguments contain literal quote characters");
}
if (!remoteScript.includes('git -C "${repo}" fetch --no-tags origin main')) {
  throw new Error("Repository path is not quoted for the remote Bash shell");
}
if (!remoteScript.includes("deploy-main.sh")) {
  throw new Error("Remote bootstrap does not load deploy-main.sh");
}
if (!remoteScript.includes("0000000000000000000000000000000000000000")) {
  throw new Error("Deployment SHA was not sent");
}
NODE

: > "${fake_log}"
PATH="${fake_bin}:${PATH}" \
FAKE_AWS_LOG="${fake_log}" \
AWS_REGION=ap-northeast-2 \
GATELM_SSM_POLL_INTERVAL_SECONDS=0 \
bash "${MAINTENANCE_SSM_SCRIPT}" \
  i-0123456789abcdef0 \
  0000000000000000000000000000000000000000 \
  check >/dev/null

node - "${fake_log}" <<'NODE'
const fs = require("node:fs");
const logPath = process.argv[2];
const line = fs.readFileSync(logPath, "utf8").split(/\r?\n/)
  .find((value) => value.startsWith('{"commands":'));
if (!line) throw new Error("Cache key-set maintenance SSM parameters were not sent");
const command = JSON.parse(line).commands?.[0];
const match = command?.match(/^printf '%s' '([A-Za-z0-9+/=]+)' \| base64 --decode \| bash$/);
if (!match) throw new Error("Cache key-set maintenance payload is not POSIX-safe");
const remoteScript = Buffer.from(match[1], "base64").toString("utf8");
for (const fragment of [
  "action=check",
  "flock -n 9",
  "git -C \"${repo}\" archive",
  "tenant_chat_active_runtime_snapshots",
  "--mode=\"${action}\"",
  "--active-key-set-ids-file=\"${active_ids_file}\"",
]) {
  if (!remoteScript.includes(fragment)) {
    throw new Error(`Cache key-set maintenance payload is missing: ${fragment}`);
  }
}
NODE

printf '%s\n' "[deploy-main-test] all checks passed"
