# GateLM Dashboard Metrics

> v1.0.0 범위 안내: 이 문서는 장기 Dashboard/Analytics 지표를 포함한다. 현재 Dashboard/Observability 범위는 `docs/v1.0.0/contracts.md`와 `docs/v1.0.0/implementation-plan.md`를 우선한다. v1.0.0은 PostgreSQL request log와 Prometheus metrics를 기준으로 데모/측정을 수행하고, Redpanda/ClickHouse는 v2 evidence path로 둔다. 과거 P0 기준은 `docs/archive/p0/*`에서 참고한다.

## 문서 목적

`dashboard-metrics.md`는 GateLM Web Console, Analytics API, Worker rollup, ClickHouse query가 공통으로 따라야 하는 대시보드 지표 기준 문서다.
P0 Dashboard는 PostgreSQL `p0_llm_invocation_logs`를 canonical source로 사용한다. 이 문서의 `llm_invocations` 기반 계산식은 P1/장기 ClickHouse mirror 기준이며, P0에서는 같은 의미를 `p0_llm_invocation_logs` 컬럼에 매핑한다.

이 문서는 아래 작업의 기준이다.

- Overview Dashboard 구현
- 총 요청 수, 성공/실패 요청 수, 평균 응답 시간 계산
- 총 토큰 사용량, 총 비용, 모델별 비용, 프로젝트별 비용 계산
- 에러율, 캐시 적중률, 예산 사용률 계산
- Analytics API response DTO 작성
- ClickHouse query, materialized view, rollup 구현
- Request Log와 Dashboard 숫자 정합성 검증
- AI 코딩 도구가 지표 계산식을 임의로 만들지 못하게 하는 기준

GateLM은 확장 가능한 LLM Gateway 플랫폼이다. 대시보드 지표도 Provider, Model, Tenant, Project, Application, User, API Key, App Token, Cache, Routing, Masking, 배포 방식이 늘어나도 기존 정의를 깨지 않도록 설계한다.

---

# 0. 상위 기준 문서

Dashboard 지표를 구현하거나 변경할 때는 아래 문서 순서를 따른다.

```text
master-spec.md
-> project-overview.md
-> architecture.md
-> gateway-flow.md
-> pii-masking-policy.md
-> llm-log-schema.md
-> cost-policy.md
-> dashboard-metrics.md
-> db-schema.md
-> api-spec.md
-> folder-structure.md
-> coding-convention.md
-> ai-coding-rules.md
-> 실제 구현
```

충돌 시 기준:

1. 제품 방향은 `project-overview.md`를 따른다.
2. 시스템 경계와 응답/분석 경로 분리는 `architecture.md`를 따른다.
3. Gateway event 발행 위치는 `gateway-flow.md`를 따른다.
4. 민감정보 detector/action 의미는 `pii-masking-policy.md`를 따른다.
5. request log field와 status 의미는 `llm-log-schema.md`를 따른다.
6. 비용 계산, 환율, estimated/actual cost 기준은 `cost-policy.md`를 따른다.
7. Dashboard 지표명, 계산식, 포함/제외 status, chart 표시 기준은 이 문서를 따른다.
8. DB table, rollup, index는 `db-schema.md`를 따른다.
9. HTTP response shape은 `api-spec.md`를 따른다.

문서에 없는 metric, API field, DB column, chart, filter를 임의로 만들지 않는다. 필요한 경우 이 문서를 먼저 수정한다.

masking 지표의 detector type과 action 의미는 `pii-masking-policy.md`를 따른다.

---

# 1. 핵심 원칙

## 1.1 확장성 우선

- Provider와 Model을 enum으로 고정하지 않는다.
- `openai`, `anthropic`, `gemini`, `local`은 예시일 뿐이다.
- 새 지표는 기존 metric 의미를 바꾸지 말고 새 field로 추가한다.
- 핵심 지표는 top-level response field로 둔다. 중요한 수치를 `metadata`에 숨기지 않는다.
- Dashboard UI에서 비용, 토큰, 에러율을 임의로 재계산하지 않는다.
- Dashboard API 또는 Analytics API가 계산한 값을 UI가 표시한다.
- 장기간 조회는 raw table full scan이 아니라 rollup/materialized view를 우선 사용한다.

## 1.2 응답 경로와 분석 경로 분리

Dashboard 지표는 사용자 응답 경로에서 동기 계산하지 않는다.

```text
Gateway
-> 사용자 응답 반환
-> Redpanda event publish
-> Worker consume
-> ClickHouse insert
-> Rollup / Materialized View 갱신
-> Control Plane Analytics API
-> Next.js Dashboard
```

금지:

- Gateway가 Dashboard aggregate를 계산한다.
- Gateway가 ClickHouse에 직접 insert한다.
- Web UI가 ClickHouse나 Provider API를 직접 조회한다.
- Frontend가 비용 집계 공식을 직접 가진다.

## 1.3 비용 기준

Dashboard의 canonical cost는 `costMicroUsd`다.

```text
1 USD = 1,000,000 micro USD
```

표시용 USD는 decimal string으로 반환한다.

```json
{
  "totalCostMicroUsd": 42250000,
  "totalCostUsd": "42.250000"
}
```

규칙:

- 비용 집계에 float를 사용하지 않는다.
- 환율은 canonical cost에 적용하지 않는다.
- KRW 표시는 선택 기능이며 `cost-policy.md`의 FX snapshot 기준을 따른다.
- estimated cost와 actual cost를 섞지 않는다.
- cache saving은 actual cost가 아니라 절감 추정액이다.

## 1.4 원문 Prompt/Response 비노출

Dashboard API와 UI는 raw prompt/raw response를 반환하거나 표시하지 않는다.

허용:

- `redactedPromptPreview`
- `responseSummary`
- `promptHash`
- `responseHash`
- token/cost/latency/cache/routing/masking metadata
- sanitized error message

금지:

- raw prompt
- raw response
- Provider API Key 원문
- GateLM API Key 원문
- App Token 원문
- Authorization header 원문
- Provider raw error body 전체

---

# 2. Dashboard 범위

## 2.1 MVP 필수 지표

| 지표 | API Field | 설명 |
|---|---|---|
| 총 요청 수 | `totalRequests` | 조회 기간 내 Gateway 요청 수 |
| 성공 요청 수 | `successfulRequests` | 사용자에게 정상 응답을 제공한 요청 수 |
| 실패 요청 수 | `failedRequests` | Gateway/Provider 오류로 실패한 요청 수 |
| 평균 응답 시간 | `averageResponseTimeMs` | Gateway end-to-end 평균 응답 시간 |
| 총 토큰 사용량 | `totalTokens` | prompt + completion token 합계 |
| 총 비용 | `totalCostMicroUsd`, `totalCostUsd` | actual provider cost 합계 |
| 모델별 비용 | `costByModel` | provider + model 기준 비용 breakdown |
| 프로젝트별 비용 | `costByProject` | project 기준 비용 breakdown |
| 에러율 | `errorRate` | 정책 차단을 제외한 기술적 실패 비율 |

## 2.2 MVP 권장 보조 지표

| 지표 | API Field | 설명 |
|---|---|---|
| 차단 요청 수 | `blockedRequests` | 예산, Quota, Rate Limit, 보안 정책 차단 |
| 취소 요청 수 | `cancelledRequests` | client disconnect 또는 user cancel |
| 캐시 적중률 | `cacheHitRate` | exact/semantic cache hit 비율 |
| 캐시 절감액 | `cacheSavingsMicroUsd`, `cacheSavingsUsd` | cache hit로 절감된 추정 비용 |
| P95 응답 시간 | `p95ResponseTimeMs` | tail latency |
| 평균 TTFT | `averageTtftMs` | Streaming first token latency |
| Provider별 에러율 | `errorRateByProvider` | Provider 장애 추적 |
| Fallback 수 | `fallbackCount` | provider/model fallback 발생 수 |
| 마스킹 이벤트 수 | `maskingEventCount` | redacted/blocked masking event 수 |
| 예산 사용률 | `budgetUsageRate` | 예산 대비 actual cost 사용률 |

Masking detector type은 `pii-masking-policy.md`의 표준값을 따른다.

## 2.3 MVP에서 하지 않을 것

- raw prompt 기반 키워드 통계
- raw response 품질 평가
- 파일 업로드, OCR, RAG 기반 지표
- 복잡한 Agent trace timeline
- 공식 ChatGPT/Gemini/Claude 웹 사용량 자동 수집
- 사용자 개인 민감정보를 직접 보여주는 보안 리포트

---

# 3. 공통 Dimension / Filter

## 3.1 시간 필터

| Query | 필수 | 설명 |
|---|---:|---|
| `from` | Yes | 조회 시작 시각. UTC ISO-8601 |
| `to` | Yes | 조회 종료 시각. UTC ISO-8601 |
| `timezone` | No | 화면 표시용 timezone. 기본 tenant timezone 또는 UTC |
| `grain` | No | `hour`, `day`, `week`, `month`. 서버가 기본 선택 가능 |

시간 조건은 아래처럼 처리한다.

```text
createdAt >= from AND createdAt < to
```

저장은 UTC 기준이다. UI bucket label만 timezone을 적용한다.

## 3.2 Scope 필터

| Query | 설명 |
|---|---|
| `tenantId` | tenant dashboard |
| `projectId` | project dashboard |
| `applicationId` | application dashboard |
| `userId` | user dashboard |
| `apiKeyId` | API Key별 사용량 |
| `appTokenId` | App Token별 사용량 |

MVP UI는 `tenantId`, `projectId`를 우선 지원한다. API와 query 구조는 다른 scope로 확장 가능해야 한다.

## 3.3 분석 필터

| Query | 설명 |
|---|---|
| `provider` | provider 문자열 |
| `model` | model 문자열 |
| `status` | request status |
| `cacheStatus` | P0: hit, miss, bypass, error |
| `cacheType` | P0: none, exact |
| `routingReason` | routing reason |
| `maskingAction` | `none`, `redacted`, `blocked` |
| `errorCode` | 표준 error code |

Provider와 Model은 string이다. DB enum으로 닫지 않는다.

---

# 4. Status 분류 기준

LLM request status는 `llm-log-schema.md`의 canonical status를 따른다.

| Status | Dashboard 분류 | Total 포함 | Success 포함 | Failed 포함 | Error Rate 분모 포함 | 비용 발생 가능 |
|---|---|---:|---:|---:|---:|---:|
| `success` | 성공 | Yes | Yes | No | Yes | Yes |
| `cache_hit` | 성공 | Yes | Yes | No | Yes | No |
| `partial_success` | 부분 성공 | Yes | Yes | No | Yes | Yes |
| `error` | 실패 | Yes | No | Yes | Yes | Maybe |
| `blocked` | 정책 차단 | Yes | No | No | No | No |
| `cancelled` | 취소 | Yes | No | No | No | Maybe |

기준:

- `cache_hit`은 Provider 호출이 없더라도 사용자 관점에서는 성공이다.
- `partial_success`는 fallback/retry 후 최종 응답이 제공된 상태이므로 성공 요청에 포함한다.
- `blocked`는 정책이 의도대로 작동한 결과다. 실패나 에러로 보지 않는다.
- `cancelled`는 client/user 동작일 수 있으므로 기본 에러율에서 제외한다. 필요하면 별도 `cancelledRate`를 추가한다.

---

# 5. 필수 지표 정의

## 5.1 `totalRequests` — 총 요청 수

정의:

```text
totalRequests = countDistinct(requestId)
```

포함 status:

```text
success, cache_hit, partial_success, error, blocked, cancelled
```

Source:

```text
ClickHouse llm_invocations.request_id
또는 usage rollup request_count
```

주의:

- Provider retry/fallback attempt 수가 아니라 사용자 요청 수를 센다.
- 하나의 `requestId`에 여러 provider attempt가 있어도 요청 수는 1이다.
- 중복 event는 `requestId` 기준으로 dedupe한다.

## 5.2 `successfulRequests` — 성공 요청 수

정의:

```text
successfulRequests = countDistinct(requestId where status in ('success', 'cache_hit', 'partial_success'))
```

Source:

```text
ClickHouse llm_invocations.status
또는 usage rollup success_count
```

주의:

- `cache_hit`은 성공으로 본다.
- `partial_success`는 최종 응답이 제공되었으므로 성공으로 본다.
- fallback 발생 여부는 `fallbackCount` 또는 `partialSuccessRequests`로 따로 본다.

## 5.3 `failedRequests` — 실패 요청 수

정의:

```text
failedRequests = countDistinct(requestId where status = 'error')
```

Source:

```text
ClickHouse llm_invocations.status
또는 usage rollup error_count
```

주의:

- `blocked`는 실패 요청 수에 포함하지 않는다.
- `cancelled`는 기본 실패 요청 수에 포함하지 않는다. 필요하면 `cancelledRequests`를 별도로 표시한다.
- Provider timeout, provider error, gateway internal error, adapter error는 `error`다.

## 5.4 `averageResponseTimeMs` — 평균 응답 시간

정의:

```text
latencyEligibleRequests = requests where
  status in ('success', 'cache_hit', 'partial_success', 'error')
  and latencyMs is not null

averageResponseTimeMs = round(avg(latencyMs over latencyEligibleRequests))
```

Source:

```text
ClickHouse llm_invocations.latency_ms
또는 usage rollup avg_latency_ms
```

측정 기준:

```text
latencyMs = Gateway가 request를 받은 시각부터 client 응답 완료 시각까지
```

주의:

- Provider 호출 latency만 의미하지 않는다.
- 인증, 정책 검사, 마스킹, 캐시 조회, 라우팅, Provider 호출, 응답 변환 시간이 모두 포함된다.
- `blocked` 요청은 평균 응답 시간에서 제외한다. 정책 차단 성능은 `averageBlockDecisionMs` 같은 별도 지표로 확장한다.
- Streaming 요청은 stream 완료 시점까지를 `latencyMs`로 본다. 첫 token latency는 `ttftMs`로 분리한다.

## 5.5 `totalTokens` — 총 토큰 사용량

정의:

```text
totalTokens = sum(totalTokens)
```

세부 지표:

```text
promptTokens = sum(promptTokens)
completionTokens = sum(completionTokens)
contextTokens = sum(contextTokens)       # 별도 기록된 경우
```

Source:

```text
ClickHouse llm_invocations.total_tokens
또는 usage rollup total_tokens
```

주의:

- 기본 `totalTokens`는 실제 Provider 사용 token 기준이다.
- Reply-to Context가 Provider에 전달되면 `promptTokens`에 포함된다.
- Gateway cache hit이면 실제 Provider token은 0일 수 있다.
- cache로 절감된 token은 `savedPromptTokens`, `savedCompletionTokens` 등 별도 지표로 확장한다.

## 5.6 `totalCostMicroUsd` / `totalCostUsd` — 총 비용

정의:

```text
totalCostMicroUsd = sum(costMicroUsd)
totalCostUsd = decimalString(totalCostMicroUsd / 1_000_000, scale = 6)
```

Source:

```text
ClickHouse llm_invocations.cost_micro_usd
또는 usage rollup cost_micro_usd
```

의미:

- Provider 호출로 실제 발생한 actual cost다.
- Retry/Fallback 중 billable attempt가 있으면 최종 request 비용에 포함한다.
- Gateway cache hit의 actual provider cost는 0이다.
- cache로 절감된 추정 비용은 `cacheSavingsMicroUsd`로 별도 표시한다.

주의:

- `estimatedCostMicroUsd`와 `actualCostMicroUsd`를 섞지 않는다.
- Dashboard 기본 총 비용은 actual cost 기준이다.
- 과거 비용은 최신 가격표로 재계산하지 않는다.

## 5.7 `costByModel` — 모델별 비용

정의:

```text
costByModel = group by provider, model
  sum(costMicroUsd)
  countDistinct(requestId)
  sum(totalTokens)
```

Primary Source:

```text
ClickHouse llm_provider_attempts.provider
ClickHouse llm_provider_attempts.model
ClickHouse llm_provider_attempts.cost_micro_usd
```

Fallback Source:

```text
ClickHouse llm_invocations.provider
ClickHouse llm_invocations.model
ClickHouse llm_invocations.cost_micro_usd
```

Fallback Source는 MVP 초기 임시 수단이다. retry/fallback billable attempt 비용이 모델별로 정확히 나뉘지 않을 수 있으므로 provider attempt 기반 집계를 우선한다.

Response item:

```json
{
  "provider": "openai",
  "model": "gpt-4o-mini",
  "requests": 420,
  "totalTokens": 300000,
  "costMicroUsd": 12340000,
  "costUsd": "12.340000",
  "averageCostUsd": "0.029381",
  "share": 0.31
}
```

주의:

- `provider + model`을 기본 group key로 사용한다.
- 같은 model name이 여러 provider에서 재사용될 수 있다.
- retry/fallback 중 비용이 발생한 attempt는 최종 응답 모델이 아니어도 모델별 비용에 포함한다.
- Provider와 Model은 string으로 유지한다.

## 5.8 `costByProject` — 프로젝트별 비용

정의:

```text
costByProject = group by projectId
  sum(costMicroUsd)
  countDistinct(requestId)
  sum(totalTokens)
```

Source:

```text
ClickHouse llm_invocations.project_id
ClickHouse llm_invocations.cost_micro_usd
PostgreSQL projects.name for display label
```

Response item:

```json
{
  "projectId": "project_01J...",
  "projectName": "Customer Support AI",
  "requests": 1200,
  "totalTokens": 800000,
  "costMicroUsd": 42250000,
  "costUsd": "42.250000",
  "budgetLimitUsd": "100.000000",
  "budgetUsageRate": 0.4225
}
```

주의:

- 비용 집계의 canonical source는 ClickHouse 또는 rollup이다.
- project 이름은 PostgreSQL Control Plane metadata에서 붙인다.
- 삭제된 project도 과거 로그 분석에서는 표시 가능해야 한다.

## 5.9 `errorRate` — 에러율

정의:

```text
errorEligibleRequests = totalRequests - blockedRequests - cancelledRequests

errorRate = if errorEligibleRequests > 0
  then failedRequests / errorEligibleRequests
  else null
```

표시:

```text
errorRatePercent = errorRate * 100
```

Source:

```text
failedRequests: status = 'error'
blockedRequests: status = 'blocked'
cancelledRequests: status = 'cancelled'
totalRequests: countDistinct(requestId)
```

주의:

- `blocked`는 정책 성공이므로 기본 에러율 분모에서 제외한다.
- `cancelled`는 client/user 동작일 수 있으므로 기본 에러율 분모에서 제외한다.
- 전체 실패 체감을 보고 싶으면 `grossErrorRate = failedRequests / totalRequests`를 별도 지표로 추가한다.
- denominator가 0이면 `0`이 아니라 `null`을 반환한다. UI는 `-`로 표시한다.

---

# 6. 보조 지표 정의

## 6.1 `blockedRequests`

```text
blockedRequests = countDistinct(requestId where status = 'blocked')
```

차단 사유 breakdown:

```text
budget_exceeded
quota_exceeded
rate_limit_exceeded
model_not_allowed
provider_not_allowed
sensitive_data_blocked
policy_denied
```

## 6.2 `cancelledRequests`

```text
cancelledRequests = countDistinct(requestId where status = 'cancelled')
```

Client disconnect, user cancel, network close를 추적한다.

## 6.3 `p95ResponseTimeMs`

```text
p95ResponseTimeMs = quantile(0.95)(latencyMs over latencyEligibleRequests)
```

장애 알림은 평균보다 p95를 우선한다.

## 6.4 `averageTtftMs`

```text
averageTtftMs = round(avg(ttftMs where ttftMs is not null))
```

Streaming UX 분석용이다. non-streaming 요청은 null일 수 있다.

## 6.5 `cacheHitRate`

```text
cacheHitRequests = count(request where cacheStatus = 'hit' and cacheType = 'exact')
cacheEligibleRequests = count(request where cacheStatus != 'bypass')
cacheHitRate = cacheHitRequests / max(cacheEligibleRequests, 1)
```

`bypass`를 denominator에 넣을지 여부는 API response에 `cacheEligibleRequests`로 명확히 표시한다.

## 6.6 `cacheSavingsMicroUsd`

```text
cacheSavingsMicroUsd = sum(savedCostMicroUsd where cacheStatus = 'hit' and cacheType = 'exact')
```

주의:

- 절감 비용은 추정값이다.
- actual cost와 더하지 않는다.
- 추정 기준 모델과 pricing version을 metadata에 남긴다.

## 6.7 `budgetUsageRate`

```text
budgetUsageRate = usedBudgetMicroUsd / max(limitBudgetMicroUsd, 1)
```

상태 기준:

| Status | 조건 |
|---|---|
| `ok` | 사용률 < 80% |
| `warning` | 사용률 >= 80% and < 100% |
| `exceeded` | 사용률 >= 100% |

threshold는 Runtime Policy 또는 Budget Policy로 확장 가능해야 한다.

---

# 7. Metric 상세 표

| Metric ID | 계산식 | Unit | Primary Source | 기본 포함 status |
|---|---|---|---|---|
| `totalRequests` | `countDistinct(requestId)` | count | `llm_invocations` / rollup | all final status |
| `successfulRequests` | `countDistinctIf(status in ('success','cache_hit','partial_success'))` | count | `llm_invocations.status` | success, cache_hit, partial_success |
| `failedRequests` | `countDistinctIf(status = 'error')` | count | `llm_invocations.status` | error |
| `blockedRequests` | `countDistinctIf(status = 'blocked')` | count | `llm_invocations.status` | blocked |
| `cancelledRequests` | `countDistinctIf(status = 'cancelled')` | count | `llm_invocations.status` | cancelled |
| `averageResponseTimeMs` | `round(avg(latencyMs))` | ms | `llm_invocations.latency_ms` | success, cache_hit, partial_success, error |
| `p95ResponseTimeMs` | `quantile(0.95)(latencyMs)` | ms | `llm_invocations.latency_ms` | success, cache_hit, partial_success, error |
| `averageTtftMs` | `round(avg(ttftMs))` | ms | `llm_invocations.ttft_ms` | streaming records |
| `promptTokens` | `sum(promptTokens)` | tokens | `llm_invocations.prompt_tokens` | recorded tokens |
| `completionTokens` | `sum(completionTokens)` | tokens | `llm_invocations.completion_tokens` | recorded tokens |
| `totalTokens` | `sum(totalTokens)` | tokens | `llm_invocations.total_tokens` | recorded tokens |
| `totalCostMicroUsd` | `sum(costMicroUsd)` | micro USD | `llm_invocations.cost_micro_usd` | billable requests |
| `totalCostUsd` | `decimal(totalCostMicroUsd / 1_000_000)` | USD string | API derived | billable requests |
| `estimatedCostMicroUsd` | `sum(estimatedCostMicroUsd)` | micro USD | invocation/cost metadata | requests with estimate |
| `cacheSavingsMicroUsd` | `sum(savedCostMicroUsd)` | micro USD | cache events / rollup | cache hit |
| `costByModel` | `group by provider, model; sum(costMicroUsd)` | micro USD | `llm_provider_attempts` / attempt rollup | billable attempts |
| `costByProject` | `group by projectId; sum(costMicroUsd)` | micro USD | `llm_invocations` / rollup | billable requests |
| `errorRate` | `failedRequests / (totalRequests - blockedRequests - cancelledRequests)` | ratio | derived | error eligible |
| `cacheHitRate` | `cacheHitRequests / cacheEligibleRequests` | ratio | cache events / invocation | cache eligible |
| `fallbackCount` | `sum(fallbackCount)` | count | invocation / routing events | all final status |
| `maskingEventCount` | `count(maskingEventId)` | count | masking events | all final status |

---

# 8. Dashboard 화면 구성

## 8.1 Overview Cards

MVP 상단 카드:

```text
총 요청 수
성공 요청 수
실패 요청 수
평균 응답 시간
총 토큰 사용량
총 비용
에러율
```

권장 추가 카드:

```text
캐시 적중률
캐시 절감액
P95 응답 시간
예산 사용률
차단 요청 수
```

## 8.2 기본 차트

| 차트 | Metric | 기본 GroupBy | 목적 |
|---|---|---|---|
| Requests over time | `totalRequests`, `successfulRequests`, `failedRequests` | time | 트래픽 추세 |
| Cost over time | `totalCostMicroUsd` | time | 비용 증가 감지 |
| Tokens over time | `totalTokens` | time | 사용량 추세 |
| Latency over time | `averageResponseTimeMs`, `p95ResponseTimeMs` | time | 성능 저하 감지 |
| Error Rate over time | `errorRate` | time | 장애 감지 |
| Cost by Model | `costByModel` | provider, model | 고비용 모델 확인 |
| Cost by Project | `costByProject` | project | 비용 책임 단위 확인 |
| Cache Hit Rate | `cacheHitRate` | time, cache type | 캐시 효과 확인 |

## 8.3 기본 테이블

| 테이블 | 주요 column |
|---|---|
| Top Models by Cost | provider, model, requests, tokens, cost, avgLatency, errorRate |
| Top Projects by Cost | projectName, requests, tokens, cost, budgetUsageRate, errorRate |
| Recent Errors | createdAt, requestId, project, provider, model, errorCode, sanitizedErrorMessage |
| Recent Blocked Requests | createdAt, requestId, project, blockReason, policyId |

## 8.4 Drill-down

Dashboard 숫자는 Request Log로 내려갈 수 있어야 한다.

예시:

```text
Cost by Model에서 openai/gpt-4o-mini 클릭
-> /api/projects/:projectId/logs?provider=openai&model=gpt-4o-mini&from=...&to=...
```

Drill-down에서도 raw prompt/raw response를 보여주지 않는다.

---

# 9. API Response 기준

Dashboard Overview API는 `api-spec.md`의 `GET /api/dashboard/overview`를 따른다. 지표 의미와 계산 공식은 이 문서가 기준이다.

권장 response shape:

```json
{
  "data": {
    "range": {
      "from": "2026-06-01T00:00:00.000Z",
      "to": "2026-06-23T00:00:00.000Z",
      "timezone": "Asia/Seoul",
      "grain": "day"
    },
    "filters": {
      "tenantId": "tenant_01J...",
      "projectId": null,
      "applicationId": null,
      "provider": null,
      "model": null
    },
    "requests": {
      "totalRequests": 1234,
      "successfulRequests": 1180,
      "failedRequests": 34,
      "blockedRequests": 15,
      "cancelledRequests": 5,
      "partialSuccessRequests": 0,
      "errorRate": 0.0279
    },
    "latency": {
      "averageResponseTimeMs": 820,
      "p50ResponseTimeMs": 700,
      "p95ResponseTimeMs": 2100,
      "averageTtftMs": 240
    },
    "tokens": {
      "promptTokens": 100000,
      "completionTokens": 200000,
      "totalTokens": 300000
    },
    "cost": {
      "totalCostUsd": "42.250000",
      "totalCostMicroUsd": 42250000,
      "estimatedCostUsd": "43.100000",
      "estimatedCostMicroUsd": 43100000,
      "cacheSavingsUsd": "2.120000",
      "cacheSavingsMicroUsd": 2120000,
      "currency": "USD"
    },
    "cache": {
      "cacheHitRequests": 100,
      "exactCacheHits": 80,
      "semanticCacheHits": 20,
      "cacheMisses": 320,
      "cacheHitRate": 0.2381
    },
    "budget": {
      "limitUsd": "100.000000",
      "usedUsd": "42.250000",
      "remainingUsd": "57.750000",
      "usageRate": 0.4225,
      "status": "ok"
    },
    "topModelsByCost": [
      {
        "provider": "openai",
        "model": "gpt-4o-mini",
        "requestCount": 420,
        "totalTokens": 300000,
        "totalCostUsd": "12.340000",
        "totalCostMicroUsd": 12340000
      }
    ],
    "topProjectsByCost": [
      {
        "projectId": "project_01J...",
        "projectName": "Customer Support AI",
        "requestCount": 1200,
        "totalTokens": 800000,
        "totalCostUsd": "42.250000",
        "totalCostMicroUsd": 42250000,
        "budgetUsageRate": 0.4225
      }
    ],
    "timeSeries": [],
    "providerHealth": [],
    "alerts": [],
    "dataFreshness": {
      "lastIngestedAt": "2026-06-22T08:20:30.000Z",
      "lastRollupUpdatedAt": "2026-06-22T08:20:42.000Z",
      "source": "clickhouse_rollup"
    }
  }
}
```

규칙:

- 비용은 micro USD integer와 USD decimal string을 함께 반환한다.
- ratio는 0~1 number로 반환한다. UI가 percent로 표시한다.
- denominator가 0인 ratio는 `null`로 반환한다.
- 새로운 breakdown은 기존 field를 제거하지 않고 추가한다.
- raw prompt/raw response는 response에 포함하지 않는다.

---

# 10. 데이터 소스와 집계 기준

## 10.1 Raw source

| 데이터 | Primary Source | 설명 |
|---|---|---|
| 요청 수 | `llm_invocations` | request 단위 terminal log |
| status별 수 | `llm_invocations` | success/error/blocked/cache_hit |
| latency | `llm_invocations` | Gateway end-to-end latency |
| token | `llm_invocations` | request 단위 token 합계 |
| 총 비용 | `llm_invocations` | request 단위 actual cost 합계 |
| 모델별 비용 | `llm_provider_attempts` | billable attempt별 provider/model 비용 |
| 프로젝트별 비용 | `llm_invocations` | projectId 기준 cost 합계 |
| cache 지표 | `llm_cache_events` | exact/semantic hit/miss |
| routing 지표 | `llm_routing_events` | routing decision/fallback |
| masking 지표 | `llm_masking_events` | redacted/blocked |

## 10.2 Rollup source

Overview Dashboard는 아래 순서로 조회한다.

```text
1. usage_hourly_rollups 또는 materialized view
2. usage_daily_rollups
3. raw llm_invocations / llm_provider_attempts
```

raw table full scan은 기본 금지다. MVP 초기 데이터가 작아 임시로 raw query를 쓰는 경우 별도 이슈와 제거 계획을 남긴다.

## 10.3 Dedupe 기준

```text
request-level metric: requestId 기준 dedupe
provider-attempt metric: providerAttemptId 기준 dedupe
cache event metric: cacheEventId 기준 dedupe
masking event metric: maskingEventId 기준 dedupe
routing event metric: routingEventId 기준 dedupe
```

---

# 11. Query 기준

## 11.1 Total metric query

개념 SQL:

```sql
select
  countDistinct(request_id) as total_requests,
  countDistinctIf(request_id, status in ('success', 'cache_hit', 'partial_success')) as successful_requests,
  countDistinctIf(request_id, status = 'error') as failed_requests,
  countDistinctIf(request_id, status = 'blocked') as blocked_requests,
  countDistinctIf(request_id, status = 'cancelled') as cancelled_requests,
  sum(prompt_tokens) as prompt_tokens,
  sum(completion_tokens) as completion_tokens,
  sum(total_tokens) as total_tokens,
  sum(cost_micro_usd) as total_cost_micro_usd,
  avgIf(latency_ms, status in ('success', 'cache_hit', 'partial_success', 'error')) as average_latency_ms,
  quantileIf(0.95)(latency_ms, status in ('success', 'cache_hit', 'partial_success', 'error')) as p95_latency_ms
from llm_invocations
where tenant_id = {tenantId}
  and created_at >= {from}
  and created_at < {to};
```

## 11.2 Error rate query

```text
errorEligibleRequests = totalRequests - blockedRequests - cancelledRequests
errorRate = if errorEligibleRequests > 0 then failedRequests / errorEligibleRequests else null
blockRate = if totalRequests > 0 then blockedRequests / totalRequests else null
```

## 11.3 Model cost query

개념 SQL:

```sql
select
  provider,
  model,
  countDistinct(request_id) as requests,
  sum(prompt_tokens) as prompt_tokens,
  sum(completion_tokens) as completion_tokens,
  sum(total_tokens) as total_tokens,
  sum(cost_micro_usd) as cost_micro_usd
from llm_provider_attempts
where tenant_id = {tenantId}
  and created_at >= {from}
  and created_at < {to}
group by provider, model
order by cost_micro_usd desc;
```

## 11.4 Project cost query

개념 SQL:

```sql
select
  project_id,
  countDistinct(request_id) as requests,
  sum(total_tokens) as total_tokens,
  sum(cost_micro_usd) as cost_micro_usd
from llm_invocations
where tenant_id = {tenantId}
  and created_at >= {from}
  and created_at < {to}
group by project_id
order by cost_micro_usd desc;
```

Project name, budget limit은 PostgreSQL Control Plane DB에서 붙인다.

---

# 12. 권한 기준

| 사용자 | 접근 가능 지표 |
|---|---|
| Tenant Admin | tenant 전체, 모든 project/application/user aggregate |
| Project Admin | 소속 project aggregate, project 내 application/user aggregate |
| Developer | 권한 있는 project/application의 기술 지표 |
| Employee | 개인 사용량. MVP에서는 제외 가능 |
| 우리 서비스 관리자 | 운영 목적의 tenant 상태. 고객 데이터 원문 접근 금지 |

권한 없는 scope의 지표는 aggregate라도 반환하지 않는다.

---

# 13. Alert 기준

| Alert | 조건 예시 | 기본 Severity |
|---|---|---|
| Budget 80% 도달 | `budgetUsageRate >= 0.8` | warning |
| Budget 초과 | `budgetUsageRate >= 1.0` | critical |
| Error Rate 상승 | 최근 15분 `errorRate >= 0.05` | warning |
| Provider Error Rate 상승 | provider별 `errorRate >= 0.1` | warning |
| Latency 상승 | 최근 15분 `p95ResponseTimeMs >= threshold` | warning |
| Cache Hit Rate 하락 | 최근 1시간 cacheHitRate 급락 | info |
| Masking Block 증가 | sensitive block 증가 | warning |

threshold는 하드코딩하지 않고 Runtime Policy 또는 Alert Rule로 확장 가능해야 한다.

---

# 14. 구현 위치

Frontend:

```text
apps/web/src/app/(console)/dashboard/page.tsx
apps/web/src/features/dashboard
apps/web/src/features/analytics
```

Backend:

```text
apps/control-plane-api/src/modules/dashboard
apps/control-plane-api/src/modules/analytics
apps/worker/src/consumers/llm-invocations
apps/worker/src/sinks/clickhouse
```

규칙:

- Page component는 route 연결만 담당한다.
- API response type은 `packages/contracts` 또는 generated type을 사용한다.
- 비용 계산을 Frontend에서 다시 하지 않는다.
- SQL query는 tenant/project permission check 이후 실행한다.
- PostgreSQL은 project name, budget policy, tenant metadata 등 control data 조회에 사용한다.
- ClickHouse/rollup은 비용, 토큰, latency, request count 조회에 사용한다.

---

# 15. 테스트 기준

## 15.1 Unit Test

- `cache_hit`이 successfulRequests에 포함된다.
- `partial_success`가 successfulRequests에 포함된다.
- `blocked`가 failedRequests와 errorRate denominator에서 제외된다.
- `cancelled`가 errorRate denominator에서 제외된다.
- 비용이 micro USD 정수로 합산된다.
- denominator가 0인 ratio는 null로 반환된다.
- token 합계가 prompt + completion과 일치한다.
- timezone bucket 변환이 정확하다.

## 15.2 Integration Test

```text
Gateway request
-> request_completed event
-> Worker consume
-> ClickHouse insert
-> rollup 갱신
-> Dashboard API 조회
-> UI card 표시
```

검증:

- Request Log 숫자와 Dashboard totalRequests가 일치한다.
- 모델별 비용 합계와 provider attempt 비용 합계가 일치한다.
- 프로젝트별 비용 합계와 총 비용이 일치한다.
- cache hit은 actual cost 0으로 집계된다.
- blocked request는 errorRate에 포함되지 않는다.

## 15.3 Regression Test

- 새 Provider 추가 후 filter와 chart가 깨지지 않는다.
- 새 Model 추가 후 migration 없이 모델별 비용에 표시된다.
- pricing version 변경 후 과거 비용이 변하지 않는다.
- 새 status 추가 시 Dashboard 계산식 영향이 문서에 먼저 반영된다.

---

# 16. 구현 금지 사항

- Frontend에서 비용, 토큰, 에러율을 임의 집계하지 않는다.
- `costUsd` string을 JavaScript number로 누적 합산하지 않는다.
- `blocked` 요청을 실패 요청으로 합산하지 않는다.
- `cache_hit`을 성공 요청에서 제외하지 않는다.
- Provider attempt 수를 total request 수로 사용하지 않는다.
- retry/fallback 비용을 누락하지 않는다.
- Gateway cache saving을 actual cost에 더하지 않는다.
- estimated cost를 actual cost로 표시하지 않는다.
- raw prompt/raw response를 Dashboard에 표시하지 않는다.
- Provider/Model을 enum으로 닫지 않는다.
- unknown provider/model/project 데이터를 버리지 않는다.
- 장기간 Dashboard Overview를 PostgreSQL request log에서 full scan하지 않는다.
- Gateway가 Dashboard 지표를 동기 계산하지 않는다.
- 문서 수정 없이 metric field를 추가하지 않는다.

---

# 17. MVP 구현 체크리스트

- [ ] `GET /api/dashboard/overview`가 totals를 반환한다.
- [ ] `totalRequests`가 provider attempt count가 아니라 request count다.
- [ ] `successfulRequests`에 `success`, `cache_hit`, `partial_success`가 포함된다.
- [ ] `failedRequests`는 `error` 기준이다.
- [ ] `blockedRequests`가 별도 집계된다.
- [ ] `errorRate` 분모에서 `blocked`, `cancelled`가 제외된다.
- [ ] `averageResponseTimeMs`는 Gateway end-to-end latency 기준이다.
- [ ] `totalTokens`는 `llm-log-schema.md`의 token 기준을 따른다.
- [ ] `totalCostMicroUsd`는 `cost-policy.md`의 actual cost 기준이다.
- [ ] `costByModel`은 provider attempt의 `provider + model` 기준이다.
- [ ] `costByProject`는 request의 `projectId` 기준이다.
- [ ] 비용은 micro USD integer로 집계된다.
- [ ] Dashboard는 raw prompt/raw response를 표시하지 않는다.
- [ ] 권한 없는 tenant/project 데이터가 노출되지 않는다.
- [ ] 장기간 조회는 rollup/materialized view를 사용한다.
- [ ] 새 Provider/Model 추가 시 코드 변경 없이 표시된다.

---

# 18. AI 구현자 지침

AI가 Dashboard 코드를 작성하거나 수정할 때는 아래 순서를 지킨다.

```text
1. dashboard-metrics.md에서 metric 정의를 확인한다.
2. llm-log-schema.md에서 source field와 status 의미를 확인한다.
3. cost-policy.md에서 비용 계산/표시 기준을 확인한다.
4. db-schema.md에서 ClickHouse/rollup table을 확인한다.
5. api-spec.md에서 API response shape을 확인한다.
6. folder-structure.md에서 구현 위치를 확인한다.
7. coding-convention.md에 맞춰 DTO/service/repository를 작성한다.
8. 변경이 크면 먼저 계획을 제시한다.
```

새 metric이 필요하면 먼저 이 문서를 수정한다. 구현 코드에 임의 지표를 추가하지 않는다.

---

# 16. PII Masking Dashboard 기준

민감정보 지표는 `pii-masking-policy.md`의 action/outcome 기준을 따른다.

기본 지표:

| Metric | 계산 기준 | 설명 |
|---|---|---|
| `redactedRequests` | `maskingAction = redacted` | redaction 후 Provider 또는 cache 처리된 요청 수 |
| `blockedRequests` | `maskingAction = blocked` | Provider 호출 전 차단된 요청 수 |
| `maskingEventCount` | `llm_masking_events` count | detector event 수 |
| `maskingBlockRate` | `blockedRequests / totalRequests` | 보안 정책 차단 비율 |
| `topMaskingDetectorTypes` | detector type별 count | email, phone_number, api_key 등 |

계산 기준:

- block 요청은 기본 error rate에 포함하지 않는다.
- block 요청은 별도 `maskingBlockRate`와 `blockedRequests`로 표시한다.
- Dashboard는 raw detected value, raw prompt, raw response, sampleHash를 표시하지 않는다.
- detector type은 확장 가능 string으로 처리한다. 알 수 없는 type은 `unknown` 또는 원문 string으로 group-by한다.
