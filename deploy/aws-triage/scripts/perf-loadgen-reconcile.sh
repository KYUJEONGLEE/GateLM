#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${SCRIPT_DIR}/perf-lib.sh"
# shellcheck source=deploy/aws-triage/scripts/perf-evidence-lib.sh
source "${SCRIPT_DIR}/perf-evidence-lib.sh"

LOADGEN_REPORT_ROOT="${REPO_ROOT}/reports/perf/loadgen"
LOG_DRAIN_TIMEOUT_SECONDS="${GATELM_PERF_LOG_DRAIN_TIMEOUT_SECONDS:-60}"

reconcile_values_json() {
  local json=""
  local value
  for value in "$@"; do
    [[ -z "${json}" ]] || json+=", "
    json+="\"${value}\""
  done
  printf '%s' "${json}"
}

reconcile_duration_ms() {
  local duration="$1"
  local amount unit multiplier

  [[ "${duration}" =~ ^([1-9][0-9]{0,7})(ms|s|m|h)$ ]] || \
    perf_fail "Cannot convert an invalid load duration."
  amount="${BASH_REMATCH[1]}"
  unit="${BASH_REMATCH[2]}"
  case "${unit}" in
    ms) multiplier=1 ;;
    s) multiplier=1000 ;;
    m) multiplier=60000 ;;
    h) multiplier=3600000 ;;
  esac
  printf '%s\n' "$((10#${amount} * multiplier))"
}

reconcile_require_bundle_file() {
  local path="$1"
  local max_bytes="$2"
  local size

  [[ -f "${path}" && ! -L "${path}" ]] || \
    perf_fail "Evidence bundle file is missing or is a symbolic link: $(basename "${path}")"
  size="$(wc -c < "${path}")"
  [[ "${size}" =~ ^[0-9]+$ ]] || perf_fail "Could not inspect evidence bundle file size."
  (( size <= max_bytes )) || \
    perf_fail "Evidence bundle file is unexpectedly large: $(basename "${path}")"
}

[[ $# -eq 1 ]] || \
  perf_fail "Usage: bash scripts/perf-loadgen-reconcile.sh <bundle-directory>"
[[ "${LOG_DRAIN_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]] || \
  perf_fail "GATELM_PERF_LOG_DRAIN_TIMEOUT_SECONDS must be a positive integer."

perf_need_command "realpath" "Install coreutils."
perf_need_command "curl" "Install curl."
[[ -d "${LOADGEN_REPORT_ROOT}" ]] || \
  perf_fail "Load-generator report root does not exist: ${LOADGEN_REPORT_ROOT}"
report_root_resolved="$(realpath "${LOADGEN_REPORT_ROOT}")"
bundle_dir="$(realpath "$1")"
[[ -d "${bundle_dir}" ]] || perf_fail "Load-generator bundle directory was not found."
[[ "${bundle_dir}" == "${report_root_resolved}/"* ]] || \
  perf_fail "The bundle must be inside reports/perf/loadgen."

k6_summary_env_path="${bundle_dir}/loadgen.k6-summary.env"
status_path="${bundle_dir}/loadgen.status.env"
metrics_before_path="${bundle_dir}/loadgen.metrics-before.prom"
metrics_after_path="${bundle_dir}/loadgen.metrics-after.prom"
evidence_report_path="${bundle_dir}/loadgen.evidence.json"
reconcile_require_bundle_file "${k6_summary_env_path}" 65536
reconcile_require_bundle_file "${status_path}" 65536
reconcile_require_bundle_file "${metrics_before_path}" 10485760
reconcile_require_bundle_file "${metrics_after_path}" 10485760

perf_evidence_read_loadgen_status "${status_path}"
perf_evidence_read_k6_summary "${k6_summary_env_path}" "${GATELM_LOADGEN_RUN_ID}"
[[ -n "${GATELM_EVIDENCE_TARGET_RPS}" && -n "${GATELM_EVIDENCE_DURATION}" ]] || \
  perf_fail "k6 evidence does not include the load target and duration."
[[ "${GATELM_EVIDENCE_TARGET_RPS}" == "${GATELM_LOADGEN_TARGET_RPS}" ]] || \
  perf_fail "k6 and load-generator target RPS values do not match."
[[ "${GATELM_EVIDENCE_DURATION}" == "${GATELM_LOADGEN_DURATION}" ]] || \
  perf_fail "k6 and load-generator duration values do not match."

perf_check_docker
perf_load_env
perf_validate_env
perf_validate_compose
perf_assert_isolated_postgres
perf_assert_runtime_rate_limit
perf_assert_no_live_provider_credentials

target_machine_hash="$(perf_machine_identity_hash "${GATELM_LOADGEN_RUN_ID}")"
hosts_separated=false
[[ "${target_machine_hash}" != "${GATELM_LOADGEN_MACHINE_HASH}" ]] && hosts_separated=true

current_metrics_path="$(mktemp "${bundle_dir}/.target-current-metrics.XXXXXX")"
trap 'rm -f "${current_metrics_path}"' EXIT
curl -fsS --max-time 5 "$(perf_gateway_host_base_url)/metrics" > "${current_metrics_path}"
current_queue_depth="$(perf_evidence_metric_integer \
  "${current_metrics_path}" \
  'gatelm_async_log_queue_depth{operation="terminal"}')"
bundle_queue_depth="$(perf_evidence_metric_integer \
  "${metrics_after_path}" \
  'gatelm_async_log_queue_depth{operation="terminal"}')"

request_prefix="request_perf_load_${GATELM_LOADGEN_RUN_ID}_"
db_total=0
db_distinct=0
db_success=0
db_http_200=0
db_logging_written=0
db_logging_outcome_written=0
db_p95_latency_ms=0

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

  (( db_total >= GATELM_EVIDENCE_LOAD_ITERATIONS )) && break
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

evidence_status=pass
evidence_failures=()
[[ "${GATELM_LOADGEN_PRELIMINARY_STATUS}" == "pass" ]] || evidence_failures+=("loadgen_preliminary_status")
(( GATELM_LOADGEN_K6_EXIT_CODE == 0 )) || evidence_failures+=("k6_exit_code")
(( GATELM_EVIDENCE_LOAD_ITERATIONS > 0 )) || evidence_failures+=("k6_no_completed_requests")
(( GATELM_EVIDENCE_DROPPED_ITERATIONS == 0 )) || evidence_failures+=("k6_dropped_iterations")
(( GATELM_EVIDENCE_CHECKS_FAILED == 0 )) || evidence_failures+=("k6_failed_checks")
[[ "${GATELM_EVIDENCE_HTTP_FAILED_RATE}" =~ ^0([.]0+)?([eE][+-]?[0-9]+)?$ ]] || evidence_failures+=("k6_http_failures")
(( db_total == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_total")
(( db_distinct == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_distinct")
(( db_success == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_success")
(( db_http_200 == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_http_200")
(( db_logging_written == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_written_flag")
(( db_logging_outcome_written == GATELM_EVIDENCE_LOAD_ITERATIONS )) || evidence_failures+=("request_log_written_outcome")
(( bundle_queue_depth == 0 )) || evidence_failures+=("bundle_async_queue_not_drained")
(( current_queue_depth == 0 )) || evidence_failures+=("target_async_queue_not_drained")
(( enqueue_queue_full_delta == 0 )) || evidence_failures+=("async_enqueue_queue_full")
(( enqueue_closed_delta == 0 )) || evidence_failures+=("async_enqueue_closed")
(( dropped_queue_full_delta == 0 )) || evidence_failures+=("async_drop_queue_full")
(( dropped_closed_delta == 0 )) || evidence_failures+=("async_drop_closed")
(( persist_error_delta == 0 )) || evidence_failures+=("async_persist_error")
(( persist_panic_delta == 0 )) || evidence_failures+=("async_persist_panic")
(( ${#evidence_failures[@]} == 0 )) || evidence_status=fail

duration_ms="$(reconcile_duration_ms "${GATELM_LOADGEN_DURATION}")"
rps_goal_met=false
duration_goal_met=false
target_remote_enabled=false
[[ "${GATELM_LOADGEN_TARGET_RPS}" == "500" ]] && rps_goal_met=true
(( duration_ms >= 120000 )) && duration_goal_met=true
[[ "${GATELM_PERF_REMOTE_LOADGEN_ENABLED}" == "true" ]] && target_remote_enabled=true

eligibility_blockers=()
[[ "${GATELM_LOADGEN_EXECUTION_MODE}" == "dedicated" ]] || eligibility_blockers+=("execution_mode_not_dedicated")
[[ "${hosts_separated}" == "true" ]] || eligibility_blockers+=("loadgen_and_target_not_separated")
[[ "${target_remote_enabled}" == "true" ]] || eligibility_blockers+=("target_remote_loadgen_not_enabled")
[[ "${rps_goal_met}" == "true" ]] || eligibility_blockers+=("target_rps_not_500")
[[ "${duration_goal_met}" == "true" ]] || eligibility_blockers+=("duration_below_2m")
[[ "${evidence_status}" == "pass" ]] || eligibility_blockers+=("evidence_failed")

capacity_claim_eligible=false
(( ${#eligibility_blockers[@]} == 0 )) && capacity_claim_eligible=true
failed_checks_json="$(reconcile_values_json "${evidence_failures[@]}")"
eligibility_blockers_json="$(reconcile_values_json "${eligibility_blockers[@]}")"

printf '%s\n' \
  '{' \
  '  "schemaVersion": "gatelm.gateway-load-external-evidence.v1",' \
  "  \"status\": \"${evidence_status}\"," \
  "  \"runId\": \"${GATELM_LOADGEN_RUN_ID}\"," \
  "  \"generatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"," \
  "  \"executionMode\": \"${GATELM_LOADGEN_EXECUTION_MODE}\"," \
  "  \"capacityClaimEligible\": ${capacity_claim_eligible}," \
  "  \"capacityCriteria\": {\"hostsSeparated\": ${hosts_separated}, \"targetRemoteLoadgenEnabled\": ${target_remote_enabled}, \"targetRps500\": ${rps_goal_met}, \"durationAtLeast2m\": ${duration_goal_met}}," \
  "  \"load\": {\"targetRps\": ${GATELM_LOADGEN_TARGET_RPS}, \"duration\": \"${GATELM_LOADGEN_DURATION}\", \"completedRequests\": ${GATELM_EVIDENCE_LOAD_ITERATIONS}, \"droppedIterations\": ${GATELM_EVIDENCE_DROPPED_ITERATIONS}, \"failedChecks\": ${GATELM_EVIDENCE_CHECKS_FAILED}, \"httpFailureRate\": ${GATELM_EVIDENCE_HTTP_FAILED_RATE}, \"httpDurationP95Ms\": ${GATELM_EVIDENCE_HTTP_DURATION_P95_MS}, \"httpDurationP99Ms\": ${GATELM_EVIDENCE_HTTP_DURATION_P99_MS}}," \
  "  \"requestLogs\": {\"total\": ${db_total}, \"distinctRequestIds\": ${db_distinct}, \"success\": ${db_success}, \"http200\": ${db_http_200}, \"requestLogWritten\": ${db_logging_written}, \"loggingOutcomeWritten\": ${db_logging_outcome_written}, \"latencyP95Ms\": ${db_p95_latency_ms}}," \
  "  \"asyncLogging\": {\"bundleFinalQueueDepth\": ${bundle_queue_depth}, \"targetCurrentQueueDepth\": ${current_queue_depth}, \"enqueueQueueFullDelta\": ${enqueue_queue_full_delta}, \"enqueueClosedDelta\": ${enqueue_closed_delta}, \"droppedQueueFullDelta\": ${dropped_queue_full_delta}, \"droppedClosedDelta\": ${dropped_closed_delta}, \"persistErrorDelta\": ${persist_error_delta}, \"persistPanicDelta\": ${persist_panic_delta}}," \
  "  \"failedChecks\": [${failed_checks_json}]," \
  "  \"capacityEligibilityBlockers\": [${eligibility_blockers_json}]" \
  '}' \
  > "${evidence_report_path}"

perf_log "Request Log reconciliation: ${db_distinct}/${GATELM_EVIDENCE_LOAD_ITERATIONS} unique rows."
perf_log "Target-side evidence: ${evidence_report_path}"
perf_log "Capacity claim eligible: ${capacity_claim_eligible}."

if [[ "${evidence_status}" != "pass" ]]; then
  perf_fail "External load evidence failed checks: ${evidence_failures[*]}"
fi

if [[ "${capacity_claim_eligible}" != "true" ]]; then
  perf_warn "Evidence integrity passed, but capacity claim is blocked by: ${eligibility_blockers[*]}"
fi

perf_log "External load and Request Log evidence passed without async log loss."
