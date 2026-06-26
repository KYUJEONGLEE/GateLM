# Kyujeong Round 5 Response - Hyeok Round 1

## 결론

Hyeok의 `round1.md`는 기존 공격적인 제품 범위를 팀원 의견과 비교하면서 잘 조정한 문서다.

특히 다음 변화에 동의한다.

- v1.0.0을 단순 최소 Gateway가 아니라 확장된 제품 baseline으로 보려는 점
- 그래도 모든 기능을 같은 필수선에 올리지 않고 Must / Should / PoC로 나눈 점
- Kyumin의 구조 안정성, Yoonji의 병렬 실행 계획, Kyujeong의 제품 흐름 관점을 합치려는 점

다만 Hyeok 문서는 작성 시점상 Jiseob의 `v1-v2-roadmap-synthesis.md`를 반영하지 못했다. 그래서 최신 기준으로는 Hyeok의 `Should`와 `PoC` 범위를 조금 더 재배치하면 좋겠다.

## Hyeok 제안에서 유지하고 싶은 것

### 1. v1을 너무 작게 닫지 않는 태도

나는 여전히 Hyeok의 공격적인 태도가 필요하다고 본다.

남은 시간이 아직 있고, 지금 기반도 완전히 빈 상태가 아니다. 따라서 v1을 "그냥 요청 한 번 도는 데모"로 끝내면 아깝다.

특히 아래는 v1에서 적극적으로 시도할 가치가 있다.

- 실제 Provider 1개
- Customer Demo App
- Rate Limit 최소 시나리오
- Dashboard / Request Detail polish
- metrics와 k6 baseline

### 2. 기능을 Must / Should / PoC로 나누는 방식

이 구분은 좋다.

다만 최신 Jiseob 로드맵까지 반영하면 이름을 이렇게 바꿔도 좋겠다.

```text
Must  -> v1 main path
Should -> v1 candidate / fallback-ready feature
PoC -> v2 evidence path
```

이렇게 부르면 "Should가 실패하면 v1이 실패인가?" 같은 혼란을 줄일 수 있다.

## 조정하고 싶은 부분

### 1. Streaming은 v1 Should보다 v2 evidence에 가깝다

Hyeok은 Streaming을 데모 설득력을 크게 올리는 기능으로 본다.

임팩트는 인정한다. 하지만 최신 토론 기준에서는 Streaming보다 metrics, k6, Rate Limit, 실제 Provider가 더 v1 메시지에 직접적이다.

Streaming은 사용자 체감 기능이고, GateLM의 핵심 메시지인 통제/보안/비용/관측과는 조금 떨어져 있다.

따라서 내 제안은 다음이다.

```text
Streaming:
  v1에서는 제외하거나 보조 실험
  v2에서 Gateway hot path와 logging trade-off를 보여주는 evidence로 사용
```

### 2. Budget Hard Block은 Rate Limit 이후에 붙이자

Budget Hard Block은 기업용 메시지가 강하다.

하지만 v1에서 Rate Limit과 Budget을 둘 다 운영급으로 만들면 Governance 범위가 커질 수 있다.

최신 로드맵 기준으로는 Rate Limit을 먼저 잡고, Budget은 보조 후보로 두는 것이 낫다.

```text
v1 main:
  applicationId 기준 PostgreSQL-backed Rate Limit

v1 candidate:
  Budget Hard Block 최소 demo

v2:
  ledger, pricing, quota, budget policy를 더 정확히 연결
```

### 3. Runtime Policy와 Custom Regex는 v1 PoC보다 v2 후보가 낫다

Runtime Policy 최소 편집과 Custom Regex는 매력적이다.

하지만 v1에서 지금 더 중요한 것은 "관리자가 만든 설정이 Gateway 판단에 반영된다"는 흐름이다.

그래서 v1에서는 policy editor보다 active config 반영을 먼저 보여주는 것이 좋다.

```text
v1:
  project/application/provider/model/key/token/rate limit 설정 반영

v2:
  Runtime Policy Editor
  Custom Regex Rule UI
```

### 4. Redpanda / ClickHouse는 PoC보다 v2 evidence로 표현하자

Hyeok의 PoC 표현은 괜찮지만, 최신 로드맵에서는 더 명확히 v2 evidence path로 부르는 것이 좋겠다.

핵심은 "붙일 수 있다"가 아니라 "v1 metrics에서 병목을 확인했고, 그래서 이 구조가 필요하다"를 보여주는 것이다.

## 최신 합의안 기준 재분류

Hyeok의 Must / Should / PoC를 최신 토론 기준으로 다시 나누면 이렇게 보고 싶다.

### v1 main path

- Admin 또는 local admin setup
- Project / Application / API Key / App Token / Provider 설정
- Gateway 인증과 Application context
- applicationId 기준 PostgreSQL-backed Rate Limit
- redaction / block
- Exact Cache
- Simple Routing
- Mock Provider path
- Request Log / Detail / Dashboard
- metrics endpoint
- k6 baseline
- Customer Demo App

### v1 candidate

- 실제 Provider 1개
- Budget Hard Block 최소 demo
- JSON structured log polish
- Dashboard trend 일부

### v2 evidence path

- Redis Rate Limit 비교
- Redpanda event pipeline
- ClickHouse analytics
- Semantic Cache evaluation
- Streaming
- Runtime Policy Editor
- Custom Regex Rule UI
- Self-hosted / Hybrid guide

## Hyeok에게 다시 묻고 싶은 것

이제 Hyeok 의견에서 가장 궁금한 것은 범위가 아니라 우선순위다.

1. 실제 Provider, Budget, Streaming 중 하나만 v1 candidate로 올린다면 무엇을 고를 것인가?
2. Rate Limit scope를 Jiseob 제안처럼 `applicationId`로 고정하는 데 동의하는가?
3. Text-only Chat UI를 GateLM 제품 화면이 아니라 Customer Demo App으로 분리하는 데 동의하는가?
4. Runtime Policy / Custom Regex를 v2로 넘겨도 v1 제품 메시지가 충분하다고 보는가?
5. v1에서 Dashboard는 숫자 카드 중심으로 두고, 시계열은 v2로 넘기는 것에 동의하는가?

## 내 최종 입장

Hyeok의 공격적인 제품 감각은 필요하다.

다만 최신 토론 기준에서는 공격성을 기능 개수로 쓰기보다, v1 main path를 더 제품처럼 보이게 만드는 데 쓰는 것이 좋다.

내 현재 우선순위는 이렇다.

```text
1. Customer Demo App
2. applicationId Rate Limit
3. metrics + k6 baseline
4. Request Detail / Dashboard polish
5. actual Provider 1개
```

이 다섯 개가 붙으면 v1은 충분히 강해진다.
