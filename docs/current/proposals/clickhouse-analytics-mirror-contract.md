# ClickHouse Analytics Mirror Contract Proposal

| Field | Value |
|---|---|
| Status | Phase 1 mirror through Phase 6 pre-aggregated Project/Application analytics read cutover implementation companion |
| Applies to | Gateway terminal log mirror, ClickHouse analytics storage, employee usage and security reads, project employee policy usage reads, and Project/Application log-based reads |
| Canonical source during mirror phase | PostgreSQL `p0_llm_invocation_logs` |
| Initial read cutover | Explicitly gated employee usage and all Gateway Project/Application log-based reads |

## Problem

Gateway terminal log writes, Dashboard/Rollup source reads, and operational data
share PostgreSQL. Large log volumes can therefore make analytics work compete
with the operational database.

## Phase 1 boundary

Gateway keeps the existing PostgreSQL terminal log writer. When explicitly
enabled, the existing asynchronous log worker invokes a fan-out persistence
writer:

```text
Gateway request completion
  -> existing async log queue
     -> PostgreSQL primary writer
     -> ClickHouse best-effort mirror writer
```

ClickHouse is not a Gateway readiness dependency. A mirror timeout or failure
must not replace the PostgreSQL result and must not fail the user request.
Mirror writes have a short bounded timeout and no automatic retry in this
phase. Success, timeout, and error are exposed only through bounded metrics and
technical logs.

This direct mirror is an interim implementation. The durable target remains an
event queue and consumer with retry, dead-letter handling, and consumer-side
idempotency.

## Stored fields

`analytics.llm_invocations` stores only these aggregation fields:

- `request_id`, `tenant_id`, `project_id`, `application_id`
- `employee_identity_hash`
- `provider`, `model`, `provider_id`, `model_id`, `requested_model`, `model_ref`,
  `routing_reason`, `status`, `http_status`
- `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost_micro_usd`,
  nullable `saved_cost_micro_usd`
- `latency_ms`, nullable `provider_latency_ms`, `gateway_internal_latency_ms`,
  nullable `ttft_ms`, `stream`, `cache_status`, `cache_type`,
  `routing_category`, `routing_difficulty`
- `terminal_status`, `fallback_outcome`, `safety_outcome`, `budget_outcome`
- `masking_action`, `provider_called`
- `budget_scope_type`, `budget_scope_id`, `budget_scope_resolved_by`
- `created_at`, `ingested_at`, `ingest_version`

`employee_identity_hash` is HMAC-SHA256 over the normalized resolved employee
ID when available, otherwise the normalized `end_user_id`. The HMAC secret is
environment-specific and must be at least 32 characters. The source identity
must never be stored in ClickHouse.

## Forbidden data

The mirror payload must not contain raw prompt, raw response, captured prompt
or response, redacted preview, API Key, App Token, Provider credential,
authorization header, provider raw error, source employee identity, email, or
other raw PII.

## Duplicate boundary

The existing asynchronous PostgreSQL writer can fall back from a failed batch
to individual writes. The fan-out writer therefore invokes the ClickHouse
mirror only after the canonical PostgreSQL write succeeds. A failed PostgreSQL
batch is not mirrored before the asynchronous writer retries its individual
rows.

The raw table still uses `ReplacingMergeTree(ingest_version)` ordered by
`tenant_id, request_id` because an ambiguous ClickHouse network failure can
still leave the caller unable to tell whether an insert was accepted.
Reconciliation, backfill sources, and pre-cutover reads must use `FINAL` or an
equivalent latest-version query. An unexplained duplicate blocks rollup
cutover.

## Metrics

- `gatelm_clickhouse_log_writes_total{operation="terminal_mirror",status}`
- `gatelm_clickhouse_log_write_duration_seconds{operation="terminal_mirror",status}`
- `gatelm_clickhouse_analytics_reads_total{endpoint="performance",status}`
- `gatelm_clickhouse_analytics_read_duration_seconds{endpoint="performance",status}`

The bounded `endpoint` values are `logs`, `log_filter_options`, `dashboard`,
`cost`, `performance`, `policy_impact`, `reliability`, and `live_usage`.

Allowed status values are `success`, `timeout`, and `error`. Tenant, project,
employee, and request identifiers are forbidden metric labels.

## Read cutover gate

PostgreSQL remains canonical until the same tenant and UTC interval match for:

- distinct request count and duplicate count
- terminal status counts
- total prompt, completion, and total tokens
- total cost
- provider/model request counts
- employee identity usage
- UTC hourly request counts

Any mirror error, timeout, unexplained duplicate, or aggregate mismatch blocks
Dashboard/Analytics read cutover.

## Phase 2 employee usage read boundary

`GET /admin/v1/tenants/:tenantId/employees/usage` keeps its existing request,
response, cursor, and provenance contract. When
`CLICKHOUSE_ANALYTICS_READ_ENABLED=true`:

- Project/Application request, token, and cost aggregates are read from
  `analytics.llm_invocations FINAL`.
- employee master data and identity candidates remain in PostgreSQL;
  source identities are HMAC-SHA256 hashed in Control Plane memory before they
  are matched to ClickHouse hashes.
- Tenant Chat confirmed usage remains on its existing PostgreSQL raw plus
  employee rollup path because it is not emitted by the Gateway terminal log
  mirror.
- Control Plane authenticates as a separate `analytics_reader` principal with
  `SELECT` on `analytics.*`; it must not reuse the Gateway writer credential or
  hold `INSERT`, DDL, or user-management privileges.
- the enabled path must not query PostgreSQL `p0_llm_invocation_logs`, including
  coverage checks, unattributed usage, cursor pages, and employee cost-policy
  reads.
- a ClickHouse timeout, invalid response, or non-2xx response returns the
  bounded `EMPLOYEE_USAGE_ANALYTICS_UNAVAILABLE` 503 response. It must not
  silently fall back to PostgreSQL raw invocation logs and recreate the
  original operational database incident.

The feature remains disabled by default. Read enablement is permitted only
after interval reconciliation passes and the mirror has no unexplained error,
timeout, or duplicate gap.

## Phase 3 Analytics Performance read boundary

`GET /api/analytics/performance` keeps its existing request and response
contract. When
`GATEWAY_CLICKHOUSE_ANALYTICS_PERFORMANCE_READ_ENABLED=true`:

- Project/Application aggregates, provider/model aggregates, latency buckets,
  and bounded slow-request fields are read from
  `analytics.llm_invocations FINAL`.
- Tenant Chat aggregates remain in PostgreSQL because Tenant Chat completion
  records are not emitted by the Gateway terminal log mirror.
- tenant-level reads execute both sources concurrently and merge the two
  already-aggregated surface results. Project-scoped reads do not query the
  Tenant Chat source.
- combined cross-surface latency percentiles remain unavailable. Percentiles
  are not averaged or otherwise reconstructed from two independently
  aggregated surfaces.
- the Gateway authenticates with the existing read-only `analytics_reader`
  principal, separate from the mirror writer principal.
- a ClickHouse timeout, invalid response, or non-2xx response returns the
  bounded `ANALYTICS_DATA_UNAVAILABLE` 503 response. It must not silently fall
  back to PostgreSQL `p0_llm_invocation_logs`.

The cutover flag is independent from the mirror writer flag and is disabled by
default. Before enabling it for an existing interval, operators must apply
`002_expand_general_analytics.sql`, replay the interval with
`clickhouse-backfill-general-analytics.sh`, and reconcile PostgreSQL and
ClickHouse aggregates. The replay writes a higher `ingest_version`, so
`ReplacingMergeTree ... FINAL` selects the expanded row without deleting the
rollback source in PostgreSQL.

## Phase 4 Project/Application log read boundary

The existing `GATEWAY_CLICKHOUSE_ANALYTICS_PERFORMANCE_READ_ENABLED` gate is
retained for rollback compatibility, but its enabled behavior now covers every
bulk Project/Application log read exposed by Gateway:

- request log list and filter options
- dashboard overview
- cost report
- analytics performance
- analytics policy impact
- analytics reliability

PostgreSQL remains the canonical terminal-log write store. The only Gateway
request-log read intentionally left on PostgreSQL is the tenant/project scoped
`request_id` point detail lookup because ClickHouse deliberately does not store
prompt/response capture, detailed error, or other audit-only fields required by
that response.

Tenant Chat is not emitted by the Gateway terminal-log mirror. Tenant-level
Performance and Reliability views therefore continue to read only the Tenant
Chat branch from PostgreSQL and merge already-aggregated results with the
ClickHouse Project/Application branch. A project-scoped request must not query
the Tenant Chat source.

When the gate is enabled, a ClickHouse error or timeout must return the bounded
analytics-unavailable response. It must never silently execute the equivalent
bulk query against PostgreSQL `p0_llm_invocation_logs`. Operators must apply
`003_expand_project_log_reads.sql` and replay/reconcile the selected interval
before enabling the expanded reader for an existing deployment.

## Phase 5 remaining Control Plane read boundary

When `CLICKHOUSE_ANALYTICS_READ_ENABLED=true`, the remaining Control Plane
Project/Application analytics consumers use `analytics.llm_invocations FINAL`:

- employee security request, masking, and blocking aggregates;
- project employee monthly cost and current UTC-day token display values;
- employee usage ranking and unattributed totals from Phase 2.

Employee master data and project assignments remain in PostgreSQL. Control
Plane hashes identity candidates in memory and sends neither email nor another
source identity to ClickHouse. Tenant Chat security and usage continue to read
their dedicated PostgreSQL tables because Tenant Chat events are not part of
the Gateway mirror.

After both Control Plane and Gateway ClickHouse reads are enabled,
`DASHBOARD_ROLLUP_PROJECT_APPLICATION_ENABLED=false` stops Project/Application
discovery, reconciliation, and dirty-bucket rebuilding in the PostgreSQL
Dashboard Rollup worker. Existing Project/Application rollup rows remain
available for rollback, while the worker continues to maintain Tenant Chat
rollups. ClickHouse failures return bounded 503 responses and must not reactivate
a raw PostgreSQL invocation-log query. The explicit worker flag defaults to
`true` so enabling only the employee reader cannot silently stop a Gateway that
still depends on PostgreSQL rollups.

This cutover does not make ClickHouse a quota or budget correctness source.
Provider admission, rate limiting, reservations, settlements, and cost ledgers
continue to use their transactional PostgreSQL or Redis stores. PostgreSQL also
retains canonical terminal-log writes and tenant/project/request point detail
lookups required for audit fields that are deliberately absent from ClickHouse.

## Phase 6 one-second dashboard read models

The web dashboard keeps its existing one-second polling interval. The polling
path must not repeatedly aggregate `analytics.llm_invocations FINAL`.

Two ClickHouse read models are maintained from the raw mirror:

- `analytics.llm_invocations_by_time` is a
  `ReplacingMergeTree(ingest_version)` ordered by
  `tenant_id, created_at, request_id`. Recent request lists, slow-request
  lists, and recent reliability incidents read this table with `FINAL`.
- `analytics.llm_invocations_dashboard_second_rollup` is an
  `AggregatingMergeTree` ordered by tenant, second, and the required dashboard
  dimensions. Dashboard, cost, performance, policy-impact, reliability-total,
  and filter-option aggregates read this table.

The rollup stores additive request/token/cost counters and TDigest latency
states. Request, token, and cost totals must match the raw `FINAL` source for a
closed UTC interval. Latency percentiles are approximate TDigest values and
must not be presented as exact percentiles. Because the source bucket is one
second, an unaligned query boundary can differ from an exact raw query by at
most its two partial edge seconds.

On an existing ClickHouse volume, operators must keep PostgreSQL logging online
but pause the ClickHouse mirror while applying
`004_create_dashboard_rollups.sql` and the one-time
`maintenance/backfill_dashboard_rollups.sql`. They must compare the raw and
rollup request, token, and cost totals before enabling the reader. The mirror
is resumed only after reconciliation succeeds. The backfill script must not be
run twice.

`AnalyticsReliabilitySourceFreshness.queryMode` uses `rollup` for the
Project/Application totals path. The point-detail source remains PostgreSQL,
and the recent incident list remains the time-ordered ClickHouse read model.
No aggregate read may silently fall back to PostgreSQL raw invocation logs.

The self-hosted ClickHouse configuration retains query logs for 7 days, text
logs at warning level for 3 days, and metric logs for 7 days. Trace and
processor-profile system tables are disabled for the production analytics
node. Applying retention to already-created system tables is an explicit
operator action and does not force `OPTIMIZE` or `TRUNCATE`.
