# GateLM P0 Day4 Log Scope Check

## 1. 문서 목적

이 문서는 Day4 병렬 개발 전에 A가 B/C/D/E에게 공유하는 로그 조회 scope 기준이다.

Day4의 핵심은 `requestId -> Request Log -> Request Detail -> Dashboard` 흐름을 만들되, 로그가 반드시 tenant/project 범위 안에서만 조회되게 하는 것이다.

이 문서는 새 API 계약을 추가하지 않는다. 기존 문서의 로그 계약을 구현할 때 지켜야 할 scope 규칙을 짧게 고정한다.

참조 기준:

- `docs/p0/team-workplan.md`
- `docs/p0/p0-log-event-payload.md`
- `docs/p0/p0-db-migration-plan.md`
- `docs/p0/p0-contract.md`

---

## 2. Day4에서 A가 먼저 할 일

A는 Day4에서 큰 선행 구현을 하지 않는다.

다만 B/C/D/E가 병렬로 구현하기 전에 아래 기준을 먼저 공유한다.

```text
Request Log, Request Detail, Dashboard 조회는 반드시 tenantId/projectId scope를 탄다.
requestId만으로 다른 tenant/project 로그를 조회할 수 있으면 실패다.
```

즉, A의 역할은 기능 구현보다 scope 기준을 고정하고 PR/통합 단계에서 검증하는 것이다.

---

## 3. 절대 규칙

### 3.1 로그 저장 필수 scope

`p0_llm_invocation_logs`에 저장되는 모든 요청 로그는 아래 값을 가져야 한다.

| 필드 | 필수 여부 | 설명 |
|---|---:|---|
| `request_id` | 필수 | 요청 1건을 추적하는 기준 |
| `trace_id` | 필수 | 없으면 requestId와 동일 가능 |
| `tenant_id` | 필수 | 회사/조직 scope |
| `project_id` | 필수 | 프로젝트 scope |
| `application_id` | 가능하면 필수 | 어떤 앱에서 온 요청인지 |
| `status` | 필수 | success, cache_hit, blocked, error |
| `http_status` | 필수 | 최종 HTTP 상태 |

`tenant_id`, `project_id`가 없는 로그는 Day4 조회 대상이 아니다.

### 3.2 로그 조회 필수 scope

Request Log 목록 조회는 반드시 아래 조건을 포함해야 한다.

```sql
where tenant_id = :tenantId
  and project_id = :projectId
```

Request Detail 조회도 `request_id`만으로 조회하면 안 된다.

```sql
where tenant_id = :tenantId
  and project_id = :projectId
  and request_id = :requestId
```

Dashboard 집계도 같은 기준을 따른다.

```sql
where tenant_id = :tenantId
  and project_id = :projectId
```

프로젝트 전체가 아닌 tenant 전체 Dashboard를 만들 경우에도 최소한 `tenant_id` 조건은 반드시 들어가야 한다.

### 3.3 금지

아래 구현은 금지한다.

```text
request_id만으로 Request Detail 조회
project_id 없이 전체 Request Log 조회
tenant_id 없이 Dashboard 집계
raw prompt/raw response 반환
Authorization header 저장 또는 반환
API Key/App Token/Provider Key 원문 저장 또는 반환
Provider raw error body 원문 저장
```

---

## 4. 역할별 구현 기준

### A. Control Plane / DB / Runtime Config

- Day2 seed의 `tenantId`, `projectId`, `applicationId`가 Day4 로그 조회 기준으로 사용 가능해야 한다.
- `p0_llm_invocation_logs`가 tenant/project scope index를 탈 수 있는지 확인한다.
- PR/통합 단계에서 scope 없는 조회, 다른 project 로그 섞임을 검증한다.

### B. Gateway Core / Provider Adapter

B는 E가 저장할 수 있도록 응답 경로 metadata를 채운다.

필수 값:

```text
requestId
traceId
endpoint
method
stream
provider
model
providerLatencyMs
latencyMs
status
httpStatus
promptTokens
completionTokens
totalTokens
costMicroUsd
```

cache hit이면 provider 호출 값은 비어 있을 수 있지만, status와 latency는 반드시 남긴다.

### C. Gateway Auth / Context / Routing

C는 identity와 routing metadata를 채운다.

필수 값:

```text
tenantId
projectId
applicationId
apiKeyId
appTokenId
endUserId
featureId
requestedModel
selectedProvider
selectedModel
routingReason
```

`requestedModel=auto`인 경우에도 실제 선택된 모델은 `selectedModel`에 남겨야 한다.

### D. Security / Exact Cache

D는 masking/cache metadata를 채운다.

필수 값:

```text
maskingAction
maskingDetectedTypes
maskingDetectedCount
redactedPromptPreview
cacheStatus
cacheType
cacheKeyHash
cacheHitRequestId
savedCostMicroUsd
```

주의:

```text
redactedPromptPreview만 저장 가능
raw prompt 저장 금지
raw response 저장 금지
secret 원문 저장 금지
```

### E. Request Log / Detail / Dashboard

E는 Day4의 중심 구현자다.

구현 대상:

```text
Request Log 목록 API
Request Detail API
Dashboard Overview API
```

E는 모든 조회에서 tenant/project scope를 강제해야 한다.

E가 사용하는 canonical source는 P0 기준 `p0_llm_invocation_logs`다.

---

## 5. API별 scope 기준

### 5.1 Request Log 목록

대상 API:

```text
GET /api/projects/:projectId/logs
```

필수 조건:

```text
인증된 tenantId 기준으로 조회한다.
path의 projectId가 인증된 tenant에 속하는지 확인한다.
로그 쿼리는 tenantId + projectId 조건을 모두 포함한다.
```

목록 응답에는 prompt/response preview를 넣지 않는다.

### 5.2 Request Detail

대상 API:

```text
GET /api/llm-requests/:requestId
```

필수 조건:

```text
requestId 단독 조회 금지
인증된 tenantId와 현재 projectId scope 안에서만 조회
해당 scope에 없는 requestId는 404 또는 403
```

P0에서는 구현 단순화를 위해 현재 선택된 project context를 사용해도 된다.

Detail 응답에는 `redactedPromptPreview`만 허용한다.

### 5.3 Dashboard Overview

대상 API:

```text
GET /api/dashboard/overview
```

필수 조건:

```text
tenantId 조건 필수
projectId가 있으면 projectId 조건 필수
기간 조건이 있으면 createdAt 범위 필수
```

Dashboard 숫자는 Request Log와 같은 canonical source를 기준으로 계산한다.

---

## 6. null 허용 기준

Day4 병렬 개발 중 B/C/D의 metadata가 아직 덜 채워질 수 있다.

E는 아래 값은 임시로 null 또는 0을 허용할 수 있다.

```text
providerLatencyMs
promptTokens
completionTokens
totalTokens
costMicroUsd
savedCostMicroUsd
maskingDetectedTypes
cacheHitRequestId
routingReason
```

단, 아래 값은 비어 있으면 안 된다.

```text
requestId
traceId
tenantId
projectId
status
httpStatus
createdAt
```

---

## 7. Day4 병렬 구현 순서

권장 순서:

```text
1. A가 이 scope 기준 문서를 공유한다.
2. B/C/D는 기존 Gateway Context 계약에 맞춰 metadata를 보강한다.
3. E는 null 허용 DTO로 Log/Detail/Dashboard API를 먼저 만든다.
4. B/C/D PR이 머지될수록 E의 응답 필드가 채워진다.
5. 통합 단계에서 requestId -> log list -> detail -> dashboard count를 검증한다.
```

Day4는 A의 선행 구현을 기다리지 않아도 된다.

대신 E가 API를 만들 때 이 문서의 scope 기준을 반드시 적용해야 한다.

---

## 8. 검증 체크리스트

Day4 PR 또는 통합 smoke에서 아래를 확인한다.

```text
[ ] Request Log 목록은 tenantId + projectId로 필터링된다.
[ ] Request Detail은 requestId 단독으로 조회되지 않는다.
[ ] 다른 projectId의 requestId를 넣으면 조회되지 않는다.
[ ] Dashboard count는 같은 tenant/project scope의 로그만 집계한다.
[ ] success 요청이 log/detail/dashboard에 반영된다.
[ ] cache_hit 요청이 log/detail/dashboard에 반영된다.
[ ] blocked 요청이 log/detail/dashboard에 반영된다.
[ ] invalid_api_key 또는 invalid_app_token 결과가 provider 호출 없이 error log로 남는다.
[ ] raw prompt/raw response/API Key/App Token/Provider Key 원문이 API 응답에 없다.
[ ] Request Log 건수와 Dashboard totalRequests가 같은 canonical source 기준으로 일치한다.
```

---

## 9. 완료 기준

Day4 완료 기준:

```text
운영자는 requestId 하나로 요청의 결과를 찾을 수 있다.
다만 그 requestId는 인증된 tenant/project scope 안에서만 조회된다.
Request Log, Request Detail, Dashboard 숫자가 같은 로그 소스를 기준으로 일치한다.
raw prompt/raw response/secret 원문은 저장되거나 반환되지 않는다.
```
