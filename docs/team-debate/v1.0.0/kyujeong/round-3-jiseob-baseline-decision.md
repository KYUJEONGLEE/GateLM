# Kyujeong Round 3 Response - Jiseob Baseline Decision

## 전제

Jiseob의 `v1-baseline-proposal.md`가 공용 문서에서 Jiseob 개인 제안 위치로 옮겨졌다.

내용 자체는 이전에 읽고 답변한 v1 baseline 제안과 같으므로, 내 `round-2-v1-baseline-response.md`의 큰 입장은 유지한다.

이번 답변에서는 반복 설명보다, Jiseob이 던진 팀 결정 질문에 대해 Kyujeong 기준의 선택지를 더 명확히 적는다.

## Jiseob 질문에 대한 내 답

### 1. GateLM의 v1 제품 정의를 B2B LLM Gateway로 고정할 것인가?

내 답은 "그렇다"이다.

GateLM은 LLM 앱도, Chat UI도, RAG 서비스도 아니라 기업의 LLM 호출 경로를 통제하는 Gateway로 정의해야 한다.

발표 첫 메시지는 아래처럼 가는 게 좋다.

```text
GateLM은 기업의 모든 LLM 요청을 승인된 Gateway로 통과시켜 보안, 비용, 정책, 로그를 중앙에서 관리하게 해주는 B2B LLM Gateway다.
```

OpenAI-compatible API는 핵심 가치가 아니라 도입 장벽을 낮추는 수단으로 설명한다.

### 2. 새 기준을 "v1.0.0 baseline demo 가능 상태"로 재정의할 것인가?

내 답은 "그렇다"이다.

단, 기준을 다시 잡는다고 해서 무조건 기능을 크게 늘리자는 뜻은 아니어야 한다.

내가 보는 v1 baseline은 다음이다.

```text
고객사 업무 앱 요청 하나가 GateLM을 통과하면서
인증, 정책, 보안, 비용 절감, 라우팅, 로그, 대시보드가
하나의 제품 흐름으로 설명되는 상태
```

즉, 기준은 기능 개수가 아니라 제품 흐름이다.

### 3. 기존 A/B/C/D/E 역할을 vertical slice 기준으로 재배치할 것인가?

내 답은 "그렇다"이다.

기존처럼 DB, Gateway, Security, Observability, Demo를 레이어 단위로 쪼개면 결국 같은 request context와 log metadata를 여러 명이 동시에 만진다.

다음 작업은 Jiseob 제안처럼 vertical slice 기준이 더 낫다.

다만 각 slice는 자기 영역 안에서 끝나면 안 되고, 제품 장면까지 책임져야 한다.

| Slice | 완료 기준 |
|---|---|
| Control Plane & Runtime Config | 관리자가 만든 설정이 Gateway 판단에 실제로 쓰인다. |
| Gateway Runtime & Provider | 요청이 안정적으로 Provider 또는 Mock Provider까지 간다. |
| Governance | 인증, context, rate decision이 요청 결과와 로그에 남는다. |
| Safety & Cost | redaction/block/cache/routing/cost 절감이 한 요청에서 보인다. |
| Observability & Demo | requestId 하나로 log/detail/dashboard/metrics가 이어진다. |

### 4. Rate Limit은 v1에서 PostgreSQL-backed baseline으로 시작하고 Redis는 이후 최적화로 둘 것인가?

내 답은 "조건부 찬성"이다.

PostgreSQL-backed Rate Limit은 기술 선택의 근거를 만들기 좋다. 처음부터 Redis를 쓰면 "왜 Redis가 필요한지" 설명하기 어렵다.

하지만 범위는 좁혀야 한다.

내 제안:

```text
scope: projectId 또는 apiKeyId 중 하나만 먼저 선택
algorithm: fixed window
window: 60초
decision: allowed, remaining, retryAfterSeconds, reason
storage: PostgreSQL
interface: RateLimiter
evidence: k6로 p95 latency와 DB query latency 측정
```

v1 발표에서는 "PostgreSQL로 정확한 baseline을 만들고, 병목 수치가 나오면 Redis adapter로 확장한다"는 서사가 좋다.

### 5. RAG/FAQ chatbot은 v1 필수가 아니라 이후 demo extension으로 둘 것인가?

내 답은 "그렇다"이다.

RAG를 넣으면 제품 메시지가 흐려진다. 청중이 GateLM을 "문서 검색 챗봇"으로 오해할 수 있다.

RAG는 GateLM 내부 기능이 아니라 고객사 앱의 한 유형으로 설명하는 편이 낫다.

```text
고객사 앱이 RAG를 수행한다.
그 앱의 LLM 호출은 GateLM Gateway를 통과한다.
GateLM은 그 호출의 보안, 비용, 정책, 로그를 통제한다.
```

### 6. Observability는 v1에서 dashboard뿐 아니라 metrics와 k6 evidence까지 포함할 것인가?

내 답은 "그렇다"이다.

다만 Dashboard, Metrics, k6의 역할은 분리해야 한다.

| 항목 | 목적 |
|---|---|
| Dashboard | 제품 가치를 운영자에게 보여준다. |
| Request Log / Detail | 요청 하나의 처리 이유를 설명한다. |
| Metrics | Gateway 내부 병목을 측정한다. |
| k6 | 성능 주장을 재현 가능한 수치로 만든다. |

Dashboard에 모든 metrics를 욱여넣을 필요는 없다. 발표에서는 Dashboard로 제품을 보여주고, metrics/k6는 기술적 근거로 보여주면 된다.

### 7. 다음 PR부터 계약 문서와 smoke 기준을 먼저 고정할 것인가?

내 답은 "그렇다"이다.

특히 아래 계약은 구현 전에 먼저 고정해야 한다.

- Runtime Config Contract
- Gateway Context Contract
- Rate Limit Decision Contract
- Invocation Log Contract
- Dashboard Query Contract
- Demo Fixture Contract
- Smoke/Load Test Contract

문서만 쓰면 부족하다. 최소한 fixture나 smoke script로 깨지는 지점이 보여야 한다.

## 내가 제안하는 합의안

Jiseob 제안에 대한 Kyujeong의 합의안은 아래와 같다.

### v1 baseline에 넣자

- B2B LLM Gateway 제품 정의
- vertical slice 역할 재배치
- Control Plane 설정이 Gateway runtime에 반영되는 흐름
- DB 또는 active config 기반 API Key/App Token 검증
- PostgreSQL-backed Rate Limit 최소 baseline
- redaction/block
- Exact Cache
- Simple Routing
- Request Log / Detail / Dashboard
- structured log
- metrics endpoint
- k6 baseline report
- B2B 업무 앱 demo client

### 보조 경로로 두자

- 실제 Provider 1개
- Budget block
- Provider timeout/fallback 시나리오

여기서 실제 Provider는 가능하면 붙이고 싶다. 다만 실패해도 Mock Provider로 메인 데모가 살아 있어야 한다.

### 지금은 빼자

- RAG/FAQ chatbot
- Semantic Cache
- Redis-backed Rate Limit
- ClickHouse/Redpanda log pipeline
- Runtime Policy Editor
- Custom Regex Rule UI
- SSE Streaming
- Self-hosted installer

이것들은 버리는 것이 아니라, v1 이후 확장 방향으로 설명한다.

## 다음 라운드에서 결정했으면 하는 것

이제 토론은 방향성보다 구체 결정을 해야 한다.

내가 다음 라운드에서 받고 싶은 답은 아래다.

1. Rate Limit scope를 `projectId`로 할지 `apiKeyId`로 할지
2. Control Plane 설정을 Gateway가 DB direct read로 볼지 active config snapshot으로 볼지
3. 실제 Provider 1개를 메인 데모에 넣을지 보조 데모로 둘지
4. Demo client를 Web Console 안에 둘지 별도 customer app으로 둘지
5. v1 baseline smoke의 반드시 성공해야 하는 명령을 무엇으로 둘지
6. k6 report의 목표를 pass/fail 수치로 둘지 병목 설명 자료로 둘지

## 내 현재 최종 입장

Jiseob 제안은 지금까지의 토론을 가장 잘 묶고 있다.

나는 이 방향으로 가되, v1 baseline의 핵심을 아래 한 문장으로 고정하고 싶다.

> 고객사 업무 앱의 LLM 요청 하나가 GateLM을 통과하면서 인증, 정책, 보안, 비용 절감, 라우팅, 로그, 대시보드, 성능 근거까지 연결되는 것.

이 한 문장이 깨지지 않으면 기능을 더 공격적으로 붙여도 된다.

이 한 문장이 흐려지면 기능이 많아도 v1.0.0 baseline으로는 약하다.
