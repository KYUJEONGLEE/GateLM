#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${SCRIPT_DIR}/perf-lib.sh"

LOADGEN_ENV_FILE="${GATELM_LOADGEN_ENV_FILE:-${AWS_TRIAGE_DIR}/.env.loadgen}"
[[ -f "${LOADGEN_ENV_FILE}" ]] || perf_fail ".env.loadgen was not found."
PERF_ENV_FILE="${LOADGEN_ENV_FILE}"
export PERF_ENV_FILE
perf_load_env
perf_assert_env_file_permissions "${LOADGEN_ENV_FILE}" ".env.loadgen"
perf_require_env_vars \
  GATELM_LOADGEN_GATEWAY_BASE_URL \
  GATELM_PERF_TOPOLOGY_ID \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN
[[ "${GATELM_PERF_TOPOLOGY_ID}" =~ ^[a-f0-9]{24}$ ]] || \
  perf_fail "GATELM_PERF_TOPOLOGY_ID must be a 24-character lowercase hex identifier."

gateway_url="${GATELM_LOADGEN_GATEWAY_BASE_URL%/}"
[[ "${gateway_url}" =~ ^http://([0-9]{1,3}(\.[0-9]{1,3}){3}):18080$ ]] || \
  perf_fail "Load-generator target must be an RFC1918 private IPv4 address on port 18080."
gateway_ip="${BASH_REMATCH[1]}"
perf_is_private_ipv4 "${gateway_ip}" || perf_fail "Load-generator target is not an RFC1918 private IPv4 address."
gateway_prefix="${gateway_ip%.*}."

actual_sha="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
[[ "${actual_sha}" =~ ^[a-f0-9]{40}$ ]] || perf_fail "Could not resolve a full Git SHA."
git -C "${REPO_ROOT}" diff --quiet || perf_fail "Tracked changes prevent exact load-generator SHA evidence."
git -C "${REPO_ROOT}" diff --cached --quiet || perf_fail "Staged changes prevent exact load-generator SHA evidence."
curl -fsS --max-time 5 "${gateway_url}/readyz" >/dev/null || perf_fail "Gateway readiness failed from load generator."

loadgen_private_ip=""
for candidate_ip in $(hostname -I 2>/dev/null || true); do
  if [[ "${candidate_ip}" == "${gateway_prefix}"* ]] && perf_is_private_ipv4 "${candidate_ip}"; then
    loadgen_private_ip="${candidate_ip}"
    break
  fi
done
[[ -n "${loadgen_private_ip}" ]] || \
  perf_fail "Could not identify the load-generator private IP in the Gateway subnet."

attestation_dir="${GATELM_PERF_DISTRIBUTED_ATTESTATION_DIR:-${REPO_ROOT}/reports/perf/distributed-attestations}"
attestation_path="${attestation_dir}/loadgen.attestation.env"
machine_hash="$(perf_machine_identity_hash "topology_${GATELM_PERF_TOPOLOGY_ID}")"
umask 077
mkdir -p "${attestation_dir}"
chmod 700 "${attestation_dir}"
printf '%s\n' \
  'GATELM_PERF_ATTESTATION_SCHEMA=gatelm.perf-distributed-attestation.v1' \
  'GATELM_PERF_ATTESTATION_ROLE=loadgen' \
  "GATELM_PERF_ATTESTATION_TOPOLOGY_ID=${GATELM_PERF_TOPOLOGY_ID}" \
  "GATELM_PERF_ATTESTATION_GIT_SHA=${actual_sha}" \
  "GATELM_PERF_ATTESTATION_PRIVATE_IP=${loadgen_private_ip}" \
  "GATELM_PERF_ATTESTATION_MACHINE_HASH=${machine_hash}" \
  > "${attestation_path}"
chmod 600 "${attestation_path}"
perf_log "Wrote safe load-generator topology attestation: ${attestation_path}"
perf_log "Load-generator preflight passed for private Gateway ${gateway_ip}:18080 at Git SHA ${actual_sha}."
