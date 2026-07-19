#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/prod-clone-lib.sh
source "${SCRIPT_DIR}/prod-clone-lib.sh"

replace=false
if (( $# == 1 )); then
  [[ "$1" == "--replace" ]] || clone_fail "Usage: bash scripts/prod-clone-export-loadgen-env.sh [--replace]"
  replace=true
elif (( $# > 1 )); then
  clone_fail "Usage: bash scripts/prod-clone-export-loadgen-env.sh [--replace]"
fi

output_path="${GATELM_LOADGEN_ENV_FILE:-${AWS_TRIAGE_DIR}/.env.loadgen}"
[[ "$(dirname "${output_path}")" == "${AWS_TRIAGE_DIR}" ]] || \
  clone_fail "The production-clone load-generator environment must stay in ${AWS_TRIAGE_DIR}."
[[ "$(basename "${output_path}")" == ".env.loadgen" ]] || \
  clone_fail "The production-clone load-generator environment must be named .env.loadgen."

clone_load_env
clone_validate_env
clone_assert_role_host loadgen
clone_require_env GATELM_DEMO_API_KEY GATELM_DEMO_APP_TOKEN

gateway_count="${GATELM_PROD_CLONE_GATEWAY_COUNT:-1}"
case "${gateway_count}" in 1|2) ;; *) clone_fail "GATELM_PROD_CLONE_GATEWAY_COUNT must be 1 or 2." ;; esac

if [[ -e "${output_path}" ]]; then
  [[ "${replace}" == "true" ]] || clone_fail "${output_path} already exists and was not overwritten."
  [[ -f "${output_path}" && ! -L "${output_path}" ]] || \
    clone_fail "The existing load-generator environment is not a regular file."
  perf_assert_env_file_permissions "${output_path}" "Production-clone load-generator environment"
fi

umask 077
temporary_path="$(mktemp "${AWS_TRIAGE_DIR}/.env.loadgen.tmp.XXXXXX")"
trap 'rm -f "${temporary_path}"' EXIT
metrics_urls="http://${GATELM_PROD_CLONE_GATEWAY_1_PRIVATE_IP}:8080"
expected_upstreams="${GATELM_PROD_CLONE_GATEWAY_1_PRIVATE_IP}:8080"
if [[ "${gateway_count}" == "2" ]]; then
  metrics_urls+=",http://${GATELM_PROD_CLONE_GATEWAY_2_PRIVATE_IP}:8080"
  expected_upstreams+=",${GATELM_PROD_CLONE_GATEWAY_2_PRIVATE_IP}:8080"
fi
printf '%s\n' \
  "GATELM_LOADGEN_GATEWAY_BASE_URL=https://${GATELM_PUBLIC_DOMAIN}" \
  "GATELM_LOADGEN_EDGE_PRIVATE_IP=${GATELM_PROD_CLONE_EDGE_PRIVATE_IP}" \
  "GATELM_LOADGEN_GATEWAY_METRICS_BASE_URLS=${metrics_urls}" \
  "GATELM_LOADGEN_GATEWAY_COUNT=${gateway_count}" \
  "GATELM_LOADGEN_EXPECTED_UPSTREAMS=${expected_upstreams}" \
  "GATELM_LOADGEN_TLS_INSECURE=true" \
  "GATELM_PERF_TOPOLOGY_ID=prod_clone_${GATELM_PROD_CLONE_IMAGE_TAG}_gateway_${gateway_count}_${GATELM_PROD_CLONE_MOCK_LATENCY_PROFILE}" \
  "GATELM_DEMO_API_KEY=${GATELM_DEMO_API_KEY}" \
  "GATELM_DEMO_APP_TOKEN=${GATELM_DEMO_APP_TOKEN}" \
  > "${temporary_path}"
chmod 600 "${temporary_path}"
mv -f "${temporary_path}" "${output_path}"
trap - EXIT

clone_log "Created restricted load-generator environment for gateway_count=${gateway_count}, profile=${GATELM_PROD_CLONE_MOCK_LATENCY_PROFILE}."
clone_log "Only the isolated Edge target, Gateway metrics endpoints, topology ID, and synthetic credentials were written."
