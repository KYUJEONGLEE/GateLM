# GateLM Difficulty Evaluation Dataset Contract

> [!NOTE]
> **문서 상태: Versioned offline evidence contract.** 현재 문서 진입점은 [`docs/current/README.md`](../current/README.md)다. 이 계약은 synthetic/redacted difficulty evaluation 범위이며 Gateway hot path 계약을 새로 정의하지 않는다.

## 1. 상태와 분리 원칙

이 문서는 현재 rule-based baseline과 향후 Logistic Regression·calibration 기반 난이도 분류를 검증하기 위한 독립 offline evidence 계약이다.

기존 [`category-evaluation-dataset-contract.md`](category-evaluation-dataset-contract.md)와 `category-evaluation-record`는 category-only 계약이다. Category record에 `expectedDifficulty`를 추가하거나 difficulty record를 category fixture에 섞지 않는다. 두 계약은 별도 schema, fixture, verifier를 사용한다.

사람 검토의 canonical source record, prompt family, instruction/payload 경계, semantic label, review 상태와 training eligibility는 [`difficulty-label-guide.md`](difficulty-label-guide.md)가 정의한다. 이 문서의 `difficulty-evaluation-record`는 evaluator가 필요한 필드만 받는 projection이며 annotation source schema를 대신하거나 합치지 않는다.

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
- `source=synthetic_fixture`이면 항상 `consentType=synthetic`을 유지한다.
- 검토되지 않은 synthetic label은 `labelSource=synthetic_fixture + pending + reviewerCount=0`이다.
- Synthetic prompt를 사람이 승인한 파생 training candidate는 source를 바꾸지 않고 `labelSource=human_review`와 실제 review 상태를 기록한다.

## 6. Fixture Provenance

[`fixtures/difficulty-evaluation-dataset.fixture.jsonl`](fixtures/difficulty-evaluation-dataset.fixture.jsonl)은 2026-07-13에 작성한 synthetic contract-smoke fixture다. 다섯 active category 각각에 `simple`, `complex` 한 건씩을 두어 총 10개 record로 구성한다. 실제 고객 prompt를 사용하지 않는다.

이 10개 fixture는 schema, enum, provenance와 기본 evaluation wiring을 검증할 뿐 model 학습, calibrator 선택 또는 threshold 최적화 dataset이 아니다. 이 fixture만으로 encoder/model/calibrator artifact를 만들거나 active runtime을 바꾸면 안 된다.

[`fixtures/difficulty-label-contract-smoke.fixture.jsonl`](fixtures/difficulty-label-contract-smoke.fixture.jsonl)과 [`fixtures/difficulty-label-contract-smoke.manifest.json`](fixtures/difficulty-label-contract-smoke.manifest.json)은 [`difficulty-label-guide.md`](difficulty-label-guide.md)의 필수 label, 고정 4-head·12차원 class order, empty-instruction fail-closed, 다섯 category, 두 difficulty와 모든 required evaluation slice를 검증하는 10건/5-family synthetic smoke다. 모든 record가 `pending`이고 approved human-reviewed family는 0이므로 학습에 사용할 수 없다.

[`fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl`](fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl)은 별도로 재생 가능한 **training-tooling smoke**다. 다섯 category × 두 difficulty cell에 각각 50건을 두어 총 500건이며 simple/complex는 각 250건이다. 모든 record가 synthetic이고 `human review pending`이므로 실제 model 학습 데이터, calibrator/threshold 선택 evidence 또는 runtime promotion evidence가 아니다. [`../../scripts/dev/generate-v2.1-difficulty-training-pilot.mjs`](../../scripts/dev/generate-v2.1-difficulty-training-pilot.mjs)로 결정론적으로 다시 생성한다.

[`fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json`](fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json)은 이 dataset을 `trainingEligible=false`, `labelCoverageStatus=unlabeled`, approved human-reviewed family 0으로 고정한다. [`fixtures/difficulty-training-split-manifest.v1.json`](fixtures/difficulty-training-split-manifest.v1.json)의 `train` 15 family/300건, `calibration` 5 family/100건, `holdout` 5 family/100건은 ephemeral tooling 경로를 검사하는 smoke partition일 뿐 production evidence split이 아니다.

### 6.1 Family-level training readiness

실제 training candidate는 record 수가 아니라 `difficulty-prompt-family.v1`의 독립 family를 기준으로 승인한다. 같은 primary intent의 paraphrase, synonym, language variant, negation, payload variant와 simple/complex contrast를 split 사이에 나누지 않는다. Manifest는 전체/승인 family 수뿐 아니라 category, difficulty, category × difficulty, language와 required evaluation slice별 family 수를 보고해야 한다.

`minimumFamilyPolicyStatus=decision_required`인 모든 manifest는 `trainingEligible=false`여야 한다. 2026-07-14 owner-approved candidate는 `difficulty-training-minimum-family-policy.2026-07-14.v1`을 사용하며, 전체 89 family, category별 15, category × difficulty별 9, 지원 language별 50, required slice별 1 approved family 이상을 요구한다. [`training/difficulty-training-candidate-500.owner-approved.manifest.json`](training/difficulty-training-candidate-500.owner-approved.manifest.json)이 이 기준과 `difficulty-family-constrained-split.2026-07-15.v1`, seed `20260715`, family-disjoint train 300/calibration 100/holdout 100 partition을 고정한다.

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

Hybrid target의 canonical 예측 score는 세 경로를 가진다. Empty 또는 의미 없는 입력은 `0.0 + simple`, 명백한 hard-complex 구조 evidence는 `1.0 + complex` sentinel을 반환한다. 나머지 요청은 `difficulty-logistic-v1`의 단일 전역 regularized Logistic Regression이 출력한 미보정 `sigmoid(w·x+b)`에 `difficulty-calibration-v1`이 선택한 전역 calibrator를 적용한 inclusive `0.0~1.0`의 최종 `DifficultyResult.ComplexityScore`를 사용한다. Raw logit, 미보정 probability와 calibrator 중간값은 report에 포함하지 않는다.

Dataset의 정답은 계속 `expectedDifficulty`뿐이다. `expectedComplexityScore`, `expectedProbability`, `expectedRawScore` 또는 ground-truth probability를 schema와 fixture에 추가하지 않는다. Model path의 calibrated `0.8`은 평가 모집단에서 비슷한 score를 받은 표본의 실제 `complex` 비율이 약 80%에 가깝도록 보정됐다는 뜻이지 개별 요청의 절대적 보장이 아니다. Dataset 구성, sample size, category 분포와 distribution drift를 함께 고려해야 한다. 두 sentinel은 calibration bin, log loss와 Brier score에서는 제외하고 end-to-end accuracy와 directional error에는 포함한다.

향후 승인된 training candidate의 model과 calibration evidence는 prompt family 단위로 분리된 다음 세 split을 사용한다. 현재 500건 smoke의 동명 partition은 이 evidence가 아니다.

- `train`: 단일 전역 regularized Logistic Regression 학습
- `calibration`: 단일 전역 calibrator 후보 비교, 선택과 최종 fit
- `holdout`: 모든 선택이 끝난 뒤 final gate

같은 prompt family나 단순 변형을 서로 다른 split에 두지 않는다. Split은 versioned deterministic family rule로 재현해야 한다. Owner-approved candidate의 `difficulty-family-constrained-split.2026-07-15.v1`은 difficulty label을 family key에서 제외하고 train 300/calibration 100/holdout 100을 exact count로 배정해 cross-label contrast 누출도 금지한다. 현재 10건 contract-smoke fixture는 어느 split의 학습·선택 근거로도 사용하지 않는다.

Calibrator candidate는 `platt`, `isotonic` 두 종류만 허용하며 log-loss tie tolerance와 단순성 순서는 evidence 실행 전에 versioned policy로 고정한다. Calibration split 내부에서 deterministic family-grouped cross-validation을 수행한다. 평균 log loss가 가장 낮은 후보를 선택하며 허용 오차 안에서 같으면 평균 Brier score가 낮은 후보, 그래도 같으면 Platt를 고른다. 한 후보의 fit 또는 검증이 실패하면 유효한 다른 후보를 사용할 수 있지만 둘 다 실패하면 artifact를 만들지 않고 학습을 실패시킨다. Identity calibrator와 무보정 fallback은 없다. 선택된 후보는 calibration split 전체로 다시 fit한다.

Untouched Holdout 결과를 확인한 시점에 해당 Holdout은 freeze된 artifact의 final evidence로 소비된 것으로 본다. 그 결과를 근거로 feature 정의·구성, model, calibrator 또는 threshold 중 하나라도 변경하면 기존 run의 연장이 아니라 새 evidence run이다. 이 경우 dataset/split과 immutable artifact version을 올리고, 기존에 결과를 확인한 Holdout을 포함하지 않는 새 untouched Holdout을 준비해 선택 절차부터 다시 수행한다. 이미 본 Holdout으로 새 artifact를 반복 튜닝하거나 선택·검증·승격 evidence를 다시 만들면 Holdout leakage로 간주한다.

42D·106D·118D feature candidate의 선택도 Holdout을 사용하지 않는다. 각 candidate에서 선택된 calibrator의 calibration family-grouped CV 평균 log loss가 가장 낮은 candidate를 고르고, 허용 오차 안에서 같으면 평균 Brier score가 낮은 candidate, 그래도 같으면 더 낮은 dimension을 고른다. 이 선택 정책은 `difficulty-semantic-candidate-selection.2026-07-15.v1`로 고정한다. Candidate별 report에는 Holdout outcome을 만들지 않으며, candidate·calibrator·threshold와 component hash를 freeze한 뒤 선택된 단 하나의 candidate만 untouched Holdout 100건에 적용한다.

두 후보의 입력은 모두 Logistic Regression의 미보정 `raw_probability`다. Isotonic은 exact-equal score를 동일 가중 sample count로 먼저 묶고, complex 비율이 감소하는 인접 block을 PAVA로 병합한다. Artifact의 x 경계는 각 block의 포함 하한이며 runtime은 floor lookup과 양끝 clipping만 사용하고 선형 보간하지 않는다. Single constant block도 유효하다. Score 반올림, epsilon grouping, 고정 interval, `labelConfidence` weighting과 사후 small-block 자동 병합은 사용하지 않는다. 과세분화는 group-CV 회귀와 fold별 block count·최소 block 표본 수로 확인하며, 선택된 Isotonic 전체 fit의 block sample count를 aggregate report에 둘 수 있다. Raw probability, logit과 실제 score 경계는 report에 넣지 않는다.

초기 threshold policy는 모든 category가 공유하는 `difficulty-threshold-v1 = 0.45`다. `ComplexityScore >= 0.45`이면 `complex`, 미만이면 `simple`이다. `0.45`는 evidence-selected optimum이 아닌 bootstrap/default 값이다. 이후 evidence가 다른 값을 지지하면 v1을 변경하지 않고 새 global threshold policy version과 immutable artifact를 만든다. Category별 threshold, calibrator 또는 model은 평가 candidate로도 만들지 않는다.

Threshold selection은 calibrator candidate 선택·fit과 분리한다. 변경 후보의 threshold grid, 목적 함수, cost ratio, tie-break와 safety constraint를 evidence run 전에 고정하고, 선택된 model·calibrator의 family-grouped calibration OOF calibrated score만 사용한다. 이 절차에서 승인 후보를 만들면 이름은 `difficulty-threshold-v2`로 제안하며, category별 threshold로 분기하지 않는다. Untouched Holdout은 freeze된 threshold의 final gate에만 사용하고 threshold 선택·재조정에는 사용하지 않는다. Holdout 결과로 `difficulty-threshold-v2` 값을 고르면 해당 Holdout은 final evidence 자격을 잃는다.

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
- `0.45` 기준 전체 및 category별 directional error
- oracle-category와 end-to-end 결과
- classification latency
- `redactedPrompt` rune length가 120보다 큰 expected simple인 긴 simple segment
- `redactedPrompt` rune length가 120 이하인 expected complex인 짧은 complex segment

Untouched holdout에서 candidate의 전체 및 각 category `complex -> simple` count/rate가 현재 rule-based baseline보다 증가하면 runtime으로 승격하지 않는다. Score가 finite하지 않거나 `0.0~1.0` 밖이면 승격하지 않는다. Calibration 지표가 좋아도 이 safety gate를 우회할 수 없다.

Approved offline report는 sampleId, 허용된 redactedPrompt, expected/actual category와 difficulty, model-path score 또는 sentinel인 최종 `ComplexityScore`, current runtime과 shadow candidate 비교와 위 집계를 포함할 수 있다. Category별 집계는 calibration 품질과 회귀를 관찰하기 위한 evidence일 뿐 category별 정책을 만드는 근거가 아니다. Raw logit/probability, Category diagnostics, provider/model/modelRef/tier/catalog, resolved target, 실제 가격, tenant budget, raw matched phrase, 정규화 문자열, token, 원문/encoded feature, feature별 coefficient contribution, raw prompt/response 또는 민감한 error detail은 추가하지 않는다.

## 8. 검증

Difficulty 계약, schema 또는 fixture를 변경하면 다음을 실행한다.

```powershell
corepack pnpm run verify:v2.1-difficulty-eval
corepack pnpm run verify:v2.1-category-eval
corepack pnpm run verify:v2-docs
corepack pnpm run v2.1:routing:evaluate:difficulty
```

Difficulty verifier는 evaluation schema identity, 필수 필드, `simple | complex` enum, 추가 필드 금지, provenance 조합과 secret 형태 문자열을 검사한다. 또한 label source의 category–semantic 조합, 고정된 네 semantic head class order, empty instruction의 `not_applicable` fail-closed, instruction/payload 경계, slice와 review 상태, family·coverage 집계, dataset hash 및 500건 pilot의 `trainingEligible=false` manifest를 검사한다. Category verifier는 category fixture에 `expectedDifficulty`가 섞이면 실패해야 한다.

## 9. 범위 밖

- 고객 데이터 자동 수집, online/runtime 학습 또는 자동 재보정
- 제품 GA나 release 전체를 선언하는 별도 정확도/SLA 기준
- provider/model/tier 선택 평가
- provider 가격, 실제 USD 또는 tenant budget을 포함한 threshold 최적화
- category별 model, calibrator 또는 threshold 최적화
- Gateway API, DB, Event, Metrics 계약 변경
- RuntimeConfig/RuntimeSnapshot 정책 변경
- 외부 API 또는 제품 diagnostics의 complexity score 노출
