#!/usr/bin/env bash
set -euo pipefail

GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://localhost:8080}"
GATELM_API_KEY="${GATELM_API_KEY:-glm_api_test_redacted}"
GATELM_APP_TOKEN="${GATELM_APP_TOKEN:-glm_app_token_test_redacted}"
GATELM_END_USER_ID="${GATELM_END_USER_ID:-user_demo_001}"

curl_gateway() {
  local title="$1"
  local feature_id="$2"
  local payload="$3"

  printf '\n== %s ==\n' "$title"
  curl -sS -i "${GATEWAY_BASE_URL}/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${GATELM_API_KEY}" \
    -H "X-GateLM-App-Token: ${GATELM_APP_TOKEN}" \
    -H "X-GateLM-End-User-Id: ${GATELM_END_USER_ID}" \
    -H "X-GateLM-Feature-Id: ${feature_id}" \
    -d "${payload}"
}

printf 'Gateway base URL: %s\n' "${GATEWAY_BASE_URL}"
printf 'End user ID: %s\n' "${GATELM_END_USER_ID}"

printf '\n== models ==\n'
curl -sS -i "${GATEWAY_BASE_URL}/v1/models" \
  -H "Authorization: Bearer ${GATELM_API_KEY}" \
  -H "X-GateLM-App-Token: ${GATELM_APP_TOKEN}"

safe_payload='{
  "model": "auto",
  "messages": [
    {"role": "user", "content": "Summarize this week campaign performance in one short paragraph."}
  ],
  "temperature": 0.2,
  "max_tokens": 128,
  "stream": false
}'

curl_gateway "safe request first pass" "day5-safe-demo" "${safe_payload}"
curl_gateway "same safe request cache pass" "day5-cache-demo" "${safe_payload}"

curl_gateway "short auto routing request" "day5-routing-demo" '{
  "model": "auto",
  "messages": [
    {"role": "user", "content": "Summarize campaign spend in one sentence."}
  ],
  "temperature": 0.2,
  "max_tokens": 128,
  "stream": false
}'

curl_gateway "redaction request" "day5-redaction-demo" '{
  "model": "auto",
  "messages": [
    {"role": "user", "content": "Draft a follow-up note for minji.kim@example.test and call 010-0000-1234."}
  ],
  "stream": false
}'

curl_gateway "block request" "day5-block-demo" '{
  "model": "auto",
  "messages": [
    {"role": "user", "content": "This message contains a credential-like placeholder: api_key=test_secret_token_redacted_for_demo_only"}
  ],
  "stream": false
}'
