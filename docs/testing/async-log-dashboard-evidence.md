# Async Log Dashboard Evidence

## Goal

PR2 verifies that terminal request logs handed off by the async writer are observable from two places:

- `/api/dashboard/overview`: accumulated request logs become dashboard totals, freshness, latency, cache/routing/cost breakdowns.
- `/metrics`: async log pipeline health is visible as enqueue, queue depth, persist, drop, and write latency metrics.

This is intentionally a demo/evidence check, not a large analytics system. Postgres request logs remain the source of truth for the dashboard.

## Why

Mentoring feedback asked for metric collection that proves the Gateway can explain request volume, cache/routing behavior, latency, cost, and operational health. PR1 made terminal log persistence asynchronous. PR2 proves the accumulated logs are still queryable as dashboard statistics and that the async pipeline itself is measurable.

## Run

Start the local stack with Gateway, Postgres, Redis, and the mock provider, then run:

```bash
pnpm v2:async-log:dashboard-evidence
```

Useful overrides:

```bash
GATEWAY_BASE_URL=http://localhost:8080 \
GATELM_DEMO_API_KEY=glm_api_test_redacted \
GATELM_DEMO_APP_TOKEN=glm_app_token_test_redacted \
pnpm v2:async-log:dashboard-evidence
```

To verify only the dashboard and metrics endpoints without sending new chat traffic:

```bash
pnpm v2:async-log:dashboard-evidence -- --skip-traffic
```

## What It Checks

The script sends synthetic Gateway traffic through `/v1/chat/completions`, waits briefly for the async writer to flush, then queries `/api/dashboard/overview` for the demo tenant/project window.

It asserts:

- dashboard totals are present and count the synthetic request window
- dashboard freshness comes from `postgresql_request_log`
- freshness has a last-ingested timestamp
- cache and provider/model breakdowns are present
- latency performance fields are present
- Gateway, Provider, Cache, Rate Limit, Masking, Log Write, and Async Log metric families are declared in `/metrics`
- when traffic is sent, Gateway request, Provider request, Cache operation, Masking action, async enqueue, and async persist samples are recorded

## Report

The report is written to:

```text
reports/async-log-dashboard-evidence/latest.json
reports/async-log-dashboard-evidence/v2-async-log-dashboard-evidence-<timestamp>.json
```

The report stores request IDs, status/header summaries, dashboard rollups, and metric summaries. It intentionally excludes raw prompts, raw responses, Authorization headers, API keys, app tokens, provider keys, and secret plaintext.

## Metric Coverage

PR2 now verifies the metric families that already exist in the Gateway registry:

| Area | Metric family | Why it matters |
|---|---|---|
| Gateway traffic | `gatelm_gateway_requests_total` | request count, error count/rate, and HTTP status split through labels |
| Gateway latency | `gatelm_gateway_request_duration_seconds` | user-facing Gateway latency |
| Current load | `gatelm_gateway_inflight_requests` | requests currently being processed |
| Provider traffic | `gatelm_provider_requests_total` | actual LLM provider calls and provider errors through labels |
| Provider latency | `gatelm_provider_request_duration_seconds` | provider-side latency share inside total Gateway latency |
| Cache | `gatelm_cache_operations_total` | cache hit/miss/bypass style cache behavior through labels |
| Rate limit | `gatelm_rate_limit_decisions_total` | denied requests with `rate_limit_allowed="false"` |
| Rate limit latency | `gatelm_rate_limit_decision_duration_seconds` | rate limit check overhead |
| Safety/masking | `gatelm_masking_actions_total` | redaction/block/none action counts |
| Log sink | `gatelm_log_writes_total` | sync log writer success/error count |
| Log sink latency | `gatelm_log_write_duration_seconds` | log sink write latency |
| Async log enqueue | `gatelm_async_log_enqueue_total` | logs accepted into the async queue |
| Async log enqueue latency | `gatelm_async_log_enqueue_duration_seconds` | enqueue overhead |
| Async log queue | `gatelm_async_log_queue_depth` | queue backlog |
| Async log drop | `gatelm_async_log_dropped_total` | dropped logs before persistence |
| Async log persist | `gatelm_async_log_persist_total` | processed/persisted async logs |
| Async log persist latency | `gatelm_async_log_persist_duration_seconds` | async log write latency |

The report also summarizes label-level samples such as Gateway status, HTTP status, Provider status, Provider error, Rate Limit denied, Log Write error, and a rough Provider bypass estimate (`Gateway requests - Provider requests`).

Not yet covered as first-class metrics:

| Future metric | Current status |
|---|---|
| Async log retry count | batch failures fall back to single writes; no dedicated retry counter yet |
| Async log DLQ count | needs dead-letter queue design first |
| Oldest queued log age | needs queue item enqueue timestamp tracking |
| Dedicated Provider bypass count | currently approximated from Gateway vs Provider request samples and dashboard cache/safety/rate-limit outcomes |
| Dedicated log sink error count | currently visible through `gatelm_log_writes_total{status!="success"}` and async persist/drop status |

## Async Log Env

The Gateway async terminal log writer is enabled by default:

```text
GATEWAY_ASYNC_LOG_ENABLED=true
GATEWAY_ASYNC_LOG_QUEUE_SIZE=1024
GATEWAY_ASYNC_LOG_WORKER_COUNT=2
GATEWAY_ASYNC_LOG_BATCH_SIZE=100
GATEWAY_ASYNC_LOG_BATCH_FLUSH_INTERVAL_MS=10
GATEWAY_ASYNC_LOG_WRITE_TIMEOUT_MS=2000
GATEWAY_ASYNC_LOG_SHUTDOWN_TIMEOUT_MS=5000
```

The PostgreSQL adapter sends each worker batch with one `pgx.Batch` round trip.
If a batch write fails, the async writer retries each record individually; the
Request Log insert and related upserts are idempotent by request/event keys.
`gatelm_async_log_persist_total` counts records by final persistence outcome,
while the persist duration histogram observes delegate write calls (single or
batch).

For performance tuning, compare queue depth, dropped count, enqueue latency,
persist latency, and dashboard freshness while changing worker count, batch
size, and flush interval one variable at a time. A larger queue only absorbs a
burst; it does not increase steady-state database throughput.

## Database Pool Isolation And Read Caches

Gateway creates separate primary and Request Log PostgreSQL pools. The log
pool is used by terminal and authentication-failure writers; authentication,
budget, pricing, credentials, rate-limit fallback, and dashboard reads use the
primary pool. Both connections set distinct PostgreSQL `application_name`
values so operators can inspect them without high-cardinality labels.

```text
GATEWAY_DATABASE_MAX_CONNS=16
GATEWAY_DATABASE_MIN_CONNS=2
GATEWAY_LOG_DATABASE_MAX_CONNS=4
GATEWAY_LOG_DATABASE_MIN_CONNS=2
```

Size both pools against the database server connection budget. Increasing
pool limits beyond the database's useful concurrency can increase latency.

Database auth and pricing caches are disabled by default and explicitly
enabled in the isolated performance Compose profile:

```text
GATEWAY_AUTH_CACHE_ENABLED=false
GATEWAY_AUTH_CACHE_TTL_MS=1000
GATEWAY_AUTH_CACHE_MAX_ENTRIES=4096
GATEWAY_PRICING_CACHE_ENABLED=false
GATEWAY_PRICING_CACHE_TTL_MS=5000
GATEWAY_PRICING_CACHE_MAX_ENTRIES=1024
```

The auth cache stores successful identities only, uses a bounded LRU, and keys
entries with HMAC-SHA256; plaintext credentials and invalid credential results
are never cached. Enabling it creates a revocation visibility window of at
most the configured TTL, so production enablement requires that tradeoff to
match the credential revocation SLA. The pricing cache rechecks each rule's
effective interval and never caches lookup failures.

## Provider Transport And Performance Mock

Gateway uses a dedicated cloned `http.Transport` for Provider adapters instead
of Go's low default idle-connection limit per host. Defaults are bounded and
configurable:

```text
GATEWAY_PROVIDER_MAX_IDLE_CONNS=512
GATEWAY_PROVIDER_MAX_IDLE_CONNS_PER_HOST=256
GATEWAY_PROVIDER_MAX_CONNS_PER_HOST=256
GATEWAY_PROVIDER_IDLE_CONN_TIMEOUT_MS=90000
GATEWAY_PROVIDER_DIAL_TIMEOUT_MS=5000
GATEWAY_PROVIDER_DIAL_KEEP_ALIVE_MS=30000
GATEWAY_PROVIDER_TLS_HANDSHAKE_TIMEOUT_MS=10000
GATEWAY_PROVIDER_RESPONSE_HEADER_TIMEOUT_MS=<GATEWAY_PROVIDER_TIMEOUT_MS>
```

The transport keeps proxy behavior and HTTP/2 negotiation from Go's default
transport while bounding connections per Provider host. Limits must be tuned
against the Provider's own concurrency and rate limits; raising them does not
override an upstream quota.

The isolated performance Compose profile replaces the thread-per-request
Python mock with the repository's Node 22 no-op mock. It retains the configured
`MOCK_PROVIDER_DEFAULT_LATENCY_MS` (100ms in the perf seed), OpenAI-compatible
response shape, streaming support, health endpoint, and failure-control
endpoints. The pinned container runs read-only without Linux capabilities.
