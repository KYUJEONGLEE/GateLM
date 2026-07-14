#!/usr/bin/env bash

if [[ -z "${BASH_VERSION:-}" ]]; then
  printf '%s\n' "[GateLM perf] ERROR: bash is required." >&2
  exit 1
fi

perf_evidence_is_nonnegative_integer() {
  [[ "$1" =~ ^[0-9]{1,18}$ ]]
}

perf_evidence_is_nonnegative_number() {
  [[ "$1" =~ ^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$ ]]
}

perf_evidence_read_k6_summary() {
  local summary_path="$1"
  local expected_run_id="${2:-}"
  local key value
  local -A seen_keys=()

  [[ -f "${summary_path}" ]] || perf_fail "k6 evidence summary was not created: ${summary_path}"

  GATELM_EVIDENCE_SCHEMA=""
  GATELM_EVIDENCE_RUN_ID=""
  GATELM_EVIDENCE_TARGET_RPS=""
  GATELM_EVIDENCE_DURATION=""
  GATELM_EVIDENCE_PRE_ALLOCATED_VUS=""
  GATELM_EVIDENCE_MAX_VUS=""
  GATELM_EVIDENCE_LOAD_ITERATIONS=""
  GATELM_EVIDENCE_DROPPED_ITERATIONS=""
  GATELM_EVIDENCE_CHECKS_PASSED=""
  GATELM_EVIDENCE_CHECKS_FAILED=""
  GATELM_EVIDENCE_HTTP_FAILED_RATE=""
  GATELM_EVIDENCE_HTTP_DURATION_P95_MS=""
  GATELM_EVIDENCE_HTTP_DURATION_P99_MS=""
  GATELM_EVIDENCE_HTTP_DURATION_MAX_MS=""

  while IFS='=' read -r key value || [[ -n "${key}${value}" ]]; do
    [[ -z "${key}${value}" ]] && continue
    [[ "${key}" =~ ^[A-Z][A-Z0-9_]*$ ]] || \
      perf_fail "Invalid key in k6 evidence summary."
    [[ -z "${seen_keys[${key}]+x}" ]] || \
      perf_fail "Duplicate key in k6 evidence summary: ${key}"
    seen_keys["${key}"]=1
    case "${key}" in
      GATELM_EVIDENCE_SCHEMA) GATELM_EVIDENCE_SCHEMA="${value}" ;;
      GATELM_EVIDENCE_RUN_ID) GATELM_EVIDENCE_RUN_ID="${value}" ;;
      GATELM_EVIDENCE_TARGET_RPS) GATELM_EVIDENCE_TARGET_RPS="${value}" ;;
      GATELM_EVIDENCE_DURATION) GATELM_EVIDENCE_DURATION="${value}" ;;
      GATELM_EVIDENCE_PRE_ALLOCATED_VUS) GATELM_EVIDENCE_PRE_ALLOCATED_VUS="${value}" ;;
      GATELM_EVIDENCE_MAX_VUS) GATELM_EVIDENCE_MAX_VUS="${value}" ;;
      GATELM_EVIDENCE_LOAD_ITERATIONS) GATELM_EVIDENCE_LOAD_ITERATIONS="${value}" ;;
      GATELM_EVIDENCE_DROPPED_ITERATIONS) GATELM_EVIDENCE_DROPPED_ITERATIONS="${value}" ;;
      GATELM_EVIDENCE_CHECKS_PASSED) GATELM_EVIDENCE_CHECKS_PASSED="${value}" ;;
      GATELM_EVIDENCE_CHECKS_FAILED) GATELM_EVIDENCE_CHECKS_FAILED="${value}" ;;
      GATELM_EVIDENCE_HTTP_FAILED_RATE) GATELM_EVIDENCE_HTTP_FAILED_RATE="${value}" ;;
      GATELM_EVIDENCE_HTTP_DURATION_P95_MS) GATELM_EVIDENCE_HTTP_DURATION_P95_MS="${value}" ;;
      GATELM_EVIDENCE_HTTP_DURATION_P99_MS) GATELM_EVIDENCE_HTTP_DURATION_P99_MS="${value}" ;;
      GATELM_EVIDENCE_HTTP_DURATION_MAX_MS) GATELM_EVIDENCE_HTTP_DURATION_MAX_MS="${value}" ;;
      *) perf_fail "Unexpected key in k6 evidence summary: ${key}" ;;
    esac
  done < "${summary_path}"

  [[ "${GATELM_EVIDENCE_SCHEMA}" == "gatelm.gateway-load-k6-summary.v1" ]] || \
    perf_fail "Unexpected k6 evidence schema: ${GATELM_EVIDENCE_SCHEMA:-missing}"
  [[ "${GATELM_EVIDENCE_RUN_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$ ]] || \
    perf_fail "k6 evidence contains an invalid run id."
  if [[ -n "${expected_run_id}" ]]; then
    [[ "${GATELM_EVIDENCE_RUN_ID}" == "${expected_run_id}" ]] || \
      perf_fail "k6 evidence run id does not match the requested run."
  fi

  if [[ -n "${GATELM_EVIDENCE_TARGET_RPS}" ]]; then
    [[ "${GATELM_EVIDENCE_TARGET_RPS}" =~ ^[1-9][0-9]{0,5}$ ]] || \
      perf_fail "k6 evidence contains an invalid target RPS."
  fi
  if [[ -n "${GATELM_EVIDENCE_DURATION}" ]]; then
    [[ "${GATELM_EVIDENCE_DURATION}" =~ ^[1-9][0-9]{0,7}(ms|s|m|h)$ ]] || \
      perf_fail "k6 evidence contains an invalid duration."
  fi
  for value in \
    "${GATELM_EVIDENCE_PRE_ALLOCATED_VUS}" \
    "${GATELM_EVIDENCE_MAX_VUS}"; do
    if [[ -n "${value}" ]]; then
      [[ "${value}" =~ ^[1-9][0-9]{0,5}$ ]] || \
        perf_fail "k6 evidence contains an invalid VU count."
    fi
  done

  for value in \
    "${GATELM_EVIDENCE_LOAD_ITERATIONS}" \
    "${GATELM_EVIDENCE_DROPPED_ITERATIONS}" \
    "${GATELM_EVIDENCE_CHECKS_PASSED}" \
    "${GATELM_EVIDENCE_CHECKS_FAILED}"; do
    perf_evidence_is_nonnegative_integer "${value}" || \
      perf_fail "k6 evidence contains a non-integer count."
  done
  for value in \
    "${GATELM_EVIDENCE_HTTP_FAILED_RATE}" \
    "${GATELM_EVIDENCE_HTTP_DURATION_P95_MS}" \
    "${GATELM_EVIDENCE_HTTP_DURATION_P99_MS}" \
    "${GATELM_EVIDENCE_HTTP_DURATION_MAX_MS}"; do
    perf_evidence_is_nonnegative_number "${value}" || \
      perf_fail "k6 evidence contains an invalid numeric value."
  done
}

perf_evidence_read_loadgen_status() {
  local status_path="$1"
  local key value
  local -A seen_keys=()

  [[ -f "${status_path}" ]] || \
    perf_fail "Load-generator status was not found: ${status_path}"

  GATELM_LOADGEN_STATUS_SCHEMA=""
  GATELM_LOADGEN_RUN_ID=""
  GATELM_LOADGEN_EXECUTION_MODE=""
  GATELM_LOADGEN_K6_EXIT_CODE=""
  GATELM_LOADGEN_TARGET_RPS=""
  GATELM_LOADGEN_DURATION=""
  GATELM_LOADGEN_GIT_SHA=""
  GATELM_LOADGEN_MACHINE_HASH=""
  GATELM_LOADGEN_PRELIMINARY_STATUS=""

  while IFS='=' read -r key value || [[ -n "${key}${value}" ]]; do
    [[ -z "${key}${value}" ]] && continue
    [[ "${key}" =~ ^[A-Z][A-Z0-9_]*$ ]] || \
      perf_fail "Invalid key in load-generator status."
    [[ -z "${seen_keys[${key}]+x}" ]] || \
      perf_fail "Duplicate key in load-generator status: ${key}"
    seen_keys["${key}"]=1
    case "${key}" in
      GATELM_LOADGEN_STATUS_SCHEMA) GATELM_LOADGEN_STATUS_SCHEMA="${value}" ;;
      GATELM_LOADGEN_RUN_ID) GATELM_LOADGEN_RUN_ID="${value}" ;;
      GATELM_LOADGEN_EXECUTION_MODE) GATELM_LOADGEN_EXECUTION_MODE="${value}" ;;
      GATELM_LOADGEN_K6_EXIT_CODE) GATELM_LOADGEN_K6_EXIT_CODE="${value}" ;;
      GATELM_LOADGEN_TARGET_RPS) GATELM_LOADGEN_TARGET_RPS="${value}" ;;
      GATELM_LOADGEN_DURATION) GATELM_LOADGEN_DURATION="${value}" ;;
      GATELM_LOADGEN_GIT_SHA) GATELM_LOADGEN_GIT_SHA="${value}" ;;
      GATELM_LOADGEN_MACHINE_HASH) GATELM_LOADGEN_MACHINE_HASH="${value}" ;;
      GATELM_LOADGEN_PRELIMINARY_STATUS) GATELM_LOADGEN_PRELIMINARY_STATUS="${value}" ;;
      *) perf_fail "Unexpected key in load-generator status: ${key}" ;;
    esac
  done < "${status_path}"

  [[ "${GATELM_LOADGEN_STATUS_SCHEMA}" == "gatelm.gateway-load-loadgen-status.v1" || \
     "${GATELM_LOADGEN_STATUS_SCHEMA}" == "gatelm.gateway-load-loadgen-status.v2" ]] || \
    perf_fail "Unexpected load-generator status schema."
  [[ "${GATELM_LOADGEN_RUN_ID}" =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$ ]] || \
    perf_fail "Load-generator status contains an invalid run id."
  [[ "${GATELM_LOADGEN_EXECUTION_MODE}" == "dedicated" || \
     "${GATELM_LOADGEN_EXECUTION_MODE}" == "local_validation" ]] || \
    perf_fail "Load-generator status contains an invalid execution mode."
  perf_evidence_is_nonnegative_integer "${GATELM_LOADGEN_K6_EXIT_CODE}" || \
    perf_fail "Load-generator status contains an invalid k6 exit code."
  [[ "${GATELM_LOADGEN_TARGET_RPS}" =~ ^[1-9][0-9]{0,5}$ ]] || \
    perf_fail "Load-generator status contains an invalid target RPS."
  [[ "${GATELM_LOADGEN_DURATION}" =~ ^[1-9][0-9]{0,7}(ms|s|m|h)$ ]] || \
    perf_fail "Load-generator status contains an invalid duration."
  if [[ "${GATELM_LOADGEN_STATUS_SCHEMA}" == "gatelm.gateway-load-loadgen-status.v2" ]]; then
    [[ "${GATELM_LOADGEN_GIT_SHA}" =~ ^[a-f0-9]{40}$ ]] || \
      perf_fail "Load-generator v2 status requires a full Git SHA."
  elif [[ -n "${GATELM_LOADGEN_GIT_SHA}" ]]; then
    [[ "${GATELM_LOADGEN_GIT_SHA}" =~ ^[a-f0-9]{40}$ ]] || \
      perf_fail "Load-generator status contains an invalid Git SHA."
  fi
  [[ "${GATELM_LOADGEN_MACHINE_HASH}" =~ ^[a-f0-9]{64}$ ]] || \
    perf_fail "Load-generator status contains an invalid machine identity hash."
  [[ "${GATELM_LOADGEN_PRELIMINARY_STATUS}" == "pass" || \
     "${GATELM_LOADGEN_PRELIMINARY_STATUS}" == "fail" ]] || \
    perf_fail "Load-generator status contains an invalid preliminary status."
}

perf_evidence_metric_integer() {
  local metrics_path="$1"
  local selector="$2"
  local metric_name="${selector%%\{*}"

  [[ -f "${metrics_path}" ]] || perf_fail "Metrics snapshot was not created: ${metrics_path}"
  awk -v selector="${selector}" -v metric_name="${metric_name}" '
    function valid_number(value) {
      return value ~ /^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$/
    }
    $1 == "#" && $2 == "TYPE" && $3 == metric_name {
      declared = 1
    }
    $1 == selector {
      if (!valid_number($2) || $2 != int($2)) {
        exit 2
      }
      total += $2
      found = 1
    }
    END {
      if (found) {
        printf "%.0f\n", total
      } else if (declared) {
        print "0"
      } else {
        exit 3
      }
    }
  ' "${metrics_path}" || perf_fail "Invalid metric value for ${selector}."
}

perf_evidence_counter_delta() {
  local before_path="$1"
  local after_path="$2"
  local selector="$3"
  local before after

  before="$(perf_evidence_metric_integer "${before_path}" "${selector}")"
  after="$(perf_evidence_metric_integer "${after_path}" "${selector}")"
  (( after >= before )) || perf_fail "Metric counter decreased for ${selector}; Gateway may have restarted."
  printf '%s\n' "$((after - before))"
}
