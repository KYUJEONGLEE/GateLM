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
  GATEWAY_EXACT_CACHE_KEY_SECRET \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN
gatelm_warn_placeholder_values \
  POSTGRES_PASSWORD \
  GATEWAY_EXACT_CACHE_KEY_SECRET \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN
gatelm_check_docker
gatelm_validate_compose

gatelm_log "Pulling Docker images. This can take a few minutes on the first run."
if ! gatelm_compose pull; then
  gatelm_fail "Docker image pull failed. Check internet access, registry permissions, GATELM_IMAGE_REGISTRY, and GATELM_IMAGE_TAG in .env."
fi

gatelm_log "Starting services in the background."
if ! gatelm_compose up -d postgres redis mock-provider control-plane-api gateway-core ai-service web; then
  gatelm_fail "Docker Compose could not start the stack. Check port conflicts in .env, then run: docker compose --env-file .env ps"
fi

gatelm_log "Current service status:"
gatelm_compose ps

gatelm_log "Install step finished. Next run: bash scripts/migrate.sh"
