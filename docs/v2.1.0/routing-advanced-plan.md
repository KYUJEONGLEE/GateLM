# GateLM v2.1 Routing Advanced Plan

## 목표

룰 기반 라우팅 MVP 이후의 고도화는 한 번에 동적 라우팅으로 뛰지 않고, 평가 가능성부터 닫는다.

핵심 순서는 아래와 같다.

1. 평가: 현재 분류기가 무엇을 맞히고 틀리는지 재현 가능한 리포트로 본다.
2. 운영: 관리자 공개 설정은 enabled와 low/default/high 모델 선택으로 제한하고, 세부 룰은 GateLM 내부 정책으로 관리한다.
3. 동적 라우팅: 비용, latency, provider 상태, fallback 우선순위를 라우팅 판단에 반영한다.

## Stage 1. Evaluation Report

현재 단계다.

목표:

- offline dataset을 입력으로 받아 실제 Gateway routing classifier를 실행한다.
- 전체 accuracy, category별 accuracy, confusion matrix, failure sample id를 출력한다.
- report에는 raw prompt, raw response, secret, requestId, traceId를 출력하지 않는다.

실행:

```powershell
corepack pnpm run v2.1:routing:evaluate
```

회귀 검증용 Go testdata를 기준으로 강하게 검사할 때:

```powershell
corepack pnpm run v2.1:routing:evaluate -- -dataset apps/gateway-core/internal/domain/routing/testdata/category_eval_cases.json -min-accuracy 1
```

해석:

- `accuracy`는 exact-match 기준이다.
- `failures`는 `sampleId`, `expectedCategory`, `actualCategory`만 포함한다.
- 실패가 나오면 prompt를 로그에 노출하지 말고 dataset label 또는 classifier rule을 별도로 검토한다.

## Stage 2. Operational Routing Policy

목표:

- 관리자에게 공개할 RuntimeConfig 범위는 `routing.enabled`와 low/default/high 모델 선택으로 제한한다.
- routing category, priority, keyword, policyVariant는 Gateway 내부 embedded policy로 관리한다.
- Request Log와 Dashboard에서 routingReason, routingDecisionKeyHash, selected provider/model을 일관되게 보여준다.

현재 구현:

- 기본 category keyword와 priority를 `apps/gateway-core/internal/domain/routing/category_policy.json`으로 분리했다.
- 이 파일은 관리자 편집용 계약이 아니라 GateLM 내부 embedded policy다.
- Gateway hot path는 외부 파일을 매 요청마다 읽지 않고, binary에 embed된 정책 데이터를 사용한다.
- RuntimeConfig/RuntimeSnapshot에는 세부 룰을 싣지 않고, 관리자 공개 설정과 실행 결과 provenance만 연결한다.
- 이후 RuntimeSnapshot에 연결하더라도 세부 룰 본문이 아니라 `policyVersion`/hash 같은 추적 정보만 싣는 것을 기본값으로 한다.

주의:

- category keyword, priority, detector-like rule을 UI/API/fixture에 공개하지 않는다.
- provider/model enum lock을 만들지 않는다.
- safety/masking 책임을 routing policy에 섞지 않는다.

## Stage 3. Dynamic Routing

목표:

- 비용 tier, provider latency, provider health, fallback priority를 라우팅 결정에 반영한다.
- 동일 category라도 provider 상태와 운영 정책에 따라 선택 모델이 달라질 수 있게 한다.
- cache key material에는 실제 응답 경로를 바꾸는 결정값만 넣는다.

주의:

- 동적 값 전체를 cache key에 넣으면 cache 효율이 급격히 떨어질 수 있다.
- provider raw error, raw credential, Authorization header는 routing/caching material에 넣지 않는다.
- 동적 라우팅은 Stage 1 report와 Stage 2 policy provenance가 닫힌 뒤 시작한다.
