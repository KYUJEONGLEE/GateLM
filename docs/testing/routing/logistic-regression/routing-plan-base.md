# GateLM Difficulty Semantic Model 실험 설계서


| 항목           | 값                                                                                        |
| ------------ | ---------------------------------------------------------------------------------------- |
| 상태           | Dataset 2 기반 42D B1-D2 control + 탐색형 C1 offline 실험 설계; authoritative runtime contract 아님 |
| 적용 범위        | 다음 difficulty-model 개선 주기                                                                |
| 실험 수         | 6개; PCA recipe는 고정하고 P·head C·final LR C·calibrator·threshold를 선택                        |
| 실험 기준 모델     | B1-D2: Dataset 2 기반 42D, L2/liblinear `C=10`, Isotonic, threshold `0.5`                  |
| 제품 런타임 변경 여부 | 없음; offline winner의 runtime 승격은 별도 계약·구현·검증 대상                                           |
| 작성일          | 2026-07-20                                                                               |


이 문서는 새 API, DB, Event, Metrics 또는 RuntimeSnapshot 의미를 정의하지 않는다. 실제 runtime 변경에는 별도 active contract, 책임자 승인, 미사용 holdout과 승인된 배포 관찰 근거가 필요하다.

### B1-D2 실험 baseline 고정값

`difficulty-feature-vector.v1`은 Dataset 1의 이름이 아니라 42D feature의 순서·encoding·scaling 계약이다. B1-D2는 이 42D 계약을 유지하되 Dataset 2만 사용해 새로 학습하는 same-data control이다. 아래 구조와 학습 절차는 run 전에 고정하며, 후속 C1 탐색 결과로 B1-D2를 사후 변경하거나 재선택하지 않는다.


| 항목                              | 고정값                                                                       |
| ------------------------------- | ------------------------------------------------------------------------- |
| 학습·선택·평가 dataset                | Dataset 2: `difficulty_independent_ood_5000_2026_07_20_owner_approved_v1` |
| B1-D2 입력                        | `difficulty-feature-vector.v1` 42D                                        |
| B1-D2 final Logistic Regression | L2/liblinear, `C=10`                                                      |
| Calibrator                      | exact-tie sample-count PAVA Isotonic                                      |
| Threshold                       | `0.5`, `score >= 0.5 → complex`                                           |


B1-D2 LR은 Dataset 2 Train의 model-path record에 fit한다. 고정 Isotonic은 Dataset 2 Validation의 C1과 동일한 family-grouped fold manifest로 OOF score를 만든 뒤 전체 Validation에 한 번 refit하며, threshold `0.5`는 선택하지 않는다. 최종 B1-D2 artifact에는 42D LR·Isotonic·threshold, Dataset 2 version/split hash와 content hash를 동결한다. 이 문서의 탐색 grid와 선택 규칙은 C1에만 적용하며, B1-D2는 paired 성능·안전성 비교를 위한 동결 baseline으로만 사용한다.

현재 Gateway의 Dataset 1 기반 B1 artifact는 `Gateway B1 incumbent`라는 별도 참고값으로만 남긴다. Dataset 1 record·split·학습 결과는 이 run의 입력, model fit, calibration, 후보 선택, threshold 선택, Test 비교 또는 GO/NO-GO 판정에 사용하지 않는다. Incumbent artifact의 기존 published metric은 역사적 맥락과 provisional 검정력 진단에만 표시할 수 있으며, B1-D2 또는 C1과 같은 표의 primary delta로 합치지 않는다.

## 1. 결론과 요청 이해

핵심 실험은 다음 여섯 개다.

1. PCA 차원
2. 4개 semantic head
3. 42D / 42D + P / 42D + P + 12D
4. Logistic Regression
5. Platt / Isotonic calibration
6. 전역 threshold

PCA pipeline은 `raw pooled → PCA(P) → L2`로 고정하고 P만 E1에서 선택한다. E2는 네 semantic head의 C를, E3×E4는 A/B/C feature 후보와 candidate별 final LR C를, E5는 candidate별 Platt/Isotonic을, E6는 선택 candidate의 전역 threshold를 사전 등록된 절차로 선택한다. Train은 B1-D2 fit과 C1 screening/slate 준비, Validation은 B1-D2 Isotonic OOF/refit과 C1 final candidate·calibrator·threshold 선택, Test는 모든 설정이 동결된 B1-D2와 단일 C1의 paired 최종 평가에만 사용한다.

따라서 올바른 답은 다음과 같다.

> Difficulty semantic 하위 pipeline의 핵심 튜닝 질문은 이 여섯 개면 충분하다. 하지만 완전한 실험 프로그램은 아니다. 앞에는 데이터·parser·model-path membership 검증이, 뒤에는 단회 holdout과 offline runtime 검증이 필요하다.

같은 데이터와 같은 fold에서 원인을 분리해 비교하고, holdout을 선택 과정에서 사용하지 않으며, 정확도 개선과 과소 라우팅(under-routing) 안전성을 사전에 정한 기준으로 판정하고, 다른 사람이 동일한 artifact를 재현할 수 있어야 한다. 여기서 최적값은 사전 등록된 후보 grid와 계층적 선택 절차 안에서 선택된 값이며 전체 가능한 값의 전역 최적을 뜻하지 않는다.

## 2. 먼저 고정해야 할 정확도의 의미


| 지표                           | 의미                             | 이 여섯 실험의 역할  |
| ---------------------------- | ------------------------------ | ------------ |
| Difficulty accuracy          | `simple                        | complex` 정답률 |
| Category accuracy            | `general                       | code         |
| Joint routing-label accuracy | category와 difficulty가 모두 맞는 비율 | 제품 보호 기준     |


E1~E6의 hyperparameter 선택은 Train/Validation의 확률 품질과 사전 safety 규칙을 사용한다. Test difficulty accuracy와 paired CI는 동결된 B1-D2 대비 최종 단일 C1의 성능 주장에만 사용한다. Category가 실제 runtime 입력이므로 oracle-category difficulty와 runtime-category difficulty를 함께 진단하되, category classifier 개선을 C1 효과로 해석하지 않는다.

## 3. 현재 근거의 경계

### 3.1 비교 기준 모델

최종 평가는 동일한 model-path record에서 다음 baseline과 새 candidate를 paired 비교한다.


| ID      | 기준 모델                                                    | 용도                         |
| ------- | -------------------------------------------------------- | -------------------------- |
| `B1-D2` | Dataset 2로 학습한 42D LR `C=10` + Isotonic + `0.5` artifact | same-data primary baseline |
| `C1`    | Dataset 2로 학습·선택하고 이번 실험에서 동결한 단일 candidate              | 승격 후보                      |


Primary 비교 대상과 safety 기준은 `B1-D2`다. `Gateway B1 incumbent`는 별도 참고값이며 primary delta, safety constraint와 성공 판정에 관여하지 않는다. 이 offline 실험은 `modelPathOnly: true`, `sentinelExcluded: true`로 고정한다. Authoritative runtime 승격은 sentinel을 포함한 전체 경로의 별도 end-to-end promotion 단계에서 검토한다.

### 3.2 재사용하면 안 되는 근거

과거 run에서 이미 결과를 확인한 evaluation/promotion holdout은 새 P, C, calibrator 또는 threshold를 선택하거나 C1의 최종 우월성을 주장하는 데 재사용하지 않는다. 기존 결과는 과거 회귀 진단과 검정력 계획의 보조 입력으로만 사용하며, 현재 Dataset 2 run manifest와 분리된 prior-evidence ledger에 당시 dataset·split·artifact hash와 접근 기록을 남긴다.

### 3.3 다음 독립 run 데이터

이 quality run에서 허용하는 유일한 dataset은 owner-approved Dataset 2다.


| 항목                                | 고정값                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| Dataset version                   | `difficulty_independent_ood_5000_2026_07_20_owner_approved_v1`                             |
| Policy-finalized manifest         | `docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.policy-finalized.manifest.json` |
| Policy-finalized manifest SHA-256 | `ae2944c6f518c0bd55dee37df8b8db67f1e628a8c5d8b7fbb829ca83201bde17`                         |
| 전체 output SHA-256                 | `60921fca6c26e02fba26e3b770b471c0fb683f96f074bf76561770bae13c6af0`                         |
| Split manifest SHA-256            | `a3a14b2f406bed5e06c048aae276c1b94b5da36d1de11f88b3e629ce74df8693`                         |
| Train SHA-256                     | `bbfd0e20289a0cd84d81fa4a0f2f0609ac25703289bdadb55376c591b9df0ec4`                         |
| Validation SHA-256                | `3bcf3152536cce5e02180db35ef9dd12e8b820e0282841da9a527746857a6d24`                         |
| Test SHA-256                      | `fb645fd615468e6ce3d383871310102bb91bd6d3794da6363110ab6940e42e8d`                         |
| 승인 상태                             | `trainingEligible: true`, `recordLevelHumanReview: true`                                   |


Train 3,000 / 600 families, Validation 1,000 / 200 families, Test 1,000 / 200 families의 family-disjoint split을 그대로 사용한다. B1-D2와 C1은 같은 Dataset 2 role, model-path membership과 fold manifest를 공유한다. Test score execution은 두 artifact와 C1 calibrator·threshold가 동결되기 전까지 차단하고 access ledger로 증명한다. G0에서 family overlap, exact/normalized duplicate와 near-duplicate audit 및 manifest/hash 일치를 다시 검증한다.

Dataset 1 파일과 split은 이 run manifest에 등록하거나 runner 입력으로 전달하지 않는다. 기존 Gateway B1 incumbent는 artifact 식별자와 기존 published aggregate만 참고할 수 있으며, Dataset 1을 다시 읽어 점수를 생성하지 않는다.

현재 candidate JSONL에는 expected label이 포함되어 있으므로 이 계획은 test를 `label-blind`라고 주장하지 않는다. 진정한 label-blind evidence가 필요하면 별도 custodian, ACL과 sealed scoring runner를 먼저 둔다. 최소 요구사항은 model/prediction score를 freeze 전에 test에 실행하지 않는 `score-blind one-shot` 절차다.

## 4. 전체 구조


| 단계      | 이름                                  | 목적                                             | 하이퍼파라미터 선택 여부 |
| ------- | ----------------------------------- | ---------------------------------------------- | ------------- |
| G0      | 데이터/parser/model-path 검증            | 입력과 평가 기준을 동결                                  | 아니오           |
| E1      | PCA 차원                              | Train grouped CV에서 canonical PCA의 P 선택         | 예             |
| E2      | 4개 semantic head                    | 네 head의 공통 regularization C 선택                 | 예             |
| E3 × E4 | Feature ablation × 최종 LR            | A/B/C candidate마다 final LR C를 별도로 선택           | 예, 공동 grid    |
| E5      | Candidate별 calibration과 최종 model 선택 | Validation OOF로 A/B/C·Platt·Isotonic을 함께 비교    | 예             |
| E6      | Threshold                           | B1-D2 safety constraint 안에서 operating point 선택 | 예             |
| G7      | 동결, 최종 test, offline runtime 검증     | 후속 승격 검토 가능성 검증                                | 아니오           |


실행 순서는 다음과 같다.

```text
G0 데이터/parser/model-path membership 동결
  -> Train: B1-D2 42D LR fit
  -> Validation: B1-D2 fixed Isotonic grouped OOF 생성과 full-validation refit
  -> Train: E1 canonical PCA pipeline의 P screening
  -> Train: E2 semantic head C 선택과 nested cross-fitting
  -> Train: E3 x E4 A/B/C candidate × final LR C 공동 screening
  -> Validation: E5 candidate별 Platt/Isotonic grouped OOF
  -> Validation: calibrated log loss/Brier/낮은 차원 순으로 final candidate·calibrator 선택
  -> Validation: E6 선택 candidate의 OOF calibrated score로 threshold 선택
  -> artifact/hash/Python-Go parity 동결
  -> untouched test 1회
  -> offline runtime benchmark
```

### 4.1 계약 및 도구 gate

E1의 variable P와 E3의 가변 feature dimension은 고정된 B1-D2 구조를 변경하지 않는다. 다만 선택된 C1 shape를 runtime artifact 후보로 만들려면 실행 전에 해당 P·dimension·selection provenance를 표현하는 versioned offline schema와 verifier가 필요하다.

다음 중 하나라도 준비되지 않으면 model-quality 탐색은 offline 결과로만 종료하고 runtime 승격 근거로 사용하지 않는다.

- P와 `42 + P` / `54 + P` shape를 표현하는 versioned artifact/schema
- Fold-local PCA, head cross-fitting과 candidate별 LR C를 재현하는 trainer/report
- Candidate별 Platt/Isotonic OOF와 E6 fixed-grid threshold selection export
- 선택 shape를 지원하는 codegen, Go inference와 Python–Go parity 검증

이 문서 자체는 active runtime contract를 바꾸지 않는다. Contract 또는 runtime 지원이 없는 winner는 `offline winner; runtime unsupported`로 기록한다.

## 5. 사전 등록할 성공 기준

결과를 보기 전에 아래 정책을 run manifest에 기록한다. 숫자를 변경하려면 새 run ID와 새 untouched test가 필요하다.

### 5.1 핵심 성능과 안전성


| 유형        | 지표                               | 권장 통과 기준                                                          |
| --------- | -------------------------------- | ----------------------------------------------------------------- |
| 핵심 성능     | Difficulty accuracy              | `C1 - B1-D2 >= +1.0%p`이고 paired family-bootstrap 95% CI 하한이 `> 0` |
| 필수 safety | Complex → simple count/rate      | 전체와 5개 category 각각에서 `C1 <= B1-D2`                                |
| 효율성       | Simple → complex count/rate      | 핵심 accuracy와 threshold tie-break에 반영                              |
| 확률 품질     | Model-path log loss, Brier score | E5 grouped OOF 선택 규칙 충족; final test에서 B1-D2 비악화                   |
| 제품 보호 기준  | Joint routing-label accuracy     | B1-D2 비악화; category accuracy를 함께 보고                               |


`complex → simple` rate의 분모는 실제 complex 표본 수이고, `simple → complex` rate의 분모는 실제 simple 표본 수다. Count와 rate를 둘 다 기록한다. Baseline count가 0인 category는 candidate도 0이어야 한다.

`+1.0%p`는 사전 등록한 권장 최소 실용 개선폭이다. 제품 owner가 다른 MDE를 승인한다면 Test를 열기 전에 바꿀 수 있다. Dataset 2 Validation의 family와 B1-D2/C1 disagreement 구조로 cluster-aware power simulation을 수행하고, 80% power가 나오지 않으면 Test를 열지 않고 현재 run을 종료한다. 그다음 새 run ID·manifest와 별도의 untouched Test family를 준비하며 기존 split에 표본을 덧붙이지 않는다.

### 5.2 통계 규칙

- 모든 final delta는 같은 record의 paired prediction으로 계산한다.
- confidence interval은 `promptFamily` cluster bootstrap 10,000회, 95% interval을 사용한다.
- Bootstrap seed는 `20260722`로 고정한다.
- E1~E6 탐색 결과는 selection evidence이고 final superiority evidence가 아니다.
- Final hypothesis test는 동결된 candidate·calibrator·threshold 조합 하나만 수행한다. 여러 candidate를 Test에 열지 않는다.
- 작은 *category 또는 slice의 interval이 지나치게 넓으면 PASS가 아니라* `insufficient evidence`다.
- Record를 독립 표본으로 가정한 일반 t-test는 사용하지 않는다. Exact McNemar는 보조 지표로만 허용한다.

### 5.3 런타임 비회귀

동일 hardware, build, warm-up과 single-request execution shape에서 B1-D2와 C1을 비교한다.

- p95 model-path latency: B1-D2 대비 `+10%` 이내
- p99 model-path latency: run manifest에 고정한 실제 configured request timeout 미만; current default `100 ms`를 자동 가정하지 않음
- Peak RSS: B1-D2 대비 `+10%` 이내
- Throughput: B1-D2 대비 `-10%` 이내
- Non-finite score와 Python-Go label mismatch: `0`
- Encoder failure, busy, timeout과 rule fallback failure: B1-D2보다 악화되지 않음

환경이나 운영 owner가 더 엄격한 budget을 승인하면 그 값을 run 전에 우선한다.

Latency run은 batch size 1, worker 1, 고정 hardware에서 warm-up 100 requests 뒤 최소 1,000 requests를 측정한다. Busy/timeout/fallback은 별도 stress run으로 concurrency `{1, 4, 8}`, worker 1, waiting queue 4, 각 5분, 동일 actual timeout과 고정 arrival pattern을 사용한다. CPU affinity, thread 수, runtime/library version과 input-length aggregate를 report에 남긴다.

## 6. 공통 데이터와 평가 프로토콜

### 6.1 데이터 분할과 fold

Quality run은 승인된 Dataset 2의 고정 family partition만 사용한다.


| 역할         | 전체 record | Family 수 | 사용 범위                                                                    |
| ---------- | --------- | -------- | ------------------------------------------------------------------------ |
| Train      | 3,000     | 600      | B1-D2 LR fit, PCA/head/LR fit, E1~E4 screening과 A/B/C slate 준비           |
| Validation | 1,000     | 200      | B1-D2 Isotonic OOF/refit, E5 final candidate·calibrator와 E6 threshold 선택 |
| Test       | 1,000     | 200      | B1-D2와 모든 설정을 동결한 단일 C1의 paired final 평가                                 |


위 record 수는 dataset role 전체다. G0에서 동결된 `decisionBoundaryVersion`으로 `modelPath`를 다시 계산하고 role별 model-path 표본 수와 membership hash를 기록한다. E1~E6의 학습·선택·최종 평가는 모두 `modelPath=true` 표본만 사용하며 sentinel 표본은 제외한다. E2 head fit에는 그중 `semanticInputStatus=eligible`이고 네 human-approved bucket target이 모두 유효한 표본만 사용한다.

Run manifest에는 Dataset 2 version/output/split SHA-256, `decisionBoundaryVersion`, `modelPathOnly: true`, `sentinelExcluded: true`, role별 model-path membership hash와 Train/Validation/Test family split hash를 반드시 동결한다. Dataset 1 provenance나 split은 등록하지 않는다.

Train 내부 screening은 다음 grouped CV를 사용한다.

- Screening: 5-fold `StratifiedGroupKFold(shuffle=true, random_state=20260719)`
- Candidate C stacking: 각 screening fold의 train portion 안에서 4-fold `StratifiedGroupKFold(shuffle=true, random_state=20260720 + outerFoldIndex)`
- Validation calibration: 5-fold `StratifiedGroupKFold(shuffle=true, random_state=20260721)`
- Group: `promptFamily`
- Stratification key: `expectedCategory × expectedDifficulty`; language/category cell support는 fold manifest에서 별도 검증
- 모든 candidate는 exact same fold manifest를 사용
- B1-D2 Isotonic OOF도 C1 calibration과 exact same Validation fold manifest를 사용

Train screening fold의 결과는 hyperparameter screening용이며 unbiased final performance claim이나 superiority CI로 사용하지 않는다. E1 PCA dimension, E2 head C와 E4 final LR C의 candidate grid를 모두 사전에 열거하고 같은 screening fold manifest를 사용한다. Screening 뒤 A, selected PCA representation을 쓴 B, 같은 representation과 selected heads를 쓴 C를 full train에 refit해 candidate slate로 만든다.

Final base candidate는 Train 결과만으로 고르지 않는다. Validation에서 A/B/C 각각에 Platt와 Isotonic grouped OOF calibration을 수행하고, 후보별 최적 calibrator를 정한 뒤 `calibrated OOF log loss → Brier → lower dimension` 순서로 base candidate와 calibrator를 함께 선택한다. E6은 그 selected pair의 같은 Validation OOF calibrated score만 사용한다. Test는 이 모든 선택에서 제외한다.

각 fold assignment, record ordering, sklearn/NumPy/BLAS/ONNX Runtime lock과 manifest SHA-256을 artifact provenance에 고정한다. Model seed는 semantic heads `20260714`, final LR `1729`, Platt `1729`로 고정한다.

### 6.2 누출 방지

- PCA mean/components는 매 screening fold의 train portion에서만 fit한다.
- Semantic heads도 매 screening fold의 train portion에서만 fit한다.
- Candidate C에서 screening-fold train의 LR 입력 12D는 그 안의 4-fold stacking으로 만든 OOF head probability다. Screening-fold validation 12D는 screening-fold train 전체에 fit한 head로 한 번 예측한다.
- Full-train Candidate C refit에서도 LR train 12D는 5-fold cross-fit으로 만들고, validation/test 12D는 full train에 fit한 head만 사용한다.
- 같은 family의 simple/complex contrast, paraphrase, synonym, 한국어/영어 변형과 payload 변형을 다른 fold나 split에 넣지 않는다.
- Runtime과 동일하게 실제 rule category 결과로 42D와 category-specific feature를 만든다. `expectedCategory`는 oracle diagnostic에만 사용한다.
- Empty/meaningless와 hard-complex sentinel은 LR, calibrator, threshold와 최종 accuracy/FN/FP 평가에서 모두 제외한다.
- Encoder output, PCA feature, head probability와 final feature vector는 process-local memory에만 둔다.

### 6.3 G0 데이터/parser/model-path 검증

E1 전에 다음을 통과해야 한다.


| 검사                                    | 필수 결과                                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Schema, label, review 적격성             | 모든 사용 record/family가 approved 상태                                                                                               |
| Split 간 family 중복                     | 0                                                                                                                              |
| Split 간 exact/normalized duplicate    | 0                                                                                                                              |
| Near-duplicate 감사                     | 상위 pair 수동 검토; 누출 0                                                                                                            |
| Category × difficulty × language 표본 수 | 모든 필수 cell이 각 role에 존재                                                                                                         |
| Decision-boundary 배정                  | `decisionBoundaryVersion`, `modelPathOnly: true`, `sentinelExcluded: true`, role별 model-path record·family와 membership hash 동결 |
| 지원되는 명시적 경계 exact match               | Human-approved boundary label 대비 100%                                                                                          |
| 모호하거나 미지원인 입력의 강제 분리 방지               | Human-approved label 대비 100%                                                                                                   |
| Payload contamination                 | 지원되는 boundary에서 0; payload detection precision/recall과 분모 보고                                                                   |
| Model-path coverage                   | Role/category/difficulty별 count/rate 보고; minimum support policy 충족                                                             |


이 단계는 ground-truth validation과 exact model-path membership freeze gate다. Parser, 42D vectorizer 또는 decision boundary를 바꾸면 모든 embedding, PCA, head, classifier, calibration과 threshold evidence를 새 version으로 다시 생성한다.

## 7. 공통으로 고정할 encoder와 런타임 설정

아래 값은 E1~E6의 hyperparameter가 아니다.


| 구성요소          | 동결 설정                                                            |
| ------------- | ---------------------------------------------------------------- |
| Encoder       | `intfloat/multilingual-e5-small`                                 |
| 소스 revision   | `614241f622f53c4eeff9890bdc4f31cfecc418b3`                       |
| Runtime       | Dynamic QInt8 ONNX, CPU                                          |
| 입력            | `instructionText`만 사용, `query:` prefix                           |
| Tokenization  | special token 포함, `max_length=128`, 오른쪽 truncation, batch size 1 |
| Pooling       | attention-mask mean pooling, float32 `[384]`                     |
| 빈 instruction | Encoder를 호출하지 않고 `not_applicable`                                |
| PCA solver    | `full`                                                           |
| PCA whitening | `false`                                                          |
| PCA pipeline  | `raw pooled → PCA(P, no whiten) → L2`, epsilon `1e-12`           |
| 42D 입력        | `difficulty-feature-vector.v1`의 정확한 이름/순서/scaling                |
| Category 입력   | 실제 runtime rule category                                         |
| Score 결정      | `score >= threshold`이면 complex                                   |
| 실패 동작         | 해당 request에서 rule difficulty fallback                            |


Encoder fine-tuning, 다른 encoder, max token length, quantization 방식과 pooling 변경은 이번 여섯 실험에서 제외한다. 동시에 바꾸면 PCA/feature 효과를 분리할 수 없다.

이하 E1~E6 절에서 `B1` 또는 `incumbent`라는 표기는 모두 실험 baseline `B1-D2`를 뜻하며, 별도 참고값인 `Gateway B1 incumbent`를 뜻하지 않는다.

## 8. E1 — PCA 차원

Train의 5-fold `StratifiedGroupKFold`에서 PCA 차원을 결정한다. PCA pipeline은 current canonical로 고정하며 다른 전처리 순서는 비교하지 않는다.

### 가설

384D E5 embedding을 너무 작게 줄이면 semantic signal을 잃고, 너무 크게 유지하면 작은 데이터에서 LR variance와 런타임 비용만 늘어난다. 최저 비용으로 동등하거나 더 좋은 downstream generalization을 내는 차원이 존재한다.

### 조정값

```text
P = {16, 32, 64, 96, 128}
```

현재 canonical `64`를 반드시 control로 포함한다. 각 P마다 PCA는 screening-fold train에서 새로 fit한다.

### 고정값

- Canonical pipeline `raw pooled → PCA(P) → L2`; projection recipe는 비교하지 않음
- `svd_solver=full`, `whiten=false`
- Candidate B `42D + P`를 probe path로 사용
- Probe LR은 current incumbent와 동일한 L2/liblinear `C=10`, `fit_intercept=true`, `class_weight=None`, `max_iter=2000`, `tol=1e-4`, `random_state=1729`로 고정해 PCA 차원만 분리
- `StratifiedGroupKFold(n_splits=5, shuffle=true, random_state=20260719)`와 동일 fold manifest 사용
- Final LR의 C는 E4에서 A/B/C candidate별로 다시 선택
- P candidate grid와 comparison order는 fold 결과 전에 동결

### 필수 측정값

- 주요 지표: Train grouped-OOF binary log loss
- 보조 지표: Brier score
- Fold mean과 standard error
- Explained variance ratio: diagnostic only
- PCA artifact bytes와 PCA-transform-only p95 latency: 보호 기준
- PCA output non-finite/near-zero norm count: 보호 기준, 허용값 0

### 선택 규칙

Train의 5-fold `StratifiedGroupKFold` screening에서는 one-standard-error rule을 사용한다. 최저 mean log loss 후보의 `mean + 1 SE` 안에 들어오는 후보 중 가장 작은 P를 고른다. Brier와 explained variance는 진단값으로만 보고 P 선택 순서를 바꾸지 않는다. 이 결과는 B/C slate의 representation을 정할 뿐 final model-quality CI가 아니다. Final A/B/C 선택은 E5의 independent Validation calibrated OOF 결과로 한다. Explained variance만으로 P를 고르지 않는다.

## 9. E2 — 4개 semantic head

### 가설

Human-approved task, constraint, scope, dependency bucket을 selected PCA representation에서 예측한 확률 12D가 PCA feature만으로는 드러나지 않는 구조적 의미를 보완한다.

Rule extractor count를 head 정답으로 사용하지 않는다. 그러면 rule 오류를 그대로 복제하는 circular target이 된다. `semanticInputStatus=eligible`인 human-approved bucket label만 사용한다.

### Head 계약


| Head       | 클래스 순서                                    |
| ---------- | ----------------------------------------- |
| Task       | `count_1`, `count_2`, `count_3_plus`      |
| Constraint | `count_0_to_1`, `count_2`, `count_3_plus` |
| Scope      | `count_1`, `count_2_to_3`, `count_4_plus` |
| Dependency | `depth_0_to_1`, `depth_2`, `depth_3_plus` |


각 head는 별도의 3-class multinomial Logistic Regression이고 네 확률 벡터를 고정 순서로 이어 12D를 만든다.

### 조정값

```text
penalty = L2
solver = lbfgs
C_head = {0.01, 0.03, 0.1, 0.3, 1, 3, 10}
max_iter = 2000
tol = 1e-4
class_weight = None
random_state = 20260714
```

### 필수 측정값

- 주요 지표: 네 head multiclass log loss의 동일가중 평균
- Head별 macro-F1
- Head별 multiclass Brier score와 10-bin ECE
- Head별 가장 높은 complexity class recall
- 4-head joint exact-match accuracy
- Korean/English/mixed-language와 required slice aggregate
- Probability가 유한하고 `[0,1]` 범위인지, 각 head 확률 합이 `1.0`인지와 구현 간 parity
- Fold별 class support, convergence warning과 `n_iter`
- 최종 유용성: E3에서 Candidate B 대비 Candidate C의 paired delta

### 선택과 중단

- 최저 평균 log loss 후보의 `mean + 1 SE` 이내에 있는 후보 중 `평균 macro-F1 >= 최저 log-loss 후보의 평균 macro-F1 - 1e-6`을 만족하는 가장 작은 C를 선택한다.
- 한 fold라도 `ConvergenceWarning`이면 해당 C는 invalid다.
- Head 자체 지표와 E3의 B→C 증분은 Train 선별 진단으로만 보고하며 Candidate C를 Train 결과만으로 제외하지 않는다. Head 포함 여부는 E5 Validation 선택에서 결정한다.
- LR에 들어가는 train 12D는 반드시 family cross-fitting으로 생성한다.

## 10. E3 — 42D / 42D + P / 42D + P + 12D

### 가설

- A → B는 selected PCA representation의 순증분을 측정한다.
- B → C는 semantic head probability의 순증분을 측정한다.

### 후보


| 후보  | 입력                                                       | 차원       |
| --- | -------------------------------------------------------- | -------- |
| A   | Rule vector                                              | 42       |
| B   | Rule vector + 선택된 PCA representation                     | `42 + P` |
| C   | Rule vector + 선택된 PCA representation + cross-fitted head | `54 + P` |


### 공정 비교 규칙

- Candidate마다 E4의 C를 별도로 다시 고른다.
- 동일 Train screening family folds를 사용한다.
- PCA와 heads는 screening-fold train에서만 fit한다.
- Candidate C의 screening-fold train 12D는 내부 cross-fit, screening-fold validation 12D는 screening-fold train 전체에 fit한 heads로 만든다.
- Train은 A/B/C slate를 준비하고, final winner는 E5의 candidate별 Validation OOF calibration 뒤에만 고른다.

### 필수 측정값과 선택

- Train screening: grouped-OOF raw log loss와 Brier
- 최종 선택: E5 candidate별 Validation OOF calibrated log loss
- 보조 지표: Brier score
- A→B, B→C paired delta는 Train에서 screening diagnostic으로만 보고
- 진단 지표: threshold를 튜닝하지 않은 raw ranking의 AUROC와 average precision 중 하나를 사전 선택해 보고한다.
- Validation 동률 처리: calibrated Brier, 그다음 더 낮은 dimension

Train metric으로 candidate를 최종 탈락시키지 않고 pre-registered A/B/C slate를 모두 Validation에 전달한다. E5에서 후보별 calibrator를 공정하게 선택한 뒤 calibrated OOF log loss가 가장 낮은 candidate를 고른다. 차이 `<= 1e-6`이면 Brier, 그래도 동률이면 lower dimension을 선택한다. Superiority CI는 untouched Test의 동결 candidate 하나에만 사용한다.

## 11. E4 — 최종 Logistic Regression

E3와 E4는 `feature candidate × C` 공동 grid다.

### 조정값

```text
model = binary Logistic Regression
penalty = L2
solver = liblinear
C = {0.01, 0.03, 0.1, 0.3, 1, 3, 10}
fit_intercept = true
class_weight = None
max_iter = 2000
tol = 1e-4
random_state = 1729
```

### 필수 측정값

- Train screening fold log loss와 Brier score
- Candidate와 C별 `n_iter`
- `ConvergenceWarning` 발생 fold 수
- Final full-train refit convergence
- Coefficient finite 여부와 exact expected dimension

### 선택과 실패 규칙

1. Mean log loss가 가장 낮은 C
2. 차이 `<= 1e-6`이면 Brier score가 낮은 C
3. Brier도 동률이면 더 작은 C

한 fold라도 미수렴하면 해당 C 전체를 invalid 처리한다. 모든 C가 invalid이거나 선택 C의 full-train refit이 미수렴하면 artifact를 만들지 않고 run을 실패시킨다. `max_iter`는 run 도중 자동으로 올리지 않는다.

## 12. E5 — Platt vs Isotonic calibration

### 가설

Train에서 준비한 A/B/C 각각의 raw probability를 candidate별 global calibrator로 보정하면 공정한 probability-quality 비교가 가능하다. Category별 calibrator는 validation support가 작고 정책이 복잡해지므로 이번 run에서 제외한다.

### 후보


| 후보       | 고정 설정                                                                                         |
| -------- | --------------------------------------------------------------------------------------------- |
| Platt    | `raw_probability` 입력, L2/lbfgs, `C=1,000,000`, max_iter 2,000, random_state 1729              |
| Isotonic | Exact-tie sample-count PAVA, inclusive-lower floor lookup, 범위 밖은 양끝 y로 clip, interpolation 없음 |


Isotonic은 동일한 score를 먼저 집계하고, sample-count로 block을 가중하며, constant single block을 허용한다. `x` 범위 밖의 score는 active contract대로 첫/마지막 `y`에 endpoint clip한다. 금지하는 것은 임의의 `0.01~0.99` probability clipping, post-hoc minimum-block merge, score rounding, smoothing과 linear interpolation이다.

### 절차

- Validation의 200 families에 candidate 공통 5-fold grouped CV를 고정한다.
- A/B/C 각각에 대해 각 fold train에서 Platt와 Isotonic을 fit하고 fold validation에 OOF calibrated score를 만든다.
- Train에 fit한 base classifier/PCA/heads는 어떤 Validation fold에서도 다시 학습하지 않는다.
- 각 base candidate 안에서 `log loss → Brier → Platt`로 calibrator를 고른다.
- 그다음 candidate별 selected calibrator OOF 결과를 `log loss → Brier → lower dimension`으로 비교해 final base candidate와 calibrator를 함께 선택한다.
- Selected candidate/calibrator만 Validation 전체에 calibrator를 refit한다.

### 필수 측정값과 선택

- 주요 지표: candidate × calibrator mean OOF binary log loss
- 보조 지표: Brier score와 lower dimension
- 진단 지표: 10-bin ECE/reliability table
- Isotonic diagnostic: fold별 block count, minimum block support, 0/1 extreme-output rate
- Calibrator 동률 처리: log loss 차이 `<= 1e-6`이면 Brier, 그래도 동률이면 Platt
- Base candidate 동률 처리: log loss 차이 `<= 1e-6`이면 Brier, 그래도 동률이면 lower dimension
- Platt 미수렴 또는 PAVA invalid이면 해당 candidate만 실패; 둘 다 실패하면 run 실패

이 데이터가 category/difficulty 균형을 위해 구성된 synthetic/redacted benchmark라면 calibrated score는 그 benchmark 모집단에서의 확률이다. 실제 production traffic의 `P(complex | x)`라고 주장하지 않는다. Production 확률 의미는 별도 승인된 label-audited production observation에서 검증한다.

## 13. E6 — 전역 threshold

### 가설

Under-routing safety를 보존하면서 incumbent보다 높은 difficulty accuracy를 내는 global operating point가 존재한다.

### 후보 그리드

```text
t = {0.000, 0.001, 0.002, ..., 0.999, 1.000}
decision = complex if calibrated_score >= t
```

Grid는 score를 보기 전에 고정한다. Sample의 unique score나 midpoint를 사후 추가하지 않는다.

### 점수 출처

E5에서 생성한 selected calibrator의 validation family-grouped OOF calibrated score만 사용한다. Validation 전체에 fit한 calibrator의 in-sample score로 threshold를 고르지 않는다.

### 기본 선택 목적

사업상 `C_FN:C_FP`가 아직 승인되지 않았으므로 기본 목적은 constrained accuracy다.

1. B1 대비 전체 `complex → simple` 비악화
2. B1 대비 5개 category 각각 `complex → simple` 비악화
3. 위 후보 중 difficulty accuracy 최대
4. 동률이면 `simple → complex`가 적은 threshold
5. 그래도 동률이면 더 낮은 threshold

Safe threshold가 하나도 없으면 run은 NO-GO다.

Expected Decision Loss는 `C_FP=1`, `C_FN={1,3,5,10}` 민감도 분석으로만 보고한다. Product owner가 실제 cost ratio를 사전 승인한 경우에만 EDL을 primary objective로 바꾸며, safety constraint는 그대로 유지한다. 균형 benchmark의 calibrated score에 이론적 Bayes threshold를 그대로 적용하지 않는다.

### 필수 측정값

- Threshold별 difficulty accuracy, FN count/rate, FP count/rate
- 전체와 category별 safety pass 여부
- 선택된 threshold와 인접 grid point
- Family-cluster bootstrap 10,000회의 selected-threshold 분포와 선택 안정성
- Cost scenario별 safety-constrained EDL optimum과 break-even FP/FN ratio

## 14. 최종적으로 꼭 측정할 값

불필요한 부수 지표를 늘리지 않고 다음을 core report에 남긴다.


| 영역       | 필수 값                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| 핵심 성능    | Difficulty accuracy와 B1 대비 paired delta/95% CI                                       |
| Safety   | Complex → simple count/rate, 전체와 category별                                           |
| 효율성      | Simple → complex count/rate                                                          |
| 확률 품질    | Model-path log loss, Brier score                                                     |
| 선택 결과    | P, head C, A/B/C별 final LR C, candidate별 calibrator, final candidate와 threshold      |
| Pipeline | Model-path coverage, role별 membership hash, convergence와 leakage gate                |
| 상위 단계    | Category accuracy, oracle-category difficulty accuracy, joint routing-label accuracy |
| Runtime  | p50/p95/p99 latency, throughput, cold load, peak RSS, failure/fallback rate          |


Required slice는 다음 열한 개만 유지한다.

- 의미: `negation`, `indirect_expression`, `synonym`, `short_complex`, `long_simple`
- 경계: `payload_contamination`
- 언어: `korean`, `english`, `mixed_language`
- 강건성: `category_confusion`, `ood_terminology`

각 slice는 total/simple/complex support와 accuracy, FN count를 기록한다. 작은 support는 성능 개선으로 해석하지 않고 `insufficient evidence`로 표시한다.

## 15. 상세 실행 단계

### 도구 준비 상태

기존 combined runner는 PCA, heads, feature candidates, calibrator, threshold와 report 생성의 기반으로 사용할 수 있다. 다만 quality run 전에 E1~E4 model selection, E5 calibration selection과 E6 operating-point selection이 서로 분리되고, Test가 어느 선택에도 사용되지 않는지 확인한다.

Runner가 아래를 지원하지 않으면 별도 구현 작업으로 먼저 보완한다.

- Canonical pipeline을 고정한 fold-local P grid
- 12D semantic-head cross-fitting
- `feature candidate × C` grouped screening과 nested head stacking
- Calibrator grouped OOF prediction export를 process-local로 E6에 전달
- Score-derived threshold 후보를 추가하지 않는 fixed-grid selector
- B1/C1 paired family-bootstrap report
- Holdout access를 freeze manifest와 단일 candidate hash로 차단
- P를 표현할 새 versioned offline feature-shape/PCA artifact schema와 verifier
- Variable dimension을 지원하는 Python trainer/report와, 승격 후보일 경우에만 generalized codegen/Go inference/parity test

Tooling smoke는 pending/synthetic data로 실행할 수 있지만 quality metric으로 보고하지 않는다.

선택된 P 또는 feature dimension을 현재 runtime artifact가 표현하지 못하면 Step 11 이후 runtime 검증을 진행하지 않고 `offline winner; runtime unsupported`로 기록한다. Schema·verifier·codegen·runtime 지원을 별도 변경으로 완료한 뒤 새 run ID에서 parity와 runtime evidence를 만든다.

### 1단계. 실행 사전 등록

다음을 하나의 immutable run manifest에 기록한다.

- E1~E6의 후보 grid, primary metric, selection hierarchy, 허용 오차와 tie-break
- Final MDE, B1 safety gate와 threshold tie-break
- Dataset version/output/split, fold/label/parser/vectorizer version과 hash
- `decisionBoundaryVersion`, `modelPathOnly: true`, `sentinelExcluded: true`, role별 model-path membership hash
- Encoder/tokenizer/ONNX revision과 hash
- E1~E6 candidate grid
- CV/Bootstrap seed
- Runtime budget
- Test 접근 owner와 허용 시점

완료 조건: 결과를 보지 않고 다른 사람이 동일 후보 공간을 재구성할 수 있다.

### 2단계. 데이터 승인 및 누출 감사

Dataset manifest의 schema, `trainingEligible: true`, `recordLevelHumanReview: true`, owner approval, family coverage, split overlap와 duplicate audit를 실행하고 고정 SHA-256을 대조한다.

완료 조건: G0의 데이터 gate가 모두 PASS다.

### 3단계. 검정력 감사

B1의 Validation error 구조, 사전 MDE `+1.0%p`와 보수적으로 사전 등록한 disagreement 범위를 이용해 provisional cluster-aware power simulation을 수행한다. 이 단계에는 아직 존재하지 않는 C1 prediction을 사용하지 않는다.

완료 조건: planned Test가 명백히 부족하지 않다. Final power check는 C1과 threshold를 freeze한 뒤 Validation paired prediction으로 다시 수행한다.

### 4단계. Parser와 model-path membership 검증

Explicit boundary, ambiguous boundary, payload-only와 payload-contamination slice를 평가한다. 동결된 decision boundary로 role별 model-path membership을 확정한다.

완료 조건: G0 parser/model-path gate PASS. 변경 시 이후 artifact를 전부 새로 만든다.

### 5단계. 단일 요청 embedding 생성

Role별 `modelPath=true`이며 semantic input이 필요한 sample에만 pinned tokenizer/QInt8 encoder를 batch size 1로 실행한다. Raw pooled embedding은 process-local memory에서만 유지하고 여러 sample matrix는 단건 결과를 계산한 뒤 stack한다.

완료 조건: invalid/non-finite embedding 0, artifact revision/hash 일치.

### 6단계. E1 PCA 차원 Train screening

Canonical `raw pooled → PCA(P) → L2` pipeline을 고정한다. Train의 5-fold `StratifiedGroupKFold`에서 각 P의 PCA를 fold-train에만 fit하고 `P={16,32,64,96,128}`을 비교한다. Candidate B probe와 L2/liblinear `C=10`을 고정해 P의 효과만 분리하고 E1의 one-standard-error rule로 P를 선택한다.

완료 조건: selected P, fold mean/SE, one-standard-error 선택 근거와 PCA 보호 기준이 aggregate screening report에 존재한다. Final superiority 주장에는 사용하지 않는다.

### 7단계. E2 head 학습 및 cross-fitting

Selected PCA representation에서 네 head의 `C_head={0.01,0.03,0.1,0.3,1,3,10}`을 비교하고 E2 규칙으로 공통 C를 선택한다. 각 screening fold의 LR train용 12D는 그 fold train 내부의 4-fold cross-fitting으로 생성하고, fold validation은 fold train 전체에 fit한 heads로 예측한다. Full-train LR용 12D도 별도 5-fold cross-fitting으로 만들고 inference용 heads는 full train에 refit한다.

완료 조건: selected head C와 근거, head convergence, class support와 OOF 12D leakage audit PASS.

### 8단계. E3 × E4 candidate slate 준비

A/B/C마다 final Logistic Regression `C={0.01,0.03,0.1,0.3,1,3,10}`을 동일 Train fold에서 별도로 비교하고 E4 규칙으로 candidate별 C를 선택한다. 선택 C로 각 후보를 full Train에 refit한다. Train OOF 결과는 screening diagnostic이며 A/B/C 모두 Validation으로 전달한다.

완료 조건: candidate별 selected C와 선택 근거, converged A/B/C base classifier slate와 candidate별 immutable hash.

### 9단계. E5 최종 candidate와 calibration

A/B/C 각각의 Validation raw probability에 grouped OOF Platt와 Isotonic을 적용한다. Candidate 내부에서 `log loss → Brier → Platt`로 calibrator를 고른 뒤, candidate별 selected calibrator 결과를 `log loss → Brier → lower dimension`으로 비교해 final base candidate와 calibrator를 함께 선택한다. 선택된 calibrator만 Validation 전체에 refit한다.

완료 조건: selected base candidate/calibrator와 후보 전체 OOF log loss/Brier, Platt convergence와 Isotonic diagnostics가 존재한다.

### 10단계. E6 threshold 선택

Selected calibrator의 OOF calibrated score에서 사전 grid `0.000~1.000`, step `0.001`을 평가한다. 같은 Validation fold에서 만든 B1 Isotonic OOF prediction을 기준으로 overall/category safety를 먼저 적용하고, E6의 accuracy·simple→complex·낮은 threshold 순서로 safe threshold 하나를 선택한다.

완료 조건: safe selected threshold 하나, 인접 grid 결과와 bootstrap 선택 안정성 report가 존재한다. Safe threshold가 없으면 NO-GO다.

### 11단계. Artifact 동결 및 parity 검증

Tokenizer, encoder, PCA, heads, final LR, calibrator, threshold, parser, decision boundary와 combined content hash를 동결한다. Python canonical inference와 Go runtime의 PCA transform, label과 score tolerance parity를 검증한다.

먼저 Validation의 B1/C1 paired OOF prediction으로 MDE, 95% CI와 80% power의 final simulation을 수행한다. Planned Test가 부족하면 Test score를 열지 말고 run을 `insufficient planned evidence`로 종료한 뒤 새 untouched dataset/split을 준비한다. 기존 fixed Test에 결과를 본 뒤 record를 덧붙이지 않는다.

완료 조건: power sufficient, non-finite 0, label mismatch 0, approved numeric tolerance PASS. Expanded shape의 Go/runtime 구현이 아직 없으면 offline artifact freeze까지만 하고 deployment evidence를 중단한다. 이 시점 뒤 설정 변경 금지.

### 12단계. 미사용 Test 1회 실행

동결된 Test model-path membership을 B1과 C1에 한 번만 실행한다. Candidate를 추가하거나 test에서 threshold를 다시 선택하지 않는다.

완료 조건: paired bootstrap report와 holdout consumed ledger가 생성된다.

### 13단계. 오류 및 slice 감사

Overall, category, oracle-category, model-path와 required slice aggregate를 계산한다. Raw prompt, per-sample score와 feature contribution은 저장하지 않는다.

완료 조건: 모든 hard gate가 PASS이거나 실패 사유가 명확한 NO-GO다.

### 14단계. Runtime benchmark 및 실패 격리

동일 target hardware에서 B1/C1을 warm-up 후 비교한다. Busy, timeout, invalid embedding, inference failure와 panic recovery가 request-local rule fallback으로 끝나는지 검증한다.

완료 조건: runtime non-regression과 rollback test PASS.

### 15단계. 배포 관찰 contract 검증

현재 optional authoritative E5 encoder runtime은 이 문서의 실험 E5와는 다른 기존 런타임 명칭이다. 이 계획은 B1과 C1의 offline 비교만 정의하며, 제품 Metrics/diagnostics에 score 또는 score distribution을 추가하거나 두 모델을 동시에 live 평가하도록 허용하지 않는다.

Offline gate 뒤에는 다음 중 승인된 경로 하나만 사용한다.

1. Approved redacted/label-audited offline replay에서 B1/C1 disagreement, latency와 fallback을 aggregate 비교한다.
2. B1↔C1 dual evaluation이 꼭 필요하면 새 artifact 승격과 observer/metrics/security contract 및 구현을 먼저 승인한다. 이 경우에도 허용된 aggregate status/category/comparison/duration만 기록하고 score distribution은 기록하지 않는다.
3. Runtime canary가 필요하면 실제 routing 변경·rollback을 포함하는 별도 promotion/canary contract를 승인한다.

Balanced benchmark와 production prevalence가 다르므로 production calibration 주장은 별도 label-audited evidence가 필요하다. 기존 Test는 그 재튜닝에 사용하지 않는다.

완료 조건: current contract 안의 offline evidence로 종료하거나, 별도 승인된 observation/deployment contract와 owner gate를 통과한다.

## 16. 절대 NO-GO 조건

다음 중 하나라도 발생하면 결과가 좋아 보여도 승격하지 않는다.

- Human approval 또는 training eligibility가 없는 데이터 사용
- Candidate shape/selection provenance를 표현하는 versioned schema/verifier 없이 runtime·promotion evidence로 해석
- Cross-split family/duplicate leakage
- PCA, head 또는 12D stacking leakage
- Selection 전 test score access
- 모든 후보가 invalid이거나 selected head/final LR가 미수렴하거나 selected calibrator가 invalid
- Non-finite/out-of-range score 또는 artifact shape/hash mismatch
- Python-Go label mismatch
- Selected shape의 runtime/codegen 지원이 없는데 deployment evidence로 해석
- B1 대비 overall 또는 category별 complex → simple 악화
- 사전 MDE/CI 기준 미충족
- Runtime latency/memory/fallback budget 실패
- Holdout 결과를 보고 candidate, calibrator 또는 threshold 변경

마지막 경우에는 기존 holdout을 consumed로 표시하고 새 artifact version과 새 untouched holdout으로 처음부터 평가한다.

## 17. 이번 핵심 run에서 제외하는 항목

다음은 중요하지 않아서가 아니라 factor isolation과 계약 범위를 지키기 위해 별도 실험으로 둔다.

- Encoder fine-tuning 또는 다른 embedding model
- Token length, query prefix, pooling, quantization sweep
- Per-category classifier 또는 calibrator
- Isotonic min-block merge, 임의 probability clipping, smoothing
- Sentinel combined threshold 변경
- Category classifier 학습
- Provider/model 가격과 business cost의 자동 추정
- 실제 production prevalence 기반 calibration

Joint routing accuracy가 목표라면 category classifier 개선을 별도 workstream으로 가장 먼저 설계한다. 현재 evidence에서는 difficulty보다 category가 훨씬 큰 error source다.

## 18. 리포트 작성

실제 결과는 -를 복사해 작성한다. 리포트는 최소한 다음 순서를 유지한다.

1. 의사결정 요약과 GO/NO-GO
2. Dataset/split/artifact 출처 추적 정보와 hash
3. 누출 감사
4. G0와 E1~E6 결과
5. Artifact 동결과 holdout 접근 기록
6. 최종 paired 결과와 category/slice 안전성
7. Runtime/fallback 결과
8. 한계, 소비된 holdout와 다음 조치

Report, fixture, API, DB, Event, Metrics와 structured log에는 raw prompt/response, normalized string, prompt fragment, token/token ID, attention mask, hidden state, embedding, vector, raw logit, raw probability, per-sample calibrated score, coefficient contribution, secret와 provider raw error를 기록하지 않는다. Safe aggregate count, metric, version/hash와 허용된 sample ID만 사용한다.

## 19. 완료 체크리스트

- [ ] 정확도의 의미와 primary target이 고정됐다.
- [ ] Dataset version/output/split hash, human approval과 training eligibility가 고정됐다.
- [ ] B1이 Train에서 fit되고 Validation에서 Isotonic OOF/refit된 뒤 고정됐다.
- [ ] Family/duplicate leakage가 0이다.
- [ ] Parser, vectorizer, decision boundary와 model-path membership이 동결됐다.
- [ ] E1은 canonical PCA pipeline을 고정하고 Train 5-fold grouped CV에서 P만 선택했다.
- [ ] E2는 사전 grid와 one-standard-error/macro-F1 규칙으로 head C를 선택했다.
- [ ] E3×E4가 공동 grid/동일 fold로 실행됐다.
- [ ] A/B/C마다 final LR C를 별도로 선택하고 full Train refit 수렴을 확인했다.
- [ ] PCA/head fit과 12D stacking이 cross-fitted다.
- [ ] E5에서 A/B/C 각각의 Platt/Isotonic을 grouped OOF로 비교했다.
- [ ] E6 threshold가 selected calibrator의 Validation OOF score와 사전 grid만 사용했다.
- [ ] Artifact/hash/parity 뒤 test candidate가 정확히 하나다.
- [ ] Final test가 한 번만 열렸다.
- [ ] Accuracy MDE/CI와 overall/category FN gate를 통과했다.
- [ ] Runtime/fallback/rollback gate를 통과했다.
- [ ] Holdout 소비와 다음 action이 기록됐다.