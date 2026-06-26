# Round 1 비교 정리 - hyeok

## 0. 비교 기준

내 기존 README의 핵심 주장은 다음이었다.

- GateLM은 B2B LLM Gateway로 확정한다.
- v1.0.0은 최소 데모가 아니라 기업용 LLM Gateway라고 부를 수 있는 첫 완성 버전이어야 한다.
- P0는 기존 one-day 문서 기준으로 Gateway vertical slice를 완성한다.
- v1.0.0에서는 실제 Provider, Streaming, Rate Limit, Budget Hard Block, Runtime Policy, Custom Regex, Semantic Cache Lite, 시계열 Dashboard, Text-only Chat UI까지 공격적으로 고려한다.
- Redpanda / ClickHouse, Self-hosted / Hybrid, 대용량 로그 분석은 확장성을 보여주는 방향으로 포함한다.

이 안의 장점은 목표가 크고, 발표에서 "기업용 Gateway"라는 메시지를 강하게 줄 수 있다는 점이다.

반대로 위험은 v1.0.0 범위를 너무 크게 잡아 핵심 데모 안정성이 흔들릴 수 있다는 점이다.

따라서 Round 1에서는 다른 팀원 README를 읽고 다음을 비교한다.

1. 무엇을 v1.0.0 필수로 볼 것인가?
2. 무엇을 확장 계획 또는 PoC로 둘 것인가?
3. 데모에서 가장 강한 장면은 무엇인가?
4. 병렬 개발과 머지 충돌을 줄이는 방식은 무엇인가?

---

## 1. Kyujeong README와 비교

### 1.1 Kyujeong 의견 요약

Kyujeong의 핵심 관점은 "이미 Gateway 기반은 어느 정도 있으니, 남은 시간은 제품처럼 보이게 만드는 데 써야 한다"이다.

중요한 주장:

- 지금은 처음부터 뭘 만들지 정하는 단계가 아니라, 이미 있는 Gateway 흐름을 어떻게 제품처럼 보이게 할지 정하는 단계다.
- 비용 절감, 보안, 관찰 가능성 중 무엇을 첫 메시지로 잡을지 정해야 한다.
- 실제 Provider, Web Console, Rate Limit, Budget은 미리 배제하지 말고 impact / risk / demo value로 비교해야 한다.
- 고객사 앱 연동 데모가 중요하다.
- Request Detail과 Dashboard를 운영자가 납득할 수 있게 다듬는 것이 중요하다.
- 실제 Provider는 설득력을 올리지만, 데모 안정성 리스크도 있다.
- 기능 목록보다 "고객사 앱이 GateLM을 통과하면 무엇이 좋아지는가"를 보여줘야 한다.

### 1.2 내 안과 같은 점

- GateLM의 핵심은 Chat UI가 아니라 Gateway라는 점이 같다.
- 고객사 앱이 Gateway를 통과하는 흐름을 보여줘야 한다는 점이 같다.
- 보안, 캐시, 라우팅, 로그가 하나의 요청 흐름 안에서 같이 설명되어야 한다는 점이 같다.
- 실제 Provider 연결이 제품 설득력을 높인다는 점도 같다.
- Dashboard와 Request Detail이 발표에서 중요한 증거 화면이 된다는 점도 같다.

### 1.3 내 안과 다른 점

내 안은 v1.0.0 범위를 공격적으로 크게 잡았다.

반면 Kyujeong 안은 "무엇을 더 붙일까"보다 "있는 기능을 어떻게 제품처럼 보여줄까"에 더 집중한다.

특히 Kyujeong은 다음을 더 조심스럽게 본다.

- 실제 Provider는 핵심 흐름이 아니라 보너스 시나리오일 수 있다.
- Rate Limit / Budget은 제품 메시지를 강하게 만들 수 있지만, 붙일 가치와 리스크를 비교해야 한다.
- 데모 안정성이 흔들리면 전체 인상이 나빠질 수 있다.

### 1.4 내가 반영할 점

Kyujeong 의견을 반영하면 v1.0.0의 필수 기준은 "많은 기능"이 아니라 "제품처럼 보이는 Gateway 흐름"이어야 한다.

따라서 내 기존 안에서 다음을 조정하는 것이 좋다.

- 실제 Provider는 가능하면 넣되, Mock fallback을 반드시 준비한다.
- Rate Limit / Budget은 전체 시스템 고도화보다 "한 장면으로 이해되는 최소 시나리오"를 우선한다.
- Dashboard는 많은 그래프보다 운영 판단에 필요한 숫자를 우선한다.
- Request Detail은 JSON 원문보다 "왜 차단/마스킹/라우팅/캐시 되었는지"를 설명해야 한다.
- 데모는 기능 나열이 아니라 고객사 앱 요청 하나가 Gateway에서 어떻게 처리되는지 따라가는 구조로 잡는다.

### 1.5 Kyujeong 비교 후 누적 결론

내 기존 안의 방향성은 유지하되, v1.0.0 범위를 "기능 개수"로만 넓히면 안 된다.

v1.0.0은 다음처럼 정의하는 것이 더 낫다.

> 고객사 앱의 LLM 요청이 GateLM을 통과하면서 인증, 보안, 캐시, 라우팅, 로그, 대시보드까지 이어지는 제품형 Gateway 데모.

즉 기능을 늘리더라도 데모 흐름 안에 들어오지 못하는 기능은 확장 계획 또는 PoC로 분리한다.

---

## 2. Kyumin README와 비교

### 2.1 Kyumin 의견 요약

Kyumin의 핵심 관점은 "확장성을 중요하게 보되, v1.0.0 핵심 경로를 대형 인프라로 흐리지 말자"이다.

중요한 주장:

- Gateway는 Go 1.24 + 표준 `net/http` + 명시적인 pipeline/stage 구조가 적합하다.
- Control Plane은 NestJS modular monolith가 적합하다.
- Web Console은 Next.js App Router가 적합하다.
- PostgreSQL과 Redis를 v1.0.0의 기준 저장소로 둔다.
- Redpanda, ClickHouse, FastAPI AI Service는 확장 준비는 하되 핵심 경로에는 넣지 않는다.
- Gateway 확장성은 웹 프레임워크보다 pipeline 구조에서 나온다.
- Provider, Cache, Routing, Secret, Log writer는 interface 뒤에 둬야 한다.
- AI 기능은 Gateway 안에 직접 넣지 말고 별도 AI Service로 분리해야 한다.
- v1.0.0은 작더라도 나중에 구조를 갈아엎지 않게 만들어야 한다.

### 2.2 내 안과 같은 점

- Go Gateway, NestJS Control Plane, Next.js Web Console 방향이 같다.
- Gateway를 pipeline/stage 구조로 봐야 한다는 점이 같다.
- Provider Adapter, CacheStore, RoutingStrategy 같은 확장 지점을 명시해야 한다는 점이 같다.
- raw prompt, raw response, secret 원문 저장 금지 기준이 같다.
- AI Service와 Semantic Cache를 Gateway 핵심 경로에 직접 넣지 않는 방향도 같다.

### 2.3 내 안과 다른 점

내 안은 v1.0.0에 Redpanda / ClickHouse, Semantic Cache Lite, Runtime Policy, Custom Regex까지 꽤 많이 포함했다.

Kyumin은 이 중 일부를 v1.0.0 필수가 아니라 P1 확장으로 보는 편이다.

특히 차이가 큰 부분:

- Redpanda / ClickHouse는 v1.0.0 필수가 아니라 outbox-ready 경계만 잡자는 입장.
- Semantic Cache와 AI Service는 P1/P2 확장으로 두자는 입장.
- v1.0.0에서는 PostgreSQL canonical log 기준으로 Dashboard 숫자를 맞추자는 입장.
- 기능을 많이 넣는 것보다 구조 경계를 잘 잡는 것이 더 중요하다는 입장.

### 2.4 내가 반영할 점

Kyumin 의견은 현실적인 기술 안정성 측면에서 매우 중요하다.

내 기존 안에서 v1.0.0 범위를 넓히더라도 다음처럼 표현을 조정하는 것이 좋다.

- Redpanda / ClickHouse는 "필수 동작 경로"가 아니라 "optional mirror / PoC / 확장 경계"로 둔다.
- Semantic Cache Lite는 반드시 실제 hit까지 구현하기보다, 안전 정책과 후보 판단 또는 disabled implementation까지 허용한다.
- Runtime Policy는 완전한 CEL editor가 아니라 프로젝트 정책 조회/수정 수준으로 시작한다.
- Rate Limit과 Budget은 Redis 기반 최소 정책으로 구현하되, 전체 quota system까지 욕심내지 않는다.
- v1.0.0의 기준 데이터 저장소는 PostgreSQL로 둔다.
- Gateway 기본 흐름이 Redpanda, ClickHouse, AI Service 장애에 의존하면 안 된다.

### 2.5 Kyumin 비교 후 누적 결론

Kyujeong 의견을 반영한 "제품처럼 보이는 흐름"에 Kyumin 의견을 합치면 다음 결론이 나온다.

v1.0.0은 기능을 크게 잡되, 핵심 경로는 작고 안정적으로 유지해야 한다.

따라서 기능을 세 층으로 나눠야 한다.

1. 필수 경로: Control Plane, Gateway 인증, 마스킹/차단, Exact Cache, Routing, Provider call, Log, Dashboard
2. 데모 강화: 실제 Provider 1개, Streaming, Rate Limit, Budget Hard Block, Text-only Chat UI, 시계열 차트
3. 확장 증명: Redpanda/ClickHouse optional mirror, Semantic Cache Lite 후보 판단, Runtime Policy 최소 편집

이렇게 나누면 v1.0.0 범위는 넓게 가져가면서도, 핵심 데모가 대형 인프라 때문에 무너지지 않는다.

---

## 3. Yoonji README와 비교

### 3.1 Yoonji 의견 요약

Yoonji의 핵심 관점은 "확장 P0를 제품 기준 P0로 다시 잡고, 5명이 동시에 착수할 수 있도록 역할과 머지 단위를 명확히 나누자"이다.

중요한 주장:

- 기존 축소 P0가 아니라 확장 P0를 제품 기준으로 잡는다.
- Admin onboarding부터 고객사 연동, 요청 처리, 로그 확인, 대시보드 확인까지 한 번에 시연 가능해야 한다.
- 각 담당자는 mock, fixture, contract stub, synthetic data를 사용해 먼저 독립 완성한다.
- API/DB/Event 최종 계약 반영은 별도 통합 PR에서 한 번에 정리한다.
- 역할을 A~E로 나눈다.
  - A: Control Plane API / Key Issuance
  - B: Gateway Auth / Mock Provider / Cost
  - C: Web Console / Dashboard / Request Log UI
  - D: Observability / Log Platform / Performance
  - E: Customer Demo / E2E / Integration Harness
- 각 역할은 4회 머지 계획으로 작게 나눠서 진행한다.
- 성능 smoke와 RPS/p95 latency 측정까지 포함한다.
- 대용량 로그 플랫폼은 PostgreSQL canonical writer를 막지 않는 optional mirror로 둔다.

### 3.2 내 안과 같은 점

- 확장 P0 또는 v1.0.0을 최소 데모보다 크게 잡아야 한다는 점이 같다.
- 고객사 앱 연동 데모가 필요하다는 점이 같다.
- Web Console, Request Log, Dashboard가 데모 핵심이라는 점이 같다.
- Provider Connection, API Key, App Token 발급이 중요하다는 점이 같다.
- Redpanda/ClickHouse는 확장 구조로 보여주되 핵심 경로를 막지 않아야 한다는 점이 같다.
- 성능과 대규모 트래픽 메시지를 보여줘야 한다는 점도 같다.

### 3.3 내 안과 다른 점

내 안은 기능 우선순위와 데모 메시지에 더 집중했다.

Yoonji 안은 구현 분업, 의존성 제거, 머지 전략이 훨씬 구체적이다.

특히 Yoonji 안에서 배워야 할 점:

- 각 담당자가 실제 API를 기다리지 않고 mock/fixture로 먼저 완성한다.
- 통합 전까지 branch를 기다리지 않는다.
- 공유 contract, DB schema, API spec, event schema는 별도 통합 PR에서만 수정한다.
- Developer D를 Observability / Performance 전담으로 두는 점이 좋다.
- Developer E를 Customer Demo / E2E / Integration Harness 전담으로 두는 점이 좋다.

### 3.4 내가 반영할 점

Yoonji 의견을 반영하면 v1.0.0 계획은 기능 목록뿐 아니라 실행 방식까지 바뀌어야 한다.

반영할 점:

- A~E 역할을 기존보다 더 명확히 재분배한다.
- Web과 Demo를 같은 사람이 다 하기보다, Web Console과 Customer Demo/E2E를 분리하는 것이 좋다.
- Observability/Performance 담당을 별도로 둬야 대규모 트래픽 메시지가 살아난다.
- 각 역할은 skeleton -> core behavior -> edge/metadata/test -> integration-ready cleanup 순서로 4회 머지한다.
- API가 없으면 mock client, DB가 없으면 fixture, 실제 Gateway가 없으면 mock Gateway로 먼저 구현한다.
- 마지막에 통합 PR에서 contract 차이를 정리한다.

### 3.5 Yoonji 비교 후 누적 결론

Kyujeong은 "제품처럼 보이는 흐름"을 강조했고, Kyumin은 "확장 가능한 구조 경계"를 강조했고, Yoonji는 "병렬 개발 실행 방식"을 강조했다.

세 의견을 합치면 다음 결론이 나온다.

v1.0.0은 다음 세 조건을 모두 만족해야 한다.

1. 제품 메시지: 고객사 앱이 GateLM을 통과하면 보안, 비용, 로그, 운영 통제가 붙는다는 것이 보여야 한다.
2. 구조 메시지: Gateway 핵심 경로는 작고 안정적이며 Provider/Cache/Routing/Log/Policy는 interface로 확장 가능해야 한다.
3. 실행 메시지: 5명이 mock/fixture/contract stub으로 병렬 구현하고, 마지막에 통합 계약을 맞춰야 한다.

---

## 4. Jiseob README와 비교

Jiseob README는 현재 기본 안내만 있고, 구체적인 설계 의견은 아직 없다.

따라서 이번 Round 1에서는 실질 비교 대상에서 제외한다.

나중에 Jiseob 문서가 추가되면 다음 기준으로 다시 비교하면 좋다.

- v1.0.0 필수 범위에 대한 의견
- 데모 시나리오 우선순위
- 역할 분담 또는 기술스택 의견
- 보안/비용/성능 중 어느 메시지를 앞세울지

---

## 5. Round 1 최종 판단

Round 1을 거친 뒤 내 생각은 다음처럼 바뀌었다.

처음 내 안은 v1.0.0 범위를 크게 잡는 데 집중했다.

하지만 비교 후에는 "크게 잡되, 핵심 경로와 확장 증명과 데모 강화 기능을 분리해야 한다"는 쪽으로 정리된다.

## 6. v1.0.0 추천 범위

### 6.1 반드시 완성해야 하는 핵심 경로

이 부분은 빠지면 v1.0.0이라고 부르기 어렵다.

- Admin onboarding 또는 local admin session
- Tenant / Project / Application 생성
- Provider Connection 등록
- API Key / App Token 발급
- DB 기반 API Key / App Token 검증
- Gateway request
- Tenant / Project / Application context 확정
- Sensitive data redaction or block
- Exact Cache
- Simple Routing
- Provider Adapter 기반 Mock Provider 또는 실제 Provider 호출
- token / cost / latency 기록
- Request Log list
- Request Detail
- Dashboard Overview

### 6.2 데모 설득력을 크게 올리는 기능

이 부분은 가능하면 v1.0.0에 넣는 것이 좋다.

- 실제 Provider 1개 연결
- Text-only Customer Demo App
- Rate Limit 최소 시나리오
- Budget Hard Block 최소 시나리오
- 시계열 Dashboard
- Streaming 응답 중계
- Runtime Policy 최소 조회/수정
- Custom Regex Rule 최소 적용

### 6.3 확장 증명 또는 PoC로 둘 기능

이 부분은 완전한 운영 기능보다 "구조상 가능하다"를 보여주는 정도가 적절하다.

- Redpanda / ClickHouse optional mirror
- 대량 synthetic log 기반 dashboard/query 성능 측정
- Semantic Cache Lite 후보 판단 또는 disabled implementation
- AI Service 연동 경계
- Self-hosted / Hybrid 설치 가이드

## 7. 역할 분담 재추천

Yoonji 안을 기준으로 역할을 재분배하는 것이 가장 병렬 개발에 유리해 보인다.

| 역할 | 추천 담당 |
| --- | --- |
| A | Control Plane API, Tenant/Project/Application, Provider Connection, API Key/App Token 발급 |
| B | Gateway Auth, Context, Provider Adapter, Cost 계산, Mock/Actual Provider |
| C | Web Console, Dashboard, Request Log, Request Detail UI |
| D | Observability, Log Query, Load Test, RPS/p95 측정, Redpanda/ClickHouse optional PoC |
| E | Customer Demo App, E2E Scenario, Smoke Script, Integration Harness |

내 기존 역할 분담에서는 E가 Web Console까지 너무 많이 가져갔는데, Yoonji 안처럼 Web Console과 Customer Demo/E2E를 분리하는 것이 더 낫다.

## 8. 최종 제안

내 최종 제안은 다음이다.

v1.0.0은 "최소 Gateway"가 아니라 "확장 P0"로 정의한다.

다만 모든 확장 기능을 필수 운영 수준으로 만들지는 않는다.

기능은 다음처럼 나눈다.

```text
Must:
  onboarding, key/token issuance, gateway auth, masking/block,
  exact cache, simple routing, provider adapter, log/detail/dashboard

Should:
  actual provider 1개, customer demo app, rate limit, budget hard block,
  time-series dashboard, streaming, custom regex, runtime policy 최소 편집

PoC:
  Redpanda/ClickHouse mirror, semantic cache lite, synthetic load test,
  self-hosted/hybrid guide
```

발표 메시지는 다음으로 잡는 것이 좋다.

> GateLM은 기업의 LLM 요청이 반드시 지나가는 Gateway이며, 이 경로에서 인증, 보안, 비용 통제, 캐시, 라우팅, 로그 분석을 한 번에 제공한다.

데모 메시지는 다음 흐름으로 잡는다.

```text
관리자 등록
-> 프로젝트와 앱 생성
-> Provider Connection과 Gateway credential 발급
-> 고객사 데모 앱에서 Gateway로 요청
-> 마스킹/차단, 캐시, 라우팅, Rate/Budget 처리
-> Provider 응답
-> 로그 상세와 대시보드 확인
-> 성능 smoke 또는 시계열 지표 확인
```

Round 1 기준으로는 Kyujeong의 제품 메시지, Kyumin의 구조 원칙, Yoonji의 병렬 실행 계획을 합친 형태가 가장 좋다.
