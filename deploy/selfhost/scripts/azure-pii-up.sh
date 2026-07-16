#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=deploy/selfhost/scripts/lib.sh
source "${SCRIPT_DIR}/lib.sh"

AZURE_PII_COMPOSE_FILE="${SELFHOST_DIR}/docker-compose.azure-pii.yml"

azure_pii_compose() {
  docker compose \
    --env-file "${SELFHOST_ENV_FILE}" \
    -f "${SELFHOST_COMPOSE_FILE}" \
    -f "${AZURE_PII_COMPOSE_FILE}" \
    "$@"
}

gatelm_log "Starting the Microsoft Azure AI Language PII deployment path."
gatelm_load_env
gatelm_require_file \
  "${AZURE_PII_COMPOSE_FILE}" \
  "Azure PII Compose overlay is missing. Re-download the GateLM self-host bundle."
gatelm_require_env_vars \
  AZURE_PII_EULA \
  AZURE_PII_BILLING_ENDPOINT \
  AZURE_PII_API_KEY

if [[ "${AZURE_PII_EULA}" != "accept" ]]; then
  gatelm_fail "AZURE_PII_EULA must be exactly accept after the operator reviews the Microsoft container terms."
fi
case "${AZURE_PII_BILLING_ENDPOINT}" in
  https://*) ;;
  *)
    gatelm_fail "AZURE_PII_BILLING_ENDPOINT must be the HTTPS endpoint of an Azure Language resource."
    ;;
esac
if [[ "${AZURE_PII_API_KEY}" == *"replace-me"* || ${#AZURE_PII_API_KEY} -lt 16 ]]; then
  gatelm_fail "AZURE_PII_API_KEY must be replaced with a valid Azure Language resource key."
fi

gatelm_check_docker
gatelm_need_curl
if ! azure_pii_compose config --quiet; then
  gatelm_fail "The combined self-host and Azure PII Compose configuration is invalid. No secret value was printed."
fi

gatelm_log "Pulling the pinned Microsoft PII container image."
if ! azure_pii_compose pull azure-pii; then
  gatelm_fail "The Microsoft PII container image could not be pulled. Check network access to mcr.microsoft.com."
fi

case "${AZURE_PII_BUILD_AI_SERVICE:-true}" in
  1|true|TRUE|yes|YES|on|ON)
    gatelm_log "Building the current AI Service source without local ONNX dependencies."
    if ! azure_pii_compose build ai-service; then
      gatelm_fail "AI Service could not be built from the current source."
    fi
    ;;
  0|false|FALSE|no|NO|off|OFF)
    gatelm_log "Using the prebuilt AI Service image selected in .env."
    ;;
  *)
    gatelm_fail "AZURE_PII_BUILD_AI_SERVICE must be true or false."
    ;;
esac

gatelm_log "Starting the Microsoft PII container."
if ! azure_pii_compose up -d azure-pii; then
  gatelm_fail "The Microsoft PII container could not start. Check the Azure billing resource and sanitized container logs."
fi

azure_pii_port="${SELFHOST_AZURE_PII_PORT:-5000}"
gatelm_wait_for_http \
  "Microsoft PII container readiness" \
  "http://127.0.0.1:${azure_pii_port}/ready" \
  90

gatelm_log "Recreating AI Service and Gateway with the Azure PII backend enabled."
if ! azure_pii_compose up -d --force-recreate ai-service gateway-core; then
  gatelm_fail "AI Service or Gateway could not start with Azure PII enabled. Check sanitized service logs."
fi
gatelm_wait_for_http \
  "AI Service readiness" \
  "http://127.0.0.1:${SELFHOST_AI_SERVICE_PORT}/readyz" \
  90

gatelm_log "Azure PII deployment path is ready. Next run: bash scripts/azure-pii-smoke.sh"
