# GateLM LightGBM 입력 표현 고정 설정 비교 실험 설계서

| Field | Value |
|---|---|
| Status | Reusable protocol template; freeze before each execution |
| Experiment ID | `<실행 전에 작성>` |
| Evidence class | Exploratory offline comparison only |
| Dataset | `<향후 승인된 dataset version>` |
| Split | `<manifest에 고정된 family-disjoint Train / Validation / Test>` |
| LightGBM policy | 현재 `lightgbm_shadow.py` 설정 고정 |
| Promotion state | `exploratory_only` |
| Runtime/API change | None |

> [!IMPORTANT]
> 이 실험의 독립 변수는 LightGBM에 전달되는 입력 표현뿐이다. LightGBM parameter, 학습 예산, seed, split, threshold 선택 규칙은 후보 간 동일하게 유지한다. 이 문서는 runtime 승격 또는 active routing contract 변경을 승인하지 않는다.

## 1. 목적과 가설

승인된 동일 sample에서 다음 네 입력 표현의 난이도 분류 성능, under-routing 위험, 확률 품질과 비용을 비교한다.

- E1은 E5-base 임베딩 자체의 분류력을 측정한다.
- E2는 E1에 exact 42D rule vector를 추가했을 때의 증분 효과를 측정한다.
- E3은 train-only PCA128로 축소해도 E2의 성능을 유지하는지 측정한다.
- E4는 E5-base 임베딩을 4-head × 3-class 확률 12D로 압축한 supervised bottleneck의 효과를 측정한다.

첨부 문서의 E3에는 128D와 256D가 모두 제시되어 있으나, 이번 요청의 비교 대상을 네 개로 고정하기 위해 사전 우선 후보인 PCA128만 사용한다. PCA256은 결과를 본 뒤 추가하지 않으며 별도 실험으로만 수행할 수 있다.

## 2. 고정 후보

| ID | 입력 | 차원 | 비고 |
|---|---|---:|---|
| `E1_embedding_768` | E5-base raw embedding | 768 | 규칙 없음 |
| `E2_embedding_768_plus_rule_42` | raw embedding + exact rule vector | 810 | 결합 순서는 rule 42D, embedding 768D |
| `E3_pca_128_plus_rule_42` | train-only PCA128 + exact rule vector | 170 | PCA 후 row L2 normalization |
| `E4_semantic_heads_12_plus_rule_42` | E5-base semantic-head probability 12D + exact rule vector | 54 | 결합 순서는 rule 42D, head 12D |

모든 embedding은 고정된 `intfloat/multilingual-e5-base` revision `d13f1b27baf31030b7fd040960d60d909913633f`, `query: ` prefix, attention-mask mean pooling, `float32[768]`을 사용한다. Encoder weight는 학습하지 않는다.

## 3. 데이터와 누수 방지

- 실행 전에 dataset version, dataset hash, manifest hash와 split policy를 고정하고 결과에 기록한다.
- 승인된 manifest의 partition을 Train, Validation, Test에 일대일로 매핑하고 그 매핑을 실행 전에 기록한다.
- dataset은 해당 실험의 training eligibility, human review와 label coverage gate를 통과해야 한다.
- 같은 `promptFamily`는 한 split에만 존재해야 하며 교차 split family 수는 0이어야 한다.
- 모든 split에 Simple과 Complex가 모두 존재해야 한다.
- PCA는 Train embedding으로만 `sklearn.decomposition.PCA(n_components=128, svd_solver="full", whiten=False)`를 fit한다. Validation/Test에는 transform만 적용한다.
- embedding, PCA matrix, rule row, semantic-head probability와 sample별 LightGBM score는 process memory에서만 사용하고 파일로 저장하지 않는다.

## 4. E4 semantic-head 학습

네 head의 label은 기존 `taskBucket`, `constraintBucket`, `scopeBucket`, `dependencyBucket`을 사용한다. 각 head는 3-class L2 Logistic Regression이다.

```text
solver = lbfgs
penalty = l2
C = 1.0
max_iter = 1000
random_state = 20260721
```

Train용 12D는 `StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=20260721)`의 OOF 확률로 생성한다. 그룹은 `promptFamily`, stratification target은 Simple/Complex이다. 각 fold에서 head는 outer-train에만 fit하고 outer-valid 확률을 생성한다. Validation/Test에는 Train 전체로 fit한 head를 적용한다. Head hyperparameter 탐색은 하지 않는다.

## 5. 고정 LightGBM 설정

현재 `scripts/routing_difficulty_model/gatelm_difficulty_model/lightgbm_shadow.py`의 값을 그대로 사용한다.

| Parameter | Frozen value |
|---|---:|
| objective | `binary` |
| metric | `binary_logloss` |
| learning_rate | 0.05 |
| num_leaves | 31 |
| max_depth | -1 (LightGBM default) |
| min_data_in_leaf | 20 |
| feature_fraction | 1.0 |
| bagging_fraction | 1.0 |
| bagging_freq | 0 |
| lambda_l1 / lambda_l2 | 0 / 0 (LightGBM default) |
| num_boost_round | 300 |
| early_stopping_rounds | 30 |
| seed family | 20260721 |
| deterministic | true |
| force_col_wise | true |
| num_threads | 1 |

후보별로 Train에 fit하고 Validation `binary_logloss`로 early stopping한다. best iteration의 model을 저장한다. 하이퍼파라미터 search, class weight, calibration과 후보별 학습 예산 변경은 하지 않는다.

## 6. Threshold와 후보 선택

현재 shadow 구현과 동일하게 Validation에서 `0.01`부터 `0.99`까지 `0.01` 간격을 순회한다. 선택 순서는 다음과 같다.

1. accuracy 최대
2. `complex -> simple` FN 최소
3. 0.5와 거리 최소
4. threshold 최소

최종 비교 순서는 안전 요구를 반영해 다음 aggregate를 함께 제시하되, 단일 후보의 runtime 승격을 선언하지 않는다.

1. Validation `complex -> simple` FN 비악화 여부
2. Expected Decision Loss
3. accuracy, balanced accuracy, Macro F1, Complex recall/F2
4. Average Precision, ROC-AUC, Brier score, log loss
5. 위 결과가 실질적으로 비슷할 때 입력 차원, 추론 latency, artifact 크기

## 7. 평가지표

기존 LightGBM 하이퍼파라미터 실험 리포트의 최종 평가 항목을 네 후보에 동일하게 적용한다.

### 7.1 전체 및 class 지표

- Accuracy, balanced accuracy, Macro F1
- Simple/Complex precision, recall, F1, support
- Complex F2
- ROC-AUC, Average Precision
- raw probability Brier score, binary log loss
- TN, FP, FN, TP와 `complex -> simple`, `simple -> complex`
- `C_FP=1`, `C_FN in {1,3,5,10}`의 Expected Decision Loss

### 7.2 Category와 slice

각 category와 아래 slice에 대해 support, accuracy, balanced accuracy, Macro F1, Complex recall, FN, FP를 aggregate로 기록한다.

`long_simple`, `short_complex`, `korean`, `english`, `mixed_language`, `negation`, `indirect_expression`, `synonym`, `payload_contamination`, `category_confusion`, `ood_terminology`

label support가 부족한 지표는 0으로 대체하지 않고 `not_computable`로 기록한다.

### 7.3 학습·운영 진단

- 후보별 best iteration
- Train fit wall-clock time
- Validation/Test batch prediction wall-clock time와 row당 평균
- LightGBM model artifact byte size와 SHA-256
- PCA explained variance(E3 보조 지표)
- semantic-head 자체 Test Macro F1, class recall, Brier score, ECE, confusion matrix와 four-head exact-match accuracy(E4 보조 지표)

## 8. 해석 제한

- dataset, family, category와 slice support가 충분한지는 실행 결과에서 별도로 판정하며, 부족하면 `INSUFFICIENT_EVIDENCE`로 기록한다.
- 네 후보를 같은 Test에서 비교하므로 이 결과는 strict one-shot promotion evidence가 아니다.
- threshold는 calibration 없이 raw LightGBM probability에 적용한다.
- latency는 현재 Windows offline process의 batch 측정이며 production single-request SLA가 아니다.
- 결과를 보고 PCA256, C, threshold, LightGBM parameter를 추가 선택하면 새 experiment version이 필요하다.
- active LR 106D 경로, Gateway route, RuntimeSnapshot, API/DB/Event/Metrics는 변경하지 않는다.

## 9. 완료 기준

- 네 후보만 동일 row/split/LightGBM 설정으로 학습된다.
- family leakage 0, dimension mismatch 0, non-finite row 0이다.
- Validation과 Test에 7.1의 전체 지표가 모두 기록된다.
- Test category/slice와 E4 head 보조 지표가 aggregate로 기록된다.
- 모델과 aggregate JSON 이외에 embedding/matrix/sample score가 저장되지 않는다.
- 결과 리포트에 실행 환경, provenance, deviation과 limitation이 명시된다.

## 10. 구현 후 runtime 재사용 경계

2026-07-22에 구현된 four-profile offline-shadow bundle과 이 설계서의 후보 대응은 다음과 같다. 이 대응은 실험 후보나 완료 기준을 변경하지 않으며 새로운 실험 evidence를 의미하지 않는다.

| 설계 후보 | 현재 four-profile runtime 후보 | 대응 상태 |
|---|---|---|
| `E1_embedding_768` | `e5_base_raw_768` | 동일한 E5-base raw 768D 입력 표현 |
| `E2_embedding_768_plus_rule_42` | `rule_42_plus_e5_base_raw_768` | 동일한 rule 42D + E5-base raw 768D 입력 표현 |
| `E3_pca_128_plus_rule_42` | 없음 | runtime bundle의 106D 후보는 E5-small PCA64이므로 E3와 다름 |
| `E4_semantic_heads_12_plus_rule_42` | 없음 | runtime bundle의 54D 후보는 E5-small PCA64 기반 semantic heads이므로 E4와 다름 |

차원이 같다는 사실만으로 실험 artifact를 runtime profile에 재사용하지 않는다. Encoder model/revision, projection 또는 semantic-head provenance와 class order, feature order, dataset/split identity, LightGBM model hash가 모두 일치할 때만 같은 후보로 취급한다.
