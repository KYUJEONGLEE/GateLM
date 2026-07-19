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
loadgen_status_path="${tmp_dir}/loadgen.status.env"

printf '%s\n' \
  'GATELM_EVIDENCE_SCHEMA=gatelm.gateway-load-k6-summary.v1' \
  'GATELM_EVIDENCE_RUN_ID=run_test_1' \
  'GATELM_EVIDENCE_TARGET_RPS=500' \
  'GATELM_EVIDENCE_DURATION=2m' \
  'GATELM_EVIDENCE_PRE_ALLOCATED_VUS=500' \
  'GATELM_EVIDENCE_MAX_VUS=1000' \
  'GATELM_EVIDENCE_LOAD_ITERATIONS=120' \
  'GATELM_EVIDENCE_DROPPED_ITERATIONS=0' \
  'GATELM_EVIDENCE_CHECKS_PASSED=600' \
  'GATELM_EVIDENCE_CHECKS_FAILED=0' \
  'GATELM_EVIDENCE_HTTP_FAILED_RATE=0' \
  'GATELM_EVIDENCE_HTTP_DURATION_P95_MS=123.5' \
  'GATELM_EVIDENCE_HTTP_DURATION_P99_MS=180' \
  'GATELM_EVIDENCE_HTTP_DURATION_MAX_MS=220.25' \
  'GATELM_EVIDENCE_GATEWAY_1_RESPONSES=120' \
  'GATELM_EVIDENCE_GATEWAY_2_RESPONSES=0' \
  'GATELM_EVIDENCE_GATEWAY_UNKNOWN_RESPONSES=0' \
  > "${summary_path}"

perf_evidence_read_k6_summary "${summary_path}" "run_test_1"
[[ "${GATELM_EVIDENCE_LOAD_ITERATIONS}" == "120" ]]
[[ "${GATELM_EVIDENCE_GATEWAY_1_RESPONSES}" == "120" ]]
perf_evidence_read_k6_summary "${summary_path}" ""
[[ "${GATELM_EVIDENCE_RUN_ID}" == "run_test_1" ]]

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

if (perf_evidence_metric_integer \
  "${metrics_before_path}" \
  'gatelm_missing_metric_total{status="error"}') >/dev/null 2>&1; then
  printf '%s\n' "expected an undeclared metric family to fail" >&2
  exit 1
fi

invalid_summary_path="${tmp_dir}/invalid-summary.env"
printf '%s\n' 'UNEXPECTED_KEY=1' > "${invalid_summary_path}"
if (perf_evidence_read_k6_summary "${invalid_summary_path}" "run_test_1") >/dev/null 2>&1; then
  printf '%s\n' "expected invalid k6 summary to fail" >&2
  exit 1
fi

invalid_run_id_path="${tmp_dir}/invalid-run-id.env"
sed 's/GATELM_EVIDENCE_RUN_ID=run_test_1/GATELM_EVIDENCE_RUN_ID=..\/escape/' \
  "${summary_path}" > "${invalid_run_id_path}"
if (perf_evidence_read_k6_summary "${invalid_run_id_path}" "") >/dev/null 2>&1; then
  printf '%s\n' "expected invalid k6 run id to fail" >&2
  exit 1
fi

duplicate_key_path="${tmp_dir}/duplicate-key.env"
cp "${summary_path}" "${duplicate_key_path}"
printf '%s\n' 'GATELM_EVIDENCE_LOAD_ITERATIONS=121' >> "${duplicate_key_path}"
if (perf_evidence_read_k6_summary "${duplicate_key_path}" "") >/dev/null 2>&1; then
  printf '%s\n' "expected duplicate k6 summary key to fail" >&2
  exit 1
fi

printf '%s\n' \
  'GATELM_LOADGEN_STATUS_SCHEMA=gatelm.gateway-load-loadgen-status.v1' \
  'GATELM_LOADGEN_RUN_ID=run_test_1' \
  'GATELM_LOADGEN_EXECUTION_MODE=local_validation' \
  'GATELM_LOADGEN_K6_EXIT_CODE=0' \
  'GATELM_LOADGEN_TARGET_RPS=500' \
  'GATELM_LOADGEN_DURATION=2m' \
  'GATELM_LOADGEN_MACHINE_HASH=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  'GATELM_LOADGEN_PRELIMINARY_STATUS=pass' \
  > "${loadgen_status_path}"
perf_evidence_read_loadgen_status "${loadgen_status_path}"
[[ "${GATELM_LOADGEN_TARGET_RPS}" == "500" ]]
[[ -z "${GATELM_LOADGEN_GIT_SHA}" ]]

printf '%s\n' \
  'GATELM_LOADGEN_STATUS_SCHEMA=gatelm.gateway-load-loadgen-status.v2' \
  'GATELM_LOADGEN_RUN_ID=run_test_2' \
  'GATELM_LOADGEN_EXECUTION_MODE=dedicated' \
  'GATELM_LOADGEN_K6_EXIT_CODE=0' \
  'GATELM_LOADGEN_TARGET_RPS=500' \
  'GATELM_LOADGEN_DURATION=2m' \
  'GATELM_LOADGEN_GIT_SHA=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' \
  'GATELM_LOADGEN_MACHINE_HASH=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  'GATELM_LOADGEN_PRELIMINARY_STATUS=pass' \
  > "${loadgen_status_path}"
perf_evidence_read_loadgen_status "${loadgen_status_path}"
[[ "${GATELM_LOADGEN_GIT_SHA}" == "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" ]]

printf '%s\n' 'GATELM_LOADGEN_TARGET_RPS=501' >> "${loadgen_status_path}"
if (perf_evidence_read_loadgen_status "${loadgen_status_path}") >/dev/null 2>&1; then
  printf '%s\n' "expected duplicate load-generator status key to fail" >&2
  exit 1
fi

printf '%s\n' "perf evidence helper tests passed"
