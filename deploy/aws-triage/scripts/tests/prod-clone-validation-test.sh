#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_TRIAGE_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
NODE_BIN="${NODE_BIN:-node}"
LIB_PATH="${AWS_TRIAGE_DIR}/scripts/prod-clone-lib.sh"
COMPOSE_PATH="${AWS_TRIAGE_DIR}/docker-compose.prod-clone.yml"
SMOKE_PATH="${AWS_TRIAGE_DIR}/scripts/prod-clone-smoke.sh"
GATEWAY_VERIFY_PATH="${AWS_TRIAGE_DIR}/scripts/prod-clone-verify-gateway.sh"
IAM_VERIFY_PATH="${AWS_TRIAGE_DIR}/scripts/prod-clone-verify-iam.sh"
LOADGEN_EXPORT_PATH="${AWS_TRIAGE_DIR}/scripts/prod-clone-export-loadgen-env.sh"
CADDY_ONE_PATH="${AWS_TRIAGE_DIR}/Caddyfile.prod-clone.rehearsal"
CADDY_TWO_PATH="${AWS_TRIAGE_DIR}/Caddyfile.prod-clone.rehearsal.gateway-2"

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

invalid_sha="${tmp_dir}/invalid-sha.env"
cp "${overlay_env}" "${invalid_sha}"
sed -i 's/GATELM_PROD_CLONE_DB_SOURCE_SHA=9936521039a6ace9d3ed32508c1fc92e89da61e2/GATELM_PROD_CLONE_DB_SOURCE_SHA=not-a-sha/' "${invalid_sha}"
if validate_env "${invalid_sha}" >"${tmp_dir}/invalid-sha.out" 2>&1; then
  printf '%s\n' "expected an invalid database source SHA to fail" >&2
  exit 1
fi
grep -Fq 'GATELM_PROD_CLONE_DB_SOURCE_SHA must be a full lowercase Git SHA' "${tmp_dir}/invalid-sha.out"

auth_cache_disabled="${tmp_dir}/auth-cache-disabled.env"
cp "${overlay_env}" "${auth_cache_disabled}"
sed -i 's/GATELM_PROD_CLONE_AUTH_CACHE_CONFIG=true/GATELM_PROD_CLONE_AUTH_CACHE_CONFIG=false/' "${auth_cache_disabled}"
if validate_env "${auth_cache_disabled}" >"${tmp_dir}/auth-cache.out" 2>&1; then
  printf '%s\n' "expected disabled auth cache parity configuration to fail" >&2
  exit 1
fi
grep -Fq 'Production-parity evidence requires the deployed auth cache configuration' "${tmp_dir}/auth-cache.out"

gateway_two="${tmp_dir}/gateway-two.env"
cp "${overlay_env}" "${gateway_two}"
sed -i 's/GATELM_PROD_CLONE_GATEWAY_COUNT=1/GATELM_PROD_CLONE_GATEWAY_COUNT=2/' "${gateway_two}"
sed -i 's#GATELM_PROD_CLONE_CADDYFILE=./Caddyfile.prod-clone.rehearsal#GATELM_PROD_CLONE_CADDYFILE=./Caddyfile.prod-clone.rehearsal.gateway-2#' "${gateway_two}"
validate_env "${gateway_two}" >/dev/null

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
grep -Fq 'requires exactly 100ms Mock latency' "${tmp_dir}/latency.out"

bad_profile="${tmp_dir}/bad-profile.env"
cp "${overlay_env}" "${bad_profile}"
sed -i 's/GATELM_PROD_CLONE_MOCK_LATENCY_PROFILE=control_100ms/GATELM_PROD_CLONE_MOCK_LATENCY_PROFILE=uncontrolled/' "${bad_profile}"
if validate_env "${bad_profile}" >"${tmp_dir}/profile.out" 2>&1; then
  printf '%s\n' "expected an unknown Mock latency profile to fail" >&2
  exit 1
fi
grep -Fq 'Unsupported production-clone Mock latency profile' "${tmp_dir}/profile.out"

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
grep -Fq 'mock-provider-upstream:' "${COMPOSE_PATH}"
grep -Fq 'ai-service mock-provider-upstream mock-provider' "${LIB_PATH}"
grep -Fq 'scripts/dev/fast-noop-mock-provider.mjs' "${COMPOSE_PATH}"
grep -Fq 'FAST_NOOP_MOCK_DEFAULT_LATENCY_MS: "0"' "${COMPOSE_PATH}"
grep -Fq 'prod-clone-mock-latency-shaper.mjs' "${COMPOSE_PATH}"
grep -Fq 'PROD_CLONE_MOCK_SHAPER_PROFILE: ${GATELM_PROD_CLONE_MOCK_LATENCY_PROFILE}' "${COMPOSE_PATH}"
grep -Fq 'provider-latency-profiles.json' "${COMPOSE_PATH}"
grep -Fq 'safe.directory=${GATELM_PROD_CLONE_BUILD_CONTEXT}' "${LIB_PATH}"
grep -Fq 'clone_assert_role_host "${role}"' "${AWS_TRIAGE_DIR}/scripts/prod-clone-up.sh"
grep -Fq 'GATEWAY_AUTH_CACHE_ENABLED: ${GATEWAY_AUTH_CACHE_ENABLED:-true}' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AUTH_CACHE_TTL_MS: ${GATEWAY_AUTH_CACHE_TTL_MS:-5000}' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AUTH_CACHE_MAX_ENTRIES: ${GATEWAY_AUTH_CACHE_MAX_ENTRIES:-4096}' "${COMPOSE_PATH}"
grep -Fq 'GATEWAY_AUTH_CACHE_TTL_MS: ${GATEWAY_AUTH_CACHE_TTL_MS:-5000}' "${AWS_TRIAGE_DIR}/docker-compose.prod-clone.auth-cache.yml"
grep -Fq 'clone_assert_tcp "Chat API" "${GATELM_PROD_CLONE_DATA_PRIVATE_IP}" 3003' "${SMOKE_PATH}"
if grep -Eq 'clone_assert_tcp .* (8081|8001)' "${SMOKE_PATH}"; then
  printf '%s\n' "Edge smoke must not probe Private Gateway or AI ports forbidden by the security groups" >&2
  exit 1
fi
grep -Fq 'providerCalled") is not True' "${GATEWAY_VERIFY_PATH}"
grep -Fq 'Mock Provider latency profile ${GATELM_PROD_CLONE_MOCK_LATENCY_PROFILE} attested.' "${GATEWAY_VERIFY_PATH}"
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
grep -Fq 'GATELM_LOADGEN_GATEWAY_BASE_URL=https://${GATELM_PUBLIC_DOMAIN}' "${LOADGEN_EXPORT_PATH}"
grep -Fq 'GATELM_LOADGEN_GATEWAY_METRICS_BASE_URLS=${metrics_urls}' "${LOADGEN_EXPORT_PATH}"
grep -Fq 'GATELM_LOADGEN_EXPECTED_UPSTREAMS=${expected_upstreams}' "${LOADGEN_EXPORT_PATH}"
grep -Fq 'GATELM_PERF_TOPOLOGY_ID=prod_clone_${GATELM_PROD_CLONE_IMAGE_TAG}_gateway_${gateway_count}_${GATELM_PROD_CLONE_MOCK_LATENCY_PROFILE}' "${LOADGEN_EXPORT_PATH}"
grep -Fq 'Only the isolated Edge target, Gateway metrics endpoints, topology ID, and synthetic credentials were written.' "${LOADGEN_EXPORT_PATH}"
grep -Fq 'reverse_proxy {$GATELM_PROD_CLONE_GATEWAY_1_PRIVATE_IP:10.77.1.20}:8080' "${CADDY_ONE_PATH}"
grep -Fq '{$GATELM_PROD_CLONE_GATEWAY_2_PRIVATE_IP:10.77.1.21}:8080' "${CADDY_TWO_PATH}"
grep -Fq 'lb_policy round_robin' "${CADDY_TWO_PATH}"
grep -Fq 'drain for at least 70 seconds' "${AWS_TRIAGE_DIR}/README.md"
"${NODE_BIN}" "${AWS_TRIAGE_DIR}/scripts/tests/prod-clone-mock-latency-shaper.test.mjs"

printf '%s\n' "production-clone validation tests passed"
