# Kyujeong Round 4 Response - v1/v2 Roadmap

## 결론

Jiseob의 `v1-v2-roadmap-synthesis.md` 방향에 동의한다.

이 문서는 지금까지 나온 의견을 가장 실용적으로 묶었다. 특히 좋은 점은 기능을 "한다/안 한다"로 자르는 대신, v1 메인 경로, v1 후보, v2 증거 경로로 나눴다는 점이다.

내 입장은 다음이다.

> v1은 제품처럼 보이는 B2B Gateway baseline, v2는 그 baseline이 대규모 운영 제품으로 확장될 수 있음을 수치와 구조로 증명하는 단계로 잡자.

## 동의하는 핵심

### 1. v1과 v2를 나누는 기준

v1은 기능이 적어도 괜찮다. 대신 하나의 요청 흐름이 제품처럼 보여야 한다.

v2는 기능이 더 많다는 뜻이 아니라, v1에서 측정한 병목을 근거로 개선하는 단계여야 한다.

이 구분은 좋다.

```text
v1: 요청 흐름이 제품처럼 보인다.
v2: 그 흐름이 커져도 운영 가능하다는 근거를 보인다.
```

### 2. Metrics를 v1부터 확정하는 것

metrics는 v2로 미루면 안 된다.

v2에서 Redis Rate Limit, ClickHouse, Redpanda, Semantic Cache를 이야기하려면 v1의 baseline 수치가 있어야 한다.

따라서 아래 항목은 v1에 넣는 데 동의한다.

- request count
- request latency
- provider latency
- cache hit count
- masking/block count
- rate limit decision count
- rate limit duration
- log write duration

Dashboard는 운영자 화면이고, metrics는 기술 근거다. 이 둘을 분리하는 방향도 동의한다.

### 3. v2를 "대규모 운영 증명"으로 잡는 것

Redpanda, ClickHouse, Redis Rate Limit, Semantic Cache, Streaming은 v1 메인 데모에 억지로 넣지 않는 것이 맞다.

다만 v2에서는 "새 기능 붙이기"가 아니라 아래 질문에 답해야 한다.

- PostgreSQL Rate Limit이 어느 지점에서 병목이 되는가?
- Redis adapter를 붙이면 무엇이 얼마나 좋아지는가?
- PostgreSQL log query와 ClickHouse query는 어떤 차이가 나는가?
- direct writer와 event pipeline은 응답 경로에 어떤 영향을 주는가?
- Semantic Cache는 어떤 요청에서 안전하고 어떤 요청에서 위험한가?

이 방식이면 v2가 더 설득력 있다.

## 더 조정하고 싶은 부분

### 1. 실제 Provider는 v1 후보가 아니라 "메인 후보 1순위"로 두자

Jiseob 문서는 실제 Provider 1개를 v1 후보 범위로 둔다.

나는 여기서 조금 더 공격적으로 보고 싶다.

실제 Provider는 v1 메인 경로에 넣는 것을 1순위로 시도하자. 단, 아래 조건을 만족해야 한다.

- Mock Provider fallback이 항상 살아 있어야 한다.
- 실제 Provider 실패가 발표 실패가 되면 안 된다.
- Provider Key 원문은 DB, 로그, 화면, fixture에 남지 않아야 한다.
- 실제 Provider 응답도 raw response 저장 없이 summary/metadata만 남겨야 한다.

실제 Provider가 있으면 "진짜 Gateway"라는 인상이 크게 올라간다. 남은 4일이면 시도할 가치는 충분하다.

### 2. Rate Limit scope는 `applicationId` 기본에 동의한다

Jiseob은 v1 Rate Limit scope를 `applicationId` 기본으로 제안했다.

이제 이걸 받아도 좋다고 본다.

이유:

- GateLM에서 App Token이 Application 단위라 설명이 자연스럽다.
- 고객사 업무 앱별 사용량 통제라는 메시지가 명확하다.
- project 단위보다 데모에서 "이 앱이 제한됐다"라고 보여주기 쉽다.
- apiKey 단위보다 관리자가 이해하기 쉽다.

단, Request Detail에는 `applicationId`뿐 아니라 `projectId`, `apiKeyId`도 같이 보여야 한다.

### 3. v1 메인 범위에 "실제 설정 반영"을 더 강하게 넣자

Control Plane이 project/app/key/provider/model을 만드는 것만으로는 약하다.

v1에서 반드시 보여줘야 하는 것은 다음이다.

```text
관리자가 설정을 만든다
-> Gateway가 그 설정을 읽는다
-> 다음 요청의 인증/라우팅/rate limit/log에 반영된다
```

이 장면이 없으면 Control Plane은 제품이 아니라 seed 편집기처럼 보일 수 있다.

### 4. Day 0 Contract Freeze는 정말 작게 가자

Day 0에서 너무 많은 계약을 잡으려 하면 하루가 문서 회의로 끝날 수 있다.

Day 0에서 반드시 고정할 것은 아래 정도면 충분하다.

- Gateway context field
- Runtime config shape
- Rate Limit decision shape
- Invocation log field
- Dashboard overview field
- Smoke expected scenario

나머지는 구현하면서 보강해도 된다.

## 내가 제안하는 v1 메인 경로

v1 발표에서 반드시 성공해야 하는 경로는 아래로 고정하고 싶다.

```text
관리자가 Project/Application/API Key/App Token/Provider 설정을 준비한다
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

이 흐름이 성공하면 v1은 충분히 제품처럼 보인다.

## v2 방향에 대한 보완

v2에서는 기능을 많이 붙였다는 말보다 "v1에서 측정한 병목을 이렇게 개선했다"가 중요하다.

내가 보고 싶은 v2 비교표는 이렇다.

| v1 baseline | v2 improvement | 보여줄 근거 |
|---|---|---|
| PostgreSQL Rate Limit | Redis Rate Limit | p95 latency, DB query latency, contention 감소 |
| PostgreSQL Log Query | ClickHouse Analytics | 대량 synthetic log query 시간 |
| Direct Log Writer | Redpanda Event Pipeline | response path와 analytics path 분리 |
| Exact Cache | Semantic Cache 실험 | safe-hit 기준, false positive 위험, 평가셋 |
| 숫자 카드 Dashboard | 시계열 Dashboard | 비용/latency/cache/rate limit trend |

이런 비교가 있으면 v2 발표가 훨씬 강해진다.

## 다음에 바로 결정할 것

이제 토론이 충분히 수렴했으니 다음 결정이 필요하다.

1. 실제 Provider를 v1 메인 경로 1순위 후보로 둘 것인가?
2. Rate Limit scope는 `applicationId`로 확정할 것인가?
3. Control Plane 설정 반영 방식은 DB direct read인가 active config snapshot인가?
4. Day 0 contract freeze를 누가 owner로 잡을 것인가?
5. v1 smoke script의 단일 성공 명령을 무엇으로 둘 것인가?
6. k6 baseline report를 누가 owner로 잡을 것인가?

## 최종 입장

Jiseob의 로드맵 종합안에 동의한다.

내가 추가하고 싶은 한 문장은 이것이다.

> v1은 "작게 만든 버전"이 아니라 "작지만 실제 운영 제품처럼 설명되는 버전"이어야 하고, v2는 "기능을 더 붙인 버전"이 아니라 "v1에서 측정한 병목을 근거로 확장성을 증명하는 버전"이어야 한다.

이 기준이면 지금 남은 4일을 꽤 공격적으로 쓸 수 있다.
