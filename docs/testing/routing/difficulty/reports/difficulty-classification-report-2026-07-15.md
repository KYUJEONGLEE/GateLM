# Difficulty Classification Contract-Smoke Baseline — 2026-07-15

## Status

| Field | Value |
|---|---|
| Evidence class | Offline contract smoke |
| Performance claim eligible | `false` |
| Promotion gate applicable | `false` |
| Training eligible | `false` |
| Measured at | `2026-07-15T13:05:14.8974215Z` (`2026-07-15 22:05:14 KST`) |
| Branch | `feat/routing-difficulty-update` |
| Base commit | `940be8f36e0b2c7ec9c7e298449e3a7ceb4c7c64` |
| Local `origin/dev` | `b650d2cafd4e37cd6469e959bbd5ad4fc18e8e8d` |
| Worktree | Dirty; uncommitted difficulty changes were included in the measurement |

이 보고서는 기본 10건 difficulty fixture의 schema와 evaluator 연결을 확인한 smoke baseline이다. 모델 품질, production readiness, threshold 선택 또는 runtime 승격 근거가 아니다.

## Dataset And Reproduction

- Dataset: `docs/v2.1.0/fixtures/difficulty-evaluation-dataset.fixture.jsonl`
- Dataset SHA-256: `d5cc57d833a574af1c2d34575842eee74ce5c216c9fb386419c2f4c1409acc25`
- Classifier: `rule_based_category_aware_difficulty_classifier`
- Classifier version: `rule_based_difficulty_classifier_v1`
- Raw report: `reports/routing-difficulty-eval/difficulty-eval-20260715-220459.json`
- Raw/`latest.json` SHA-256: `32ab8155f726867574f54c22e088f1adaaf65571207517f83860d5ec77737760`
- Aggregate metrics: `docs/testing/routing/difficulty/metrics/difficulty-eval-2026-07-15.json`

```powershell
corepack pnpm run v2.1:routing:test:difficulty
```

명령은 timestamp가 포함된 원본과 가장 최근 성공 결과의 복사본을 함께 생성한다.

```text
reports/routing-difficulty-eval/difficulty-eval-<yyyyMMdd-HHmmss>.json
reports/routing-difficulty-eval/latest.json
```

## Difficulty Result

| Metric | Result |
|---|---:|
| Total | 10 |
| Correct | 10 |
| Incorrect | 0 |
| Accuracy | 1.00 |
| Error rate | 0.00 |
| `simple -> complex` | 0/5 (0.00) |
| `complex -> simple` | 0/5 (0.00) |

## Category × Difficulty

각 cell에는 한 건만 있으므로 1.00이라는 값 자체를 일반적인 성능으로 해석할 수 없다.

| Expected category | Simple | Complex |
|---|---:|---:|
| `general` | 1/1 (1.00) | 1/1 (1.00) |
| `code` | 1/1 (1.00) | 1/1 (1.00) |
| `translation` | 1/1 (1.00) | 1/1 (1.00) |
| `summarization` | 1/1 (1.00) | 1/1 (1.00) |
| `reasoning` | 1/1 (1.00) | 1/1 (1.00) |

## Category Context

Difficulty는 10건 모두 맞았지만 선행 category는 7건만 일치했다. 아래 세 건은 `categoryMatched=false`였으나 difficulty 결과에는 영향을 주지 않았다.

| Sample ID | Expected category | Actual category | Difficulty | Difficulty matched |
|---|---|---|---|---|
| `difficulty_general_complex_001` | `general` | `reasoning` | `complex -> complex` | `true` |
| `difficulty_reasoning_simple_001` | `reasoning` | `general` | `simple -> simple` | `true` |
| `difficulty_reasoning_complex_001` | `reasoning` | `general` | `complex -> complex` | `true` |

Difficulty 오분류 sample은 없다. 더 큰 평가셋에서는 실패 sample별 expected/actual difficulty와 `categoryMatched`를 함께 봐야 category 오분류의 전파 여부를 구분할 수 있다.

## Classification Latency

단위는 microseconds다. Fixture parsing, 파일 I/O와 report 직렬화는 포함하지 않는다.

| Path | Avg | P50 | P95 | Max | Warm-up | Batch size | Measured samples |
|---|---:|---:|---:|---:|---:|---:|---:|
| Category | 193.0857 | 187.3938 | 302.9281 | 391.3531 | 5 | 32 | 1,000 |
| Difficulty | 0.0454 | 0.0010 | 0.2447 | 0.3947 | 5 | 4,096 | 1,000 |
| Total | 215.3309 | 203.6219 | 359.2906 | 484.8781 | 5 | 32 | 1,000 |

Rule-based classifier는 calibrated probability를 제공하지 않으므로 calibration 지표는 적용되지 않는다. 절대 latency는 host load에 따라 달라질 수 있으며 이 한 번의 smoke 측정을 성능 기준으로 사용하지 않는다.

## Limits And Security

- 기본 fixture는 다섯 category × 두 difficulty의 wiring만 확인하는 10건 contract smoke다.
- 이 결과는 model training, calibrator 비교, threshold 선택, holdout gate 또는 runtime promotion에 사용할 수 없다.
- Training/calibration split이나 이미 결과를 확인한 holdout을 새 성능 보고서에 재사용하지 않는다.
- 실제 성능 평가는 provenance와 독립성을 갖춘 별도 evaluation dataset에서 수행해야 한다.
- 원본과 aggregate에는 synthetic/redacted fixture만 사용했다. Raw prompt, raw response, credential, provider raw error body와 실제 secret은 포함하지 않았다.
- 측정 worktree가 dirty였으므로 base commit만으로 결과가 완전히 재현된다고 주장하지 않는다.

## Interpretation

이번 결과는 difficulty evaluator와 timestamp/`latest.json` 저장 경로가 정상 동작하고 directional error, category × difficulty, latency와 `categoryMatched`가 report에 투영된다는 것만 확인한다. 다음 품질 평가는 독립된 승인 evaluation dataset을 먼저 마련한 뒤 같은 명령과 report shape으로 수행한다.
