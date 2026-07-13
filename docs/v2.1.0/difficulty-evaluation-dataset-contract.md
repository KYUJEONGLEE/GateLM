# GateLM Difficulty Evaluation Dataset Contract

> [!NOTE]
> **문서 상태: Versioned offline evidence contract.** 현재 문서 진입점은 [`docs/current/README.md`](../current/README.md)다. 이 계약은 synthetic/redacted difficulty evaluation 범위이며 Gateway hot path 계약을 새로 정의하지 않는다.

## 1. 상태와 분리 원칙

이 문서는 현재 rule-based baseline과 향후 Logistic Regression·calibration 기반 난이도 분류를 검증하기 위한 독립 offline evidence 계약이다.

기존 [`category-evaluation-dataset-contract.md`](category-evaluation-dataset-contract.md)와 `category-evaluation-record`는 category-only 계약이다. Category record에 `expectedDifficulty`를 추가하거나 difficulty record를 category fixture에 섞지 않는다. 두 계약은 별도 schema, fixture, verifier를 사용한다.

Gateway hot path와 RuntimeSnapshot의 category × difficulty 정책은 [`../routing/contracts.md`](../routing/contracts.md)를 우선한다.

## 2. 데이터 경계

허용하는 데이터는 다음과 같다.

- synthetic fixture
- 사람이 별도로 만든 internal seed
- runtime hot path 밖에서 안전하게 정리한 redacted sample

다음 값과 동작은 금지한다.

- raw prompt, raw response, raw detected value, raw prompt fragment
- API Key, App Token, Provider Key, Authorization header, provider raw error body, 실제 secret
- 고객 프롬프트 자동 sampling/export
- Gateway 요청 경로 안에서 LLM judge 호출

## 3. Difficulty Taxonomy

| Difficulty | 의미 |
|---|---|
| `simple` | 단일 단계 또는 제한된 문맥으로 처리할 수 있는 요청 |
| `complex` | 다단계 분석, 여러 제약, 긴 문맥 또는 복합 판단이 필요한 요청 |

이 값은 offline 정답 label이다. Provider, model, 비용 tier 또는 RuntimeSnapshot 선택을 직접 지정하지 않는다.

## 4. Record Format

Canonical schema는 [`schemas/difficulty-evaluation-record.schema.json`](schemas/difficulty-evaluation-record.schema.json)의 `gatelm.difficulty-evaluation-record.v1`이다. JSONL 한 줄은 하나의 record다.

평가 의미를 구성하는 최소 필수 필드는 다음 네 개다.

| Field | Type | 설명 |
|---|---|---|
| `redactedPrompt` | string | 안전하게 마스킹된 평가 입력. 완전 마스킹된 경우 빈 문자열 가능 |
| `expectedCategory` | string | difficulty 결과를 분석할 때 사용하는 active category 문맥 |
| `expectedDifficulty` | string | `simple` 또는 `complex` 정답 label |
| `language` | string | low-cardinality language bucket |

Provenance와 재현성을 위해 schema는 다음 필드도 필수로 요구한다.

| Field | Type | 설명 |
|---|---|---|
| `schemaVersion` | string | `gatelm.difficulty-evaluation-record.v1` |
| `datasetVersion` | string | difficulty dataset 버전 |
| `sampleId` | string | prompt 내용을 포함하지 않는 안전한 식별자 |
| `labelSource` | string | label 생성 방식 |
| `consentType` | string | offline dataset 포함 근거 |
| `source` | string | sample 출처 |
| `redactionVersion` | string | redaction/masking policy 버전 |
| `createdAt` | string | ISO-8601 timestamp |

`labelConfidence`와 안전한 짧은 `reviewerNote`는 선택 필드다. Schema는 `additionalProperties: false`이며 category 평가 report 필드나 임의 metadata를 허용하지 않는다.

## 5. 허용 값과 조합

`expectedCategory`는 `general`, `code`, `translation`, `summarization`, `reasoning` 중 하나다. 이는 difficulty를 category별로 분석하기 위한 문맥이며 category 정답률 계약을 합치는 의미가 아니다.

`language`는 `en`, `ko`, `mixed`, `unknown` 중 하나다.

Provenance enum과 조합은 category evaluation 계약과 같은 안전한 offline data 경계를 사용한다.

- `labelSource`: `human_review`, `synthetic_fixture`
- `consentType`: `synthetic`, `internal_manual_review`
- `source`: `synthetic_fixture`, `manual_seed`
- `source=synthetic_fixture`이면 `consentType=synthetic`, `labelSource=synthetic_fixture`

## 6. Fixture Provenance

[`fixtures/difficulty-evaluation-dataset.fixture.jsonl`](fixtures/difficulty-evaluation-dataset.fixture.jsonl)은 2026-07-13에 작성한 synthetic contract-smoke fixture다. 다섯 active category 각각에 `simple`, `complex` 한 건씩을 두어 총 10개 record로 구성한다. 실제 고객 prompt를 사용하지 않는다.

이 10개 fixture는 schema, enum, provenance와 기본 evaluation wiring을 검증할 뿐 model 학습, calibrator 선택 또는 threshold 최적화 dataset이 아니다. 이 fixture만으로 encoder/model/calibrator artifact를 만들거나 active runtime을 바꾸면 안 된다.

## 7. Evaluation Report

Difficulty 평가는 다음 명령으로 실행한다.

```powershell
corepack pnpm run v2.1:routing:evaluate:difficulty
```

Report의 `accuracy`와 `errorRate`는 difficulty exact-match 기준이다. Category accuracy 계약을 합치지 않는다. 대신 각 sample의 `expectedCategory`, `actualCategory`, `categoryMatched`를 함께 제공하여 category 오분류가 difficulty 결과에 미친 영향을 구분한다.

`byCategoryDifficulty`는 expected category와 expected difficulty 조합별로 `correct`, `incorrect`, `total`, `accuracy`, `incorrectRate`를 집계한다. 각 셀의 correct/incorrect는 difficulty label 일치 여부를 뜻한다.

`directionalErrors`는 다음 분모를 명시적으로 포함한다.

- `simpleToComplexRate = simpleToComplexCount / simpleExpectedSamples`
- `complexToSimpleRate = complexToSimpleCount / complexExpectedSamples`

`classificationLatency`의 단위는 microseconds이며 category, difficulty, 두 분류를 연속 실행한 total의 avg/p50/p95/max를 각각 제공한다. 이 시간에는 fixture parsing, 파일 I/O, report 직렬화를 포함하지 않는다.

현재 evaluation 명령의 smoke/baseline 결과는 새 encoder/model/calibrator artifact의 학습 또는 승격 evidence가 아니다.

### 7.1 Probability Calibration And Promotion Evidence

Artifact 승격 후 canonical 예측 score는 `difficulty-logistic-v1`의 단일 전역 regularized Logistic Regression이 출력한 미보정 `sigmoid(w·x+b)`에 `difficulty-calibration-v1`이 선택한 전역 calibrator를 적용한 inclusive `0.0~1.0`의 최종 `DifficultyResult.ComplexityScore`다. Raw logit, 미보정 probability와 calibrator 중간값은 report에 포함하지 않는다.

Dataset의 정답은 계속 `expectedDifficulty`뿐이다. `expectedComplexityScore`, `expectedProbability`, `expectedRawScore` 또는 ground-truth probability를 schema와 fixture에 추가하지 않는다. Calibrated `0.8`은 평가 모집단에서 비슷한 score를 받은 표본의 실제 `complex` 비율이 약 80%에 가깝도록 보정됐다는 뜻이지 개별 요청의 절대적 보장이 아니다. Dataset 구성, sample size, category 분포와 distribution drift를 함께 고려해야 한다.

Model과 calibration evidence는 prompt family 단위로 분리된 다음 세 split을 사용한다.

- `train`: 단일 전역 regularized Logistic Regression 학습
- `calibration`: 단일 전역 calibrator 후보 비교, 선택과 최종 fit
- `holdout`: 모든 선택이 끝난 뒤 final gate

같은 prompt family나 단순 변형을 서로 다른 split에 두지 않는다. Split은 versioned deterministic family rule로 재현해야 한다. 현재 10건 contract-smoke fixture는 어느 split의 학습·선택 근거로도 사용하지 않는다.

Calibrator candidate 목록, log-loss tie tolerance와 단순성 순서는 evidence 실행 전에 versioned policy로 고정한다. Identity calibrator를 baseline 후보에 포함하고 calibration split 내부에서 deterministic family-grouped cross-validation을 수행한다. 평균 log loss가 가장 낮은 후보를 선택하며 허용 오차 안에서 같으면 평균 Brier score가 낮은 후보, 그래도 같으면 versioned 순서상 더 단순한 후보를 고른다. 선택된 후보는 calibration split 전체로 다시 fit한다. Holdout을 본 뒤 candidate 목록, feature encoder, model 또는 calibrator를 다시 선택하지 않으며 수정이 필요하면 dataset/split/artifact version을 올리고 처음부터 반복한다.

초기 threshold policy는 모든 category가 공유하는 `difficulty-threshold-v1 = 0.5`다. `ComplexityScore >= 0.5`이면 `complex`, 미만이면 `simple`이다. `0.5`는 evidence-selected optimum이 아닌 bootstrap/default 값이다. 이후 evidence가 다른 값을 지지하면 v1을 변경하지 않고 새 global threshold policy version과 immutable artifact를 만든다. Category별 threshold, calibrator 또는 model은 평가 candidate로도 만들지 않는다.

Promotion report는 최소한 다음 provenance와 결과를 선언한다.

- `scorePolicyVersion = difficulty-logistic-v1`
- `calibrationPolicyVersion = difficulty-calibration-v1`
- `thresholdPolicyVersion = difficulty-threshold-v1`
- encoder/model/calibrator artifact version과 content hash
- coefficient, intercept, regularization/solver 및 calibrator 설정을 재현할 artifact reference
- candidate 목록, tie tolerance와 단순성 순서
- dataset version과 split policy version
- train/calibration/holdout sample 및 family 수
- 전체 및 category별 sample count, log loss와 Brier score
- score bin별 평균 `ComplexityScore`와 실제 `complex` 비율
- `0.5` 기준 전체 및 category별 directional error
- oracle-category와 end-to-end 결과
- classification latency

Untouched holdout에서 candidate의 전체 및 각 category `complex -> simple` count/rate가 현재 rule-based baseline보다 증가하면 runtime으로 승격하지 않는다. Score가 finite하지 않거나 `0.0~1.0` 밖이면 승격하지 않는다. Calibration 지표가 좋아도 이 safety gate를 우회할 수 없다.

Approved offline report는 sampleId, 허용된 redactedPrompt, expected/actual category와 difficulty, 최종 `ComplexityScore`와 위 집계를 포함할 수 있다. Category별 집계는 calibration 품질과 회귀를 관찰하기 위한 evidence일 뿐 category별 정책을 만드는 근거가 아니다. Raw logit/probability, Category diagnostics, provider/model/modelRef/tier/catalog, resolved target, 실제 가격, tenant budget, raw matched phrase, 정규화 문자열, token, 원문/encoded feature, feature별 coefficient contribution, raw prompt/response 또는 민감한 error detail은 추가하지 않는다.

## 8. 검증

Difficulty 계약, schema 또는 fixture를 변경하면 다음을 실행한다.

```powershell
corepack pnpm run verify:v2.1-difficulty-eval
corepack pnpm run verify:v2.1-category-eval
corepack pnpm run verify:v2-docs
corepack pnpm run v2.1:routing:evaluate:difficulty
```

Difficulty verifier는 schema identity, 필수 필드, `simple | complex` enum, 추가 필드 금지, provenance 조합과 secret 형태 문자열을 검사한다. Category verifier는 category fixture에 `expectedDifficulty`가 섞이면 실패해야 한다.

## 9. 범위 밖

- 고객 데이터 자동 수집, online/runtime 학습 또는 자동 재보정
- 제품 GA나 release 전체를 선언하는 별도 정확도/SLA 기준
- provider/model/tier 선택 평가
- provider 가격, 실제 USD 또는 tenant budget을 포함한 threshold 최적화
- category별 model, calibrator 또는 threshold 최적화
- Gateway API, DB, Event, Metrics 계약 변경
- RuntimeConfig/RuntimeSnapshot 정책 변경
- 외부 API 또는 제품 diagnostics의 complexity score 노출
