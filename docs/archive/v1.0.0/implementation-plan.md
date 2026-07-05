# GateLM v1.0.0 Implementation Plan

## 1. Purpose

이 문서는 GateLM v1.0.0 baseline 구현 계획이다.

v1.0.0은 기존 P0 Gateway smoke를 제품처럼 설명 가능한 B2B LLM Gateway baseline으로 승격한다. 목표는 기능을 많이 나열하는 것이 아니라, 고객사 앱의 LLM 요청이 GateLM을 통과하면서 인증, 정책, 보안, 비용 절감, 라우팅, 로그, 대시보드, 지표까지 추적되는 하나의 운영 흐름을 완성하는 것이다.

계약 상세는 `docs/archive/v1.0.0/contracts.md`를 따른다.

## 2. Product Definition

GateLM은 단순 LLM proxy나 Chat UI가 아니다.

GateLM은 기업의 LLM 요청을 승인된 Gateway 경로로 모아, 보안, 비용, 정책, 로그, 관측을 중앙에서 관리하게 해주는 B2B LLM Gateway다.

OpenAI-compatible API는 제품 가치가 아니라 도입 장벽을 낮추는 ingress contract로 설명한다.

## 3. v1 Main Flow

v1.0.0 합격 기준은 아래 흐름이 안정적으로 동작하는 것이다.

```text
Admin이 Project / Application / Provider / API Key / App Token을 준비한다
-> Customer Demo App이 GateLM Gateway로 요청한다
-> Gateway가 API Key와 App Token을 검증한다
-> Gateway가 tenantId / projectId / applicationId context를 확정한다
-> applicationId 기준 PostgreSQL-backed Rate Limit을 적용한다
-> rule-based safety가 redaction 또는 block을 수행한다
-> model=auto 요청은 selectedModel과 routingReason을 남긴다
-> 동일 safe request는 Exact Cache로 Provider 호출을 건너뛴다
-> Mock Provider 또는 fallback-ready 실제 Provider adapter가 응답한다
-> requestId로 Request Log / Detail / Dashboard / Metrics까지 추적한다
-> k6 baseline으로 현재 병목과 v2 개선 방향을 설명한다
```

## 4. Scope

### v1 Main Path

| Area | Required outcome |
|---|---|
| Customer Demo App | 고객사 앱 역할로 Gateway만 호출한다. |
| Control Plane | Project/Application/Provider/API Key/App Token/Runtime Config를 만든다. |
| Gateway | `/v1/chat/completions`, `/v1/models`, auth, context, rate limit, provider call을 처리한다. |
| Safety | v1 main path는 rule-based redaction/block만 사용한다. |
| Routing | `model=auto`를 selectedProvider/selectedModel/routingReason으로 확정한다. |
| Exact Cache | Redis exact cache miss -> hit와 provider bypass를 보여준다. |
| Observability | requestId로 Log/Detail/Dashboard/Metrics를 연결한다. |
| Performance | k6 baseline으로 RPS, p95 latency, cache hit, rate limit 병목을 측정한다. |

### v1 Candidate

- 실제 Provider 1개. 단, Mock Provider fallback이 반드시 살아 있어야 한다.
- JSON structured log polish.
- Dashboard trend 일부.
- Budget Hard Block 최소 demo.

### v2 Evidence Path

- Redis Rate Limit.
- Redpanda event pipeline.
- ClickHouse analytics.
- Semantic Cache / Routing Evaluation Evidence.
- Streaming.
- Runtime Policy Editor 고도화.
- RAG/FAQ chatbot은 GateLM core가 아니라 고객사 앱 예시로 둔다.

Semantic Cache / Routing Evaluation Evidence는 v1 PR sequence에서 제외한다.

- v1 main path, v1 smoke, Gateway production blocking 판단에 연결하지 않는다.
- v1의 필수 cache/routing 범위는 Redis Exact Cache와 simple routing 검증이다.
- v2 후보 근거가 필요하면 별도 backlog/docs PR로 다룬다.
- 평가는 redacted synthetic prompt 기준의 offline script 또는 report로 제한한다.
- raw prompt embedding, raw prompt, raw response, raw vector를 저장하거나 commit하지 않는다.
- API, DB, Event, Metrics 계약을 변경하지 않는다.
- 권장 브랜치 예: `docs/v2-semantic-cache-evidence`

## 5. Team Ownership

역할은 사람별 관심 분야와 기술 bounded context를 기준으로 나눈다. 각 역할은 자기 서비스/모듈 안에서 fixture로 먼저 완성하고, 계약으로 통합한다.

| Owner | Bounded context | Main tech | Owns | Does not own |
|---|---|---|---|---|
| 김규민 | Product Experience & Demo | Next.js | Web Console, Customer Demo App, Dashboard UI, Request Detail UI, demo UX | Gateway 정책 판단, DB counter, Provider call |
| 재혁님 | Control Plane & Runtime Policy | NestJS | Project/Application/Provider/API Key/App Token 발급, Runtime Config, routing/cache/rate limit/safety config | Gateway request runtime decision |
| 이지섭 | Gateway Data Plane & Governance | Go | Gateway pipeline, API Key/App Token verification, context resolver, RateLimiter runtime, ProviderAdapter, Mock Provider path | Admin CRUD UI/API ownership |
| 이윤지 | AI Safety & Evaluation Lab | Python/FastAPI | safety eval corpus, rule 품질 평가, optional RemoteSafetyEngine prototype | v1 Gateway hot path 필수 의존성, v2 semantic cache/routing evidence |
| 이규정 | Observability, Data Platform & Performance | PostgreSQL, metrics, k6 | Invocation Log, Detail/Dashboard aggregation backend, `/metrics`, k6 baseline, v2 Redpanda/ClickHouse evidence | UI ownership, Gateway policy decision |

## 6. Key Boundary Decisions

### Control Plane vs Gateway

재혁님은 설정을 만든다. 이지섭은 요청 시 그 설정을 실행한다.

| Topic | Control Plane owner | Gateway owner |
|---|---|---|
| API Key | 생성, 회전, 폐기, hash/prefix/last4 저장, 원문 1회 표시 | Authorization header hash 검증 |
| App Token | Application binding과 token hash 저장 | App Token 검증과 scope mismatch 판단 |
| Runtime Config | provider/model/routing/cache/safety/rate limit config 제공 | RuntimeConfigProvider로 읽고 요청 처리에 적용 |
| Rate Limit | rule/config 저장 | PostgreSQL counter atomic check-and-increment, 429 반환 |
| Provider/Model | 등록, 허용 설정, pricing rule | request model 검증, selected model 확정, provider adapter 호출 |

### Safety Lab vs Gateway Safety

v1 main path는 Go Gateway의 rule-based SafetyEngine을 사용한다.

이윤지의 Python/FastAPI 작업은 v1에서 optional/shadow/evaluation path다. Python service가 꺼져 있어도 v1 smoke는 통과해야 한다.

```text
Gateway SafetyEngine
-> RuleBasedSafetyEngine       # v1 main path
-> RemoteSafetyEngine          # optional, disabled by default

Safety Lab
-> docs/archive/v1.0.0/fixtures/safety-eval-corpus.jsonl
-> detector quality report
-> AI detector prototype
```

Semantic Cache / Routing Evaluation Evidence는 v1 Safety Lab PR sequence에 포함하지 않는다. 필요하면 v1 baseline 이후 v2 evidence backlog에서 별도 docs PR로 다룬다.

### Observability Ownership

이규정은 모든 metadata를 직접 생산하지 않는다.

- 이지섭은 Gateway request/provider/rate limit metadata를 채운다.
- 이윤지는 safety evaluation 근거를 제공한다.
- 재혁님은 config source를 제공한다.
- 이규정은 Invocation Log, Dashboard aggregation, metrics, k6로 검증 가능하게 만든다.
- 김규민은 UI와 demo에서 이를 보여준다.

## 7. Dependency Reduction

Day 0에 아래 fixture를 먼저 고정한다.

| Fixture / Contract | Producer | Consumers |
|---|---|---|
| `docs/archive/v1.0.0/fixtures/runtime-config.fixture.json` | 재혁님 | 이지섭, 이윤지, 이규정 |
| `docs/archive/v1.0.0/schemas/gateway-context.schema.json` | 이지섭 | 재혁님, 이윤지, 이규정 |
| `docs/archive/v1.0.0/fixtures/gateway-context.fixture.json` | 이지섭 | 이규정 |
| `docs/archive/v1.0.0/fixtures/invocation-log.fixture.json` | 이지섭, 이규정 | 김규민, 이규정 |
| `docs/archive/v1.0.0/fixtures/dashboard-overview.fixture.json` | 이규정 | 김규민 |
| `docs/archive/v1.0.0/fixtures/safety-eval-corpus.jsonl` | 이윤지 | 이지섭, 재혁님 |
| `demo-scenario.md` | 김규민, 이규정 | 전체 |

규칙:

- 다른 팀원의 구현을 기다리지 않고 fixture/mock으로 먼저 만든다.
- 공통 계약 변경은 기능 PR과 섞지 않는다.
- v1 main path에 optional service를 필수 dependency로 넣지 않는다.

## 8. Work Plan

### Phase 0: Contract Freeze

Goal:

- `contracts.md`를 팀 기준으로 승인한다.
- fixture/schema/smoke skeleton을 만든다.

Outcome:

- 각 담당자가 독립 브랜치에서 구현을 시작할 수 있다.

### Phase 1: Visible Skeleton

Goal:

- Customer Demo App 또는 smoke script에서 Gateway safe request가 200으로 성공한다.

Outcome:

- healthz/readyz/models/safe request/requestId/Mock Provider stats 확인.

### Phase 2: Governance

Goal:

- API Key/App Token/context/rate limit이 Provider 호출 전에 동작한다.

Outcome:

- valid 200, invalid key 401, invalid token 403, scope mismatch 403, rate limit 429.

### Phase 3: Safety, Routing, Cache

Goal:

- rule-based safety, model=auto routing, exact cache가 provider call 전에 적용된다.

Outcome:

- redaction 200, block 403, cache miss -> hit, provider bypass, routing metadata 확인.

### Phase 4: Observability

Goal:

- requestId로 Log/Detail/Dashboard/Metrics를 추적한다.

Outcome:

- success/cache_hit/blocked/rate_limited/error가 저장/조회/집계된다.

### Phase 5: Demo Freeze & Baseline

Goal:

- 발표자가 반복 실행 가능한 데모와 k6 baseline을 가진다.

Outcome:

- demo reset, fallback, smoke, k6 report, known risk 정리.

## 9. PR Rules

- 하루에 담당자당 1-2개 PR을 목표로 한다.
- PR 하나는 스크럼에서 보여줄 수 있는 작동 결과를 가져야 한다.
- skeleton PR은 허용하지만 같은 날 behavior PR이 따라와야 한다.
- 공통 contract 변경은 별도 docs PR로 낸다.
- API/DB/Event/Metrics/Security 영향은 PR 본문에 명시한다.
- 테스트는 가능하면 Given/When/Then 구조로 작성한다.

권장 브랜치:

```text
docs/v1-contract-freeze
feat/console-demo-flow
feat/control-plane-runtime-policy
feat/gateway-governance-pipeline
feat/safety-eval-lab
feat/observability-metrics-k6
fix/v1-demo-smoke
```

커밋 메시지는 conventional commit style을 따르며, type을 제외한 subject/body는 한글로 쓴다.

### 9.1 First Implementation PR Merge Unit

첫 구현 PR은 구현 착수를 막지 않는 가장 작은 enterprise-grade vertical slice로 둔다.

Recommended branch:

```text
feat/gateway-governance-pipeline
```

Primary owner:

```text
이지섭 / Gateway Data Plane & Governance
```

Goal:

- Gateway가 active runtime config를 interface로 소비할 준비를 한다.
- `applicationId` 기준 PostgreSQL fixed-window RateLimiter를 Provider/cache/safety 전에 실행한다.
- Rate limit 초과가 `429 rate_limited`와 `rateLimitDecision`으로 로그 가능한 terminal outcome이 된다.

Required scenario:

```text
Given active runtime config fixture or equivalent static provider
And valid API Key/App Token for one application
When Customer Demo App sends a safe chat completion request
Then Gateway returns 200 through Mock Provider
And requestId, selectedProvider, selectedModel, routingReason are present

Given the same application exceeds its configured rate limit
When Customer Demo App sends another chat completion request
Then Gateway returns 429 rate_limited
And cache lookup does not run
And provider call count does not increase
And terminal log contains status=rate_limited, httpStatus=429, errorStage=check_rate_limit
```

Must include:

- `RateLimiter` interface and PostgreSQL-backed fixed-window adapter.
- DB migration for rate limit counters owned by Gateway.
- Given/When/Then tests for allowed, exceeded, disabled, and internal-error decisions.
- Handler or pipeline wiring that preserves ProviderAdapter, cache, safety, and logging boundaries.
- PR evidence showing `go test ./...` and at least one local smoke/curl or handler test result.

Out of scope for first PR:

- Control Plane live API integration.
- Web Console UI.
- Python/FastAPI remote safety as a Gateway dependency.
- Prometheus metrics completeness.
- k6 baseline report.
- Real provider becoming the required path.

Parallel work guidance:

| Owner | Can proceed in parallel | Must not block first PR on |
|---|---|---|
| 재혁님 | Implement Control Plane Admin API and runtime config publish flow against `runtime-config` and credential fixtures | Gateway live runtime config fetch |
| 김규민 | Build Demo App, Request Log, Request Detail, Dashboard screens against fixtures/mock APIs | Final Gateway/Observability backend completion |
| 이윤지 | Build Safety Lab corpus checks, optional RemoteSafetyEngine adapter, and model evaluation experiments | Gateway hot path depending on Python service |
| 이규정 | Prepare Invocation Log query, Dashboard aggregation, `/metrics`, and k6 scripts against fixtures and Gateway test outputs | First PR exposing full metrics/k6 evidence |

The first PR may use Mock Provider as the visible provider path. Real provider or model experiments may proceed behind adapter boundaries, but they must keep Mock Provider fallback available.

## 10. Demo Scenario

1. Admin이 Project/Application/Provider를 준비한다.
2. Admin이 API Key/App Token을 발급한다.
3. Customer Demo App이 Gateway로 safe request를 보낸다.
4. 같은 요청을 다시 보내 cache hit/provider bypass를 보여준다.
5. email/phone 요청으로 redaction을 보여준다.
6. credential/JWT/RRN/private key 요청으로 block을 보여준다.
7. `model=auto` 요청으로 routing result를 보여준다.
8. Rate Limit 초과로 429를 보여준다.
9. requestId로 Log/Detail/Dashboard를 연다.
10. `/metrics`와 k6 report로 현재 병목과 v2 확장 근거를 설명한다.

## 11. Completion Criteria

```text
[ ] Customer Demo App은 Gateway만 호출한다.
[ ] Control Plane 설정이 Gateway runtime 판단에 쓰인다.
[ ] Gateway safe request가 200으로 성공한다.
[ ] invalid API Key는 401로 차단된다.
[ ] invalid App Token과 scope mismatch는 403으로 차단된다.
[ ] applicationId Rate Limit 초과는 429로 차단된다.
[ ] email/phone은 redacted prompt로 Provider에 전달된다.
[ ] credential/JWT/RRN/private key 계열은 Provider 호출 전 block된다.
[ ] model=auto는 selectedProvider/selectedModel/routingReason을 남긴다.
[ ] 동일 safe request 2회차는 cache hit이며 Provider call count가 증가하지 않는다.
[ ] requestId로 Log/Detail/Dashboard/Metrics를 추적한다.
[ ] k6 baseline report가 RPS, p95 latency, cache hit, rate limit 병목을 보여준다.
[ ] raw prompt/raw response/secret 원문이 DB/log/Redis/test/snapshot/API response에 남지 않는다.
```
