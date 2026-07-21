#!/usr/bin/env bash
set -euo pipefail

# Replays bounded Project/Application analytics fields from PostgreSQL into the
# ReplacingMergeTree. Source prompts, responses, credentials, and raw employee
# identities are never selected into the temporary JSONEachRow file.

required=(DATABASE_URL CLICKHOUSE_URL CLICKHOUSE_USERNAME CLICKHOUSE_PASSWORD CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET BACKFILL_FROM BACKFILL_TO)
for name in "${required[@]}"; do
  [[ -n "${!name:-}" ]] || { echo "${name} is required." >&2; exit 1; }
done
[[ ${#CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET} -ge 32 ]] || { echo "ClickHouse employee identity HMAC secret is too short." >&2; exit 1; }
[[ "${CLICKHOUSE_USERNAME}${CLICKHOUSE_PASSWORD}" != *$'\n'* && "${CLICKHOUSE_USERNAME}${CLICKHOUSE_PASSWORD}" != *'"'* ]] || {
  echo "ClickHouse credentials contain unsupported characters." >&2
  exit 1
}
if [[ -n "${BACKFILL_TENANT_ID:-}" && ! "${BACKFILL_TENANT_ID}" =~ ^[0-9a-fA-F-]{36}$ ]]; then
  echo "BACKFILL_TENANT_ID must be a UUID when provided." >&2
  exit 1
fi
command -v psql >/dev/null 2>&1 || { echo "psql is required." >&2; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "curl is required." >&2; exit 1; }

payload_file="$(mktemp)"
curl_config_file="$(mktemp)"
chmod 0600 "${payload_file}" "${curl_config_file}"
cleanup() {
  rm -f -- "${payload_file}" "${curl_config_file}"
}
trap cleanup EXIT

tenant_predicate=""
if [[ -n "${BACKFILL_TENANT_ID:-}" ]]; then
  tenant_predicate="AND tenant_id = :'tenant_id'::uuid"
fi

export PGOPTIONS="${PGOPTIONS:-} -c gatelm.employee_identity_hmac_secret=${CLICKHOUSE_EMPLOYEE_IDENTITY_HMAC_SECRET}"
psql "${DATABASE_URL}" -X -v ON_ERROR_STOP=1 \
  -v from_utc="${BACKFILL_FROM}" \
  -v to_utc="${BACKFILL_TO}" \
  -v tenant_id="${BACKFILL_TENANT_ID:-00000000-0000-0000-0000-000000000000}" \
  -c "COPY (
WITH source AS (
  SELECT
    logs.*,
    coalesce(nullif(metadata #>> '{terminalStatus}', ''), nullif(metadata #>> '{gatewayStageOutcomes,terminalStatus}', ''), status) AS canonical_terminal_status,
    coalesce(nullif(metadata #>> '{domainOutcomes,fallback,outcome}', ''), nullif(metadata #>> '{gatewayStageOutcomes,domainOutcomes,fallback,outcome}', ''), 'not_called') AS canonical_fallback_outcome,
    coalesce(nullif(metadata #>> '{domainOutcomes,safety,outcome}', ''), nullif(metadata #>> '{gatewayStageOutcomes,domainOutcomes,safety,outcome}', ''), CASE coalesce(nullif(masking_action, ''), 'none') WHEN 'blocked' THEN 'blocked' WHEN 'redacted' THEN 'redacted' ELSE 'passed' END) AS canonical_safety_outcome,
    coalesce(nullif(metadata #>> '{domainOutcomes,budget,outcome}', ''), nullif(metadata #>> '{gatewayStageOutcomes,domainOutcomes,budget,outcome}', ''), 'not_checked') AS canonical_budget_outcome,
    coalesce(nullif(metadata #>> '{budgetScope,budgetScopeType}', ''), 'application') AS canonical_budget_scope_type,
    coalesce(nullif(metadata #>> '{budgetScope,budgetScopeId}', ''), application_id::text) AS canonical_budget_scope_id,
    coalesce(nullif(metadata #>> '{budgetScope,resolvedBy}', ''), 'default_application') AS canonical_budget_scope_resolved_by,
    coalesce(nullif(metadata #>> '{employeePolicyDecision,employeeId}', ''), nullif(end_user_id, '')) AS employee_identity,
    (extract(epoch FROM clock_timestamp()) * 1000000000)::numeric::bigint + row_number() OVER (ORDER BY created_at, request_id) AS replay_version
  FROM p0_llm_invocation_logs logs
  WHERE created_at >= :'from_utc'::timestamptz
    AND created_at < :'to_utc'::timestamptz
    ${tenant_predicate}
)
SELECT json_build_object(
  'request_id', request_id,
  'tenant_id', tenant_id,
  'project_id', project_id,
  'application_id', application_id,
  'employee_identity_hash', CASE WHEN employee_identity IS NULL THEN '' ELSE encode(hmac(lower(btrim(employee_identity)), current_setting('gatelm.employee_identity_hmac_secret'), 'sha256'), 'hex') END,
  'provider', coalesce(provider, ''),
  'model', coalesce(model, ''),
  'status', coalesce(status, ''),
  'http_status', greatest(coalesce(http_status, 0), 0),
  'prompt_tokens', greatest(coalesce(prompt_tokens, 0), 0),
  'completion_tokens', greatest(coalesce(completion_tokens, 0), 0),
  'total_tokens', greatest(coalesce(total_tokens, 0), 0),
  'cost_micro_usd', greatest(coalesce(cost_micro_usd, 0), 0),
  'saved_cost_micro_usd', CASE WHEN saved_cost_micro_usd >= 0 THEN saved_cost_micro_usd ELSE NULL END,
  'latency_ms', greatest(coalesce(latency_ms, 0), 0),
  'cache_status', coalesce(cache_status, ''),
  'routing_category', coalesce(metadata #>> '{promptCategory}', ''),
  'routing_difficulty', coalesce(metadata #>> '{promptDifficulty}', ''),
  'terminal_status', canonical_terminal_status,
  'fallback_outcome', canonical_fallback_outcome,
  'safety_outcome', canonical_safety_outcome,
  'budget_outcome', canonical_budget_outcome,
  'masking_action', coalesce(nullif(masking_action, ''), 'none'),
  'provider_called', CASE lower(coalesce(metadata #>> '{providerCalled}', 'false')) WHEN 'true' THEN 1 WHEN '1' THEN 1 ELSE 0 END,
  'budget_scope_type', canonical_budget_scope_type,
  'budget_scope_id', canonical_budget_scope_id,
  'budget_scope_resolved_by', canonical_budget_scope_resolved_by,
  'created_at', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS'),
  'ingested_at', to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS'),
  'ingest_version', replay_version
)::text
FROM source
ORDER BY created_at, request_id
) TO STDOUT" > "${payload_file}"

row_count="$(wc -l < "${payload_file}" | tr -d ' ')"
if [[ "${row_count}" == "0" ]]; then
  echo "No PostgreSQL rows matched the requested UTC interval."
  exit 0
fi

clickhouse_endpoint="${CLICKHOUSE_URL%/}/?query=INSERT%20INTO%20analytics.llm_invocations%20FORMAT%20JSONEachRow"
cat > "${curl_config_file}" <<EOF
url = "${clickhouse_endpoint}"
user = "${CLICKHOUSE_USERNAME}:${CLICKHOUSE_PASSWORD}"
request = "POST"
fail-with-body
silent
show-error
connect-timeout = 3
max-time = 300
EOF

curl --config "${curl_config_file}" \
  --header "Content-Type: application/x-ndjson" \
  --data-binary "@${payload_file}"

echo "Backfilled ${row_count} bounded analytics rows."
echo "UTC range: ${BACKFILL_FROM} <= created_at < ${BACKFILL_TO}"
if [[ -n "${BACKFILL_TENANT_ID:-}" ]]; then
  echo "Tenant: ${BACKFILL_TENANT_ID}"
fi
