#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/prod-clone-lib.sh
source "${SCRIPT_DIR}/prod-clone-lib.sh"

[[ "${1:-}" == "--role" && "${3:-}" == "--request-id" && ( $# -eq 4 || $# -eq 5 ) ]] || \
  clone_fail "Usage: bash scripts/prod-clone-verify-gateway.sh --role <gateway1|gateway2|data> --request-id <safe-request-id> [--stream]"
role="$2"
request_id="$4"
stream=false
if (( $# == 5 )); then
  [[ "$5" == "--stream" ]] || clone_fail "Unknown option: $5"
  stream=true
fi
case "${role}" in gateway1|gateway2|data) ;; *) clone_fail "Unknown Gateway verification role: ${role}" ;; esac
[[ "${request_id}" =~ ^request_prod_clone_smoke_[A-Za-z0-9_-]{12,120}$ ]] || \
  clone_fail "Request ID must use the request_prod_clone_smoke_ prefix and safe characters only."

perf_check_docker
clone_load_env
clone_validate_env
clone_assert_role_host "${role}"
[[ "${GATELM_PROD_CLONE_PHASE}" == "benchmark" ]] || \
  clone_fail "Synthetic Mock Gateway verification is allowed only in benchmark phase."

case "${role}" in
  gateway1|gateway2)
    perf_need_command "curl" "Install curl."
    perf_need_command "python3" "Install python3."
    clone_require_env GATELM_DEMO_API_KEY GATELM_DEMO_APP_TOKEN
    clone_wait_for_service "${role}" gateway-core

    response_path="$(mktemp)"
    headers_path="$(mktemp)"
    stats_path="$(mktemp)"
    profile_path="$(mktemp)"
    trap 'rm -f "${response_path}" "${headers_path}" "${stats_path}" "${profile_path}"' EXIT
    profile_status="$(curl --silent --show-error --output "${profile_path}" --write-out '%{http_code}' \
      --max-time 5 "http://${GATELM_PROD_CLONE_AI_PRIVATE_IP}:8090/__mock/profile")"
    [[ "${profile_status}" == "200" ]] || clone_fail "Mock Provider latency profile returned HTTP ${profile_status}."
    python3 - "${profile_path}" "${GATELM_PROD_CLONE_MOCK_LATENCY_PROFILE}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    profile = (json.load(handle).get("data") or {})

if profile.get("profile") != sys.argv[2]:
    raise SystemExit("Mock Provider latency profile does not match the protected clone environment.")
if profile.get("workload") != "nonstream" or int(profile.get("sampleCount") or 0) <= 0:
    raise SystemExit("Mock Provider latency profile attestation is incomplete.")
PY
    clone_log "Mock Provider latency profile ${GATELM_PROD_CLONE_MOCK_LATENCY_PROFILE} attested."
    reset_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --max-time 5 --request POST \
      "http://${GATELM_PROD_CLONE_AI_PRIVATE_IP}:8090/__mock/reset")"
    [[ "${reset_status}" == "200" ]] || clone_fail "Mock Provider call statistics could not be reset."
    stream_value=false
    [[ "${stream}" == "true" ]] && stream_value=true
    status_code="$(curl --silent --show-error --max-time 15 \
      --dump-header "${headers_path}" \
      --output "${response_path}" \
      --write-out '%{http_code}' \
      -H 'Content-Type: application/json' \
      -H "Authorization: Bearer ${GATELM_DEMO_API_KEY}" \
      -H "X-GateLM-App-Token: ${GATELM_DEMO_APP_TOKEN}" \
      -H 'X-GateLM-End-User-Id: prod_clone_smoke' \
      -H 'X-GateLM-Feature-Id: prod_clone_smoke' \
      -H "X-GateLM-Request-Id: ${request_id}" \
      --data "{\"model\":\"auto\",\"messages\":[{\"role\":\"user\",\"content\":\"GateLM synthetic production clone smoke ${request_id}.\"}],\"temperature\":0,\"max_tokens\":16,\"stream\":${stream_value}}" \
      "http://${GATELM_PROD_CLONE_GATEWAY_BIND_PRIVATE_IP}:8080/v1/chat/completions")"
    [[ "${status_code}" == "200" ]] || \
      clone_fail "Authenticated synthetic Gateway request returned HTTP ${status_code}."
    grep -Eiq '^X-GateLM-Cache-Status:[[:space:]]*miss[[:space:]]*$' "${headers_path}" || \
      clone_fail "Authenticated synthetic Gateway request was not a cache miss."

    if [[ "${stream}" == "true" ]]; then
      grep -Eiq '^Content-Type:[[:space:]]*text/event-stream' "${headers_path}" || \
        clone_fail "Authenticated streaming request did not return text/event-stream."
      python3 - "${response_path}" <<'PY'
import json
import sys

saw_done = False
saw_json = False
provider_called = False
mock_model = False
with open(sys.argv[1], encoding="utf-8") as handle:
    for raw_line in handle:
        line = raw_line.strip()
        if not line.startswith("data:"):
            continue
        payload = line.removeprefix("data:").strip()
        if payload == "[DONE]":
            saw_done = True
            continue
        body = json.loads(payload)
        saw_json = True
        metadata = body.get("gate_lm") or {}
        if metadata.get("providerCalled") is True:
            provider_called = True
        model_ref = str(metadata.get("modelRef") or "")
        if model_ref.split(":")[-1].startswith("mock-"):
            mock_model = True

if not saw_json or not saw_done:
    raise SystemExit("Gateway SSE stream did not contain JSON data and [DONE].")
if not provider_called or not mock_model:
    raise SystemExit("Gateway SSE stream did not confirm Mock provider execution.")
PY
      clone_log "Authenticated Gateway SSE HTTP 200, Cache Miss, Mock routing metadata, and [DONE] verified for ${request_id}."
    else
      python3 - "${response_path}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    body = json.load(handle)

metadata = body.get("gate_lm") or {}
model_ref = str(metadata.get("modelRef") or "")
if metadata.get("providerCalled") is not True:
    raise SystemExit("Gateway response did not confirm providerCalled=true.")
if not model_ref.split(":")[-1].startswith("mock-"):
    raise SystemExit("Gateway response modelRef does not reference the Mock provider.")
PY
      clone_log "Authenticated Gateway HTTP 200, Cache Miss, providerCalled=true, and Mock routing verified for ${request_id}."
    fi

    stats_status="$(curl --silent --show-error --output "${stats_path}" --write-out '%{http_code}' \
      --max-time 5 "http://${GATELM_PROD_CLONE_AI_PRIVATE_IP}:8090/__mock/stats")"
    [[ "${stats_status}" == "200" ]] || clone_fail "Mock Provider call statistics returned HTTP ${stats_status}."
    python3 - "${stats_path}" "${request_id}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    stats = json.load(handle)

data = stats.get("data") or {}
last_calls = data.get("lastCalls") or []
matching = sum(1 for item in last_calls if item.get("requestId") == sys.argv[2])
if data.get("totalCalls") != 1 or matching != 1:
    raise SystemExit("Mock Provider did not record exactly one call for the request.")
PY
    clone_log "Mock Provider recorded exactly one call for ${request_id}."
    ;;
  data)
    clone_assert_db_attestation
    clone_wait_for_service data postgres
    log_state=""
    for _ in $(seq 1 30); do
      log_state="$(clone_compose --profile data exec -T postgres \
        psql --username "${POSTGRES_USER}" --dbname "${POSTGRES_DB}" -At -F '|' \
        -c "select concat_ws('|', count(*), count(*) filter (where status = 'success'), count(*) filter (where http_status = 200), count(*) filter (where metadata #>> '{domainOutcomes,logging,outcome}' = 'written')) from p0_llm_invocation_logs where request_id = '${request_id}';")"
      [[ "$(perf_trim "${log_state}")" == "1|1|1|1" ]] && break
      sleep 1
    done
    [[ "$(perf_trim "${log_state}")" == "1|1|1|1" ]] || \
      clone_fail "Exactly one successful HTTP 200 Request Log was not reconciled for ${request_id}."
    clone_log "Exactly one successful HTTP 200 Request Log was reconciled for ${request_id}."
    ;;
esac
