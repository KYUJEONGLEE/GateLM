# Analytics Live Project Traffic Contract Proposal

| Field | Value |
|---|---|
| Status | Implementation companion proposal |
| Applies to | Console Analytics usage view, Web BFF, Gateway observability read, Control Plane project summaries |
| Canonical write source | PostgreSQL terminal invocation log |
| Live read source | ClickHouse `analytics.llm_invocations_dashboard_second_rollup` |
| Public Gateway impact | None; `/v1` is unchanged |

## 1. Goal and boundary

The Analytics usage view presents Project/Application load and the observed
effect of project request limits. It does not combine Tenant Chat or
employee-attributed usage. The live read is an operator-facing aggregate and
must not become an admission, billing, quota, or audit correctness source.

The feature adds these read boundaries:

| Boundary | Route |
|---|---|
| Browser to Web BFF | `GET /api/analytics/live-usage?tenantId&range&projectId` |
| Web to Gateway | `GET /api/analytics/live-usage?tenantId&from&to&projectId` |

The Browser may select only `range=15m|1h|1d|1w` and an optional project. It
cannot provide `from`, `to`, an employee identity, a source, or another
authorization scope. The BFF derives the current completed UTC second and
computes an exact `[from,to)` range.

The Gateway route is an internal observability route protected by the existing
observability token. It does not change the public Gateway `/v1` API.

## 2. Authorization and tenant isolation

The BFF requires an authenticated Console session and verifies tenant access
before any observability read. It resolves the requested project through the
current Console authorization model:

- a tenant administrator may select any visible project in that tenant or all
  projects;
- a project-scoped administrator is forced onto an assigned project;
- an unknown or cross-tenant project fails closed.

The live BFF requires the authoritative Control Plane project list. If that
list is unavailable, it returns `503` and does not authorize against a local
fixture or stale fallback.

The Gateway requires the observability token and applies both `tenant_id` and
the optional `project_id` to every ClickHouse query. Browser input cannot
override the identity scope resolved by the BFF.

## 3. Source and failure behavior

The live path reads only
`analytics.llm_invocations_dashboard_second_rollup`. It must not read
PostgreSQL `p0_llm_invocation_logs`, the ClickHouse raw mirror, or the
time-ordered ClickHouse request table. There is no PostgreSQL raw fallback.

If ClickHouse is disabled, unavailable, times out, or returns an invalid
response, Gateway returns:

```json
{
  "error": {
    "code": "ANALYTICS_LIVE_USAGE_UNAVAILABLE",
    "message": "Live usage data is unavailable."
  }
}
```

with HTTP `503`. The BFF preserves that unavailable state. The Console keeps
the last successful live snapshot, or its existing static Project/Application
aggregate when no live snapshot exists. Messaging, policy enforcement, and
other Analytics tabs are unaffected.

## 4. Time and aggregation semantics

Only exact UTC durations are accepted:

| Range | Series bucket |
|---|---:|
| `15m` | 5 seconds |
| `1h` | 30 seconds |
| `1d` | 5 minutes |
| `1w` | 30 minutes |

All series values are normalized to requests per second using the effective
bucket duration. A partial range edge uses only the seconds inside the
requested `[from,to)` interval.

Definitions:

- `requestCount`: sum of the rollup `requests` counter.
- `rateLimitedRequestCount`: requests whose
  `terminal_status = 'rate_limited'`.
- `processedRequestCount`: requests whose terminal status is not
  `rate_limited`. This does not mean Provider success.
- `currentIncomingRps`: requests in the latest completed 5 seconds divided by
  5.
- `peakIncomingRps`: the highest one-second incoming request count in the
  selected range.
- project delta: the latest completed 10 seconds compared with the preceding
  10 seconds. Absolute change below 1 percent is `stable`. Traffic with a zero
  previous window and a non-zero current window is `up` with a nullable
  percentage.
- `rateLimitStartedAt`: the first returned series bucket with a positive
  rate-limited request count, including the first bucket in the selected
  range. It is observed traffic evidence, not an inferred policy publication
  time.

Project rows are ordered by request count descending and project ID ascending
for ties. At most 10 rows are returned; the top-project visualization uses the
first 3.

The following count invariant must hold for the summary, every bucket, and
every project:

```text
requestCount = processedRequestCount + rateLimitedRequestCount
```

## 5. Response

The response contains only:

- `range`, UTC `from` and `to`, nullable `projectId`;
- bucket, current-window, and delta-window seconds;
- aggregate summary counters, rates, and peak RPS;
- bounded time-series buckets;
- at most 10 project aggregate rows;
- nullable observed rate-limit start time;
- safe aggregate freshness provenance.

It must not contain a prompt, response, detected value, user or employee
identity, email, credential, authorization header, Provider raw error,
Provider/model detail, runtime document, or another secret.

`rateLimitedRate` is a ratio in `[0,1]`, not a percentage.

## 6. Control Plane project summary

The existing project-list response adds:

```json
{
  "rateLimit": {
    "enabled": true,
    "limit": 120,
    "windowSeconds": 2
  }
}
```

`rateLimit` is nullable. It is derived from the latest active Runtime Config
already loaded for the project list. The response exposes only `enabled`,
positive integer `limit`, and positive integer `windowSeconds`; it does not
expose the Runtime Config document or legacy algorithm fields.

Token Bucket values are presented as:

- instantaneous maximum capacity: `limit`;
- sustained refill rate: `limit / windowSeconds` requests per second.

A missing policy and a present but disabled policy are distinct UI states.

## 7. Console live behavior

Live view is off by default. While enabled, it polls only when the document is
visible:

1. activation, filter change, retry, and tab re-exposure trigger an immediate
   read;
2. the first five successful reads schedule the next read after 2 seconds;
3. changed snapshots schedule after 5 seconds;
4. two consecutive unchanged snapshots schedule after 10 seconds;
5. errors back off through 2, 4, 8, and at most 10 seconds.

The next timeout is scheduled only after the current request completes.
Disabling live view, hiding the document, changing a filter, or unmounting
aborts the request and clears its timeout. Errors retain the last successful
snapshot. No background interval or server-side polling is permitted.

Only changed metric text receives a one-time transition of approximately
220 ms. `prefers-reduced-motion: reduce` disables number and chart animation.

## 8. Metrics

The existing metrics add only the bounded endpoint value `live_usage`:

- `gatelm_clickhouse_analytics_reads_total{endpoint="live_usage",status}`
- `gatelm_clickhouse_analytics_read_duration_seconds{endpoint="live_usage",status}`

Allowed statuses remain `success`, `timeout`, and `error`. Tenant, project,
employee, request, raw error, and other high-cardinality values are forbidden
labels.

## 9. Rollout and rollback

The endpoint can be deployed before the Console view. Existing installations
must have the Phase 6 second rollup created and reconciled before live view is
used. No DB migration, reset, backfill, or event change is introduced by this
feature.

Rollback removes or hides the live UI and route. Static Analytics aggregates,
the canonical PostgreSQL log, the ClickHouse mirror, and request enforcement
remain unchanged.
