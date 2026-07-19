#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${SCRIPT_DIR}/perf-lib.sh"
# shellcheck source=deploy/aws-triage/scripts/perf-evidence-lib.sh
source "${SCRIPT_DIR}/perf-evidence-lib.sh"

K6_IMAGE="grafana/k6:2.0.0@sha256:a33a0cfdc4d2483d6b7a3a22e726a499ff2831a671a49239104cd34a9937523c"
K6_SCRIPT_PATH="${REPO_ROOT}/scripts/perf/k6-gateway-load.js"
LOADGEN_ENV_FILE="${GATELM_LOADGEN_ENV_FILE:-${AWS_TRIAGE_DIR}/.env.loadgen}"
LOADGEN_REPORT_ROOT="${REPO_ROOT}/reports/perf/loadgen"
LOADGEN_EXECUTION_MODE="${GATELM_LOADGEN_EXECUTION_MODE:-dedicated}"
K6_TARGET_RPS="${GATELM_K6_TARGET_RPS:-500}"
K6_DURATION="${GATELM_K6_DURATION:-2m}"
K6_PRE_ALLOCATED_VUS="${GATELM_K6_PRE_ALLOCATED_VUS:-}"
K6_MAX_VUS="${GATELM_K6_MAX_VUS:-}"
K6_DASHBOARD_PERIOD="${GATELM_K6_DASHBOARD_PERIOD:-1s}"
LOG_DRAIN_TIMEOUT_SECONDS="${GATELM_PERF_LOG_DRAIN_TIMEOUT_SECONDS:-60}"

loadgen_failures_json() {
  local json=""
  local failure
  for failure in "$@"; do
    [[ -z "${json}" ]] || json+=", "
    json+="\"${failure}\""
  done
  printf '%s' "${json}"
}

loadgen_validate_env_file_keys() {
  local line key

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%$'\r'}"
    line="$(perf_trim "${line}")"
    [[ -z "${line}" || "${line}" == \#* ]] && continue
    [[ "${line}" == *=* ]] || \
      perf_fail ".env.loadgen contains a malformed line."
    key="$(perf_trim "${line%%=*}")"
    case "${key}" in
      GATELM_LOADGEN_GATEWAY_BASE_URL|GATELM_LOADGEN_EDGE_PRIVATE_IP|GATELM_LOADGEN_GATEWAY_METRICS_BASE_URLS|GATELM_LOADGEN_GATEWAY_COUNT|GATELM_LOADGEN_EXPECTED_UPSTREAMS|GATELM_LOADGEN_TLS_INSECURE|GATELM_PERF_TOPOLOGY_ID|GATELM_DEMO_API_KEY|GATELM_DEMO_APP_TOKEN) ;;
      *) perf_fail ".env.loadgen contains a forbidden key: ${key}" ;;
    esac
  done < "${LOADGEN_ENV_FILE}"
}

loadgen_is_hostname() {
  local hostname="$1"
  local label
  local -a labels=()

  (( ${#hostname} > 0 && ${#hostname} <= 253 )) || return 1
  [[ "${hostname}" != .* && "${hostname}" != *. ]] || return 1
  IFS='.' read -r -a labels <<< "${hostname}"
  for label in "${labels[@]}"; do
    (( ${#label} > 0 && ${#label} <= 63 )) || return 1
    [[ "${label}" =~ ^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$ ]] || return 1
  done
}

loadgen_validate_port() {
  local port="$1"
  [[ -z "${port}" ]] && return 0
  [[ "${port}" =~ ^[0-9]{1,5}$ ]] || return 1
  (( 10#${port} >= 1 && 10#${port} <= 65535 ))
}

loadgen_validate_dedicated_base_url() {
  local base_url="$1"
  local host port

  if [[ "${base_url}" =~ ^https://([^/:?#]+)(:([0-9]{1,5}))?$ ]]; then
    host="${BASH_REMATCH[1]}"
    port="${BASH_REMATCH[3]}"
    if ! loadgen_is_hostname "${host}" || ! loadgen_validate_port "${port}"; then
      perf_fail "The HTTPS load target must contain only a valid hostname and optional port."
    fi
    return
  fi

  if [[ "${base_url}" =~ ^http://([0-9]{1,3}(\.[0-9]{1,3}){3})(:([0-9]{1,5}))?$ ]]; then
    host="${BASH_REMATCH[1]}"
    port="${BASH_REMATCH[4]}"
    if ! perf_is_private_ipv4 "${host}" || ! loadgen_validate_port "${port}"; then
      perf_fail "Plain HTTP load targets must use an exact RFC1918 private IPv4 address and optional port."
    fi
    return
  fi

  perf_fail "The dedicated load target must be HTTPS or an HTTP RFC1918 private IPv4 endpoint without a path, query, or credentials."
}

[[ $# -eq 0 ]] || \
  perf_fail "This script accepts environment variables only; positional arguments are not supported."
[[ -f "${LOADGEN_ENV_FILE}" ]] || \
  perf_fail ".env.loadgen was not found. Copy loadgen.env.example and set only the isolated performance credentials."

loadgen_validate_env_file_keys
PERF_ENV_FILE="${LOADGEN_ENV_FILE}"
export PERF_ENV_FILE
perf_load_env
perf_assert_env_file_permissions "${LOADGEN_ENV_FILE}" ".env.loadgen"
perf_require_env_vars \
  GATELM_LOADGEN_GATEWAY_BASE_URL \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN

loadgen_validate_metrics_urls() {
  local raw_urls="$1"
  local expected_count="$2"
  local metrics_url host port
  local -a parsed_urls=()

  IFS=',' read -r -a parsed_urls <<< "${raw_urls}"
  (( ${#parsed_urls[@]} == expected_count )) || \
    perf_fail "Gateway metrics endpoint count must match GATELM_LOADGEN_GATEWAY_COUNT."
  for metrics_url in "${parsed_urls[@]}"; do
    [[ "${metrics_url}" =~ ^http://([0-9]{1,3}(\.[0-9]{1,3}){3})(:([0-9]{1,5}))?$ ]] || \
      perf_fail "Gateway metrics endpoints must be exact private HTTP IPv4 URLs."
    host="${BASH_REMATCH[1]}"
    port="${BASH_REMATCH[4]}"
    perf_is_private_ipv4 "${host}" || \
      perf_fail "Gateway metrics endpoints must use RFC1918 IPv4 addresses."
    loadgen_validate_port "${port}" || \
      perf_fail "Gateway metrics endpoint contains an invalid port."
  done
}

for value in "${GATELM_DEMO_API_KEY}" "${GATELM_DEMO_APP_TOKEN}"; do
  [[ "${value}" != *"replace-me"* ]] || \
    perf_fail ".env.loadgen still contains placeholder credentials."
done

for name in \
  OPENAI_API_KEY \
  CONTROL_PLANE_PROVIDER_CREDENTIAL_ENV_MAP \
  GATEWAY_PROVIDER_CREDENTIAL_ENV_MAP \
  GATELM_PROVIDER_CREDENTIAL_ENCRYPTION_KEY \
  POSTGRES_PASSWORD \
  CONTROL_PLANE_AUTH_STATE_SECRET \
  CONTROL_PLANE_INTERNAL_SERVICE_TOKEN \
  TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN \
  TENANT_CHAT_WEB_SERVICE_TOKEN \
  TENANT_CHAT_ACCESS_JWT_SECRET \
  TENANT_CHAT_INTENT_SECRET \
  GATEWAY_CONTROL_PLANE_INTERNAL_TOKEN \
  GATEWAY_OBSERVABILITY_INTERNAL_TOKEN \
  GATEWAY_EXACT_CACHE_KEY_SECRET; do
  [[ -z "${!name-}" ]] || \
    perf_fail "${name} must not be present on the load-generator process."
done

[[ "${K6_TARGET_RPS}" =~ ^[1-9][0-9]*$ ]] || \
  perf_fail "GATELM_K6_TARGET_RPS must be a positive integer."
(( ${#K6_TARGET_RPS} <= 6 && 10#${K6_TARGET_RPS} <= 100000 )) || \
  perf_fail "GATELM_K6_TARGET_RPS cannot exceed 100000."
[[ "${K6_DURATION}" =~ ^[1-9][0-9]{0,7}(ms|s|m|h)$ ]] || \
  perf_fail "GATELM_K6_DURATION must be a positive k6 duration such as 30s or 2m."
K6_PRE_ALLOCATED_VUS="${K6_PRE_ALLOCATED_VUS:-${K6_TARGET_RPS}}"
K6_MAX_VUS="${K6_MAX_VUS:-$((K6_TARGET_RPS * 2))}"
[[ "${K6_PRE_ALLOCATED_VUS}" =~ ^[1-9][0-9]*$ ]] || \
  perf_fail "GATELM_K6_PRE_ALLOCATED_VUS must be a positive integer."
[[ "${K6_MAX_VUS}" =~ ^[1-9][0-9]*$ ]] || \
  perf_fail "GATELM_K6_MAX_VUS must be a positive integer."
(( ${#K6_PRE_ALLOCATED_VUS} <= 6 && ${#K6_MAX_VUS} <= 6 )) || \
  perf_fail "k6 VU counts cannot exceed six digits."
(( K6_MAX_VUS >= K6_PRE_ALLOCATED_VUS )) || \
  perf_fail "GATELM_K6_MAX_VUS must be greater than or equal to GATELM_K6_PRE_ALLOCATED_VUS."
[[ "${K6_DASHBOARD_PERIOD}" =~ ^[1-9][0-9]*(ms|s|m)$ ]] || \
  perf_fail "GATELM_K6_DASHBOARD_PERIOD must be a positive duration such as 1s."
[[ "${LOG_DRAIN_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] || \
  perf_fail "GATELM_PERF_LOG_DRAIN_TIMEOUT_SECONDS must be a positive integer."

gateway_base_url="${GATELM_LOADGEN_GATEWAY_BASE_URL%/}"
network_args=()
case "${LOADGEN_EXECUTION_MODE}" in
  dedicated)
    [[ -z "${GATELM_LOADGEN_DOCKER_NETWORK:-}" ]] || \
      perf_fail "GATELM_LOADGEN_DOCKER_NETWORK is reserved for local_validation mode."
    loadgen_validate_dedicated_base_url "${gateway_base_url}"
    perf_require_env_vars \
      GATELM_LOADGEN_EDGE_PRIVATE_IP \
      GATELM_LOADGEN_GATEWAY_METRICS_BASE_URLS \
      GATELM_LOADGEN_GATEWAY_COUNT \
      GATELM_LOADGEN_EXPECTED_UPSTREAMS \
      GATELM_LOADGEN_TLS_INSECURE
    perf_is_private_ipv4 "${GATELM_LOADGEN_EDGE_PRIVATE_IP}" || \
      perf_fail "GATELM_LOADGEN_EDGE_PRIVATE_IP must be an RFC1918 IPv4 address."
    [[ "${GATELM_LOADGEN_GATEWAY_COUNT}" == "1" || \
       "${GATELM_LOADGEN_GATEWAY_COUNT}" == "2" ]] || \
      perf_fail "GATELM_LOADGEN_GATEWAY_COUNT must be 1 or 2."
    [[ "${GATELM_LOADGEN_TLS_INSECURE}" == "true" ]] || \
      perf_fail "The isolated production-clone Edge requires GATELM_LOADGEN_TLS_INSECURE=true."
    loadgen_validate_metrics_urls \
      "${GATELM_LOADGEN_GATEWAY_METRICS_BASE_URLS}" \
      "${GATELM_LOADGEN_GATEWAY_COUNT}"
    IFS=',' read -r -a metrics_base_urls <<< "${GATELM_LOADGEN_GATEWAY_METRICS_BASE_URLS}"
    IFS=',' read -r -a expected_upstreams <<< "${GATELM_LOADGEN_EXPECTED_UPSTREAMS}"
    (( ${#expected_upstreams[@]} == GATELM_LOADGEN_GATEWAY_COUNT )) || \
      perf_fail "Expected Gateway upstream count must match GATELM_LOADGEN_GATEWAY_COUNT."
    ;;
  local_validation)
    [[ "${gateway_base_url}" == "http://gateway-core:8080" ]] || \
      perf_fail "local_validation mode only allows http://gateway-core:8080."
    local_network="${GATELM_LOADGEN_DOCKER_NETWORK:-gatelm-aws-perf-internal}"
    [[ "${local_network}" == "gatelm-aws-perf-internal" ]] || \
      perf_fail "local_validation mode only allows the isolated performance Docker network."
    metrics_base_url="${GATELM_LOADGEN_LOCAL_METRICS_BASE_URL:-http://127.0.0.1:18080}"
    [[ "${metrics_base_url}" == "http://127.0.0.1:18080" ]] || \
      perf_fail "local_validation metrics must use the isolated loopback Gateway endpoint."
    network_args=(--network "${local_network}")
    metrics_base_urls=("${metrics_base_url}")
    GATELM_LOADGEN_EDGE_PRIVATE_IP=""
    GATELM_LOADGEN_GATEWAY_COUNT=1
    GATELM_LOADGEN_EXPECTED_UPSTREAMS=""
    GATELM_LOADGEN_TLS_INSECURE=false
    ;;
  *)
    perf_fail "GATELM_LOADGEN_EXECUTION_MODE must be dedicated or local_validation."
    ;;
esac

perf_check_docker
perf_need_command "curl" "Install curl."
perf_need_command "git" "Install git."
[[ -f "${K6_SCRIPT_PATH}" ]] || perf_fail "k6 script not found: ${K6_SCRIPT_PATH}"

loadgen_git_sha="$(git -C "${REPO_ROOT}" rev-parse HEAD)"
[[ "${loadgen_git_sha}" =~ ^[a-f0-9]{40}$ ]] || \
  perf_fail "Could not resolve a full load-generator Git SHA."
git -C "${REPO_ROOT}" diff --quiet || \
  perf_fail "Tracked working-tree changes prevent exact load-generator Git SHA evidence."
git -C "${REPO_ROOT}" diff --cached --quiet || \
  perf_fail "Staged changes prevent exact load-generator Git SHA evidence."

if [[ "${LOADGEN_EXECUTION_MODE}" == "local_validation" ]]; then
  network_project="$(docker network inspect \
    --format '{{index .Labels "com.docker.compose.project"}}' \
    "${local_network}" 2>/dev/null || true)"
  [[ "${network_project}" == "${PERF_PROJECT_NAME}" ]] || \
    perf_fail "The isolated Docker network ${local_network} is not ready."
fi

umask 077
mkdir -p "${LOADGEN_REPORT_ROOT}"
run_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
run_id="run_${run_timestamp}_$$_${RANDOM}"
bundle_dir="${LOADGEN_REPORT_ROOT}/${run_timestamp}-${run_id}"
mkdir "${bundle_dir}"
chmod 700 "${bundle_dir}"

container_name="gatelm-loadgen-${run_timestamp,,}-$$-${RANDOM}"
metrics_before_path="${bundle_dir}/loadgen.metrics-before.prom"
metrics_after_path="${bundle_dir}/loadgen.metrics-after.prom"
metrics_after_tmp_path="${bundle_dir}/.loadgen.metrics-after.tmp"
k6_summary_env_path="${bundle_dir}/loadgen.k6-summary.env"
k6_summary_json_path="${bundle_dir}/loadgen.k6-summary.json"
k6_html_path="${bundle_dir}/loadgen.html"
status_path="${bundle_dir}/loadgen.status.env"
manifest_path="${bundle_dir}/loadgen.manifest.json"
loadgen_machine_hash="$(perf_machine_identity_hash "${run_id}")"

cleanup_loadgen() {
  rm -f "${metrics_after_tmp_path}"
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
}
trap cleanup_loadgen EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

capture_gateway_metrics() {
  local phase="$1"
  local aggregate_path="$2"
  local index=0
  local metrics_url replica_path replica_tmp_path

  : > "${aggregate_path}"
  for metrics_url in "${metrics_base_urls[@]}"; do
    index=$((index + 1))
    replica_path="${bundle_dir}/gateway-${index}.metrics-${phase}.prom"
    replica_tmp_path="${bundle_dir}/.gateway-${index}.metrics-${phase}.tmp"
    curl -fsS --max-time 5 "${metrics_url}/metrics" > "${replica_tmp_path}" || {
      rm -f "${replica_tmp_path}"
      return 1
    }
    mv "${replica_tmp_path}" "${replica_path}"
    printf '# GateLM replica %s source %s\n' "${index}" "${metrics_url}" >> "${aggregate_path}"
    cat "${replica_path}" >> "${aggregate_path}"
    printf '\n' >> "${aggregate_path}"
  done
}

capture_gateway_metrics before "${metrics_before_path}" || \
  perf_fail "Could not capture the initial Gateway metrics snapshots."

perf_log "Starting ${K6_TARGET_RPS} RPS cache-miss load for ${K6_DURATION} (run id ${run_id})."
perf_log "Execution mode: ${LOADGEN_EXECUTION_MODE}."

set +e
docker run --rm \
  --name "${container_name}" \
  "${network_args[@]}" \
  --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=64m \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --user "$(id -u):$(id -g)" \
  --volume "${REPO_ROOT}:/workspace:ro" \
  --volume "${bundle_dir}:/reports:rw" \
  --env "GATEWAY_BASE_URL=${gateway_base_url}" \
  --env "GATELM_LOADGEN_EDGE_PRIVATE_IP=${GATELM_LOADGEN_EDGE_PRIVATE_IP}" \
  --env "GATELM_LOADGEN_GATEWAY_COUNT=${GATELM_LOADGEN_GATEWAY_COUNT}" \
  --env "GATELM_LOADGEN_EXPECTED_UPSTREAMS=${GATELM_LOADGEN_EXPECTED_UPSTREAMS}" \
  --env "GATELM_LOADGEN_TLS_INSECURE=${GATELM_LOADGEN_TLS_INSECURE}" \
  --env GATELM_DEMO_API_KEY \
  --env GATELM_DEMO_APP_TOKEN \
  --env "GATELM_K6_TARGET_RPS=${K6_TARGET_RPS}" \
  --env "GATELM_K6_DURATION=${K6_DURATION}" \
  --env "GATELM_K6_PRE_ALLOCATED_VUS=${K6_PRE_ALLOCATED_VUS}" \
  --env "GATELM_K6_MAX_VUS=${K6_MAX_VUS}" \
  --env "GATELM_K6_RUN_ID=${run_id}" \
  --env GATELM_K6_EVIDENCE_BASENAME=loadgen \
  --env GATELM_K6_REMOTE_TARGET_MODE=private_mock \
  --env "GATELM_K6_ALLOWED_REMOTE_BASE_URL=${gateway_base_url}" \
  --env K6_WEB_DASHBOARD=true \
  --env "K6_WEB_DASHBOARD_PERIOD=${K6_DASHBOARD_PERIOD}" \
  --env K6_WEB_DASHBOARD_OPEN=false \
  --env K6_WEB_DASHBOARD_EXPORT=/reports/loadgen.html \
  "${K6_IMAGE}" run /workspace/scripts/perf/k6-gateway-load.js
k6_exit_code=$?
set -e

[[ -f "${k6_summary_env_path}" ]] || \
  perf_fail "k6 did not create its machine-readable summary. Bundle preserved at ${bundle_dir}."
[[ -f "${k6_summary_json_path}" ]] || \
  perf_fail "k6 did not create its JSON summary. Bundle preserved at ${bundle_dir}."
[[ -f "${k6_html_path}" ]] || \
  perf_fail "k6 did not create its HTML report. Bundle preserved at ${bundle_dir}."
perf_evidence_read_k6_summary "${k6_summary_env_path}" "${run_id}"

queue_depth=-1
for ((elapsed = 0; elapsed <= LOG_DRAIN_TIMEOUT_SECONDS; elapsed++)); do
  if capture_gateway_metrics after "${metrics_after_tmp_path}"; then
    mv "${metrics_after_tmp_path}" "${metrics_after_path}"
    queue_depth="$(perf_evidence_metric_integer \
      "${metrics_after_path}" \
      'gatelm_async_log_queue_depth{operation="terminal"}')"
    (( queue_depth == 0 )) && break
  fi
  sleep 1
done
[[ -f "${metrics_after_path}" ]] || \
  perf_fail "Could not capture the final Gateway metrics snapshot. Bundle preserved at ${bundle_dir}."

enqueue_queue_full_delta="$(perf_evidence_counter_delta \
  "${metrics_before_path}" \
  "${metrics_after_path}" \
  'gatelm_async_log_enqueue_total{operation="terminal",status="queue_full"}')"
enqueue_closed_delta="$(perf_evidence_counter_delta \
  "${metrics_before_path}" \
  "${metrics_after_path}" \
  'gatelm_async_log_enqueue_total{operation="terminal",status="closed"}')"
dropped_queue_full_delta="$(perf_evidence_counter_delta \
  "${metrics_before_path}" \
  "${metrics_after_path}" \
  'gatelm_async_log_dropped_total{operation="terminal",status="queue_full"}')"
dropped_closed_delta="$(perf_evidence_counter_delta \
  "${metrics_before_path}" \
  "${metrics_after_path}" \
  'gatelm_async_log_dropped_total{operation="terminal",status="closed"}')"
persist_error_delta="$(perf_evidence_counter_delta \
  "${metrics_before_path}" \
  "${metrics_after_path}" \
  'gatelm_async_log_persist_total{operation="terminal",status="error"}')"
persist_panic_delta="$(perf_evidence_counter_delta \
  "${metrics_before_path}" \
  "${metrics_after_path}" \
  'gatelm_async_log_persist_total{operation="terminal",status="panic"}')"

preliminary_status=pass
preliminary_failures=()
(( k6_exit_code == 0 )) || preliminary_failures+=("k6_exit_code")
(( GATELM_EVIDENCE_LOAD_ITERATIONS > 0 )) || preliminary_failures+=("k6_no_completed_requests")
(( GATELM_EVIDENCE_DROPPED_ITERATIONS == 0 )) || preliminary_failures+=("k6_dropped_iterations")
(( GATELM_EVIDENCE_CHECKS_FAILED == 0 )) || preliminary_failures+=("k6_failed_checks")
if [[ "${LOADGEN_EXECUTION_MODE}" == "dedicated" ]]; then
  (( GATELM_EVIDENCE_GATEWAY_UNKNOWN_RESPONSES == 0 )) || preliminary_failures+=("gateway_unknown_upstream")
  (( GATELM_EVIDENCE_GATEWAY_1_RESPONSES > 0 )) || preliminary_failures+=("gateway_1_no_responses")
  if (( GATELM_LOADGEN_GATEWAY_COUNT == 1 )); then
    (( GATELM_EVIDENCE_GATEWAY_2_RESPONSES == 0 )) || preliminary_failures+=("unexpected_gateway_2_responses")
  else
    (( GATELM_EVIDENCE_GATEWAY_2_RESPONSES > 0 )) || preliminary_failures+=("gateway_2_no_responses")
  fi
  (( GATELM_EVIDENCE_GATEWAY_1_RESPONSES + GATELM_EVIDENCE_GATEWAY_2_RESPONSES + GATELM_EVIDENCE_GATEWAY_UNKNOWN_RESPONSES == GATELM_EVIDENCE_LOAD_ITERATIONS )) || \
    preliminary_failures+=("gateway_response_count_mismatch")
fi
[[ "${GATELM_EVIDENCE_HTTP_FAILED_RATE}" =~ ^0([.]0+)?([eE][+-]?[0-9]+)?$ ]] || \
  preliminary_failures+=("k6_http_failures")
(( queue_depth == 0 )) || preliminary_failures+=("async_queue_not_drained")
(( enqueue_queue_full_delta == 0 )) || preliminary_failures+=("async_enqueue_queue_full")
(( enqueue_closed_delta == 0 )) || preliminary_failures+=("async_enqueue_closed")
(( dropped_queue_full_delta == 0 )) || preliminary_failures+=("async_drop_queue_full")
(( dropped_closed_delta == 0 )) || preliminary_failures+=("async_drop_closed")
(( persist_error_delta == 0 )) || preliminary_failures+=("async_persist_error")
(( persist_panic_delta == 0 )) || preliminary_failures+=("async_persist_panic")
(( ${#preliminary_failures[@]} == 0 )) || preliminary_status=fail

printf '%s\n' \
  'GATELM_LOADGEN_STATUS_SCHEMA=gatelm.gateway-load-loadgen-status.v2' \
  "GATELM_LOADGEN_RUN_ID=${run_id}" \
  "GATELM_LOADGEN_EXECUTION_MODE=${LOADGEN_EXECUTION_MODE}" \
  "GATELM_LOADGEN_K6_EXIT_CODE=${k6_exit_code}" \
  "GATELM_LOADGEN_TARGET_RPS=${K6_TARGET_RPS}" \
  "GATELM_LOADGEN_DURATION=${K6_DURATION}" \
  "GATELM_LOADGEN_GIT_SHA=${loadgen_git_sha}" \
  "GATELM_LOADGEN_MACHINE_HASH=${loadgen_machine_hash}" \
  "GATELM_LOADGEN_PRELIMINARY_STATUS=${preliminary_status}" \
  > "${status_path}"

topology_declared=false
[[ "${LOADGEN_EXECUTION_MODE}" == "dedicated" ]] && topology_declared=true
failures_json="$(loadgen_failures_json "${preliminary_failures[@]}")"
printf '%s\n' \
  '{' \
  '  "schemaVersion": "gatelm.gateway-load-loadgen-manifest.v2",' \
  "  \"status\": \"${preliminary_status}\"," \
  "  \"runId\": \"${run_id}\"," \
  "  \"generatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," \
  "  \"gitSha\": \"${loadgen_git_sha}\"," \
  "  \"executionMode\": \"${LOADGEN_EXECUTION_MODE}\"," \
  "  \"dedicatedTopologyDeclared\": ${topology_declared}," \
  '  "capacityClaimEligible": false,' \
  "  \"load\": {\"targetRps\": ${K6_TARGET_RPS}, \"duration\": \"${K6_DURATION}\", \"completedRequests\": ${GATELM_EVIDENCE_LOAD_ITERATIONS}, \"droppedIterations\": ${GATELM_EVIDENCE_DROPPED_ITERATIONS}, \"failedChecks\": ${GATELM_EVIDENCE_CHECKS_FAILED}, \"httpFailureRate\": ${GATELM_EVIDENCE_HTTP_FAILED_RATE}, \"httpDurationP95Ms\": ${GATELM_EVIDENCE_HTTP_DURATION_P95_MS}, \"httpDurationP99Ms\": ${GATELM_EVIDENCE_HTTP_DURATION_P99_MS}}," \
  "  \"gatewayRouting\": {\"declaredReplicaCount\": ${GATELM_LOADGEN_GATEWAY_COUNT}, \"replica1Responses\": ${GATELM_EVIDENCE_GATEWAY_1_RESPONSES}, \"replica2Responses\": ${GATELM_EVIDENCE_GATEWAY_2_RESPONSES}, \"unknownResponses\": ${GATELM_EVIDENCE_GATEWAY_UNKNOWN_RESPONSES}}," \
  "  \"asyncLogging\": {\"finalQueueDepth\": ${queue_depth}, \"enqueueQueueFullDelta\": ${enqueue_queue_full_delta}, \"enqueueClosedDelta\": ${enqueue_closed_delta}, \"droppedQueueFullDelta\": ${dropped_queue_full_delta}, \"droppedClosedDelta\": ${dropped_closed_delta}, \"persistErrorDelta\": ${persist_error_delta}, \"persistPanicDelta\": ${persist_panic_delta}}," \
  "  \"failedChecks\": [${failures_json}]" \
  '}' \
  > "${manifest_path}"

perf_log "k6 load execution finished with exit code ${k6_exit_code}."
perf_log "Evidence bundle: ${bundle_dir}"
perf_log "Capacity eligibility remains false until target-side reconciliation succeeds."

if [[ "${preliminary_status}" != "pass" ]]; then
  perf_fail "Load-generator evidence failed checks: ${preliminary_failures[*]}"
fi

perf_log "Load-generator evidence passed. Transfer this bundle to the target host for reconciliation."
