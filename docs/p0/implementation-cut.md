# GateLM Implementation Cut v0.1

## 문서 목적

이 문서는 5명의 교육생이 2~3주 동안 GateLM을 구현할 때 반드시 지켜야 하는 **구현 범위 컷라인**이다. 기존 설계 문서는 장기 제품 구조까지 포함한다. 이 문서는 내일부터 바로 구현할 수 있는 P0 vertical slice를 고정한다.

GateLM의 P0 목표는 “LLM Gateway가 실제 요청을 받아 인증, 마스킹, 캐시, 라우팅, Provider 호출, 로그 조회까지 끝까지 동작하는 것”이다. 완성형 GateLM 제품 전체를 만들지 않는다.

---

## 1. P0 한 줄 정의

```text
GateLM P0 =
OpenAI-compatible Gateway
+ API Key/App Token 인증
+ Tenant/Project/Application 식별
+ Provider 호출
+ Provider 호출 전 민감정보 마스킹/차단
+ Exact Cache
+ Simple Routing
+ Usage Log
+ Request Log / Detail Drawer
+ Dashboard Overview
+ 최소 Web Console
```

P0는 기능 수가 아니라 **end-to-end 흐름**이 기준이다.

---

## 2. P0 데모 목표

최종 데모에서 아래 흐름이 한 번에 보여야 한다.

```text
1. Admin이 로그인한다.
2. Tenant, Project, Application을 만든다.
3. Provider Connection을 등록한다.
4. Gateway API Key와 App Token을 발급한다.
5. 고객사 앱 또는 curl이 /v1/chat/completions로 요청한다.
6. Gateway가 API Key와 App Token을 검증한다.
7. Gateway가 민감정보를 Provider 호출 전에 탐지한다.
8. safe 요청은 mock provider로 전달된다.
9. 동일 요청의 두 번째 호출은 Exact Cache hit로 처리된다.
10. model=auto 요청은 저비용 모델로 라우팅된다.
11. 차단 요청은 Provider 호출 없이 blocked log를 남긴다.
12. Dashboard와 Request Detail에서 cost, token, latency, cache, routing, masking을 확인한다.
```

---

## 3. P0 필수 구현 범위

### 3.1 Control Plane API

P0에서 필요한 API만 구현한다.

| 기능 | Endpoint | P0 여부 | 비고 |
|---|---|---:|---|
| 로그인 | `POST /api/auth/login` | 필수 | seed admin으로 대체 가능 |
| 현재 사용자 | `GET /api/auth/me` | 필수 | tenant/project 권한 포함 |
| Tenant 생성 | `POST /api/tenants` | 필수 | 온보딩 흐름 |
| Project 생성 | `POST /api/projects` | 필수 | 비용/정책/로그 기준 단위 |
| Application 생성 | `POST /api/projects/:projectId/applications` | 필수 | App Token 발급 대상 |
| API Key 발급 | `POST /api/projects/:projectId/api-keys` | 필수 | 원문 key는 1회 반환 |
| App Token 발급 | `POST /api/applications/:applicationId/app-tokens` | 필수 | 원문 token은 1회 반환 |
| Provider Connection 등록 | `POST /api/provider-connections` | 필수 | P0는 mock provider 가능 |
| Dashboard Overview | `GET /api/dashboard/overview` | 필수 | 카드형 집계 |
| Request Log 목록 | `GET /api/projects/:projectId/logs` | 필수 | pagination은 단순 cursor 또는 limit |
| Request Detail | `GET /api/llm-requests/:requestId` | 필수 | raw prompt/response 미반환 |

### 3.2 Gateway Core

| 기능 | P0 기준 |
|---|---|
| Health | `GET /healthz`, `GET /readyz` |
| Models | `GET /v1/models` |
| Chat Completions | `POST /v1/chat/completions`, non-stream 우선 |
| OpenAI-compatible body | `model`, `messages`, `temperature`, `max_tokens`, `stream=false` |
| API Key 인증 | `Authorization: Bearer <gateway_api_key>` |
| App Token 검증 | `X-GateLM-App-Token` |
| Tenant/Project/Application 식별 | API Key/App Token metadata 기준 |
| 민감정보 처리 | email/phone redact, api_key/jwt/rrn block |
| Exact Cache | Redis 기반 |
| Simple Routing | `model=auto`이면 low-cost model 선택 |
| Provider Adapter | `mock` 필수, 실제 Provider adapter는 P1 선택 |
| Event/Log | 요청 종료 시 invocation event 또는 direct log write |

### 3.3 Web Console

P0 화면은 최소화한다.

```text
- Login
- Onboarding: Tenant / Project / Provider / Key 발급
- Dashboard Overview
- Request Log Table
- Request Detail Drawer
- 간단한 Customer App Demo 또는 Text-only Chat UI 중 하나
```

복잡한 CRUD 화면을 모두 만들지 않는다.

### 3.4 Worker / Analytics

P0 canonical source는 PostgreSQL `p0_llm_invocation_logs`다.

| 경로 | 설명 | 판단 |
|---|---|---|
| P0 기준 | Gateway/direct writer -> PostgreSQL `p0_llm_invocation_logs` | 필수 |
| Optional mirror | Worker/direct writer -> ClickHouse `llm_invocations` | PostgreSQL 숫자와 일치할 때만 사용 |
| P1 방향 | Gateway -> Redpanda -> Worker -> ClickHouse/PostgreSQL | P0 필수 아님 |

P0 direct writer는 코드와 문서에 반드시 `P0 shortcut`이라고 표시한다. 장기 방향은 응답 경로와 분석 경로 분리다.

---

## 4. P1 범위

P0 완료 후 시간이 남으면 진행한다.

| 기능 | 설명 |
|---|---|
| SSE Streaming | `stream=true` 중계 |
| 실제 Provider adapter | mock provider acceptance 완료 후 1개 선택 |
| Redpanda 실제 연동 | event bus 기반 async logging |
| ClickHouse 실제 집계 | raw invocation table + 간단 aggregate |
| Rate Limit | RPM 기준 project 단위 |
| Budget hard block | project monthly budget 기준 |
| Provider connection test | 등록된 provider 호출 가능 여부 확인 |
| Chat UI Reply-to Context | parent message 1단계 context |
| Dashboard chart | requests/cost/latency over time |

---

## 5. P2 범위

P0/P1 후에도 무리해서 넣지 않는다.

| 기능 | 이유 |
|---|---|
| Semantic Cache 실제 embedding | vector store, threshold, 보안 기준 필요 |
| AI Service routing score | simple routing으로 P0 충분 |
| CEL policy editor/evaluator | 정책 엔진만으로도 별도 프로젝트급 |
| Policy rollback UI | version 구조는 문서만 유지 |
| S3 payload storage | P0는 DB preview/ref 또는 생략 가능 |
| AWS Secrets Manager + KMS 실연 | local secret resolver interface 우선 |
| Terraform/AWS 배포 | local Docker Compose 데모 우선 |
| Custom regex rule UI | ReDoS 검증과 보안 리뷰 필요 |
| Local Model provider | mock/openai 중 하나로 충분 |
| 고급 dashboard | P0는 overview cards + logs |

---

## 6. P0에서 절대 빼면 안 되는 것

아래를 빼면 GateLM이 Gateway 제품으로 보이지 않는다.

```text
1. /v1/chat/completions
2. API Key 인증
3. App Token 검증
4. Tenant / Project / Application context
5. Provider 호출 전 마스킹/차단
6. Exact Cache
7. model=auto simple routing
8. Request Log
9. Request Detail Drawer
10. Dashboard Overview
```

---

## 7. P0에서 의도적으로 단순화하는 것

| 영역 | P0 단순화 |
|---|---|
| 인증 | seed admin 또는 local login 허용 |
| Provider Secret | local encrypted mock 또는 env 기반 secret resolver |
| Policy | CEL 대신 JSON config |
| Budget | P0는 cost metadata와 seed policy 수준. hard block은 P1 |
| Rate Limit | P0는 no-op 또는 seed/config 수준. Redis fixed window는 시간이 남으면 |
| Worker | direct writer 또는 outbox fallback 가능 |
| ClickHouse | 개발 안정성이 낮으면 Postgres fallback 가능 |
| UI | CRUD 전체가 아니라 데모 플로우 중심 |

---

## 8. P0 Definition of Done

P0는 아래 체크리스트가 전부 통과하면 완료다.

```text
[ ] docker compose 기반 로컬 실행 가능
[ ] seed admin으로 로그인 가능
[ ] project/application/provider/api key/app token 생성 가능
[ ] curl로 /v1/chat/completions 호출 가능
[ ] 인증 실패 요청은 Provider 호출 전 401/403
[ ] email 포함 요청은 redacted prompt로 provider/mock에 전달
[ ] api key-like/JWT/RRN 포함 요청은 Provider 호출 전 block
[ ] 동일 safe 요청 1회차 miss, 2회차 exact cache hit
[ ] model=auto 요청은 selectedModel이 low-cost model로 기록
[ ] Request Log 목록에 요청이 표시됨
[ ] Request Detail에 token/cost/latency/cache/routing/masking 표시됨
[ ] Dashboard Overview에 request/cost/token/latency/cache/block 지표 표시됨
[ ] raw prompt/raw response/secret 원문이 DB/API/log에 노출되지 않음
```

---

## 9. 구현 시작 순서

```text
Day 1: repo skeleton + docker compose + seed + health check
Day 2: Control Plane P0 schema/API
Day 3: Gateway /v1/chat/completions + mock provider
Day 4: API Key/App Token 인증 + tenant/project/application context
Day 5: masking + exact cache + simple routing
Day 6: invocation log 저장
Day 7: Request Log / Detail API
Day 8: Dashboard Overview API
Day 9: Web Console 화면
Day 10: demo app/chat + 통합 테스트
```

원칙: 화면부터 만들지 않는다. Gateway vertical slice가 먼저다.
