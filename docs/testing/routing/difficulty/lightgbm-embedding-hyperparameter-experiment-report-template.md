# GateLM LightGBM Embedding Hyperparameter Experiment Report Template

| Field | Value |
|---|---|
| Report status | `<draft / final>` |
| Experiment ID | `<작성>` |
| Protocol version/hash | `<작성>` |
| Evidence class | Exploratory offline evidence only |
| Dimension policy | Parameterized across runs; exact fixed `D` within artifact |
| Execution authorization | `<not granted / explicit approval reference>` |
| Experiment executed | `<false / true>` |
| Promotion state | `exploratory_only` |
| Runtime profile generated | `false` |
| Test access state | `<untouched / consumed once / contaminated>` |
| Report date | `<YYYY-MM-DD>` |

> [!IMPORTANT]
> 이 양식에는 embedding, matrix, raw prompt/response, sample별 probability·score를 붙이지 않는다. 수치 결과는 aggregate metric/count로만 기록한다.

> [!WARNING]
> 이 파일을 생성했다는 사실은 실험 실행 승인이 아니다. 별도 명시적 승인 전에는 모든 결과 placeholder를 비워 두며, 학습·calibration·threshold 계산·Test 접근을 수행하지 않는다.

## 1. Decision summary

| Item | Result |
|---|---|
| Final evidence decision | `<VALID_OFFLINE_EVIDENCE / INVALID / INSUFFICIENT_EVIDENCE / BLOCKED>` |
| Dataset eligibility | `<PASS / FAIL>` |
| Selected feature-generator candidate | `<ID>` |
| Embedding dimension `D` | `<positive integer>` |
| Selected calibrator | `<none / platt / isotonic>` |
| Selected `C_FN` | `<1 / 3 / 5 / 10>` |
| Selected threshold | `<full precision value>` |
| Overall safety gate | `<PASS / FAIL>` |
| All-category safety gate | `<PASS / FAIL / INSUFFICIENT>` |
| Test evaluated candidates | `<1이어야 함>` |
| Runtime promotion | `Not authorized by this report` |

### 1.1 한 문단 결론

`<어떤 승인 데이터와 feature generator를 사용했고, CV·calibration·threshold·Test 결과가 무엇이며, 어떤 gate 때문에 VALID/INVALID/INSUFFICIENT인지 한 문단으로 작성한다. Runtime 승격을 선언하지 않는다.>`

### 1.2 핵심 evidence

- `<CV mean Average Precision ± std와 baseline delta>`
- `<Validation calibration 선택 근거>`
- `<Validation threshold safety/EDL 근거>`
- `<Test Complex Recall, FN/FP, AP, Brier/log loss>`
- `<category/slice risk 또는 표본 부족>`

## 2. Scope와 pre-registered protocol

| Item | Frozen value | Actual execution | Status |
|---|---|---|---|
| Objective | Simple(0) / Complex(1) | `<작성>` | `<PASS/FAIL>` |
| Feature shape | Embedding-only `D` | `<작성>` | `<PASS/FAIL>` |
| Split | family-disjoint 70/15/15 | `<작성>` | `<PASS/FAIL>` |
| Train CV | shared StratifiedGroupKFold 5-fold | `<작성>` | `<PASS/FAIL>` |
| Search | deterministic Random Search 80 | `<작성>` | `<PASS/FAIL>` |
| CV selection | mean AP max, std min | `<작성>` | `<PASS/FAIL>` |
| Iteration | fold best_iteration median | `<작성>` | `<PASS/FAIL>` |
| Calibration | Train OOF fit, Validation Brier/log loss select | `<작성>` | `<PASS/FAIL>` |
| Threshold | unique Validation scores + safety + EDL | `<작성>` | `<PASS/FAIL>` |
| Test | frozen one candidate, one-time | `<작성>` | `<PASS/FAIL>` |

Protocol document: [LightGBM Embedding Hyperparameter Experiment Design](./lightgbm-embedding-hyperparameter-experiment-design.md)

## 3. Frozen provenance와 hashes

### 3.1 Source, dataset, split와 code

| Artifact / policy | Version | Immutable path/reference | SHA-256 / commit | Freeze time |
|---|---|---|---|---|
| Experiment design | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Dataset | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Dataset manifest | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Label guide | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Split policy | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Split membership | `<작성>` | `<safe manifest/reference>` | `<작성>` | `<작성>` |
| Fold membership | `<작성>` | `<safe manifest/reference>` | `<작성>` | `<작성>` |
| Candidate set | 80 | `<작성>` | `<작성>` | `<작성>` |
| Training/evaluation code | `<작성>` | `<작성>` | `<commit>` | `<작성>` |
| Champion prediction identity | `<작성>` | `<aggregate/safe reference>` | `<작성>` | `<작성>` |

### 3.2 Dataset eligibility

| Gate | Required | Observed | Evidence | Status |
|---|---|---|---|---|
| `scope.training_eligible` | true | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| `review.production_gold` | true | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| `review.human_reviewed` | true | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| `review.review_status` | approved | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Human-reviewed records | > 0 | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Required splits | all present | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Both labels in each split | present | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Dataset/manifest hash | match | `<작성>` | `<작성>` | `<PASS/FAIL>` |

현재 15,000건 candidate를 사용했다면 `training_eligible=false`, `production_gold=false`, `human_reviewed=false`이므로 결과를 INVALID/BLOCKED로 종료한다.

## 4. Feature-generator와 dimension contract

### 4.1 Selected candidate

| Setting | Frozen / observed value |
|---|---|
| Candidate ID | `<작성>` |
| Encoder model ID | `<작성>` |
| Source revision | `<작성>` |
| Tokenizer artifact/hash | `<작성>` |
| Encoder artifacts/hashes | `<작성>` |
| Input boundary | `<작성>` |
| Input prefix | `<작성>` |
| Maximum token length | `<작성>` |
| Truncation policy | `<작성>` |
| Pooling | `<작성>` |
| L2 normalization / epsilon | `<작성>` |
| Output dtype | `float32` |
| Declared dimension `D` | `<작성>` |
| Observed unique dimensions | `<{D}이어야 함>` |
| Feature matrix shape | `(N, D)` |
| Optional projection | `<none 또는 kind/input D/output D/fit split/hash>` |
| Encoder weights | frozen |
| Persisted embedding/matrix | false |

Dimension contract: `<PASS/FAIL>`

Ragged row count: `<0이어야 함>`

Non-finite row count: `<0이어야 함>`

Missing/substituted embedding count: `<0이어야 함>`

### 4.2 Compared dimension candidates

| Candidate ID | Encoder/projection identity | D | Same rows/splits/folds | Search candidates | Validation decision | Test accessed |
|---|---|---:|---|---:|---|---|
| `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<80>` | `<작성>` | `<No/Yes>` |
| `<필요시 추가>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<80>` | `<작성>` | `<No/Yes>` |

Dimension-only causal claim allowed: `<No / Yes, 동일 base embedding의 Train-only projection ablation인 경우 근거>`

## 5. Execution environment

| Item | Value |
|---|---|
| Host/run ID | `<safe identifier>` |
| OS / architecture | `<작성>` |
| CPU / accelerator | `<작성>` |
| Available memory | `<작성>` |
| Python | `<작성>` |
| NumPy | `<작성>` |
| scikit-learn | `<작성>` |
| LightGBM | `4.6.0` |
| LightGBM API | `lgb.train()` |
| Compiler/native library | `<작성>` |
| BLAS/thread runtime | `<작성>` |
| `device_type` | cpu |
| `num_threads` | 1 |
| `force_col_wise` | true |
| `deterministic` | true |
| Seed family | 20260721 |
| Dirty working tree | `<false 또는 변경 목록/영향>` |

Reproduction rerun result: `<exact match / tolerance match / mismatch / not run>`

## 6. Split와 leakage audit

### 6.1 Split counts

| Split | Target ratio | Records | Families | Simple | Complex | Access state |
|---|---:|---:|---:|---:|---:|---|
| Train | 70% | `<작성>` | `<작성>` | `<작성>` | `<작성>` | available |
| Validation | 15% | `<작성>` | `<작성>` | `<작성>` | `<작성>` | selection only |
| Test | 15% | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<untouched/consumed once>` |

### 6.2 Category/language coverage

| Split | general | code | translation | summarization | reasoning | ko | en | mixed | unknown |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Train | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Validation | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Test | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 6.3 Leakage checklist

| Check | Required | Observed | Evidence | Status |
|---|---:|---:|---|---|
| Cross-split `family_id` overlap | 0 | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Exact duplicate across split | 0 | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Normalized duplicate across split | 0 | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Near-duplicate across split | 0 or approved exception | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Paraphrase/translation family split | 0 | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Simple/Complex contrast family split | 0 | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Source-derived dependency split | 0 | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Embedding/matrix persisted | false | `<작성>` | `<작성>` | `<PASS/FAIL>` |

Leakage conclusion: `<PASS/FAIL>`

Approved exceptions: `<없음 또는 safe ID와 승인 reference>`

## 7. Shared 5-fold audit

| Fold | Fit records | Fit families | Valid records | Valid families | Simple/Complex | Family overlap | Membership hash | Status |
|---:|---:|---:|---:|---:|---|---:|---|---|
| 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<0>` | `<작성>` | `<PASS/FAIL>` |
| 2 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<0>` | `<작성>` | `<PASS/FAIL>` |
| 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<0>` | `<작성>` | `<PASS/FAIL>` |
| 4 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<0>` | `<작성>` | `<PASS/FAIL>` |
| 5 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<0>` | `<작성>` | `<PASS/FAIL>` |

All candidates used exact same folds: `<PASS/FAIL>`

## 8. Fixed baseline reproduction

### 8.1 Baseline configuration

| Parameter | Planned | Observed | Status |
|---|---:|---:|---|
| learning_rate | 0.05 | `<작성>` | `<PASS/FAIL>` |
| num_leaves | 31 | `<작성>` | `<PASS/FAIL>` |
| max_depth | -1 | `<작성>` | `<PASS/FAIL>` |
| min_data_in_leaf | 20 | `<작성>` | `<PASS/FAIL>` |
| feature_fraction | 1.0 | `<작성>` | `<PASS/FAIL>` |
| bagging_fraction | 1.0 | `<작성>` | `<PASS/FAIL>` |
| bagging_freq | 0 | `<작성>` | `<PASS/FAIL>` |
| num_boost_round | 300 | `<작성>` | `<PASS/FAIL>` |
| early_stopping | 30 | `<작성>` | `<PASS/FAIL>` |
| class weighting | none | `<작성>` | `<PASS/FAIL>` |

### 8.2 Baseline fold results

| Fold | Average Precision | Binary log loss | Best iteration | Warning/error |
|---:|---:|---:|---:|---|
| 1 | `<작성>` | `<작성>` | `<작성>` | `<none/작성>` |
| 2 | `<작성>` | `<작성>` | `<작성>` | `<none/작성>` |
| 3 | `<작성>` | `<작성>` | `<작성>` | `<none/작성>` |
| 4 | `<작성>` | `<작성>` | `<작성>` | `<none/작성>` |
| 5 | `<작성>` | `<작성>` | `<작성>` | `<none/작성>` |
| Mean ± std | `<작성>` | `<작성>` | N/A | N/A |

Baseline reproduction status: `<PASS/FAIL>`

## 9. Deterministic Random Search

### 9.1 Frozen search space

| Parameter | Candidate values |
|---|---|
| learning_rate | 0.01, 0.03, 0.05, 0.1 |
| num_leaves | 7, 15, 31, 63 |
| max_depth | 4, 6, 8, -1 |
| min_data_in_leaf | 20, 50, 100, 200 |
| feature_fraction | 0.5, 0.7, 0.85, 1.0 |
| bagging_fraction | 0.7, 0.85, 1.0 |
| lambda_l1 | 0, 0.1, 1, 10 |
| lambda_l2 | 0, 0.1, 1, 10 |
| min_gain_to_split | 0, 0.01, 0.05, 0.1 |

Constraint: `max_depth != -1`이면 `num_leaves <= 2 ** max_depth`.

### 9.2 Search execution

| Item | Planned | Observed | Status |
|---|---:|---:|---|
| Seed | 20260721 | `<작성>` | `<PASS/FAIL>` |
| Frozen candidate count | 80 | `<작성>` | `<PASS/FAIL>` |
| Candidate set SHA-256 | required | `<작성>` | `<PASS/FAIL>` |
| Optional smoke count | first 30 | `<작성/N/A>` | `<PASS/FAIL/N/A>` |
| Full candidates completed | 80 | `<작성>` | `<PASS/FAIL>` |
| Fold runs expected | 400 per dimension candidate | `<작성>` | `<PASS/FAIL>` |
| Shared folds | exact | `<작성>` | `<PASS/FAIL>` |
| `num_boost_round` | 3000 | `<작성>` | `<PASS/FAIL>` |
| Early stopping rounds | 100 | `<작성>` | `<PASS/FAIL>` |
| Early stopping metric | binary_logloss | `<작성>` | `<PASS/FAIL>` |
| Selection metric | mean Average Precision | `<작성>` | `<PASS/FAIL>` |
| Tie-break | lower AP std, candidate ID | `<작성>` | `<PASS/FAIL>` |
| Failed candidates | 0 expected | `<작성>` | `<PASS/FAIL>` |

Failed candidate reason counts: `<없음 또는 aggregate reason/count>`

### 9.3 Top candidate summary

Sample별 score는 넣지 않고 candidate aggregate만 기록한다.

| Rank | Candidate ID | Mean AP | AP std | Min fold AP | Median best iteration | Status |
|---:|---|---:|---:|---:|---:|---|
| 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<selected>` |
| 2 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 4 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 5 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

전체 80개 aggregate result reference/hash: `<작성>`

## 10. Selected hyperparameters와 CV result

### 10.1 Selected parameters

| Parameter | Selected value |
|---|---|
| learning_rate | `<작성>` |
| num_leaves | `<작성>` |
| max_depth | `<작성>` |
| min_data_in_leaf | `<작성>` |
| feature_fraction | `<작성>` |
| bagging_fraction | `<작성>` |
| bagging_freq | `1` |
| lambda_l1 | `<작성>` |
| lambda_l2 | `<작성>` |
| min_gain_to_split | `<작성>` |
| best boosting iteration | `<5개 fold 중앙값>` |

Selected parameter canonical JSON/hash: `<작성>`

### 10.2 Selected candidate fold results

| Fold | Average Precision | Binary log loss at best iteration | Best iteration | Baseline AP | AP delta |
|---:|---:|---:|---:|---:|---:|
| 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 2 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 4 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 5 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Mean ± std | `<작성>` | `<작성>` | N/A | `<작성>` | `<작성>` |

### 10.3 Train 70% refit

| Check | Required | Observed | Status |
|---|---|---|---|
| Refit rows | Train 70% only | `<작성>` | `<PASS/FAIL>` |
| Validation used in fit | false | `<작성>` | `<PASS/FAIL>` |
| `num_boost_round` | median best iteration | `<작성>` | `<PASS/FAIL>` |
| Model feature count | D | `<작성>` | `<PASS/FAIL>` |
| Training warning/error | none | `<작성>` | `<PASS/FAIL>` |
| Model SHA-256 | required | `<작성>` | `<PASS/FAIL>` |

## 11. OOF generation과 calibration

### 11.1 OOF provenance

| Check | Required | Observed | Status |
|---|---|---|---|
| OOF folds | same frozen 5 folds | `<작성>` | `<PASS/FAIL>` |
| Train row coverage | exactly once | `<작성>` | `<PASS/FAIL>` |
| Family leakage | 0 | `<작성>` | `<PASS/FAIL>` |
| Non-finite probability | 0 | `<작성>` | `<PASS/FAIL>` |
| Outside [0,1] | 0 | `<작성>` | `<PASS/FAIL>` |
| OOF score persisted | false | `<작성>` | `<PASS/FAIL>` |

### 11.2 Calibration candidate results

| Calibrator | Fit input | Validation Brier | Validation Log loss | Extra diagnostic | Selected |
|---|---|---:|---:|---|---|
| none | identity | `<작성>` | `<작성>` | `<작성>` | `<Yes/No>` |
| platt | Train OOF logit | `<작성>` | `<작성>` | coef/intercept hash `<작성>` | `<Yes/No>` |
| isotonic | Train OOF probability | `<작성>` | `<작성>` | steps/min support `<작성>` | `<Yes/No>` |

Selection order: lowest Brier -> lowest log loss -> calibrator name.

Selected calibrator: `<작성>`

Calibrator artifact path/hash: `<작성>`

Library/serialization format: `<작성>`

Calibration selection status: `<PASS/FAIL/INSUFFICIENT>`

### 11.3 Aggregate calibration bins

Sample별 probability는 넣지 않는다.

| Bin | Count | Mean predicted P(Complex) | Observed Complex rate | Absolute gap |
|---:|---:|---:|---:|---:|
| 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 2 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 4 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 5 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 6 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 7 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 8 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 9 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 10 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

Bin policy: `<equal-width/equal-frequency와 empty-bin 처리>`

## 12. Validation threshold selection

### 12.1 Frozen policy

| Item | Value |
|---|---:|
| `C_FP` | 1.0 |
| `C_FN` scenarios | 1.0, 3.0, 5.0, 10.0 |
| Minimum Complex Recall | 0.95 |
| Candidates | unique calibrated Validation decision points |
| Fixed 0.01 grid | prohibited |
| EDL | `(C_FN * FN + C_FP * FP) / N_validation` |
| Bayes threshold | `C_FP / (C_FP + C_FN)` |

Safety gate:

1. Candidate overall FN <= champion overall FN
2. Candidate category FN <= champion category FN for all five categories
3. Candidate Complex Recall >= 0.95

Tie-break: EDL -> FN -> distance to Bayes threshold -> lower threshold.

Champion artifact/version/hash: `<작성>`

Validation row alignment identity/hash: `<작성>`

### 12.2 Champion validation safety baseline

| Category | Complex support | Champion FN | Champion Complex Recall | Evidence status |
|---|---:|---:|---:|---|
| Overall | `<작성>` | `<작성>` | `<작성>` | `<sufficient/insufficient>` |
| general | `<작성>` | `<작성>` | `<작성>` | `<sufficient/insufficient>` |
| code | `<작성>` | `<작성>` | `<작성>` | `<sufficient/insufficient>` |
| translation | `<작성>` | `<작성>` | `<작성>` | `<sufficient/insufficient>` |
| summarization | `<작성>` | `<작성>` | `<작성>` | `<sufficient/insufficient>` |
| reasoning | `<작성>` | `<작성>` | `<작성>` | `<sufficient/insufficient>` |

### 12.3 `C_FN` scenario results

| C_FN | Bayes threshold | Feasible candidates | Selected threshold | FN | FP | Complex Recall | EDL | Overall safety | Category safety | Owner selected |
|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| 1.0 | 0.5 | `<작성>` | `<작성/N/A>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<PASS/FAIL/INSUFFICIENT>` | `<Yes/No>` |
| 3.0 | 0.25 | `<작성>` | `<작성/N/A>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<PASS/FAIL/INSUFFICIENT>` | `<Yes/No>` |
| 5.0 | 0.166666... | `<작성>` | `<작성/N/A>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<PASS/FAIL/INSUFFICIENT>` | `<Yes/No>` |
| 10.0 | 0.090909... | `<작성>` | `<작성/N/A>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<PASS/FAIL/INSUFFICIENT>` | `<Yes/No>` |

Infeasible scenario reason: `<없음 또는 작성>`

Owner decision reference/date: `<작성>`

Selected `C_FN`: `<작성>`

Selected threshold, full precision: `<작성>`

### 12.4 Threshold stability

| Diagnostic | Result |
|---|---|
| Group bootstrap seed / repeats | `<작성>` |
| Median selected threshold | `<작성>` |
| Threshold interval | `<작성>` |
| FN interval | `<작성>` |
| FP interval | `<작성>` |
| Recall interval | `<작성>` |
| EDL interval | `<작성>` |
| Unique-family concentration risk | `<작성>` |
| Stability conclusion | `<stable / unstable / insufficient>` |

## 13. Pre-Test freeze와 access record

| Freeze item | Frozen identity/value | Verified by role | Status |
|---|---|---|---|
| Dataset/manifest | `<작성>` | `<role>` | `<PASS/FAIL>` |
| Split membership | `<작성>` | `<role>` | `<PASS/FAIL>` |
| Fold membership | `<작성>` | `<role>` | `<PASS/FAIL>` |
| Encoder/projection and D | `<작성>` | `<role>` | `<PASS/FAIL>` |
| Candidate set | `<작성>` | `<role>` | `<PASS/FAIL>` |
| Selected parameters | `<작성>` | `<role>` | `<PASS/FAIL>` |
| Best iteration | `<작성>` | `<role>` | `<PASS/FAIL>` |
| Model artifact | `<작성>` | `<role>` | `<PASS/FAIL>` |
| Calibrator artifact | `<작성>` | `<role>` | `<PASS/FAIL>` |
| `C_FN` owner decision | `<작성>` | `<role>` | `<PASS/FAIL>` |
| Threshold | `<작성>` | `<role>` | `<PASS/FAIL>` |
| Champion identity | `<작성>` | `<role>` | `<PASS/FAIL>` |
| Evaluation code/config | `<작성>` | `<role>` | `<PASS/FAIL>` |

Freeze timestamp: `<작성>`

Test first access timestamp: `<작성>`

Test outcome access before freeze: `<없음이어야 함>`

Frozen candidates evaluated on Test: `<1이어야 함>`

Test evaluation attempts: `<1이어야 함>`

## 14. Final Test evaluation

### 14.1 Overall metrics

| Metric | Test result | 95% family-group CI | Support/denominator | Champion | Delta | Notes |
|---|---:|---|---:|---:|---:|---|
| Accuracy | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Macro F1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Complex F2 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| ROC-AUC | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Average Precision | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Calibration Brier score | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | lower is better |
| Calibration log loss | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | lower is better |
| False Negative count | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | Actual Complex -> Simple |
| False Positive count | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | Actual Simple -> Complex |

Bootstrap method/seed/repeats: `<작성>`

### 14.2 Per-class metrics

| Class | Precision | Recall | F1 | F2 | Support |
|---|---:|---:|---:|---:|---:|
| Simple | `<작성>` | `<작성>` | `<작성>` | `<N/A 또는 작성>` | `<작성>` |
| Complex | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 14.3 Confusion matrix

| | Predicted Simple | Predicted Complex |
|---|---:|---:|
| Actual Simple | TN = `<작성>` | FP = `<작성>` |
| Actual Complex | FN = `<작성>` | TP = `<작성>` |

Consistency checks:

- `TN + FP + FN + TP == N_test`: `<PASS/FAIL>`
- `FN == reported False Negative`: `<PASS/FAIL>`
- `FP == reported False Positive`: `<PASS/FAIL>`

### 14.4 Frozen threshold의 Test `C_FN` EDL

같은 frozen prediction에 비용만 다르게 적용한다.

| C_FN | Frozen threshold | FN | FP | Expected Decision Loss | Diagnostic only |
|---:|---:|---:|---:|---:|---|
| 1.0 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | true |
| 3.0 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | true |
| 5.0 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | true |
| 10.0 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | true |

Test 결과로 `C_FN` 또는 threshold를 다시 선택하지 않았는가: `<PASS/FAIL>`

## 15. Overall와 category safety

| Category | Simple n | Complex n | Champion FN | Candidate FN | Champion FP | Candidate FP | Candidate FN <= champion | Complex Recall >= .95 | Evidence |
|---|---:|---:|---:|---:|---:|---:|---|---|---|
| Overall | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<PASS/FAIL>` | `<sufficient/insufficient>` |
| general | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<PASS/FAIL/N/A>` | `<sufficient/insufficient>` |
| code | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<PASS/FAIL/N/A>` | `<sufficient/insufficient>` |
| translation | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<PASS/FAIL/N/A>` | `<sufficient/insufficient>` |
| summarization | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<PASS/FAIL/N/A>` | `<sufficient/insufficient>` |
| reasoning | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<PASS/FAIL/N/A>` | `<sufficient/insufficient>` |

Overall safety gate: `<PASS/FAIL>`

All-category safety gate: `<PASS/FAIL/INSUFFICIENT>`

Category support limitation: `<작성>`

## 16. Required slice results

| Slice | Total n | Families | Simple n | Complex n | Accuracy | Complex Recall | FN | FP | Champion FN | Result/evidence |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| long_simple | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성/N/A>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| short_complex | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| korean | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| english | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| mixed_language | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| negation | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| indirect_expression | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| synonym | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| payload_contamination | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| category_confusion | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| ood_terminology | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

Slice definition/version/hash: `<작성>`

표본이 부족한 slice는 `insufficient`로 기록하고 개선으로 주장하지 않는다.

## 17. Dimension, latency와 artifact diagnostics

| Candidate | D | CV mean AP ± std | Validation Brier | Selected threshold | Encoder+predict p50 | p95 | Peak RSS | Model bytes | Interpretation |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| `<필요시 추가>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

Measurement protocol:

| Item | Value |
|---|---|
| Warmup count | `<작성>` |
| Measured requests/batches | `<작성>` |
| Batch size | `<작성>` |
| Timing boundary | `<encoder+classification / classification only>` |
| Process isolation | `<작성>` |
| CPU affinity/power state | `<작성>` |

이 측정은 offline diagnostic이며 runtime SLA 또는 production capacity evidence가 아니다.

## 18. Offline artifact와 metadata

| Field | Required / observed |
|---|---|
| promotionState | `exploratory_only` |
| runtimeProfileGenerated | `false` |
| featureShape | `embedding_only_d{D}` |
| embeddingDimension | `<D>` |
| labelMapping | `0=simple, 1=complex` |
| model format | `lightgbm_text` |
| model relative path | `<작성>` |
| model size/SHA-256 | `<작성>` |
| model numFeatures | `<D>` |
| selected parameters | `<section 10 reference/hash>` |
| bestIteration | `<작성>` |
| calibrator type | `<작성>` |
| calibrator format/path/hash | `<작성>` |
| threshold | `<작성>` |
| selected `C_FN` | `<작성>` |
| dataset version/hash | `<작성>` |
| split policy/membership hash | `<작성>` |
| fold membership hash | `<작성>` |
| encoder/tokenizer identity/hash | `<작성>` |
| projection identity/hash | `<none 또는 작성>` |
| containsEmbeddingMatrix | false |
| containsPerSampleScore | false |

Artifact integrity/load test: `<PASS/FAIL>`

Runtime profile file count: `<0이어야 함>`

Shadow/runtime endpoint connection: `<없음이어야 함>`

## 19. Data safety audit

| Prohibited content | Found count | Evidence | Status |
|---|---:|---|---|
| raw prompt/response/detected value/fragment | `<0>` | `<작성>` | `<PASS/FAIL>` |
| instruction/payload/normalized text | `<0>` | `<작성>` | `<PASS/FAIL>` |
| token/token ID | `<0>` | `<작성>` | `<PASS/FAIL>` |
| embedding/projection vector/matrix | `<0>` | `<작성>` | `<PASS/FAIL>` |
| raw logit/uncalibrated probability | `<0>` | `<작성>` | `<PASS/FAIL>` |
| sample-level calibrated probability/score | `<0>` | `<작성>` | `<PASS/FAIL>` |
| sample-level feature contribution/tree path | `<0>` | `<작성>` | `<PASS/FAIL>` |
| secret/credential/Authorization header | `<0>` | `<작성>` | `<PASS/FAIL>` |
| provider raw error body | `<0>` | `<작성>` | `<PASS/FAIL>` |
| high-cardinality metric label | `<0>` | `<작성>` | `<PASS/FAIL>` |

Memory/debug dump review: `<PASS/FAIL>`

Data safety conclusion: `<PASS/FAIL>`

## 20. Deviations, failures와 limitations

### 20.1 Protocol deviations

| Planned protocol | Actual execution | Reason | Bias/impact | Remediation/new version | Approved by role |
|---|---|---|---|---|---|
| `<없음 또는 작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 20.2 Failed/blocked events

| Time/run | Status code | Aggregate reason | Affected scope | Data/Test exposure | Resolution |
|---|---|---|---|---|---|
| `<없음 또는 작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 20.3 Known limitations

- Dataset provenance/representativeness: `<작성>`
- Human review coverage/agreement: `<작성>`
- Balanced offline data versus production prevalence: `<작성>`
- Family count and statistical power: `<작성>`
- Category/slice insufficient support: `<작성>`
- Encoder and `D` confounding: `<작성>`
- Calibration sample size and isotonic overfit risk: `<작성>`
- Validation reuse for calibrator and threshold selection: `<작성>`
- Distribution/concept drift: `<작성>`
- Champion prediction/version dependency: `<작성>`
- Offline environment versus production runtime: `<작성>`
- Embedding-only shape is not an active GateLM runtime profile: `<작성>`
- Other: `<작성>`

## 21. Hard gate review

| Gate | Required | Observed | Status |
|---|---|---|---|
| Dataset eligibility | all manifest gates pass | `<작성>` | `<PASS/FAIL>` |
| Offline scope | no runtime profile/connection | `<작성>` | `<PASS/FAIL>` |
| Dimension | exact finite float32 `[N,D]`, ragged 0 | `<작성>` | `<PASS/FAIL>` |
| Encoder freeze | immutable config/artifacts | `<작성>` | `<PASS/FAIL>` |
| Split leakage | cross-split family/duplicates 0 | `<작성>` | `<PASS/FAIL>` |
| Fold validity | 5 common family-disjoint folds | `<작성>` | `<PASS/FAIL>` |
| Baseline | same 5-fold reproduction | `<작성>` | `<PASS/FAIL>` |
| Search completeness | frozen 80 candidates, 400 fold runs | `<작성>` | `<PASS/FAIL>` |
| Candidate selection | mean AP, std tie-break | `<작성>` | `<PASS/FAIL>` |
| Iteration | fold median, Train-only refit | `<작성>` | `<PASS/FAIL>` |
| Calibration | Train OOF fit, Validation selection | `<작성>` | `<PASS/FAIL>` |
| Threshold | unique score, safety, EDL policy | `<작성>` | `<PASS/FAIL>` |
| Overall FN safety | candidate <= champion | `<작성>` | `<PASS/FAIL>` |
| Category FN safety | all five non-worse | `<작성>` | `<PASS/FAIL/INSUFFICIENT>` |
| Complex Recall | >= 0.95 | `<작성>` | `<PASS/FAIL>` |
| Pre-Test freeze | all identities frozen | `<작성>` | `<PASS/FAIL>` |
| Test integrity | one frozen candidate, one access | `<작성>` | `<PASS/FAIL>` |
| Required metrics | all complete/valid N/A reasons | `<작성>` | `<PASS/FAIL>` |
| Artifact integrity | model/calibrator/metadata hashes | `<작성>` | `<PASS/FAIL>` |
| Data safety | prohibited content 0 | `<작성>` | `<PASS/FAIL>` |

Hard gate 하나라도 실패하면 `VALID_OFFLINE_EVIDENCE`로 판정하지 않는다. 표본 부족으로 안전 결론을 낼 수 없으면 `INSUFFICIENT_EVIDENCE`로 기록한다.

## 22. Final decision과 sign-off

### 22.1 Final decision

- [ ] `VALID_OFFLINE_EVIDENCE` — 재현 가능한 offline 비교 evidence로 보존
- [ ] `INVALID` — protocol, safety 또는 Test integrity gate 실패
- [ ] `INSUFFICIENT_EVIDENCE` — 승인 데이터, family 또는 slice 확대 필요
- [ ] `BLOCKED` — dataset/dimension/split/fold precondition 미충족

Final reason: `<작성>`

Allowed claim: `<이 결과로 말할 수 있는 범위>`

Prohibited claim: `Runtime promotion, production readiness, release or GA`

Required next evidence: `<작성>`

### 22.2 Role-based approval

| Approval role | Decision | Date | Evidence reference | Conditions |
|---|---|---|---|---|
| Dataset owner | `<approve/reject>` | `<작성>` | `<작성>` | `<작성>` |
| Model/evaluation owner | `<approve/reject>` | `<작성>` | `<작성>` | `<작성>` |
| Product/routing owner | `<approve/reject>` | `<작성>` | `<작성>` | `<작성>` |
| Security/privacy reviewer | `<approve/reject/N/A>` | `<작성>` | `<작성>` | `<작성>` |
| Runtime owner | `N/A for offline` | `<작성>` | `<작성>` | `separate contract required` |

## 23. Reproduction references

| Item | Immutable reference |
|---|---|
| Experiment protocol | `<작성>` |
| Training command/config | `<작성>` |
| Evaluation command/config | `<작성>` |
| Dataset and manifest | `<작성>` |
| Split membership | `<작성>` |
| Fold membership | `<작성>` |
| Encoder/projection descriptor | `<작성>` |
| Frozen 80 candidates | `<작성>` |
| Baseline aggregate report | `<작성>` |
| CV aggregate report | `<작성>` |
| Calibration aggregate report | `<작성>` |
| Threshold aggregate report | `<작성>` |
| Pre-Test freeze record | `<작성>` |
| Test aggregate report | `<작성>` |
| Bootstrap/uncertainty report | `<작성>` |
| Latency/artifact report | `<작성>` |
| Model/calibrator/metadata artifacts | `<작성>` |
| Data safety scan | `<작성>` |

모든 reference는 immutable artifact 또는 commit에 연결한다. 이 section에도 금지 데이터와 sample별 score를 복사하지 않는다.
