#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/perf-distributed-lib.sh
source "${SCRIPT_DIR}/perf-distributed-lib.sh"

[[ "${1:-}" == "--role" && $# -eq 2 ]] || \
  perf_fail "Usage: bash scripts/perf-distributed-preflight.sh --role <data|gateway|mock>"
role="$2"
case "${role}" in data|gateway|mock) ;; *) perf_fail "Unknown distributed role: ${role}" ;; esac

perf_check_docker
perf_need_command "curl" "Install curl."
dist_load_env
dist_validate_env
dist_assert_git_sha
dist_assert_role_host "${role}"
dist_validate_compose "${role}"

assert_http_ok() {
  local name="$1"
  local url="$2"
  curl -fsS --max-time 5 "${url}" >/dev/null || \
    perf_fail "${name} is not reachable at ${url}."
  perf_log "${name} is reachable."
}

assert_tcp_open() {
  local name="$1"
  local host="$2"
  local port="$3"
  timeout 5 bash -c "</dev/tcp/${host}/${port}" 2>/dev/null || \
    perf_fail "${name} TCP endpoint ${host}:${port} is not reachable."
  perf_log "${name} TCP endpoint is reachable."
}

case "${role}" in
  mock)
    dist_wait_for_service mock mock-provider
    assert_http_ok "Mock Provider health" "$(dist_mock_base_url)/healthz"
    # Variables are intentionally expanded inside the target container.
    # shellcheck disable=SC2016
    if ! dist_compose --profile mock exec -T mock-provider sh -c \
      'test "${FAST_NOOP_MOCK_DEFAULT_LATENCY_MS}" = "100"'; then
      perf_fail "Running Mock Provider is not configured for 100ms latency."
    fi

    timing_file="$(mktemp)"
    trap 'rm -f "${timing_file}"' EXIT
    for _ in 1 2 3 4 5; do
      curl -fsS --max-time 3 \
        -o /dev/null \
        -w '%{time_total}\n' \
        -H 'Content-Type: application/json' \
        --data '{"model":"mock-balanced","messages":[{"role":"user","content":"synthetic latency probe"}],"stream":false}' \
        "$(dist_mock_base_url)/v1/chat/completions" >> "${timing_file}" || \
        perf_fail "Mock Provider latency probe failed."
    done
    median_ms="$(sort -n "${timing_file}" | awk 'NR == 3 {printf "%.3f", $1 * 1000}')"
    awk -v value="${median_ms}" 'BEGIN {exit !(value >= 80 && value <= 300)}' || \
      perf_fail "Mock Provider median latency ${median_ms}ms is outside the 80-300ms preflight guard."
    perf_log "Mock Provider latency verified (configured=100ms, observed median=${median_ms}ms)."
    ;;
  data)
    dist_wait_for_service data postgres
    dist_wait_for_service data redis
    dist_wait_for_service data control-plane-api
    assert_http_ok "Control Plane health" "$(dist_control_plane_base_url)/healthz"

    [[ "$(perf_trim "$(dist_psql -tA -c 'select 1;')")" == "1" ]] || \
      perf_fail "PostgreSQL query preflight failed."
    # Variables are intentionally expanded inside the target container.
    # shellcheck disable=SC2016
    redis_result="$(dist_compose --profile data exec -T redis sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli ping')"
    [[ "$(perf_trim "${redis_result}")" == "PONG" ]] || perf_fail "Redis authentication preflight failed."

    dist_assert_runtime_configuration
    dist_assert_no_live_provider_credentials data
    perf_log "Data role, RuntimeSnapshot, Redis, and Mock-only provider catalog verified."
    ;;
  gateway)
    perf_need_command "python3" "Install python3."
    dist_wait_for_service gateway gateway-core
    assert_tcp_open "PostgreSQL" "${GATELM_PERF_DATA_PRIVATE_IP}" "${GATELM_PERF_POSTGRES_PORT}"
    assert_tcp_open "Redis" "${GATELM_PERF_DATA_PRIVATE_IP}" "${GATELM_PERF_REDIS_PORT}"
    assert_http_ok "Control Plane health" "$(dist_control_plane_base_url)/healthz"
    assert_http_ok "Mock Provider health" "$(dist_mock_base_url)/healthz"
    assert_http_ok "Gateway readiness" "$(dist_gateway_base_url)/readyz"
    dist_assert_runtime_configuration
    dist_assert_no_live_provider_credentials gateway
    # Variables are intentionally expanded inside the target container.
    # shellcheck disable=SC2016
    if ! dist_compose --profile gateway exec -T gateway-core sh -c \
      'test "${GATEWAY_AI_SAFETY_SIDECAR_ENABLED}" = "false"'; then
      perf_fail "Gateway AI Safety Sidecar must be disabled for the distributed capacity scenario."
    fi

    request_id="request_perf_distributed_preflight_$(date -u +%Y%m%dT%H%M%SZ)_$$_${RANDOM}"
    response_path="$(mktemp)"
    headers_path="$(mktemp)"
    trap 'rm -f "${response_path}" "${headers_path}"' EXIT
    status_code="$(curl -sS --max-time 10 \
      -D "${headers_path}" \
      -o "${response_path}" \
      -w '%{http_code}' \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer ${GATELM_DEMO_API_KEY}" \
      -H "X-GateLM-App-Token: ${GATELM_DEMO_APP_TOKEN}" \
      -H 'X-GateLM-End-User-Id: perf_distributed_preflight' \
      -H 'X-GateLM-Feature-Id: perf_distributed_preflight' \
      -H "X-GateLM-Request-Id: ${request_id}" \
      --data "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"GateLM synthetic distributed preflight ${request_id}.\"}],\"temperature\":0,\"max_tokens\":16,\"stream\":false}" \
      "$(dist_gateway_base_url)/v1/chat/completions")"
    [[ "${status_code}" == "200" ]] || perf_fail "Gateway preflight returned HTTP ${status_code}."
    grep -Eiq '^X-GateLM-Cache-Status:[[:space:]]*miss[[:space:]]*$' "${headers_path}" || \
      perf_fail "Gateway preflight was not a cache miss."
    python3 - "${response_path}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)
metadata = body.get("gate_lm") or {}
model_ref = str(metadata.get("modelRef") or "")
if metadata.get("providerCalled") is not True:
    print(
        "Gateway preflight response did not confirm providerCalled=true.",
        file=sys.stderr,
    )
    raise SystemExit(1)
if not model_ref.split(":")[-1].startswith("mock-"):
    print(
        "Gateway preflight response modelRef does not reference the Mock provider.",
        file=sys.stderr,
    )
    raise SystemExit(1)
PY

    log_state=""
    for _ in $(seq 1 30); do
      log_state="$(dist_psql -tA -F '|' -c "select concat_ws('|', count(*), count(*) filter (where status = 'success'), count(*) filter (where http_status = 200), count(*) filter (where metadata #>> '{domainOutcomes,logging,outcome}' = 'written')) from p0_llm_invocation_logs where request_id = '${request_id}';")"
      [[ "$(perf_trim "${log_state}")" == "1|1|1|1" ]] && break
      sleep 1
    done
    [[ "$(perf_trim "${log_state}")" == "1|1|1|1" ]] || \
      perf_fail "Gateway preflight Request Log was not reconciled."
    perf_log "Gateway routing, Cache Miss, HTTP 200, and Request Log reconciliation verified."
    ;;
esac

dist_write_attestation "${role}"
perf_log "Distributed ${role} preflight passed."
