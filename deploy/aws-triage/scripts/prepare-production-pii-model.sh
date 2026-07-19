#!/usr/bin/env bash

set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/production-distributed-lib.sh
source "${SCRIPT_DIR}/production-distributed-lib.sh"

production_load_env
production_validate_env
production_assert_role_host pii

for command_name in aws awk chmod dirname find gzip install mktemp mv rm sha256sum tar; do
  command -v "${command_name}" >/dev/null 2>&1 || production_fail "${command_name} is required to prepare the PII model."
done

model_dir="${GATELM_PRODUCTION_DISTRIBUTED_PII_MODEL_DIR}"
artifact_uri="${GATELM_PRODUCTION_DISTRIBUTED_PII_ARTIFACT_S3_URI}"
expected_archive_sha="${GATELM_PRODUCTION_DISTRIBUTED_PII_ARTIFACT_SHA256}"
manifest="${PRODUCTION_DISTRIBUTED_PII_MANIFEST}"
model_parent="$(dirname "${model_dir}")"

if [[ -d "${model_dir}" && ! -L "${model_dir}" ]]; then
  production_assert_pii_model_artifact
  production_log "Verified existing PII model artifact at ${model_dir}."
  exit 0
fi
[[ ! -e "${model_dir}" ]] || production_fail "PII model target exists but is not a safe directory: ${model_dir}"

install -d -m 0755 "${model_parent}"
scratch_dir="$(mktemp -d "${model_parent}/.pii-model.XXXXXX")"
archive="${scratch_dir}/model.tar.gz"
extract_dir="${scratch_dir}/model"
cleanup() {
  rm -rf -- "${scratch_dir}"
}
trap cleanup EXIT

production_log "Downloading the immutable PII model artifact from private S3."
aws s3 cp --only-show-errors "${artifact_uri}" "${archive}"
[[ -s "${archive}" && ! -L "${archive}" ]] || production_fail "Downloaded PII artifact is empty or unsafe."
observed_archive_sha="$(sha256sum "${archive}" | awk '{print $1}')"
[[ "${observed_archive_sha}" == "${expected_archive_sha}" ]] || production_fail "PII model archive checksum mismatch."

while IFS= read -r entry; do
  [[ -n "${entry}" ]] || continue
  case "${entry}" in
    .|./|./config.json|./export-report.json|./model.onnx|./special_tokens_map.json|./tokenizer.json|./tokenizer_config.json|./vocab.txt) ;;
    *) production_fail "PII model archive contains an unexpected path." ;;
  esac
done < <(tar -tzf "${archive}")

install -d -m 0755 "${extract_dir}"
tar --extract --gzip --file "${archive}" --directory "${extract_dir}" --no-same-owner --no-same-permissions
(
  cd "${extract_dir}"
  sha256sum --check "${manifest}" >/dev/null
)
find "${extract_dir}" -type f -exec chmod 0444 {} +
chmod 0555 "${extract_dir}"
mv -- "${extract_dir}" "${model_dir}"
production_assert_pii_model_artifact
production_log "Installed and verified the PII model artifact."
