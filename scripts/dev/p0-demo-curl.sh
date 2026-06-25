#!/usr/bin/env bash
set -euo pipefail

GATEWAY_BASE_URL="${GATEWAY_BASE_URL:-http://localhost:8080}"
GATELM_API_KEY="${GATELM_API_KEY:-glm_api_test_redacted}"
GATELM_APP_TOKEN="${GATELM_APP_TOKEN:-glm_app_token_test_redacted}"

curl_gateway() {
  local title="$1"
  local payload="$2"

  printf '\n== %s ==\n' "$title"
  curl -sS -i "${GATEWAY_BASE_URL}/v1/chat/completions" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${GATELM_API_KEY}" \
    -H "X-GateLM-App-Token: ${GATELM_APP_TOKEN}" \
    -H 'X-GateLM-End-User-Id: user_demo_001' \
    -H 'X-GateLM-Feature-Id: support-reply' \
    -d "${payload}"
}

printf 'Gateway base URL: %s\n' "${GATEWAY_BASE_URL}"

printf '\n== models ==\n'
curl -sS -i "${GATEWAY_BASE_URL}/v1/models" \
  -H "Authorization: Bearer ${GATELM_API_KEY}" \
  -H "X-GateLM-App-Token: ${GATELM_APP_TOKEN}"

curl_gateway "safe request" '{
  "model": "auto",
  "messages": [
    {"role": "user", "content": "Write a short refund response."}
  ],
  "temperature": 0.2,
  "max_tokens": 128,
  "stream": false
}'

curl_gateway "redaction request" '{
  "model": "auto",
  "messages": [
    {"role": "user", "content": "Send a polite reply to user@example.invalid."}
  ],
  "stream": false
}'

curl_gateway "block request" '{
  "model": "auto",
  "messages": [
    {"role": "user", "content": "This message contains a credential-like placeholder: api_key=test_secret_token_redacted_for_demo_only"}
  ],
  "stream": false
}'
