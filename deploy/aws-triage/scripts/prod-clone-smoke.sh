#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/prod-clone-lib.sh
source "${SCRIPT_DIR}/prod-clone-lib.sh"

perf_check_docker
clone_load_env
clone_validate_env
clone_assert_role_host edge

edge_ip="${GATELM_PROD_CLONE_EDGE_PRIVATE_IP}"
public_domain="${GATELM_PUBLIC_DOMAIN}"
chat_domain="${GATELM_CHAT_DOMAIN:-chat.gatelm.co.kr}"

status="$(curl -k --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 5 --max-time 15 \
  --resolve "${public_domain}:443:${edge_ip}" "https://${public_domain}/")"
[[ "${status}" == "200" ]] || clone_fail "Private Caddy Web route returned ${status}, expected 200."

status="$(curl -k --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 5 --max-time 15 \
  --resolve "${chat_domain}:443:${edge_ip}" "https://${chat_domain}/login")"
[[ "${status}" == "200" ]] || clone_fail "Private Caddy Chat route returned ${status}, expected 200."

status="$(curl -k --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 5 --max-time 15 \
  --resolve "${public_domain}:443:${edge_ip}" \
  -X POST "https://${public_domain}/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  --data '{"model":"deployment-check","messages":[{"role":"user","content":"authentication-boundary-check"}]}')"
[[ "${status}" == "401" ]] || clone_fail "Unauthenticated Gateway request returned ${status}, expected 401."

status="$(curl -k --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 5 --max-time 15 \
  --resolve "${chat_domain}:443:${edge_ip}" \
  "https://${chat_domain}/api/tenant-chat/auth/session")"
[[ "${status}" == "401" ]] || clone_fail "Unauthenticated Tenant Chat session returned ${status}, expected 401."

clone_assert_tcp "Control Plane" "${GATELM_PROD_CLONE_DATA_PRIVATE_IP}" 3001
clone_assert_tcp "Chat API" "${GATELM_PROD_CLONE_DATA_PRIVATE_IP}" 3003
clone_assert_tcp "Gateway" "${GATELM_PROD_CLONE_GATEWAY_PRIVATE_IP}" 8080

clone_log "Private Caddy routes, Web, Chat, unauthenticated 401 boundaries, and allowed Edge connectivity passed."
