# GateLM v2.0.0 Team Debate Contract Prep

## 1. Status

이 문서는 GateLM v2.0.0 구현 계획을 만들기 전에 계약으로 확정해야 할 논점을 정리한 준비 문서다.

현재 파일은 frozen contract가 아니다. 공식 API, DB, Event, Metrics, fixture, schema 필드는 이후 `docs/v2.0.0/contracts.md`에서만 확정한다.

v2.0.0 계약을 작성할 때는 v1.0.0 baseline을 깨지 않는 것을 기본 전제로 둔다.

```text
v1.0.0 baseline
-> v2.0.0 contract prep
-> docs/v2.0.0/contracts.md
-> docs/v2.0.0/implementation-plan.md
```

## 2. v2.0.0 Direction

v2.0.0은 v1.0.0의 B2B LLM Gateway baseline을 운영 가능한 제품 구조로 확장한다.

핵심 방향:

- terminal status와 domain outcome 분리를 계약 후보로 검토한다.
- RuntimeConfig와 RuntimeSnapshot의 역할을 분리한다.
- Actual Provider 1종과 모델 2개 이상을 붙이되 Mock fallback을 유지한다.
- teamId는 조직 구조로 두고, 비용/쿼터/대시보드 귀속은 budgetScope로 일반화한다.
- Dashboard는 aggregate grain, freshness, query budget을 가진 운영 화면으로 정리한다.
- Streaming은 완성형이 아니라 thin slice로 시작한다.
- Semantic Cache는 v2.0.0 core path가 아니라 evidence track으로 둔다.
- raw prompt, raw response, secret 원문 저장 금지는 v2.0.0에서도 유지한다.

## 3. Terminal Status And Domain Outcome

### 3.1 Problem

Request log에 terminal status만 있으면 운영자가 요청이 왜 그렇게 끝났는지 알기 어렵다.

예를 들어 `success` 하나만 보면 아래 상황이 모두 섞일 수 있다.

- Provider가 바로 성공했다.
- Exact Cache hit로 Provider를 호출하지 않았다.
- Provider timeout 이후 Mock fallback으로 성공했다.
- Streaming 요청이 정상 완료되었다.

반대로 모든 의미를 terminal status에 넣으면 상태값이 폭발한다.

따라서 v2.0.0 계약 후보로 다음 원칙을 검토한다.

```text
terminal status = 사용자 관점에서 최종적으로 어떻게 끝났는가
domain outcome = 각 단계에서 왜 그렇게 끝났는가
```

### 3.2 Terminal Status Candidate

v2.0.0 terminal status 후보는 작게 유지한다. 아래 값은 확정 계약이 아니라 `docs/v2.0.0/contracts.md`에서 검증할 후보다.

```text
success
blocked
rate_limited
failed
cancelled
```

| Status | Meaning |
|---|---|
| `success` | 사용자에게 정상 응답이 전달됨. cache hit와 fallback success도 포함한다. |
| `blocked` | 정책 또는 인증/권한 판단으로 요청이 의도적으로 차단됨. |
| `rate_limited` | rate limit 정책으로 요청이 차단됨. |
| `failed` | Gateway 또는 Provider 문제로 정상 응답을 전달하지 못함. |
| `cancelled` | client abort, streaming 중단 등으로 요청이 취소됨. |

v1.0.0의 `cache_hit`은 v2.0.0에서는 terminal status가 아니라 cache domain outcome으로 내리는 방향을 검토한다.

```text
terminalStatus = success
cache.outcome = hit
provider.outcome = not_called
```

### 3.3 Domain Outcome Groups

v2.0.0 domain outcome group 후보:

```text
auth
runtime
rateLimit
budget
safety
routing
cache
provider
fallback
streaming
logging
```

후보 원칙:

- outcome 값은 작게 유지한다.
- 자세한 이유는 `reason`, `code`, `metadata`로 분리한다.
- 실행되지 않은 stage는 비워두지 않고 명시적으로 표현한다.
- Observability는 Gateway가 남긴 outcome을 저장/집계한다. 직접 추론하지 않는다.

### 3.4 Domain Outcome Candidate Values

| Domain | Outcome candidates |
|---|---|
| `auth` | `passed`, `invalid_api_key`, `invalid_app_token`, `scope_mismatch`, `not_checked` |
| `runtime` | `snapshot_active`, `last_known_safe_used`, `stale_snapshot_used`, `no_snapshot`, `not_checked` |
| `rateLimit` | `allowed`, `rate_limited`, `disabled`, `error`, `not_checked` |
| `budget` | `allowed`, `warned`, `blocked`, `not_used`, `not_checked` |
| `safety` | `passed`, `redacted`, `blocked`, `not_checked` |
| `routing` | `selected`, `skipped`, `failed`, `not_checked` |
| `cache` | `hit`, `miss`, `bypassed`, `error`, `not_used` |
| `provider` | `success`, `timeout`, `error`, `unauthorized`, `not_called` |
| `fallback` | `not_needed`, `disabled`, `success`, `failed`, `not_called` |
| `streaming` | `not_streaming`, `started`, `completed`, `interrupted`, `cancelled` |
| `logging` | `written`, `failed`, `deferred`, `not_called` |

`routing`은 `selected_primary_model`, `selected_cheaper_model`처럼 outcome을 세분화하기보다 아래처럼 나누는 편이 안전하다.

```text
routing.outcome = selected
routing.reason = short_prompt_low_cost
```

## 4. Terminal Status Decision Rules

v2.0.0 계약에서는 domain outcome을 기반으로 terminal status를 결정하는 규칙 후보가 필요하다.

초안:

| Condition | Terminal status |
|---|---|
| 사용자에게 정상 응답이 전달됨 | `success` |
| Safety/Budget/Policy가 의도적으로 차단함 | `blocked` |
| Rate limit이 차단함 | `rate_limited` |
| Provider/Gateway 오류로 응답하지 못함 | `failed` |
| client abort 또는 stream 취소 | `cancelled` |

Auth 실패는 v1.0.0의 `401 invalid_api_key`, `403 invalid_app_token` 계약과 연결해야 하므로 `blocked`, `failed`, 별도 terminal status 중 어디에 둘지 아직 open question으로 둔다.

Fallback으로 성공한 요청은 사용자 관점에서 성공으로 본다.

```text
terminalStatus = success
provider.outcome = timeout
fallback.outcome = success
```

Cache hit도 사용자 관점에서는 성공으로 본다.

```text
terminalStatus = success
cache.outcome = hit
provider.outcome = not_called
```

## 5. RuntimeConfig And RuntimeSnapshot

### 5.1 Concept

v2.0.0에서는 RuntimeConfig와 RuntimeSnapshot을 명확히 분리한다.

| Concept | Meaning |
|---|---|
| `RuntimeConfig` | 관리자가 수정하는 draft/editable 설정 |
| `RuntimeSnapshot` | 검증 후 publish되어 Gateway가 실제 사용하는 immutable 실행본 |

### 5.2 Contract Direction

- Gateway는 RuntimeConfig를 직접 소비하지 않는다.
- Gateway가 소비하는 것은 항상 published RuntimeSnapshot이다.
- RuntimeSnapshot은 immutable하게 저장한다.
- 설정 변경이 필요하면 기존 snapshot을 수정하지 않고 새 snapshot을 만든다.
- DB를 source of truth로 둔다.
- Redis는 active snapshot pointer/cache 용도로만 사용한다.
- Request Detail에는 실제 요청에 사용된 snapshot provenance를 남긴다.

Request Detail provenance 후보:

```text
runtimeSnapshotId
runtimeSnapshotVersion
policyVersion
contentHash
configHash
securityPolicyHash
routingPolicyHash
publishedAt
publishedBy
runtimeState
gatewayInstanceId
```

위 목록은 후보이며, 공식 계약에서는 중복 필드를 줄인다. Request Detail에는 full RuntimeSnapshot 내용을 복사하지 않고, 재현과 추적에 필요한 provenance만 남기는 방향을 우선 검토한다.

RuntimeSnapshot에는 provider credential, API Key, App Token, Authorization header, 실제 secret 평문을 포함하지 않는다. Provider credential은 credential reference 또는 hash 계열 메타데이터로만 연결한다.

### 5.3 Publish And Reload Failure

정책 변경 실패 시 새 정책을 억지로 적용하지 않는다.

| Failure | Expected behavior |
|---|---|
| validation 실패 | snapshot 생성 안 함 |
| publish 실패 | active snapshot pointer 변경 안 함 |
| Gateway reload 실패 | Gateway는 메모리에 있던 last loaded snapshot으로 계속 처리 |
| 일부 Gateway만 reload 성공 | 요청 로그에 실제 사용한 snapshot provenance를 남김 |

`last_known_safe`는 snapshot 자체의 상태라기보다 Gateway runtime 상태로 보는 것이 자연스럽다.

## 6. Identity And Budget Scope

### 6.1 Core Identity

Gateway의 기본 요청 식별 축은 v1.0.0과 같이 유지한다.

```text
tenantId
projectId
applicationId
```

### 6.2 Budget Scope

`teamId`는 조직 구조를 설명하는 엔티티로 두고, 비용/쿼터/대시보드 귀속은 `budgetScopeType`과 `budgetScopeId`로 일반화한다.

```text
budgetScopeType
budgetScopeId
```

budgetScopeType 후보:

```text
application
project
team
```

원칙:

- `teamId`를 Gateway core identity로 바로 승격하지 않는다.
- `teamId`는 조직 구조 표현에 사용한다.
- 비용/쿼터/대시보드 귀속은 resolved budget scope로 표현한다.
- client request body에서 넘어온 budgetScope는 신뢰하지 않는다.
- Gateway는 인증 결과와 RuntimeSnapshot/Control Plane 규칙으로 검증된 budget scope만 소비한다.
- `department`는 v2.0.0에서 공식 scope로 고정하지 않고 v2.x 후보로 둔다.

요약:

```text
team = 조직 구조
budgetScope = 비용/쿼터/대시보드 귀속
```

## 7. Provider, Model, Routing, Fallback

### 7.1 Actual Provider Direction

v2.0.0 전후로 실제 LLM Provider 1종은 연결하는 방향이 좋다.

권장 방향:

```text
Actual Provider 1종
+ 모델 2개 이상
+ Mock fallback 유지
```

이 구조는 제품성, 발표 안정성, 구현 리스크 사이의 균형이 좋다.

### 7.2 Provider And Model Rules

- Provider와 Model은 enum으로 고정하지 않는다.
- Provider별 호출 로직은 Provider Adapter 안에 둔다.
- Gateway handler는 특정 Provider 이름에 의존하지 않는다.
- Provider/Model catalog는 DB/config/RuntimeSnapshot 기반으로 확장 가능하게 둔다.
- RuntimeSnapshot에는 Provider Key 평문을 포함하지 않는다. Provider 호출에 필요한 secret은 안전한 credential reference로만 연결한다.
- `model=auto` routing은 유지한다.
- 요청 모델과 실제 선택 모델은 구분해서 남긴다.
- selectedProvider, selectedModel, routingReason은 Request Detail/Dashboard에서 추적 가능해야 한다.

예시:

```text
requestedModel = auto
selectedProvider = openai-compatible
selectedModel = low-cost-chat-model
routingReason = short_prompt_low_cost
```

### 7.3 Fallback Rules

fallback은 terminal status를 대체하지 않고 provider/fallback outcome으로 설명한다.

예시:

```text
terminalStatus = success
provider.outcome = timeout
fallback.outcome = success
```

구분해야 할 상태:

- primary provider success
- primary provider timeout
- primary provider error
- primary provider unauthorized
- fallback disabled
- fallback success
- fallback failed

## 8. Streaming Thin Slice

Streaming은 초기부터 고려하되 v2.0.0에서 완성형으로 만들지 않는다.

v2.0.0 권장 범위:

- 사용자에게 응답이 조금씩 오는 체감을 제공한다.
- Request Log/Detail은 우선 final status 중심으로 기록한다.
- token별 상세 logging은 필수 범위에 넣지 않는다.
- provider별 streaming normalization은 v2.x 고도화로 미룬다.
- response-side safety scan은 v2.0.0 main path로 넣지 않는다.
- request-side safety는 Provider 호출 전에 반드시 끝나야 한다.

Streaming 때문에 safety 순서가 뒤로 밀리면 안 된다.

초기 개선 후보:

```text
context cancellation
provider timeout
client disconnect 처리
backpressure
DB/Redis connection pool
log write latency
```

## 9. Dashboard Aggregate, Freshness, Query Budget

Dashboard는 모든 기준을 무제한으로 열어두지 않는다.

v2.0.0 최소 grain 후보:

```text
organization 또는 tenant
budget scope
application
provider/model
safety outcome
cache status
fallback outcome
```

화면별 권장 grain:

| Screen | Primary grain |
|---|---|
| Overview | organization/tenant, application, budget scope |
| Cost | application, provider/model, budget scope |
| Safety | safety outcome, detector summary, application |
| Cache | cache status, application, provider/model |
| Provider | provider/model, fallback outcome, latency |
| Request Detail | terminal status + domain outcomes |

Freshness는 UI에서 숨기지 않는다.

```text
lastIngestedAt
lastAggregatedAt
source
isStale
```

화면별 freshness 방향:

| Surface | Freshness direction |
|---|---|
| Demo Dashboard | 짧은 polling 또는 수동 refresh, 최근 traffic 중심 |
| Operation Overview | manual refresh 기본, 필요 화면만 30~60초 polling |
| Analytics / Drilldown | manual refresh, 시간 범위 제한, query budget 적용 |

Query budget 원칙:

- API가 기본 기간 제한을 둔다.
- API가 기본 grain 제한을 둔다.
- 큰 범위는 daily/monthly rollup을 우선한다.
- query budget 초과 시 UI는 필터를 줄이도록 안내한다.

## 10. Performance Baseline And Query Profile

v2.0.0의 성능 기준은 Gateway k6 baseline과 Dashboard query profile을 분리 측정하는 것이다.

### 10.1 k6 Scenario Candidates

```text
baseline_success
cache_hit
cache_miss_provider_call
safety_redaction
safety_block_provider_bypass
rate_limited
provider_timeout
provider_error_mock_fallback
streaming_thin_slice
mixed_demo_traffic
```

### 10.2 Metrics Interpretation

- `p95`는 주 성능 기준으로 둔다.
- `p99`는 timeout, 지연, 병목 후보 확인 기준으로 둔다.
- error rate는 시스템 실패만 포함한다.
- `safety_block`, `rate_limited`는 정책 결과로 분리한다.
- Provider 포함 latency와 Gateway internal latency를 분리한다.

### 10.3 Data Platform Direction

v2.0.0에서는 PostgreSQL 기반 최적화를 우선한다.

| Topic | v2.0.0 direction |
|---|---|
| PostgreSQL index/query shape | v2.0.0에서 우선 최적화 |
| Partition | 시간 범위 조회 병목이 반복적으로 확인되면 v2.x에서 검토 |
| TimescaleDB | 장기 time-series 집계와 보관이 핵심 요구가 되면 v2.x 이후 검토 |
| ClickHouse/Event pipeline | 초대량 분석 또는 별도 이벤트 파이프라인이 필요할 때 v2.5 이후 검토 |

## 11. Demo Input Strategy

발표 데모는 preset 중심으로 간다.

청중 자유 입력은 v2.0.0 core demo에서는 위험하다.

이유:

- 예측 불가
- 민감정보 입력 가능
- rate limit/cache/safety 결과가 발표 흐름을 망칠 수 있음

권장 구조:

```text
scenario runner
+ safe preset
+ cache hit preset
+ redaction preset
+ block preset
+ rate limit preset
+ provider timeout preset
+ provider error + fallback preset
+ streaming thin slice preset
```

제한 자유 입력은 별도 sandbox mode 후보로 둔다.

Sandbox mode 최소 조건:

- 강한 rate limit
- safety precheck
- emergency stop
- raw prompt 저장 금지
- request log에는 redacted preview만 표시

## 12. Raw Prompt, Response, And Safety Provenance

v2.0.0에서도 raw prompt/raw response는 저장하거나 표시하지 않는다.

허용 후보:

```text
redactedPromptPreview
promptHash
requestBodyHash
responseSummary
responseHash
maskingAction
detectedTypes
detectedCount
routing/cache/provider/rate limit metadata
sanitized errorMessage
```

권한별 노출 방향:

| Audience | Show | Hide |
|---|---|---|
| Employee | 보안 정책에 따라 수정/차단됨 수준의 안내 | detector type, redacted preview, prompt hash, policy hash, raw value |
| Developer | maskingAction, detector category summary, detected count, requestId, applicationId, errorCode | raw value, raw prompt/response, 상세 policy rule 내용 |
| Admin | redacted preview, detector type summary, detected count, applied RuntimeSnapshot/version/hash, policy summary | raw value, raw prompt/response, secret 원문 |

Raw 저장 opt-in은 v2.0.0 범위에 넣지 않는다.

v2.x에서 opt-in을 검토하려면 최소 조건이 필요하다.

```text
tenant 단위 명시적 opt-in
기본값 off
prompt 저장과 response 저장 별도 설정
project/application 단위 scope 제한
RBAC
KMS/envelope encryption
짧은 retention과 자동 삭제
열람 audit log
UI 기본 비노출
export/download 제한
test/fixture/seed raw 금지 유지
cache key, metrics label, structured log raw 금지 유지
```

## 13. Semantic Cache Direction

v2.0.0 core cache 기능은 Exact Cache로 제한한다.

Semantic Cache는 Safety/Evaluation evidence track으로 둔다.

원칙:

- 실제 Gateway 응답 경로에서 자동 hit 처리하지 않는다.
- 실제 cacheHitRate에 섞지 않는다.
- 실제 savedCost에 합산하지 않는다.
- raw prompt 없이 normalized redacted prompt 기준으로만 실험한다.

Dashboard 표현:

```text
Exact Cache
- 실제 Gateway 응답 경로에 적용
- cache.outcome = hit/miss/bypassed/error
- 실제 provider bypass
- savedCostMicroUsd 집계 가능

Semantic Cache Candidate
- 실험/evidence 지표
- wouldHaveHit
- candidateSimilarity
- evaluationPassRate
- 실제 cacheHitRate와 분리
- 실제 savedCost와 분리
```

Semantic experiment 기준:

```text
raw prompt 금지
redaction 이후 normalized prompt만 사용
embedding도 redacted prompt 기준
tenantId/projectId/applicationId scope 격리
securityPolicyHash 포함
routingPolicyHash 포함
selectedProvider/selectedModel 포함
실제 개인정보/secret fixture 금지
```

## 14. Employee Chat UI Boundary

직원 Chat도 별도 예외 경로가 아니라 Application 중 하나로 취급한다.

원칙:

- 내부 직원 요청도 Gateway의 동일한 흐름을 탄다.
- App Token 또는 동등한 Application boundary를 사용한다.
- Application context를 가진다.
- Runtime policy를 적용받는다.
- Request Log, Request Detail, Dashboard aggregate에 포함된다.
- Employee Chat UI는 Provider를 직접 호출하지 않는다.

Employee Chat이 브라우저에서 Gateway를 직접 호출할지, Web BFF/server가 App Token을 보관하고 Gateway를 호출할지는 아직 open question이다. 어떤 방식이든 raw App Token을 브라우저나 로그에 노출하지 않는다.

표시 수준은 분리한다.

| Surface | Visibility |
|---|---|
| Employee UI | 응답, requestId, 간단한 상태 |
| Admin/Developer UI | routing, cache, safety, provider, latency, cost, policy provenance |

## 15. Contract Decisions Needed Before Implementation Plan

v2.0.0 implementation plan 전에 아래 질문을 먼저 확정한다. 아래 항목은 현재 계약 후보이며, 이 문서에서 필드명이나 저장 구조를 확정하지 않는다.

1. `cache_hit`을 terminal status에서 제거하고 `success + cache.outcome=hit`로 볼 것인가?
2. auth 실패를 `blocked`로 볼 것인가, `failed`로 볼 것인가, 별도 terminal status로 둘 것인가?
3. 미실행 stage 표현을 `not_called`, `not_checked`, `not_used`로 나눌 것인가?
4. `budgetScopeType`은 `application/project/team`까지만 둘 것인가?
5. fallback success는 항상 `terminalStatus=success`로 볼 것인가?
6. streaming 중 client abort와 provider interruption을 각각 어떤 terminal status로 남길 것인가?
7. RuntimeSnapshot provenance 필드를 어디까지 Request Detail/Dashboard에 노출할 것인가?
8. Provider/Model catalog는 Control Plane DB에서 관리하고 RuntimeSnapshot에 포함할 것인가? 이때 Provider credential은 reference/hash로만 연결할 것인가?
9. Budget warning은 사용자 응답에 표시할 것인가, 운영자 화면에만 표시할 것인가?
10. Dashboard freshness와 query budget을 API 계약에 포함할 것인가?
11. Employee Chat의 Gateway 호출은 브라우저 direct 방식인가, Web BFF/server-side 방식인가?
12. P0 legacy field cleanup을 Actual Provider와 RuntimeSnapshot live 작업 전에 먼저 끝낼 것인가?

우선 검토할 항목 중 하나는 `cache_hit`의 위치다.

`cache_hit`을 terminal status에서 domain outcome으로 내리면 v2.0.0의 상태 체계가 단순해지고, fallback, streaming, provider timeout도 같은 방식으로 설명할 수 있다.

## 16. Suggested v2.0.0 Planning Order

v2.0.0 구현 계획은 아래 순서로 짜는 것이 좋다. 구현 시작 전 P0 legacy field cleanup 범위도 함께 확정한다.

1. P0 legacy field cleanup 범위 확정
2. Terminal status/domain outcome 계약 확정
3. RuntimeSnapshot publish/reload/provenance 계약 확정
4. Budget scope 계약 확정
5. Actual Provider 1종 + 모델 2개 + Mock fallback 계약 확정
6. Request Detail/Dashboard outcome 표시 계약 확정
7. Streaming thin slice 범위 확정
8. k6 baseline/query profile 기준 확정
9. Semantic Cache evidence track 분리 확정

## 17. Non Goals For v2.0.0 Core

v2.0.0 core에 넣지 않을 후보:

- raw prompt/raw response 저장 opt-in
- Semantic Cache를 실제 응답 경로에 자동 적용
- ClickHouse 기반 운영 분석 필수화
- Redpanda event pipeline 필수화
- token별 streaming 상세 logging
- response-side safety scan main path
- 직원 Chat의 Provider 직접 호출
- Web Console의 사용자 LLM 요청 Provider proxy

## 18. One Line Summary

v2.0.0 계약 준비의 핵심은 terminal status/domain outcome 후보, RuntimeSnapshot, budgetScope, Actual Provider + Mock fallback, Dashboard query profile을 검토해 공식 계약으로 승격할 범위를 정하는 것이다.
