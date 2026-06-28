# Round 2 비교 정리 - hyeok

## 0. Round 1 기준

Round 1에서는 GateLM의 방향을 다음처럼 정리했다.

- GateLM은 B2B LLM Gateway다.
- v1.0.0은 단순 P0가 아니라 "확장 P0" 수준까지 올려야 한다.
- 핵심 흐름은 온보딩, 키 발급, Gateway 인증, 마스킹/차단, Exact Cache, Simple Routing, Provider 호출, 로그/상세/대시보드까지 이어져야 한다.
- 실제 Provider 1개, Rate Limit, Budget Hard Block, 시계열 대시보드, Runtime Policy 최소 구현, 실시간 응답, Semantic Cache Lite 등은 가능한 한 v1.0.0 후보로 잡았다.
- Redpanda, ClickHouse, Semantic Cache 고도화, Self-hosted/Hybrid 설치는 v1 이후 확장 또는 PoC 성격으로 분리했다.

Round 1의 문제는 "많이 넣자"는 방향은 좋지만, 메인 데모 흐름과 확장 기능의 우선순위가 아직 섞여 있었다는 점이다.

## 1. 새로 비교한 문서

| 문서 | 핵심 관점 |
| --- | --- |
| `kyujeong/round-1-response.md` | Round 1 방향에는 동의하지만, 메인 데모와 확장 증거를 분리해야 한다고 지적 |
| `kyujeong/round-2-v1-baseline-response.md` | Jiseob의 v1 baseline을 기준으로 제품 흐름을 더 명확히 정리 |
| `kyujeong/round-3-jiseob-baseline-decision.md` | v1 baseline 정의, Rate Limit 범위, 계약 freeze 항목을 구체화 |
| `kyujeong/round-4-v1-v2-roadmap-response.md` | v1은 제품 흐름, v2는 병목 증명과 확장으로 나누자는 방향에 동의 |
| `jiseob/v1-baseline-proposal.md` | v1의 제품 정의와 역할 분리를 가장 명확하게 제안 |
| `jiseob/v1-v2-roadmap-synthesis.md` | v1/v2 로드맵을 분리하고, v1에서 증명해야 할 최소 운영 지표를 정리 |
| `kyumin/framework-selection.md` | 기술 스택과 내부 경계, 인터페이스 중심 설계 방향을 정리 |
| `yoonji/expanded-p0-parallel-implementation-plan.md` | 5명 병렬 구현을 위한 확장 P0 실행 계획을 정리 |

## 2. Round 1 대비 달라진 핵심

### 2.1 v1.0.0은 "많은 기능"보다 "하나의 제품 흐름"이 먼저다

Round 1에서는 기능을 많이 넣는 쪽에 무게가 있었다.  
새 문서들을 비교해보면 v1.0.0의 핵심은 다음 한 줄 흐름을 끊기지 않게 만드는 것이다.

관리자가 프로젝트/앱/키/정책을 준비하고, 고객사 업무 앱의 LLM 요청이 GateLM을 통과하며, 인증/정책/보안/캐시/라우팅/Provider 호출/로그/대시보드/지표까지 추적되는 상태.

즉, v1.0.0은 "기능 목록"이 아니라 "기업이 실제로 쓸 수 있는 LLM Gateway의 기본 사용 흐름"이 되어야 한다.

### 2.2 v1과 v2를 더 명확히 나눠야 한다

Round 1에서는 Semantic Cache, Redpanda, ClickHouse, Streaming, Runtime Policy Editor까지 v1 후보로 넓게 잡았다.  
새 문서들의 공통 의견은 다음에 가깝다.

- v1: 제품이 실제로 동작하는 기본 Gateway 흐름 완성
- v2: 병목을 측정한 뒤 Redis, Redpanda, ClickHouse, Semantic Cache, Streaming 등으로 확장

따라서 v1에서 너무 많은 고급 기능을 억지로 넣기보다, v1에서 측정 가능한 구조를 만들고 v2에서 확장 근거를 보여주는 편이 더 설득력 있다.

### 2.3 Rate Limit은 v1에 넣되, PostgreSQL 기반으로 시작한다

Round 1에서는 Rate Limit을 넣을지 말지의 위치가 애매했다.  
새 문서들은 대체로 v1에 Rate Limit을 넣는 쪽으로 정리된다.

다만 처음부터 Redis Cluster나 복잡한 분산 알고리즘으로 가지 않는다.

- v1 기준: PostgreSQL-backed Fixed Window Rate Limit
- 기준 scope: `applicationId`
- 판단 결과: allowed, remaining, retryAfterSeconds, reason
- 목적: 완벽한 분산 Rate Limit이 아니라, Gateway가 사용량을 사전에 통제한다는 제품 가치를 보여주는 것
- v2 확장: k6 테스트로 병목을 확인한 뒤 Redis 기반 Rate Limit로 교체

### 2.4 Observability는 데모 옵션이 아니라 v1의 증거다

Round 1에서는 로그/대시보드 중심이었다.  
새 문서에서는 대시보드와 시스템 지표를 분리하자는 의견이 강하다.

v1에서 필요한 최소 증거는 다음이다.

- Request Log
- Request Detail
- Dashboard Summary
- JSON structured log
- Prometheus-style metrics endpoint 또는 최소 metrics endpoint
- k6 baseline 테스트

이 지표가 있어야 "대규모 트래픽 처리", "병목 측정", "v2 확장 근거"를 말할 수 있다.

### 2.5 Control Plane은 화면만 있으면 안 되고 Gateway 런타임에 영향을 줘야 한다

Round 1의 온보딩/키 발급 흐름은 필요하지만, 새 문서들은 더 중요한 조건을 제시한다.

Control Plane에서 만든 Project, Application, API Key, App Token, Provider 설정, 정책이 Gateway의 실제 요청 처리에 반영되어야 한다.

즉, 관리자 화면에서 생성한 설정이 DB에만 저장되고 Gateway가 여전히 더미 설정을 쓰면 v1 제품 흐름이 깨진다.

## 3. 문서별 판단

### 3.1 Kyujeong 문서들

Kyujeong 문서들은 Round 1의 방향을 유지하되, 발표와 구현의 설득력을 높이기 위해 범위를 정리한다.

좋은 점:

- 메인 데모 흐름과 확장 기능을 분리한다.
- 실제 Provider는 가능하면 v1 메인 후보로 두되, Mock fallback을 유지하자는 판단이 현실적이다.
- Streaming과 Semantic Cache를 v1 핵심에서 빼고, 성공하면 보조 데모로 두자는 의견이 안정적이다.
- Rate Limit scope를 `applicationId`로 잡는 의견이 고객사 앱 단위 통제와 잘 맞는다.
- v1에서 metrics와 k6를 반드시 남기자는 방향이 코치 피드백 대응에 좋다.

내 판단:

Kyujeong 문서들은 "우리가 많이 만들었다"보다 "왜 이 기능이 기업용 Gateway에 필요한가"를 설명하는 데 도움이 된다.  
특히 v1/v2 분리와 Rate Limit scope 정리는 팀 기준으로 채택하는 것이 좋다.

### 3.2 Jiseob 문서들

Jiseob 문서들은 v1 baseline 정의가 가장 명확하다.

좋은 점:

- GateLM을 prompt console이 아니라 B2B LLM Gateway로 명확히 정의한다.
- v1에서 필요한 기능을 Gateway 제품 흐름 중심으로 재정리한다.
- RAG, Semantic Cache, Redis Rate Limit, ClickHouse, Redpanda, Runtime Policy Editor를 v1 핵심에서 제외해 범위를 안정화한다.
- 역할을 A~E로 수평 레이어가 아니라 vertical slice에 가깝게 나누려는 방향이 좋다.
- 계약 freeze 항목을 작게 잡아 병렬 개발의 충돌을 줄이려 한다.

내 판단:

Jiseob 문서는 v1 기준 문서로 삼을 만하다.  
다만 너무 보수적으로 가면 "기술적 난이도가 작아 보인다"는 코치 피드백을 다시 받을 수 있으므로, v1에는 최소한 Rate Limit, metrics, k6, 실제 Provider 1개 후보 정도는 포함하는 편이 좋다.

### 3.3 Kyumin 문서

Kyumin 문서는 기술 스택과 내부 경계가 강점이다.

좋은 점:

- Go Gateway를 복잡한 프레임워크보다 표준 라이브러리와 명확한 인터페이스로 가져가려는 방향이 좋다.
- ProviderRegistry, CacheStore, RoutingStrategy, SecretResolver, EventWriter 같은 내부 경계가 나중에 확장하기 좋다.
- Redpanda, ClickHouse, FastAPI AI service를 처음부터 핵심 경로에 넣지 않고 확장 가능성으로 두는 판단이 현실적이다.

내 판단:

Kyumin 문서는 구현 스타일 기준으로 참고하는 것이 좋다.  
특히 v1에서 모든 기술을 다 연결하려 하기보다, 인터페이스를 먼저 고정하고 확장 스택은 뒤에서 붙이는 방식이 안정적이다.

### 3.4 Yoonji 문서

Yoonji 문서는 병렬 구현 계획에 강점이 있다.

좋은 점:

- A~E가 동시에 움직일 수 있도록 역할을 나누려는 방향이 좋다.
- Mock, fixture, stub을 활용해 의존성 때문에 멈추는 일을 줄이려 한다.
- 머지 단위와 테스트 기준을 두어 실제 협업에서 필요한 흐름을 고려한다.

내 판단:

Yoonji 문서는 실행 계획에 반영하는 것이 좋다.  
다만 이전 P0에서 경험했듯이, A가 문서를 먼저 뿌리고 나머지가 기다리는 구조는 병렬성이 떨어진다.  
이번에는 Day 0에 계약 문서를 먼저 확정하고, A~E가 같은 계약을 기준으로 동시에 구현해야 한다.

## 4. Round 2 수정 제안

### 4.1 v1.0.0 메인 흐름

v1.0.0의 메인 데모는 다음 흐름으로 고정하는 것이 좋다.

1. 관리자가 Tenant, Project, Application을 생성한다.
2. 관리자가 Provider 설정과 사용 가능한 모델을 등록한다.
3. 관리자가 Gateway API Key와 App Token을 발급한다.
4. 고객사 업무 앱이 OpenAI-compatible API 형태로 GateLM에 요청을 보낸다.
5. Gateway가 API Key와 App Token을 검증한다.
6. Gateway가 `applicationId` 기준 Rate Limit을 검사한다.
7. Gateway가 위험 정보는 차단하고 개인정보는 마스킹한다.
8. Gateway가 Exact Cache를 조회한다.
9. `model=auto`인 경우 Simple Routing으로 모델을 선택한다.
10. Mock Provider 또는 실제 Provider 1개로 요청을 전달한다.
11. Gateway가 응답을 반환한다.
12. Request Log, Request Detail, Dashboard, Metrics에서 요청 결과를 확인한다.
13. k6 baseline으로 최소 부하 테스트 결과를 제시한다.

이 흐름이 완성되면 "GateLM을 거치면 기업이 LLM 요청을 중앙에서 통제하고 추적할 수 있다"는 메시지가 명확해진다.

### 4.2 v1.0.0 필수 범위

| 영역 | v1 필수 기준 |
| --- | --- |
| Control Plane | Tenant, Project, Application, API Key, App Token 생성 |
| Runtime Config | Control Plane 설정이 Gateway 요청 처리에 실제 반영 |
| Gateway API | OpenAI-compatible `/v1/chat/completions`, `/v1/models` |
| 인증 | API Key + App Token 검증, scope mismatch 차단 |
| Rate Limit | PostgreSQL-backed Fixed Window, `applicationId` 기준 |
| 보안 | PII 마스킹, 위험 정보 차단 |
| 비용 절감 | Exact Cache, Provider 호출 생략 |
| 라우팅 | `model=auto` Simple Routing |
| Provider | Mock Provider 기본, 실제 Provider 1개는 가능하면 포함 |
| 로그 | Request Log, Request Detail |
| 대시보드 | 요청 수, 비용, 토큰, latency, cache, masking/block, routing 요약 |
| 지표 | JSON structured log, metrics endpoint, k6 baseline |
| 데모 | 고객사 업무 앱이 GateLM을 통해 요청하는 시나리오 |

### 4.3 v1.0.0 후보 기능

아래 기능은 v1에 넣으면 좋지만, 메인 흐름을 깨면서까지 넣을 필요는 없다.

- 실제 Provider 1개 연결
- Budget Hard Block
- 시계열 차트
- Text-only Chat UI
- Runtime Policy 최소 조회/적용
- Custom Regex Rule 최소 등록

### 4.4 v2 확장 범위

아래 기능은 v1 이후 확장 또는 기술 챌린지 증명 범위로 두는 것이 좋다.

- Redis 기반 Rate Limit
- Redpanda 비동기 이벤트 파이프라인
- ClickHouse 대용량 로그 분석
- Semantic Cache
- Streaming 응답
- Runtime Policy Editor 고도화
- 사용자 초대/권한 관리
- Self-hosted/Hybrid 설치 자동화
- 대용량 로그 분석 최적화

중요한 점은 v2 기능을 "나중에 할 것"으로만 말하지 않는 것이다.  
v1에서 metrics와 k6를 남겨 병목을 측정하고, 그 결과를 근거로 v2에서 Redis, Redpanda, ClickHouse를 붙인다고 설명해야 한다.

## 5. v1 병렬 개발 역할 재정리

### A. Control Plane & Runtime Config

- Tenant, Project, Application, API Key, App Token 생성 API 구현
- Provider/Model 설정 저장
- Gateway가 읽을 수 있는 active runtime config 제공
- 생성된 설정이 Gateway 동작에 반영되는지 smoke test 제공

### B. Gateway Runtime & Provider

- OpenAI-compatible 요청 처리
- Provider adapter 구조 구현
- Mock Provider 유지
- 실제 Provider 1개 연결 후보 구현
- requestId, error format, timeout, provider latency 기록

### C. Governance

- API Key 인증
- App Token 검증
- tenant/project/application scope mismatch 차단
- PostgreSQL-backed Fixed Window Rate Limit 구현
- 401, 403, 429 응답 계약 고정

### D. Safety & Cost

- PII 마스킹
- 위험 정보 차단
- Exact Cache
- Simple Routing
- token/cost 계산
- cache hit 시 Provider 호출 생략 검증

### E. Observability & Demo

- Request Log 목록/상세
- Dashboard Summary
- metrics endpoint
- JSON structured log 확인
- k6 baseline
- 고객사 업무 앱 데모 화면 또는 데모 스크립트

이 역할 분리는 완전히 독립적이지는 않다.  
하지만 Day 0 계약만 먼저 고정하면 각자 stub/mock을 두고 동시에 시작할 수 있다.

## 6. Day 0에 반드시 고정할 계약

병렬 개발을 위해 아래 계약은 구현 시작 전에 고정해야 한다.

### 6.1 Gateway Context

- `requestId`
- `tenantId`
- `projectId`
- `applicationId`
- `apiKeyId`
- `appTokenId`
- `endUserId`
- `featureId`

### 6.2 Runtime Config

- tenant
- project
- application
- enabled providers
- enabled models
- default model
- cheap model
- high quality model
- fallback model
- rate limit config
- masking config
- cache config
- routing config

### 6.3 Rate Limit Decision

- `allowed`
- `scope`
- `limit`
- `remaining`
- `resetAt`
- `retryAfterSeconds`
- `reason`

### 6.4 Safety Decision

- `action`
- `masked`
- `blocked`
- `detectedTypes`
- `redactedPromptPreview`
- `blockReason`

### 6.5 Cache/Routing Result

- `cacheStatus`
- `cacheType`
- `cacheKey`
- `requestedModel`
- `selectedProvider`
- `selectedModel`
- `routingType`
- `routingReason`

### 6.6 Invocation Log

- `requestId`
- `tenantId`
- `projectId`
- `applicationId`
- `endUserId`
- `featureId`
- `requestedModel`
- `selectedProvider`
- `selectedModel`
- `cacheStatus`
- `maskingAction`
- `rateLimitDecision`
- `status`
- `errorCode`
- `promptTokens`
- `completionTokens`
- `totalTokens`
- `estimatedCostUsd`
- `latencyMs`
- `providerLatencyMs`
- `createdAt`

### 6.7 Dashboard Summary

- totalRequests
- successRequests
- blockedRequests
- rateLimitedRequests
- totalTokens
- totalCostUsd
- averageLatencyMs
- cacheHitRate
- maskingCount
- routingCountByModel

## 7. 최종 판단

Round 2 기준으로는 Jiseob의 v1 baseline을 중심축으로 삼고, Kyujeong의 v1/v2 분리와 Rate Limit/metrics 기준을 반영하는 것이 가장 좋아 보인다.

Round 1의 장점은 공격적인 확장 의지였고, 새 문서들의 장점은 제품 흐름과 검증 기준을 선명하게 만든 점이다.

따라서 최종 방향은 다음이 좋다.

1. v1.0.0은 B2B LLM Gateway의 end-to-end 제품 흐름을 완성한다.
2. v1.0.0에서 Rate Limit, metrics, k6 baseline까지 포함해 "운영형 Gateway"라는 증거를 만든다.
3. 실제 Provider 1개는 가능하면 넣되, Mock Provider fallback을 반드시 유지한다.
4. Semantic Cache, Redpanda, ClickHouse, Streaming은 v2 확장으로 두되, v1의 측정 결과를 근거로 연결한다.
5. Day 0 계약을 작게 고정하고, A~E가 같은 계약을 기준으로 동시에 구현한다.

결론적으로 GateLM v1.0.0은 "많은 기능을 나열한 데모"가 아니라, "기업의 LLM 요청이 반드시 GateLM을 지나가며 통제, 보안, 비용 절감, 추적이 되는 하나의 운영 흐름"으로 보여줘야 한다.
