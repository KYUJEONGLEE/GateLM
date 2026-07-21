#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SCRIPT_PATH="${ROOT_DIR}/deploy/aws-triage/scripts/clickhouse-backfill-general-analytics.sh"
TEST_DIR="$(mktemp -d)"
cleanup() {
  rm -rf -- "${TEST_DIR}"
}
trap cleanup EXIT

mkdir -p "${TEST_DIR}/bin"
cat > "${TEST_DIR}/bin/psql" <<'PSQL'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "${TEST_CAPTURE_DIR}/psql-args"
cat > "${TEST_CAPTURE_DIR}/psql-stdin"
printf '%s\n' '{"request_id":"request_test"}'
PSQL
cat > "${TEST_DIR}/bin/curl" <<'CURL'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "${TEST_CAPTURE_DIR}/curl-args"
CURL
chmod +x "${TEST_DIR}/bin/psql" "${TEST_DIR}/bin/curl"

output="$(
  PATH="${TEST_DIR}/bin:${PATH}" \
  TEST_CAPTURE_DIR="${TEST_DIR}" \
  DATABASE_URL='postgresql://user:password@postgres:5432/gatelm?schema=public&sslmode=disable' \
  CLICKHOUSE_URL='http://clickhouse:8123' \
  CLICKHOUSE_USERNAME='analytics_writer' \
  CLICKHOUSE_PASSWORD='a-valid-writer-password' \
  CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET='0123456789abcdef0123456789abcdef' \
  BACKFILL_FROM='2026-07-18T00:00:00Z' \
  BACKFILL_TO='2026-07-22T00:00:00Z' \
  BACKFILL_TENANT_ID='f6bae8b8-f8d7-4c67-963a-6757f7a4c97c' \
  bash "${SCRIPT_PATH}"
)"

first_psql_arg="$(head -n 1 "${TEST_DIR}/psql-args")"
[[ "${first_psql_arg}" == 'postgresql://user:password@postgres:5432/gatelm?sslmode=disable' ]] || {
  echo "Prisma schema query parameter was not removed safely: ${first_psql_arg}" >&2
  exit 1
}
if grep -Fxq -- '-c' "${TEST_DIR}/psql-args"; then
  echo 'Backfill SQL must be sent through stdin so psql variables are expanded.' >&2
  exit 1
fi
grep -Fq "created_at >= :'from_utc'::timestamptz" "${TEST_DIR}/psql-stdin"
grep -Fq "tenant_id = :'tenant_id'::uuid" "${TEST_DIR}/psql-stdin"
grep -Fq "'requested_model', coalesce(requested_model, '')" "${TEST_DIR}/psql-stdin"
grep -Fq "'gateway_internal_latency_ms'" "${TEST_DIR}/psql-stdin"
grep -Fq "'cache_type', coalesce(cache_type, 'none')" "${TEST_DIR}/psql-stdin"
grep -Fq ') TO STDOUT;' "${TEST_DIR}/psql-stdin"
grep -Fq -- '--data-binary' "${TEST_DIR}/curl-args"
grep -Fq 'Backfilled 1 bounded analytics rows.' <<<"${output}"

echo 'ClickHouse general analytics backfill regression test passed.'
