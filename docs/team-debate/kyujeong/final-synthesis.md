# Kyujeong Final Synthesis

## 1. 최종 입장

Kyujeong의 최종 입장은 다음이다.

> GateLM v1.0.0은 "작게 만든 데모"가 아니라, 작지만 실제 운영 제품처럼 설명되는 B2B LLM Gateway baseline이어야 한다.

기능을 많이 넣는 것 자체가 목표는 아니다. 핵심은 고객사 업무 앱의 LLM 요청 하나가 GateLM을 통과하면서 아래 가치가 한 흐름으로 설명되는 것이다.

- 인증과 애플리케이션 식별
- 정책 판단
- 민감정보 보호
- 비용 절감
- 모델 라우팅
- 요청 로그와 상세 추적
- 대시보드 요약
- 성능 측정 근거

즉 v1의 성공 기준은 기능 개수가 아니라, **고객사 앱이 GateLM을 통과하면 무엇이 좋아지는지 납득되는가**다.

## 2. 제품 정의

GateLM은 LLM 앱, Chat UI, RAG 서비스가 아니다.

GateLM은 기업의 LLM 호출을 승인된 Gateway로 모으고, 그 위에서 보안, 비용, 정책, 로그를 중앙에서 관리하게 해주는 B2B LLM Gateway다.

발표 첫 메시지는 이렇게 잡는 것이 좋다.

```text
GateLM은 기업의 모든 LLM 요청을 승인된 Gateway로 통과시켜
보안, 비용, 정책, 로그를 중앙에서 관리하게 해주는 B2B LLM Gateway다.
```

OpenAI-compatible API는 제품의 핵심 가치가 아니라 도입 장벽을 낮추기 위한 ingress contract로 설명한다.

## 3. 현재 구현 기반에 대한 판단

현재 GateLM은 완전히 빈 상태가 아니다.

이미 다음 기반이 있다.

- Gateway 서버 기본 구조
- health / readiness 확인
- OpenAI-compatible Chat Completions 흐름
- 모델 목록 반환
- API Key와 App Token 기반 인증 흐름
- Tenant / Project / Application 맥락 연결
- Provider 호출 전 민감정보 redaction / block 흐름
- Exact Cache
- `model=auto` Simple Routing
- Mock Provider end-to-end 호출
- 성공, 차단, 인증 실패, 캐시 결과 로그
- Request Log, Request Detail, Dashboard Overview 조회
- PostgreSQL / Redis / Mock Provider 로컬 환경
- smoke script와 테스트 기반

따라서 지금의 질문은 "처음부터 뭘 만들까"가 아니다.

질문은 이것이다.

> 이미 있는 Gateway 기반을 남은 시간 동안 어떻게 제품처럼 보이게 만들 것인가?

## 4. 토론을 거치며 정리된 기준

round1부터 round5까지의 핵심 변화는 다음이다.

처음에는 실제 Provider, Web Console, Rate Limit, Budget, Streaming, Custom Regex, Semantic Cache, 분석 파이프라인을 모두 열어두고 비교했다.

토론이 진행되면서 기준은 더 선명해졌다.

```text
v1 main path:
  발표 중 반드시 성공해야 하는 제품 흐름

v1 candidate:
  성공하면 제품 설득력이 크게 올라가지만 fallback이 필요한 기능

v2 evidence path:
  v1 metrics와 병목 근거를 바탕으로 확장성을 증명할 기능
```

이 분류는 기능을 포기하기 위한 것이 아니다.

남은 4일을 공격적으로 쓰되, 메인 데모 경로가 흔들리지 않게 하기 위한 기준이다.

## 5. v1 Main Path

v1에서 반드시 성공해야 하는 흐름은 아래다.

```text
관리자가 Project / Application / API Key / App Token / Provider 설정을 준비한다
-> 고객사 demo app이 GateLM Gateway로 요청한다
-> Gateway가 API Key와 App Token을 검증한다
-> applicationId 기준 Rate Limit decision을 수행한다
-> 민감정보를 redaction하거나 위험 정보를 block한다
-> 안전한 동일 요청은 Exact Cache로 Provider 호출을 건너뛴다
-> model=auto 요청은 selectedModel과 routingReason을 남긴다
-> Mock Provider 또는 실제 Provider가 응답한다
-> requestId로 Log, Detail, Dashboard, Metrics까지 추적한다
-> k6 baseline으로 현재 성능과 다음 개선 방향을 설명한다
```

이 흐름이 안정적으로 동작하면 v1은 충분히 제품처럼 보인다.

## 6. v1 Main Scope

v1 main path에 포함할 항목은 다음이다.

| 영역 | 포함할 내용 |
|---|---|
| Product Message | B2B LLM Gateway 정의 |
| Control Plane | Project, Application, API Key, App Token, Provider 최소 설정 |
| Runtime Config | 관리자가 만든 설정이 Gateway 판단에 실제 반영 |
| Gateway | text-only request, requestId, timeout/error response |
| Authentication | API Key 인증, App Token 검증 |
| Context | tenantId, projectId, applicationId 연결 |
| Governance | applicationId 기준 PostgreSQL-backed Rate Limit |
| Safety | email/phone redaction, API Key/JWT/RRN/private key 계열 block |
| Cost Control | Exact Cache miss -> hit, Provider bypass |
| Routing | `model=auto`, selectedProvider, selectedModel, routingReason |
| Provider | Mock Provider path 안정화 |
| Observability | Request Log, Request Detail, Dashboard Overview |
| Metrics | request, latency, provider latency, cache, block, rate limit, log write duration |
| Evidence | smoke script, k6 baseline report, demo checklist |
| Demo | Customer Demo App과 Web Console 분리 |

## 7. v1 Candidate

다음은 v1에서 적극적으로 시도하되, 실패해도 main path가 살아 있어야 하는 후보들이다.

| 항목 | 판단 |
|---|---|
| 실제 Provider 1개 | 메인 후보 1순위. 단, Mock fallback 필수 |
| Budget Hard Block | Rate Limit 이후 붙이면 강한 메시지. 최소 데모 후보 |
| JSON structured log polish | 구현 부담 대비 운영성 메시지가 좋음 |
| Dashboard trend 일부 | 시간이 남으면 좋지만 숫자 카드 우선 |
| Provider timeout/fallback 시나리오 | 실제 Provider와 함께 보여주면 신뢰도 상승 |

실제 Provider는 가능하면 붙이는 쪽이 좋다.

하지만 조건이 있다.

- Mock Provider fallback이 항상 살아 있어야 한다.
- 실제 Provider 실패가 발표 실패가 되면 안 된다.
- Provider Key 원문은 DB, 로그, 화면, fixture에 남지 않아야 한다.
- 실제 Provider 응답도 raw response 저장 없이 summary/metadata만 남겨야 한다.

## 8. v2 Evidence Path

다음은 v1 main path가 아니라 v2에서 확장성 증거로 보여줄 항목이다.

| v1 Baseline | v2 Evidence | 보여줄 근거 |
|---|---|---|
| PostgreSQL Rate Limit | Redis Rate Limit | p95 latency, DB query latency, contention 감소 |
| PostgreSQL Log Query | ClickHouse Analytics | 대량 synthetic log query 시간 |
| Direct Log Writer | Redpanda Event Pipeline | response path와 analytics path 분리 |
| Exact Cache | Semantic Cache 실험 | safe-hit 기준, false positive 위험, 평가셋 |
| 숫자 카드 Dashboard | 시계열 Dashboard | 비용, latency, cache, rate limit trend |
| Non-stream response | Streaming | Gateway hot path와 logging trade-off |
| Active Config 최소 반영 | Runtime Policy Editor | 운영자가 정책을 수정하는 흐름 |
| 기본 detector | Custom Regex Rule UI | 고객사별 민감정보 규칙 확장 |

v2는 "기능을 더 붙인 버전"이 아니다.

v2는 v1에서 측정한 병목을 근거로, GateLM이 대규모 운영 제품으로 확장될 수 있음을 수치와 구조로 증명하는 단계다.

## 9. 제외 또는 후순위로 둘 것

다음은 v1 main path에서 제외한다.

- RAG / FAQ chatbot
- Semantic Cache
- Redis-backed Rate Limit
- ClickHouse / Redpanda 실연동
- Runtime Policy Editor
- Custom Regex Rule UI
- SSE Streaming
- Self-hosted installer
- 복잡한 사용자 초대 / 권한 관리

이 기능들은 버리는 것이 아니다.

v1에서 제품 흐름을 안정화한 뒤, v2에서 확장성 증거 또는 고도화 기능으로 다루는 것이 좋다.

특히 RAG는 GateLM 내부 기능으로 넣지 않는다.

좋은 설명은 다음이다.

```text
고객사 앱이 RAG를 수행한다.
그 앱의 LLM 호출은 GateLM Gateway를 통과한다.
GateLM은 그 호출의 보안, 비용, 정책, 로그를 통제한다.
```

## 10. Rate Limit 합의안

Rate Limit은 v1에서 PostgreSQL-backed fixed window로 시작하는 데 동의한다.

단, 범위는 좁혀야 한다.

```text
scope: applicationId
algorithm: fixed window
window: 60초
decision: allowed, remaining, retryAfterSeconds, reason
storage: PostgreSQL
interface: RateLimiter
evidence: k6로 p95 latency와 DB query latency 측정
```

`applicationId`를 기본 scope로 잡는 이유는 다음이다.

- App Token이 Application 단위라 설명이 자연스럽다.
- 고객사 업무 앱별 사용량 통제라는 메시지가 명확하다.
- project 단위보다 데모에서 "이 앱이 제한됐다"라고 보여주기 쉽다.
- apiKey 단위보다 관리자가 이해하기 쉽다.

단, Request Detail에는 `applicationId`뿐 아니라 `projectId`, `apiKeyId`도 같이 보여야 한다.

## 11. Observability 합의안

Dashboard, Request Detail, Metrics, k6는 역할이 다르다.

| 항목 | 목적 |
|---|---|
| Dashboard | 운영자가 제품 가치를 한눈에 본다 |
| Request Log | 요청 목록과 상태를 본다 |
| Request Detail | 요청 하나의 처리 이유를 설명한다 |
| Structured Log | 개발/운영자가 장애를 추적한다 |
| Metrics | 병목과 성능을 측정한다 |
| k6 | 성능 주장을 재현 가능한 수치로 만든다 |

Dashboard가 모든 metrics를 보여줄 필요는 없다.

발표에서는 Dashboard로 제품 가치를 보여주고, metrics/k6는 기술적 근거로 보여주면 된다.

v1에서 최소로 남길 metrics는 다음이다.

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

## 12. Control Plane 합의안

Control Plane은 CRUD 수가 중요한 것이 아니다.

중요한 것은 관리자가 만든 설정이 실제 Gateway 요청 판단에 반영되는 것이다.

반드시 보여줘야 하는 장면은 다음이다.

```text
관리자가 설정을 만든다
-> Gateway가 그 설정을 읽는다
-> 다음 요청의 인증/라우팅/rate limit/log에 반영된다
```

이 장면이 없으면 Control Plane은 제품이 아니라 seed 편집기처럼 보일 수 있다.

## 13. Demo 구조

Web Console과 Customer Demo App은 분리한다.

```text
Web Console:
  관리자 화면
  프로젝트/앱/키/로그/대시보드 확인

Customer Demo App:
  고객사 앱 역할
  GateLM Gateway 호출
```

이 둘이 섞이면 GateLM이 Chat UI 서비스처럼 오해될 수 있다.

GateLM은 Chat UI가 아니라 Gateway다.

## 14. 역할 재배치

다음 작업은 기술 레이어가 아니라 vertical slice 기준으로 나누는 것이 좋다.

| 담당 | Slice | 완료 기준 |
|---|---|---|
| A | Control Plane & Runtime Config | 화면/API에서 만든 설정이 Gateway 판단에 실제로 쓰인다 |
| B | Gateway Runtime & Provider | 요청이 provider/mock path를 안정적으로 지나고 error/timeout이 일관되게 처리된다 |
| C | Governance | 인증, app token, rate decision이 요청 처리와 detail에 남는다 |
| D | Safety & Cost | redaction/block/cache/routing/cost 절감이 한 요청 흐름에서 보인다 |
| E | Observability & Demo | requestId 하나로 log/detail/dashboard/metrics/demo flow가 연결된다 |

각 slice는 자기 영역의 코드만 끝내는 것이 아니라, 하루 끝에 보여줄 수 있는 제품 장면까지 책임져야 한다.

## 15. Day 0 Contract Freeze

Day 0에서 너무 많은 계약을 잡으려 하면 문서 회의로 끝날 수 있다.

반드시 고정할 것은 아래 정도면 충분하다.

- Gateway context field
- Runtime config shape
- Rate Limit decision shape
- Invocation log field
- Dashboard overview field
- Smoke expected scenario

세부 필드는 최소한 다음을 맞춘다.

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

## 16. 남은 4일 실행안

### Day 1. 계약과 메인 데모 경로 동결

- v1 main path 확정
- fixture 기반 계약 고정
- Rate Limit scope/window/decision 확정
- Control Plane이 Gateway에 넘길 runtime config shape 확정
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

## 17. 최종 우선순위

Kyujeong 기준 v1 우선순위는 다음이다.

```text
1. Customer Demo App
2. applicationId Rate Limit
3. metrics + k6 baseline
4. Request Detail / Dashboard polish
5. actual Provider 1개
```

이 다섯 개가 붙으면 v1은 충분히 강해진다.

## 18. 지금 바로 결정할 것

토론은 충분히 수렴했다.

이제 방향성이 아니라 구체 결정을 해야 한다.

1. 실제 Provider를 v1 main path 1순위 후보로 둘 것인가?
2. Rate Limit scope를 `applicationId`로 확정할 것인가?
3. Control Plane 설정 반영 방식은 DB direct read인가 active config snapshot인가?
4. Day 0 contract freeze owner는 누구인가?
5. v1 smoke script의 단일 성공 명령은 무엇인가?
6. k6 baseline report owner는 누구인가?
7. Customer Demo App은 누가 담당하는가?
8. Dashboard는 v1에서 숫자 카드 중심으로 갈 것인가?
9. Budget Hard Block은 v1 candidate로 둘 것인가?
10. 실제 Provider 실패 시 fallback demo 경로는 무엇인가?

## 19. 최종 문장

Kyujeong의 최종 문장은 이것이다.

> v1은 "작게 만든 버전"이 아니라 "작지만 실제 운영 제품처럼 설명되는 버전"이어야 하고, v2는 "기능을 더 붙인 버전"이 아니라 "v1에서 측정한 병목을 근거로 확장성을 증명하는 버전"이어야 한다.

이 기준이면 남은 4일을 꽤 공격적으로 쓸 수 있다.
