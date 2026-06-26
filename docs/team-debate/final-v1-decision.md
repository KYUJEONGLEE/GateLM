# GateLM v1.0.0 최종 결론

## 1. 최종 제품 정의

GateLM v1.0.0은 단순 LLM proxy나 Chat UI가 아니다.

GateLM은 기업의 LLM 요청을 승인된 Gateway로 모아, 보안, 비용, 정책, 로그, 관측을 중앙에서 통제하는 B2B LLM Gateway다.

발표와 구현의 첫 메시지는 아래로 고정한다.

```text
GateLM은 고객사 업무 앱의 LLM 요청이 반드시 지나가는 Gateway이며,
이 경로에서 인증, 보안, 비용 통제, 캐시, 라우팅, 로그 분석을 한 번에 제공한다.
```

OpenAI-compatible API는 제품 가치가 아니라 도입 장벽을 낮추는 ingress contract로 설명한다.

## 2. v1.0.0 합격 기준

v1.0.0은 기능 개수로 판단하지 않는다.

합격 기준은 아래 한 줄 경로가 안정적으로 동작하는 것이다.

```text
관리자가 Project / Application / API Key / App Token / Provider 설정을 준비한다
-> Customer Demo App이 GateLM Gateway로 요청한다
-> Gateway가 API Key와 App Token을 검증한다
-> applicationId 기준 Rate Limit decision을 수행한다
-> 민감정보를 redaction하거나 위험 정보를 block한다
-> 안전한 동일 요청은 Exact Cache로 Provider 호출을 건너뛴다
-> model=auto 요청은 selectedModel과 routingReason을 남긴다
-> Mock Provider 또는 실제 Provider가 응답한다
-> requestId로 Log, Detail, Dashboard, Metrics까지 추적한다
-> k6 baseline으로 현재 성능과 다음 개선 방향을 설명한다
```

이 경로에 직접 기여하지 않거나 데모 안정성을 크게 흔드는 기능은 v1.0.0 main path에서 제외한다.

## 3. 최종 우선순위

### 3.1 v1 Main Path

아래는 v1.0.0에서 반드시 완성한다.

| 순위 | 항목 | 완료 기준 |
|---:|---|---|
| 1 | Customer Demo App | GateLM 제품 화면이 아니라 고객사 업무 앱 역할로 Gateway를 호출한다. |
| 2 | Control Plane 설정 반영 | Project, Application, API Key, App Token, Provider/Model 설정이 Gateway 판단에 실제로 쓰인다. |
| 3 | Gateway 인증과 context | API Key/App Token 검증 후 tenantId, projectId, applicationId가 request context와 log/detail에 남는다. |
| 4 | applicationId 기준 PostgreSQL-backed Rate Limit | 1분 fixed window, allowed/remaining/retryAfterSeconds/reason decision을 Request Detail과 metrics에 남긴다. |
| 5 | Safety | email/phone은 redaction, API Key/JWT/RRN/private key 계열은 Provider 호출 전 block한다. |
| 6 | Exact Cache | 동일 safe request 1회차 miss, 2회차 hit. cache hit 시 Provider 호출 count가 증가하지 않는다. |
| 7 | Simple Routing | `model=auto` 요청에 대해 selectedProvider, selectedModel, routingReason을 기록한다. |
| 8 | Mock Provider path | 외부 장애와 무관하게 main demo가 항상 성공하는 Provider path를 유지한다. |
| 9 | Request Log / Detail | requestId 기준으로 status, routing, cache, masking, rate limit, cost, latency를 확인한다. |
| 10 | Dashboard Overview | request count, success/blocked/cache hit, latency, cost 요약을 보여준다. |
| 11 | Metrics endpoint | request, latency, cache, masking/block, rate limit, log write duration 기준 수치를 남긴다. |
| 12 | k6 baseline report | pass/fail 목표보다 병목과 다음 최적화 방향을 설명하는 재현 가능한 report를 만든다. |

### 3.2 v1 Candidate

아래는 가능하면 붙인다. 실패해도 main path가 살아 있어야 한다.

| 순위 | 항목 | 판단 |
|---:|---|---|
| 1 | 실제 Provider 1개 | 가장 우선순위가 높은 candidate. 단, Mock fallback과 secret-safe 처리 없이는 main path로 올리지 않는다. |
| 2 | JSON structured log polish | 구현 부담이 낮고 운영성 메시지가 강하므로 여유가 있으면 포함한다. |
| 3 | Budget Hard Block 최소 demo | Rate Limit 이후에 붙인다. ledger/정산 수준 구현은 v2로 둔다. |
| 4 | Dashboard trend 일부 | 숫자 카드가 먼저다. trend는 시간이 남을 때만 일부 포함한다. |
| 5 | Provider timeout/fallback scenario | 실제 Provider를 붙인 경우에만 우선한다. |

### 3.3 v2 Evidence Path

아래는 v1.0.0 필수에서 제외하고, v2에서 "왜 필요한지"를 수치와 구조로 증명한다.

| 순위 | 항목 | v2에서 보여줄 근거 |
|---:|---|---|
| 1 | Redis Rate Limit | PostgreSQL-backed baseline과 p95 latency, DB query latency, contention을 비교한다. |
| 2 | ClickHouse Analytics | PostgreSQL log query와 대량 synthetic log query 성능을 비교한다. |
| 3 | Redpanda Event Pipeline | direct writer와 event-driven analytics path의 응답 경로 영향을 비교한다. |
| 4 | Semantic Cache | safe-hit 기준, false positive 위험, 평가셋, disabled mode를 먼저 만든다. |
| 5 | Streaming | 사용자 체감과 Gateway logging/tracing trade-off를 별도 evidence로 보여준다. |
| 6 | Runtime Policy Editor | v1의 active config 반영 이후 운영자 편집 흐름으로 확장한다. |
| 7 | Custom Regex Rule UI | detector registry 구조 위에서 고객사별 규칙으로 확장한다. |
| 8 | Self-hosted / Hybrid guide | Docker Compose 실행 기준을 넘어 설치/운영 가이드로 확장한다. |
| 9 | RAG / FAQ chatbot | GateLM 내부 기능이 아니라 고객사 앱 예시로 둔다. |

## 4. 기술스택 결정

v1.0.0 기술스택은 아래로 고정한다.

| 영역 | 결정 | 이유 |
|---|---|---|
| Gateway Core | Go 1.24 + 표준 `net/http` | Gateway hot path를 작게 유지하고 pipeline/stage 구조를 직접 통제한다. |
| Control Plane API | NestJS + TypeScript | Project, Application, Provider, Key, Token, 정책 설정을 module 단위로 나누기 좋다. |
| Web Console | Next.js App Router + TypeScript | Admin onboarding, dashboard, log/detail UI를 빠르게 구성한다. |
| Database | PostgreSQL 16 | v1 canonical source. control metadata, request log, rate limit baseline을 담당한다. |
| Cache | Redis 7 | v1 Exact Cache에 사용한다. rate limit은 v2 최적화 adapter로 둔다. |
| AI Service | FastAPI, v2 이후 | Semantic Cache, routing score, embedding 등 AI 보조 기능이 필요할 때 붙인다. |
| Event / Analytics | Redpanda / ClickHouse, v2 이후 | v1 metrics와 병목 근거가 나온 뒤 분석 경로로 확장한다. |

## 5. Rate Limit 최종 결정

v1 Rate Limit은 PostgreSQL-backed fixed window로 시작한다.

최종 기준:

```text
scope: applicationId
algorithm: fixed window
window: 60초
decision: allowed, remaining, retryAfterSeconds, reason
storage: PostgreSQL
interface: RateLimiter
detail: Request Detail에 decision 기록
metrics: decision count와 decision duration 기록
v2: Redis adapter와 비교
```

`applicationId`를 선택하는 이유:

- App Token이 Application 단위라 설명이 자연스럽다.
- 고객사 업무 앱별 사용량 통제 메시지가 명확하다.
- "이 앱이 제한됐다"는 데모 장면이 project/apiKey보다 직관적이다.
- Request Detail에서는 applicationId와 함께 projectId, apiKeyId도 보여준다.

## 6. Control Plane 설정 반영 방식

v1에서는 DB-backed active config read로 시작한다.

권장 구조:

```text
Control Plane DB
-> RuntimeConfigProvider interface
-> Gateway가 request 처리에 필요한 active config 조회
-> 인증, routing, rate limit, logging 판단에 반영
-> v2에서 Redis active config cache 또는 publish flow로 최적화
```

금지:

- Gateway handler가 DB schema에 직접 묶이는 구조
- `.env` static key만으로 제품 데모를 끝내는 구조
- 정책 판단을 handler 내부 if문으로 흩뿌리는 구조

## 7. 역할별 우선순위

역할은 기술 레이어가 아니라 하루 끝에 보여줄 수 있는 제품 결과물 기준으로 나눈다.

| 담당 | Slice | 우선순위 1 | 우선순위 2 |
|---|---|---|---|
| A | Control Plane & Runtime Config | 관리자가 만든 설정이 Gateway에 반영되는 장면 | key/token 원문 1회 표시와 hash 저장 |
| B | Gateway Runtime & Provider | Gateway 요청이 mock provider path를 안정적으로 통과하는 장면 | 실제 Provider 1개 fallback-ready 연결 |
| C | Governance | API Key/App Token/context/rate limit decision이 Request Detail에 남는 장면 | applicationId rate limit metrics |
| D | Safety & Cost | redaction/block/cache/routing이 한 요청 흐름에서 보이는 장면 | cost-saving evidence와 cache safety |
| E | Observability & Demo | requestId 하나로 log/detail/dashboard/metrics/demo flow가 연결되는 장면 | k6 baseline과 발표용 demo checklist |

## 8. Day 0 Contract Freeze

구현 전에 아래 계약만 먼저 고정한다. 문서 회의가 길어지지 않도록 범위를 작게 잡는다.

| 순위 | 계약 | 필수 필드 |
|---:|---|---|
| 1 | Gateway Context | requestId, tenantId, projectId, applicationId, apiKeyId, appTokenId |
| 2 | Runtime Config | project, application, provider, model, key/token status, rate limit config |
| 3 | Rate Limit Decision | scope, window, allowed, remaining, retryAfterSeconds, reason |
| 4 | Invocation Log | status, errorCode, cacheStatus, maskingAction, routingReason, costMicroUsd, latencyMs |
| 5 | Dashboard Overview | total, success, blocked, cacheHit, rateLimited, cost, latency |
| 6 | Metrics | request count, latency, provider latency, cache hit, masking/block, rate limit, log write duration |
| 7 | Smoke Scenario | safe, redaction, blocked, cache hit, rate limited, log/detail/dashboard 확인 |

계약은 문서만으로 끝내지 않는다. fixture, smoke script, schema validation, 테스트 중 하나로 깨지는 지점이 드러나야 한다.

## 9. Merge와 운영 원칙

1. 하루에 담당자당 1~2개 PR을 목표로 한다.
2. PR 하나는 스크럼에서 보여줄 수 있는 작동 결과를 가져야 한다.
3. 공통 contract 변경은 feature PR과 섞지 않는다.
4. skeleton PR은 허용하되 같은 날 behavior PR이 따라와야 한다.
5. mock, fixture, synthetic data를 쓰더라도 실제 통합 지점을 문서화한다.
6. 매일 끝에는 코드 설명보다 실행 결과를 보여준다.
7. 마지막에는 main path smoke owner가 전체 흐름을 확인한다.

## 10. 보안 원칙

v1.0.0이 작아도 보안 기준은 낮추지 않는다.

- raw prompt 저장 금지
- raw response 저장 금지
- API Key/App Token/Provider Key 평문 저장 금지
- Authorization header 로그 출력 금지
- raw provider error body 저장 금지
- 실제 secret 또는 실제 개인정보를 seed/test/snapshot에 사용 금지
- cache key에 raw prompt 사용 금지
- masking stage를 cache lookup 뒤로 이동 금지
- Web Console 또는 Customer Demo App에서 Provider 직접 호출 금지

## 11. 최종 결정 요약

최종 결론은 다음이다.

```text
제품 기준: Jiseob의 v1/v2 roadmap
범위 조절: Kyujeong의 main/candidate/evidence 분리
기술 경계: Kyumin의 Go Gateway + interface 중심 구조
실행 방식: Yoonji의 vertical slice 병렬 구현
제품 임팩트: Hyeok의 공격적인 데모 감각을 v1 candidate와 v2 evidence로 흡수
```

v1.0.0은 작지만 실제 운영 제품처럼 설명되는 B2B Gateway baseline이다.

v2.0.0은 기능을 많이 붙인 버전이 아니라, v1에서 측정한 병목을 근거로 확장성을 증명하는 버전이다.
