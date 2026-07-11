# GateLM v2.1 Routing Advanced Plan

> [!NOTE]
> **문서 상태: Versioned offline evaluation plan.** 현재 문서 진입점은 [`docs/current/README.md`](../current/README.md)다. 코드 존재와 production maturity를 구분한다.

## 목표

v2.1 라우팅 고도화의 1차 목표는 외부 모델을 추가 호출하지 않고, 룰 기반 라우팅이 비용 절감에 도움이 되는지 측정 가능한 형태로 만드는 것이다.

이번 단계는 Gateway hot path를 바꾸지 않는다. RuntimeConfig, RuntimeSnapshot, Provider Catalog, Request Log, Metrics 계약도 변경하지 않는다.

## 왜 평가 기반부터 하는가

라우팅의 핵심 가치는 "가능한 요청은 더 싼 모델로 보내고, 필요한 요청만 더 비싼 모델로 올리는 것"이다.

따라서 라우팅 고도화는 감으로 룰을 추가하는 방식이 아니라 아래 숫자로 판단해야 한다.

| 지표 | 의미 |
|---|---|
| category accuracy | 프롬프트 업무 유형을 맞혔는가 |
| category error rate | 프롬프트 업무 유형을 틀린 비율은 얼마인가 |
| tier accuracy | low_cost / balanced / high_quality 선택이 맞았는가 |
| tier error rate | low_cost / balanced / high_quality 선택을 틀린 비율은 얼마인가 |
| routing latency avg/p50/p95 | 라우팅 판단이 충분히 빠른가 |
| estimated cost saving | 전부 high_quality로 보낸 baseline 대비 비용을 얼마나 줄였는가 |
| failures | 어떤 sample이 왜 틀렸는가 |

## 이번 PR 범위

이번 PR은 "룰 기반 라우팅 평가 기반"만 다룬다.

포함한다.

- synthetic 평가셋의 `expectedTier` label
- category/tier 정확도 계산
- category/tier 오답률 계산
- routing latency 평균/p50/p95/max 계산
- high_quality baseline 대비 상대 비용 절감률 계산
- prompt text를 노출하지 않는 failure report
- 멘토 공유용 성능 테스트 시나리오 문서

포함하지 않는다.

- 사용자 프롬프트 자동 수집
- LLM judge 호출
- fine-tuning 또는 classifier 학습
- RuntimeConfig/RuntimeSnapshot 필드 추가
- Gateway 요청 처리 hot path 변경
- provider health overlay 또는 circuit breaker

## 실행 방법

자동으로 평가셋을 돌리고 report 파일을 저장한다.

```powershell
corepack pnpm run v2.1:routing:test
```

위 명령은 아래 파일을 생성한다.

```text
reports/routing-eval/routing-eval-<yyyyMMdd-HHmmss>.json
reports/routing-eval/latest.json
```

기본 평가셋을 터미널 출력으로 확인한다.

```powershell
corepack pnpm run v2.1:routing:evaluate
```

리포트를 파일로 남긴다.

```powershell
corepack pnpm run v2.1:routing:evaluate -- -output reports/routing-eval/report.json
```

최소 정확도 gate를 건다.

```powershell
corepack pnpm run v2.1:routing:evaluate -- -min-accuracy 0.8 -min-tier-accuracy 0.8
```

latency 측정 반복 횟수를 조정한다.

```powershell
corepack pnpm run v2.1:routing:evaluate -- -latency-iterations 100
```

## 리포트 해석

리포트에는 raw prompt, raw response, secret, requestId, traceId를 남기지 않는다.

실패 케이스는 아래 값만 남긴다.

- sampleId
- expectedCategory
- actualCategory
- expectedTier
- actualTier

비용 절감률은 실제 provider 가격표가 아니라 상대 단위 기반 evidence다.

| Tier | Relative cost unit |
|---|---:|
| low_cost | 1 |
| balanced | 3 |
| high_quality | 10 |

`estimated cost saving`은 모든 요청을 high_quality로 보냈을 때와 현재 라우팅 결과를 비교한다.

## 다음 단계

평가셋과 리포트가 준비된 뒤에는 아래 순서로 진행한다.

1. 평가셋을 늘린다.
2. 실패 sample을 보고 룰을 수동으로 보강한다.
3. 같은 평가셋으로 accuracy와 latency가 개선됐는지 비교한다.
4. 실제 성능 테스트 시나리오에서 Gateway 전체 latency와 routing-only latency를 분리해 본다.

## 주의사항

- 라우팅은 safety/masking 책임을 가져오지 않는다.
- 고객 프롬프트는 자동 수집하지 않는다.
- 평가셋은 synthetic 또는 사람이 별도로 준비한 안전한 redacted sample만 사용한다.
- category/tier label은 평가용 evidence이며, 그대로 API/DB 필드로 승격하지 않는다.
- 라우팅 룰 상세는 관리자 UI에 노출하지 않는다.
