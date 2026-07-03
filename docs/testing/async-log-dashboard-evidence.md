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
- async log metric families are declared in `/metrics`
- when traffic is sent, async enqueue and persist samples are recorded

## Report

The report is written to:

```text
reports/async-log-dashboard-evidence/latest.json
reports/async-log-dashboard-evidence/v2-async-log-dashboard-evidence-<timestamp>.json
```

The report stores request IDs, status/header summaries, dashboard rollups, and metric summaries. It intentionally excludes raw prompts, raw responses, Authorization headers, API keys, app tokens, provider keys, and secret plaintext.

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
