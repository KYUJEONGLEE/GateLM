# GateLM LightGBM Embedding Hyperparameter Experiment Design

| Field | Value |
|---|---|
| Status | Pre-registered offline experiment design; not an active runtime contract |
| Applies to | Embedding-only LightGBM Simple/Complex binary classification |
| Evidence class | Exploratory offline evidence only |
| Dimension policy | Dimension is parameterized across runs and fixed within one run/artifact |
| Execution authorization | Not granted; design and report-template authoring only |
| Promotion state | `exploratory_only` |
| Runtime profile generated | `false` |
| Random seed | `20260721` |
| LightGBM | Official `lightgbm==4.6.0`, `lgb.train()` |
| Prepared on | 2026-07-21 |

> [!IMPORTANT]
> 이 문서에서 임베딩 차원 `D`는 설계 시점에 768로 고정하지 않는다. 그러나 하나의 학습 실행, 하나의 LightGBM model artifact, 하나의 추론 요청 계약 안에서는 모든 벡터가 동일한 exact `D`를 가져야 한다. 샘플마다 길이가 다른 ragged vector를 padding, truncation 또는 zero-fill로 조용히 맞추지 않는다.

> [!CAUTION]
> 현재 15,000건 candidate dataset은 `training_eligible=false`, `production_gold=false`, `human_reviewed=false`이므로 실제 학습, calibration, threshold 선택 또는 promotion evidence에 사용할 수 없다. 이 설계서는 dataset owner의 사람 검수와 manifest 승인을 우회하지 않는다.

> [!WARNING]
> 이 문서 작성 요청은 실험 실행 권한을 포함하지 않는다. 별도의 명시적 실행 승인과 승인된 dataset이 모두 준비되기 전에는 dependency 설치, embedding 생성, `lgb.train()` 호출, Random Search, calibration, threshold 계산 또는 Test 접근을 수행하지 않는다. 아래 코드는 향후 구현을 위한 reference pseudocode다.

## 1. 목적과 결정 범위

목적은 동일한 데이터 분할과 fold에서 LightGBM 하이퍼파라미터 후보를 공정하게 비교하고, 다음 산출물을 재현 가능하게 선택하는 것이다.

1. 최적 LightGBM 하이퍼파라미터
2. 최적 boosting iteration
3. Train OOF score로 학습한 calibrator
4. Validation safety constraint를 만족하는 decision threshold
5. freeze된 단일 후보의 최종 Test 성능

예측 흐름은 다음과 같다.

```text
안전하게 정제된 instruction text
  -> 고정된 encoder configuration
  -> exact float32[D] embedding
  -> LightGBM binary classifier
  -> raw P(Complex)
  -> selected calibrator
  -> calibrated P(Complex)
  -> frozen threshold
  -> Simple(0) / Complex(1)
```

LightGBM은 자연어를 직접 읽지 않는다. `feature_0 .. feature_(D-1)`에 대한 tree split, tree structure와 leaf value를 학습한다. 임베딩의 한 차원이 사람이 해석할 수 있는 단일 의미를 가진다고 주장하지 않는다.

이 실험의 성공은 runtime promotion, production readiness, GA 또는 현재 권위 모델 교체를 뜻하지 않는다. Gateway hot path, API, DB, Event, Metrics, RuntimeSnapshot과 routing policy는 변경하지 않는다.

## 2. 사전 등록할 질문과 가설

실행 전에 다음 질문, 가설과 판단 규칙을 freeze한다.

| ID | 질문 / 가설 | 주 판단 근거 |
|---|---|---|
| Q1 | 고정 baseline보다 tuned LightGBM의 ranking 품질이 높은가? | Train 5-fold mean Average Precision 및 std |
| Q2 | 확률 보정이 Validation calibration을 개선하는가? | Brier score, log loss |
| Q3 | under-routing safety를 지키는 threshold가 존재하는가? | 전체·category별 FN 비악화, Complex Recall >= 0.95 |
| Q4 | 최종 후보가 untouched Test에서도 유지되는가? | Test classification, ranking, calibration, safety metric |
| Q5 | 서로 다른 `D`의 후보 중 어떤 feature generator가 유리한가? | 동일 split/fold/search budget의 별도 run 비교 |

`D`가 다른 encoder를 비교하면 encoder architecture, tokenizer, training corpus와 pooling 차이가 함께 바뀔 수 있다. 따라서 이 비교는 “feature-generator 후보 비교”이지 차원 수만의 인과 효과가 아니다. 차원 효과만 분리하려면 동일한 base embedding에서 Train-only PCA 등 사전 등록한 projection으로 `D`만 바꾸는 별도 ablation을 수행한다.

### 2.1 별도 실행 승인 gate

실행자는 다음 항목이 모두 충족된 뒤에만 별도 작업으로 실험을 시작할 수 있다.

- 요청자 또는 지정 owner의 명시적 실험 실행 승인
- Dataset owner가 승인한 training-eligible dataset과 immutable manifest
- 이 설계서의 protocol version/hash freeze
- 사용할 encoder/dimension candidate 목록 freeze
- compute budget, 실행환경과 artifact output 위치 승인
- Test 접근 권한과 pre-Test freeze 책임자 지정

이 gate가 열리기 전 문서 검토와 정적 검증만 허용한다. 설계서 작성자가 실험 실행을 추론하여 선행하지 않는다.

## 3. 현재 GateLM 경계

현재 구현과 이 문서의 차이를 명시적으로 분리한다.

| Topic | Current code/contract | This offline design |
|---|---|---|
| Native embedding | Pinned E5-base exact 768D profile | `D` parameterized per run |
| Runtime LightGBM input | rule 42D + raw/PCA semantic vector | embedding-only candidate |
| Tuning | fixed baseline parameters | deterministic Random Search 80 candidates |
| Candidate selection | Validation accuracy 우선 | Train CV mean Average Precision 우선 |
| Threshold | 0.01 grid, Validation accuracy 우선 | unique calibrated score decision points, safety + EDL |
| Calibration | current fixed path에 없음 | none / Platt / Isotonic 비교 |
| Authority | 106D LR path | 없음; offline only |

따라서 이 문서의 선택 정책을 현재 shadow/runtime 코드에 적용하려면 active contract와 구현을 함께 변경하고 별도 검토해야 한다. 이 문서만으로 runtime profile을 만들거나 endpoint에 연결하지 않는다.

## 4. 입력, 라벨과 차원 계약

### 4.1 필수 입력

| Item | Contract |
|---|---|
| Embedding rows | 각 row는 1차원 finite numeric vector |
| Run dimension | `D = encoder.outputDimension`, 모든 row에 exact 동일 |
| Feature matrix | `X.shape == (N, D)`, `float32`, C-contiguous 권장 |
| Label vector | `y.shape == (N,)`, `int8`, Simple=0, Complex=1 |
| Family | record마다 non-empty `family_id` |
| Split | `train`, `validation`, `test` 중 하나 |
| Category | `general`, `code`, `translation`, `summarization`, `reasoning` |
| Alignment | X, y, family, split, category의 row order와 길이가 동일 |

`D`는 encoder descriptor에서 읽고 실제 첫 row와 교차 검증한다. Encoder descriptor, tokenizer, revision, prefix, max length, pooling, normalization이 다르면 다른 feature generator이자 다른 experiment candidate다.

### 4.2 Ragged input의 fail-closed 처리

```python
from collections.abc import Sequence

import numpy as np


def build_embedding_matrix(
    embedding_rows: Sequence[Sequence[float]],
    *,
    declared_dimension: int,
) -> np.ndarray:
    if not isinstance(declared_dimension, int) or declared_dimension <= 0:
        raise ValueError("declared_dimension must be a positive integer")
    if not embedding_rows:
        raise ValueError("embedding_rows must not be empty")

    rows = [np.asarray(row, dtype=np.float32) for row in embedding_rows]
    bad_rank = [index for index, row in enumerate(rows) if row.ndim != 1]
    dimensions = {int(row.shape[0]) for row in rows if row.ndim == 1}

    if bad_rank:
        raise ValueError("every embedding row must be one-dimensional")
    if dimensions != {declared_dimension}:
        raise ValueError(
            "ragged or encoder-dimension-mismatched embeddings are prohibited"
        )

    matrix = np.ascontiguousarray(np.stack(rows), dtype=np.float32)
    if matrix.shape != (len(rows), declared_dimension):
        raise ValueError("embedding matrix shape mismatch")
    if not np.all(np.isfinite(matrix)):
        raise ValueError("embedding matrix contains NaN or infinity")
    return matrix
```

다음 동작은 명시적으로 금지한다.

- 짧은 row를 zero padding하여 다른 encoder output과 섞기
- 긴 row를 잘라 artifact가 기대하는 `D`에 맞추기
- 서로 다른 encoder의 row를 같은 matrix에 넣기
- 누락 embedding을 zero vector나 mean vector로 대체하기
- Validation/Test를 사용해 PCA, scaler, imputer 또는 feature selector를 fit하기

차원 변환이 필요하면 별도 candidate로 사전 등록한다. Projection은 Train에만 fit하고 Validation/Test에는 transform만 적용하며 projection artifact와 hash를 모델 provenance에 포함한다.

### 4.3 추론 계약

학습 완료 후에는 `D`가 모델 아티팩트의 일부로 고정된다. 추론 입력이 exact `float32[D]`가 아니면 예측하지 않고 stable dimension-mismatch error로 종료한다. 모델이 임의 차원을 동적으로 수용한다고 표현하지 않는다.

## 5. Dataset eligibility와 provenance gate

학습 전에 manifest가 다음 조건을 모두 만족해야 한다.

- `scope.training_eligible = true`
- `review.production_gold = true`
- `review.human_reviewed = true`
- `review.review_status = approved`
- `counts.human_reviewed_records > 0`
- Train/Validation/Test가 모두 존재
- 각 split에 Simple과 Complex가 모두 존재
- 모든 record의 family, split, label, category가 유효
- dataset file과 manifest의 SHA-256가 일치
- 중복·near-duplicate audit가 완료되고 예외가 owner 승인됨
- encoder가 요구한 모든 record에 exact finite `D` embedding을 생성함

하나라도 실패하면 상태는 `BLOCKED_DATASET_INELIGIBLE`이며 학습을 시작하지 않는다. 일부 row만 제외하여 비공식 dataset을 만들지 않는다. 제외가 필요하면 dataset version, count, split membership과 hash를 다시 발급하고 실험을 재등록한다.

현재 15,000건 candidate dataset은 balanced 7,500/7,500이지만 training eligibility와 사람 검수 gate를 통과하지 않았으므로 class balance와 관계없이 사용할 수 없다.

## 6. Train / Validation / Test 분리

```text
전체 승인 데이터
├── Train 70%
│   ├── 공통 family-group 5-Fold CV
│   │   └── hyperparameters와 fold best_iteration 선택
│   └── 같은 5-fold OOF raw probability
│       └── calibrator fit
├── Validation 15%
│   ├── calibrator 선택
│   └── C_FN scenario와 threshold 선택
└── Test 15%
    └── 모든 선택 freeze 후 단 한 번 최종 평가
```

Manifest에 승인된 split이 있으면 그대로 사용한다. 새 split이 필요한 경우 label과 category를 가능한 한 보존하는 family-group split을 생성하고, owner 승인과 membership hash를 받은 후 동결한다.

### 6.1 Leakage 방지

다음 항목은 반드시 한 split에만 존재해야 한다.

- 같은 `family_id`
- 같은 원본 프롬프트의 표현 변형
- 번역, 축약, 확장, 길이 변형
- Simple/Complex 조건 contrast pair
- exact, normalized 또는 near-duplicate
- 같은 데이터 출처에서 파생되어 답을 사실상 공유하는 묶음

Random record split은 금지한다. Cross-split family overlap, exact duplicate, normalized duplicate는 0이어야 한다. Near-duplicate는 원칙적으로 0이며, 예외가 있으면 내용이 아닌 safe sample ID, 판정 근거와 owner 승인을 report에 기록한다.

### 6.2 분할 검증 예시

```python
import numpy as np


def validate_split_alignment(
    X: np.ndarray,
    y: np.ndarray,
    family_ids: np.ndarray,
    split_labels: np.ndarray,
    categories: np.ndarray,
) -> dict[str, np.ndarray]:
    n_records = len(y)
    if X.ndim != 2 or X.shape[0] != n_records:
        raise ValueError("X must have shape (N, D)")
    if not (
        len(family_ids) == len(split_labels) == len(categories) == n_records
    ):
        raise ValueError("row-aligned arrays have different lengths")
    if set(np.unique(y).tolist()) != {0, 1}:
        raise ValueError("labels must contain both 0 and 1")
    if set(np.unique(split_labels).tolist()) != {
        "train", "validation", "test"
    }:
        raise ValueError("required splits are missing")

    indices = {
        split: np.flatnonzero(split_labels == split)
        for split in ("train", "validation", "test")
    }
    family_sets = {
        split: set(family_ids[index].tolist())
        for split, index in indices.items()
    }
    if not family_sets["train"].isdisjoint(family_sets["validation"]):
        raise ValueError("train/validation family leakage")
    if not family_sets["train"].isdisjoint(family_sets["test"]):
        raise ValueError("train/test family leakage")
    if not family_sets["validation"].isdisjoint(family_sets["test"]):
        raise ValueError("validation/test family leakage")
    if any(set(y[index].tolist()) != {0, 1} for index in indices.values()):
        raise ValueError("every split must contain both labels")
    return indices
```

Embedding과 학습 matrix는 process memory에서만 사용하고 `.npy`, `.npz`, parquet, JSON 또는 debug dump로 저장하지 않는다. Train/Validation/Test와 fold membership은 raw text 없는 safe record ID 또는 membership hash로 보존할 수 있다.

## 7. Encoder와 feature candidate 등록

각 dimension candidate마다 다음 항목을 결과를 보기 전에 freeze한다.

| Area | Required value |
|---|---|
| Candidate ID | 사람이 읽을 수 있는 stable identifier |
| Model ID | encoder repository/model identity |
| Source revision | immutable commit/revision |
| Artifact identity | tokenizer/config/model file size와 SHA-256 |
| Input boundary | masking 후 instruction field 정의 |
| Prefix | 예: `query: ` 또는 없음 |
| Max length | tokenizer 기준 정수 |
| Truncation | side와 policy |
| Pooling | CLS, mean, attention-mask mean 등 exact algorithm |
| Normalization | L2 적용 여부와 epsilon |
| Output dtype | `float32` |
| Output dimension | exact positive integer `D` |
| Optional projection | kind, fit split, input/output D, hash |

서로 다른 `D` 후보에는 동일한 dataset rows, split, fold와 80개 parameter candidate를 사용한다. Feature 생성 실패 row가 하나라도 있으면 그 candidate를 stop하고 고친 뒤 전체 run을 다시 시작한다. candidate별로 다른 row를 조용히 제거하지 않는다.

## 8. LightGBM 실행환경과 고정 파라미터

공식 `lightgbm==4.6.0`과 `lgb.train()`을 사용한다.

```python
FIXED_PARAMS = {
    "objective": "binary",
    "metric": "binary_logloss",
    "boosting_type": "gbdt",
    "bagging_freq": 1,
    "deterministic": True,
    "force_col_wise": True,
    "device_type": "cpu",
    "num_threads": 1,
    "seed": 20260721,
    "feature_fraction_seed": 20260721,
    "bagging_seed": 20260721,
    "data_random_seed": 20260721,
    "verbosity": -1,
}
```

`num_threads`, `force_col_wise`, `device_type`, seed와 verbosity는 품질 탐색 대상이 아니라 재현 가능한 실행환경 설정이다. OS, CPU architecture, Python, NumPy, scikit-learn, compiler/native library와 thread 환경도 report에 기록한다.

계획된 balanced dataset에는 `class_weight`, `is_unbalance`, `scale_pos_weight`를 사용하지 않는다. 최종 승인 dataset의 label 비율이 달라졌다면 자동으로 weight를 켜지 않고 분포 변화와 selection metric 영향을 검토하여 protocol을 다시 등록한다.

LightGBM은 다음을 데이터에서 자동으로 학습한다.

- 각 tree에서 사용할 feature
- split 기준값
- tree 구조
- 각 leaf의 출력값
- 이전 tree의 오류를 보완하는 boosting 순서

이 값은 직접 설정하지 않고 최종 text model에 저장한다.

## 9. 고정 baseline 재현

먼저 현재 고정 baseline을 동일한 5-fold 전체에서 재현한다.

| Parameter | Baseline |
|---|---:|
| learning_rate | 0.05 |
| num_leaves | 31 |
| max_depth | -1 |
| min_data_in_leaf | 20 |
| feature_fraction | 1.0 |
| bagging_fraction | 1.0 |
| lambda_l1 | 0 |
| lambda_l2 | 0 |
| min_gain_to_split | 0 |
| bagging_freq | 0 |
| num_boost_round | 300 |
| early_stopping_rounds | 30 |

한 fold만 사용하는 코드는 smoke 확인에만 쓸 수 있다. Tuned candidate와의 공식 비교 baseline은 동일한 5개 fold, 동일한 row와 동일 metric으로 측정한다. Baseline 실패, warning, non-finite score 또는 재현 불일치는 본 탐색 전에 해결한다.

## 10. 하이퍼파라미터 탐색 공간

| Parameter | Candidate values | Role |
|---|---|---|
| `learning_rate` | 0.01, 0.03, 0.05, 0.1 | tree 하나의 학습 강도 |
| `num_leaves` | 7, 15, 31, 63 | leaf-wise tree 복잡도 |
| `max_depth` | 4, 6, 8, -1 | 최대 깊이; -1은 제한 없음 |
| `min_data_in_leaf` | 20, 50, 100, 200 | leaf 최소 sample 수 |
| `feature_fraction` | 0.5, 0.7, 0.85, 1.0 | tree별 feature subsampling |
| `bagging_fraction` | 0.7, 0.85, 1.0 | tree별 row subsampling |
| `lambda_l1` | 0, 0.1, 1, 10 | L1 regularization |
| `lambda_l2` | 0, 0.1, 1, 10 | L2 regularization |
| `min_gain_to_split` | 0, 0.01, 0.05, 0.1 | split 최소 gain |

제약은 `max_depth != -1`일 때 `num_leaves <= 2 ** max_depth`다. 모든 유효 조합을 stable lexicographic order로 만든 뒤 seed `20260721`의 난수 생성기로 replacement 없이 80개를 선택한다. 별도 AutoML, Bayesian optimization 또는 결과 기반 candidate 추가는 사용하지 않는다.

| Run type | Candidate budget |
|---|---:|
| Optional smoke | frozen 80개 목록의 앞 30개; 운영 확인용 |
| Final experiment | frozen 80개 전체 |

Smoke 결과를 보고 80개 목록이나 탐색 공간을 바꾸지 않는다. 바꿔야 하면 새로운 experiment version으로 재등록한다.

### 10.1 Candidate 생성 예시

```python
from itertools import product
import json
import hashlib

import numpy as np


SEARCH_SPACE = {
    "learning_rate": (0.01, 0.03, 0.05, 0.1),
    "num_leaves": (7, 15, 31, 63),
    "max_depth": (4, 6, 8, -1),
    "min_data_in_leaf": (20, 50, 100, 200),
    "feature_fraction": (0.5, 0.7, 0.85, 1.0),
    "bagging_fraction": (0.7, 0.85, 1.0),
    "lambda_l1": (0, 0.1, 1, 10),
    "lambda_l2": (0, 0.1, 1, 10),
    "min_gain_to_split": (0, 0.01, 0.05, 0.1),
}


def frozen_candidates(seed: int = 20260721, count: int = 80) -> list[dict]:
    names = tuple(SEARCH_SPACE)
    combinations = []
    for values in product(*(SEARCH_SPACE[name] for name in names)):
        candidate = dict(zip(names, values, strict=True))
        if (
            candidate["max_depth"] != -1
            and candidate["num_leaves"] > 2 ** candidate["max_depth"]
        ):
            continue
        combinations.append(candidate)

    combinations.sort(
        key=lambda item: json.dumps(item, sort_keys=True, separators=(",", ":"))
    )
    rng = np.random.default_rng(seed)
    selected_indices = rng.choice(len(combinations), size=count, replace=False)
    selected = [combinations[int(index)] for index in selected_indices]
    return selected


def candidate_set_sha256(candidates: list[dict]) -> str:
    payload = json.dumps(
        candidates,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()
```

실제 구현은 candidate order, canonical JSON 규칙, candidate ID와 SHA-256를 artifact로 freeze한다.

## 11. 공통 family-group 5-fold

Train 70% 안에서 `StratifiedGroupKFold(n_splits=5, shuffle=True, random_state=20260721)`를 사용한다. Fold는 parameter candidate나 dimension candidate마다 다시 만들지 않는다. 한 번 생성한 membership을 모든 비교에 공유한다.

각 fold에 대해 다음을 검사한다.

- train-fold와 valid-fold family overlap 0
- 두 label 모두 존재
- category와 language 분포 기록
- records와 family count 기록
- safe membership manifest 또는 membership hash 기록

특정 fold에 label이 하나뿐이거나 family가 너무 적어 stratification이 불가능하면 split을 임의 수정하지 않고 `BLOCKED_INVALID_FOLD`로 종료한다.

## 12. CV 학습, early stopping과 candidate 선택

각 parameter candidate × 5 folds를 학습한다.

| Setting | Value |
|---|---:|
| `num_boost_round` upper bound | 3000 |
| Early stopping metric | fold Validation `binary_logloss` |
| `stopping_rounds` | 100 |
| `first_metric_only` | true |
| Candidate selection metric | fold Average Precision mean, higher is better |
| Primary tie-break | fold Average Precision std, lower is better |
| Final deterministic tie-break | candidate ID lexical order |

Average Precision은 각 fold의 `booster.best_iteration`에서 측정한다. Early stopping은 binary log loss로 iteration을 선택하고, Random Search candidate 선택은 mean Average Precision으로 수행한다. 두 판단의 차이를 report에 명시한다.

`min_data_in_leaf`를 candidate마다 바꾸므로 각 candidate/fold마다 새 `lgb.Dataset`을 만든다. Parameter 변경을 위해 이미 구성한 Dataset을 재사용하지 않는다.

```python
import lightgbm as lgb
import numpy as np
from sklearn.metrics import average_precision_score


def evaluate_candidate(
    X_train: np.ndarray,
    y_train: np.ndarray,
    folds: list[tuple[np.ndarray, np.ndarray]],
    candidate_params: dict,
) -> dict:
    fold_ap = []
    fold_iterations = []

    for fit_index, valid_index in folds:
        fit_dataset = lgb.Dataset(
            X_train[fit_index],
            label=y_train[fit_index],
            free_raw_data=True,
        )
        valid_dataset = lgb.Dataset(
            X_train[valid_index],
            label=y_train[valid_index],
            reference=fit_dataset,
            free_raw_data=True,
        )
        booster = lgb.train(
            params={**FIXED_PARAMS, **candidate_params},
            train_set=fit_dataset,
            num_boost_round=3000,
            valid_sets=[valid_dataset],
            valid_names=["fold_validation"],
            callbacks=[
                lgb.early_stopping(
                    stopping_rounds=100,
                    first_metric_only=True,
                    verbose=False,
                ),
                lgb.log_evaluation(period=0),
            ],
        )
        probability = np.asarray(
            booster.predict(
                X_train[valid_index],
                num_iteration=booster.best_iteration,
            ),
            dtype=np.float64,
        )
        if not np.all(np.isfinite(probability)):
            raise ValueError("non-finite CV probability")
        fold_ap.append(
            float(average_precision_score(y_train[valid_index], probability))
        )
        fold_iterations.append(int(booster.best_iteration))

    return {
        "fold_average_precision": fold_ap,
        "mean_average_precision": float(np.mean(fold_ap)),
        "std_average_precision": float(np.std(fold_ap, ddof=1)),
        "fold_best_iteration": fold_iterations,
        "best_iteration": int(np.median(fold_iterations)),
    }
```

최종 ranking은 부동소수점 출력 반올림으로 후보를 바꾸지 않도록 full precision value로 계산한다. Report display만 정해진 자릿수로 반올림한다. Exact tie는 stable candidate ID로 해결한다.

CV 도중 exception, warning-as-error로 등록한 경고, non-finite score 또는 early stopping 미작동이 발생한 후보는 실패 이유를 aggregate로 기록한다. 선택 가능한 후보가 80개 미만이 되면 사전 등록한 허용 규칙이 없는 한 experiment를 invalid 처리하며 실패 후보를 임의로 새 조합으로 대체하지 않는다.

## 13. 최적 iteration과 Train 70% 전체 refit

선택된 candidate의 5개 fold `best_iteration` 중앙값을 final `best_iteration`으로 사용한다. 짝수 개가 아니므로 중앙값은 관찰된 정수 하나다.

```python
best_params = {**FIXED_PARAMS, **best_result["params"]}
best_iteration = int(np.median(best_result["fold_best_iteration"]))

full_train_dataset = lgb.Dataset(X_train, label=y_train)
final_model = lgb.train(
    params=best_params,
    train_set=full_train_dataset,
    num_boost_round=best_iteration,
)
```

Validation 15%는 parameter, candidate 또는 best iteration 선택에 사용하지 않는다. Refit에서 early stopping을 다시 수행하지 않는다. 최종 model의 feature count가 `D`와 일치하는지 확인한다.

## 14. Train OOF probability와 calibration

선택된 parameter와 `best_iteration`으로 동일한 Train 5-fold OOF raw probability를 생성한다. 각 Train row는 자신을 학습에 사용하지 않은 fold model에서 정확히 한 번 score를 받아야 한다.

비교할 calibrator는 다음 세 개다.

| Candidate | Fit input | Frozen details |
|---|---|---|
| `none` | fit 없음 | identity |
| `platt` | clipped OOF probability의 logit | L2 LogisticRegression, lbfgs, seed, coefficient/intercept |
| `isotonic` | OOF raw probability | out_of_bounds=clip, threshold arrays |

Platt와 Isotonic은 Train OOF score와 `y_train`에만 fit한다. final Train model의 Validation raw probability에 각 calibrator를 적용하여 Validation Brier score가 가장 낮은 후보를 선택한다. 동률이면 낮은 log loss, 그다음 calibrator name lexical order로 결정한다.

```python
import numpy as np
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss


def probability_logit(probability: np.ndarray) -> np.ndarray:
    clipped = np.clip(probability, 1e-12, 1.0 - 1e-12)
    return np.log(clipped / (1.0 - clipped))


platt_model = LogisticRegression(
    penalty="l2",
    solver="lbfgs",
    max_iter=1000,
    random_state=20260721,
).fit(probability_logit(oof_probability).reshape(-1, 1), y_train)

isotonic_model = IsotonicRegression(out_of_bounds="clip").fit(
    oof_probability,
    y_train,
)
```

OOF coverage, family separation, score finiteness와 `[0,1]` 범위를 검증한다. Isotonic의 effective step 수와 각 step support를 diagnostic으로 기록한다. 표본 부족으로 과적합 위험이 높으면 선택 결과와 별개로 limitation을 표시한다.

Calibrator는 name만 저장하지 않는다. Platt coefficient/intercept 또는 Isotonic threshold arrays를 안전하고 검증 가능한 JSON/array artifact로 직렬화하고 format, library version, size와 SHA-256를 기록한다. 임의 pickle 실행에 의존하지 않는다.

## 15. Validation threshold 최적화

### 15.1 비용과 safety policy

| Setting | Value |
|---|---:|
| `C_FP` | 1.0 |
| `C_FN` scenarios | 1.0, 3.0, 5.0, 10.0 |
| Minimum Complex Recall | 0.95 |
| EDL | `(C_FN * FN + C_FP * FP) / N_validation` |
| Bayes threshold | `C_FP / (C_FP + C_FN)` |

`champion_val_prediction`은 같은 Validation row order에서 현재 권위 모델이 만든 frozen prediction이어야 한다. `category_val`, `y_val`, candidate probability와 champion prediction의 safe row identity hash가 일치해야 한다.

각 threshold는 다음 safety constraint를 모두 만족해야 한다.

1. 전체 `Complex -> Simple` FN이 champion보다 증가하지 않는다.
2. 다섯 category 각각의 FN이 champion보다 증가하지 않는다.
3. 전체 Complex Recall이 0.95 이상이다.

Category에 Complex support가 0이면 FN 비악화는 계산할 수 있지만 recall safety evidence는 `insufficient`로 표시한다. 누락 category 또는 row mismatch를 0으로 간주하지 않는다.

### 15.2 정확한 decision point 순회

Validation calibrated probability의 고유값을 내림차순으로 사용한다. 최대 score보다 큰 `nextafter` 값으로 all-Simple 상태를 포함하고, 최소 score threshold로 all-Complex 상태를 포함한다. `0.01` 고정 grid는 최종 선택에 사용하지 않는다.

Safety를 통과한 후보의 선택 순서는 다음과 같다.

1. Expected Decision Loss 최소
2. FN 최소
3. 이론적 Bayes threshold와 절대거리 최소
4. threshold 값이 더 낮음

```python
import numpy as np

C_FP = 1.0
C_FN_SCENARIOS = (1.0, 3.0, 5.0, 10.0)
MIN_COMPLEX_RECALL = 0.95


def false_negative_count(labels: np.ndarray, predictions: np.ndarray) -> int:
    return int(np.sum((labels == 1) & (predictions == 0)))


def threshold_candidates(probability: np.ndarray) -> np.ndarray:
    probability = np.asarray(probability, dtype=np.float64)
    if probability.ndim != 1 or not np.all(np.isfinite(probability)):
        raise ValueError("invalid validation probability")
    if np.any((probability < 0.0) | (probability > 1.0)):
        raise ValueError("calibrated probability must stay in [0,1]")
    unique_scores = np.unique(probability)[::-1]
    all_simple = np.nextafter(float(unique_scores[0]), np.inf)
    return np.concatenate(([all_simple], unique_scores))


def select_threshold_for_cost(
    *,
    c_fn: float,
    probability: np.ndarray,
    labels: np.ndarray,
    categories: np.ndarray,
    champion_prediction: np.ndarray,
) -> dict:
    if not (
        len(probability)
        == len(labels)
        == len(categories)
        == len(champion_prediction)
    ):
        raise ValueError("validation arrays are misaligned")

    champion_fn = false_negative_count(labels, champion_prediction)
    category_values = np.unique(categories)
    champion_category_fn = {
        category: false_negative_count(
            labels[categories == category],
            champion_prediction[categories == category],
        )
        for category in category_values
    }

    feasible = []
    bayes_threshold = C_FP / (C_FP + c_fn)
    for threshold in threshold_candidates(probability):
        prediction = (probability >= threshold).astype(np.int8)
        fn = false_negative_count(labels, prediction)
        fp = int(np.sum((labels == 0) & (prediction == 1)))
        tp = int(np.sum((labels == 1) & (prediction == 1)))
        complex_count = tp + fn
        recall = tp / complex_count if complex_count else 0.0
        category_passed = all(
            false_negative_count(
                labels[categories == category],
                prediction[categories == category],
            )
            <= champion_category_fn[category]
            for category in category_values
        )
        if not (
            fn <= champion_fn
            and category_passed
            and recall >= MIN_COMPLEX_RECALL
        ):
            continue
        edl = (c_fn * fn + C_FP * fp) / len(labels)
        feasible.append({
            "threshold": float(threshold),
            "false_negative": fn,
            "false_positive": fp,
            "complex_recall": float(recall),
            "expected_decision_loss": float(edl),
            "bayes_threshold": float(bayes_threshold),
        })

    if not feasible:
        raise ValueError("no threshold satisfies the frozen safety constraints")
    return min(
        feasible,
        key=lambda item: (
            item["expected_decision_loss"],
            item["false_negative"],
            abs(item["threshold"] - item["bayes_threshold"]),
            item["threshold"],
        ),
    )
```

각 `C_FN` scenario가 infeasible인지도 결과다. Constraint를 완화하거나 0.5로 fallback하지 않는다. Product owner는 네 scenario의 FN, FP, recall, EDL, threshold stability를 검토하고 하나를 선택한다. Owner 선택 reference, 이유와 timestamp를 기록한다.

### 15.3 Threshold stability diagnostic

Validation family를 단위로 bootstrap하여 선택 threshold, FN, FP, recall과 EDL의 분포를 보조 진단한다. 이 결과로 사전 등록한 선택 규칙을 바꾸지 않는다. Threshold가 소수 family나 같은 score tie에 과도하게 의존하면 limitation 또는 `INSUFFICIENT_EVIDENCE`로 기록한다.

## 16. Pre-Test freeze

Test를 열기 전에 다음 identity를 하나의 freeze record로 고정한다.

- dataset, manifest와 split membership hash
- Train 5-fold membership hash
- encoder/tokenizer/projection identity와 `D`
- frozen 80-candidate set hash
- selected LightGBM parameters와 best iteration
- final Train model SHA-256
- selected calibrator artifact SHA-256
- selected `C_FN`과 owner decision reference
- selected threshold
- evaluation code commit와 config hash
- champion artifact/prediction identity

Freeze 이전 Test label, model score, probability, prediction 또는 aggregate outcome access는 0이어야 한다. Test 접근 로그와 timestamp를 보존한다.

## 17. 최종 Test 평가

Frozen final model로 raw Test probability를 한 번 생성하고 frozen calibrator와 threshold를 적용한다. Test 결과를 본 뒤 parameter, dimension candidate, best iteration, calibrator, `C_FN` 또는 threshold를 다시 선택하지 않는다.

필수 overall metric은 다음과 같다.

- Accuracy
- Macro F1
- Simple Precision / Recall / F1 / support
- Complex Precision / Recall / F1 / support
- Complex F2
- ROC-AUC
- Average Precision
- Calibration Brier score
- Calibration log loss
- TN, FP, FN, TP
- False Negative count
- False Positive count
- frozen prediction에 대한 `C_FN`별 Expected Decision Loss
- 전체·category별 champion 대비 safety gate

Test의 `C_FN`별 EDL은 같은 frozen threshold와 같은 FN/FP에 비용만 적용하는 diagnostic이다. Test에서 scenario별 threshold를 다시 고르지 않는다.

ROC-AUC, Average Precision 또는 class metric에 필요한 label support가 없으면 0으로 채우지 않고 `not_computable`로 기록한다. 그러나 split contract는 원칙적으로 두 label을 요구하므로 이는 protocol failure다.

Confusion matrix 순서는 다음으로 고정한다.

| | Predicted Simple | Predicted Complex |
|---|---:|---:|
| Actual Simple | TN | FP |
| Actual Complex | FN | TP |

`FN = 실제 Complex인데 Simple로 분류한 요청`이며 핵심 under-routing safety error다.

## 18. Category, slice와 불확실성 분석

다섯 category별로 support, class metric, FN/FP, champion delta와 safety status를 기록한다. 다음 slice도 aggregate로 평가한다.

- long_simple
- short_complex
- korean
- english
- mixed_language
- negation
- indirect_expression
- synonym
- payload_contamination
- category_confusion
- ood_terminology

각 slice의 정의와 membership policy를 결과 전에 freeze한다. 표본이 없거나 너무 적으면 개선으로 해석하지 않고 `insufficient`로 기록한다.

최종 metric의 불확실성은 family를 sampling unit으로 한 stratified group bootstrap confidence interval을 권장한다. Record 단위 bootstrap으로 같은 family 변형을 독립 sample처럼 세지 않는다. Bootstrap seed, 반복 수, percentile/BCa 방법을 기록한다. Confidence interval은 point estimate를 대체하지 않고 함께 제공한다.

## 19. Dimension candidate 비교 규칙

서로 다른 `D`를 비교할 때 다음을 지킨다.

1. 동일한 승인 dataset version과 row set 사용
2. 동일한 70/15/15 membership 사용
3. 동일한 Train 5-fold membership 사용
4. 동일한 80개 parameter set과 compute budget 사용
5. candidate별 encoder/projection 실패 row 0
6. candidate마다 독립 hyperparameter search와 calibration 수행
7. 공통 Test는 feature-generator candidate까지 freeze된 뒤 한 번만 사용

여러 dimension candidate 중 하나를 Validation으로 고르면 이 선택도 Test 전 freeze 대상이다. 모든 dimension candidate를 Test에서 비교한 뒤 승자를 고르는 것은 금지한다.

최종 후보 선택 규칙을 사전 등록하지 않았다면 dimension comparison은 exploratory 결과로만 남기고 Test promotion evidence로 사용하지 않는다. Dimension이 작다는 이유만으로 성능 동률을 선언하지 않으며, 사전 등록한 tolerance 안에서만 latency, model size와 memory를 tie-break로 사용할 수 있다.

## 20. Offline artifact와 immutable metadata

허용되는 기본 산출물은 다음과 같다.

- LightGBM text model
- calibrator parameter artifact
- immutable metadata JSON
- aggregate CV/calibration/threshold/Test report
- safe split/fold membership hash 또는 raw text 없는 safe-ID manifest
- optional Train-only projection parameter artifact

Embedding, training matrix와 sample별 score/probability 파일은 저장하지 않는다.

권장 파일명은 experiment ID와 `D`를 포함한다.

```text
difficulty-lightgbm-embedding-d{D}-offline.{experimentVersion}.txt
difficulty-lightgbm-embedding-d{D}-calibrator.{experimentVersion}.json
difficulty-lightgbm-embedding-d{D}-metadata.{experimentVersion}.json
```

Metadata에는 최소 다음 필드를 포함한다.

```json
{
  "promotionState": "exploratory_only",
  "runtimeProfileGenerated": false,
  "featureShape": "embedding_only_d{D}",
  "embeddingDimension": "<positive integer D>",
  "labelMapping": {"0": "simple", "1": "complex"},
  "encoder": {
    "modelId": "<immutable identity>",
    "sourceRevision": "<immutable revision>",
    "inputPrefix": "<value>",
    "maximumTokenLength": "<integer>",
    "pooling": "<exact algorithm>",
    "l2Normalization": "<boolean>",
    "artifactSha256": "<hash set>"
  },
  "model": {
    "format": "lightgbm_text",
    "relativePath": "<safe relative path>",
    "sha256": "<64 lowercase hex>",
    "parameters": "<selected fixed+tuned params>",
    "bestIteration": "<positive integer>",
    "numFeatures": "<D>"
  },
  "calibrator": {
    "type": "<none|platt|isotonic>",
    "relativePath": "<safe relative path or null>",
    "sha256": "<hash or null>"
  },
  "threshold": "<frozen float>",
  "decisionCost": {"cFp": 1.0, "cFn": "<owner-selected>"},
  "dataset": {
    "version": "<version>",
    "sha256": "<hash>",
    "splitPolicyVersion": "<version>",
    "splitMembershipSha256": "<hash>",
    "foldMembershipSha256": "<hash>"
  },
  "containsEmbeddingMatrix": false,
  "containsPerSampleScore": false
}
```

JSON 예시의 placeholder는 실제 schema가 아니다. 실제 저장 전 machine-readable schema와 verifier를 별도 승인한다. `embeddingDimension`은 실제 artifact에서 정수여야 한다.

모델 load 후 `num_features == D`, model hash, calibrator hash, threshold 범위와 encoder identity를 검증한다. Hash 불일치는 fail closed한다.

## 21. Data safety와 금지 데이터

다음 값은 report, log, API response, DB, Event, metric label, metadata 또는 debug artifact에 평문으로 남기지 않는다.

- raw prompt, raw response, raw detected value, raw prompt fragment
- instruction text, payload text, normalized text
- token 또는 token ID
- embedding, PCA vector 또는 training/evaluation matrix
- raw logit, uncalibrated probability
- sample별 calibrated probability 또는 score
- feature contribution 또는 tree path의 sample별 설명
- API Key, App Token, Provider Key, Authorization header
- provider raw error body 또는 actual secret

허용되는 report 내용은 aggregate metric/count, safe sample ID, low-cardinality slice/category, immutable hash와 승인된 비민감 metadata다. Metric label에는 sample ID, family ID, hash, error detail 또는 high-cardinality value도 넣지 않는다.

Memory dump, notebook output, exception repr 또는 verbose LightGBM log가 matrix 일부를 출력하지 않는지 검토한다. Process 종료 후 embedding과 matrix를 재사용 가능한 파일로 남기지 않는다.

## 22. Invalid, blocked와 insufficient 기준

| Status | Condition |
|---|---|
| `BLOCKED_DATASET_INELIGIBLE` | dataset eligibility gate 실패 |
| `BLOCKED_DIMENSION_MISMATCH` | ragged row, descriptor/actual D mismatch |
| `BLOCKED_INVALID_SPLIT` | split/class/family leakage 문제 |
| `BLOCKED_INVALID_FOLD` | 5-fold 구성 불가 또는 leakage |
| `INVALID_PROTOCOL_DEVIATION` | frozen candidate/fold/selection rule 변경 |
| `INVALID_TEST_CONTAMINATION` | freeze 전 Test outcome access 또는 Test 재사용 |
| `INVALID_DATA_SAFETY` | 금지 데이터가 artifact/report에 포함 |
| `INSUFFICIENT_EVIDENCE` | 표본·slice·calibration support 또는 stability 부족 |
| `VALID_OFFLINE_EVIDENCE` | 모든 hard gate 통과; offline 의미로만 유효 |

실패한 safety constraint를 threshold 변경, category 제외, sample 삭제 또는 post-hoc metric 교체로 숨기지 않는다. Protocol deviation이 필요하면 이유, bias, 승인과 새 experiment version을 남긴다.

## 23. 역할과 승인

| Role | Responsibility |
|---|---|
| Dataset owner | label, family, split, human-review와 training eligibility 승인 |
| Model/evaluation owner | encoder, candidate set, folds, training, metric과 freeze 재현성 |
| Product/routing owner | `C_FN`, safety policy와 threshold 선택 |
| Security/privacy reviewer | 금지 데이터, artifact surface와 provenance 검토 |
| Runtime owner | 이 offline 결과와 별개인 향후 contract/runtime 검토 |

한 사람이 여러 role을 맡을 수 있지만 report에는 role별 decision과 날짜를 분리 기록한다.

## 24. 실행 단계 요약

1. Dataset owner가 사람 검수와 training eligibility를 승인한다.
2. Encoder candidate별 immutable configuration과 output `D`를 freeze한다.
3. 모든 row의 exact finite `float32[D]` embedding을 process memory에 생성한다.
4. Manifest의 family-disjoint 70/15/15 split과 leakage audit를 확인한다.
5. Train에서 공통 StratifiedGroupKFold 5-fold membership을 생성·freeze한다.
6. 같은 folds에서 고정 baseline을 재현한다.
7. Frozen 80개 Random Search 후보를 각 5 folds에서 평가한다.
8. Mean Average Precision 최대, std 최소로 parameter를 선택한다.
9. 5개 fold best iteration 중앙값으로 Train 70% 전체를 refit한다.
10. 같은 Train folds에서 OOF raw probability를 만들고 calibrator를 fit한다.
11. Validation Brier/log loss로 none, Platt, Isotonic 중 하나를 선택한다.
12. Validation unique score decision point에서 safety-constrained EDL threshold를 구한다.
13. Product owner가 `C_FN` scenario와 threshold를 선택하고 모든 artifact를 freeze한다.
14. Frozen 단일 candidate를 untouched Test에서 한 번만 평가한다.
15. Aggregate report와 immutable hashes를 저장하며 embedding/matrix/sample score는 저장하지 않는다.
16. 별도 active contract 승인 전에는 runtime/shadow 추론에 연결하지 않는다.

## 25. 완료 기준

다음 조건을 모두 만족해야 실험을 완료로 판정한다.

- Dataset eligibility와 data safety hard gate 통과
- Cross-split·cross-fold family leakage 0
- Exact finite `float32[N,D]`와 artifact `D` 일치
- 공통 5 folds, 공통 frozen 80 candidates 사용
- Baseline과 tuned CV 결과의 평균·표준편차 기록
- Selected hyperparameters와 median best iteration 기록
- Train OOF provenance가 완전한 calibrator 선택
- Validation unique decision point와 전체·category safety gate 사용
- Owner-selected `C_FN`, calibrator, threshold의 pre-Test freeze
- Test access 1회, frozen candidate 1개
- 필수 overall/class/ranking/calibration/EDL/safety metric 기록
- Artifact, calibrator, dataset, split, fold, code와 environment identity 기록
- Runtime profile/endpoint/policy 변경 0

이 조건을 만족해도 결론은 `VALID_OFFLINE_EVIDENCE`에 한정한다.
