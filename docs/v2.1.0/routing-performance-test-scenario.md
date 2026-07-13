# GateLM Routing Performance Test Scenario

> [!NOTE]
> **문서 상태: Versioned evidence scenario.** 현재 문서 진입점은 [`docs/current/README.md`](../current/README.md)다. 수치와 결과는 실행 commit과 환경을 함께 확인한다.

## 목적

멘토 공유용 라우팅 성능 테스트 시나리오다.

이번 테스트는 외부 LLM 호출 성능이 아니라 Gateway 내부 룰 기반 category 분류가 충분히 정확하고 빠른지 확인한다. Category 결과는 분류 evidence로만 확인하며 provider, model, tier 선택을 평가하지 않는다.

## 테스트 질문

| 질문 | 확인 지표 |
|---|---|
| 한국어 룰 기반 분류가 맞는가 | category accuracy |
| 어떤 category끼리 혼동하는가 | confusion matrix |
| 판단 근거가 검토 가능한가 | category diagnostics |
| 판단 시간이 짧은가 | category classifier latency p50/p95 |
| 어떤 케이스가 틀리는가 | failures sampleId |

## 실행 전제

- Docker, DB, Gateway 서버가 필요하지 않다.
- 실제 OpenAI API Key가 필요하지 않다.
- 고객 prompt를 자동 수집하지 않는다.
- 실제 업무에서 자주 나오는 표현을 흉내 낸 synthetic fixture만 사용한다.
- 명확한 키워드 샘플뿐 아니라 애매한 표현, 혼합 의도, false positive 후보를 포함한다.
- Gateway hot path를 실행하지 않고 category classifier만 실행한다.

## 현재 평가셋 성격

`docs/v2.1.0/fixtures/category-evaluation-dataset.fixture.jsonl`은 쉬운 정답표가 아니라 룰 보완 지점을 찾기 위한 현실형 평가셋이다.

따라서 정확도가 100%가 나오지 않는 것이 정상이며, 실패 샘플은 category rule과 label을 검토하기 위한 후보로 본다.

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

저장되는 JSON 리포트는 category-only 기계용 필드와 사람이 바로 읽을 수 있는 `한글요약` 블록을 함께 포함한다.

각 샘플에는 synthetic/redacted 입력인 `redactedPrompt`를 포함한다. 이 필드는 룰 보정용 평가 문맥이며, 실제 고객 raw prompt를 저장한다는 의미가 아니다.

정확도 gate 포함:

```powershell
corepack pnpm run v2.1:routing:evaluate -- -min-accuracy 0.8
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
| category classifier latency p95 | 5ms 이하 |
| forbidden data in report | 없어야 함 |

이 기준은 첫 평가셋 규모가 작기 때문에 release gate가 아니라 development evidence로만 사용한다.

## 리포트 예시

```json
{
  "totalSamples": 125,
  "correctSamples": 120,
  "incorrectSamples": 5,
  "accuracy": 0.96,
  "errorRate": 0.04,
  "confusionMatrix": {
    "code": {
      "code": 120,
      "reasoning": 5
    }
  },
  "latency": {
    "iterations": 20,
    "samples": 2500,
    "avgMicros": 40.2,
    "p50Micros": 30.1,
    "p95Micros": 90.4
  },
  "samples": [
    {
      "sampleId": "synthetic_code_0001",
      "expectedCategory": "code",
      "actualCategory": "code",
      "categoryDiagnostics": {
        "topCategory": "code",
        "topScore": 9,
        "scoreMargin": 4,
        "confidence": "high"
      },
      "matched": true
    }
  ]
}
```

숫자는 예시이며 실제 결과는 실행 환경과 룰 변경에 따라 달라질 수 있다.

## 실패 케이스 처리

리포트에는 synthetic/redacted prompt text만 넣는다.

개발자는 `sampleId`를 보고 평가셋 파일에서 synthetic prompt를 확인한 뒤 아래 중 하나를 수행한다.

| 상황 | 처리 |
|---|---|
| label이 잘못됨 | 평가셋 label 수정 |
| 룰이 부족함 | category policy rule 보강 |
| 점수 margin이 낮거나 ambiguity가 반복됨 | category diagnostics와 confusion matrix를 함께 검토 |
| 샘플이 너무 모호함 | active fallback인 `general` label 또는 제거 검토 |

## 후속 확장

실제 Gateway E2E 성능 테스트는 별도 단계에서 진행한다.

그때는 아래 지표를 분리해서 본다.

- category-classifier latency
- Gateway total latency
- provider latency
- cache hit latency
- safety/masking latency
- request log write latency

이번 시나리오는 그중 category-classifier 기준선을 먼저 만든다. Report에는 tier, cost estimate, provider/model 선택 또는 routing reason을 포함하지 않는다.
