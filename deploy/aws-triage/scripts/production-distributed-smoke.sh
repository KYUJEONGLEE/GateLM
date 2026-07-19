#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/aws-triage/scripts/production-distributed-lib.sh
source "${SCRIPT_DIR}/production-distributed-lib.sh"

perf_check_docker
production_load_env
production_validate_env
production_assert_role_host edge

edge_ip="${GATELM_PRODUCTION_DISTRIBUTED_EDGE_PRIVATE_IP}"
public_domain="${GATELM_PUBLIC_DOMAIN}"
chat_domain="${GATELM_CHAT_DOMAIN:-chat.gatelm.co.kr}"

status="$(curl -k --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 5 --max-time 15 \
  --resolve "${public_domain}:443:${edge_ip}" "https://${public_domain}/")"
[[ "${status}" == "200" ]] || production_fail "Private Caddy Web route returned ${status}, expected 200."

status="$(curl -k --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 5 --max-time 15 \
  --resolve "${chat_domain}:443:${edge_ip}" "https://${chat_domain}/login")"
[[ "${status}" == "200" ]] || production_fail "Private Caddy Chat route returned ${status}, expected 200."

status="$(curl -k --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 5 --max-time 15 \
  --resolve "${public_domain}:443:${edge_ip}" \
  -X POST "https://${public_domain}/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  --data '{"model":"deployment-check","messages":[{"role":"user","content":"authentication-boundary-check"}]}')"
[[ "${status}" == "401" ]] || production_fail "Unauthenticated Gateway request returned ${status}, expected 401."

status="$(curl -k --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --connect-timeout 5 --max-time 15 \
  --resolve "${chat_domain}:443:${edge_ip}" \
  "https://${chat_domain}/api/tenant-chat/auth/session")"
[[ "${status}" == "401" ]] || production_fail "Unauthenticated Tenant Chat session returned ${status}, expected 401."

production_assert_tcp "Control Plane" "${GATELM_PRODUCTION_DISTRIBUTED_DATA_PRIVATE_IP}" 3001
production_assert_tcp "Chat API" "${GATELM_PRODUCTION_DISTRIBUTED_DATA_PRIVATE_IP}" 3003
production_assert_tcp "Gateway" "${GATELM_PRODUCTION_DISTRIBUTED_GATEWAY_PRIVATE_IP}" 8080

production_log "Private Caddy routes, Web, Chat, unauthenticated boundaries, and allowed Edge connectivity passed."
