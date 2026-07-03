# GateLM v2.1 Routing Mentor Evidence Plan

## 목적

멘토님께 공유할 라우팅 테스트셋, 성능테스트 시나리오, 실제 Gateway E2E 실행 방법을 한 곳에 정리한다.

이번 문서는 구현 계약을 새로 확정하는 문서가 아니다. v2.1 라우팅 고도화가 실제로 의미 있는지 확인하기 위한 evidence 계획서다.

## 멘토님 피드백 반영 내용

멘토님 요청은 아래 두 가지로 정리한다.

1. 테스트셋을 만들면 공유한다.
2. 성능테스트를 시작하면 어떤 시나리오로 측정하는지 작성해서 공유한다.

따라서 이번 단계의 목표는 두 가지다.

1. 룰 기반 라우팅 자체가 잘 맞고 빠른지 확인한다.
2. 실제 Gateway를 거쳤을 때도 라우팅, provider 호출, 로그 메타데이터 흐름이 살아있는지 확인한다.

## 현재 준비된 테스트 자산

| 구분 | 파일/명령 | 목적 | 서버 필요 여부 |
|---|---|---|---|
| 정답 평가셋 1 | `docs/v2.1.0/fixtures/category-evaluation-dataset.fixture.jsonl` | 기본 업무 표현 기준 정확도 측정 | 필요 없음 |
| 정답 평가셋 2 | `docs/v2.1.0/fixtures/category-evaluation-ambiguous.fixture.jsonl` | 애매한 표현에서 category/tier가 맞는지 측정 | 필요 없음 |
| 정답 평가셋 3 | `docs/v2.1.0/fixtures/category-evaluation-challenge.fixture.jsonl` | 더 어려운 표현에서 룰의 약점 확인 | 필요 없음 |
| 랜덤 Probe | `docs/v2.1.0/fixtures/routing-random-probe.fixture.jsonl` | 정답 없이 분포가 한쪽으로 쏠리는지 관찰 | 필요 없음 |
| 정답 평가 실행 | `corepack pnpm run v2.1:routing:test` | 정확도, 오답률, 라우팅 판단 지연시간, 예상 비용 절감률 리포트 생성 | 필요 없음 |
| 분포 관찰 실행 | `corepack pnpm run v2.1:routing:probe` | category/tier 분포와 판단 사유 분포 확인 | 필요 없음 |
| Gateway E2E 실행 | `corepack pnpm run v2.1:routing:e2e` | 실제 Gateway 요청에서 provider/model/routing/cache/provider outcome 확인 | 필요 |

## 정답 평가와 Probe와 E2E의 차이

| 구분 | 정답 평가 | Probe | Gateway E2E |
|---|---|---|---|
| 목적 | 맞혔는지 틀렸는지 확인 | 어떤 방향으로 분류되는지 관찰 | 실제 요청 흐름이 끝까지 성공하는지 확인 |
| 정답 라벨 | 있음 | 없음 | 일부 기대 category만 참고 |
| 서버 실행 | 필요 없음 | 필요 없음 | 필요 |
| 핵심 지표 | category accuracy, tier accuracy, failures | category distribution, tier distribution | selected provider/model, routing reason, provider outcome, latency |
| 해석 | 오답 샘플을 보고 룰을 보강 | general/low_cost 쏠림, high_quality 과다 선택 등 이상 분포 확인 | 실제 Gateway 환경에서 라우팅 결과와 응답 흐름 확인 |
| 사용 시점 | 룰 변경 전후 회귀 검증 | 새로운 traffic mix 경향 확인 | 멘토 공유용 실제 흐름 evidence |

## 성능테스트 시나리오

### 1. Routing-only 평가

Gateway 서버를 켜지 않고 라우팅 도메인 로직만 실행한다.

```powershell
corepack pnpm run v2.1:routing:test
```

확인할 지표:

- category accuracy
- tier accuracy
- failure count
- routing latency avg/p50/p95/max
- estimated cost saving rate

결과 파일:

```text
reports/routing-eval/routing-eval-<yyyyMMdd-HHmmss>.json
reports/routing-eval/latest.json
```

### 2. Random Probe 평가

정답 라벨이 없는 synthetic 입력으로 분포를 확인한다.

```powershell
corepack pnpm run v2.1:routing:probe
```

확인할 지표:

- category distribution
- tier distribution
- routing reason distribution
- routing latency avg/p50/p95/max
- estimated cost saving rate

결과 파일:

```text
reports/routing-probe/routing-probe-<yyyyMMdd-HHmmss>.json
reports/routing-probe/latest.json
```

### 3. Gateway E2E 성능테스트

실제 Gateway를 거쳐 인증, 정책, 안전검사, 라우팅, 캐시, provider 호출, 로그 저장까지 포함해 본다.

이 단계는 routing-only 측정이 아니라 Gateway 전체 흐름 측정이다.

```powershell
corepack pnpm run v2.1:routing:e2e
```

확인할 지표:

- selected provider/model
- routing outcome/reason
- provider outcome
- cache outcome
- terminal status
- client-observed latency
- gateway latency
- provider latency

결과 파일:

```text
reports/routing-gateway-e2e/routing-gateway-e2e-<yyyyMMdd-HHmmss>.json
reports/routing-gateway-e2e/latest.json
```

주의:

- `v2.1:routing:e2e`는 소수 synthetic prompt로 실제 흐름이 살아있는지 확인하는 smoke/evidence다.
- k6는 이 흐름이 확인된 뒤 반복 부하를 주는 용도로 사용한다.
- k6만으로 라우팅 판단 시간만 정확히 분리할 수는 없다.
- 라우팅 시간만 따로 보려면 routing-only 리포트 또는 Gateway routing metric이 필요하다.

## 실행 순서

멘토님께 공유할 때는 아래 순서가 가장 자연스럽다.

1. `corepack pnpm run v2.1:routing:test`
2. `corepack pnpm run v2.1:routing:probe`
3. Control Plane, Gateway, Redis, Postgres, Provider를 실행한다.
4. `corepack pnpm run v2.1:routing:e2e`
5. 필요하면 `corepack pnpm run v2:k6:smoke`로 Gateway 부하 테스트를 추가한다.

이 순서로 보면 "룰 자체의 정확도/속도"와 "실제 Gateway 흐름"을 분리해서 설명할 수 있다.

## 성공 기준 초안

아직 release gate가 아니라 개발 기준 evidence로만 사용한다.

| 지표 | 목표 초안 | 의미 |
|---|---:|---|
| category accuracy | 0.80 이상 | 업무 유형을 대체로 맞히는지 |
| tier accuracy | 0.80 이상 | low_cost/balanced/high_quality 선택이 맞는지 |
| routing-only latency p95 | 5ms 이하 | 외부 모델 없이 빠르게 판단하는지 |
| Gateway E2E success | 전체 synthetic prompt 성공 | 실제 Gateway 흐름이 끊기지 않는지 |
| cost saving rate | 0보다 큼 | 전부 high_quality로 보내는 것보다 비용 절감 방향인지 |
| failure count | 감소 추세 | 룰 보강 효과가 있는지 |

## 오답 보완 방식

오답이 나오면 바로 코드에 키워드를 덧붙이는 방식으로 처리하지 않는다.

순서는 아래처럼 본다.

1. 평가셋 라벨이 잘못됐는지 확인한다.
2. category가 틀렸는지 tier만 틀렸는지 분리한다.
3. 특정 category에서 반복되는 표현 패턴인지 확인한다.
4. rule policy에 넣을 만큼 일반적인 패턴인지 판단한다.
5. 룰을 보강한 뒤 같은 평가셋을 다시 돌려 전후 결과를 비교한다.

## 보안/계약 주의사항

- 실제 고객 raw prompt를 자동 수집하지 않는다.
- 평가셋은 synthetic 또는 별도로 안전하게 redacted된 데이터만 사용한다.
- API Key, App Token, Authorization header, provider key, raw provider error는 리포트에 넣지 않는다.
- Gateway E2E 리포트에는 raw provider response를 저장하지 않는다.
- 라우팅 상세 룰은 관리자 UI에 노출하지 않는다.
- 이 문서의 label이나 지표명을 곧바로 공식 API/DB/Event/Metrics field로 승격하지 않는다.

## 멘토님께 공유할 요약

라우팅은 외부 모델을 호출하지 않는 룰 기반으로 고도화하고 있습니다.

현재 synthetic 평가셋으로 category/tier 정확도, 오답 샘플, 라우팅 판단 시간, 예상 비용 절감률을 리포트로 뽑을 수 있게 준비했습니다.

추가로 실제 Gateway를 통과하는 E2E 테스트도 분리했습니다. 이 테스트는 synthetic prompt를 Gateway에 보내고, selected provider/model, routing reason, provider outcome, cache outcome, client/gateway/provider latency를 리포트로 저장합니다.

성능테스트는 먼저 routing-only로 판단 시간을 측정하고, 이후 Gateway E2E에서 인증/정책/캐시/provider/log까지 포함한 전체 지연시간을 별도로 보겠습니다. 마지막으로 필요하면 k6로 반복 부하를 걸어보겠습니다.