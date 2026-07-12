#!/usr/bin/env bash

if [[ -z "${BASH_VERSION:-}" ]]; then
  printf '%s\n' "[GateLM perf] ERROR: bash is required." >&2
  exit 1
fi

perf_evidence_is_nonnegative_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

perf_evidence_is_nonnegative_number() {
  [[ "$1" =~ ^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$ ]]
}

perf_evidence_read_k6_summary() {
  local summary_path="$1"
  local expected_run_id="$2"
  local key value

  [[ -f "${summary_path}" ]] || perf_fail "k6 evidence summary was not created: ${summary_path}"

  GATELM_EVIDENCE_SCHEMA=""
  GATELM_EVIDENCE_RUN_ID=""
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
    case "${key}" in
      GATELM_EVIDENCE_SCHEMA) GATELM_EVIDENCE_SCHEMA="${value}" ;;
      GATELM_EVIDENCE_RUN_ID) GATELM_EVIDENCE_RUN_ID="${value}" ;;
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
  [[ "${GATELM_EVIDENCE_RUN_ID}" == "${expected_run_id}" ]] || \
    perf_fail "k6 evidence run id does not match the requested run."

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

perf_evidence_metric_integer() {
  local metrics_path="$1"
  local selector="$2"

  [[ -f "${metrics_path}" ]] || perf_fail "Metrics snapshot was not created: ${metrics_path}"
  awk -v selector="${selector}" '
    function valid_number(value) {
      return value ~ /^[0-9]+([.][0-9]+)?([eE][+-]?[0-9]+)?$/
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
      } else {
        print "0"
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
