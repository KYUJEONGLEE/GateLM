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
| Async log retry count | needs retry logic before metric can be meaningful |
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
GATEWAY_ASYNC_LOG_WRITE_TIMEOUT_MS=2000
GATEWAY_ASYNC_LOG_SHUTDOWN_TIMEOUT_MS=5000
```

For performance tuning, compare queue depth, dropped count, enqueue latency, persist latency, and dashboard freshness while changing `GATEWAY_ASYNC_LOG_WORKER_COUNT` to values such as `1`, `2`, `4`, and `8`.
