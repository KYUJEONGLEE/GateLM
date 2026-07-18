# Unified Analytics Performance Contract Proposal

| Field | Value |
|---|---|
| Status | Proposed contract with implementation in `feat/analysis-tab` |
| Applies to | Web Analytics `performance` tab and Gateway `GET /api/analytics/performance` observability reader |
| Does not apply to | Billing/quota correctness, Tenant Chat employee identity, Request Detail, metrics labels, or public Gateway routes |
| Last reviewed | 2026-07-18 |

## 1. Goal

Tenant Admin의 Analytics performance 조회는 프로젝트 선택 여부와 무관하게 기존 Project/Application 요청과 tenant 전체 Tenant Chat 요청을 함께 보여준다. Project Admin은 기존 Project/Application 범위만 유지한다.

이 계약은 Tenant Chat을 hidden Project/Application이나 sentinel project로 변환하지 않는다. 두 source는 response의 bounded `surface` discriminator로 구분한다.

```text
project_application
tenant_chat
```

## 2. Current Meaning And Change

현재 `GET /api/analytics/performance`는 `p0_llm_invocation_logs`만 읽는다. 변경 후 reader는 다음 source를 bounded union으로 읽는다.

| Surface | Source | Tenant filter | Time field | Provider/Model |
|---|---|---|---|---|
| `project_application` | `p0_llm_invocation_logs` | `tenant_id` | `created_at` | executed `provider`, `model` |
| `tenant_chat` | `tenant_chat_invocation_logs` | `tenant_id` | `completed_at` | `effective_provider_id`, `effective_model_key` |

모든 시간 구간은 UTC half-open interval `[from, to)`다. `projectId`는 Project/Application branch에만 적용한다. `projectId`가 있는 조회는 기본적으로 Tenant Chat source를 제외하지만, tenant-level 권한을 확인한 Web server-only client가 `includeTenantChat=true`를 보내면 같은 tenant의 Tenant Chat branch를 합친다. Provider/Model filter는 각 surface의 server-recorded effective execution field에 적용한다.

## 3. Additive Summary Contract

Top-level `summary`의 아래 값은 두 surface에서 합칠 수 있다.

- `totalRequests`: terminal request count의 합
- `systemErrorRequests`: 아래 surface별 system-error numerator의 합
- `throughputPerMinute`: `totalRequests / selectedRangeMinutes`
- `errorRate`: `systemErrorRequests / totalRequests`

Project/Application system error는 canonical terminal status `failed` 또는 `http_status >= 500`이다. Tenant Chat system error는 `failed`, `provider_failed`, `provider_timeout`, `runtime_unavailable`, `no_eligible_route`다. Safety, quota, budget, rate, concurrency, policy acknowledgement와 cancellation은 system error가 아니다.

Top-level `avgLatencyMs`, `p95LatencyMs`, `p99LatencyMs`는 한 surface만 조회된 경우에만 그 surface 값을 가진다. 두 surface가 함께 조회되면 `null`이다. 서로 다른 측정 경계의 percentile을 평균하거나 하나의 percentile로 오인하게 만들지 않는다.

## 4. Surface Latency Contract

응답은 `surfaceSummaries`를 제공한다.

```json
{
  "surfaceSummaries": [
    {
      "surface": "project_application",
      "totalRequests": 120,
      "systemErrorRequests": 2,
      "avgLatencyMs": 410,
      "p95LatencyMs": 1200,
      "p99LatencyMs": 2400,
      "throughputPerMinute": 2,
      "errorRate": 0.0167,
      "lastEventAt": "2026-07-18T01:00:00Z"
    },
    {
      "surface": "tenant_chat",
      "totalRequests": 30,
      "systemErrorRequests": 1,
      "avgLatencyMs": 930,
      "p95LatencyMs": 2200,
      "p99LatencyMs": 4100,
      "throughputPerMinute": 0.5,
      "errorRate": 0.0333,
      "lastEventAt": "2026-07-18T00:59:00Z"
    }
  ]
}
```

Project/Application latency percentiles use requests whose canonical terminal status is `success|failed`. Tenant Chat latency percentiles preserve the active Tenant Chat Dashboard contract and use its terminal invocation latency samples. Percentiles remain surface-specific in summary rows and time buckets.

조회 대상으로 선택된 surface에 terminal row가 없어도 `surfaceSummaries`에는 해당 surface를 `totalRequests=0`, nullable latency/error/freshness로 반환한다. Web은 0건 surface를 숨기지 않고 빈 상태로 표시한다.

`latencyDistribution`, `p95LatencyByProvider`, `providerModelPerformance`, and `slowestRequests` add a required `surface` discriminator. Latency buckets may contain the same UTC bucket timestamp once per surface.

## 5. Slow Request Contract

Slow request rows contain only safe operational fields:

```text
surface
requestId
timestamp
projectId (nullable; always null for tenant_chat)
provider
model
latencyMs
status
statusCode (nullable; null for tenant_chat because no synthetic HTTP status is invented)
```

Tenant Chat `userId`, `employeeId`, `turnId`, content, binding/JWT data와 Provider raw error는 반환하지 않는다. 기존 unified Request Log detail BFF가 request ID로 surface를 판별하므로 두 surface 모두 같은 console request-log 링크를 사용할 수 있다.

## 6. Freshness

각 `surfaceSummary.lastEventAt`은 해당 source의 마지막 `created_at` 또는 `completed_at`이다. Top-level freshness는 다음을 사용한다.

- 한 surface: 기존 source 이름과 마지막 event 시각
- 두 surface: `source=postgresql_unified_raw`, `recordCount`는 합계, `lastLogCreatedAt`은 관측된 surface 마지막 event 시각 중 가장 오래된 값

이는 한 source의 최신 row가 다른 source의 projection lag를 숨기지 않게 한다. 이번 bounded raw reader는 rollup freshness나 billing correctness를 선언하지 않는다.

## 7. Compatibility And Migration

- route와 필수 `from`, `to`, tenant/project/provider/model query 의미는 유지하고, optional `includeTenantChat=true`를 추가한다.
- response field 추가는 additive지만, 프로젝트 없는 tenant-level 조회의 totals는 Tenant Chat을 포함하므로 의미가 확장된다.
- 명시적인 `projectId` 조회는 `includeTenantChat`을 보내지 않으면 기존 의미를 유지한다. Project Admin Web 요청은 이 옵션을 보내지 않는다.
- DB migration, event 변경, metrics 변경은 없다.
- Provider/Model은 catalog data이며 enum으로 고정하지 않는다.
- Web은 legacy Gateway 응답에 `surfaceSummaries`가 없으면 기존 payload를 `project_application`으로 해석할 수 있다.

## 8. Security And Query Budget

- 모든 union branch에 같은 authenticated tenant 범위를 SQL 내부에서 적용한다.
- Web server-only client만 observability token을 전송한다.
- Web은 `includeTenantChat=true`를 Tenant Admin 조회에만 사용하며 Project Admin의 강제 `projectId` 범위에는 사용하지 않는다.
- raw prompt/response, raw detected value, credentials, authorization, hashes, Provider raw error, user/employee identity를 select하거나 반환하지 않는다.
- `surface`는 response discriminator이며 metric label 변경을 만들지 않는다.
- Console 지원 범위는 기존 `15m|1h|1d|1w`다. 긴 범위 rollup 전환은 같은 histogram version과 coverage가 준비된 별도 변경으로 수행하며 surface percentile을 평균하지 않는다.

## 9. Acceptance

1. tenant-level no-project 조회는 두 source의 request count와 system-error numerator를 합산한다.
2. Tenant Admin의 `projectId&includeTenantChat=true` 조회는 Project/Application에만 project filter를 적용하고 같은 tenant의 Tenant Chat을 합산한다.
3. `includeTenantChat`이 없는 `projectId` 조회는 `tenant_chat_invocation_logs`를 읽지 않고 Project Admin의 기존 범위를 유지한다.
4. latency summary와 bucket은 `surface`별로 분리되며 top-level mixed percentile은 `null`이다.
5. Provider/Model filter가 두 source의 effective execution fields에 동일하게 적용된다.
6. Tenant Chat slow request는 `projectId`와 `statusCode`가 `null`이고 사용자/직원/content field가 없다.
7. Web performance 페이지가 두 surface의 p95와 latency trend를 구분해 표시한다.
8. 요청된 surface가 0건이어도 해당 surface를 숨기지 않으며 latency는 `0ms`가 아니라 `null`/`—`로 표시한다.
9. Gateway query/handler tests, Web typecheck, `git diff --check`, `verify:v2-docs`가 통과한다.
