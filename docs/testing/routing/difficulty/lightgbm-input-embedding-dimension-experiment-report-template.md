# GateLM LightGBM 입력 표현 고정 설정 비교 실험 리포트 양식

| Field | Value |
|---|---|
| Report status | `<draft / final>` |
| Experiment ID | `<작성>` |
| Evidence class | Exploratory offline comparison only |
| Experiment executed | `<false / true>` |
| Report date | `<YYYY-MM-DD>` |
| Dataset version | `<작성>` |
| Test access state | `<untouched / consumed once / exploratory multi-candidate comparison>` |
| Runtime profile generated | `false` |
| API/DB/Event/Metrics change | `none` |

> [!IMPORTANT]
> 이 리포트에는 embedding, matrix, prompt, sample별 probability·score를 넣지 않는다. 실행 전에는 모든 결과 칸을 placeholder로 유지하고, 실행 후에도 aggregate 값만 기록한다.

## 1. Decision summary

| Item | Result |
|---|---|
| Experiment completion | `<COMPLETE / INCOMPLETE / BLOCKED>` |
| Dataset eligibility | `<PASS / FAIL>` |
| Leakage audit | `<PASS / FAIL>` |
| Selected candidate by pre-registered Validation rule | `<E1 / E2 / E3 / E4 / none>` |
| Overall safety gate | `<PASS / FAIL / INSUFFICIENT>` |
| Category safety gate | `<PASS / FAIL / INSUFFICIENT>` |
| Final evidence decision | `<VALID_EXPLORATORY_EVIDENCE / INSUFFICIENT_EVIDENCE / INVALID / BLOCKED>` |
| Runtime promotion | `Not authorized by this report` |

### 1.1 한 문단 결론

`<어떤 dataset과 split을 사용했고, Validation에서 어떤 후보가 어떤 사전 등록 기준으로 선택됐으며, Test의 전체 성능·FN·Expected Decision Loss·category/slice 결과가 무엇인지 작성한다. Runtime 승격을 선언하지 않는다.>`

### 1.2 핵심 evidence

- `<Train CV AP 평균 ± 표준편차와 log loss>`
- `<Validation 선택 결과와 threshold>`
- `<Test accuracy, Macro F1, Complex recall/F2, FN/FP>`
- `<AP, ROC-AUC, Brier, log loss>`
- `<C_FN별 Expected Decision Loss>`
- `<category/slice 위험과 insufficient support>`
- `<latency와 artifact trade-off>`

## 2. Scope와 후보

| ID | 입력 표현 | 고정 차원 | 실행 여부 | 비고 |
|---|---|---:|---|---|
| E1 | E5-base raw embedding | 768D | `<작성>` | embedding-only baseline |
| E2 | exact rule 42D + raw embedding 768D | 810D | `<작성>` | raw + rule baseline |
| E3 | exact rule 42D + train-only PCA128 | 170D | `<작성>` | 저차원 직접 표현 |
| E4 | exact rule 42D + E5-base semantic-head 12D | 54D | `<작성>` | supervised bottleneck |

후보 변경 또는 PCA 차원 추가가 있었다면 결과를 보기 전에 승인된 새 experiment version과 근거를 기록한다.

## 3. Protocol execution audit

| Item | Frozen protocol | Actual execution | Status |
|---|---|---|---|
| Objective | Simple(0) / Complex(1) | `<작성>` | `<PASS/FAIL>` |
| Candidate set | E1–E4 고정 | `<작성>` | `<PASS/FAIL>` |
| Split | family-disjoint Train / Validation / Test | `<작성>` | `<PASS/FAIL>` |
| Shared Train CV | StratifiedGroupKFold | `<작성>` | `<PASS/FAIL>` |
| E3 PCA fit | Train only | `<작성>` | `<PASS/FAIL>` |
| E4 Train feature | family-group OOF probability | `<작성>` | `<PASS/FAIL>` |
| LightGBM parameters | 현재 shadow baseline 고정 | `<작성>` | `<PASS/FAIL>` |
| Threshold | Validation에서 현재 shadow rule 적용 | `<작성>` | `<PASS/FAIL>` |
| Test | 사전 정의된 access policy 준수 | `<작성>` | `<PASS/FAIL>` |

Protocol document: [LightGBM 입력 표현 고정 설정 비교 실험 설계서](../lightgbm-input-ablation-experiment-design.md)

## 4. Dataset provenance와 eligibility

### 4.1 Immutable provenance

| Artifact / policy | Version 또는 path | SHA-256 / identity | Freeze time |
|---|---|---|---|
| Dataset | `<작성>` | `<작성>` | `<작성>` |
| Dataset manifest | `<작성>` | `<작성>` | `<작성>` |
| Label guide | `<작성>` | `<작성>` | `<작성>` |
| Split policy | `<작성>` | `<작성>` | `<작성>` |
| Split membership | `<safe reference>` | `<작성>` | `<작성>` |
| Fold membership | `<safe reference>` | `<작성>` | `<작성>` |
| Experiment design | `<작성>` | `<작성>` | `<작성>` |
| Training/evaluation code | `<commit/path>` | `<작성>` | `<작성>` |

### 4.2 Eligibility gate

| Gate | Required | Observed | Evidence | Status |
|---|---|---|---|---|
| Training eligible | true | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Human reviewed | true | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Review status | approved | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Label coverage | complete | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Human-reviewed families | sufficient | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Required splits | all present | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Both labels in every split | present | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Dataset/manifest hash | match | `<작성>` | `<작성>` | `<PASS/FAIL>` |

## 5. Encoder와 feature provenance

| Item | Frozen / observed value |
|---|---|
| Encoder model ID | `<작성>` |
| Source revision | `<작성>` |
| Tokenizer artifact/hash | `<작성>` |
| Encoder artifact/hash | `<작성>` |
| Input prefix | `<작성>` |
| Maximum token length | `<작성>` |
| Pooling | `<작성>` |
| Output dtype/dimension | `<작성>` |
| Encoder weights | frozen |
| Rule vector version/dimension | `<작성>` |
| E3 PCA implementation | `<작성>` |
| E3 PCA fit split | `<작성>` |
| E3 explained variance ratio sum | `<작성>` |
| E4 semantic-head contract | `<작성>` |
| E4 OOF fold policy | `<작성>` |
| Persisted embedding/matrix | false |

Dimension mismatch count: `<0이어야 함>`

Non-finite row count: `<0이어야 함>`

## 6. Execution environment

| Item | Value |
|---|---|
| Host/run ID | `<safe identifier>` |
| OS / architecture | `<작성>` |
| CPU / accelerator | `<작성>` |
| Python | `<작성>` |
| NumPy | `<작성>` |
| scikit-learn | `<작성>` |
| LightGBM | `<작성>` |
| LightGBM API | `lgb.train()` |
| Device type | `<작성>` |
| Thread count | `<작성>` |
| Dirty working tree | `<false 또는 영향 범위>` |

Reproduction rerun result: `<exact match / tolerance match / mismatch / not run>`

## 7. Split와 leakage audit

### 7.1 Split counts

| Split | Records | Families | Simple | Complex | Access state |
|---|---:|---:|---:|---:|---|
| Train | `<작성>` | `<작성>` | `<작성>` | `<작성>` | available |
| Validation | `<작성>` | `<작성>` | `<작성>` | `<작성>` | selection only |
| Test | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 7.2 Category와 language coverage

| Split | general | code | translation | summarization | reasoning | ko | en | mixed | unknown |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Train | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Validation | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Test | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 7.3 Leakage checks

| Check | Required | Observed | Evidence | Status |
|---|---:|---:|---|---|
| Cross-split family overlap | 0 | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Cross-fold family overlap | 0 | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Exact duplicate across split | 0 | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Normalized duplicate across split | 0 | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Near-duplicate exception | none or approved | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| PCA fit includes Validation/Test | false | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| E4 Train in-sample head probability | false | `<작성>` | `<작성>` | `<PASS/FAIL>` |

## 8. Fixed LightGBM setting audit

| Parameter | Planned | Observed | Status |
|---|---:|---:|---|
| objective / metric | binary / binary_logloss | `<작성>` | `<PASS/FAIL>` |
| learning_rate | 0.05 | `<작성>` | `<PASS/FAIL>` |
| num_leaves | 31 | `<작성>` | `<PASS/FAIL>` |
| max_depth | -1 | `<작성>` | `<PASS/FAIL>` |
| min_data_in_leaf | 20 | `<작성>` | `<PASS/FAIL>` |
| feature_fraction | 1.0 | `<작성>` | `<PASS/FAIL>` |
| bagging_fraction / freq | 1.0 / 0 | `<작성>` | `<PASS/FAIL>` |
| class weighting | none | `<작성>` | `<PASS/FAIL>` |
| num_boost_round | 300 | `<작성>` | `<PASS/FAIL>` |
| early stopping | 30 | `<작성>` | `<PASS/FAIL>` |
| deterministic / force_col_wise | true / true | `<작성>` | `<PASS/FAIL>` |
| seed family | 20260721 | `<작성>` | `<PASS/FAIL>` |
| num_threads | 1 | `<작성>` | `<PASS/FAIL>` |

## 9. Shared Train cross-validation

### 9.1 Fold audit

| Fold | Fit records | Fit families | Valid records | Valid families | Family overlap | Membership hash | Status |
|---:|---:|---:|---:|---:|---:|---|---|
| `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<0>` | `<작성>` | `<PASS/FAIL>` |

필요한 fold 수만큼 행을 복제한다.

### 9.2 Candidate CV summary

| 후보 | Fold AP 목록 | Mean AP ± std | Mean log loss ± std | Median best iteration | Warning/error |
|---|---|---:|---:|---:|---|
| E1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<none/작성>` |
| E2 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<none/작성>` |
| E3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<none/작성>` |
| E4 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<none/작성>` |

## 10. Validation 결과와 후보 선택

| 후보 | D | Threshold | Best iteration | Accuracy | Balanced acc | Macro F1 | Complex recall | FN | FP | AP | ROC-AUC | Brier | Log loss |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| E1 | 768 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| E2 | 810 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| E3 | 170 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| E4 | 54 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 10.1 Selection record

| Item | Value |
|---|---|
| Pre-registered selection key | `<작성>` |
| Selected candidate | `<작성>` |
| Selection reason | `<작성>` |
| Selection timestamp | `<작성>` |
| Decision owner/reference | `<작성>` |
| Test still untouched at selection | `<PASS/FAIL>` |

## 11. Pre-Test freeze

| Frozen item | Identity/hash | Status |
|---|---|---|
| Dataset/manifest/split | `<작성>` | `<PASS/FAIL>` |
| Fold membership | `<작성>` | `<PASS/FAIL>` |
| Encoder/tokenizer | `<작성>` | `<PASS/FAIL>` |
| Feature candidate | `<작성>` | `<PASS/FAIL>` |
| PCA/head artifact | `<작성/N/A>` | `<PASS/FAIL/N/A>` |
| LightGBM parameters/iteration | `<작성>` | `<PASS/FAIL>` |
| Threshold | `<작성>` | `<PASS/FAIL>` |
| Model artifact | `<작성>` | `<PASS/FAIL>` |
| Evaluation code | `<작성>` | `<PASS/FAIL>` |

Test access count before freeze: `<0이어야 함>`

## 12. Test 전체 성능

| 후보 또는 frozen candidate | Accuracy | Balanced acc | Macro F1 | Complex P | Complex R | Complex F1 | Complex F2 | AP | ROC-AUC | Brier | Log loss |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

Strict promotion protocol이면 frozen candidate 한 행만 작성한다. Exploratory multi-candidate comparison이면 E1–E4 행을 모두 작성하고 evidence class를 명확히 낮춘다.

### 12.1 Class별 지표

| 후보 | Class | Precision | Recall | F1 | Support |
|---|---|---:|---:|---:|---:|
| `<작성>` | Simple | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| `<작성>` | Complex | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 12.2 Confusion matrix와 Expected Decision Loss

| 후보 | TN | FP | FN | TP | EDL `C_FN=1` | `C_FN=3` | `C_FN=5` | `C_FN=10` |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

다음 consistency를 확인한다.

- `TN + FP + FN + TP == N_test`: `<PASS/FAIL>`
- `FN == reported False Negative`: `<PASS/FAIL>`
- `FP == reported False Positive`: `<PASS/FAIL>`

## 13. Category safety

| 후보 | Category | Support | Accuracy | Balanced acc | Macro F1 | Complex recall | FN | FP | Baseline FN delta | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| `<작성>` | general | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL/INSUFFICIENT>` |
| `<작성>` | code | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL/INSUFFICIENT>` |
| `<작성>` | translation | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL/INSUFFICIENT>` |
| `<작성>` | summarization | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL/INSUFFICIENT>` |
| `<작성>` | reasoning | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL/INSUFFICIENT>` |

후보별로 위 다섯 행을 반복한다. 한 class support가 없으면 balanced accuracy 또는 recall을 0으로 채우지 않고 `not_computable`로 기록한다.

## 14. Required slice 결과

| 후보 | Slice | Support | Simple / Complex | Accuracy | Balanced acc | Macro F1 | Complex recall | FN | FP | Status |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|---|
| `<작성>` | long_simple | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<measured/insufficient/empty>` |
| `<작성>` | short_complex | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<measured/insufficient/empty>` |
| `<작성>` | korean | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<measured/insufficient/empty>` |
| `<작성>` | english | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<measured/insufficient/empty>` |
| `<작성>` | mixed_language | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<measured/insufficient/empty>` |
| `<작성>` | negation | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<measured/insufficient/empty>` |
| `<작성>` | indirect_expression | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<measured/insufficient/empty>` |
| `<작성>` | synonym | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<measured/insufficient/empty>` |
| `<작성>` | payload_contamination | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<measured/insufficient/empty>` |
| `<작성>` | category_confusion | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<measured/insufficient/empty>` |
| `<작성>` | ood_terminology | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<measured/insufficient/empty>` |

후보별로 필요한 slice 행을 반복한다.

## 15. E4 semantic-head 평가

| Head | Accuracy | Macro F1 | Class recall | Multiclass Brier | ECE | Confusion matrix | Status |
|---|---:|---:|---|---:|---:|---|---|
| Task | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL/INSUFFICIENT>` |
| Constraint | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL/INSUFFICIENT>` |
| Scope | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL/INSUFFICIENT>` |
| Dependency | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL/INSUFFICIENT>` |

Four-head exact-match accuracy: `<작성>`

Head 결과가 좋아도 최종 LightGBM routing 결과가 나쁘면 E4를 선택하지 않는다.

## 16. Latency와 artifact

| 후보 | Feature generation scope | Train fit ms | Validation predict ms/row | Test predict ms/row | LightGBM bytes | Auxiliary bytes | Pipeline bytes |
|---|---|---:|---:|---:|---:|---:|---:|
| E1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| E2 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| E3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| E4 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

Latency measurement의 warmup, 반복 수, batch size, encoder 포함 여부와 percentile을 명시한다.

## 17. Artifact와 hash

| Artifact | Relative path | Size | SHA-256 | Integrity |
|---|---|---:|---|---|
| Aggregate report | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| E1 LightGBM | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| E2 LightGBM | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| E3 LightGBM | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| E3 PCA | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| E4 LightGBM | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| E4 semantic heads | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |

## 18. Data safety audit

| Check | Required | Observed | Status |
|---|---|---|---|
| Raw prompt/response persisted | false | `<작성>` | `<PASS/FAIL>` |
| Instruction/payload text persisted | false | `<작성>` | `<PASS/FAIL>` |
| Embedding/PCA/training matrix persisted | false | `<작성>` | `<PASS/FAIL>` |
| Sample별 score/probability persisted | false | `<작성>` | `<PASS/FAIL>` |
| Semantic-head model parameter persisted | allowed | `<작성>` | `<PASS/FAIL>` |
| PCA projection parameter persisted | allowed | `<작성>` | `<PASS/FAIL>` |
| Secret/provider error persisted | false | `<작성>` | `<PASS/FAIL>` |
| Runtime profile generated | false | `<작성>` | `<PASS/FAIL>` |

## 19. Deviations, failures와 limitations

### 19.1 Protocol deviations

| Deviation | Reason | Bias/risk | Approval | Disposition |
|---|---|---|---|---|
| `<없음 또는 작성>` | `<작성>` | `<작성>` | `<작성>` | `<valid / invalid / rerun>` |

### 19.2 Execution failures

| Stage | Failure count | Aggregate reason | Resolution |
|---|---:|---|---|
| Encoding | `<작성>` | `<작성>` | `<작성>` |
| PCA | `<작성>` | `<작성>` | `<작성>` |
| Semantic heads | `<작성>` | `<작성>` | `<작성>` |
| LightGBM CV/train | `<작성>` | `<작성>` | `<작성>` |
| Evaluation/reporting | `<작성>` | `<작성>` | `<작성>` |

### 19.3 Limitations

- Dataset provenance/representativeness: `<작성>`
- Category balance와 support: `<작성>`
- Slice support: `<작성>`
- Family count와 statistical power: `<작성>`
- E3 PCA nesting limitation: `<작성>`
- E4 semantic-head class support/calibration: `<작성>`
- Validation reuse 또는 Test access limitation: `<작성>`
- Offline environment와 production runtime 차이: `<작성>`
- Other: `<작성>`

## 20. Hard gate review

| Gate | Required | Observed | Status |
|---|---|---|---|
| Dataset eligibility | approved and training eligible | `<작성>` | `<PASS/FAIL>` |
| Split leakage | 0 | `<작성>` | `<PASS/FAIL>` |
| Dimension contract | exact finite D | `<작성>` | `<PASS/FAIL>` |
| Candidate parity | same rows/splits/settings | `<작성>` | `<PASS/FAIL>` |
| E3 PCA | Train-only fit | `<작성>` | `<PASS/FAIL>` |
| E4 Train feature | OOF only | `<작성>` | `<PASS/FAIL>` |
| Required metrics | complete | `<작성>` | `<PASS/FAIL>` |
| Category/slice support | sufficient or disclosed | `<작성>` | `<PASS/FAIL/INSUFFICIENT>` |
| Test integrity | policy compliant | `<작성>` | `<PASS/FAIL>` |
| Artifact integrity | hashes match | `<작성>` | `<PASS/FAIL>` |
| Data safety | forbidden material absent | `<작성>` | `<PASS/FAIL>` |

## 21. Final decision과 sign-off

다음 중 하나만 선택한다.

- [ ] `VALID_EXPLORATORY_EVIDENCE` — 재현 가능한 offline 비교 결과
- [ ] `INSUFFICIENT_EVIDENCE` — dataset/category/slice 확대 또는 새 untouched Test 필요
- [ ] `INVALID` — protocol, safety 또는 Test integrity gate 실패
- [ ] `BLOCKED` — dataset/split/dimension precondition 미충족

선택 이유: `<작성>`

Runtime promotion: **이 리포트만으로 승인하지 않음**

| Role | Name/reference | Decision | Date |
|---|---|---|---|
| Dataset owner | `<작성>` | `<approve/reject>` | `<작성>` |
| Model/evaluation owner | `<작성>` | `<approve/reject>` | `<작성>` |
| Routing/product owner | `<작성>` | `<approve/reject>` | `<작성>` |
| Security/privacy reviewer | `<작성>` | `<approve/reject>` | `<작성>` |

## 22. Reproduction references

| Item | Path/reference |
|---|---|
| Design | `docs/testing/routing/difficulty/lightgbm-input-ablation-experiment-design.md` |
| Dataset/manifest | `<작성>` |
| Runner | `<작성>` |
| Aggregate evidence | `<작성>` |
| Model/PCA/head artifacts | `<작성>` |
| Verification commands/output | `<작성>` |
| Commit/branch | `<작성>` |

모든 reference는 해당 실행에서 freeze한 immutable artifact 또는 commit을 가리켜야 한다.

