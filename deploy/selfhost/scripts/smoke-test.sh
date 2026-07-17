#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/selfhost/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

TMP_FILES=()

cleanup() {
  if (( ${#TMP_FILES[@]} > 0 )); then
    rm -f "${TMP_FILES[@]}"
  fi
}

make_tmp_file() {
  local file_path
  file_path="$(mktemp)"
  TMP_FILES+=("${file_path}")
  printf '%s' "${file_path}"
}

trap cleanup EXIT

gatelm_log "Starting GateLM self-host smoke test."
gatelm_load_env
gatelm_require_env_vars \
  SELFHOST_WEB_PORT \
  SELFHOST_CONTROL_PLANE_PORT \
  SELFHOST_GATEWAY_PORT \
  SELFHOST_AI_SERVICE_PORT \
  SELFHOST_MOCK_PROVIDER_PORT \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN \
  GATEWAY_OBSERVABILITY_INTERNAL_TOKEN \
  GATELM_DEMO_TENANT_ID \
  GATELM_DEMO_PROJECT_ID \
  GATELM_DEMO_APPLICATION_ID
if [[ "${TENANT_CHAT_RAG_ENABLED}" == "true" ]]; then
  gatelm_require_env_vars SELFHOST_CHAT_WEB_PORT
fi
gatelm_require_default_demo_ids
gatelm_check_docker
gatelm_need_curl
gatelm_validate_compose

web_base="http://127.0.0.1:${SELFHOST_WEB_PORT}"
control_plane_base="http://127.0.0.1:${SELFHOST_CONTROL_PLANE_PORT}"
gateway_base="http://127.0.0.1:${SELFHOST_GATEWAY_PORT}"
ai_service_base="http://127.0.0.1:${SELFHOST_AI_SERVICE_PORT}"
mock_provider_base="http://127.0.0.1:${SELFHOST_MOCK_PROVIDER_PORT}"

gatelm_wait_for_postgres
gatelm_wait_for_redis
gatelm_wait_for_http "Mock Provider /healthz" "${mock_provider_base}/healthz" 60
gatelm_wait_for_http "Control Plane /healthz" "${control_plane_base}/healthz" 60
gatelm_wait_for_http "Control Plane /readyz" "${control_plane_base}/readyz" 60
gatelm_wait_for_http "Gateway /healthz" "${gateway_base}/healthz" 60
gatelm_wait_for_http "Gateway /readyz" "${gateway_base}/readyz" 90
gatelm_wait_for_http "AI Service /healthz" "${ai_service_base}/healthz" 60
if [[ "${TENANT_CHAT_RAG_ENABLED}" == "true" ]]; then
  chat_web_base="http://127.0.0.1:${SELFHOST_CHAT_WEB_PORT}"
  gatelm_wait_for_compose_service "Chat API" "chat-api" 60
  gatelm_wait_for_compose_service "RAG worker" "rag-worker" 60
  gatelm_wait_for_http "Tenant Chat Web" "${chat_web_base}/login" 90
fi
gatelm_wait_for_http "Web Console" "${web_base}/" 90

request_id="selfhost_smoke_$(date -u +%Y%m%dT%H%M%SZ)_$$"
request_body_file="$(make_tmp_file)"
response_headers_file="$(make_tmp_file)"
response_body_file="$(make_tmp_file)"
logs_body_file="$(make_tmp_file)"

printf '%s' '{"model":"auto","messages":[{"role":"user","content":"selfhost-smoke@example.invalid"}],"temperature":0.2,"max_tokens":64,"stream":false}' > "${request_body_file}"

gatelm_log "Sending one Gateway chat request. Request and response bodies will not be printed."
http_code="$(
  curl -sS \
    --max-time 30 \
    -o "${response_body_file}" \
    -D "${response_headers_file}" \
    -w "%{http_code}" \
    -X POST "${gateway_base}/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${GATELM_DEMO_API_KEY}" \
    -H "X-GateLM-App-Token: ${GATELM_DEMO_APP_TOKEN}" \
    -H "X-GateLM-End-User-Id: selfhost-smoke-user" \
    -H "X-GateLM-Feature-Id: selfhost-smoke" \
    -H "X-GateLM-Request-Id: ${request_id}" \
    --data-binary "@${request_body_file}" || true
)"

if [[ ! "${http_code}" =~ ^[0-9]{3}$ ]]; then
  gatelm_fail "Gateway request did not receive an HTTP response. Check gateway-core and mock-provider logs. Request body is hidden."
fi

if (( http_code < 200 || http_code >= 300 )); then
  gatelm_fail "Gateway request failed with HTTP ${http_code}. Run migrate.sh, confirm real runtime resources are published, then check gateway-core logs. Response body is hidden."
fi

gatelm_log "Gateway request succeeded with request id: ${request_id}"

gatelm_log "Checking Request Log for the smoke request."
log_found="false"
for ((attempt = 1; attempt <= 15; attempt++)); do
  if curl -fsS \
    --max-time 10 \
    -o "${logs_body_file}" \
    -H "X-GateLM-Observability-Token: ${GATEWAY_OBSERVABILITY_INTERNAL_TOKEN}" \
    --get "${gateway_base}/api/projects/${GATELM_DEMO_PROJECT_ID}/logs" \
    --data-urlencode "from=2000-01-01T00:00:00Z" \
    --data-urlencode "to=2100-01-01T00:00:00Z" \
    --data-urlencode "requestId=${request_id}" \
    --data-urlencode "limit=20" >/dev/null 2>&1; then
    if grep -q "${request_id}" "${logs_body_file}"; then
      log_found="true"
      break
    fi
  fi
  sleep 2
done

if [[ "${log_found}" != "true" ]]; then
  gatelm_fail "Gateway responded, but the Request Log entry was not found. Check that migrate.sh created p0_llm_invocation_logs and gateway-core can reach PostgreSQL."
fi

gatelm_log "Request Log contains the smoke request."
gatelm_log "Smoke test finished successfully."
