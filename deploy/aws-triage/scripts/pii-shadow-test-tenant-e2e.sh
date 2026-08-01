#!/usr/bin/env bash

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
# shellcheck source=deploy/aws-triage/scripts/production-distributed-lib.sh
source "${SCRIPT_DIR}/production-distributed-lib.sh"

EXPECTED_MODEL_SHA256="8a5cb146e84d413910a423d304e662a6aba9f69e83db129f5061d007a6de9381"
MODEL_CONTAINER_DIR="/models/gatelm--koelectra-small-v3-pii-ner-quantized"
REPORT_CONTAINER_PATH="/evidence/report.json"

fail() {
  printf '%s\n' "PII Shadow test-tenant E2E failed safely." >&2
  exit 1
}

for command_name in awk cat date docker git id mkdir mktemp rm sha256sum; do
  command -v "${command_name}" >/dev/null 2>&1 || fail
done

production_load_env
production_validate_env
production_assert_role_host pii
production_assert_pii_model_artifact

source_dir="${GATELM_PII_SHADOW_VALIDATION_SOURCE_DIR:-${ROOT_DIR}}"
expected_source_sha="${GATELM_PII_SHADOW_VALIDATION_GIT_SHA:-}"
test_tenant_id="${GATELM_PII_SHADOW_TEST_TENANT_ID:-${GATELM_DEMO_TENANT_ID:-}}"

[[ "${expected_source_sha}" =~ ^[a-f0-9]{40}$ ]] || fail
[[ "${test_tenant_id}" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$ ]] || fail
[[ -d "${source_dir}/.git" || -f "${source_dir}/.git" ]] || fail

actual_source_sha="$(git -c safe.directory="${source_dir}" -C "${source_dir}" rev-parse HEAD 2>/dev/null)"
[[ "${actual_source_sha}" == "${expected_source_sha}" ]] || fail
[[ -z "$(git -c safe.directory="${source_dir}" -C "${source_dir}" status --porcelain --untracked-files=all 2>/dev/null)" ]] || fail

current_hour="$(TZ=Asia/Seoul date +%H)"
case "${current_hour}" in
  02|03|04) ;;
  *) fail ;;
esac

model_dir="${GATELM_PRODUCTION_DISTRIBUTED_PII_MODEL_DIR}"
observed_model_sha="$(sha256sum "${model_dir}/model.onnx" | awk '{print $1}')"
[[ "${observed_model_sha}" == "${EXPECTED_MODEL_SHA256}" ]] || fail

scratch_dir="$(mktemp -d)"
validation_image="gatelm/pii-shadow-e2e-validation:${expected_source_sha:0:12}"
cleanup() {
  docker image rm --force "${validation_image}" >/dev/null 2>&1 || true
  rm -rf -- "${scratch_dir}"
}
trap cleanup EXIT

if ! docker build \
  --quiet \
  --build-arg AI_SERVICE_INSTALL_ML_DEPS=true \
  --build-arg AI_SERVICE_ML_EXTRA=pii \
  --file "${source_dir}/infra/docker/ai-service.Dockerfile" \
  --tag "${validation_image}" \
  "${source_dir}" \
  >"${scratch_dir}/ai-image-build.log" 2>&1; then
  fail
fi

mkdir -p "${scratch_dir}/client" "${scratch_dir}/evidence"
if ! docker build \
  --quiet \
  --file "${source_dir}/infra/docker/pii-shadow-e2e-client.Dockerfile" \
  --output "type=local,dest=${scratch_dir}/client" \
  "${source_dir}" \
  >"${scratch_dir}/gateway-client-build.log" 2>&1; then
  fail
fi
[[ -x "${scratch_dir}/client/pii-shadow-e2e-client" ]] || fail

export PII_SHADOW_TEST_TENANT_ID="${test_tenant_id}"
if ! docker run \
  --rm \
  --network none \
  --read-only \
  --cpus 4 \
  --memory 4g \
  --pids-limit 128 \
  --user "$(id -u):$(id -g)" \
  --tmpfs /tmp:rw,nosuid,nodev,size=256m \
  --env HOME=/tmp \
  --env XDG_CACHE_HOME=/tmp/cache \
  --env TRANSFORMERS_OFFLINE=1 \
  --env HF_HUB_OFFLINE=1 \
  --env PII_SHADOW_TEST_TENANT_ID \
  --mount "type=bind,src=${source_dir},dst=/workspace,readonly" \
  --mount "type=bind,src=${model_dir},dst=${MODEL_CONTAINER_DIR},readonly" \
  --mount "type=bind,src=${scratch_dir}/client/pii-shadow-e2e-client,dst=/usr/local/bin/pii-shadow-e2e-client,readonly" \
  --mount "type=bind,src=${scratch_dir}/evidence,dst=/evidence" \
  --workdir /workspace/apps/ai-service \
  --entrypoint python3 \
  "${validation_image}" \
  -m app.services.pii_shadow_e2e_runner \
  --model-dir "${MODEL_CONTAINER_DIR}" \
  --model-version v0.1.1 \
  --requests 1000 \
  --sample-basis-points 500 \
  --corpus /workspace/docs/ai-safety-lab/fixtures/resource-latency-benchmark-corpus.jsonl \
  --out "${REPORT_CONTAINER_PATH}" \
  --git-sha "${expected_source_sha}" \
  --gateway-client-binary /usr/local/bin/pii-shadow-e2e-client \
  --execution-context aws_test_tenant_host \
  --respect-night-window \
  --verified-clean-source \
  >"${scratch_dir}/validation.log" 2>&1; then
  fail
fi

[[ -s "${scratch_dir}/evidence/report.json" ]] || fail
cat "${scratch_dir}/evidence/report.json"
