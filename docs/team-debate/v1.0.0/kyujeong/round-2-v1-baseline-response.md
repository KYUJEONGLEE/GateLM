# Kyujeong Round 2 Response - v1 Baseline Proposal

## 먼저 결론

`v1-baseline-proposal.md`의 큰 방향에는 동의한다.

특히 좋은 점은 세 가지다.

- GateLM을 "개발자 편의 proxy"가 아니라 "기업의 LLM 사용 경로를 중앙 통제하는 B2B Gateway"로 다시 정의한 점
- 역할을 A/B/C/D/E 레이어 단위가 아니라 제품 가치 단위 vertical slice로 재배치한 점
- Dashboard만이 아니라 metrics, k6, structured log까지 포함해 "운영 제품처럼 보이는 근거"를 만들자는 점

다만 이 제안이 실행되려면 몇 가지를 더 명확히 해야 한다. 내가 보기에는 핵심 쟁점은 기능 목록이 아니라, **메인 데모 경로와 측정/실험 경로를 어떻게 분리하느냐**다.

## 동의하는 부분

### 1. 제품 정의는 B2B LLM Gateway가 맞다

GateLM의 첫 문장은 이제 명확해야 한다.

> 기업의 LLM 호출을 승인된 Gateway로 모으고, 그 위에서 보안, 비용, 정책, 로그를 통제한다.

이 메시지가 잡히면 Chat UI, RAG, Provider SDK wrapper 같은 기능은 중심이 아니라 주변이 된다. 고객사 앱은 "GateLM 제품"이 아니라 GateLM을 통과하는 사용 사례로 보여주는 것이 맞다.

### 2. 기존 역할 분담 문제 진단에 동의한다

이전 방식은 A/B/C/D/E가 서로 다른 레이어를 맡는 듯했지만, 실제로는 같은 Gateway 요청 경로의 context, metadata, log field를 동시에 만졌다.

그 결과 Observability는 upstream metadata가 안정되기 전까지 기다려야 했고, Gateway 담당은 로그와 대시보드가 원하는 필드까지 신경 써야 했다.

다음 작업부터 vertical slice로 나누자는 제안은 맞다.

예를 들면:

- Governance 담당은 API Key/App Token만 보는 것이 아니라, 실제 요청에서 인증/권한/rate decision이 로그와 상세 화면에 남는 것까지 본다.
- Safety & Cost 담당은 masking/cache/routing이 각각 따로 도는 것이 아니라, 한 요청에서 비용 절감과 보안 판단이 같이 설명되는지 본다.
- Observability & Demo 담당은 예쁜 화면만이 아니라, requestId로 실제 요청을 끝까지 추적할 수 있는지 본다.

### 3. 실행 가능한 계약을 먼저 고정하자는 데 동의한다

문서 계약만으로는 부족하다. 지금부터 필요한 계약은 깨지면 바로 드러나야 한다.

내가 생각하는 최소 실행 계약은 이 정도다.

- Gateway request/response fixture
- Error response fixture
- Gateway context sample JSON
- Invocation log sample JSON
- Dashboard overview sample JSON
- Rate limit decision sample JSON
- Smoke script expected output

OpenAPI나 schema를 완벽하게 만들 시간이 부족하면, 적어도 fixture와 smoke로 깨지는 지점이 보여야 한다.

## 더 토론해야 하는 부분

### 1. "새 P0"라는 이름보다 "v1 baseline demo path"가 더 중요하다

공용 제안은 새 P0를 v1.0.0 baseline demo 가능 상태로 재정의한다.

나는 이 방향에 동의하지만, 이름보다 중요한 것은 **발표 중 반드시 성공해야 하는 한 줄 경로**다.

내가 생각하는 한 줄 경로는 다음이다.

```text
관리자가 프로젝트/앱/키/정책을 준비한다
-> 고객사 업무 앱이 Gateway로 요청한다
-> GateLM이 인증, 정책, 보안, 캐시, 라우팅을 적용한다
-> Provider 응답 또는 차단 결과를 반환한다
-> requestId로 Log, Detail, Dashboard, Metrics까지 추적한다
```

이 경로가 v1 baseline의 중심이어야 한다.

그 밖의 기능은 이 경로를 강하게 만들면 포함하고, 경로를 흔들면 보조 시나리오로 둔다.

### 2. PostgreSQL-backed Rate Limit은 좋은 실험이지만 기준을 좁혀야 한다

공용 제안은 Redis가 아니라 PostgreSQL-backed Rate Limit을 먼저 구현하고, 병목을 측정한 뒤 Redis 도입 근거를 만들자고 한다.

이 논리는 좋다. 특히 "무작정 Redis를 쓰자"가 아니라 정확성과 측정 근거를 먼저 만들자는 점은 설득력 있다.

다만 주의할 점이 있다.

- Rate Limit은 모든 요청의 hot path에 들어간다.
- PostgreSQL check-and-increment가 느려지면 Gateway 전체 latency가 흔들릴 수 있다.
- 트랜잭션/락/connection pool 문제가 데모 안정성을 깨뜨릴 수 있다.

그래서 나는 아래 조건을 붙이고 싶다.

```text
RateLimiter interface는 먼저 둔다.
v1 baseline adapter는 PostgreSQL fixed window로 시작한다.
scope는 project 또는 apiKey 중 하나로 단순화한다.
window는 1분 fixed window 하나로 제한한다.
decision에는 allowed, remaining, retryAfter, reason만 둔다.
k6로 병목을 측정한다.
데모 중 위험하면 rate limit scenario는 별도 보조 경로로 뺄 수 있게 한다.
```

즉, PostgreSQL Rate Limit 자체에는 찬성하지만, "운영급 rate limit"처럼 넓히면 안 된다. 지금 필요한 것은 비용 폭주 방지 메시지를 보여주는 최소 정확한 decision이다.

### 3. Observability 범위는 좋지만 Dashboard와 Metrics의 역할을 분리해야 한다

공용 제안은 Request Log, Detail, Dashboard, JSON structured log, Prometheus metrics, k6 baseline까지 포함한다.

나는 이 범위가 v1 설득력에 매우 좋다고 본다. 다만 역할이 섞이면 구현이 무거워진다.

분리는 이렇게 하면 좋겠다.

- Request Log: 운영자가 요청 목록을 보는 곳
- Request Detail: requestId 하나의 처리 이유를 보는 곳
- Dashboard: 제품 메시지를 보여주는 요약 화면
- Structured Log: 개발/운영자가 장애를 추적하는 증거
- Metrics: 병목과 성능을 측정하는 증거
- k6: 우리가 주장하는 성능을 재현하는 도구

Dashboard가 metrics 전체를 다 보여줄 필요는 없다. 발표에서는 Dashboard로 제품 가치를 보여주고, k6/metrics는 "우리가 측정하고 있다"는 근거로 보여주면 충분하다.

### 4. Control Plane은 CRUD 전체보다 "Gateway가 읽는 설정"까지 이어져야 한다

공용 제안의 Control Plane 범위에는 Tenant, Project, Application, Provider, Model, API Key, App Token 생성/조회/폐기가 들어간다.

여기서 중요한 것은 화면이나 API 수가 아니라, 생성된 설정이 실제 Gateway 요청에 반영되는 것이다.

예를 들어:

- 키를 발급했는데 Gateway는 여전히 `.env` static key만 보면 제품처럼 보이지 않는다.
- Provider/Model을 등록했는데 routing/catalog에 연결되지 않으면 관리 기능처럼 보이지 않는다.
- 정책을 설정했는데 rate limit, masking, cache, routing decision에 반영되지 않으면 데모 메시지가 약하다.

그래서 Control Plane의 완료 기준은 "생성 API가 있다"가 아니라 "Gateway가 그 설정을 읽어 실제 요청 판단에 쓴다"여야 한다.

### 5. RAG 제외에는 강하게 동의한다

RAG는 데모로 보기 좋지만 GateLM의 핵심은 아니다.

오히려 RAG를 넣으면 청중이 "문서 검색 챗봇을 만든 건가?"라고 오해할 수 있다.

좋은 확장 설명은 이쪽이다.

```text
고객사 앱이 RAG를 수행한다.
그 앱이 LLM을 호출할 때 GateLM Gateway를 통과한다.
GateLM은 그 호출의 보안, 비용, 정책, 로그를 통제한다.
```

즉, RAG는 GateLM 내부 기능이 아니라 GateLM을 사용하는 고객사 앱의 예시로 두는 것이 맞다.

## 내가 제안하는 v1 baseline 재정리

### 메인 데모에 반드시 올릴 것

- Control Plane에서 프로젝트/앱/키/토큰 준비
- Gateway가 DB 또는 active config 기반으로 인증/식별
- 고객사 업무 앱 또는 demo client에서 Gateway 호출
- 민감정보 redaction
- 위험 정보 block
- Exact Cache miss -> hit
- `model=auto` routing decision
- Provider 또는 Mock Provider 응답
- Request Log / Detail / Dashboard 반영
- requestId 기반 추적

### 메인 데모 후보로 강하게 검토할 것

- PostgreSQL-backed Rate Limit
- 실제 Provider 1개
- Prometheus metrics endpoint
- k6 baseline report
- JSON structured log

이 다섯 개는 v1 baseline의 제품 설득력을 크게 올린다. 다만 데모 안정성을 흔들면 보조 경로로 내려야 한다.

### 보조 또는 evidence 경로로 둘 것

- Redis-backed Rate Limit
- ClickHouse / Redpanda log pipeline
- Semantic Cache
- Runtime Policy Editor
- Custom Regex Rule UI
- SSE Streaming
- RAG demo

여기 있는 기능은 버리는 것이 아니라, v1에서 "왜 다음에 필요한지"를 설명하는 backlog/evidence로 두는 편이 좋다.

## 역할 재배치에 대한 내 수정 제안

공용 제안의 역할 분담은 좋다. 다만 각 slice가 무엇을 끝내야 하는지 더 구체화하면 좋겠다.

| 담당 | 내가 보는 완료 기준 |
|---|---|
| A. Control Plane & Runtime Config | 화면/API에서 만든 project/app/key/token/provider/model이 Gateway active config로 읽힌다. |
| B. Gateway Runtime & Provider | text-only 요청, Provider Adapter, timeout/error, actual/mock provider path가 안정적으로 동작한다. |
| C. Governance | API Key/App Token/context/rate decision이 요청 처리와 로그 상세에 남는다. |
| D. Safety & Cost | masking/block/cache/routing/cost-saving evidence가 한 요청 흐름 안에서 보인다. |
| E. Observability & Demo | requestId 하나로 log/detail/dashboard/metrics/demo flow가 연결된다. |

이렇게 잡으면 각 담당이 자기 영역만 끝내는 것이 아니라, 실제 제품 장면까지 책임지게 된다.

## 계약 동결에서 꼭 포함할 필드

다음 필드는 먼저 맞춰야 한다.

```text
requestId
tenantId
projectId
applicationId
apiKeyId
appTokenId
userId 또는 endUserId 후보
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

## 남은 4일 기준 실행안

### Day 1. 계약과 메인 데모 경로 동결

- v1 baseline 한 줄 경로 확정
- fixture 기반 계약 고정
- Rate Limit scope/window/decision 확정
- Control Plane이 Gateway에 넘길 active config shape 확정
- Demo client와 Web Console 역할 분리

### Day 2. 실제 요청 경로 연결

- 생성된 key/token을 Gateway 인증에 연결
- masking/cache/routing/provider/log를 실제 requestId로 연결
- Rate Limit fixed window 최소 동작 연결
- Dashboard와 Detail이 실제 로그를 읽도록 연결

### Day 3. 제품 설득력 강화

- Dashboard polish
- Detail Drawer polish
- k6 baseline
- metrics endpoint
- 실제 Provider spike 결과 반영
- 실패/timeout/error response 정리

### Day 4. 데모 동결

- 메인 데모 경로 freeze
- 보조 데모 경로 분리
- fallback script 준비
- 발표 메시지 정리
- 마지막 smoke와 k6 결과 고정

## 내 최종 입장

공용 v1 baseline proposal은 지금까지 나온 문서 중 가장 균형이 좋다.

Hyeok 문서는 제품 임팩트를 크게 잡았고, Kyumin 문서는 구조 안정성을 잘 잡았고, Yoonji 문서는 병렬 실행 계획을 잘 잡았다. 이번 공용 제안은 그 셋을 제품 가치 기준으로 다시 묶었다는 점에서 좋다.

내가 추가하고 싶은 결론은 하나다.

> v1 baseline의 핵심은 기능 개수가 아니라, 고객사 업무 앱 요청 하나가 GateLM을 통과하면서 통제, 보안, 비용 절감, 관측이 모두 설명되는 것이다.

남은 4일 동안은 이 한 줄 경로를 중심에 두고, Rate Limit, 실제 Provider, metrics, k6, Dashboard polish를 어디까지 메인 경로에 올릴지 결정하면 된다.

## 공용 제안자에게 다시 묻고 싶은 질문

- PostgreSQL-backed Rate Limit의 scope는 project, application, apiKey 중 무엇으로 먼저 잡을 것인가?
- Rate Limit decision을 Dashboard에 보여줄 것인가, Request Detail에만 보여줄 것인가?
- 실제 Provider 1개는 v1 baseline에 포함할 것인가, Mock Provider만으로 갈 것인가?
- Control Plane에서 만든 설정을 Gateway가 읽는 방식은 DB direct read인가, active config snapshot인가?
- Prometheus metrics는 Gateway 내부 stage별 counter까지 갈 것인가, request-level metric만 둘 것인가?
- k6 baseline의 합격 기준은 수치 목표인가, 병목 설명 가능한 report인가?
