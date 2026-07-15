# GateLM Difficulty Logistic Training Boundary

| Field | Value |
|---|---|
| Status | Candidate C 118D selected and generated as an inactive Go shadow-preparation bundle; not runtime-promoted |
| Model policy | `difficulty-logistic-v1` |
| Feature contract | `difficulty-feature-vector.v1` (42 dimensions) |
| Calibration policy | `difficulty-calibration-v1` |
| Threshold policy | `difficulty-threshold-v1 = 0.45` |
| Runtime status | Existing rule-based difficulty classifier remains active |

이 문서는 [`classification-pipeline.md`](classification-pipeline.md)의 target 계산을 실제 offline 학습과 generated Go artifact로 연결하는 준비 경계를 설명한다. Selected coefficient, calibrator와 holdout selection evidence가 존재하더라도 이 문서와 tooling만으로 product runtime 승격을 뜻하지 않는다.

## Dataset Roles

- [`../v2.1.0/fixtures/difficulty-evaluation-dataset.fixture.jsonl`](../v2.1.0/fixtures/difficulty-evaluation-dataset.fixture.jsonl): 10건 contract smoke. 학습에 사용하지 않는다.
- [`../v2.1.0/difficulty-label-guide.md`](../v2.1.0/difficulty-label-guide.md): 실제 학습 데이터가 따라야 하는 label, review, family와 slice 계약이다.
- [`../v2.1.0/fixtures/difficulty-label-contract-smoke.fixture.jsonl`](../v2.1.0/fixtures/difficulty-label-contract-smoke.fixture.jsonl): 필수 label/slice wiring을 검증하는 10건/5-family smoke. 학습에 사용하지 않는다.
- [`../v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl`](../v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl): 500건 synthetic training-tooling smoke. 전부 `human review pending`이며 model/calibrator/threshold evidence가 아니다.
- [`../v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json`](../v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json): 500건을 `trainingEligible=false`, approved human-reviewed family 0으로 고정한다.
- [`../v2.1.0/fixtures/difficulty-training-split-manifest.v1.json`](../v2.1.0/fixtures/difficulty-training-split-manifest.v1.json): 25개 cross-label family의 smoke tooling partition을 train 15개/300건, calibration 5개/100건, holdout 5개/100건으로 고정한다. 이 이름은 production evidence split을 뜻하지 않는다.
- [`../v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl`](../v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl): 500건이 모두 `human_review + approved`인 owner-approved training candidate다. Synthetic prompt source와 consent provenance는 보존한다.
- [`../v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json`](../v2.1.0/training/difficulty-training-candidate-500.owner-approved.manifest.json): 89개 approved family, versioned minimum-family policy와 family-disjoint train 300/calibration 100/holdout 100 partition을 `trainingEligible=true`로 고정한다.
- [`../v2.1.0/reviews/difficulty-training-candidate-500.owner-approval.json`](../v2.1.0/reviews/difficulty-training-candidate-500.owner-approval.json): dataset owner 승인 범위, source dataset·manifest hash와 gate 결과를 보존한다.

500건은 다음 명령으로 결정론적으로 다시 만든다.

```powershell
corepack pnpm run v2.1:routing:generate-difficulty-training-pilot
corepack pnpm run verify:v2.1-difficulty-eval
```

500건 smoke의 legacy family key는 `sampleId`의 category와 `fNN`만 사용한 `{category}/{fNN}`이다. `expectedDifficulty`와 `vNN`을 제외하므로 같은 family의 simple/complex contrast와 모든 variant가 항상 함께 이동한다. 승인된 training candidate는 `difficulty-label-record.v2`의 `promptFamily`, `semanticInputStatus`와 `difficulty-training-minimum-family-policy.2026-07-14.v1`을 사용하며 legacy 25 family를 그대로 승인된 학습 family로 승격하지 않는다. `empty_instruction` record의 `not_applicable`은 semantic head class가 아니므로 initial 4-head candidate target이나 zero-vector fallback으로 변환하지 않는다.

## Training Boundary

실제 training candidate는 모든 포함 record가 `human_review + approved`이고, 독립 family 전체가 한 split에만 있으며, dataset manifest가 `trainingEligible=true`와 versioned minimum-family policy를 선언해야 한다. Checked-in owner-approved 500건/89-family candidate는 이 입력 gate와 train 300/calibration 100/holdout 100 partition을 만족한다. Train partition의 300건은 전체 record 수이며, 이 중 deterministic sentinel 56건을 제외한 `modelPath=true` 244건이 Logistic Regression의 regularization CV와 최종 `w`, `b` fit에 사용된다. 이 승인은 offline 학습 입력 자격이며 model coefficient, semantic-head weight, calibrator, holdout 결과, runtime promotion 또는 GA를 승인하지 않는다.

학습 입력은 offline Go exporter가 canonical Go pipeline으로 만든다.

```text
redactedPrompt
→ ExtractPromptFeatures
→ RuleBasedCategoryClassifier actual category
→ ExtractDifficultyFeatures
→ deterministic sentinel precheck / modelPath
→ VectorizeDifficultyFeaturesV1
→ Python offline trainer
```

주 학습 vector는 실제 category 결과를 사용한다. `expectedCategory`는 category별 집계와 별도 oracle 분석에만 사용한다. Exporter는 hybrid classifier와 같은 precheck로 각 sample에 안전한 boolean `modelPath`를 붙인다. Owner-approved candidate의 전체 partition은 train 300/calibration 100/holdout 100이고, 동일 partition 안의 model-path 유효 표본은 각각 244/85/64다. Logistic Regression 학습, calibrator 선택·fit과 model-path calibration holdout 집계는 `modelPath=true`인 표본만 사용한다. Report는 전체 record 수를 `splitCounts`, 실제 모델 경로 수를 `modelPathSplitCounts`로 분리해 기록한다. Empty/meaningless와 hard-complex sentinel 표본은 end-to-end shadow accuracy와 directional gate에서 별도로 평가하며 model calibration에 섞지 않는다. Exporter의 vector payload와 `modelPath`는 Python subprocess가 메모리에서 소비하며 fixture, report 또는 log로 저장하지 않는다.

Python tooling은 [`../../scripts/routing_difficulty_model/`](../../scripts/routing_difficulty_model/)에 격리한다. Gateway와 AI service production dependency에는 NumPy나 scikit-learn을 추가하지 않는다. Versioned policy는 L2 Logistic Regression regularization group CV, Platt/isotonic global calibrator 비교와 고정 `0.45` threshold를 선언한다. 두 후보는 모두 `raw_probability`를 입력으로 쓰며 평균 log loss, `0.000001` 허용 오차 안의 평균 Brier score, Platt 우선 순서로 선택한다. 한 후보가 실패하면 다른 유효 후보를 사용할 수 있지만 둘 다 실패하면 학습을 실패시키며 identity 또는 무보정 fallback artifact를 만들지 않는다.

모든 scikit-learn Logistic Regression fit은 `ConvergenceWarning`을 fail closed로 처리한다. Regularization group CV에서 한 fold라도 미수렴한 `C`는 전체 후보를 `failed`로 표시하고 평균 metric이나 선택에 사용하지 않는다. 모든 `C`가 실패하거나 선택된 `C`의 전체 train final fit이 미수렴하면 학습을 중단하며 artifact와 holdout report를 만들지 않는다. Platt fit이 미수렴하면 해당 calibrator 후보를 실패 처리하고 이미 검증된 다른 후보만 사용할 수 있다. Report에는 raw probability, vector 또는 coefficient 대신 안전한 `C`, fold, configured maximum과 observed iteration count만 기록한다. `maxIterations`는 실행 중 자동 증가시키지 않으며 변경이 필요하면 versioned training policy를 명시적으로 갱신한 뒤 전체 evidence run을 다시 실행한다.

동일한 Logistic Regression regularization search와 calibrator 선택·fit 함수는 `difficulty-offline-feature-shape.v1` descriptor 기반 training API에서도 재사용한다. 기존 `train_from_vector_export()`와 CLI는 exact 42D v1 name/order/dimension만 계속 허용한다. 별도 `train_from_offline_feature_matrix()`는 canonical assembler가 만든 `42`, `106`, `118` matrix의 candidate, feature names, total dimension, sample dimension, finite 값, family-disjoint split과 sentinel `modelPath`를 교차 검증한다. 각 호출은 candidate 자신의 weights/bias와 calibration raw probability로 calibrator를 다시 fit한다. Combined vector와 semantic intermediate를 파일로 쓰는 helper는 제공하지 않는다.

Isotonic은 scikit-learn의 선형 interpolation predictor를 artifact 의미로 사용하지 않고 tooling의 작은 PAVA 구현으로 학습한다. Raw probability를 정렬하고 exact-equal 값만 먼저 묶어 sample count와 complex count를 계산한 뒤, 앞 block의 비율이 뒤 block보다 크면 sample-count 가중 PAVA 병합을 반복한다. 인접 block의 fitted complex 비율이 정확히 같으면 예측 함수를 바꾸지 않는 canonicalization으로 다시 합쳐 최대 constant block 하나로 표현한다. 비율의 위반과 동률은 정수 complex count와 sample count의 교차 곱으로 비교한다. `labelConfidence`, epsilon grouping, 고정 score bin과 자동 small-block 병합은 사용하지 않는다. Artifact에는 각 최종 최대 constant block의 포함 하한과 complex 비율을 저장하며 single constant block도 유효하다. 최종 Isotonic selected-fit report에는 `blockCount`, `blockSampleCounts`와 그 최솟값인 `minBlockSampleCount`를 함께 기록한다. Runtime은 포함 하한 floor lookup과 양끝 clipping만 수행한다.

## Candidate Training Command

Canonical semantic candidate 세 개를 동일한 owner-approved 500건에서 생성하는 명령은 다음과 같다.

```powershell
corepack pnpm run v2.1:routing:train-difficulty-semantic-candidates
```

이 명령은 하나의 canonical export와 membership hash를 공유한다. Semantic heads는 train partition 전체 300건으로 학습하지만, 세 Logistic Regression decision head의 regularization CV와 최종 `w`, `b` fit은 그 안의 `modelPath=true` 244건만 사용한다. 후보별 calibrator 선택·fit은 calibration 100건 중 model-path 85건을 사용하고, 후보를 고정한 뒤 untouched holdout 100건 전체에서 sentinel을 포함한 aggregate safety evidence를 만든다. Holdout의 model-path calibration 모집단은 64건으로 별도 집계한다. `ruleVectorV1`, pooled/projected embedding, semantic head probability와 sample score는 process-local memory에만 유지한다.

아래 명령은 실제 학습을 실행하므로 승인된 dataset manifest와 별도 family-disjoint split manifest가 준비된 evidence run에서만 사용한다. 500건 smoke 경로를 인자로 넘기지 않는다.

```powershell
python -m venv .tmp\difficulty-training-venv
.tmp\difficulty-training-venv\Scripts\python.exe -m pip install -e scripts\routing_difficulty_model
.tmp\difficulty-training-venv\Scripts\python.exe -m gatelm_difficulty_model.cli `
  --dataset <approved-difficulty-evaluation.jsonl> `
  --split-manifest <approved-family-split-manifest.json> `
  --artifact-version difficulty-logistic-v1-candidate `
  --artifact-output .tmp\difficulty-model-candidate.json `
  --report-output .tmp\difficulty-training-report.json
```

이 명령은 단일 전역 Logistic Regression을 train family로 학습하고, calibration family에서 단일 전역 calibrator를 선택한 뒤 선택된 후보만 calibration 전체로 한 번 fit하고 untouched holdout aggregate를 계산한다. Holdout 결과를 model/calibrator 재선택에 사용하지 않는다. Report에는 후보별 평균 log loss와 Brier score, Isotonic CV fold별 block count와 최소 block 표본 수, 선택된 Isotonic 전체 fit의 block count와 block sample count만 둘 수 있다. Raw probability, logit, score 경계, encoded vector 또는 feature contribution을 넣지 않는다.

## Artifact And Go Code Generation

Artifact에는 모호한 최상위 `calibratorType`을 추가하지 않는다. 실제로 선택된 종류는 `calibrator.type`에 기록하고, 같은 `calibrator` 객체에는 해당 종류에 필요한 parameter만 둔다. Canonical calibration 부분은 다음 두 형태 중 하나다.

Platt가 선택된 경우:

```json
{
  "calibrationVersion": "difficulty-calibration-v1",
  "calibrator": {
    "type": "platt",
    "input": "raw_probability",
    "coefficient": 1.24,
    "intercept": -0.31
  },
  "threshold": 0.45
}
```

Isotonic이 선택된 경우:

```json
{
  "calibrationVersion": "difficulty-calibration-v1",
  "calibrator": {
    "type": "isotonic",
    "input": "raw_probability",
    "xThresholds": [0.10, 0.20, 0.50],
    "yThresholds": [0.0, 0.3333333333333333, 1.0]
  },
  "threshold": 0.45
}
```

Isotonic의 `xThresholds[i]`는 block의 포함 하한이다. `xThresholds[i] <= raw_probability < xThresholds[i+1]`이면 `yThresholds[i]`를 반환하고 첫 경계 미만과 마지막 경계 이상은 양끝 값으로 clip한다. 배열은 길이가 같고 x는 strictly increasing, y는 non-decreasing이며 길이 1의 constant calibrator도 허용한다. Schema의 `oneOf`와 닫힌 객체 규칙은 Platt에 isotonic threshold가 섞이거나 Isotonic에 Platt coefficient가 섞이는 artifact를 거부한다. Code generation도 이 tagged union과 parameter를 검증하며, `calibratorType`과 identity calibrator를 거부한다.

Candidate JSON은 [`../v2.1.0/schemas/difficulty-model-artifact.schema.json`](../v2.1.0/schemas/difficulty-model-artifact.schema.json)을 따른다. JSON은 offline provenance와 coefficient를 보존하는 교환 artifact이며 Gateway hot path에서 파싱하지 않는다.

Semantic comparison candidate는 v1 schema를 느슨하게 확장하지 않고 [`../v2.1.0/schemas/difficulty-offline-model-artifact.schema.json`](../v2.1.0/schemas/difficulty-offline-model-artifact.schema.json)을 사용한다. 이 closed schema는 `offlineFeatureShapeVersion`, candidate, preprocessing, tokenizer/encoder/pooling version과 hash, projection parameter와 `P`, 고정 4-head/12D class order와 coefficient/intercept, exact `totalDimension`/feature names/classifier weights, candidate별 calibrator, threshold/equality, dataset/split hash와 training policy를 요구한다. Bundle hash는 component tuple과 parameter/shape를 고정하고 content hash는 classifier·calibrator와 전체 provenance까지 고정한다. 기존 v1 parser는 이 artifact를 받지 않고 offline parser도 v1 artifact를 받지 않는다.

Semantic encoder는 [`difficulty-e5-encoder.md`](difficulty-e5-encoder.md)의 canonical E5 QInt8 경로만 사용한다. Raw pooled train embedding `[300,384]`에 full-SVD PCA를 fit해 committed 64D projection을 만들고, 요청 처리에서는 PCA 뒤 L2 정규화한다. Tokenizer/QInt8 large artifact는 local artifact cache 또는 향후 Docker image build 단계에 포함하며 runtime download를 금지한다.

```powershell
corepack pnpm run v2.1:routing:setup-e5-encoder
corepack pnpm run v2.1:routing:prepare-e5-encoder
corepack pnpm run v2.1:routing:fit-e5-pca
corepack pnpm run verify:v2.1-e5-encoder
```

```powershell
$env:GOCACHE=(Resolve-Path '.gocache').Path
go run ./apps/gateway-core/cmd/difficulty-model-codegen `
  -artifact .tmp\difficulty-model-candidate.json `
  -output .tmp\difficulty_logistic_model_v1_generated.go
```

Code generation은 feature/model/calibration version, exact 42개 이름·순서·weight, finite bias/coefficient, calibrator parameter, fixed threshold와 inference-material content hash를 검증한다. 학습 dataset version, split policy, regularization 설정 같은 provenance metadata는 artifact schema와 offline report의 책임이며 code generation을 막지 않는다. 알 수 없는 설명용 metadata도 무시한다. Gateway runtime에는 JSON parsing이나 반복 shape 검증을 추가하지 않는다.

같은 command가 별도 offline artifact도 schema identity로 분기해 생성할 수 있다. 이 경우 candidate, feature shape, total dimension, feature order와 content hash를 검증하고 package-private `generatedDifficultyLogisticOfflineModel`을 만든다. 생성 파일에는 offline/shadow 전용이며 product routing에 등록되지 않는다는 주석이 포함된다. v1 artifact는 계속 exact 42D code를 만들며, 두 schema의 교차 입력과 unsupported candidate/dimension은 codegen 단계에서 실패한다.

Selected Candidate C는 별도 strict profile로 전체 inference material을 checked-in Go data literal로 생성한다.

```powershell
go run ./apps/gateway-core/cmd/difficulty-model-codegen `
  -profile gateway-shadow-118d `
  -artifact scripts/routing_difficulty_model/artifacts/candidates/difficulty-candidate-c-118d.owner-approved-500.v3.json `
  -output apps/gateway-core/internal/domain/routing/difficulty_model_118d_generated.go

corepack pnpm run verify:v2.1-difficulty-gateway-bundle
```

Strict profile은 exact artifact version, Candidate C, 384→64 PCA, 4-head/12D order, 118 final weights, Platt, `>= 0.45`, component/bundle/content hash를 고정한다. Generated 파일에는 PCA `float32` mean/components, semantic-head coefficient/intercept, final classifier, calibrator와 safe identity만 있으며 계산 로직과 JSON loader는 없다. Handwritten package-private Go inference가 `DifficultyFeatures + pooled float32[384]`를 받아 sentinel 밖 model path만 계산한다. Regeneration `-check`, compiled PCA bit hash, Python-Go synthetic parity와 success-path zero-allocation test가 drift를 차단한다.

Offline artifact 자체는 다음 독립 verifier로 code generation 없이 검증할 수 있다.

```powershell
corepack pnpm run v2.1:routing:verify-difficulty-artifact -- `
  -artifact .tmp\difficulty-offline-candidate.json `
  -report .tmp\difficulty-offline-validation-report.json
```

Verifier는 closed JSON shape, immutable version, 4-head/12D parameter와 class order, projection/classifier dimension, finite numeric material, calibrator tagged union, threshold equality, dataset/split/training provenance, bundle hash와 content hash를 fail closed로 확인한다. 성공 report는 version/hash와 candidate/dimension만 포함하며 projection/head/classifier parameter를 복제하지 않는다. 실패 report는 입력값이나 JSON fragment 없이 `invalid_arguments`, `artifact_read_failed`, `artifact_invalid`, `report_write_failed` 중 하나의 안전한 code만 제공한다. Artifact나 report에는 raw prompt, token, embedding, vector, head output, per-sample score 또는 matched phrase를 넣지 않는다.

Validated candidate artifact는 제품 runtime에 포함하지 않고 다음처럼 opt-in offline shadow 비교에만 입력할 수 있다.

```powershell
corepack pnpm run v2.1:routing:evaluate:difficulty -- `
  -difficulty-shadow-model-artifact .tmp\difficulty-model-candidate.json
```

Shadow classifier는 empty/meaningless `0.0 + simple`과 hard-complex `1.0 + complex` sentinel을 먼저 적용하고 나머지 요청만 artifact의 Logistic Regression·calibrator·global `0.45` threshold로 판정한다. Report는 current rule-based runtime 대비 변경, 전체·category별 `complex -> simple` 비악화 gate, 긴 simple과 짧은 complex segment, candidate latency와 최종 `ComplexityScore`만 제공한다. Raw probability, logit, vector와 coefficient는 투영하지 않으며 `productRuntimeChanged`는 항상 `false`다.

Checked-in shadow-preparation bundle을 active product model로 등록하거나 `SimpleRouter`의 rule-based classifier를 교체하는 작업은 별도 promotion 단계다. Generated bundle과 offline evaluator가 존재하더라도 current runtime behavior는 변경되지 않는다.

## Current Tooling-Smoke Baseline

The reproducible rule-versus-42D instrumentation smoke is recorded in [`../testing/difficulty-42d-tooling-smoke-baseline.md`](../testing/difficulty-42d-tooling-smoke-baseline.md). It evaluates exact 42D `difficulty-feature-vector.v1` only. Because the dataset is synthetic `training_tooling_smoke` with `trainingEligible=false`, it is not eligible for model-quality comparison, semantic-candidate ranking, promotion gating, or production evidence. The canonical E5/PCA semantic shapes (`42`, `106`, `118`), four-head/12D output, v2 `semanticInputStatus`/bucket targets and fail-closed empty semantic input require their own contract-compliant evaluation. The v2 label-contract smoke used for negation/payload slices is projection-only: its semantic annotation targets are not consumed by the 42D evaluator and do not establish semantic target quality.

## Prepared Tests

- Label schema v2의 고정 4-head class order, empty-instruction fail-closed, 필수 slice, category-semantic 조합, review 상태와 family-level coverage
- 500건 smoke 재생성, 균형, provenance, dataset hash와 `trainingEligible=false`
- Smoke와 향후 candidate의 simple/complex cross-label family split/fold 비누출
- actual category vector와 oracle category vector의 분리
- deterministic sentinel과 Logistic Regression `modelPath` 학습·calibration 분리
- 작은 in-memory synthetic matrix의 Logistic Regression/calibrator fit
- Python artifact hash와 Go code generator parity
- Generic scorer의 canonical `42`, `106`, `118` 계산과 dimension/finite fail-closed
- Pinned E5 tokenizer/QInt8 artifact hash, attention-mask mean pooling, train-only PCA `[384]`/`[64,384]`, post-PCA L2와 64D output 검증
- Descriptor 기반 세 candidate의 별도 weights/bias/calibrator fit과 feature order 검증
- v1/offline artifact parser 교차 거부, offline component provenance와 Go/Python hash parity
- Offline generated Go의 candidate/dimension/feature order 보존과 type-check
- stable sigmoid, Platt 공식과 포함 하한 Isotonic 계단 lookup의 Python-Go 공통 golden parity
- PAVA exact-tie grouping, sample-count 가중 cascade merge, 동일 fitted-value 최대 constant block canonicalization, block 진단과 single-block inference
- 잘못된 feature order/count, threshold, calibrator와 content hash의 codegen 거부
- meaningless/hard-complex sentinel 우선순위와 remaining-request model path
- opt-in shadow artifact load, runtime 비교, 긴 simple·짧은 complex segment와 민감 material 비노출
- Selected C 118D full Go material generation, exact identity pin과 byte-for-byte regeneration check
- Pooled 384D부터 PCA 64D·semantic-head 12D·final calibrated score까지 Python-Go numeric parity
- Pure Go model path safe error와 success-path zero allocation

500건 smoke는 ephemeral tooling test에만 사용할 수 있다. 실제 후보는 owner-approved 500건/89-family와 exact 300/100/100 partition만 사용한다. 현재 holdout 100건은 세 조합을 비교하는 selection evidence이며, 이 결과로 조합을 선택한 뒤에는 final runtime promotion evidence로 재사용할 수 없다.

현재 selected artifact와 generated Go bundle은 PCA, semantic head, difficulty decision head와 Platt calibrator를 포함하지만 API, DB, Event, Metrics, RuntimeSnapshot, routing policy와 제품 `DifficultyResult` shape를 변경하지 않는다. Gateway shadow 실행 위치와 tokenizer/ONNX image packaging은 별도 optional profile이다. 새 promotion Holdout은 고정 v3 artifact로 한 번 평가됐고 accuracy `0.70`으로 gate를 실패했으므로 runtime 승격 근거가 되지 않는다.
