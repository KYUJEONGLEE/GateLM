#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${SCRIPT_DIR}/perf-lib.sh"
# shellcheck source=deploy/aws-triage/scripts/perf-evidence-lib.sh
source "${SCRIPT_DIR}/perf-evidence-lib.sh"

K6_IMAGE="grafana/k6:2.0.0@sha256:a33a0cfdc4d2483d6b7a3a22e726a499ff2831a671a49239104cd34a9937523c"
K6_CONTAINER_NAME="gatelm-aws-perf-k6"
K6_NETWORK_NAME="gatelm-aws-perf-internal"
K6_SCRIPT_PATH="${REPO_ROOT}/scripts/perf/k6-gateway-load.js"
K6_REPORT_DIR="${REPO_ROOT}/reports/perf"
K6_TARGET_RPS="${GATELM_K6_TARGET_RPS:-1}"
K6_DURATION="${GATELM_K6_DURATION:-2m}"
K6_PRE_ALLOCATED_VUS="${GATELM_K6_PRE_ALLOCATED_VUS:-}"
K6_MAX_VUS="${GATELM_K6_MAX_VUS:-}"
K6_DASHBOARD_PORT="${GATELM_K6_DASHBOARD_PORT:-5665}"
K6_DASHBOARD_PERIOD="${GATELM_K6_DASHBOARD_PERIOD:-1s}"
LOG_DRAIN_TIMEOUT_SECONDS="${GATELM_PERF_LOG_DRAIN_TIMEOUT_SECONDS:-60}"

[[ $# -eq 0 ]] || \
  perf_fail "This script accepts environment variables only; positional arguments are not supported."

[[ "${K6_TARGET_RPS}" =~ ^[1-9][0-9]*$ ]] || \
  perf_fail "GATELM_K6_TARGET_RPS must be a positive integer."
[[ "${K6_DURATION}" =~ ^[1-9][0-9]*(ms|s|m|h)$ ]] || \
  perf_fail "GATELM_K6_DURATION must be a positive k6 duration such as 30s or 2m."
K6_PRE_ALLOCATED_VUS="${K6_PRE_ALLOCATED_VUS:-${K6_TARGET_RPS}}"
K6_MAX_VUS="${K6_MAX_VUS:-$((K6_TARGET_RPS * 2))}"
[[ "${K6_PRE_ALLOCATED_VUS}" =~ ^[1-9][0-9]*$ ]] || \
  perf_fail "GATELM_K6_PRE_ALLOCATED_VUS must be a positive integer."
[[ "${K6_MAX_VUS}" =~ ^[1-9][0-9]*$ ]] || \
  perf_fail "GATELM_K6_MAX_VUS must be a positive integer."
(( K6_MAX_VUS >= K6_PRE_ALLOCATED_VUS )) || \
  perf_fail "GATELM_K6_MAX_VUS must be greater than or equal to GATELM_K6_PRE_ALLOCATED_VUS."
[[ "${K6_DASHBOARD_PORT}" =~ ^[0-9]+$ ]] || \
  perf_fail "GATELM_K6_DASHBOARD_PORT must be an integer."
if (( K6_DASHBOARD_PORT < 1024 || K6_DASHBOARD_PORT > 65535 )); then
  perf_fail "GATELM_K6_DASHBOARD_PORT must be between 1024 and 65535."
fi
[[ "${K6_DASHBOARD_PERIOD}" =~ ^[1-9][0-9]*(ms|s|m)$ ]] || \
  perf_fail "GATELM_K6_DASHBOARD_PERIOD must be a positive duration such as 1s."
[[ "${LOG_DRAIN_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] || \
  perf_fail "GATELM_PERF_LOG_DRAIN_TIMEOUT_SECONDS must be a positive integer."

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
run_id="run_${run_timestamp}_$$_${RANDOM}"
evidence_basename="gateway-load-${run_timestamp}-$$_${RANDOM}"
report_name="${evidence_basename}.html"
report_path="${K6_REPORT_DIR}/${report_name}"
k6_summary_env_path="${K6_REPORT_DIR}/${evidence_basename}.k6-summary.env"
k6_summary_json_path="${K6_REPORT_DIR}/${evidence_basename}.k6-summary.json"
evidence_report_path="${K6_REPORT_DIR}/${evidence_basename}.evidence.json"
metrics_before_path="$(mktemp "${K6_REPORT_DIR}/.${evidence_basename}.metrics-before.XXXXXX")"
metrics_after_path="$(mktemp "${K6_REPORT_DIR}/.${evidence_basename}.metrics-after.XXXXXX")"
trap 'rm -f "${metrics_before_path}" "${metrics_after_path}"' EXIT

perf_need_command "curl" "Install curl."
curl -fsS --max-time 5 "http://127.0.0.1:${AWS_TRIAGE_GATEWAY_PORT}/metrics" \
  > "${metrics_before_path}"

perf_log "Starting ${K6_TARGET_RPS} RPS cache-miss load for ${K6_DURATION} (run id ${run_id})."
perf_log "Dashboard: http://127.0.0.1:${K6_DASHBOARD_PORT} (SSH tunnel required)."
perf_log "Close the dashboard browser tab after the test so k6 can export the report."

set +e
docker run --rm \
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
  --env "GATELM_K6_PRE_ALLOCATED_VUS=${K6_PRE_ALLOCATED_VUS}" \
  --env "GATELM_K6_MAX_VUS=${K6_MAX_VUS}" \
  --env "GATELM_K6_RUN_ID=${run_id}" \
  --env "GATELM_K6_EVIDENCE_BASENAME=${evidence_basename}" \
  --env K6_WEB_DASHBOARD=true \
  --env K6_WEB_DASHBOARD_HOST=0.0.0.0 \
  --env K6_WEB_DASHBOARD_PORT=5665 \
  --env "K6_WEB_DASHBOARD_PERIOD=${K6_DASHBOARD_PERIOD}" \
  --env K6_WEB_DASHBOARD_OPEN=false \
  --env "K6_WEB_DASHBOARD_EXPORT=/reports/${report_name}" \
  "${K6_IMAGE}" run /workspace/scripts/perf/k6-gateway-load.js
k6_exit_code=$?
set -e

[[ -f "${report_path}" ]] || \
  perf_fail "k6 completed but the HTML report was not created."
[[ -f "${k6_summary_json_path}" ]] || \
  perf_fail "k6 completed but the machine-readable summary was not created."

perf_evidence_read_k6_summary "${k6_summary_env_path}" "${run_id}"
(( GATELM_EVIDENCE_LOAD_ITERATIONS > 0 )) || \
  perf_fail "k6 did not complete any load request."

request_prefix="request_perf_load_${run_id}_"
db_total=0
db_distinct=0
db_success=0
db_http_200=0
db_logging_written=0
db_logging_outcome_written=0
db_p95_latency_ms=0
queue_depth=0

for ((elapsed = 0; elapsed <= LOG_DRAIN_TIMEOUT_SECONDS; elapsed++)); do
  db_summary="$(perf_compose exec -T postgres psql \
    -U "${POSTGRES_USER}" \
    -d "${POSTGRES_DB}" \
    -tA \
    -F '|' \
    -v ON_ERROR_STOP=1 \
    -c "with matched as (select * from p0_llm_invocation_logs where left(request_id, length('${request_prefix}')) = '${request_prefix}') select count(*)::bigint, count(distinct request_id)::bigint, count(*) filter (where status = 'success')::bigint, count(*) filter (where http_status = 200)::bigint, count(*) filter (where metadata #>> '{domainOutcomes,logging,requestLogWritten}' = 'true')::bigint, count(*) filter (where metadata #>> '{domainOutcomes,logging,outcome}' = 'written')::bigint, coalesce(round((percentile_cont(0.95) within group (order by latency_ms))::numeric, 3), 0) from matched;")"
  IFS='|' read -r \
    db_total \
    db_distinct \
    db_success \
    db_http_200 \
    db_logging_written \
    db_logging_outcome_written \
    db_p95_latency_ms \
    <<< "$(perf_trim "${db_summary}")"

  for count in \
    "${db_total}" \
    "${db_distinct}" \
    "${db_success}" \
    "${db_http_200}" \
    "${db_logging_written}" \
    "${db_logging_outcome_written}"; do
    perf_evidence_is_nonnegative_integer "${count}" || \
      perf_fail "Request Log reconciliation returned an invalid count."
  done
  perf_evidence_is_nonnegative_number "${db_p95_latency_ms}" || \
    perf_fail "Request Log reconciliation returned an invalid p95 latency."

  curl -fsS --max-time 5 "http://127.0.0.1:${AWS_TRIAGE_GATEWAY_PORT}/metrics" \
    > "${metrics_after_path}"
  queue_depth="$(perf_evidence_metric_integer \
    "${metrics_after_path}" \
    'gatelm_async_log_queue_depth{operation="terminal"}')"

  if (( db_total >= GATELM_EVIDENCE_LOAD_ITERATIONS && queue_depth == 0 )); then
    break
  fi
  sleep 1
done

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

evidence_status="pass"
evidence_failures=()
(( k6_exit_code == 0 )) || evidence_failures+=("k6_exit_code")
(( GATELM_EVIDENCE_DROPPED_ITERATIONS == 0 )) || evidence_failures+=("k6_dropped_iterations")
(( GATELM_EVIDENCE_CHECKS_FAILED == 0 )) || evidence_failures+=("k6_failed_checks")
[[ "${GATELM_EVIDENCE_HTTP_FAILED_RATE}" =~ ^0([.]0+)?([eE][+-]?[0-9]+)?$ ]] || evidence_failures+=("k6_http_failures")
(( db_total == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_total")
(( db_distinct == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_distinct")
(( db_success == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_success")
(( db_http_200 == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_http_200")
(( db_logging_written == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_written_flag")
(( db_logging_outcome_written == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_written_outcome")
(( queue_depth == 0 )) || evidence_failures+=("async_queue_not_drained")
(( enqueue_queue_full_delta == 0 )) || evidence_failures+=("async_enqueue_queue_full")
(( enqueue_closed_delta == 0 )) || evidence_failures+=("async_enqueue_closed")
(( dropped_queue_full_delta == 0 )) || evidence_failures+=("async_drop_queue_full")
(( dropped_closed_delta == 0 )) || evidence_failures+=("async_drop_closed")
(( persist_error_delta == 0 )) || evidence_failures+=("async_persist_error")
(( persist_panic_delta == 0 )) || evidence_failures+=("async_persist_panic")

if (( ${#evidence_failures[@]} > 0 )); then
  evidence_status="fail"
fi

failures_json=""
for failure in "${evidence_failures[@]}"; do
  if [[ -n "${failures_json}" ]]; then
    failures_json+=", "
  fi
  failures_json+="\"${failure}\""
done

printf '%s\n' \
  '{' \
  '  "schemaVersion": "gatelm.gateway-load-evidence.v1",' \
  "  \"status\": \"${evidence_status}\"," \
  "  \"runId\": \"${run_id}\"," \
  "  \"generatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," \
  "  \"load\": {\"targetRps\": ${K6_TARGET_RPS}, \"duration\": \"${K6_DURATION}\", \"completedRequests\": ${GATELM_EVIDENCE_LOAD_ITERATIONS}, \"droppedIterations\": ${GATELM_EVIDENCE_DROPPED_ITERATIONS}, \"failedChecks\": ${GATELM_EVIDENCE_CHECKS_FAILED}, \"httpFailureRate\": ${GATELM_EVIDENCE_HTTP_FAILED_RATE}, \"httpDurationP95Ms\": ${GATELM_EVIDENCE_HTTP_DURATION_P95_MS}, \"httpDurationP99Ms\": ${GATELM_EVIDENCE_HTTP_DURATION_P99_MS}}," \
  "  \"requestLogs\": {\"total\": ${db_total}, \"distinctRequestIds\": ${db_distinct}, \"success\": ${db_success}, \"http200\": ${db_http_200}, \"requestLogWritten\": ${db_logging_written}, \"loggingOutcomeWritten\": ${db_logging_outcome_written}, \"latencyP95Ms\": ${db_p95_latency_ms}}," \
  "  \"asyncLogging\": {\"finalQueueDepth\": ${queue_depth}, \"enqueueQueueFullDelta\": ${enqueue_queue_full_delta}, \"enqueueClosedDelta\": ${enqueue_closed_delta}, \"droppedQueueFullDelta\": ${dropped_queue_full_delta}, \"droppedClosedDelta\": ${dropped_closed_delta}, \"persistErrorDelta\": ${persist_error_delta}, \"persistPanicDelta\": ${persist_panic_delta}}," \
  "  \"failedChecks\": [${failures_json}]" \
  '}' \
  > "${evidence_report_path}"

perf_log "k6 load execution finished with exit code ${k6_exit_code}."
perf_log "Request Log reconciliation: ${db_distinct}/${GATELM_EVIDENCE_LOAD_ITERATIONS} unique rows."
perf_log "HTML report: ${report_path}"
perf_log "Machine-readable evidence: ${evidence_report_path}"

if [[ "${evidence_status}" != "pass" ]]; then
  perf_fail "Load evidence failed checks: ${evidence_failures[*]}"
fi

perf_log "Load and Request Log evidence passed without async log loss."
