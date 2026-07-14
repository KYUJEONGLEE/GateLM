# 42D Difficulty Tooling-Smoke Measurement Baseline

## Status

- Evidence class: offline `training_tooling_smoke`
- Model-quality comparison eligible: `false`
- Semantic-candidate comparison eligible: `false`
- Promotion gate applicable: `false`
- Production evidence eligible: `false`
- Product runtime changed: `false`
- Measured at: `2026-07-14T06:51:42.304Z` (`2026-07-14 15:51:42 KST`)
- Current-contract/slice revalidation: `2026-07-14T07:50:55.135Z` (`2026-07-14 16:50:55 KST`), base commit `9ae1d25922696aece2d191d8abff08e13026dfbc`
- Base commit: `1fdfdde19f8bd352b6f29fe702f8159cb433ba5f`
- Branch: `feat/routing-difficulty-update`
- `origin/dev`: `dace6848836994bfc8c501604560eb40aca3224c`
- Worktree at measurement: dirty; the evaluator and runner changes in this evidence were not committed yet

This result records a reproducible instrumentation smoke between the current rule classifier and an ephemeral 42D Logistic Regression hybrid on the same family-disjoint tooling partition. It is not a model-quality baseline and must not be used to rank later semantic candidates.

## Current Contract Boundary

- This report evaluates exact `difficulty-feature-vector.v1` with 42 dimensions only.
- It does not evaluate the proposed semantic feature contract.
- The current semantic proposal has 4 heads / 12 probability dimensions and initial candidate shapes `42`, `42 + P`, and `54 + P`.
- The current semantic annotation contract is `gatelm.difficulty-label-record.v2`: `semanticInputStatus` distinguishes `eligible` from `empty_instruction`, and empty semantic input uses `not_applicable` bucket targets rather than invented head probabilities.
- The semantic proposal remains `Proposed; not active`; no Gateway hot-path or runtime behavior is changed here.
- Empty semantic input must fail closed until a versioned empty representation is approved. The 42D v1 empty/meaningless sentinel is a separate existing classifier rule and must not be reused as a semantic zero-vector contract.
- The robustness fixture used below is `gatelm.difficulty-label-record.v2`; its annotation-only semantic targets are deliberately excluded when projecting to the 42D difficulty-evaluation contract.

## Dataset And Artifact

- Dataset version: `difficulty_eval_2026_07_13_pilot_500_v1`
- Dataset SHA-256: `278be4bcf7764ed760b8f5e67858bf1587ad53a41d0bec71652f0b73b2ca8bc8`
- Dataset status: `trainingEligible=false`, `labelCoverageStatus=unlabeled`
- Approved human-reviewed families: `0`
- Split policy: `difficulty-family-split.v1`
- Family rule: `difficulty-sample-family.v1`
- Tooling partition: train `300 samples / 15 families`, calibration `100 / 5`, holdout `100 / 5`
- Holdout model path: `85`; deterministic sentinels excluded from calibration: `15`
- Ephemeral artifact: `difficulty-logistic-v1-42d-tooling-smoke-baseline`
- Artifact SHA-256: `sha256:0fcc5a0689aaf0a934b4e1df0645d9cbfbc48be6d30d81ee4a5d56ba5a693c0f`
- Calibrator / threshold: Platt / `0.45`
- Slice dataset: `difficulty_label_contract_smoke_2026_07_14_v2`
- Slice record contract / SHA-256: `gatelm.difficulty-label-record.v2` / `ab9305583a424793efd94afec420198f36d6214c79fa7a855ae2eacf846549ca`
- Slice semantic eligibility: `10 records / 5 families` eligible, `0 / 0` empty-instruction

The tooling partition is selected only through the checked-in family assignment manifest. No record-random split is used, and contrast variants remain in the same family. Per the current label contract, these `train|calibration|holdout` names are smoke-tooling partitions rather than production evidence splits.

## Observed Tooling-Smoke Output

| Metric | Rule | 42D hybrid | Delta |
|---|---:|---:|---:|
| Accuracy | 0.93 (93/100) | 0.75 (75/100) | -0.18 |
| `complex -> simple` | 7/50 (0.14) | 13/50 (0.26) | +6 / +0.12 |
| Changed prediction | - | 28/100 | - |

The tooling-smoke directional diagnostic returns false because `complex -> simple` counts increase overall and in three expected-category groups. This is not a promotion-gate result because promotion-gate applicability is `false` for this dataset.

| Expected category | Rule accuracy | 42D accuracy | Rule `complex -> simple` | 42D `complex -> simple` | Directional diagnostic |
|---|---:|---:|---:|---:|---|
| code | 1.00 | 0.70 | 0/10 | 0/10 | PASS |
| general | 0.80 | 0.70 | 4/10 | 6/10 | FAIL |
| reasoning | 1.00 | 0.70 | 0/10 | 0/10 | PASS |
| summarization | 0.90 | 0.85 | 2/10 | 3/10 | FAIL |
| translation | 0.95 | 0.80 | 1/10 | 4/10 | FAIL |

## Calibration

The rule classifier does not emit a calibrated probability, so rule calibration is `N/A`. The 42D result uses only `modelPath=true` records; deterministic sentinel outputs are not treated as probabilistic predictions.

| Scope | N | Log loss | Brier score |
|---|---:|---:|---:|
| Overall model path | 85 | 0.526151 | 0.175830 |
| code | 12 | 0.555485 | 0.194875 |
| general | 20 | 0.577363 | 0.202510 |
| reasoning | 20 | 0.424611 | 0.137375 |
| summarization | 14 | 0.577720 | 0.184987 |
| translation | 19 | 0.522604 | 0.169449 |

Fixed calibration bin policy: `equal-width-10-v1`.

| Score bin | N | Mean score | Observed complex rate |
|---|---:|---:|---:|
| [0.0, 0.1) | 0 | 0 | 0 |
| [0.1, 0.2) | 30 | 0.161600 | 0.133333 |
| [0.2, 0.3) | 18 | 0.248819 | 0.444444 |
| [0.3, 0.4) | 1 | 0.324794 | 1.000000 |
| [0.4, 0.5) | 2 | 0.446301 | 0.000000 |
| [0.5, 0.6) | 13 | 0.559022 | 0.153846 |
| [0.6, 0.7) | 2 | 0.671810 | 1.000000 |
| [0.7, 0.8) | 6 | 0.754622 | 0.833333 |
| [0.8, 0.9) | 8 | 0.861990 | 1.000000 |
| [0.9, 1.0] | 5 | 0.932843 | 1.000000 |

## Length And Robustness Slices

| Segment | N | Rule accuracy | 42D accuracy |
|---|---:|---:|---:|
| long-simple (`rune length > 120`) | 3 | 1.0000 | 0.6667 |
| short-complex (`rune length <= 120`) | 33 | 0.9091 | 0.6061 |

Negation and payload-contamination use explicit `evaluationSlices` membership from `difficulty_label_contract_smoke_2026_07_14_v2`. The records are synthetic, pending review, and too small for quality claims. The v2 revalidation preserved the observed slice values below. Annotation-only semantic fields, including `semanticInputStatus` and bucket targets, are not projected into the 42D evaluation record.

| Slice | N | Rule accuracy | 42D accuracy | Rule `complex -> simple` | 42D `complex -> simple` |
|---|---:|---:|---:|---:|---:|
| negation | 2 | 0.50 | 0.50 | 0/1 | 1/1 |
| payload_contamination | 1 | 1.00 | 1.00 | 0/0 | 0/0 |

## Inference Latency

Environment: Windows `10.0.26200`, Intel Core Ultra 7 155H, Go `1.24.13`, Node `22.23.1`. Each holdout record has 10 unmeasured warm-up iterations and 100 measured batches. Reported values are per-call microseconds. End-to-end/category batches contain 32 calls; difficulty-only batches contain 4096 calls to amortize timer overhead.

| Path | Classifier | Avg (us) | p50 (us) | p95 (us) | Max (us) |
|---|---|---:|---:|---:|---:|
| Difficulty only | Rule | 0.0292 | <=0.0010 | 0.2442 | 0.4116 |
| Difficulty only | 42D hybrid | 0.1429 | 0.1327 | 0.3671 | 0.7491 |
| End to end | Rule | 131.0365 | 125.1281 | 203.7344 | 650.9813 |
| End to end | 42D hybrid | 131.7377 | 125.2531 | 203.7438 | 437.4656 |

- Difficulty-only delta: average `+0.1137 us`, p95 `+0.1229 us`
- End-to-end delta: average `+0.7012 us`, p95 `+0.0094 us`
- The rule difficulty-only p50 is at the evaluator reporting floor (`0.001 us`) and should be read as an upper bound, not as exact sub-nanosecond timing.
- Host load can move absolute latency. These settings may be reused to validate measurement plumbing, but semantic candidate comparison requires a separate contract-compliant run and eligible dataset.

## Reproduction

Prepare the Python environment as described in `docs/routing/difficulty-logistic-training.md`, then run:

```powershell
$env:GATELM_DIFFICULTY_PYTHON = (Resolve-Path '.tmp\difficulty-training-venv\Scripts\python.exe').Path
corepack pnpm run v2.1:routing:baseline:difficulty -- `
  --latency-iterations 100 `
  --latency-warmup-iterations 10 `
  --latency-batch-size 32 `
  --difficulty-latency-batch-size 4096
```

The command writes the aggregate JSON and Markdown reports plus ephemeral training/evaluation artifacts under `.tmp/difficulty-42d-smoke-baseline/`. The aggregate report contains scores and counts only; it does not emit raw probability, logit, feature vector, coefficient contribution, raw prompt, or raw response data.

## Interpretation

This run establishes the measurement pipeline and records synthetic observations only. It does not justify replacing the rule classifier, selecting a model, calibrator or threshold, or ranking a semantic candidate. A semantic comparison must follow the current `42`, `42 + P`, `54 + P` shape contract, use four heads / 12 probabilities, reject unapproved empty-input zero-fill, and be rerun on an approved human-reviewed family-disjoint dataset before any promotion gate is applicable.
