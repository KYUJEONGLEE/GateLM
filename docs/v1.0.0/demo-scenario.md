# GateLM v1.0.0 Demo Scenario

## 1. Purpose

이 문서는 v1.0.0 baseline 데모에서 팀 전체가 같은 순서와 같은 관측 기준으로 확인할 시나리오를 정의한다.

데모의 목표는 단순히 Gateway 요청이 성공하는 것을 보여주는 것이 아니다. 고객사 앱 요청이 GateLM을 통과하면서 인증, rate limit, safety, routing, cache, provider call, request log, dashboard, metrics까지 하나의 requestId로 추적되는 것을 보여주는 것이다.

## 2. Owners

| Area | Owner | Responsibility |
|---|---|---|
| Demo UX / UI | 김규민 | Customer Demo App, Request Log UI, Request Detail UI, Dashboard UI |
| Observability / Baseline | 이규정 | Invocation Log fixture, Dashboard aggregation fixture, metrics and k6 baseline interpretation |
| Gateway behavior | 이지섭 | Gateway pipeline outcome, requestId, auth, safety, routing, cache, provider and rate limit metadata |
| Runtime config | 재혁님 | Project, Application, Provider, API Key, App Token, Runtime Config |

## 3. Fixture Inputs

| File | Purpose |
|---|---|
| `docs/v1.0.0/invocation-log.fixture.json` | Request Log and Detail baseline records |
| `docs/v1.0.0/dashboard-overview.fixture.json` | Dashboard Overview baseline aggregate |
| `runtime-config.fixture.json` | Runtime policy/config input from Control Plane owner |
| `gateway-context.schema.json` | Gateway pipeline context contract from Gateway owner |

## 4. Demo Preconditions

- Customer Demo App calls only GateLM Gateway.
- Control Plane has prepared Project, Application, Provider, API Key, App Token and Runtime Config.
- Gateway exposes `healthz`, `readyz`, `/v1/models`, `/v1/chat/completions` and `/metrics`.
- Mock Provider path is available.
- Python/FastAPI safety service is optional and disabled by default.
- No raw prompt, raw response, plaintext credential, authorization header or raw sensitive value is stored or displayed.

## 5. Main Scenario

| Step | Action | Expected Gateway outcome | Expected observability outcome |
|---:|---|---|---|
| 1 | Check service readiness | `healthz` and `readyz` are healthy | No request log required |
| 2 | Fetch models | `/v1/models` returns configured model list | Gateway request metric increments |
| 3 | Send safe request with `model=auto` | 200 success, selected provider/model and routing reason returned | Request Log stores `status=success`, `cacheStatus=miss`, `routingReason=short_prompt_low_cost` |
| 4 | Send the same safe request again | 200 cache hit, provider call is skipped | Request Log stores `status=cache_hit`, `cacheHitRequestId` points to the first safe request |
| 5 | Send request containing synthetic email/phone-like data | 200 success after redaction | Request Log stores `maskingAction=redacted`, detected types are `email` and `phone_number` |
| 6 | Send request containing synthetic credential-like data | 403 blocked before provider call | Request Log stores `status=blocked`, `errorCode=sensitive_data_blocked`, provider latency is null |
| 7 | Exceed application rate limit | 429 rate limited before cache/provider | Request Log stores `status=rate_limited`, `errorCode=rate_limited`, provider latency is null |
| 8 | Simulate provider failure after cache miss | 502 provider error | Request Log stores `status=error`, `errorCode=provider_error`, sanitized error message only |
| 9 | Open Request Log and Request Detail by requestId | Each request is searchable by requestId | Detail groups identity, request, status, usage, cost, latency, rate limit, safety, routing, cache, provider, error and timestamps |
| 10 | Open Dashboard Overview | Dashboard numbers match Request Log fixture | Total requests, success, blocked, rate limited, cache hit, token, cost and latency aggregates match |
| 11 | Check `/metrics` | Metrics expose request/cache/masking/rate limit/latency/log write counters | No forbidden high-cardinality or sensitive labels are exposed |
| 12 | Run k6 baseline | RPS, p95 latency, cache hit behavior and rate limit bottleneck are captured | Baseline report explains current bottleneck and v2 evidence path |

## 6. Expected Fixture Records

| Scenario | Request ID |
|---|---|
| Safe success | `request_v1_demo_safe_success_001` |
| Cache hit | `request_v1_demo_cache_hit_002` |
| Redacted request | `request_v1_demo_redacted_003` |
| Blocked request | `request_v1_demo_blocked_004` |
| Rate limited request | `request_v1_demo_rate_limited_005` |
| Provider error | `request_v1_demo_provider_error_006` |

## 7. Dashboard Acceptance

Dashboard Overview must match the fixture aggregate:

```text
totalRequests = 6
successfulRequests = 3
failedRequests = 1
blockedRequests = 1
rateLimitedRequests = 1
cacheHitRequests = 1
cacheHitRate = 0.25
totalTokens = 193
totalCostMicroUsd = 256
averageLatencyMs = 596
p95LatencyMs = 1009
```

`blocked` and `rate_limited` are policy outcomes. They must not be treated as product failures in the default dashboard interpretation.

## 8. Metrics Acceptance

The `/metrics` output must make the following visible:

- Gateway request count by endpoint, method, status and HTTP status.
- Gateway request duration.
- Provider request count and duration.
- Cache operation count by operation, status and type.
- Rate limit decision count and duration.
- Masking action count.
- Invocation log write count and duration.

Forbidden metric labels:

```text
request_id
trace_id
tenant_id
project_id
application_id
api_key_id
app_token_id
end_user_id
feature_id
prompt
prompt_hash
cache_key_hash
authorization
```

## 9. Security Assertions

The final smoke must assert:

- No raw prompt in logs, detail, dashboard or fixture.
- No raw response in logs, detail, dashboard or fixture.
- No plaintext API Key, App Token or Provider Key in logs, detail, dashboard or fixture.
- No authorization header value in logs, detail, dashboard or fixture.
- Cache hit does not call provider.
- Blocked and rate limited requests do not call provider.
- Python/FastAPI safety service disabled still passes v1 smoke.

## 10. Known v2 Evidence Path

The v1 demo should mention, but not require:

- Redis Rate Limit.
- Redpanda event pipeline.
- ClickHouse analytics.
- Semantic Cache.
- Streaming.
- Advanced Runtime Policy Editor.
