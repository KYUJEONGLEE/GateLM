# GateLM Difficulty Logistic Training Boundary

| Field | Value |
|---|---|
| Status | Offline tooling prepared; no model trained or promoted |
| Model policy | `difficulty-logistic-v1` |
| Feature contract | `difficulty-feature-vector.v1` (42 dimensions) |
| Calibration policy | `difficulty-calibration-v1` |
| Threshold policy | `difficulty-threshold-v1 = 0.5` |
| Runtime status | Existing rule-based difficulty classifier remains active |

이 문서는 [`classification-pipeline.md`](classification-pipeline.md)의 target 계산을 실제 offline 학습과 generated Go artifact로 연결하는 준비 경계를 설명한다. 이 문서와 tooling의 존재는 coefficient, calibrator parameter, holdout evidence 또는 runtime 승격을 뜻하지 않는다.

## Dataset Roles

- [`../v2.1.0/fixtures/difficulty-evaluation-dataset.fixture.jsonl`](../v2.1.0/fixtures/difficulty-evaluation-dataset.fixture.jsonl): 10건 contract smoke. 학습에 사용하지 않는다.
- [`../v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl`](../v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl): 500건 synthetic training pilot. `human review pending`이며 production promotion evidence가 아니다.
- [`../v2.1.0/fixtures/difficulty-training-split-manifest.v1.json`](../v2.1.0/fixtures/difficulty-training-split-manifest.v1.json): 25개 cross-label family를 train 15개/300건, calibration 5개/100건, holdout 5개/100건으로 고정한다.

500건은 다음 명령으로 결정론적으로 다시 만든다.

```powershell
corepack pnpm run v2.1:routing:generate-difficulty-training-pilot
corepack pnpm run verify:v2.1-difficulty-eval
```

Family key는 `sampleId`의 category와 `fNN`만 사용한 `{category}/{fNN}`이다. `expectedDifficulty`와 `vNN`을 제외하므로 같은 family의 simple/complex contrast와 모든 variant가 항상 함께 이동한다.

## Training Boundary

학습 입력은 offline Go exporter가 canonical Go pipeline으로 만든다.

```text
redactedPrompt
→ ExtractPromptFeatures
→ RuleBasedCategoryClassifier actual category
→ ExtractDifficultyFeatures
→ VectorizeDifficultyFeaturesV1
→ Python offline trainer
```

주 학습 vector는 실제 category 결과를 사용한다. `expectedCategory`는 category별 집계와 별도 oracle 분석에만 사용한다. Exporter의 vector payload는 Python subprocess가 메모리에서 소비하며 fixture, report 또는 log로 저장하지 않는다.

Python tooling은 [`../../scripts/routing_difficulty_model/`](../../scripts/routing_difficulty_model/)에 격리한다. Gateway와 AI service production dependency에는 NumPy나 scikit-learn을 추가하지 않는다. Versioned policy는 L2 Logistic Regression regularization group CV, identity/Platt/isotonic global calibrator 비교와 고정 `0.5` threshold를 선언한다.

## Candidate Training Command

아래 명령은 실제 학습을 실행하므로 이번 준비 작업에서는 실행하지 않는다. 승인된 다음 evidence run에서만 사용한다.

```powershell
python -m venv .tmp\difficulty-training-venv
.tmp\difficulty-training-venv\Scripts\python.exe -m pip install -e scripts\routing_difficulty_model
.tmp\difficulty-training-venv\Scripts\python.exe -m gatelm_difficulty_model.cli `
  --artifact-version difficulty-logistic-v1-candidate `
  --artifact-output .tmp\difficulty-model-candidate.json `
  --report-output .tmp\difficulty-training-report.json
```

이 명령은 단일 전역 Logistic Regression을 train family로 학습하고, calibration family에서 단일 전역 calibrator를 선택·fit한 뒤 untouched holdout aggregate를 계산한다. Holdout 결과를 model/calibrator 재선택에 사용하지 않는다. Report에는 raw probability, logit, encoded vector 또는 feature contribution을 넣지 않는다.

## Artifact And Go Code Generation

Candidate JSON은 [`../v2.1.0/schemas/difficulty-model-artifact.schema.json`](../v2.1.0/schemas/difficulty-model-artifact.schema.json)을 따른다. JSON은 offline provenance와 coefficient를 보존하는 교환 artifact이며 Gateway hot path에서 파싱하지 않는다.

```powershell
$env:GOCACHE=(Resolve-Path '.gocache').Path
go run ./apps/gateway-core/cmd/difficulty-model-codegen `
  -artifact .tmp\difficulty-model-candidate.json `
  -output .tmp\difficulty_logistic_model_v1_generated.go
```

Code generation은 feature/model/calibration version, exact 42개 이름·순서·weight, finite bias/coefficient, calibrator parameter, fixed threshold와 inference-material content hash를 검증한다. 학습 dataset version, split policy, regularization 설정 같은 provenance metadata는 artifact schema와 offline report의 책임이며 code generation을 막지 않는다. 알 수 없는 설명용 metadata도 무시한다. Gateway runtime에는 JSON parsing이나 반복 shape 검증을 추가하지 않는다.

생성된 candidate를 `apps/gateway-core/internal/domain/routing`에 옮기거나 rule-based classifier를 교체하는 작업은 별도 promotion 단계다. 그 전에는 checked-in active generated model, `DifficultyResult.ComplexityScore`와 runtime behavior를 추가하지 않는다.

## Prepared Tests

- 500건 재생성, 균형, provenance와 dataset hash
- simple/complex cross-label family의 split/fold 비누출
- actual category vector와 oracle category vector의 분리
- 작은 in-memory synthetic matrix의 Logistic Regression/calibrator fit
- Python artifact hash와 Go code generator parity
- stable sigmoid, Platt와 isotonic Go inference
- 잘못된 feature order/count, threshold, calibrator와 content hash의 codegen 거부

실제 500건 학습, production artifact 생성, holdout promotion gate와 runtime cutover는 이 준비 범위에 포함하지 않는다.
