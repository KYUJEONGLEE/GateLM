#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_TRIAGE_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
LIB_PATH="${AWS_TRIAGE_DIR}/scripts/prod-clone-lib.sh"
COMPOSE_PATH="${AWS_TRIAGE_DIR}/docker-compose.prod-clone.yml"
SMOKE_PATH="${AWS_TRIAGE_DIR}/scripts/prod-clone-smoke.sh"
GATEWAY_VERIFY_PATH="${AWS_TRIAGE_DIR}/scripts/prod-clone-verify-gateway.sh"
IAM_VERIFY_PATH="${AWS_TRIAGE_DIR}/scripts/prod-clone-verify-iam.sh"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

base_env="${tmp_dir}/base.env"
overlay_env="${tmp_dir}/overlay.env"
cp "${AWS_TRIAGE_DIR}/.env.example" "${base_env}"
cp "${AWS_TRIAGE_DIR}/prod-clone.env.example" "${overlay_env}"
chmod 600 "${base_env}" "${overlay_env}"

validate_env() {
  local candidate="$1"
  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-/tmp}" \
    GATELM_PROD_CLONE_BASE_ENV_FILE="${base_env}" \
    GATELM_PROD_CLONE_ENV_FILE="${candidate}" \
    LIB_PATH="${LIB_PATH}" \
    bash -c 'source "${LIB_PATH}"; clone_load_env; clone_validate_env'
}

validate_env "${overlay_env}" >/dev/null

mismatched_sha="${tmp_dir}/mismatched-sha.env"
cp "${overlay_env}" "${mismatched_sha}"
sed -i 's/GATELM_PROD_CLONE_DB_SOURCE_SHA=13d2964fe76e074e4e61f03ece588794fe0cc5e4/GATELM_PROD_CLONE_DB_SOURCE_SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/' "${mismatched_sha}"
if validate_env "${mismatched_sha}" >"${tmp_dir}/mismatch.out" 2>&1; then
  printf '%s\n' "expected application/database SHA mismatch to fail" >&2
  exit 1
fi
grep -Fq 'Application and database source SHAs must match' "${tmp_dir}/mismatch.out"

live_provider="${tmp_dir}/live-provider.env"
cp "${overlay_env}" "${live_provider}"
sed -i 's/GATELM_PROD_CLONE_ALLOW_LIVE_PROVIDER=false/GATELM_PROD_CLONE_ALLOW_LIVE_PROVIDER=true/' "${live_provider}"
if validate_env "${live_provider}" >"${tmp_dir}/live-provider.out" 2>&1; then
  printf '%s\n' "expected live Provider permission during benchmark to fail" >&2
  exit 1
fi
grep -Fq 'Live Provider traffic must be disabled' "${tmp_dir}/live-provider.out"

smtp_enabled="${tmp_dir}/smtp-enabled.env"
cp "${overlay_env}" "${smtp_enabled}"
sed -i 's/GATELM_PROD_CLONE_ALLOW_SMTP=false/GATELM_PROD_CLONE_ALLOW_SMTP=true/' "${smtp_enabled}"
if validate_env "${smtp_enabled}" >"${tmp_dir}/smtp.out" 2>&1; then
  printf '%s\n' "expected SMTP permission during benchmark to fail" >&2
  exit 1
fi
grep -Fq 'SMTP must be disabled' "${tmp_dir}/smtp.out"

bad_latency="${tmp_dir}/bad-latency.env"
cp "${overlay_env}" "${bad_latency}"
sed -i 's/MOCK_PROVIDER_DEFAULT_LATENCY_MS=100/MOCK_PROVIDER_DEFAULT_LATENCY_MS=50/' "${bad_latency}"
if validate_env "${bad_latency}" >"${tmp_dir}/latency.out" 2>&1; then
  printf '%s\n' "expected non-100ms Mock latency to fail" >&2
  exit 1
fi
grep -Fq 'require exactly 100ms Mock latency' "${tmp_dir}/latency.out"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  for role in data rag gateway ai edge; do
    docker compose \
      --env-file "${base_env}" \
      --env-file "${overlay_env}" \
      -f "${COMPOSE_PATH}" \
      --profile "${role}" \
      config --quiet
  done
  docker compose \
    --env-file "${base_env}" \
    --env-file "${overlay_env}" \
    -f "${AWS_TRIAGE_DIR}/docker-compose.prod-clone.restore.yml" \
    config --quiet
fi

grep -Fq 'name: gatelm-prod-clone' "${COMPOSE_PATH}"
grep -Fq 'name: ${GATELM_PROD_CLONE_POSTGRES_VOLUME_NAME:-gatelm-prod-clone-postgres-data}' "${COMPOSE_PATH}"
grep -Fq 'name: ${GATELM_PROD_CLONE_REDIS_VOLUME_NAME:-gatelm-prod-clone-redis-data}' "${COMPOSE_PATH}"
grep -Fq 'profiles: [data, rag]' "${COMPOSE_PATH}"
grep -Fq 'profiles: [rag]' "${COMPOSE_PATH}"
grep -Fq 'scripts/dev/fast-noop-mock-provider.mjs' "${COMPOSE_PATH}"
grep -Fq 'FAST_NOOP_MOCK_DEFAULT_LATENCY_MS: ${MOCK_PROVIDER_DEFAULT_LATENCY_MS}' "${COMPOSE_PATH}"
if grep -Fq 'GATEWAY_AUTH_CACHE_TTL_MS' "${COMPOSE_PATH}"; then
  printf '%s\n' "13d2964f base Compose must not contain the later auth-cache config" >&2
  exit 1
fi
grep -Fq 'GATEWAY_AUTH_CACHE_TTL_MS: ${GATEWAY_AUTH_CACHE_TTL_MS:-5000}' "${AWS_TRIAGE_DIR}/docker-compose.prod-clone.auth-cache.yml"
grep -Fq 'clone_assert_tcp "Chat API" "${GATELM_PROD_CLONE_DATA_PRIVATE_IP}" 3003' "${SMOKE_PATH}"
if grep -Eq 'clone_assert_tcp .* (8081|8001)' "${SMOKE_PATH}"; then
  printf '%s\n' "Edge smoke must not probe Private Gateway or AI ports forbidden by the security groups" >&2
  exit 1
fi
grep -Fq 'providerCalled") is not True' "${GATEWAY_VERIFY_PATH}"
grep -Fq 'Gateway SSE stream did not contain JSON data and [DONE].' "${GATEWAY_VERIFY_PATH}"
grep -Fq 'Gateway SSE stream did not confirm Mock provider execution.' "${GATEWAY_VERIFY_PATH}"
grep -Fq 'Mock Provider did not record exactly one call for the request.' "${GATEWAY_VERIFY_PATH}"
grep -Fq "count(*) filter (where metadata #>> '{domainOutcomes,logging,outcome}' = 'written')" "${GATEWAY_VERIFY_PATH}"
grep -Fq 'provider_credentials_decrypted' "${AWS_TRIAGE_DIR}/scripts/prod-clone-verify-db.sh"
grep -Fq "decryptProviderCredential" "${AWS_TRIAGE_DIR}/scripts/prod-clone-verify-db.sh"
grep -Fq 'Original production snapshots are never selected.' "${AWS_TRIAGE_DIR}/scripts/prod-clone-bootstrap-benchmark.sh"
grep -Fq 'service.providerCatalogMatchesRef' "${AWS_TRIAGE_DIR}/scripts/prod-clone-bootstrap-benchmark.sh"
grep -Fq 'prod-clone-runtime-iam-smoke/' "${IAM_VERIFY_PATH}"
grep -Fq "require('@aws-sdk/client-s3')" "${IAM_VERIFY_PATH}"
grep -Fq 'RAG Worker container S3 Put/Get/Delete and KMS-through-S3 access passed' "${IAM_VERIFY_PATH}"
grep -Fq 'drain for at least 70 seconds' "${AWS_TRIAGE_DIR}/README.md"

printf '%s\n' "production-clone validation tests passed"
