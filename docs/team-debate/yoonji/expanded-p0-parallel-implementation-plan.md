# Expanded P0 Parallel Implementation Plan

## 1. 전제

이 문서는 기존 `docs/p0/*`의 축소 P0 범위 판단을 따르지 않고, 아래 확장 P0를 제품 기준 P0로 다시 잡았을 때의 구현 분업 계획이다.

목표는 5명이 동시에 착수해도 서로를 기다리지 않도록 작업 경계를 나누는 것이다. 각 담당자는 자기 영역에서 mock, fixture, contract stub, synthetic data를 사용해 먼저 완성하고, 마지막에 통합 계약을 맞춘다.

## 2. 확장 P0 목표

확장 P0는 단순 Gateway smoke가 아니라 운영자가 가입부터 고객사 연동, 요청 처리, 로그 확인, 대시보드 확인까지 한 번에 시연할 수 있는 버전이다.

```text
Admin onboarding / Web Console
-> Tenant / Project / Application 생성
-> Provider Connection 등록
-> API Key / App Token 발급 및 원문 1회 표시
-> 고객사 앱 또는 demo app 연동
-> Gateway request
-> DB 기반 API Key / App Token 검증
-> Tenant / Project / Application context 확정
-> Sensitive data redaction or block
-> Exact Cache
-> Simple Routing 또는 확장 라우팅 초안
-> mock provider adapter
-> token / latency / cost 기록
-> Request Log / Detail
-> Dashboard Overview UI
-> 성능 smoke와 RPS 측정
```

## 3. 현재 Gap 요약

| 영역 | 현재 상태 | 확장 P0에서 필요한 상태 |
|---|---|---|
| API Key 발급 | 발급 API 없음 | `POST /api/projects/:projectId/api-keys`, 원문 key 1회 표시 |
| App Token 발급 | 발급 API 없음 | `POST /api/applications/:applicationId/app-tokens`, 원문 token 1회 표시 |
| Tenant / Project / Application | DB table과 seed 중심 | 생성/조회/수정/비활성화 API |
| Provider Connection | DB table과 seed 중심 | 등록/조회/회전/비활성화 API, secret 원문 미저장 |
| Admin onboarding | 실제 화면 없음 | 로그인, 프로젝트 생성, 키 발급, 대시보드 확인 flow |
| Request Log UI | API만 있음 | 목록, 필터, 클릭, Detail Drawer |
| Dashboard UI | API만 있음 | Overview cards, trend, cache/routing/masking summary |
| 고객사 demo | smoke script 중심 | 별도 demo app 또는 minimal SDK sample |
| Mock Provider Adapter | mock 중심 | deterministic mock response와 장애 fixture 보강 |
| 인증/검증 | `.env` static hash 중심 | DB의 `api_keys`, `app_tokens` 기반 검증 |
| 비용 계산 | 대부분 0 | pricing rule 기반 micro USD 계산 |
| 로그 저장 | PostgreSQL direct writer | P0는 유지, 대용량 구조는 병렬 PoC |
| 캐시 | Exact Cache 구현 | semantic/LLM cache는 실험 플래그와 벤치마크 계획 |
| 라우팅 | `model=auto` 단순 라우팅 | 비용/품질 기반 routing PoC, P0 기본 route 유지 |
| 성능 | 수치 없음 | auth, masking, logging, cache RPS 측정 |

## 4. 병렬 작업 원칙

1. 공유 파일을 최소화한다.
2. 각 담당자는 자기 app/module/test/example 디렉토리 안에서 먼저 끝낸다.
3. 다른 담당자의 API가 없어도 mock server, fixture, interface stub으로 완성한다.
4. 실제 통합은 마지막 integration window에서만 한다.
5. secret 원문, raw prompt, raw response, Authorization header는 어떤 fixture에도 넣지 않는다.
6. API/DB/Event의 최종 계약 반영은 별도 통합 PR에서 한 번에 정리한다.
7. 각 담당자는 하나의 대형 PR이 아니라 4개의 작은 머지 단위로 쪼개서 제출한다.

## 5. 5명 역할 분담

### Developer A. Control Plane API / Key Issuance

목표:
- Admin이 Tenant, Project, Application, Provider Connection, API Key, App Token을 만들 수 있는 Control Plane API를 구현한다.

주요 범위:
- Tenant 생성/조회 API
- Project 생성/조회/수정/비활성화 API
- Application 생성/조회/수정/비활성화 API
- API Key 발급/회전/폐기 API
- App Token 발급/회전/폐기 API
- Provider Connection 등록/조회/수정/비활성화 API
- key/token 원문 1회 표시 응답
- hash, prefix, last4, expiresAt, revokedAt 저장 정책
- Provider Key는 plaintext 저장 금지, secret reference만 저장

독립 작업 방식:
- Gateway 검증 구현을 기다리지 않는다.
- 발급 API는 자체 service/repository 테스트로 검증한다.
- Gateway가 쓸 검증 query는 문서화된 repository method 형태로만 제공한다.
- Provider Connection은 실제 provider 호출 없이 secret resolver mock으로 테스트한다.

예상 산출물:
- Control Plane API endpoints
- key/token issuance service
- secret-safe response mapper
- authz/tenant scope test
- one-time plaintext response test

완료 기준:
- API Key와 App Token 원문은 생성/회전 응답에서만 보인다.
- DB, log, test snapshot에는 hash/prefix/last4만 남는다.
- Tenant scope 없이 리소스를 조회할 수 없다.

4회 머지 계획:

| Merge | 범위 | 완료 기준 |
|---|---|---|
| A-1 | Tenant / Project / Application 생성/조회 skeleton | seed 없이도 synthetic fixture로 생성/조회 test 통과 |
| A-2 | API Key 발급/회전/폐기 | 원문 key 1회 표시, hash/prefix/last4 저장 test 통과 |
| A-3 | App Token 발급/회전/폐기 | 원문 token 1회 표시, revoked/expired 처리 test 통과 |
| A-4 | Provider Connection 등록/관리 | Provider Key 원문 미저장, secret reference 응답 test 통과 |

### Developer B. Gateway Auth / Mock Provider / Cost

목표:
- Gateway가 DB 기반 API Key와 App Token을 검증하고, mock provider adapter를 통해 요청을 처리한다.

주요 범위:
- API Key DB hash 검증
- App Token DB hash 또는 signature 검증
- Tenant / Project / Application context resolver
- ProviderAdapter registry
- mock provider adapter 유지
- selectedProvider/selectedModel routing metadata 기록
- pricing rule 기반 token cost 계산
- provider timeout/retry/fail-safe error mapping

독립 작업 방식:
- Developer A의 발급 API를 기다리지 않고 seed row와 fixture hash로 검증한다.
- Provider credential은 local secret resolver mock으로 주입한다.
- 외부 Provider 연동은 확장 P0 필수 범위에서 제외한다.
- mock provider adapter는 deterministic response fixture로 검증한다.
- UI와 Dashboard는 기다리지 않는다.

예상 산출물:
- DB-backed auth stage
- App Token validation stage
- mock provider adapter
- pricing calculator
- Gateway integration tests
- safe error mapper

완료 기준:
- invalid API Key/App Token이면 Provider가 호출되지 않는다.
- cache key에 raw prompt가 들어가지 않는다.
- masking은 cache/provider call보다 먼저 실행된다.
- mock provider adapter 밖으로 provider 처리 로직이 새지 않는다.

4회 머지 계획:

| Merge | 범위 | 완료 기준 |
|---|---|---|
| B-1 | DB-backed API Key 인증 stage | valid/invalid key fixture test 통과, invalid면 provider 미호출 |
| B-2 | App Token 검증과 context resolver | tenant/project/application context가 request log metadata로 연결됨 |
| B-3 | masking, exact cache, simple routing 연결 | redaction/block, miss->hit, `model=auto` routing test 통과 |
| B-4 | mock provider adapter와 cost 계산 | token/latency/cost/routing/cache metadata가 기록됨 |

### Developer C. Web Console / Dashboard / Request Log UI

목표:
- Admin onboarding부터 로그 확인까지 Web Console에서 시연 가능한 UI를 구현한다.

주요 범위:
- 로그인 또는 local admin session placeholder
- Tenant / Project / Application 생성 화면
- Provider Connection 등록 화면
- API Key / App Token 발급 화면과 원문 1회 표시 modal
- Dashboard overview cards
- Request Log list
- Request Detail Drawer
- cache/routing/masking/cost/latency 표시
- API 실패/로딩/빈 상태 UI

독립 작업 방식:
- Backend API 완성을 기다리지 않고 fixture API client 또는 mock handlers로 개발한다.
- 화면 state와 API client boundary를 분리해 실제 API 연결 시 교체만 한다.
- raw prompt/raw response를 UI에 표시하지 않고 redacted preview와 metadata만 표시한다.

예상 산출물:
- Web Console routes/pages
- reusable dashboard cards
- request log table
- detail drawer
- key one-time reveal modal
- mock API fixture
- UI smoke test

완료 기준:
- 운영자가 화면에서 프로젝트 생성, 키 발급, 로그 확인 flow를 따라갈 수 있다.
- 긴 ID, 긴 provider/model 이름, 빈 데이터, 에러 상태가 깨지지 않는다.
- secret 원문은 생성 직후 modal에서만 표시되고 재조회되지 않는다.

4회 머지 계획:

| Merge | 범위 | 완료 기준 |
|---|---|---|
| C-1 | Web Console shell과 onboarding mock flow | 로그인 또는 local session, 프로젝트/앱 생성 mock UI 동작 |
| C-2 | API Key/App Token 발급 UI | 원문 1회 표시 modal, 재조회 불가 상태, empty/error state 구현 |
| C-3 | Request Log list와 Detail Drawer | mock log 목록 클릭 시 detail metadata 표시 |
| C-4 | Dashboard overview cards | request/cache/error/cost/latency summary card와 API client 전환 지점 정리 |

### Developer D. Observability / Log Platform / Performance

목표:
- 요청 로그, 비용, 성능 수치를 측정 가능하게 만들고, 대용량 로그 플랫폼 방향을 P0 병렬 PoC로 준비한다.

주요 범위:
- PostgreSQL request log query 최적화 점검
- dashboard summary aggregation 기준 정리
- token, latency, cost metadata 검증
- Redpanda/ClickHouse optional mirror PoC
- load test script
- RPS, p95 latency, cache hit rate, log write latency 측정
- synthetic log generator
- masking/logging/cache별 overhead 측정

독립 작업 방식:
- Gateway 실제 트래픽을 기다리지 않고 synthetic log와 mock Gateway endpoint로 측정한다.
- 대용량 로그 PoC는 PostgreSQL canonical writer와 분리해 optional mirror로만 다룬다.
- Dashboard UI를 기다리지 않고 API response와 CSV/Markdown report로 산출한다.

예상 산출물:
- load test scripts
- synthetic request/log dataset
- performance report template
- cost calculation test cases
- optional Redpanda/ClickHouse PoC notes
- dashboard aggregation validation

완료 기준:
- 최소 safe request, cache hit, blocked request, auth failure 시나리오의 RPS/p95 수치가 나온다.
- request log list/detail/dashboard API가 필요한 index 또는 pagination 기준을 제안한다.
- 대용량 로그 구조는 P0 path를 막지 않는 optional mirror로 남는다.

4회 머지 계획:

| Merge | 범위 | 완료 기준 |
|---|---|---|
| D-1 | synthetic log dataset과 report template | safe/cache/blocked/auth failure sample report 생성 |
| D-2 | load test script | mock Gateway 또는 local endpoint 대상 RPS/p95 측정 가능 |
| D-3 | dashboard aggregation 검증 | summary API에 필요한 집계 기준과 test fixture 정리 |
| D-4 | optional log platform PoC notes | PostgreSQL canonical writer를 막지 않는 Redpanda/ClickHouse mirror 설계 정리 |

### Developer E. Customer Demo / E2E / Integration Harness

목표:
- 고객사 앱 관점에서 GateLM을 붙이는 데모와 전체 acceptance flow를 만든다.

주요 범위:
- minimal customer demo app
- curl/PowerShell smoke script 정리
- API Key + App Token 사용 예시
- onboarding 이후 Gateway 호출 시나리오
- safe request, redaction request, blocked request, cache hit request
- request log/detail/dashboard 확인 acceptance
- local dev bootstrap guide
- integration checklist

독립 작업 방식:
- 실제 Control Plane/Gateway가 없어도 mock Gateway와 fixture token으로 demo app을 먼저 만든다.
- smoke script는 환경변수 placeholder만 사용한다.
- 실제 secret처럼 보이는 값은 넣지 않는다.
- 통합 시에는 endpoint base URL만 바꾼다.

예상 산출물:
- customer demo app 또는 example client
- smoke scripts
- E2E scenario markdown
- integration checklist
- demo recording checklist

완료 기준:
- 신규 개발자가 문서만 보고 local에서 onboarding, Gateway call, log 확인 flow를 따라갈 수 있다.
- demo app은 Provider를 직접 호출하지 않고 GateLM Gateway만 호출한다.
- smoke script는 raw secret을 저장하거나 출력하지 않는다.

4회 머지 계획:

| Merge | 범위 | 완료 기준 |
|---|---|---|
| E-1 | demo app skeleton과 mock Gateway 연결 | fixture key/token으로 safe request demo 동작 |
| E-2 | smoke scripts | safe/redaction/blocked/cache hit 스크립트가 placeholder env만 사용 |
| E-3 | E2E scenario docs | onboarding부터 log/detail/dashboard 확인까지 acceptance 문서화 |
| E-4 | integration harness | 실제 endpoint base URL로 전환 가능한 config와 checklist 완성 |

## 6. 의존성 제거를 위한 계약 방식

각 담당자는 아래 boundary만 맞추고 내부 구현은 독립적으로 진행한다.

| Boundary | 선합의만 필요한 항목 | 독립 개발 방법 |
|---|---|---|
| Control Plane API | path, request, response 초안 | UI는 mock handler, API는 service test |
| Gateway Auth | key hash 검증 input/output | seed fixture로 검증 |
| Logs API | list/detail/dashboard shape | UI는 fixture, backend는 synthetic data |
| Mock Provider Adapter | deterministic mock response interface | mock fixture로 test |
| Demo App | Gateway chat completions endpoint | mock Gateway로 개발 |

통합 전까지는 서로의 branch를 기다리지 않는다. 단, 아래 이름은 문서상 고정해 혼선을 줄인다.

```text
tenantId
projectId
applicationId
apiKeyId
appTokenId
providerConnectionId
requestId
selectedProvider
selectedModel
requestedModel
cacheStatus
maskingAction
routingReason
costMicroUsd
latencyMs
```

## 7. 통합 순서

1. Developer A와 B가 key/token 검증 기준을 맞춘다.
2. Developer C가 mock API client를 실제 Control Plane API로 전환한다.
3. Developer E가 demo app을 실제 Gateway endpoint로 전환한다.
4. Developer D가 실제 Gateway traffic으로 load test를 다시 실행한다.
5. Request Log / Detail / Dashboard UI에서 실제 로그 필드를 검증한다.
6. 보안 리뷰를 통과한 뒤 demo scenario를 동결한다.

## 8. 보안 기준

API Key / App Token:
- 원문은 생성/회전 응답에서만 1회 반환한다.
- 저장은 hash, prefix, last4, metadata만 허용한다.
- list/detail 응답에는 원문을 포함하지 않는다.

Provider Key:
- Control Plane과 DB에는 secret reference만 저장한다.
- Web Console은 Provider Key 원문 재조회 기능을 제공하지 않는다.
- Gateway는 SecretResolver를 통해서만 credential을 받는다.

Prompt / Response:
- raw prompt와 raw response를 영속 저장하지 않는다.
- Request Log UI는 redacted preview와 metadata만 표시한다.
- cache key는 raw prompt가 아니라 redacted/canonicalized material 기반 hash를 사용한다.

Logging:
- Authorization header, Cookie, secret 원문은 log에 남기지 않는다.
- provider raw error body를 그대로 저장하거나 반환하지 않는다.

## 9. 테스트 계획

공통 acceptance:
- Admin login 또는 local admin session 생성
- Tenant / Project / Application 생성
- Provider Connection 등록
- API Key 발급 후 원문 1회 표시
- App Token 발급 후 원문 1회 표시
- 고객사 demo app에서 Gateway 호출 성공
- invalid API Key 차단
- invalid App Token 차단
- email/phone redaction
- credential-like token block
- Exact Cache miss 후 hit
- `model=auto` routing metadata 확인
- Request Log list에서 요청 확인
- Detail Drawer에서 metadata 확인
- Dashboard cards에서 request/cache/error/cost 수치 확인
- load test report에 RPS와 p95 latency 기록

담당자별 테스트:
- Developer A: Control Plane API e2e, service unit, tenant scope, secret one-time response
- Developer B: Gateway pipeline/auth/mock provider/cache/routing/cost tests
- Developer C: component test, mock API UI smoke, responsive layout check
- Developer D: load test, aggregation test, synthetic log validation
- Developer E: demo app e2e, smoke script, local bootstrap validation

## 10. Merge 방침

각 담당자는 되도록 아래 파일 영역을 독점한다.

| 담당 | 우선 소유 영역 |
|---|---|
| Developer A | Control Plane API, auth/admin resource modules |
| Developer B | Gateway Core, mock provider adapter, routing/cost/auth stages |
| Developer C | Web Console, dashboard/log UI, frontend API client mock |
| Developer D | performance scripts, observability docs, optional log platform PoC |
| Developer E | examples, smoke scripts, e2e scenario docs |

각 담당자는 역할별 4회 머지 계획을 따른다. 하나의 역할을 한 번에 머지하지 않고, skeleton -> core behavior -> UI/metadata/test -> integration-ready cleanup 순서로 작게 나눈다.

공유 contract, DB schema, API spec, event schema는 별도 통합 PR에서만 수정한다. 각 담당 branch에서는 필요한 경우 자기 영역의 local DTO, fixture, adapter stub을 사용한다.

권장 머지 리듬:

| 순서 | 목적 | 규칙 |
|---|---|---|
| Merge 1 | skeleton과 fixture boundary | 다른 담당자의 실제 API를 기다리지 않는다 |
| Merge 2 | 핵심 use case | 자기 영역 테스트로 완료 판단 |
| Merge 3 | edge case와 observability | error/empty/security/log metadata를 보강 |
| Merge 4 | integration-ready 정리 | mock 제거가 아니라 실제 연결 지점을 명확히 표시 |

## 11. 최종 Demo 완료 기준

확장 P0는 아래가 모두 가능하면 완료로 본다.

1. Web Console에서 프로젝트와 애플리케이션을 만든다.
2. Provider Connection을 등록한다.
3. API Key와 App Token을 발급하고 원문을 1회만 확인한다.
4. 고객사 demo app에서 GateLM Gateway로 요청한다.
5. Gateway가 DB 기반으로 API Key와 App Token을 검증한다.
6. 민감정보가 redaction 또는 block 처리된다.
7. cache miss 이후 같은 safe request가 cache hit 된다.
8. mock provider adapter가 응답한다.
9. token, latency, cost, routing, cache, masking metadata가 기록된다.
10. Web Console Dashboard에서 요약 수치를 확인한다.
11. Request Log 목록을 클릭해 Detail Drawer를 확인한다.
12. 성능 smoke report에 RPS, p95 latency, error rate, cache hit rate가 남는다.

## 12. 제안 일정

Day 1:
- 각 담당자 branch 생성
- mock/fixture boundary 확정
- 각자 첫 skeleton 구현 시작

Day 2-3:
- Developer A: Control Plane issuance API
- Developer B: Gateway DB auth와 mock provider adapter
- Developer C: Web Console mock UI
- Developer D: synthetic load/log framework
- Developer E: demo app과 smoke scenario

Day 4:
- 각 담당자 독립 demo
- API/DB/Event 계약 차이 목록화
- 보안 리뷰 항목 정리

Day 5:
- 통합 PR 시작
- mock을 실제 API로 교체
- E2E demo run
- performance smoke run

## 13. 남은 결정 사항

- Admin login은 real auth를 넣을지 local demo session으로 시작할지 결정해야 한다.
- 대용량 로그 플랫폼은 P0 필수 구현으로 둘지, PostgreSQL canonical writer plus optional mirror로 둘지 결정해야 한다.
- semantic cache와 고도화 routing은 실제 구현까지 포함할지, 평가셋/벤치마크와 disabled implementation으로 둘지 결정해야 한다.
- 비용 계산 pricing rule의 저장 위치와 versioning 기준을 결정해야 한다.
