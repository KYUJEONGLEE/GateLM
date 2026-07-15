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
  GATEWAY_OBSERVABILITY_INTERNAL_TOKEN \
  GATEWAY_EXACT_CACHE_KEY_SECRET \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN
gatelm_warn_placeholder_values \
  POSTGRES_PASSWORD \
  GATEWAY_EXACT_CACHE_KEY_SECRET \
  GATELM_DEMO_API_KEY \
  GATELM_DEMO_APP_TOKEN

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

case "${GATEWAY_AI_SAFETY_SIDECAR_ENABLED:-false}" in
  1|true|TRUE|yes|YES|on|ON)
    case "${AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED:-false}" in
      1|true|TRUE|yes|YES|on|ON) ;;
      *)
        gatelm_fail "AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED must be true when the Gateway AI Safety sidecar is enabled."
        ;;
    esac
    ;;
esac

case "${AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED:-false}" in
  1|true|TRUE|yes|YES|on|ON)
    gatelm_require_true_env \
      AI_SERVICE_INSTALL_ML_DEPS \
      "AI_SERVICE_INSTALL_ML_DEPS must be true when PII model preload is enabled. Rebuild or pull an AI Service image that includes the pinned ONNX dependencies."
    gatelm_require_env_vars AI_SERVICE_PII_MODEL_BUNDLE_URL_FILE
    model_source_file="${AI_SERVICE_PII_MODEL_BUNDLE_URL_FILE}"
    if [[ "${model_source_file}" != /* ]]; then
      model_source_file="${SELFHOST_DIR}/${model_source_file}"
    fi
    gatelm_require_private_file \
      "${model_source_file}" \
      "PII model source secret file was not found. Create it with mode 600 and put exactly one HTTPS artifact URL on one line."
    model_source_count="$(grep -Evc '^[[:space:]]*(#|$)' "${model_source_file}" || true)"
    if [[ "${model_source_count}" != "1" ]]; then
      gatelm_fail "PII model source secret file must contain exactly one non-comment HTTPS URL."
    fi
    model_source="$(grep -Ev '^[[:space:]]*(#|$)' "${model_source_file}" | head -n 1 | tr -d '\r')"
    case "${model_source}" in
      https://*) ;;
      *)
        gatelm_fail "PII model source secret must use HTTPS. The URL value will not be printed."
        ;;
    esac
    unset model_source model_source_count model_source_file
    ;;
esac

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
