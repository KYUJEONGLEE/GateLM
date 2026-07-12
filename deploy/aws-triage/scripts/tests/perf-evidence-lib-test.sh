#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERF_SCRIPTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-lib.sh
source "${PERF_SCRIPTS_DIR}/perf-lib.sh"
# shellcheck source=deploy/aws-triage/scripts/perf-evidence-lib.sh
source "${PERF_SCRIPTS_DIR}/perf-evidence-lib.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

summary_path="${tmp_dir}/summary.env"
metrics_before_path="${tmp_dir}/metrics-before.prom"
metrics_after_path="${tmp_dir}/metrics-after.prom"

printf '%s\n' \
  'GATELM_EVIDENCE_SCHEMA=gatelm.gateway-load-k6-summary.v1' \
  'GATELM_EVIDENCE_RUN_ID=run_test_1' \
  'GATELM_EVIDENCE_LOAD_ITERATIONS=120' \
  'GATELM_EVIDENCE_DROPPED_ITERATIONS=0' \
  'GATELM_EVIDENCE_CHECKS_PASSED=600' \
  'GATELM_EVIDENCE_CHECKS_FAILED=0' \
  'GATELM_EVIDENCE_HTTP_FAILED_RATE=0' \
  'GATELM_EVIDENCE_HTTP_DURATION_P95_MS=123.5' \
  'GATELM_EVIDENCE_HTTP_DURATION_P99_MS=180' \
  'GATELM_EVIDENCE_HTTP_DURATION_MAX_MS=220.25' \
  > "${summary_path}"

perf_evidence_read_k6_summary "${summary_path}" "run_test_1"
[[ "${GATELM_EVIDENCE_LOAD_ITERATIONS}" == "120" ]]

printf '%s\n' \
  '# TYPE gatelm_async_log_dropped_total counter' \
  'gatelm_async_log_dropped_total{operation="terminal",status="queue_full"} 3' \
  > "${metrics_before_path}"
printf '%s\n' \
  '# TYPE gatelm_async_log_dropped_total counter' \
  'gatelm_async_log_dropped_total{operation="terminal",status="queue_full"} 5' \
  > "${metrics_after_path}"

delta="$(perf_evidence_counter_delta \
  "${metrics_before_path}" \
  "${metrics_after_path}" \
  'gatelm_async_log_dropped_total{operation="terminal",status="queue_full"}')"
[[ "${delta}" == "2" ]]

invalid_summary_path="${tmp_dir}/invalid-summary.env"
printf '%s\n' 'UNEXPECTED_KEY=1' > "${invalid_summary_path}"
if (perf_evidence_read_k6_summary "${invalid_summary_path}" "run_test_1") >/dev/null 2>&1; then
  printf '%s\n' "expected invalid k6 summary to fail" >&2
  exit 1
fi

printf '%s\n' "perf evidence helper tests passed"
