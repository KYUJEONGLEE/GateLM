#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

bundle_log() {
  printf '%s\n' "[GateLM E5 bundle] $*"
}

bundle_fail() {
  printf '%s\n' "[GateLM E5 bundle] ERROR: $*" >&2
  exit 1
}

need_command() {
  command -v "$1" >/dev/null 2>&1 || bundle_fail "$1 is required."
}

for command_name in awk chmod cp curl diff dirname docker find id mkdir mv rm sha256sum sort stat tar unzip; do
  need_command "${command_name}"
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
repo_dir="${1:-$(cd "${script_dir}/../../.." && pwd -P)}"
repo_dir="$(cd "${repo_dir}" && pwd -P)"
temporary_root="${repo_dir}/.tmp"
download_root="${temporary_root}/gateway-e5-runtime-downloads"
output_dir="${temporary_root}/gateway-e5-runtime-bundle"
staging_dir="${temporary_root}/gateway-e5-runtime-bundle.partial.$$"

manifest_source="${repo_dir}/scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v2.json"
runtime_lock_source="${repo_dir}/scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json"
checksums_source="${repo_dir}/scripts/routing_difficulty_model/artifacts/difficulty-e5-gateway-image.linux-amd64.v2.sha256"
quantizer_dockerfile="${repo_dir}/infra/docker/e5-artifact-quantizer.Dockerfile"
quantizer_image="gatelm/e5-artifact-quantizer:onnxruntime-1.22.1"
model_revision="614241f622f53c4eeff9890bdc4f31cfecc418b3"
model_directory="multilingual-e5-small/${model_revision}"
model_url="https://huggingface.co/intfloat/multilingual-e5-small/resolve/${model_revision}"
source_onnx_relative_path="onnx/model.onnx"
source_onnx_size="470268510"
source_onnx_sha="ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665"
quantized_onnx_relative_path="generated/model.dynamic-qint8-matmul.onnx"
quantized_onnx_size="406734568"
quantized_onnx_sha="a374ca7b87cdafc3c2a4b8b3c7db4a6500803ced02c750351d5fa80f60e94a94"

assert_file() {
  local path="$1"
  local expected_size="$2"
  local expected_sha="$3"
  local actual_size actual_sha

  [[ -f "${path}" && ! -L "${path}" ]] || bundle_fail "Pinned artifact is missing or is not a regular file: ${path}"
  actual_size="$(stat -c '%s' "${path}")"
  [[ "${actual_size}" == "${expected_size}" ]] || \
    bundle_fail "Pinned artifact size mismatch: ${path}"
  actual_sha="$(sha256sum "${path}" | awk '{print $1}')"
  [[ "${actual_sha}" == "${expected_sha}" ]] || \
    bundle_fail "Pinned artifact checksum mismatch: ${path}"
}

ensure_directory() {
  local path="$1"
  local parent

  [[ -d "${path}" && ! -L "${path}" ]] && return
  [[ ! -e "${path}" ]] || bundle_fail "Directory path is not a regular directory: ${path}"
  parent="$(dirname "${path}")"
  [[ "${parent}" != "${path}" ]] || bundle_fail "Could not create directory: ${path}"
  ensure_directory "${parent}"
  mkdir -- "${path}"
  chmod 700 "${path}"
}

ensure_download() {
  local path="$1"
  local url="$2"
  local expected_size="$3"
  local expected_sha="$4"
  local partial_path="${path}.partial.$$"

  if [[ -f "${path}" ]]; then
    assert_file "${path}" "${expected_size}" "${expected_sha}"
    return
  fi

  ensure_directory "$(dirname "${path}")"
  rm -f -- "${partial_path}"
  bundle_log "Downloading pinned artifact: $(basename "${path}")"
  if ! curl \
    --fail \
    --location \
    --retry 3 \
    --retry-all-errors \
    --connect-timeout 15 \
    --max-time 1800 \
    --output "${partial_path}" \
    "${url}"; then
    rm -f -- "${partial_path}"
    bundle_fail "Pinned artifact download failed: ${url}"
  fi
  assert_file "${partial_path}" "${expected_size}" "${expected_sha}"
  mv -- "${partial_path}" "${path}"
}

copy_verified() {
  local source="$1"
  local destination="$2"
  local expected_size="$3"
  local expected_sha="$4"

  assert_file "${source}" "${expected_size}" "${expected_sha}"
  ensure_directory "$(dirname "${destination}")"
  cp -- "${source}" "${destination}"
  chmod 600 "${destination}"
}

ensure_quantized_model() {
  local model_root="$1"
  local source_path="${model_root}/${source_onnx_relative_path}"
  local output_path="${model_root}/${quantized_onnx_relative_path}"
  local output_filename="${quantized_onnx_relative_path##*/}"
  local scratch_path="${model_root}/.quantizer-tmp.$$"

  if [[ -f "${output_path}" ]]; then
    assert_file "${output_path}" "${quantized_onnx_size}" "${quantized_onnx_sha}"
    return
  fi

  [[ -f "${quantizer_dockerfile}" && ! -L "${quantizer_dockerfile}" ]] || \
    bundle_fail "Pinned E5 quantizer Dockerfile is missing: ${quantizer_dockerfile}"
  assert_file "${source_path}" "${source_onnx_size}" "${source_onnx_sha}"
  docker info >/dev/null 2>&1 || bundle_fail "Docker daemon is not reachable."
  ensure_directory "$(dirname "${output_path}")"

  bundle_log "Building pinned E5 ONNX quantizer"
  docker build \
    --platform linux/amd64 \
    --file "${quantizer_dockerfile}" \
    --tag "${quantizer_image}" \
    "${repo_dir}"

  [[ ! -e "${scratch_path}" ]] || bundle_fail "E5 quantizer scratch path already exists: ${scratch_path}"
  ensure_directory "${scratch_path}"
  bundle_log "Generating pinned E5 QInt8 ONNX artifact"
  if ! docker run \
    --rm \
    --platform linux/amd64 \
    --network none \
    --read-only \
    --cap-drop ALL \
    --security-opt no-new-privileges \
    --user "$(id -u):$(id -g)" \
    --volume "${source_path}:/input/model.onnx:ro" \
    --volume "$(dirname "${output_path}"):/output:rw" \
    --volume "${scratch_path}:/tmp:rw" \
    "${quantizer_image}" \
    --source "/input/model.onnx" \
    --source-size "${source_onnx_size}" \
    --source-sha256 "${source_onnx_sha}" \
    --output "/output/${output_filename}" \
    --output-size "${quantized_onnx_size}" \
    --output-sha256 "${quantized_onnx_sha}"; then
    rm -rf -- "${scratch_path}"
    bundle_fail "Pinned E5 ONNX quantization failed."
  fi
  rm -rf -- "${scratch_path}"

  assert_file "${output_path}" "${quantized_onnx_size}" "${quantized_onnx_sha}"
}

cleanup_staging() {
  [[ -d "${staging_dir}" ]] && rm -rf -- "${staging_dir}"
}
trap cleanup_staging EXIT

[[ -d "${repo_dir}/.git" ]] || bundle_fail "Git repository not found: ${repo_dir}"
ensure_directory "${temporary_root}"
ensure_directory "${download_root}"

assert_file "${manifest_source}" 4915 "94c4cdf6cc6caf9d9a640f56b88219a94956750152d14ac4ef21b52140766380"
assert_file "${runtime_lock_source}" 1364 "90395b13aa6c5a5ba33241e7cf627c0353a17141434c7ced3a42421cb8a2fd73"
assert_file "${checksums_source}" 1625 "5e53d4349dfb4b62587a8342f31054e00475cf28c1518fc2ed22dce2372abeb7"

declare -a model_artifacts=(
  "config.json|655|69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959"
  "sentence_bert_config.json|57|948201d8329907aae938fa62f9ceeed53f5694dacc2b87b9f3b78b37ee986529"
  "1_Pooling/config.json|200|987f7a67a38fa564c849bb5d277c52ab9088a84368fc0be31a354125aebb12a0"
  "special_tokens_map.json|167|d05497f1da52c5e09554c0cd874037a083e1dc1b9cfd48034d1c717f1afc07a7"
  "tokenizer.json|17082730|0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39"
  "tokenizer_config.json|443|a1d6bc8734a6f635dc158508bef000f8e2e5a759c7d92f984b2c86e5ff53425b"
  "sentencepiece.bpe.model|5069051|cfc8146abe2a0488e9e2a0c56de7952f7c11ab059eca145a0a727afce0db2865"
)

rm -rf -- "${staging_dir}"
ensure_directory "${staging_dir}/${model_directory}"
ensure_directory "${staging_dir}/native"

for artifact in "${model_artifacts[@]}"; do
  IFS='|' read -r relative_path expected_size expected_sha <<<"${artifact}"
  cached_path="${download_root}/${model_directory}/${relative_path}"
  ensure_download \
    "${cached_path}" \
    "${model_url}/${relative_path}?download=true" \
    "${expected_size}" \
    "${expected_sha}"
  copy_verified \
    "${cached_path}" \
    "${staging_dir}/${model_directory}/${relative_path}" \
    "${expected_size}" \
    "${expected_sha}"
done

model_cache_root="${download_root}/${model_directory}"
source_onnx_path="${model_cache_root}/${source_onnx_relative_path}"
ensure_download \
  "${source_onnx_path}" \
  "${model_url}/${source_onnx_relative_path}?download=true" \
  "${source_onnx_size}" \
  "${source_onnx_sha}"
ensure_quantized_model "${model_cache_root}"
copy_verified \
  "${model_cache_root}/${quantized_onnx_relative_path}" \
  "${staging_dir}/${model_directory}/${quantized_onnx_relative_path}" \
  "${quantized_onnx_size}" \
  "${quantized_onnx_sha}"

tokenizer_archive="${download_root}/libtokenizers.linux-amd64.tar.gz"
ensure_download \
  "${tokenizer_archive}" \
  "https://github.com/daulet/tokenizers/releases/download/v1.23.0/libtokenizers.linux-amd64.tar.gz" \
  14300699 \
  "c31e13e0840ca01f8064490a73ae2198979ae3ea48f606171616e2901fe6d3b0"
tar -xzf "${tokenizer_archive}" -C "${staging_dir}/native" libtokenizers.a
assert_file \
  "${staging_dir}/native/libtokenizers.a" \
  50013964 \
  "0b968ecbb84eb12a02c9cd51fd80d2b57a6f3fec0f78090d1fe8f347e6cc6845"

onnx_package="${download_root}/Microsoft.ML.OnnxRuntime.1.22.1.nupkg"
ensure_download \
  "${onnx_package}" \
  "https://www.nuget.org/api/v2/package/Microsoft.ML.OnnxRuntime/1.22.1" \
  121484102 \
  "2ee0ed327f6cf2b860182bc4f2feb905c44a596cd120a05c510da6e4044a3e58"
unzip -p \
  "${onnx_package}" \
  runtimes/linux-x64/native/libonnxruntime.so \
  > "${staging_dir}/native/libonnxruntime.so"
assert_file \
  "${staging_dir}/native/libonnxruntime.so" \
  21087472 \
  "3907398e408dae083deb3439e8f643d9e26180ed614b29cc7d5ec342ce5ce06f"

cp -- "${manifest_source}" "${staging_dir}/difficulty-e5-encoder-manifest.v2.json"
cp -- "${runtime_lock_source}" "${staging_dir}/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json"
cp -- "${checksums_source}" "${staging_dir}/difficulty-e5-gateway-image.linux-amd64.v2.sha256"
chmod 600 \
  "${staging_dir}/difficulty-e5-encoder-manifest.v2.json" \
  "${staging_dir}/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json" \
  "${staging_dir}/difficulty-e5-gateway-image.linux-amd64.v2.sha256"

(
  cd "${staging_dir}"
  find . -type f ! -name .actual-files ! -name .expected-files -printf '%P\n' | sort > .actual-files
  awk '{print $2}' difficulty-e5-gateway-image.linux-amd64.v2.sha256 \
    | { cat; printf '%s\n' difficulty-e5-gateway-image.linux-amd64.v2.sha256; } \
    | sort > .expected-files
  diff -u .expected-files .actual-files
  rm -f -- .actual-files .expected-files
  [[ -z "$(find . -type l -print -quit)" ]] || bundle_fail "Runtime bundle must not contain symlinks"
  sha256sum --check difficulty-e5-gateway-image.linux-amd64.v2.sha256
)

if [[ -e "${output_dir}" ]]; then
  [[ -d "${output_dir}" && ! -L "${output_dir}" ]] || \
    bundle_fail "Refusing to replace non-directory runtime bundle output"
  rm -rf -- "${output_dir}"
fi
mv -- "${staging_dir}" "${output_dir}"
trap - EXIT

bundle_log "Prepared verified Gateway E5 runtime bundle: ${output_dir}"
