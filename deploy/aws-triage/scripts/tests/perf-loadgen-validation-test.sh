#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PERF_SCRIPTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNNER_PATH="${PERF_SCRIPTS_DIR}/perf-loadgen-run.sh"

grep -Fq 'safe.directory=${REPO_ROOT}' "${RUNNER_PATH}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "${tmp_dir}"' EXIT

run_with_env_file() {
  local env_file="$1"
  env -i \
    PATH="${PATH}" \
    HOME="${HOME:-/tmp}" \
    GATELM_LOADGEN_ENV_FILE="${env_file}" \
    bash "${RUNNER_PATH}"
}

forbidden_key_env="${tmp_dir}/forbidden-key.env"
printf '%s\n' \
  'GATELM_LOADGEN_GATEWAY_BASE_URL=http://10.0.0.10:18080' \
  'GATELM_DEMO_API_KEY=gsk_perf_test' \
  'GATELM_DEMO_APP_TOKEN=gat_perf_test' \
  'POSTGRES_PASSWORD=must-not-be-copied' \
  > "${forbidden_key_env}"
chmod 600 "${forbidden_key_env}"
if run_with_env_file "${forbidden_key_env}" > "${tmp_dir}/forbidden-key.out" 2>&1; then
  printf '%s\n' "expected a forbidden load-generator key to fail" >&2
  exit 1
fi
grep -Fq 'forbidden key: POSTGRES_PASSWORD' "${tmp_dir}/forbidden-key.out"

public_http_env="${tmp_dir}/public-http.env"
printf '%s\n' \
  'GATELM_LOADGEN_GATEWAY_BASE_URL=http://8.8.8.8:18080' \
  'GATELM_DEMO_API_KEY=gsk_perf_test' \
  'GATELM_DEMO_APP_TOKEN=gat_perf_test' \
  > "${public_http_env}"
chmod 600 "${public_http_env}"
if run_with_env_file "${public_http_env}" > "${tmp_dir}/public-http.out" 2>&1; then
  printf '%s\n' "expected a public HTTP load target to fail" >&2
  exit 1
fi
grep -Fq 'Plain HTTP load targets must use an exact RFC1918 private IPv4 address' \
  "${tmp_dir}/public-http.out"

open_permissions_env="${tmp_dir}/open-permissions.env"
printf '%s\n' \
  'GATELM_LOADGEN_GATEWAY_BASE_URL=http://10.0.0.10:18080' \
  'GATELM_DEMO_API_KEY=gsk_perf_test' \
  'GATELM_DEMO_APP_TOKEN=gat_perf_test' \
  > "${open_permissions_env}"
chmod 644 "${open_permissions_env}"
if run_with_env_file "${open_permissions_env}" > "${tmp_dir}/open-permissions.out" 2>&1; then
  printf '%s\n' "expected open load-generator env permissions to fail" >&2
  exit 1
fi
grep -Fq 'permissions are too open' "${tmp_dir}/open-permissions.out"

printf '%s\n' "load-generator validation tests passed"
