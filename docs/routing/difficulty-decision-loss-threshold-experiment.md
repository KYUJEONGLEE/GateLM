# Difficulty Expected Decision Loss Threshold Experiment

| Field | Value |
|---|---|
| Status | Offline experiment; not an active runtime contract |
| Applies to | `routing-eval` difficulty shadow evaluation |
| Experiment policy | `difficulty-decision-loss-threshold-experiment.v1` |
| Product runtime changed | No |
| Last verified | 2026-07-15 |

이 문서는 calibrated `ComplexityScore`의 threshold를 바꿨을 때 `simple -> complex` over-routing과 `complex -> simple` under-routing이 어떻게 교환되는지 확인하는 offline 실험 절차를 정의한다. 실험은 주어진 `C_FN` 시나리오에서 Expected Decision Loss가 가장 작은 operating point와, threshold 이동으로 FN 한 건을 줄이기 위해 추가로 감수해야 하는 FP 수를 aggregate로 계산한다.

이 실험 자체는 `difficulty-threshold-v1 = 0.45`를 변경하거나 새 threshold를 runtime 승격 근거로 확정하지 않는다. Active runtime 변경은 별도 계약, calibration selection evidence, untouched holdout과 artifact 승격이 필요하다.

## 1. Decision Loss

Difficulty label과 비용은 다음 의미를 사용한다.

- FN: 실제 `complex`, 예측 `simple`; under-routing
- FP: 실제 `simple`, 예측 `complex`; over-routing
- `C_FN`: under-routing 한 건의 상대 손실
- `C_FP`: over-routing 한 건의 상대 손실

표본 수가 `N`일 때 threshold `t`의 Expected Decision Loss는 다음과 같다.

```text
EDL(t) = (C_FN * FN(t) + C_FP * FP(t)) / N
```

`ComplexityScore`가 평가 모집단의 `P(complex | x)`로 정확히 보정되고 두 비용이 모든 요청에서 일정하다면 Bayes threshold는 다음과 같다.

```text
t_bayes = C_FP / (C_FP + C_FN)
```

실제 score는 유한한 calibration data에서 추정되므로 실험 report는 이론적 threshold와 고정 grid에서 관찰한 empirical EDL 최적점을 함께 제공한다.

## 2. Threshold Delta와 Break-even C_FN

높은 threshold에서 낮은 threshold로 이동하면 일반적으로 FP는 증가하고 FN은 감소한다.

```text
additionalFP = FP(lower_threshold) - FP(higher_threshold)
preventedFN = FN(higher_threshold) - FN(lower_threshold)
```

`preventedFN > 0`이면 두 operating point의 손실이 같아지는 FN 비용은 다음과 같다.

```text
breakEvenC_FN = C_FP * additionalFP / preventedFN
```

`C_FP = 1`, `additionalFP = 12`, `preventedFN = 3`이면 `breakEvenC_FN = 4`다.

- `C_FN > 4`: 낮은 threshold의 EDL이 더 작다.
- `C_FN < 4`: 높은 threshold의 EDL이 더 작다.
- `C_FN = 4`: 두 operating point의 EDL이 같다.

`preventedFN = 0`인데 FP만 증가하는 이동은 유한한 break-even 비용이 없으며 `no_fn_prevented`로 보고한다. 이 값은 분류 데이터가 사업상 `C_FN`을 자동 결정했다는 뜻이 아니다. 제품 책임자가 감수 가능한 FP:FN 교환비를 선택할 수 있게 만드는 evidence다.

## 3. Experiment Boundary

실험은 다음 경계를 지킨다.

- `routing-eval`에 validated shadow model artifact가 명시된 경우에만 opt-in으로 실행한다.
- threshold grid는 sample score에서 만들지 않고 `0.0..1.0`의 고정 간격을 사용한다.
- model-path 표본은 `ComplexityScore >= threshold`일 때 `complex`로 다시 판정한다.
- empty/meaningless와 hard-complex sentinel은 threshold를 적용하지 않고 기존 shadow 판정을 유지한다.
- EDL과 directional error 집계에는 model-path와 sentinel을 모두 포함한다.
- raw prompt, raw probability, logit, vector, coefficient, provider/model, 실제 가격과 sample별 새 score material을 experiment aggregate에 추가하지 않는다.
- 실험 report는 `productRuntimeChanged=false`, `thresholdSelectionForPromotionAllowed=false`를 고정한다.

Threshold step은 `1.0`을 정확히 나누어야 하며 최대 1,000개 구간까지만 허용한다. 기본 `0.01`은 101개 operating point를 만든다.

## 4. Safety-constrained Selection

각 threshold는 current rule-based runtime과 비교해 다음 조건을 평가한다.

```text
candidate complexToSimple count <= runtime baseline count
```

이 조건을 전체와 각 expected category에서 모두 만족해야 `safetyGatePassed=true`다. 각 `C_FN` 시나리오는 두 결과를 분리해 제공한다.

- `unconstrainedBest`: EDL만 최소화한 operating point
- `safetyConstrainedBest`: 기존 전체·category별 FN 비증가 조건을 만족하는 operating point 중 EDL 최소값

두 값이 다르면 Expected Decision Loss만으로 고른 threshold가 현재 safety policy를 위반한다는 뜻이다. Runtime threshold 후보는 `safetyConstrainedBest`만 검토할 수 있지만, 이 experiment 결과만으로 승격하지 않는다.

EDL 동률은 다음 순서로 결정론적으로 해소한다.

1. FN count가 더 작은 point
2. 이론적 Bayes threshold에 더 가까운 point
3. 그래도 같으면 더 낮은 threshold

## 5. 실행

기존 difficulty shadow evaluation에 아래 flag를 추가한다.

```powershell
corepack pnpm run v2.1:routing:evaluate:difficulty -- `
  -difficulty-shadow-model-artifact .tmp\difficulty-model-candidate.json `
  -difficulty-decision-loss-experiment `
  -difficulty-decision-loss-fp-cost 1 `
  -difficulty-decision-loss-fn-costs 1,3,5,10 `
  -difficulty-decision-loss-threshold-step 0.01 `
  -output reports\difficulty-decision-loss-experiment.json
```

Flags의 의미는 다음과 같다.

| Flag | Default | Meaning |
|---|---:|---|
| `-difficulty-decision-loss-experiment` | `false` | aggregate threshold experiment 실행 |
| `-difficulty-decision-loss-fp-cost` | `1` | FP 한 건의 상대 손실 |
| `-difficulty-decision-loss-fn-costs` | `1,3,5,10` | 비교할 FN 상대 손실 시나리오 |
| `-difficulty-decision-loss-threshold-step` | `0.01` | 고정 threshold grid 간격 |

Shadow artifact가 없거나 difficulty evaluation이 아닌 실행에서는 experiment flag를 거부한다.

## 6. Report 해석

결과는 `shadow.decisionLossExperiment`에 추가된다. 주요 필드는 다음과 같다.

```text
operatingPoints[]
  threshold
  simpleToComplexCount / Rate
  complexToSimpleCount / Rate
  safetyGatePassed
  failedCategories[]

transitions[]
  fromThreshold / toThreshold
  additionalSimpleToComplex
  preventedComplexToSimple
  breakEvenFalseNegativeToFalsePositiveRatio
  breakEvenFalseNegativeCost

scenarios[]
  falsePositiveCost / falseNegativeCost
  theoreticalBayesThreshold
  unconstrainedBest
  safetyConstrainedBest
```

`breakEvenFalseNegativeToFalsePositiveRatio = 4`는 FN 한 건을 막기 위해 FP 네 건까지 감수할 수 있어야 낮은 threshold가 유리하다는 뜻이다. `expectedDecisionLoss`의 단위는 request당 `relative_loss_unit`이며 실제 통화 비용으로 해석하지 않는다.

## 7. Dataset Role과 Holdout

`routing-eval` 입력 record에는 train/calibration/holdout 역할이 없으므로 experiment는 입력 dataset의 역할을 검증할 수 없다. 따라서 report는 항상 `evidenceRole=exploratory_only_dataset_role_not_verified`를 기록한다.

실제 threshold selection evidence는 family-grouped calibration OOF score에서 생성해야 한다. Candidate, calibrator와 threshold를 모두 freeze한 뒤 untouched holdout은 최종 safety/evaluation에 한 번만 사용한다. Holdout에서 threshold 또는 `C_FN`을 다시 선택하면 해당 holdout은 더 이상 final evidence가 아니다.

## 8. Verification

```powershell
$env:GOCACHE = "$PWD\.gocache"
$env:GOTELEMETRY = "off"
Push-Location apps\gateway-core
go test ./cmd/routing-eval
Pop-Location

corepack pnpm run verify:v2.1-difficulty-eval
corepack pnpm run verify:routing-contract
corepack pnpm run verify:v2-docs
git diff --check
```

