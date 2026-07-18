# Tenant Unified Reliability Read Contract Proposal

| Field | Value |
|---|---|
| Status | Proposed; not active until owner approval, implementation, and acceptance |
| Applies to | Web Analytics `reliability` tab and Gateway observability reliability reader |
| Does not apply to | Billing or quota enforcement, SLA declaration, latency percentile merging, Request Detail mutation, or metrics labels |
| Source surfaces | `project_application`, `tenant_chat` |
| Last reviewed | 2026-07-18 |

## 1. Goal

Tenant Admin의 Analytics 안정성 화면이 Project/Application과 Tenant Chat의 terminal request를 하나의 tenant-scoped read model로 조회한다. 두 source의 원래 outcome 이름과 시간 기준은 유지하되, 화면 집계에 필요한 bounded canonical status로 서버에서 정규화한다.

이 계약은 다음 원칙을 고정한다.

- `surface=all`은 additive request count만 합산한다.
- 시스템 실패와 정책 결과를 분리한다.
- 성공률과 오류율은 surface별 분자·분모를 더한 뒤 한 번 계산한다.
- raw request list의 일부를 가져와 전체 기간 집계를 재구성하지 않는다.
- 최근 안정성 근거는 rollup이 아니라 tenant-scoped raw source를 사용한다.
- Tenant Chat을 hidden Project/Application 또는 sentinel project로 변환하지 않는다.

## 2. Endpoint And Authorization

```text
GET /api/analytics/reliability
```

이 route는 Gateway의 server-only observability read route다. Public `/v1` API가 아니며 기존 `X-GateLM-Observability-Token`으로 보호한다. Web BFF는 Console session으로 tenant/project 권한을 먼저 확인한 뒤 observability token을 전송한다.

Query:

- `tenantId`: 필수 authenticated tenant scope.
- `from`, `to`: 필수 ISO-8601 UTC 시각. `from < to`, half-open `[from,to)`, 최대 31일.
- `surface`: `all|project_application|tenant_chat`, 기본 `all`.
- `projectId`: 선택. 존재하면 effective surface는 `project_application`이다.
- `incidentLimit`: `1..20`, 기본 `4`.

권한 규칙:

- active Tenant Admin만 `surface=all|tenant_chat`을 조회할 수 있다.
- Project Admin은 자신에게 허용된 `projectId`의 `project_application`만 조회할 수 있다.
- `surface=tenant_chat`과 `projectId`를 함께 보내면 `400 RELIABILITY_SCOPE_INVALID`다.
- `surface=all`과 `projectId`가 함께 오면 effective surface를 `project_application`으로 제한하고 응답 scope에 그 결과를 명시한다.
- route/query tenant와 authenticated tenant가 다르면 `403`이며 존재 여부를 구분해 노출하지 않는다.

## 3. Source And Time Contract

| Surface | Terminal source | Time field | Fallback source | Executed model |
|---|---|---|---|---|
| `project_application` | `p0_llm_invocation_logs` | `created_at` | bounded fallback domain outcome in `metadata` | persisted `provider`, `model` |
| `tenant_chat` | `tenant_chat_invocation_logs` | `completed_at` | `tenant_chat_provider_attempts` rows with `kind=fallback` | `effective_provider_id`, `effective_model_key` |

Project/Application terminal status는 다음 compatibility 순서로 읽는다.

1. `metadata.terminalStatus`
2. `metadata.gatewayStageOutcomes.terminalStatus`
3. `status`

Project/Application fallback outcome은 다음 compatibility 순서로 읽는다.

1. `metadata.domainOutcomes.fallback.outcome`
2. `metadata.gatewayStageOutcomes.domainOutcomes.fallback.outcome`
3. `not_called`

모든 raw branch, rollup totals, rollup dimensions, coverage query는 첫 scope 조건으로 authenticated `tenant_id`를 적용한다. `projectId`는 Project/Application branch에만 적용한다.

## 4. Canonical Terminal Status

통합 response의 canonical terminal status는 다음 여섯 값만 사용한다.

```text
success
failed
blocked
rate_limited
cancelled
unknown
```

### 4.1 Project/Application mapping

| Source terminal status | Canonical status |
|---|---|
| `success` | `success` |
| `failed` | `failed` |
| `blocked` | `blocked` |
| `rate_limited` | `rate_limited` |
| `cancelled` | `cancelled` |
| any other value | `unknown` |

### 4.2 Tenant Chat mapping

| Tenant Chat `terminal_outcome` | Canonical status |
|---|---|
| `succeeded`, `cache_hit` | `success` |
| `failed`, `provider_failed`, `provider_timeout`, `runtime_unavailable`, `no_eligible_route` | `failed` |
| `concurrency_limited`, `safety_blocked`, `policy_ack_required`, `quota_blocked`, `budget_blocked` | `blocked` |
| `rate_limited` | `rate_limited` |
| `cancelled` | `cancelled` |
| any other value | `unknown` |

`blocked`와 `rate_limited`는 정책 또는 admission 결과이며 system error가 아니다. `cancelled`도 system error가 아니다. 새 source outcome을 `failed`로 추정하지 않는다. `unknown`으로 보존하고 전체 response를 `partial`로 낮춘다.

## 5. Aggregate Response

응답은 content-free aggregate와 bounded recent incident만 포함한다.

```json
{
  "data": {
    "scope": {
      "tenantId": "00000000-0000-4000-8000-000000000001",
      "surface": "all",
      "projectId": null,
      "from": "2026-07-17T00:00:00Z",
      "to": "2026-07-18T00:00:00Z"
    },
    "generatedAt": "2026-07-18T00:00:05Z",
    "freshness": {
      "queryStatus": "ok",
      "complete": true,
      "sources": [
        {
          "surface": "project_application",
          "queryMode": "hybrid",
          "queryStatus": "ok",
          "lastEventAt": "2026-07-17T23:59:55Z",
          "lastAggregatedAt": "2026-07-18T00:00:02Z"
        },
        {
          "surface": "tenant_chat",
          "queryMode": "hybrid",
          "queryStatus": "ok",
          "lastEventAt": "2026-07-17T23:59:50Z",
          "lastAggregatedAt": "2026-07-18T00:00:01Z"
        }
      ]
    },
    "totals": {
      "requestCount": 150,
      "successCount": 131,
      "failedCount": 3,
      "blockedCount": 8,
      "rateLimitedCount": 5,
      "cancelledCount": 3,
      "unknownCount": 0,
      "fallbackRequestCount": 6,
      "fallbackSuccessCount": 4
    },
    "rates": {
      "successRate": 0.873333,
      "systemErrorRate": 0.02,
      "fallbackRecoveryRate": 0.666667
    },
    "terminalOutcomes": [
      { "outcome": "success", "requestCount": 131 },
      { "outcome": "failed", "requestCount": 3 },
      { "outcome": "blocked", "requestCount": 8 },
      { "outcome": "rate_limited", "requestCount": 5 },
      { "outcome": "cancelled", "requestCount": 3 },
      { "outcome": "unknown", "requestCount": 0 }
    ],
    "continuity": {
      "successWithoutFallbackCount": 127,
      "fallbackRecoveredCount": 4,
      "failedCount": 3,
      "cancelledCount": 3,
      "excludedPolicyCount": 13,
      "unknownCount": 0
    },
    "surfaceTotals": [
      {
        "surface": "project_application",
        "included": true,
        "totals": {
          "requestCount": 120,
          "successCount": 106,
          "failedCount": 2,
          "blockedCount": 6,
          "rateLimitedCount": 4,
          "cancelledCount": 2,
          "unknownCount": 0,
          "fallbackRequestCount": 4,
          "fallbackSuccessCount": 3
        }
      },
      {
        "surface": "tenant_chat",
        "included": true,
        "totals": {
          "requestCount": 30,
          "successCount": 25,
          "failedCount": 1,
          "blockedCount": 2,
          "rateLimitedCount": 1,
          "cancelledCount": 1,
          "unknownCount": 0,
          "fallbackRequestCount": 2,
          "fallbackSuccessCount": 1
        }
      }
    ],
    "recentIncidents": [
      {
        "surface": "tenant_chat",
        "requestId": "request_fixture_001",
        "occurredAt": "2026-07-17T23:58:00Z",
        "projectId": null,
        "provider": "provider_fixture",
        "model": "model_fixture",
        "canonicalStatus": "success",
        "sourceOutcome": "succeeded",
        "fallbackOutcome": "success",
        "httpStatus": null
      }
    ]
  }
}
```

`surfaceTotals`는 요청한 effective surface만 포함한다. 요청한 source가 unavailable이면 해당 row는 `included=false`, `totals=null`이며 top-level totals는 포함 가능한 source만 합친다. 이 경우 `freshness.complete=false`와 `queryStatus=partial`을 반드시 반환한다.

## 6. Equations And Invariants

모든 count는 음수가 아닌 정수다. 비율은 count를 합산한 뒤 계산하며 surface별 비율을 평균하지 않는다.

```text
requestCount
  = successCount
  + failedCount
  + blockedCount
  + rateLimitedCount
  + cancelledCount
  + unknownCount

successRate
  = successCount / requestCount

systemErrorRate
  = failedCount / requestCount

fallbackRecoveryRate
  = fallbackSuccessCount / fallbackRequestCount

successWithoutFallbackCount
  = max(successCount - fallbackSuccessCount, 0)

excludedPolicyCount
  = blockedCount + rateLimitedCount
```

분모가 `0`이면 해당 rate는 `null`이다. 데이터 없음은 `0%` 성공률 또는 `0%` fallback recovery로 표현하지 않는다.

추가 불변조건:

- `fallbackSuccessCount <= fallbackRequestCount`
- `fallbackSuccessCount <= successCount`
- top-level count는 `included=true`인 `surfaceTotals`의 같은 필드 합과 일치한다.
- `terminalOutcomes` 합은 `requestCount`와 일치한다.
- `continuity` count와 `excludedPolicyCount`, `unknownCount`의 합은 `requestCount`와 일치한다.

`successWithoutFallback`은 cache hit을 포함한 “fallback 없이 성공한 요청”이다. Provider 직접 성공만을 의미하는 `direct_success`라는 이름을 사용하지 않는다.

## 7. Fallback Meaning

Project/Application fallback request는 fallback domain outcome이 `success|failed`인 distinct request다. `not_needed|disabled|not_called`은 fallback request가 아니다.

Tenant Chat fallback request는 `tenant_chat_provider_attempts.kind=fallback`이 하나 이상 존재하는 distinct request다. 성공은 같은 request의 fallback attempt 중 `outcome=succeeded`가 하나 이상 있는 경우다. attempt 수를 request 수로 오인하거나 한 request를 여러 번 세지 않는다.

서로 다른 source 이름은 read boundary에서 다음처럼 정규화한다.

| Source | Canonical fallback outcome |
|---|---|
| Project/Application `success` | `success` |
| Project/Application `failed` | `failed` |
| Tenant Chat fallback attempt `succeeded` | `success` |
| Tenant Chat fallback attempt `failed_pre_delta|failed_post_delta|timed_out|cancelled` | `failed` |
| no fallback attempt | `not_attempted` |
| any unsupported value | `unknown` and response `partial` |

## 8. Rollup, Raw, And Hybrid Routing

집계 source는 기존 mergeable Rollup 계약을 사용한다.

- `dashboard_rollup_totals`: surface별 additive request/fallback totals
- `dashboard_rollup_dimensions`: source terminal outcome의 bounded breakdown
- `dashboard_rollup_bucket_states`: bucket coverage와 freshness
- `dashboard_rollup_dirty_buckets`: 재계산 대기 상태

Unified reader는 `surface`를 query parameter로 받도록 기존 Project/Application 전용 hard-code를 제거해야 한다. 긴 범위에서 두 surface의 모든 required bucket이 ready이고 dirty하지 않을 때만 rollup을 사용한다. 현재 열린 bucket 또는 양 끝 partial bucket은 raw tail과 합친다.

Canonical terminal counts는 `dimension_type=terminal_status` row를 이 계약의 mapping table로 정규화해 계산한다. `dashboard_rollup_totals`의 status count와 parity가 맞지 않으면 해당 범위를 정상 rollup으로 사용하지 않는다. bounded raw fallback이 가능하면 raw로 재조회하고, 불가능하면 `partial` 또는 `unavailable`로 응답한다.

현재 Tenant Chat rollup writer는 `policy_ack_required`를 `blocked_request_count`에 포함하지 않는다. 구현 전 writer를 교정하고 영향 bucket을 dirty 처리해 replacement rebuild해야 한다. 기존 rollup 값을 blind increment하거나 reader에서 total 차이를 임의로 `failed`에 더하지 않는다.

Latency percentile, TTFT, active user, employee identity는 이 안정성 read model에서 합치지 않는다.

## 9. Recent Reliability Evidence

`recentIncidents`는 rollup에서 복원하지 않는다. 두 raw source에서 먼저 reliability 조건을 적용하고, surface별 결과를 bounded union한 뒤 `occurredAt DESC, surface, requestId`로 안정 정렬해 `incidentLimit`을 적용한다.

포함 조건:

- canonical status가 `failed|cancelled`
- fallback outcome이 `success|failed|unknown`

정책 차단과 rate limit은 terminal outcome 차트에는 포함하지만 recent reliability incident에는 포함하지 않는다.

필드 의미:

- `requestId`: tenant-scoped opaque request identifier
- `surface`: detail route와 표시 범위를 결정하는 discriminator
- `occurredAt`: Project/Application `created_at`, Tenant Chat `completed_at`
- `projectId`: Tenant Chat에서는 항상 `null`
- `provider`, `model`: server-recorded effective execution 값, 없으면 `null`
- `canonicalStatus`: 이 계약의 terminal mapping 결과
- `sourceOutcome`: active source contract의 bounded terminal outcome
- `fallbackOutcome`: `success|failed|not_attempted|unknown`
- `httpStatus`: Project/Application에 저장된 값, Tenant Chat에서는 합성하지 않고 `null`

Project 이름은 Gateway가 조인하지 않는다. Web BFF가 이미 권한 검증된 Control Plane project 목록으로 `projectId`를 표시명에 매핑한다.

## 10. Freshness And Failure Semantics

각 source는 다음을 독립적으로 보고한다.

- `queryMode`: `raw|rollup|hybrid|unavailable`
- `queryStatus`: `ok|partial|stale|unavailable`
- `lastEventAt`: 해당 surface의 마지막 source event time
- `lastAggregatedAt`: rollup을 사용하지 않으면 `null`

Top-level 규칙:

- 모든 requested source가 정상이고 canonical conservation이 맞으면 `ok`, `complete=true`다.
- source가 healthy empty임을 coverage/existence probe로 확인한 경우 count `0`, `ok`다.
- 하나의 source만 stale이면 top-level은 `stale`이다.
- 하나의 source가 unavailable이지만 다른 source를 반환할 수 있으면 `partial`, `complete=false`다.
- `unknownCount > 0`, unsupported fallback outcome, totals/dimensions parity mismatch는 `partial`이다.
- 모든 requested source가 unavailable이면 safe `503 RELIABILITY_DATA_UNAVAILABLE`이며 마지막 정상 browser snapshot을 유지한다.
- 최대 범위를 넘으면 `400 RELIABILITY_RANGE_TOO_BROAD`다.

부분 응답을 정상 tenant 전체 값처럼 보이게 만들지 않는다. Web은 `partial|stale` badge와 source coverage를 표시하고, unavailable source를 `0`으로 대체하지 않는다.

## 11. Compatibility And Ownership

- 기존 `GET /api/dashboard/overview`의 Project/Application 의미는 변경하지 않는다.
- 기존 Tenant Chat `GET /admin/v1/tenants/{tenantId}/tenant-chat/dashboard`도 변경하지 않는다.
- 새 reliability endpoint가 두 기존 응답을 Web에서 더하는 방식을 사용하지 않는다. 서버가 같은 interval과 coverage 규칙으로 합친다.
- response 추가는 새 route이므로 기존 client에는 영향이 없다.
- DB schema, event payload, metrics name/label 변경은 없다.
- Gateway observability reader가 unified read와 raw incident union을 소유하고, Control Plane background worker가 rollup replacement를 소유한다.

## 12. Security And Cardinality

- raw prompt, raw response, raw detected value, prompt fragment, credentials, authorization, hashes, Provider raw error body와 actual secret을 select하거나 반환하지 않는다.
- Tenant Chat `userId`, `employeeId`, `turnId`, JWT/JTI, snapshot digest와 encrypted content metadata를 반환하지 않는다.
- `tenantId`, `projectId`, `requestId`, provider/model과 source outcome은 response field일 뿐 metrics label로 추가하지 않는다.
- Provider/Model은 catalog data이며 DB enum 또는 code enum으로 고정하지 않는다.
- `sourceOutcome`과 `fallbackOutcome`은 active contract의 bounded 값만 반환하고 임의 error text는 `unknown`으로 정규화한다.
- raw/rollup query, structured log와 error response에 tenant 간 count 또는 identifier가 섞이지 않도록 tenant scope test를 둔다.

## 13. Rollout Gate

1. 이 proposal을 owner-approved current contract로 승격한다.
2. Tenant Chat `policy_ack_required -> blocked` writer mapping을 수정한다.
3. 영향 Tenant Chat hour/day/month bucket을 dirty 처리하고 replacement rebuild한다.
4. unified raw reader와 raw parity fixture를 먼저 구현한다.
5. surface별 rollup coverage/parity 검증 후 rollup과 hybrid reader를 활성화한다.
6. Web reliability tab을 새 endpoint로 전환하고 capped request-log reconstruction을 제거한다.
7. rollout flag 아래 shadow 비교 후 기존 화면 연결을 제거한다.

## 14. Acceptance

1. no-project Tenant Admin 조회에서 두 surface의 canonical count와 분자·분모가 정확히 합산된다.
2. Project Admin 또는 `projectId` 조회는 Tenant Chat source를 읽지 않는다.
3. canonical terminal counts 합이 모든 surface와 top-level에서 request total과 일치한다.
4. `policy_ack_required`는 `blocked`이며 system error에 포함되지 않는다.
5. safety/quota/budget/rate/concurrency 결과와 cancellation은 system error numerator에 포함되지 않는다.
6. fallback attempt가 여러 개인 Tenant Chat request도 request count와 fallback success를 한 번만 센다.
7. raw, rollup, hybrid 결과가 같은 fixture에서 일치하고 dirty/incomplete coverage는 raw fallback 또는 명시적 partial이 된다.
8. 한 surface 장애가 다른 surface의 `0`으로 위장되지 않는다.
9. recent incident 조건은 DB에서 limit 전에 적용되고 두 surface union 정렬이 결정적이다.
10. empty range의 rate는 `null`이며 UI에서 `0%`로 표시되지 않는다.
11. 다른 tenant의 totals, incidents, project ID가 노출되지 않는다.
12. 금지 데이터가 API, DB rollup, structured log 또는 metrics label에 추가되지 않는다.
13. Gateway reader/handler test, Control Plane rollup test, Web read-model test, `git diff --check`, `corepack pnpm run verify:v2-docs`가 통과한다.
