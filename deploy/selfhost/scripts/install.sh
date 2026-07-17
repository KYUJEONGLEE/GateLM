#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/selfhost/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

gatelm_log "Starting GateLM self-host install."
gatelm_load_env
gatelm_require_env_vars \
  GATELM_IMAGE_REGISTRY \
  GATELM_IMAGE_TAG \
  GATELM_PUBLIC_BASE_URL \
  SELFHOST_WEB_PORT \
  SELFHOST_CONTROL_PLANE_PORT \
  SELFHOST_GATEWAY_PORT \
  SELFHOST_AI_SERVICE_PORT \
  SELFHOST_POSTGRES_PORT \
  SELFHOST_REDIS_PORT \
  SELFHOST_MOCK_PROVIDER_PORT \
  POSTGRES_USER \
  POSTGRES_PASSWORD \
  POSTGRES_DB \
  TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN \
  GATEWAY_OBSERVABILITY_INTERNAL_TOKEN \
  GATEWAY_EXACT_CACHE_KEY_SECRET \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN
gatelm_warn_placeholder_values \
  POSTGRES_PASSWORD \
  GATEWAY_EXACT_CACHE_KEY_SECRET \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN

gatelm_require_strong_secret_values TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN
gatelm_validate_rag_runtime_env

services=(
  postgres
  redis
  mock-provider
  control-plane-api
  gateway-core
  ai-service
  web
)

if [[ "${TENANT_CHAT_RAG_ENABLED}" == "true" ]]; then
  gatelm_require_env_vars \
    GATELM_CHAT_WEB_ORIGIN \
    SELFHOST_CHAT_WEB_PORT \
    TENANT_CHAT_RUNTIME_UID \
    TENANT_CHAT_RUNTIME_GID \
    TENANT_CHAT_WEB_SERVICE_TOKEN \
    TENANT_CHAT_ACCESS_JWT_SECRET \
    TENANT_CHAT_INTENT_SECRET \
    TENANT_CHAT_WORKLOAD_ACTIVE_KID \
    RAG_OBJECT_STORE_DRIVER \
    RAG_QUERY_EMBEDDING_ACTIVE_KID \
    RAG_WORKER_EMBEDDING_ACTIVE_KID \
    AI_SERVICE_RAG_SERVICE_TOKEN

  [[ "${TENANT_CHAT_RUNTIME_UID}" =~ ^[1-9][0-9]*$ ]] || \
    gatelm_fail "TENANT_CHAT_RUNTIME_UID must be a positive numeric UID."
  [[ "${TENANT_CHAT_RUNTIME_GID}" =~ ^[1-9][0-9]*$ ]] || \
    gatelm_fail "TENANT_CHAT_RUNTIME_GID must be a positive numeric GID."
  gatelm_require_strong_secret_values \
    TENANT_CHAT_WEB_SERVICE_TOKEN \
    TENANT_CHAT_ACCESS_JWT_SECRET \
    TENANT_CHAT_INTENT_SECRET \
    AI_SERVICE_RAG_SERVICE_TOKEN
  gatelm_require_opaque_ids \
    TENANT_CHAT_WORKLOAD_ACTIVE_KID \
    RAG_QUERY_EMBEDDING_ACTIVE_KID \
    RAG_WORKER_EMBEDDING_ACTIVE_KID
  gatelm_validate_selfhost_secret_files
  services+=(rag-worker chat-api chat-web)
fi

observability_token="${GATEWAY_OBSERVABILITY_INTERNAL_TOKEN}"
observability_token_compact="$(
  printf '%s' "${observability_token}" \
    | tr '[:upper:]' '[:lower:]' \
    | tr -d '[:space:]_-'
)"
if (( ${#observability_token} < 32 )); then
  gatelm_fail "GATEWAY_OBSERVABILITY_INTERNAL_TOKEN must contain at least 32 characters."
fi
for marker in changeme demo devonly example placeholder replaceme redacted; do
  if [[ "${observability_token_compact}" == *"${marker}"* ]]; then
    gatelm_fail "GATEWAY_OBSERVABILITY_INTERNAL_TOKEN must be replaced with a strong random value."
  fi
done
unset observability_token observability_token_compact marker

gatelm_check_docker
gatelm_validate_compose

gatelm_log "Pulling Docker images. This can take a few minutes on the first run."
if ! gatelm_compose pull "${services[@]}"; then
  gatelm_fail "Docker image pull failed. Check internet access, registry permissions, GATELM_IMAGE_REGISTRY, and GATELM_IMAGE_TAG in .env."
fi

gatelm_log "Starting services in the background."
if ! gatelm_compose up -d "${services[@]}"; then
  gatelm_fail "Docker Compose could not start the stack. Check port conflicts in .env, then run: docker compose --env-file .env ps"
fi

gatelm_log "Current service status:"
gatelm_compose ps

gatelm_log "Install step finished. Next run: bash scripts/migrate.sh"
