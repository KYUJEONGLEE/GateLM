# Analytics Cache Surface Contract Proposal

| Field | Value |
|---|---|
| Status | Proposed contract with implementation in `feat/analysis-tab` |
| Applies to | Web Analytics `cache` tab |
| Does not apply to | Cache runtime policy, cache key material, billing ledger, quota enforcement, or metrics labels |
| Last reviewed | 2026-07-18 |

## 1. Goal

Tenant Admin의 전체 프로젝트 Analytics Cache 조회는 Project/Application과 Tenant Chat의 실제 Exact Cache 사용량을 함께 보여준다. Project Admin 또는 명시적인 `projectId` 조회는 Project/Application 범위만 유지한다.

두 surface는 다음 bounded discriminator로 구분한다.

```text
project_application
tenant_chat
```

## 2. Sources And Time Boundary

| Surface | Aggregate source | Source of truth | Time field |
|---|---|---|---|
| `project_application` | Gateway Dashboard overview raw/rollup/hybrid reader | `p0_llm_invocation_logs` | `created_at` |
| `tenant_chat` | Tenant Chat Dashboard aggregate | `tenant_chat_invocation_logs` projection | `completed_at` |

두 source 모두 authenticated tenant 범위와 UTC half-open interval `[from, to)`를 적용한다. Tenant Chat은 현재 active 계약의 `cacheOutcome=off|hit|miss`만 사용하며 Semantic Cache 사용량으로 해석하지 않는다.

## 3. Combined Exact Cache Metrics

상단 합산 KPI는 비율을 평균하지 않고 분자와 분모를 먼저 더한다.

```text
combinedHitRequests = projectApplicationHitRequests + tenantChatHitRequests
combinedEligibleRequests = projectApplicationEligibleRequests + tenantChatEligibleRequests
combinedHitRate = combinedHitRequests / combinedEligibleRequests
```

분모가 0이면 hit rate는 0이다. 각 source에서 `hitRequests`는 `eligibleRequests`를 초과할 수 없으며, 불완전한 legacy aggregate가 이를 위반하면 Web read model은 최소 일관성을 위해 eligible을 hit 이상으로 보정한다.

Cache decision path는 다음 bounded display grouping을 사용한다.

```text
hit = combinedHitRequests
miss_or_error = combinedEligibleRequests - combinedHitRequests
off_or_bypass = combinedTotalRequests - combinedEligibleRequests
```

Project/Application의 현재 aggregate는 Exact Cache miss와 cache error를 분리하는 cache-type-aware breakdown을 제공하지 않으므로 `miss_or_error`를 `CACHE MISS / ERROR`로 표시한다. Tenant Chat의 `off`와 Project/Application의 non-eligible 요청은 `CACHE OFF / BYPASS`로 표시한다. Semantic Cache evidence를 이 합산값에 섞지 않는다.

## 4. Savings Scope

`savedCostMicroUsd`는 Project/Application Exact Cache hit에 기록된 source request cost만 사용한다. Tenant Chat terminal aggregate에는 동등한 saved-cost 근거가 없으므로 Tenant Chat 절감 비용을 0으로 만들거나 추정하지 않는다.

- 상단 값은 `Project/Application records` 범위를 함께 표시한다.
- Tenant Chat source row의 savings는 `null`이며 UI는 `—`로 표시한다.
- Project/Application source가 unavailable이면 합산 Cache 화면의 savings도 `null`이다.

## 5. Authorization And Filtering

- Tenant Admin이 `projectId` 없이 조회할 때만 두 surface를 합친다.
- Project Admin은 assigned project로 강제되므로 Tenant Chat aggregate를 조회하지 않는다.
- Tenant Admin이 특정 `projectId`를 선택하면 Tenant Chat aggregate를 조회하지 않는다.
- browser가 제공한 tenant 또는 project 범위를 신뢰하지 않고 기존 Console auth resolution 결과를 사용한다.

## 6. Freshness And Partial Data

두 source가 모두 있으면 기존 unified Dashboard freshness와 query-budget 병합 규칙을 사용한다. 한 source가 일시적으로 unavailable이면 남은 source의 값을 표시하되 `partial` 상태와 guidance를 보존한다. Tenant Chat이 구성되지 않은 tenant는 optional empty surface로 취급하며 Project/Application 결과를 partial로 만들지 않는다.

0건과 unavailable은 구분한다. source가 정상 응답했지만 요청이 0건이면 해당 source row를 유지하고 0을 표시한다. source가 응답하지 못했으면 그 row를 만들지 않으며 0건으로 가장하지 않는다.

## 7. API, DB, Event, Metrics And Security Impact

- API route 또는 response contract 변경 없음
- DB table, column, enum 또는 migration 변경 없음
- Event payload 변경 없음
- Metrics name 또는 label 변경 없음
- raw prompt, raw response, detected value, request ID, cache key/hash, user/employee identity, credential 또는 Provider raw error를 조회하거나 반환하지 않음

Project/Application Exact/Semantic outcome을 별도 차트로 분리하려면 후속 계약에서 Gateway `byCacheOutcome`에 bounded `cacheType` discriminator를 additive field로 추가하고 rollup을 재집계한다. 이 후속 변경 전에는 untyped outcome breakdown으로 합산 Exact Cache hit를 재계산하지 않는다.

## 8. Acceptance

1. Tenant Admin의 전체 프로젝트 Cache 조회는 두 surface의 hit와 eligible 분자·분모를 합산한다.
2. 합산 hit rate는 surface hit rate의 평균이 아니다.
3. Project Admin과 명시적인 `projectId` 조회는 Tenant Chat Dashboard를 읽지 않는다.
4. Tenant Chat savings는 `0`이 아니라 `null`/`—`다.
5. Project/Application savings는 범위를 명시해 표시한다.
6. 한 source 실패는 `partial`, 정상 0건은 `0`으로 구분한다.
7. 금지 데이터가 API, UI, log, metric label에 추가되지 않는다.
