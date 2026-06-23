# GateLM P0 Contract v0.1

## 문서 목적

이 문서는 P0 구현 중 팀원이 같은 범위를 보도록 고정하는 단일 계약표다.

`MVP` 또는 `1차 구현`이라는 표현이 다른 문서에 남아 있더라도, 현재 구현 판단은 이 문서와 `implementation-cut.md`, `demo-acceptance.md`를 우선한다.

---

## 0. 검증 지적사항 반영 기준

아래 항목은 P0 구현 전에 닫아야 하는 기준이다.

| 지적사항 | P0 문서상 처리 |
|---|---|
| 최종 기준 문서와 기존 문서의 상태/우선순위 | `docs/README.md`의 문서 우선순위와 이 문서를 최우선 판단 기준으로 사용 |
| `MVP`, `1차 구현`, `P0` 범위 혼선 | 이 문서의 용어 기준으로 판단 |
| P0 필수 API와 전체 API 문서 우선순위 차이 | 이 문서의 P0 포함/제외 API 표로 판단 |
| Streaming, 실제 Provider, Rate Limit, Budget, Chat UI 포함 여부 | 이 문서의 P0 제외 또는 후보 표로 판단 |
| Request Log, Cache, Error, Masking 상태값과 HTTP status 불일치 | 이 문서의 Event / Log 계약으로 판단 |
| 분석 저장 경로 선택 | P0 canonical source는 PostgreSQL `p0_llm_invocation_logs`로 고정 |
| 팀 운영, 테스트, CI, 리뷰, 보안 검증 | `team-workplan.md`, `p0-test-matrix.md`, `p0-review-and-ci-gate.md`를 따른다 |
| Docker Compose / Mock Provider 실행 기준 | 이 문서의 P0 로컬 실행 계약과 `local-dev.md`를 따른다 |

---

## 1. P0 로컬 실행 계약

이번 P0는 Docker Compose 기반 로컬 환경을 승인한다.

P0 local infrastructure:

| 서비스 | P0 기준 |
|---|---|
| PostgreSQL | service name `postgres`, image `postgres:16`, user/password/db `gatelm/gatelm/gatelm` |
| Redis | service name `redis`, image `redis:7-alpine` |
| Mock Provider | service name `mock-provider`, port `8090`, 별도 local HTTP service |

P0 기본 Mock Provider 방식은 별도 service다. Gateway 내부 adapter는 mock-provider service 구현이 지연될 때만 임시 fallback으로 허용한다. fallback을 쓰더라도 call count, latency, error mode, reset/config에 준하는 테스트 관측 기능은 유지해야 한다.

현재 `docker-compose.yml`의 inline Python `mock-provider`는 팀원이 공통 로컬 환경을 빠르게 띄우기 위한 **bootstrap mock**이다. P0 acceptance용 mock-provider는 `mock-provider.md`의 stats/config/error/timeout 관측 기준을 만족하도록 별도 구현체로 승격해야 한다.

`MOCK_PROVIDER_PORT`는 host port override 용도다. P0 bootstrap mock의 container listen port는 `8090`으로 고정한다. 포트를 바꿔야 하면 host mapping만 바꾸고, Gateway/README/local-dev의 base URL도 함께 맞춘다.

P0 optional infrastructure:

| 서비스 | P0 판단 |
|---|---|
| Redpanda | P1/optional. P0 readiness 실패 조건 아님 |
| ClickHouse | P1/optional. P0 readiness 실패 조건 아님 |

---

## 2. 용어 기준

| 용어 | 현재 기준 |
|---|---|
| P0 | 지금 구현해야 하는 2~3주 Gateway vertical slice |
| MVP | 제품 관점 최소 출시 후보. 문서에 따라 P0보다 넓을 수 있음 |
| 1차 구현 | 과거 표현 또는 장기 설계 문맥. 현재 P0 필수를 뜻하지 않을 수 있음 |

P0는 기능 수가 아니라 end-to-end 흐름이 기준이다.

```text
Admin onboarding
-> Project / Application / Provider / API Key / App Token
-> Gateway request
-> API Key / App Token authentication
-> Tenant / Project / Application context
-> Sensitive data redaction or block
-> Exact Cache
-> Simple Routing
-> Provider call
-> Usage Log
-> Request Log / Detail
-> Dashboard Overview
```

---

## 3. P0 포함 API

### 3.1 Control Plane API

| 기능 | Endpoint | P0 기준 |
|---|---|---|
| 로그인 | `POST /api/auth/login` | seed admin 대체 가능 |
| 현재 사용자 | `GET /api/auth/me` | tenant/project 권한 포함 |
| Tenant 생성 | `POST /api/tenants` | onboarding 필수 |
| Project 생성 | `POST /api/projects` | 비용/정책/로그 기준 단위 |
| Application 생성 | `POST /api/projects/:projectId/applications` | App Token 발급 대상 |
| API Key 발급 | `POST /api/projects/:projectId/api-keys` | 원문 key는 1회 반환 |
| App Token 발급 | `POST /api/applications/:applicationId/app-tokens` | 원문 token은 1회 반환 |
| Provider Connection 등록 | `POST /api/provider-connections` | P0는 mock provider 가능 |
| Dashboard Overview | `GET /api/dashboard/overview` | P0 카드 집계 |
| Request Log 목록 | `GET /api/projects/:projectId/logs` | project scope 필수 |
| Request Detail | `GET /api/llm-requests/:requestId` | raw prompt/response 미반환 |

### 3.2 Gateway API

| 기능 | Endpoint | P0 기준 |
|---|---|---|
| Health | `GET /healthz` | 필수 |
| Ready | `GET /readyz` | 필수 |
| Models | `GET /v1/models` | mock model catalog 반환 |
| Chat Completions | `POST /v1/chat/completions` | OpenAI-compatible, non-stream |

### 3.3 P0 Gateway Error Contract

| 케이스 | HTTP status | errorCode | Request Log | Provider/mock 호출 | Cache |
|---|---:|---|---|---|---|
| `stream=true` | 400 | `streaming_not_supported` | `status=error` | 없음 | `cacheStatus=bypass`, `cacheType=none` |
| API Key 누락/불일치 | 401 | `invalid_api_key` | `status=error` 또는 auth failure log | 없음 | `cacheStatus=bypass`, `cacheType=none` |
| App Token 누락/불일치 | 403 | `invalid_app_token` | `status=error` 또는 auth failure log | 없음 | `cacheStatus=bypass`, `cacheType=none` |
| Tenant/Project/Application scope 불일치 | 403 | `scope_mismatch` | `status=error` | 없음 | `cacheStatus=bypass`, `cacheType=none` |
| 민감정보 block | 403 | `sensitive_data_blocked` | `status=blocked` | 없음 | `cacheStatus=bypass`, `cacheType=none` |

`stream=true` message:

```text
Streaming is not supported in P0.
```

### 3.4 P0 제외 API

아래 API는 장기 API 문서에 있더라도 P0 구현 대상이 아니다.

| API/기능 | P0 판단 |
|---|---|
| 기업 Admin signup | seed admin 또는 local login으로 대체 |
| 사용자 초대 / 초대 수락 | P1 |
| Provider connection test | P1 |
| Rate Limit / Quota / Budget 설정 API | P1. P0는 seed/config 수준 |
| Chat conversation API | P1/P2 |
| Policy version / publish / rollback API | P2 |
| Streaming response API | P1. P0는 `stream=true` 거부 |
| Analytics masking aggregate API | P1/P2 |

---

## 4. P0 제외 또는 후보

| 기능 | P0 판단 |
|---|---|
| SSE Streaming | P1. P0에서는 `stream=true`를 명확한 오류로 거부 |
| Semantic Cache 실제 embedding/vector store | P2. P0는 Exact Cache만 구현 |
| AI Service routing score | P2. P0는 simple routing만 구현 |
| Rate Limit UI/API 고도화 | P1. P0에서는 seed/config 또는 no-op 허용 |
| Budget hard block 고도화 | P1. P0에서는 cost metadata와 seed policy 수준 허용 |
| Provider connection test | P1 |
| Chat UI Reply-to Context | P1 |
| Policy publish/rollback UI | P2 |
| Chat conversation API | P1/P2. P0는 Customer App Demo 또는 Text-only Chat UI 중 하나만 선택 |
| Redpanda/ClickHouse 필수 연동 | P1. P0는 PostgreSQL fallback 허용 |
| AWS Secrets Manager/KMS | P2. P0는 SecretResolver interface와 local resolver |

---

## 5. P0 DB 계약

P0 DB 범위는 `p0-db-migration-plan.md`를 따른다.

| 저장소 | P0 기준 |
|---|---|
| PostgreSQL | 필수 |
| Redis | 필수 |
| ClickHouse | optional, P1 권장 |
| Redpanda | optional, P1 권장 |

P0 분석 저장 canonical source:

```text
Gateway/direct writer -> PostgreSQL p0_llm_invocation_logs
Dashboard/Request Log/Request Detail -> PostgreSQL p0_llm_invocation_logs query
```

P0에서 Redpanda/ClickHouse를 붙이더라도 Dashboard와 Request Log가 다른 숫자를 보이면 실패로 본다. P0 발표 기준은 PostgreSQL fallback 값을 canonical source로 삼는다.

장기 방향은 아래처럼 유지한다.

```text
Gateway -> Redpanda -> Worker -> ClickHouse/PostgreSQL
```

단, 이 장기 방향은 P0 필수가 아니다.

P0 PostgreSQL table:

```text
users
tenants
tenant_memberships
projects
project_memberships
applications
api_keys
app_tokens
provider_connections
model_catalog
model_pricing_rules
budget_policies
rate_limit_rules
usage_ledger_entries
audit_logs
p0_llm_invocation_logs
```

금지:

```text
raw_prompt column
raw_response column
provider_api_key plaintext column
api_key_plaintext column
app_token_plaintext column
Provider/Model DB enum 고정
```

---

## 6. P0 Event / Log 계약

P0에서는 `InvocationFinishedPayload` 하나로 처리할 수 있다.

| request status | eventType | 대표 HTTP status | Dashboard 처리 | 설명 |
|---|---|---:|---|---|
| `success` | `invocation.completed` | 200 | success count 포함 | Provider/mock 호출 성공 |
| `cache_hit` | `invocation.completed` | 200 | success count와 cache hit count 포함 | Exact Cache hit |
| `blocked` | `invocation.blocked` | 403 | blocked count 포함, error rate 제외 | 보안 정책으로 Provider 호출 전 차단 |
| `error` | `invocation.failed` | 4xx/5xx | error count 포함 | 실패 |
| `cancelled` | `invocation.cancelled` | 499 또는 499-equivalent | cancelled count 포함 | 취소 |

Cache 값:

| 필드 | 허용값 |
|---|---|
| `cacheStatus` | `hit`, `miss`, `bypass`, `error` |
| `cacheType` | `none`, `exact`, `semantic` |

P0 저장/응답/header의 canonical cache status는 `hit`, `miss`, `bypass`, `error`만 사용한다. Exact/Semantic 구분은 `cacheType`으로만 표현한다. P0에서는 `cacheType=semantic`을 사용하지 않는다.

P0 header:

```text
X-GateLM-Cache-Status: hit | miss | bypass | error
```

장기 문서의 `exact_hit`, `semantic_hit` 표현은 P1/P2 분석 또는 UI mapping 후보이며 P0 저장값이 아니다.

Masking 값:

| 필드 | 허용값 |
|---|---|
| `maskingAction` | `none`, `redacted`, `blocked` |

Block 기준:

| 항목 | P0 처리 |
|---|---|
| email | redact |
| phone_number | redact |
| resident_registration_number | block |
| api_key | block |
| authorization_header | block |
| jwt | block |
| private_key | block |

P0 sensitive block response:

```text
httpStatus=403
errorCode=sensitive_data_blocked
errorMessage=Request blocked by GateLM security policy.
Provider/mock 호출 없음
costMicroUsd=0
cacheStatus=bypass
cacheType=none
```

### 6.1 Event Field / DB Mapping

P0 direct writer에서는 event payload 전체를 그대로 DB column으로 만들지 않는다.

| Event/API field | P0 fallback DB 처리 |
|---|---|
| `costMicroUsd` | `p0_llm_invocation_logs.cost_micro_usd`에 저장 |
| `costUsd` | 저장하지 않음. 조회 응답에서 `costMicroUsd / 1_000_000` decimal string으로 파생 |
| `currency` | 저장하지 않음. P0는 `USD` 상수 또는 project default currency로 파생 |
| `schemaVersion` | `metadata.schemaVersion=1`로 저장하거나 DTO 상수로 처리. 새 column 추가 금지 |
| `retryable` | P0는 `metadata.retryable` 또는 error response 파생값. 새 column 추가 금지 |
| event envelope `eventId` | P0 direct writer에서는 저장 생략 가능. event bus 적용 시 사용 |
| event envelope `eventType` | `status`에서 파생 가능. P0 direct writer에서는 저장 생략 가능 |
| event envelope `eventVersion` | P0 direct writer에서는 저장 생략 가능 |
| event envelope `occurredAt` | `created_at` 또는 `completed_at` 기준으로 파생 가능 |

위 필드가 필요하다는 이유로 P0 DB column을 임의 추가하지 않는다.

---

## 7. P0 Dashboard 계약

Dashboard Overview는 Request Log와 같은 데이터 소스를 기준으로 한다.

필수 지표:

```text
totalRequests
successfulRequests
blockedRequests
totalTokens
totalCostMicroUsd 또는 totalCostUsd
averageResponseTimeMs
cacheHitRequests 또는 cacheHitRate
```

P0에서는 block 요청을 error rate에 섞어 제품 장애처럼 표시하지 않는다.

---

## 8. P0 Provider / Routing / Cache 계약

Provider:

```text
mock provider는 P0 필수
실제 Provider adapter는 P1 선택 기능
실제 Provider를 붙이더라도 mock provider acceptance가 먼저 통과해야 함
```

Routing:

```text
model=auto 지원
짧은 prompt -> mock-fast
기본 모델 -> mock-balanced
requestedModel과 selectedModel을 Request Detail에 분리 기록
```

Exact Cache:

```text
cache key는 raw prompt가 아니라 redacted prompt 기준
동일 safe request 1회차 miss, 2회차 hit
cache hit 시 Provider/mock 호출 count 증가 금지
block 요청은 cache lookup 금지
```

---

## 9. P0 Readiness 계약

`/readyz`는 P0 필수 dependency만 전체 ready 여부에 반영한다.

| Dependency | P0 기준 | 실패 시 전체 ready |
|---|---|---|
| PostgreSQL | 필수 | fail |
| Redis | 필수 | fail |
| Mock Provider 별도 service | 필수. 내부 mock adapter fallback 사용 시 해당 adapter self-check | fail |
| Redpanda | optional | fail 아님 |
| ClickHouse | optional | fail 아님 |

Optional dependency 실패는 response details에 표시할 수 있지만 HTTP status를 실패로 만들지 않는다.

---

## 10. P0 보안 계약

금지 데이터:

```text
raw prompt
raw response
Provider API Key 원문
Gateway API Key 원문
App Token 원문
Authorization header 원문
Cookie 원문
raw provider error body
raw detected sensitive value
실제 secret
실제 개인정보
```

저장 가능한 값:

```text
redactedPromptPreview
responseSummary
promptHash
responseHash
token metadata
cost metadata
latency metadata
cache metadata
routing metadata
masking metadata
requestId
tenantId
projectId
applicationId
apiKeyId
appTokenId
```

---

## 11. P0 완료 기준

P0 완료 판단은 `demo-acceptance.md`를 따른다.

테스트와 리뷰 gate는 아래 문서를 따른다.

```text
docs/p0/p0-test-matrix.md
docs/p0/p0-review-and-ci-gate.md
docs/p0/team-workplan.md
```

최소 통과 조건:

```text
seed admin 또는 login 가능
project/application/provider/api key/app token 생성 가능
/v1/chat/completions safe request 성공
invalid API Key 차단
invalid App Token 차단
email/phone redaction
credential-like token/JWT/RRN block
exact cache miss -> hit
model=auto simple routing
Request Log 목록 표시
Request Detail 필드 확인
Dashboard Overview 숫자 확인
raw prompt/raw response/secret 미노출
```
