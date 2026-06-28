# Jiseob Final v1/v2 Decision

## 1. 최종 입장

내 최종 입장은 다음이다.

> GateLM v1.0.0은 "작게 만든 데모"가 아니라, 작지만 실제 운영 제품처럼 설명되는 B2B LLM Gateway baseline이어야 한다.

v1.0.0의 목표는 기능 개수를 늘리는 것이 아니다. 고객사 업무 앱의 LLM 요청 하나가 GateLM을 통과하면서 인증, 정책, 보안, 비용 절감, 라우팅, 로그, 대시보드, 성능 근거가 하나의 흐름으로 설명되어야 한다.

중간 발표는 v2.0.0에 가깝게 본다. v2.0.0은 더 많은 기능을 붙인 버전이 아니라, v1.0.0에서 측정한 병목을 근거로 성능과 아키텍처 확장성을 증명하는 단계여야 한다.

## 2. 제품 정의

GateLM은 기업의 LLM 사용을 중앙 통제 지점으로 수렴시켜, 승인된 애플리케이션만 안전하게 Provider를 호출하고, 보안·비용·정책·로그를 일관되게 관리하게 해주는 B2B LLM Gateway다.

GateLM은 Chat UI, RAG 서비스, 개발자 편의 proxy가 아니다.

OpenAI-compatible request shape은 제품 가치가 아니라 Gateway ingress contract로 설명한다. 발표의 전면 메시지는 "쉽게 붙인다"가 아니라 "기업의 LLM 사용 경로를 중앙에서 통제한다"여야 한다.

## 3. v1.0.0 Main Path

v1.0.0에서 반드시 성공해야 하는 경로는 아래다.

```text
관리자가 Project / Application / API Key / App Token / Provider 설정을 준비한다
-> Customer Demo App이 GateLM Gateway로 요청한다
-> Gateway가 API Key와 App Token을 검증한다
-> applicationId 기준 PostgreSQL-backed Rate Limit decision을 수행한다
-> 민감정보를 redaction하거나 위험 정보를 block한다
-> 안전한 동일 요청은 Exact Cache로 Provider 호출을 건너뛴다
-> model=auto 요청은 selectedModel과 routingReason을 남긴다
-> Mock Provider가 안정적으로 응답하고, 가능하면 실제 Provider 1개도 같은 adapter path로 응답한다
-> requestId로 Log, Detail, Dashboard, Metrics까지 추적한다
-> k6 baseline으로 현재 성능과 v2 개선 방향을 설명한다
```

이 경로가 안정적으로 동작하면 v1.0.0은 충분히 제품처럼 보인다.

## 4. v1.0.0 Main Scope

v1.0.0 main scope는 다음으로 고정한다.

| 영역 | 결정 |
| --- | --- |
| Control Plane | Project, Application, API Key, App Token, Provider/Model 최소 설정 |
| Runtime Config | 관리자가 만든 설정이 Gateway 인증, 라우팅, rate limit, 로그에 실제 반영 |
| Gateway | text-only request, requestId, timeout/error response, provider adapter path |
| Authentication | API Key 인증, App Token 검증 |
| Context | tenantId, projectId, applicationId, apiKeyId, appTokenId 연결 |
| Governance | applicationId 기준 PostgreSQL-backed fixed window Rate Limit |
| Safety | email/phone redaction, API Key/JWT/RRN/private key 계열 block |
| Cost Control | Exact Cache miss -> hit, Provider bypass, simple routing |
| Observability | Request Log, Request Detail, Dashboard Overview |
| Metrics | request, latency, provider latency, cache, block, rate limit, log write duration |
| Evidence | smoke script, k6 baseline report, demo checklist |
| Demo | Web Console과 Customer Demo App 분리 |

## 5. v1.0.0 Candidate

아래 항목은 v1에서 강하게 시도하되, 실패해도 main path가 살아 있어야 한다.

| 항목 | 최종 판단 |
| --- | --- |
| 실제 Provider 1개 | v1 candidate 중 최우선으로 시도한다. 단, mock fallback으로 v1 합격 기준을 보장한다. |
| Budget Hard Block | 시간이 남으면 최소 demo로 붙인다. Rate Limit 이후 순서로 둔다. |
| JSON structured log | 가능하면 포함한다. 운영성과 v2 관측성 기반을 강화한다. |
| Dashboard trend 일부 | 숫자 카드가 먼저다. 시간이 남으면 일부 시계열을 붙인다. |
| Provider timeout/fallback | 실제 Provider를 붙인다면 반드시 같이 준비한다. |

실제 Provider는 "하면 좋은 보너스"가 아니다. 제품 신뢰도를 크게 높이는 v1 candidate다. 다만 Customer Demo App, Rate Limit, metrics/k6, Detail/Dashboard polish보다 먼저 붙이면 GateLM의 B2B 메시지보다 Provider 호출 자체가 부각될 수 있다.

따라서 실제 구현 우선순위는 다음을 추천한다.

```text
1. Customer Demo App
2. applicationId Rate Limit
3. metrics + k6 baseline
4. Request Detail / Dashboard polish
5. actual Provider 1개
```

## 6. v1.0.0에서 제외할 것

아래 기능은 v1 main path에서 제외한다.

- RAG / FAQ chatbot
- Semantic Cache
- Redis-backed Rate Limit
- Redpanda / ClickHouse 실연동
- Runtime Policy Editor
- Custom Regex Rule UI
- SSE Streaming
- Self-hosted installer
- 복잡한 사용자 초대 / 권한 관리

이 기능들은 버리는 것이 아니다. v2.0.0에서 성능·아키텍처 고도화 또는 제품 확장 근거로 다룬다.

## 7. v2.0.0 방향

v2.0.0은 중간 발표 목표에 가깝다.

v2.0.0의 핵심은 v1.0.0에서 측정한 병목을 근거로 개선 방향을 증명하는 것이다.

| v1 baseline | v2 improvement | 보여줄 근거 |
| --- | --- | --- |
| PostgreSQL Rate Limit | Redis Rate Limit | p95 latency, DB query latency, contention 감소 |
| PostgreSQL Log Query | ClickHouse Analytics | synthetic large log query latency |
| Direct Log Writer | Redpanda Event Pipeline | response path와 analytics path 분리 |
| Exact Cache | Semantic Cache 실험 | safe-hit 기준, false positive 위험, 평가셋 |
| Dashboard Summary | Time-series Dashboard | cost, latency, cache, rate trend |
| Non-stream response | Streaming | Gateway hot path와 logging trade-off |
| 최소 Runtime Config | Runtime Policy Editor | 운영자가 정책을 바꾸는 흐름 |
| 기본 detector | Custom Regex Rule UI | 고객사별 보안 규칙 확장 |

Redpanda와 ClickHouse는 v1 main path의 성공 조건으로 두지 않는다. v2에서 "왜 필요한지"를 v1 metrics와 병목 근거로 설명한다.

## 8. Rate Limit 최종 결정

Rate Limit은 v1에서 PostgreSQL-backed fixed window로 시작한다.

최종 결정:

```text
scope: applicationId
algorithm: fixed_window
windowSeconds: 60
storage: PostgreSQL
decision: allowed, remaining, retryAfterSeconds, reason
interface: RateLimiter
detail: Request Detail에 decision 기록
metrics: allowed/blocked count와 decision duration 기록
v2 extension: Redis adapter로 비교 실험
```

`applicationId`를 선택하는 이유:

- App Token이 Application 단위라 설명이 자연스럽다.
- Customer Demo App을 하나의 Application으로 보여주기 쉽다.
- "이 앱이 제한됐다"는 운영 메시지가 명확하다.
- 짧은 시간의 요청 폭주 제어는 Project보다 Application 단위가 자연스럽다.

다만 Dashboard와 비용 메시지는 projectId aggregate도 함께 보여준다. Budget은 v1 candidate 또는 v2에서 projectId 기준으로 다룬다.

## 9. Observability 최종 결정

Metrics는 v1 필수다.

v2에서 Redis, ClickHouse, Redpanda, Semantic Cache를 이야기하려면 v1 baseline 수치가 있어야 한다.

v1 최소 metrics:

```text
gateway_requests_total
gateway_request_duration_ms
gateway_provider_duration_ms
gateway_cache_requests_total
gateway_cache_hits_total
gateway_masking_actions_total
gateway_blocked_requests_total
gateway_rate_limit_decisions_total
gateway_rate_limit_duration_ms
gateway_invocation_log_write_duration_ms
```

역할 분리:

| 항목 | 목적 |
| --- | --- |
| Dashboard | 운영자가 제품 가치를 한눈에 본다 |
| Request Log | 요청 목록과 상태를 본다 |
| Request Detail | 요청 하나의 처리 이유를 설명한다 |
| Structured Log | 개발/운영자가 장애를 추적한다 |
| Metrics | 병목과 성능을 측정한다 |
| k6 | 성능 주장을 재현 가능한 수치로 만든다 |

## 10. 역할 분담 최종안

역할은 기술 레이어가 아니라 vertical slice 기준으로 나눈다.

| 담당 | Slice | 완료 기준 |
| --- | --- | --- |
| A | Control Plane & Runtime Config | 화면/API에서 만든 설정이 Gateway 판단에 실제로 쓰인다 |
| B | Gateway Runtime & Provider | 요청이 provider/mock path를 안정적으로 지나고 error/timeout이 일관되게 처리된다 |
| C | Governance | 인증, app token, rate decision이 요청 처리와 detail에 남는다 |
| D | Safety & Cost | redaction/block/cache/routing/cost 절감이 한 요청 흐름에서 보인다 |
| E | Observability & Demo | requestId 하나로 log/detail/dashboard/metrics/demo flow가 연결된다 |

각 slice는 자기 코드 영역만 끝내는 것이 아니라, 하루 끝에 보여줄 수 있는 제품 장면까지 책임져야 한다.

## 11. Day 0 Contract Freeze

Day 0에서 모든 것을 문서화하려고 하면 구현 시간이 사라진다. 아래만 짧고 명확하게 고정한다.

- Gateway context field
- Runtime config shape
- Rate Limit decision shape
- Invocation log field
- Dashboard overview field
- Metrics name
- Smoke expected scenario

최소 필드:

```text
requestId
tenantId
projectId
applicationId
apiKeyId
appTokenId
requestedModel
selectedProvider
selectedModel
routingReason
cacheStatus
cacheType
maskingAction
safetyDecision
rateLimitDecision
rateLimitRemaining
retryAfterSeconds
status
errorCode
costMicroUsd
latencyMs
providerLatencyMs
createdAt
```

이 필드들이 Gateway, Log, Detail, Dashboard, Metrics에서 다르게 불리면 마지막 통합 때 다시 무너진다.

## 12. Merge 단위 원칙

merge 단위는 짧아야 하지만, 의미 없는 skeleton PR만 쌓이면 안 된다.

최종 원칙:

- 하루에 담당자당 1~2개 PR을 목표로 한다.
- PR 하나는 스크럼에서 보여줄 수 있는 작동 결과를 가져야 한다.
- 파일 수 기준보다 outcome 기준으로 자른다.
- skeleton PR은 허용하되 같은 날 후속 behavior PR이 있어야 한다.
- 공통 contract 변경 PR은 작게 유지하고 feature PR과 섞지 않는다.
- mock, fixture, UI shell은 실제 통합 지점을 명시해야 한다.

좋은 PR:

- API Key 발급 후 Gateway 인증에 사용되는 fixture와 검증 흐름
- Rate Limit fixed window decision과 Request Detail 기록
- Cache miss -> hit demo와 provider call count 검증
- Dashboard cards가 실제 log API 값을 읽는 흐름
- k6 baseline script와 첫 측정 report

나쁜 PR:

- 폴더 구조만 생성
- mock만 있고 실제 연결 계획이 없는 UI
- Control Plane 전체 구현
- Observability 전체 구현
- 대규모 리팩토링과 기능 추가를 한 번에 처리

## 13. 4일 실행안

### Day 1. 계약과 메인 경로 동결

- v1 main path 확정
- fixture 기반 계약 고정
- Rate Limit scope/window/decision 확정
- Runtime config shape 확정
- Customer Demo App과 Web Console 역할 분리
- 실제 Provider 1개 연결 가능성 spike

### Day 2. 실제 요청 경로 연결

- 생성된 key/token을 Gateway 인증에 연결
- masking/cache/routing/provider/log를 실제 requestId로 연결
- applicationId 기준 Rate Limit fixed window 연결
- Dashboard와 Detail이 실제 로그를 읽도록 연결
- Customer Demo App에서 Gateway 호출 장면 구현

### Day 3. 제품 설득력 강화

- Request Detail polish
- Dashboard polish
- metrics endpoint
- k6 baseline
- 실제 Provider spike 결과 반영
- 실패/timeout/error response 정리
- fallback script 정리

### Day 4. 데모 동결

- main demo path freeze
- candidate / evidence path 분리
- 발표 순서와 역할 분담 고정
- 마지막 smoke와 k6 결과 고정
- v2 roadmap slide 근거 정리

## 14. 다수결용 최종 선택

다른 Codex 최종 의견과 비교할 수 있도록 내 선택을 명확히 적는다.

| 항목 | 내 선택 |
| --- | --- |
| 제품 정의 | B2B LLM Gateway |
| v1 기준 | 작지만 실제 운영 제품처럼 설명되는 baseline |
| v2 기준 | v1 병목을 근거로 한 성능·아키텍처 고도화 |
| Rate Limit scope | applicationId |
| Rate Limit storage | PostgreSQL baseline, Redis는 v2 비교 |
| 실제 Provider | v1 candidate 최우선, mock fallback 필수 |
| Metrics | v1 필수 |
| k6 | v1 필수 evidence |
| Streaming | v2 evidence path |
| Semantic Cache | v2 evidence path |
| Redpanda / ClickHouse | v2 evidence path |
| RAG / FAQ | GateLM 내부 기능 아님, 고객사 앱 확장 예시 |
| Web Console / Demo App | 반드시 분리 |
| Merge 단위 | 하루 담당자당 1~2개, 스크럼 결과물 기준 |

## 15. 최종 문장

내 최종 문장은 다음이다.

> v1.0.0은 고객사 업무 앱 요청 하나가 GateLM을 통과하면서 통제, 보안, 비용 절감, 관측, 성능 근거가 모두 설명되는 baseline이어야 한다. v2.0.0은 v1에서 측정한 병목을 근거로 Redis, ClickHouse, Redpanda, Semantic Cache 같은 고도화가 왜 필요한지 수치와 구조로 증명하는 단계여야 한다.
