#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${SCRIPT_DIR}/perf-lib.sh"

K6_IMAGE="grafana/k6:2.0.0@sha256:a33a0cfdc4d2483d6b7a3a22e726a499ff2831a671a49239104cd34a9937523c"
K6_CONTAINER_NAME="gatelm-aws-perf-k6"
K6_NETWORK_NAME="gatelm-aws-perf-internal"
K6_SCRIPT_PATH="${REPO_ROOT}/scripts/perf/k6-gateway-load.js"
K6_REPORT_DIR="${REPO_ROOT}/reports/perf"
K6_TARGET_RPS="${GATELM_K6_TARGET_RPS:-1}"
K6_DURATION="${GATELM_K6_DURATION:-2m}"
K6_DASHBOARD_PORT="${GATELM_K6_DASHBOARD_PORT:-5665}"
K6_DASHBOARD_PERIOD="${GATELM_K6_DASHBOARD_PERIOD:-1s}"

[[ $# -eq 0 ]] || \
  perf_fail "This script accepts environment variables only; positional arguments are not supported."

[[ "${K6_TARGET_RPS}" =~ ^[1-9][0-9]*$ ]] || \
  perf_fail "GATELM_K6_TARGET_RPS must be a positive integer."
[[ "${K6_DURATION}" =~ ^[1-9][0-9]*(ms|s|m|h)$ ]] || \
  perf_fail "GATELM_K6_DURATION must be a positive k6 duration such as 30s or 2m."
[[ "${K6_DASHBOARD_PORT}" =~ ^[0-9]+$ ]] || \
  perf_fail "GATELM_K6_DASHBOARD_PORT must be an integer."
if (( K6_DASHBOARD_PORT < 1024 || K6_DASHBOARD_PORT > 65535 )); then
  perf_fail "GATELM_K6_DASHBOARD_PORT must be between 1024 and 65535."
fi
[[ "${K6_DASHBOARD_PERIOD}" =~ ^[1-9][0-9]*(ms|s|m)$ ]] || \
  perf_fail "GATELM_K6_DASHBOARD_PERIOD must be a positive duration such as 1s."

perf_check_docker
perf_load_env
perf_validate_env
perf_validate_compose

[[ "${AWS_TRIAGE_GATEWAY_PORT}" == "18080" ]] || \
  perf_fail "The k6 runner requires the isolated Mock Gateway on port 18080."
[[ -f "${K6_SCRIPT_PATH}" ]] || \
  perf_fail "k6 script not found: ${K6_SCRIPT_PATH}"

network_project="$(docker network inspect \
  --format '{{index .Labels "com.docker.compose.project"}}' \
  "${K6_NETWORK_NAME}" 2>/dev/null || true)"
[[ "${network_project}" == "${PERF_PROJECT_NAME}" ]] || \
  perf_fail "The isolated Docker network ${K6_NETWORK_NAME} is not ready. Run perf-up.sh first."

if docker container inspect "${K6_CONTAINER_NAME}" >/dev/null 2>&1; then
  perf_fail "Container ${K6_CONTAINER_NAME} already exists. Inspect it before retrying."
fi

bash "${SCRIPT_DIR}/perf-preflight.sh"

umask 077
mkdir -p "${K6_REPORT_DIR}"
run_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
report_name="k6-cache-miss-${run_timestamp}.html"
report_path="${K6_REPORT_DIR}/${report_name}"

perf_log "Starting ${K6_TARGET_RPS} RPS cache-miss load for ${K6_DURATION}."
perf_log "Dashboard: http://127.0.0.1:${K6_DASHBOARD_PORT} (SSH tunnel required)."
perf_log "Close the dashboard browser tab after the test so k6 can export the report."

if ! docker run --rm \
  --name "${K6_CONTAINER_NAME}" \
  --network "${K6_NETWORK_NAME}" \
  --publish "127.0.0.1:${K6_DASHBOARD_PORT}:5665" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --user "$(id -u):$(id -g)" \
  --volume "${REPO_ROOT}:/workspace:ro" \
  --volume "${K6_REPORT_DIR}:/reports:rw" \
  --env GATEWAY_BASE_URL=http://gateway-core:8080 \
  --env GATELM_DEMO_API_KEY \
  --env GATELM_DEMO_APP_TOKEN \
  --env "GATELM_K6_TARGET_RPS=${K6_TARGET_RPS}" \
  --env "GATELM_K6_DURATION=${K6_DURATION}" \
  --env K6_WEB_DASHBOARD=true \
  --env K6_WEB_DASHBOARD_HOST=0.0.0.0 \
  --env K6_WEB_DASHBOARD_PORT=5665 \
  --env "K6_WEB_DASHBOARD_PERIOD=${K6_DASHBOARD_PERIOD}" \
  --env K6_WEB_DASHBOARD_OPEN=false \
  --env "K6_WEB_DASHBOARD_EXPORT=/reports/${report_name}" \
  "${K6_IMAGE}" run /workspace/scripts/perf/k6-gateway-load.js; then
  perf_fail "k6 load execution failed. The normal AWS stack was not targeted."
fi

[[ -f "${report_path}" ]] || \
  perf_fail "k6 completed but the HTML report was not created."

perf_log "k6 load execution passed."
perf_log "HTML report: ${report_path}"
