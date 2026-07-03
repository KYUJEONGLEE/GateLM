# GateLM Routing Performance Test Scenario

## 목적

멘토 공유용 라우팅 성능 테스트 시나리오다.

이번 테스트는 외부 LLM 호출 성능이 아니라, Gateway 내부 룰 기반 라우팅 판단이 충분히 빠르고 비용 절감 방향으로 동작하는지 확인한다.

## 테스트 질문

| 질문 | 확인 지표 |
|---|---|
| 룰 기반 분류가 맞는가 | category accuracy |
| 모델 tier 선택이 맞는가 | tier accuracy |
| 판단 시간이 짧은가 | routing latency p50/p95 |
| 비용 절감 방향인가 | high_quality baseline 대비 estimated cost saving |
| 어떤 케이스가 틀렸는가 | failures sampleId |

## 실행 전제

- Docker, DB, Gateway 서버가 필요하지 않다.
- 실제 OpenAI API Key가 필요하지 않다.
- 고객 prompt를 자동 수집하지 않는다.
- synthetic fixture만 사용한다.
- Gateway hot path를 실행하지 않고 routing domain logic만 실행한다.

## 실행 명령

자동 report 저장:

```powershell
corepack pnpm run v2.1:routing:test
```

위 명령은 아래 파일을 생성한다.

```text
reports/routing-eval/routing-eval-<yyyyMMdd-HHmmss>.json
reports/routing-eval/latest.json
```

기본 평가:

```powershell
corepack pnpm run v2.1:routing:evaluate
```

리포트 파일 생성:

```powershell
corepack pnpm run v2.1:routing:evaluate -- -output reports/routing-eval/report.json
```

정확도 gate 포함:

```powershell
corepack pnpm run v2.1:routing:evaluate -- -min-accuracy 0.8 -min-tier-accuracy 0.8
```

latency 반복 횟수 증가:

```powershell
corepack pnpm run v2.1:routing:evaluate -- -latency-iterations 100
```

## 성공 기준 초안

| 지표 | 초안 기준 |
|---|---:|
| category accuracy | 0.80 이상 |
| category error rate | 0.20 이하 |
| tier accuracy | 0.80 이상 |
| tier error rate | 0.20 이하 |
| routing latency p95 | 5ms 이하 |
| estimated cost saving | 0보다 커야 함 |
| forbidden data in report | 없어야 함 |

이 기준은 첫 평가셋 규모가 작기 때문에 release gate가 아니라 development evidence로만 사용한다.

## 리포트 예시

```json
{
  "totalSamples": 1000,
  "accuracy": 1,
  "tierAccuracy": 1,
  "tierErrorRate": 0,
  "latency": {
    "iterations": 20,
    "samples": 100000,
    "avgMicros": 40.2,
    "p50Micros": 30.1,
    "p95Micros": 90.4
  },
  "costEstimate": {
    "baselineTier": "high_quality",
    "baselineCostUnits": 10000,
    "actualCostUnits": 4250,
    "savedCostUnits": 5750,
    "savingRate": 0.575
  }
}
```

숫자는 예시이며 실제 결과는 실행 환경에 따라 달라질 수 있다.

## 실패 케이스 처리

실패 리포트에는 prompt text를 남기지 않는다.

개발자는 `sampleId`를 보고 평가셋 파일에서 synthetic prompt를 확인한 뒤 아래 중 하나를 수행한다.

| 상황 | 처리 |
|---|---|
| label이 틀림 | 평가셋 label 수정 |
| 룰이 부족함 | category policy rule 보강 |
| tier 기대값이 애매함 | tier 기준 문서 보강 |
| 샘플이 너무 모호함 | unknown 또는 제거 검토 |

## 후속 확장

실제 Gateway E2E 성능 테스트는 별도 단계에서 진행한다.

그때는 아래 지표를 분리해서 본다.

- routing-only latency
- Gateway total latency
- provider latency
- cache hit latency
- safety/masking latency
- request log write latency

이번 시나리오는 그중 routing-only 기준선을 먼저 만든다.
