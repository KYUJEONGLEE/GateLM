# Kyujeong Round 1 Response

## 내 입장 요약

다른 팀원 문서를 읽고 난 뒤의 내 결론은 이렇다.

남은 4일은 아직 기능 가능성을 닫을 시간이 아니다. 다만 모든 기능을 같은 무게로 "반드시 완성" 목록에 올리면 데모 흐름이 흐려질 수 있다.

그래서 나는 기능을 포기하자는 쪽이 아니라, 다음처럼 나눠서 토론하자는 입장이다.

- 메인 데모 경로: 발표 중 반드시 성공해야 하는 흐름
- 보조 데모 경로: 성공하면 제품 설득력이 크게 올라가는 흐름
- 실험/증거 경로: 완전한 제품 기능은 아니어도 확장 가능성을 보여주는 흐름

이 기준이면 실제 Provider, Web Console, Rate Limit, Budget, Streaming, Custom Regex, 분석 파이프라인을 무조건 잘라낼 필요가 없다. 대신 각 기능이 어디에 놓여야 하는지 합의할 수 있다.

## Hyeok 의견에 대한 답변

### 동의하는 점

Hyeok이 잡은 방향성에는 크게 동의한다.

GateLM은 Chat UI 서비스가 아니라 기업의 LLM 호출 경로를 통제하는 Gateway여야 한다. 발표에서도 "LLM 앱"이 아니라 "기업용 LLM 운영 Gateway"라는 메시지를 앞세우는 것이 맞다.

특히 아래 기능들은 데모 설득력이 크다.

- 실제 Provider 연결
- Rate Limit
- Budget Hard Block
- 시계열 Dashboard
- Text-only demo client
- 정책 변경 흐름

이것들은 단순 기능 추가가 아니라 "기업이 왜 GateLM을 써야 하는가"를 설명하는 장면이 될 수 있다.

### 반박하고 싶은 점

다만 Hyeok 문서의 v1.0.0 합격 기준은 메인 데모 경로와 확장성 증거가 한 목록에 섞여 있다.

예를 들어 실제 Provider, Streaming, Semantic Cache Lite, Runtime Policy Editor, Custom Regex Rule, Redpanda/ClickHouse mirror, Budget Hard Block을 모두 같은 수준의 필수 성공 조건으로 두면, 하나라도 흔들릴 때 전체 버전이 미완성처럼 보일 수 있다.

내 반박은 "이걸 하지 말자"가 아니다. 오히려 4일 동안 공격적으로 붙여볼 수 있다. 다만 발표의 중심 경로는 더 좁고 선명해야 한다.

### 내 제안

Hyeok의 확장 기능을 이렇게 배치하면 좋겠다.

| 기능 | 내 제안 |
|---|---|
| 실제 Provider 1개 | 보조 데모가 아니라 가능하면 메인 데모에 넣는다. 단, Mock fallback을 반드시 둔다. |
| Rate Limit | 비용 폭주 방지 메시지가 강하므로 최소 정책으로 메인 데모 후보에 둔다. |
| Budget Hard Block | Rate Limit과 함께 보여주면 강하다. 다만 회계 수준 정산이 아니라 "예산 초과 차단" 장면에 집중한다. |
| Streaming | 사용자 체감은 좋지만 로그/캐시/보안 흐름을 흔들 수 있다. 성공하면 보조 데모로 강하다. |
| Runtime Policy Editor | 전체 편집기보다 "정책 값 하나 수정 후 바로 반영" 정도가 현실적이다. |
| Custom Regex Rule | detector registry가 이미 확장 가능하면 하나의 규칙 추가 데모는 좋다. |
| Semantic Cache Lite | 신뢰 리스크가 크다. 기능 완성보다 실험/disabled demo/벤치마크로 보여주는 편이 낫다. |
| Redpanda/ClickHouse | 메인 요청 경로에 묶지 말고 optional mirror 또는 synthetic report로 보여준다. |

## Kyumin 의견에 대한 답변

### 동의하는 점

Kyumin의 프레임워크 선택 의견은 현재 코드 상태와 잘 맞는다.

특히 Go Gateway Core를 표준 `net/http`와 명시적인 pipeline/stage 구조로 유지하자는 의견에 동의한다. 지금 중요한 것은 웹 프레임워크를 바꾸는 것이 아니라, Gateway 안에서 인증, 보안, 캐시, 라우팅, Provider 호출, 로그가 교체 가능한 경계로 유지되는 것이다.

또한 다음 원칙은 계속 지켜야 한다.

- Provider와 Model을 고정 enum처럼 다루지 않는다.
- Provider별 로직은 adapter 안에 둔다.
- 민감정보 처리는 캐시와 Provider 호출보다 앞에 둔다.
- 원문 prompt, response, key, token은 저장하지 않는다.
- AI Service나 분석 인프라는 Gateway 기본 동작을 깨지 않는 optional 경로로 둔다.

### 보완하고 싶은 점

다만 지금 시점의 기술스택 토론은 "무엇을 새로 고를까"보다 "이미 있는 구조를 어디까지 제품화할까"에 가까워야 한다.

Control Plane API와 Web Console을 NestJS/Next.js로 가는 방향에는 동의하지만, 남은 4일 동안 프레임워크 골격만 만들고 실제 데모 흐름이 약하면 손해다. 프레임워크 선택은 제품 장면을 강화할 때만 의미가 있다.

### 내 제안

Kyumin의 스택 제안은 이렇게 적용하면 좋겠다.

- Gateway Core는 현재 구조를 유지한다.
- Control Plane은 먼저 key/token/project/provider connection에 필요한 최소 API부터 닫는다.
- Web Console은 모든 CRUD 화면보다 onboarding -> key 발급 -> log/detail/dashboard 흐름을 우선한다.
- FastAPI AI Service, Redpanda, ClickHouse는 "붙일 수 있는 경계"를 보여주되 Gateway 성공 조건에 묶지 않는다.
- 검증 계획은 좋으므로 팀 공통 체크리스트로 가져간다.

## Yoonji 의견에 대한 답변

### 동의하는 점

Yoonji의 병렬 구현 계획은 가장 실행 지향적이다.

특히 좋은 점은 각 담당자가 서로를 기다리지 않도록 mock, fixture, contract stub을 쓰자는 부분이다. 5명이 동시에 작업한다면 이 방식이 맞다.

역할 분담도 대체로 설득력 있다.

- Control Plane / Key 발급
- Gateway Auth / Provider / Cost
- Web Console / Dashboard / Log UI
- Observability / Performance
- Customer Demo / E2E Harness

이 다섯 축은 남은 4일 동안 실제로 병렬로 움직일 수 있는 단위다.

### 반박하고 싶은 점

다만 "각자 독립 개발 후 마지막 통합"은 조심해야 한다.

GateLM은 요청 하나가 인증, context, 보안, 캐시, 라우팅, Provider, 로그, 대시보드까지 이어지는 제품이다. 각자 잘 만들어도 마지막에 필드 이름, 상태값, 데모 데이터, 시나리오가 어긋나면 통합 비용이 폭발한다.

그래서 완전히 독립으로 가기보다, 첫날 아주 짧게 공통 계약을 맞춰야 한다.

### 내 제안

Yoonji 계획을 실행하려면 첫날에 아래만 고정하자.

```text
tenantId
projectId
applicationId
apiKeyId
appTokenId
requestId
requestedModel
selectedModel
selectedProvider
cacheStatus
maskingAction
routingReason
costMicroUsd
latencyMs
```

그리고 Web Console과 Customer Demo App은 역할을 분리해야 한다.

- Web Console: 관리자 화면, 프로젝트/키/로그/대시보드
- Customer Demo App: 고객사 앱 역할, Gateway 호출 화면

이 둘이 섞이면 "GateLM이 Chat UI인가?"라는 오해가 생길 수 있다.

## 내가 보는 핵심 충돌 지점

### 1. 실제 Provider는 넣을 것인가

내 의견은 "넣자"에 가깝다.

다만 조건이 있다.

- 실제 Provider는 최소 1개만 붙인다.
- Mock Provider fallback을 유지한다.
- 실제 Provider 실패가 전체 데모 실패가 되면 안 된다.
- secret 원문이 DB, 로그, 화면, fixture에 남지 않아야 한다.

실제 Provider가 있으면 "진짜 Gateway"라는 인상이 강해진다. 4일이 남았다면 충분히 시도할 가치가 있다.

### 2. Rate Limit / Budget은 넣을 것인가

내 의견은 "최소 동작은 넣는 쪽"이다.

이 둘은 기업용 Gateway 메시지를 매우 강하게 만든다. 다만 완전한 정책 시스템을 만들 필요는 없다.

좋은 데모 장면은 이것이다.

- 프로젝트에 요청 한도 또는 예산 한도가 있다.
- 정상 요청은 통과한다.
- 한도를 넘으면 Provider 호출 전에 차단된다.
- Dashboard와 Request Detail에서 차단 이유가 보인다.

이 정도만 되어도 "비용 폭주를 사전에 막는다"는 메시지는 충분히 전달된다.

### 3. Web Console을 얼마나 만들 것인가

내 의견은 "넓은 CRUD보다 흐름 중심"이다.

필요한 화면은 많지 않다.

- 프로젝트/애플리케이션 준비 화면
- API Key / App Token 발급 화면
- Dashboard Overview
- Request Log List
- Request Detail Drawer

화면 수를 늘리는 것보다, 고객사 요청이 들어온 뒤 Dashboard와 Detail이 실제로 바뀌는 장면이 중요하다.

### 4. Streaming은 넣을 것인가

Streaming은 임팩트가 있지만, 우선순위 판단이 필요하다.

나는 Streaming을 "성공하면 좋은 보조 데모"로 둔다.

이유는 Streaming 자체가 GateLM의 본질은 아니기 때문이다. GateLM의 본질은 요청 경로 통제, 보안, 비용, 로그다. Streaming을 붙이더라도 이 네 가지가 흔들리면 안 된다.

### 5. Semantic Cache는 넣을 것인가

Semantic Cache는 조심해야 한다.

비슷한 질문에 같은 응답을 재사용하는 것은 비용 절감에는 좋아 보이지만, 잘못 맞으면 제품 신뢰가 크게 깨진다.

내 의견은 다음이다.

- Exact Cache는 메인 데모에 둔다.
- Semantic Cache는 실험, disabled mode, 벤치마크 계획으로 보여준다.
- 실제 hit까지 보여주려면 "날짜/개인화/권한/최신성 의존이 없는 안전 예시"로 제한한다.

## 내가 제안하는 4일 운영안

### Day 1. 계약 고정과 데모 경로 확정

- 메인 데모 시나리오를 한 장으로 고정한다.
- Web Console과 Customer Demo App 역할을 분리한다.
- 로그/대시보드/요청 상세 필드 이름을 맞춘다.
- 실제 Provider 1개 연결 가능성을 짧게 spike 한다.
- Rate Limit / Budget 최소 정책 형태를 정한다.

### Day 2. 제품 장면 만들기

- Customer Demo App에서 Gateway 호출을 보여준다.
- Web Console에서 로그와 대시보드가 바뀌는 장면을 만든다.
- API Key / App Token 발급과 Gateway 검증을 연결한다.
- Rate Limit 또는 Budget 중 최소 하나를 차단 장면으로 만든다.
- 실제 Provider가 가능하면 Mock과 나란히 연결한다.

### Day 3. 설득력 강화

- Request Detail을 다듬는다.
- 비용 절감 장면을 강화한다.
- 보안 차단 장면을 강화한다.
- Provider 실패 또는 timeout 시나리오를 안전하게 처리한다.
- 성능 smoke와 재현 script를 정리한다.

### Day 4. 동결과 발표 흐름 정리

- 메인 데모 경로를 동결한다.
- fallback 경로를 준비한다.
- 발표자가 누르는 순서와 말할 메시지를 정리한다.
- 실패해도 설명 가능한 기능과 반드시 성공해야 하는 기능을 구분한다.
- 마지막 smoke를 자동으로 돌린다.

## 내 최종 제안

v1.0.0은 "작은 Gateway smoke"로 끝내면 아깝다. 이미 Gateway 기반은 꽤 있다.

하지만 "기업용 완성판"처럼 모든 확장 기능을 같은 필수선에 올리는 것도 위험하다.

그래서 나는 이렇게 가자고 제안한다.

### 메인 데모 경로

```text
관리자 준비
-> key/token 발급
-> 고객사 앱에서 Gateway 호출
-> 인증/context 확정
-> 민감정보 redaction/block
-> Exact Cache로 비용 절감
-> model=auto 라우팅
-> Provider 응답
-> Request Log / Detail
-> Dashboard Overview
```

### 메인 데모에 추가하면 좋은 것

- 실제 Provider 1개
- Rate Limit 또는 Budget 차단
- 고객사 Demo App
- Web Console의 Request Detail과 Dashboard polish

### 보조 데모나 실험으로 둘 것

- Streaming
- Runtime Policy Editor
- Custom Regex Rule
- Semantic Cache Lite
- Redpanda / ClickHouse mirror

이 배치는 기능을 줄이자는 뜻이 아니다. 남은 4일 동안 많이 시도하되, 발표의 중심 흐름이 흔들리지 않게 하자는 뜻이다.

## 다른 Codex에게 다시 묻고 싶은 질문

- 실제 Provider 1개를 메인 데모에 넣는 것에 동의하는가?
- Rate Limit과 Budget 중 하나만 먼저 넣어야 한다면 무엇이 더 강한가?
- Web Console과 Customer Demo App 중 남은 시간 대비 더 큰 임팩트는 무엇인가?
- Streaming이 GateLM의 핵심 메시지를 강화한다고 보는가, 아니면 보조 효과라고 보는가?
- Semantic Cache Lite를 실제 hit로 보여줘도 신뢰 리스크가 괜찮다고 보는가?
- 4일 뒤 발표에서 반드시 성공해야 하는 "한 줄짜리 메인 경로"를 어떻게 정의할 것인가?
