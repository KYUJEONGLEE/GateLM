#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELFHOST_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_FILE="${SELFHOST_DIR}/docker-compose.yml"
RAG_COMPOSE_FILE="${SELFHOST_DIR}/docker-compose.rag.yml"
ENV_EXAMPLE="${SELFHOST_DIR}/.env.example"
INSTALL_SCRIPT="${SCRIPT_DIR}/install.sh"
LIB_SCRIPT="${SCRIPT_DIR}/lib.sh"
SMOKE_SCRIPT="${SCRIPT_DIR}/smoke-test.sh"
README_FILE="${SELFHOST_DIR}/README.md"
INSTALL_DOC="${SELFHOST_DIR}/docs/install.md"
UPGRADE_DOC="${SELFHOST_DIR}/docs/upgrade.md"
BACKUP_DOC="${SELFHOST_DIR}/docs/backup-restore.md"

fail() {
  printf '%s\n' "[selfhost-rag-wiring-test] ERROR: $*" >&2
  exit 1
}

for script in \
  "${INSTALL_SCRIPT}" \
  "${LIB_SCRIPT}" \
  "${SMOKE_SCRIPT}" \
  "${SCRIPT_DIR}/migrate.sh" \
  "${SCRIPT_DIR}/seed.sh"
do
  bash -n "${script}"
done

for service in rag-worker chat-api chat-web; do
  grep -Fq "  ${service}:" "${RAG_COMPOSE_FILE}" || \
    fail "Self-host RAG Compose service is missing: ${service}"
  if grep -Fq "  ${service}:" "${COMPOSE_FILE}"; then
    fail "RAG-only service leaked into the default-off Compose file: ${service}"
  fi
  grep -Fq "${service}" "${INSTALL_SCRIPT}" || \
    fail "Self-host install does not start service: ${service}"
done

for required_setting in \
  'command: ["node", "dist/src/rag-worker.js"]' \
  'RAG_WORKER_AI_SERVICE_BASE_URL: http://ai-service:8001' \
  'RAG_WORKER_GATEWAY_BASE_URL: http://gateway-core:8081' \
  'RAG_WORKER_EMBEDDING_SIGNING_JWK_FILE: /run/secrets/rag/worker-signing.jwk.json' \
  'RAG_WORKER_EMBEDDING_BINDING_HMAC_KEYS_FILE: /run/secrets/rag/worker-binding-hmac-keys.json' \
  'RAG_QUERY_EMBEDDING_SIGNING_JWK_FILE: /run/secrets/rag/query-signing.jwk.json' \
  'RAG_QUERY_EMBEDDING_BINDING_HMAC_KEYS_FILE: /run/secrets/rag/query-binding-hmac-keys.json' \
  'RAG_EMBEDDING_WORKLOAD_JWKS_FILE: /run/secrets/rag/workload-jwks.json' \
  'RAG_EMBEDDING_BINDING_HMAC_KEYS_FILE: /run/secrets/rag/workload-binding-hmac-keys.json' \
  'RAG_EMBEDDING_WORKLOAD_IDENTITIES_FILE: /run/secrets/rag/workload-identities.json' \
  'TENANT_CHAT_WORKLOAD_SIGNING_JWK_FILE: /run/secrets/tenant-chat/signing.jwk.json' \
  'TENANT_CHAT_PRIVATE_GATEWAY_ENABLED: "true"'
do
  grep -Fq "${required_setting}" "${RAG_COMPOSE_FILE}" || \
    fail "Self-host role wiring is missing: ${required_setting}"
done

if grep -Fq '/run/secrets/rag/' "${COMPOSE_FILE}" || \
  grep -Fq '/run/secrets/tenant-chat/' "${COMPOSE_FILE}"; then
  fail "Default-off Compose must not mount RAG or Tenant Chat role secrets"
fi

for isolated_target in \
  '/run/secrets/rag/query-signing.jwk.json' \
  '/run/secrets/rag/query-binding-hmac-keys.json' \
  '/run/secrets/rag/worker-signing.jwk.json' \
  '/run/secrets/rag/worker-binding-hmac-keys.json' \
  '/run/secrets/rag/workload-jwks.json' \
  '/run/secrets/rag/workload-binding-hmac-keys.json' \
  '/run/secrets/rag/workload-identities.json'
do
  [[ "$(grep -Fc "target: ${isolated_target}" "${RAG_COMPOSE_FILE}")" == "1" ]] || \
    fail "Role-specific RAG secret must have exactly one mount: ${isolated_target}"
done
[[ "$(grep -Fc 'target: /run/secrets/rag/content-wrapping-keys.json' "${RAG_COMPOSE_FILE}")" == "2" ]] || \
  fail "Wrapping keys must be mounted only into Control Plane API and RAG worker"
[[ "$(grep -Fc 'user: "${TENANT_CHAT_RUNTIME_UID:-1000}:${TENANT_CHAT_RUNTIME_GID:-1000}"' "${RAG_COMPOSE_FILE}")" == "4" ]] || \
  fail "Every file-backed secret consumer must use the validated runtime UID/GID"

for required_env in \
  TENANT_CHAT_RUNTIME_UID \
  TENANT_CHAT_RUNTIME_GID \
  TENANT_CHAT_CONTROL_PLANE_SERVICE_TOKEN \
  TENANT_CHAT_WEB_SERVICE_TOKEN \
  TENANT_CHAT_ACCESS_JWT_SECRET \
  TENANT_CHAT_INTENT_SECRET \
  TENANT_CHAT_WORKLOAD_ACTIVE_KID \
  RAG_QUERY_EMBEDDING_ACTIVE_KID \
  RAG_WORKER_EMBEDDING_ACTIVE_KID
do
  grep -Eq "^${required_env}=" "${ENV_EXAMPLE}" || \
    fail "Self-host env example is missing ${required_env}"
done

grep -Fq 'gatelm_validate_selfhost_secret_files' "${INSTALL_SCRIPT}" || \
  fail "Install must fail before startup when file-backed secrets are unavailable"
grep -Fq 'if [[ "${TENANT_CHAT_RAG_ENABLED}" == "true" ]]' "${INSTALL_SCRIPT}" || \
  fail "Install must gate RAG-only dependencies and services on the feature flag"
grep -Fq 'SELFHOST_RAG_COMPOSE_FILE' "${LIB_SCRIPT}" || \
  fail "Self-host scripts must select the RAG Compose overlay only when enabled"
if TENANT_CHAT_RAG_ENABLED=false RAG_OBJECT_STORE_DRIVER=fake \
  bash -c 'source "$1"; gatelm_validate_rag_runtime_env' _ "${LIB_SCRIPT}" \
    >/dev/null 2>&1; then
  fail "Default-off self-host must still reject an explicitly configured fake store"
fi
if TENANT_CHAT_RAG_ENABLED=false AWS_ACCESS_KEY_ID=should-not-be-used \
  bash -c 'source "$1"; gatelm_validate_rag_runtime_env' _ "${LIB_SCRIPT}" \
    >/dev/null 2>&1; then
  fail "Default-off self-host must still reject static AWS credentials"
fi
if TENANT_CHAT_RAG_ENABLED=true RAG_OBJECT_STORE_DRIVER=s3 \
  RAG_S3_REGION= RAG_S3_BUCKET= RAG_S3_KMS_KEY_ID= \
  bash -c 'source "$1"; gatelm_validate_rag_runtime_env' _ "${LIB_SCRIPT}" \
    >/dev/null 2>&1; then
  fail "Enabled self-host RAG must fail before startup when S3 settings are missing"
fi
grep -Fq 'gatelm_require_strong_secret_values' "${INSTALL_SCRIPT}" || \
  fail "Install must reject placeholder Tenant Chat and AI service tokens"
grep -Fq 'gatelm_wait_for_compose_service "RAG worker" "rag-worker"' "${SMOKE_SCRIPT}" || \
  fail "Smoke test must cover RAG worker health"
grep -Fq 'gatelm_wait_for_compose_service "Chat API" "chat-api"' "${SMOKE_SCRIPT}" || \
  fail "Smoke test must cover Chat API health"

for file in "${README_FILE}" "${INSTALL_DOC}" "${UPGRADE_DOC}"; do
  grep -Fq 'rag-worker' "${file}" || fail "RAG worker is missing from operational docs: ${file}"
  grep -Fq 'chat-api' "${file}" || fail "Chat API is missing from operational docs: ${file}"
  grep -Fq 'chat-web' "${file}" || fail "Chat Web is missing from operational docs: ${file}"
done
grep -Fq 'rag-worker' "${BACKUP_DOC}" || \
  fail "Restore write-quiescing instructions must stop the RAG worker"

for service in control-plane-api gateway-core ai-service rag-worker chat-api; do
  awk -v service="${service}" '
    $0 == "  " service ":" { in_service=1; next }
    in_service && /^  [[:alnum:]_-]+:$/ { exit }
    in_service && /TENANT_CHAT_RAG_ENABLED: "true"/ { found=1 }
    END { if (!found) exit 1 }
  ' "${RAG_COMPOSE_FILE}" || \
    fail "RAG overlay must enable the shared global flag for ${service}"
done

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose \
    --env-file "${ENV_EXAMPLE}" \
    -f "${COMPOSE_FILE}" \
    config --quiet
  default_services="$(
    docker compose \
      --env-file "${ENV_EXAMPLE}" \
      -f "${COMPOSE_FILE}" \
      config --services
  )"
  for service in postgres redis mock-provider control-plane-api gateway-core ai-service web; do
    grep -Fxq "${service}" <<<"${default_services}" || \
      fail "Default-off Compose lost an existing service: ${service}"
  done
  for service in rag-worker chat-api chat-web; do
    if grep -Fxq "${service}" <<<"${default_services}"; then
      fail "Default-off Compose unexpectedly starts a RAG-only service: ${service}"
    fi
  done

  TENANT_CHAT_RAG_ENABLED=true docker compose \
    --env-file "${ENV_EXAMPLE}" \
    -f "${COMPOSE_FILE}" \
    -f "${RAG_COMPOSE_FILE}" \
    config --quiet
fi

printf '%s\n' "[selfhost-rag-wiring-test] all checks passed"
