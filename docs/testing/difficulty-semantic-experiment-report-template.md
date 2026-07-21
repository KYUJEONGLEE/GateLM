# GateLM Difficulty Semantic Experiment Report Template

> [!NOTE]
> 이 문서는 GateLM difficulty semantic classifier의 offline 실험 결과를 기록하기 위한 복사·작성용 템플릿이다. `<작성>` 또는 `TBD`를 실제 값으로 교체하고, 사용하지 않는 선택 항목은 삭제하지 말고 `N/A`와 사유를 적는다.

> [!CAUTION]
> 이 리포트에는 **raw prompt, raw response, raw detected value, raw prompt fragment, 정규화 문자열, token/token ID, embedding, encoded feature vector, raw logit, 미보정 probability, per-sample score, feature별 coefficient contribution, API Key, App Token, Provider Key, Authorization header, provider raw error body 또는 실제 secret를 기록하지 않는다.** 실패 분석은 안전한 `sampleId`, 허용된 redacted 문맥과 aggregate count만 사용한다.



## 1. Decision Summary


| 항목                        | 값                                                                   |
| ------------------------- | ------------------------------------------------------------------- |
| Experiment run ID         | `<작성>`                                                              |
| Experiment set            | `6 experiments; Projection recipe fixed, not tuned`                 |
| 실행일 / 기준 시각대              | `<YYYY-MM-DD / timezone>`                                           |
| 평가 commit                 | `<commit SHA>`                                                      |
| Rule baseline (`B0`)      | `<현재 deterministic rule classifier policy version>`                 |
| Incumbent baseline (`B1`) | `<현재 authoritative 106D artifact/version/hash>`                     |
| 선택 candidate              | `<42D / 42D+P / 42D+P+12D>`                                         |
| 선택 calibrator             | `<Platt / Isotonic>`                                                |
| 선택 global threshold       | `<0.000~1.000>`                                                     |
| 최종 판단                     | `<GO / NO-GO>`                                                      |
| 판단 범위                     | `<offline 통과 / deployment observation contract 준비 / runtime 승격 검토>` |
| 실패 또는 보류 gate             | `<없음 또는 gate 목록>`                                                   |
| 다음 조치                     | `<작성>`                                                              |




### 1.1 한 문단 결론

`<baseline 대비 무엇이 얼마나 개선 또는 악화됐고, safety gate와 runtime guardrail을 통과했는지, 다음 단계가 무엇인지 3~5문장으로 작성>`

### 1.2 핵심 근거

- Accuracy: `B1 <값>` → `C1 <값>`; paired delta `<값>`; family-cluster bootstrap 95% CI `<하한, 상한>`
- Complex → simple: `B0 <값> / B1 <값> / C1 <값>`; stricter-baseline overall gate `<PASS/FAIL>`
- Category별 complex → simple 비악화: `<PASS/FAIL>`
- Calibration: log loss `<값>`, Brier score `<값>`, 선택 근거 `<작성>`
- Runtime: p95 `<값과 단위>`, encoder/runtime failure rate `<값>`; guardrail `<PASS/FAIL>`



## 2. Experiment Scope And Pre-Registered Decision Rules



### 2.1 목표와 가설


| 항목                 | 사전 정의                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| 제품 목표              | `동일한 safety constraint 안에서 current 106D incumbent와 rule baseline보다 difficulty accuracy를 개선한다.` |
| Primary metric     | `<overall accuracy 또는 사전 승인된 expected decision loss>`                                          |
| Safety metric      | `complexToSimpleRate = complexToSimpleCount / complexExpectedSamples`                          |
| Efficiency metric  | `simpleToComplexRate = simpleToComplexCount / simpleExpectedSamples`                           |
| Probability metric | `model-path-only log loss, Brier score`                                                        |
| 최소 실용 개선폭          | `<권장: incumbent 대비 difficulty accuracy +0.01; 결과 확인 전에 고정>`                                    |
| 통계 기준              | `<예: paired delta의 family-cluster bootstrap 95% CI 하한 > 0>`                                    |
| Runtime budget     | `<권장: incumbent 대비 p95/RSS +10% 이내, p99 < configured timeout; 실행 전에 고정>`                       |
| Cost policy        | `<미사용 / C_FN:C_FP = x:1, 승인 reference>`                                                        |




### 2.2 Threshold 선택 우선순위

아래 중 실제로 사용한 정책 하나만 선택하고 실행 전에 고정한다.

- [ ] Constrained accuracy: overall 및 category별 complex → simple 비악화 후보 중 accuracy 최대화
- [ ] Expected decision loss: 사전 승인된 `C_FN:C_FP`로 loss 최소화하되 complex → simple safety gate 유지

동률 처리 순서:

1. `<예: simple → complex가 더 적은 threshold>`
2. `<예: 그래도 같으면 더 낮은 보수적 threshold>`



## 3. Frozen Provenance And Hashes



### 3.1 Dataset, policy, code


| Artifact / policy                        | Version | Path or immutable reference | SHA-256 / commit | Freeze time |
| ---------------------------------------- | ------- | --------------------------- | ---------------- | ----------- |
| Training dataset                         | `<작성>`  | `<작성>`                      | `<작성>`           | `<작성>`      |
| Role/split manifest                      | `<작성>`  | `<작성>`                      | `<작성>`           | `<작성>`      |
| Family policy                            | `<작성>`  | `<작성>`                      | `<작성>`           | `<작성>`      |
| Label guide                              | `<작성>`  | `<작성>`                      | `<작성>`           | `<작성>`      |
| Instruction/payload parser               | `<작성>`  | `<작성>`                      | `<작성>`           | `<작성>`      |
| 42D vectorizer                           | `<작성>`  | `<작성>`                      | `<작성>`           | `<작성>`      |
| Model-path eligibility / sentinel policy | `<작성>`  | `<작성>`                      | `<작성>`           | `<작성>`      |
| Training/evaluation code                 | `<작성>`  | `<작성>`                      | `<commit>`       | `<작성>`      |




### 3.2 Model components


| Component                 | Version / configuration | Artifact reference | SHA-256 |
| ------------------------- | ----------------------- | ------------------ | ------- |
| Tokenizer                 | `<작성>`                  | `<작성>`             | `<작성>`  |
| Encoder                   | `<작성>`                  | `<작성>`             | `<작성>`  |
| PCA                       | `<작성>`                  | `<작성>`             | `<작성>`  |
| Semantic heads            | `<작성>`                  | `<작성>`             | `<작성>`  |
| Final Logistic Regression | `<작성>`                  | `<작성>`             | `<작성>`  |
| Calibrator                | `<작성>`                  | `<작성>`             | `<작성>`  |
| Threshold policy          | `<작성>`                  | `<작성>`             | `<작성>`  |
| Combined runtime artifact | `<작성>`                  | `<작성>`             | `<작성>`  |




### 3.3 실행 환경


| 항목                            | 값                       |
| ----------------------------- | ----------------------- |
| OS / architecture             | `<작성>`                  |
| CPU / accelerator             | `<작성>`                  |
| Available memory              | `<작성>`                  |
| Python / NumPy / scikit-learn | `<작성>`                  |
| Go / ONNX Runtime 등 runtime   | `<작성>`                  |
| Encoder precision             | `<float32 / int8 / 기타>` |
| Thread / batch setting        | `<작성>`                  |




## 4. Split And Leakage Audit



### 4.1 Role별 표본과 family


| Role                           | 사용 목적                                | Records | Families | Simple | Complex | 열람 상태                  |
| ------------------------------ | ------------------------------------ | ------- | -------- | ------ | ------- | ---------------------- |
| Train                          | PCA/head/LR fit 및 train 내부 CV        | `<작성>`  | `<작성>`   | `<작성>` | `<작성>`  | `<열람 가능>`              |
| Calibration                    | Calibrator CV/fit 및 threshold OOF 선택 | `<작성>`  | `<작성>`   | `<작성>` | `<작성>`  | `<열람 가능>`              |
| Evaluation holdout             | Frozen candidate 1회 내부 acceptance    | `<작성>`  | `<작성>`   | `<작성>` | `<작성>`  | `<untouched/consumed>` |
| Promotion holdout / final test | Frozen candidate 1회 final evidence   | `<작성>`  | `<작성>`   | `<작성>` | `<작성>`  | `<untouched/consumed>` |


Role 표의 Records는 dataset 전체다. 아래에서 current decision boundary가 만든 실제 학습 모집단을 분리한다.


| Role                     | Model-path records / families | Sentinel records / families | Semantic-head-eligible records / families |
| ------------------------ | ----------------------------- | --------------------------- | ----------------------------------------- |
| Train                    | `<작성>`                        | `<작성>`                      | `<작성>`                                    |
| Calibration / validation | `<작성>`                        | `<작성>`                      | `<작성>`                                    |
| Evaluation / final test  | `<작성>`                        | `<작성>`                      | `<작성>`                                    |




### 4.2 Coverage


| Segment                   | Train records / families | Calibration records / families | Evaluation holdout records / families | Promotion holdout records / families |
| ------------------------- | ------------------------ | ------------------------------ | ------------------------------------- | ------------------------------------ |
| `general × simple`        | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| `general × complex`       | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| `code × simple`           | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| `code × complex`          | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| `translation × simple`    | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| `translation × complex`   | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| `summarization × simple`  | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| `summarization × complex` | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| `reasoning × simple`      | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| `reasoning × complex`     | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| Korean                    | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| English                   | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |
| Mixed language            | `<작성>`                   | `<작성>`                         | `<작성>`                                | `<작성>`                               |




### 4.3 Leakage audit checklist


| 검사                                       | 기준                                                                   | 결과                   | Evidence reference |
| ---------------------------------------- | -------------------------------------------------------------------- | -------------------- | ------------------ |
| Cross-split promptFamily overlap         | `0`                                                                  | `<PASS/FAIL; count>` | `<작성>`             |
| Same-family simple/complex contrast 분리   | `0`                                                                  | `<PASS/FAIL; count>` | `<작성>`             |
| Paraphrase/synonym/language variant 분리   | `0`                                                                  | `<PASS/FAIL; count>` | `<작성>`             |
| Exact duplicate across split             | `0`                                                                  | `<PASS/FAIL; count>` | `<작성>`             |
| Normalized / near-duplicate across split | `0` 또는 사전 승인 예외만 허용                                                  | `<PASS/FAIL; count>` | `<작성>`             |
| Decision-boundary assignment             | Role별 modelPath/empty/hard-sentinel count·family와 membership hash 동결 | `<PASS/FAIL>`        | `<작성>`             |
| Supported boundary ground truth          | Exact match 100%, payload contamination 0                            | `<PASS/FAIL>`        | `<작성>`             |
| Hard-sentinel parity                     | B0 membership parity 100%; FP/precision/coverage 보고                  | `<PASS/FAIL>`        | `<작성>`             |
| PCA fit scope                            | 각 fold의 train-only                                                   | `<PASS/FAIL>`        | `<작성>`             |
| Semantic head fit scope                  | 각 fold의 train-only                                                   | `<PASS/FAIL>`        | `<작성>`             |
| 12D stacking feature                     | LR train에는 cross-fitted OOF head probability 사용                      | `<PASS/FAIL>`        | `<작성>`             |
| Candidate별 calibrator comparison         | A/B/C 각각 validation family-grouped OOF                               | `<PASS/FAIL>`        | `<작성>`             |
| Threshold selection                      | calibration OOF calibrated score만 사용                                 | `<PASS/FAIL>`        | `<작성>`             |
| Holdout candidate count                  | frozen candidate 정확히 1개                                              | `<PASS/FAIL>`        | `<작성>`             |


Leakage audit 결론: `<PASS / FAIL>`

## 5. Common Experiment Configuration



### 5.1 고정 전처리와 encoder


| 설정                                 | 값                                             |
| ---------------------------------- | --------------------------------------------- |
| Input to encoder                   | `instructionText only`                        |
| Payload handling                   | `<payload structure statistics only; 상세 작성>`  |
| Encoder model                      | `<작성>`                                        |
| Max token length / truncation      | `<current canonical: 128 / right truncation>` |
| Pooling                            | `<masked mean pooling>`                       |
| Pre-PCA embedding normalization    | `none`                                        |
| PCA centering / solver / whitening | `center=true, svd_solver=full, whiten=false`  |
| PCA output normalization           | `L2, epsilon=1e-12`                           |
| Empty/meaningless sentinel         | `<score 0.0 + simple 등>`                      |
| Hard-complex sentinel              | `<score 1.0 + complex 등>`                     |
| Encoder/runtime failure fallback   | `<rule difficulty 유지 등>`                      |




### 5.2 Cross-validation, seeds, repeats


| 설정                       | 값                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| Group key                | `promptFamily`                                                                                     |
| Stratification           | `<category × difficulty 또는 사전 정의>`                                                                 |
| Train screening CV       | `5-fold StratifiedGroupKFold(shuffle=true, random_state=20260719)` 또는 `<사전 승인 값>`                  |
| Candidate C stacking CV  | `4-fold StratifiedGroupKFold(shuffle=true, random_state=20260720 + outerFoldIndex)` 또는 `<사전 승인 값>` |
| Validation calibrator CV | `5-fold StratifiedGroupKFold(shuffle=true, random_state=20260721)` 또는 `<사전 승인 값>`                  |
| Sensitivity seeds        | `<N/A 또는 결과 열람 전 고정한 값>`                                                                           |
| Candidate 공통 fold        | `<PASS/FAIL>`                                                                                      |
| Bootstrap                | `family-cluster, 10,000 resamples, seed 20260722` 또는 `<사전 승인 값>`                                   |
| Model RNG                | `semantic heads=20260714, final LR=1729, Platt=1729` 또는 `<사전 승인 값>`                                |
| Fold/software lock       | `<fold manifest SHA-256, sklearn/NumPy/BLAS/ONNX Runtime lock>`                                    |
| Tie tolerance            | `<log loss 및 Brier tolerance>`                                                                     |


Seed 선택 원칙: 가장 좋은 seed 결과를 선택하지 않고, primary seed로 후보를 선택한 뒤 sensitivity seed에서 결론 안정성만 확인한다.

### 5.3 Factor isolation


| 비교          | 바꾸는 요인                                      | 반드시 고정하는 요인                                                                        |
| ----------- | ------------------------------------------- | ---------------------------------------------------------------------------------- |
| Exp1        | PCA dimension                               | canonical PCA pipeline, Candidate B probe, probe LR `C=10`, split, 5-fold manifest |
| Exp2        | semantic-head regularization                | selected P, head labels, folds                                                     |
| Exp3 × Exp4 | feature candidate / final LR regularization | preprocessing, selected P, head-generation rule, folds                             |
| Exp5        | candidate별 calibrator와 최종 base candidate    | A/B/C slate, candidate별 frozen raw model, calibration folds                        |
| Exp6        | threshold                                   | frozen model, selected calibrator, OOF calibrated scores                           |




## 6. Exp0 — Instruction/Payload Boundary Validation



### 6.1 Hypothesis And Configuration


| 항목        | 값                                                                                                                |
| --------- | ---------------------------------------------------------------------------------------------------------------- |
| 가설        | `동결할 parser가 승인 label의 instruction/payload boundary를 재현하고 기존 current parser보다 payload contamination을 악화시키지 않는다.` |
| Baseline  | `<current parser version>`                                                                                       |
| Candidate | `<동일 version 검증 또는 새 parser version>`                                                                            |
| 대상 slice  | `explicit boundary, ambiguous boundary, payload-only, empty instruction, payload_contamination`                  |
| 변경된 rule  | `<aggregate 설명만 작성; prompt fragment 금지>`                                                                         |




### 6.2 Results


| Metric                                              | Baseline | Candidate | Delta  | Gate          | Result        |
| --------------------------------------------------- | -------- | --------- | ------ | ------------- | ------------- |
| Supported boundary exact-match accuracy             | `<작성>`   | `<작성>`    | `<작성>` | `100%`        | `<PASS/FAIL>` |
| Ambiguous/unsupported no-forced-split accuracy      | `<작성>`   | `<작성>`    | `<작성>` | `100%`        | `<PASS/FAIL>` |
| Payload detection precision / recall                | `<작성>`   | `<작성>`    | `<작성>` | `<분모와 사전 기준>` | `<PASS/FAIL>` |
| Supported-boundary payload contamination rate       | `<작성>`   | `<작성>`    | `<작성>` | `0`           | `<PASS/FAIL>` |
| Empty-instruction semantic-status/sentinel accuracy | `<작성>`   | `<작성>`    | `<작성>` | `100%`        | `<PASS/FAIL>` |


결론: `<선택 parser와 근거>`

> Parser가 변경되면 기존 embedding cache, PCA, semantic heads, classifier, calibrator와 threshold 결과를 재사용하지 않는다.



### 6.3 Sentinel And Model-Path Freeze


| Role       | Model-path coverage | Empty sentinel support/accuracy | Hard sentinel support | Hard sentinel expected-simple FP/rate | Hard sentinel precision | Expected-complex coverage/recall | Membership parity/hash   |
| ---------- | ------------------- | ------------------------------- | --------------------- | ------------------------------------- | ----------------------- | -------------------------------- | ------------------------ |
| Train      | `<작성>`              | `<작성>`                          | `<작성>`                | `<작성>`                                | `<작성>`                  | `<작성>`                           | `<PASS/FAIL; hash>`      |
| Validation | `<작성>`              | `<작성>`                          | `<작성>`                | `<작성>`                                | `<작성>`                  | `<작성>`                           | `<PASS/FAIL; hash>`      |
| Test       | `<작성>`              | `<작성>`                          | `<작성>`                | `<작성>`                                | `<작성>`                  | `<작성>`                           | `<untouched; hash only>` |




## 7. Exp1 — PCA Dimension



### 7.1 Configuration


| 항목                       | 값                                                                                                               |
| ------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Candidate dimensions     | `16, 32, 64, 96, 128`                                                                                           |
| Selection CV             | `Train 5-fold StratifiedGroupKFold(shuffle=true, random_state=20260719)`                                        |
| Fixed PCA pipeline       | `raw pooled → PCA(P, svd_solver=full, whiten=false) → L2(epsilon=1e-12)`                                        |
| Fit scope                | `각 CV fold의 train only`                                                                                         |
| Probe candidate          | `B = 42D + P`                                                                                                   |
| Fixed probe LR           | `L2 / liblinear / C=10 / fit_intercept=true / class_weight=None / max_iter=2000 / tol=1e-4 / random_state=1729` |
| Primary selection metric | `downstream OOF log loss`                                                                                       |
| Selection rule           | `best mean log loss의 1-SE 범위 안에서 가장 작은 P`                                                                       |
| Diagnostic               | `Brier score, explained variance ratio`                                                                         |




### 7.2 Results


| P   | Explained variance diagnostic | Train OOF log loss | Fold SE | Brier  | PCA p95 latency | Artifact bytes | Non-finite / near-zero count | Within 1-SE set | Selected   |
| --- | ----------------------------- | ------------------ | ------- | ------ | --------------- | -------------- | ---------------------------- | --------------- | ---------- |
| 16  | `<작성>`                        | `<작성>`             | `<작성>`  | `<작성>` | `<작성>`          | `<작성>`         | `<작성>`                       | `<Yes/No>`      | `<Yes/No>` |
| 32  | `<작성>`                        | `<작성>`             | `<작성>`  | `<작성>` | `<작성>`          | `<작성>`         | `<작성>`                       | `<Yes/No>`      | `<Yes/No>` |
| 64  | `<작성>`                        | `<작성>`             | `<작성>`  | `<작성>` | `<작성>`          | `<작성>`         | `<작성>`                       | `<Yes/No>`      | `<Yes/No>` |
| 96  | `<작성>`                        | `<작성>`             | `<작성>`  | `<작성>` | `<작성>`          | `<작성>`         | `<작성>`                       | `<Yes/No>`      | `<Yes/No>` |
| 128 | `<작성>`                        | `<작성>`             | `<작성>`  | `<작성>` | `<작성>`          | `<작성>`         | `<작성>`                       | `<Yes/No>`      | `<Yes/No>` |


선택: `P=<작성>`

근거: `<작성>`

## 8. Exp2 — Four Semantic Heads



### 8.1 Configuration


| 항목                | 값                                               |
| ----------------- | ----------------------------------------------- |
| Heads             | `task, constraint, scope, dependency`           |
| Output            | `각 head 3-class softmax; 고정 순서 12D probability` |
| Target source     | `human-approved semantic bucket labels`         |
| Classifier        | `<multinomial Logistic Regression>`             |
| Penalty / solver  | `<L2 / lbfgs 등>`                                |
| C candidates      | `0.01, 0.03, 0.1, 0.3, 1, 3, 10`                |
| Class weighting   | `<None / 사전 조건 충족 시 balanced 후보>`               |
| max_iter / tol    | `<예: 2000 / 1e-4>`                              |
| random_state      | `20260714` 또는 `<사전 승인 값>`                       |
| LR stacking input | `cross-fitted OOF head probabilities`           |




### 8.2 Hyperparameter Selection


| C      | Mean 4-head log loss | Fold SE | Mean macro-F1 | Mean multiclass Brier | High-complex bucket recall | Converged  | Within 1-SE / selected |
| ------ | -------------------- | ------- | ------------- | --------------------- | -------------------------- | ---------- | ---------------------- |
| `<작성>` | `<작성>`               | `<작성>`  | `<작성>`        | `<작성>`                | `<작성>`                     | `<Yes/No>` | `<작성>`                 |
| `<작성>` | `<작성>`               | `<작성>`  | `<작성>`        | `<작성>`                | `<작성>`                     | `<Yes/No>` | `<작성>`                 |
| `<작성>` | `<작성>`               | `<작성>`  | `<작성>`        | `<작성>`                | `<작성>`                     | `<Yes/No>` | `<작성>`                 |




### 8.3 Selected Head Performance


| Head       | 3-class log loss | Macro-F1 | Multiclass Brier | ECE    | Highest-complexity class recall | Support by class     | Gate          |
| ---------- | ---------------- | -------- | ---------------- | ------ | ------------------------------- | -------------------- | ------------- |
| Task       | `<작성>`           | `<작성>`   | `<작성>`           | `<작성>` | `<작성>`                          | `<aggregate counts>` | `<PASS/FAIL>` |
| Constraint | `<작성>`           | `<작성>`   | `<작성>`           | `<작성>` | `<작성>`                          | `<aggregate counts>` | `<PASS/FAIL>` |
| Scope      | `<작성>`           | `<작성>`   | `<작성>`           | `<작성>` | `<작성>`                          | `<aggregate counts>` | `<PASS/FAIL>` |
| Dependency | `<작성>`           | `<작성>`   | `<작성>`           | `<작성>` | `<작성>`                          | `<aggregate counts>` | `<PASS/FAIL>` |


Probability finite/range/sum parity: `<PASS/FAIL>`

Language/required-slice aggregate reference: `<작성>`

선택 설정과 근거: `<작성>`

## 9. Exp3 — Feature Candidate Ablation

Exp3와 Exp4는 같은 folds에서 `feature candidate × Logistic Regression C` 공동 grid로 실행한다. 한 feature candidate에만 유리한 고정 `C`를 사용하지 않는다.


| Candidate | Input           | Dimension | Best C | Train OOF log loss | Fold SE | Brier  | Delta vs 42D | Slate refit/converged |
| --------- | --------------- | --------- | ------ | ------------------ | ------- | ------ | ------------ | --------------------- |
| A         | `42D`           | 42        | `<작성>` | `<작성>`             | `<작성>`  | `<작성>` | `reference`  | `<Yes/No>`            |
| B         | `42D + P`       | `<42+P>`  | `<작성>` | `<작성>`             | `<작성>`  | `<작성>` | `<작성>`       | `<Yes/No>`            |
| C         | `42D + P + 12D` | `<54+P>`  | `<작성>` | `<작성>`             | `<작성>`  | `<작성>` | `<작성>`       | `<Yes/No>`            |


- PCA representation 증분 효과 A → B: `<작성>`
- Semantic heads 증분 효과 B → C: `<작성>`
- Tie-break 적용 여부: `<작성>`
- Validation으로 전달한 slate: `A / B / C` 또는 `<계약상 승인된 목록>`
- Final candidate는 Exp5에서 후보별 calibration 뒤 선택하며 이 표에서 선택하지 않는다.



## 10. Exp4 — Final Logistic Regression



### 10.1 Configuration


| 항목               | 값                                                |
| ---------------- | ------------------------------------------------ |
| Model            | `binary Logistic Regression`                     |
| Penalty / solver | `L2 / liblinear` 또는 `<작성>`                       |
| C candidates     | `0.01, 0.03, 0.1, 0.3, 1, 3, 10` 또는 `<사전 고정 목록>` |
| fit_intercept    | `<true>`                                         |
| class_weight     | `<None 또는 승인된 weighting>`                        |
| max_iter / tol   | `<2000 / 1e-4>`                                  |
| random_state     | `1729` 또는 `<사전 승인 값>`                            |
| Selection        | `log loss → Brier → smaller C`                   |
| Invalid rule     | `한 fold라도 미수렴이면 해당 C invalid`                    |




### 10.2 Results


| Feature candidate | C    | Mean OOF log loss | 95% CI | Brier  | Max n_iter | Warning folds | Valid      | Selected   |
| ----------------- | ---- | ----------------- | ------ | ------ | ---------- | ------------- | ---------- | ---------- |
| `<작성>`            | 0.01 | `<작성>`            | `<작성>` | `<작성>` | `<작성>`     | `<작성>`        | `<Yes/No>` | `<Yes/No>` |
| `<작성>`            | 0.03 | `<작성>`            | `<작성>` | `<작성>` | `<작성>`     | `<작성>`        | `<Yes/No>` | `<Yes/No>` |
| `<작성>`            | 0.1  | `<작성>`            | `<작성>` | `<작성>` | `<작성>`     | `<작성>`        | `<Yes/No>` | `<Yes/No>` |
| `<작성>`            | 0.3  | `<작성>`            | `<작성>` | `<작성>` | `<작성>`     | `<작성>`        | `<Yes/No>` | `<Yes/No>` |
| `<작성>`            | 1    | `<작성>`            | `<작성>` | `<작성>` | `<작성>`     | `<작성>`        | `<Yes/No>` | `<Yes/No>` |
| `<작성>`            | 3    | `<작성>`            | `<작성>` | `<작성>` | `<작성>`     | `<작성>`        | `<Yes/No>` | `<Yes/No>` |
| `<작성>`            | 10   | `<작성>`            | `<작성>` | `<작성>` | `<작성>`     | `<작성>`        | `<Yes/No>` | `<Yes/No>` |


Final refit convergence: `<PASS/FAIL; n_iter>`

선택 설정과 근거: `<작성>`

## 11. Exp5 — Calibration



### 11.1 Protocol


| 항목                             | 값                                                                                                        |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Base candidate slate           | `<A/B/C artifact hashes>`                                                                                |
| Input to calibrator            | `<current contract의 raw_probability>`                                                                    |
| CV                             | `<calibration split family-grouped folds>`                                                               |
| Candidates                     | `Platt, exact-PAVA Isotonic`                                                                             |
| Calibrator selection           | `candidate 내부 mean OOF log loss → Brier → Platt`                                                         |
| Final base candidate selection | `selected-calibrator OOF log loss → Brier → lower dimension`                                             |
| Isotonic lookup                | `inclusive-lower floor lookup; x 범위 밖은 양끝 y로 clip; no interpolation`                                     |
| Isotonic weighting             | `exact-tie aggregation + equal sample-count weighting`                                                   |
| Unsupported heuristic          | `score rounding, epsilon grouping, post-hoc small-block merge, 임의 0.01~0.99 clipping/smoothing을 사용하지 않음` |




### 11.2 Candidate Results


| Base candidate | Dimension | Calibrator | Configuration      | Mean OOF log loss | Brier  | Fit/validation failures | Candidate calibrator selected | Final base selected |
| -------------- | --------- | ---------- | ------------------ | ----------------- | ------ | ----------------------- | ----------------------------- | ------------------- |
| A              | 42        | Platt      | `C=1e6, seed=1729` | `<작성>`            | `<작성>` | `<작성>`                  | `<Yes/No>`                    | `<Yes/No>`          |
| A              | 42        | Isotonic   | `exact PAVA`       | `<작성>`            | `<작성>` | `<작성>`                  | `<Yes/No>`                    | `<Yes/No>`          |
| B              | `<42+P>`  | Platt      | `C=1e6, seed=1729` | `<작성>`            | `<작성>` | `<작성>`                  | `<Yes/No>`                    | `<Yes/No>`          |
| B              | `<42+P>`  | Isotonic   | `exact PAVA`       | `<작성>`            | `<작성>` | `<작성>`                  | `<Yes/No>`                    | `<Yes/No>`          |
| C              | `<54+P>`  | Platt      | `C=1e6, seed=1729` | `<작성>`            | `<작성>` | `<작성>`                  | `<Yes/No>`                    | `<Yes/No>`          |
| C              | `<54+P>`  | Isotonic   | `exact PAVA`       | `<작성>`            | `<작성>` | `<작성>`                  | `<Yes/No>`                    | `<Yes/No>`          |




### 11.3 Isotonic Diagnostics

Isotonic이 선택되지 않아도 비교 후보 진단을 aggregate로 기록한다. 실제 score boundary는 기록하지 않는다.


| Fold / full fit      | Block count | Minimum block samples | Maximum block samples | Extreme-output aggregate rate | Warning |
| -------------------- | ----------- | --------------------- | --------------------- | ----------------------------- | ------- |
| Fold 1               | `<작성>`      | `<작성>`                | `<작성>`                | `<작성>`                        | `<작성>`  |
| Fold 2               | `<작성>`      | `<작성>`                | `<작성>`                | `<작성>`                        | `<작성>`  |
| Fold 3               | `<작성>`      | `<작성>`                | `<작성>`                | `<작성>`                        | `<작성>`  |
| Fold 4               | `<작성>`      | `<작성>`                | `<작성>`                | `<작성>`                        | `<작성>`  |
| Fold 5               | `<작성>`      | `<작성>`                | `<작성>`                | `<작성>`                        | `<작성>`  |
| Full calibration fit | `<작성>`      | `<작성>`                | `<작성>`                | `<작성>`                        | `<작성>`  |




### 11.4 Aggregate Calibration Bins


| Bin ID | Samples | Mean final ComplexityScore | Observed complex rate | Absolute gap |
| ------ | ------- | -------------------------- | --------------------- | ------------ |
| 1      | `<작성>`  | `<작성>`                     | `<작성>`                | `<작성>`       |
| 2      | `<작성>`  | `<작성>`                     | `<작성>`                | `<작성>`       |
| 3      | `<작성>`  | `<작성>`                     | `<작성>`                | `<작성>`       |
| 4      | `<작성>`  | `<작성>`                     | `<작성>`                | `<작성>`       |
| 5      | `<작성>`  | `<작성>`                     | `<작성>`                | `<작성>`       |


선택 base candidate / calibrator와 근거: `<작성>`

## 12. Exp6 — Global Threshold



### 12.1 Selection Protocol


| 항목                  | 값                                                                          |
| ------------------- | -------------------------------------------------------------------------- |
| Score source        | `Exp5 family-grouped OOF calibrated scores`                                |
| Candidate rule      | `사전 고정 0.000~1.000, step 0.001 grid; score-derived 후보 추가 금지`               |
| Inclusive decision  | `ComplexityScore >= threshold → complex`                                   |
| Objective           | `<constrained accuracy / expected decision loss>`                          |
| FN cost / FP cost   | `<N/A 또는 사전 승인 값>`                                                         |
| Safety constraint   | `overall 및 각 category에서 C1 complex → simple <= min(B0 rule, B1 incumbent)` |
| Tie-break           | `<작성>`                                                                     |
| Bootstrap stability | `<family-cluster resamples와 seed>`                                         |




### 12.2 Candidate Summary

모든 후보를 나열할 필요는 없다. 선택값, 인접 경쟁값과 사전 baseline threshold만 aggregate로 기록한다.


| Threshold              | Accuracy | FN count / rate | FP count / rate | Expected loss | Safety pass | Selection note |
| ---------------------- | -------- | --------------- | --------------- | ------------- | ----------- | -------------- |
| `<baseline threshold>` | `<작성>`   | `<작성>`          | `<작성>`          | `<작성/N/A>`    | `<Yes/No>`  | `baseline`     |
| `<lower neighbor>`     | `<작성>`   | `<작성>`          | `<작성>`          | `<작성/N/A>`    | `<Yes/No>`  | `<작성>`         |
| `<selected>`           | `<작성>`   | `<작성>`          | `<작성>`          | `<작성/N/A>`    | `<Yes/No>`  | `selected`     |
| `<upper neighbor>`     | `<작성>`   | `<작성>`          | `<작성>`          | `<작성/N/A>`    | `<Yes/No>`  | `<작성>`         |




### 12.3 Threshold Stability


| Statistic                            | Value                                         |
| ------------------------------------ | --------------------------------------------- |
| Selected threshold                   | `<작성>`                                        |
| Family-bootstrap median              | `<작성>`                                        |
| Family-bootstrap 95% interval        | `<작성>`                                        |
| Selection frequency within tolerance | `<작성>`                                        |
| Stability assessment                 | `<stable / unstable / insufficient evidence>` |




## 13. Artifact Freeze Before Holdout Access


| Freeze item               | Value / hash           | Verified by role | Status        |
| ------------------------- | ---------------------- | ---------------- | ------------- |
| Feature candidate         | `<작성>`                 | `<role>`         | `<PASS/FAIL>` |
| Encoder / tokenizer       | `<작성>`                 | `<role>`         | `<PASS/FAIL>` |
| PCA                       | `<작성>`                 | `<role>`         | `<PASS/FAIL>` |
| Four semantic heads       | `<작성>`                 | `<role>`         | `<PASS/FAIL>` |
| Final Logistic Regression | `<작성>`                 | `<role>`         | `<PASS/FAIL>` |
| Calibrator                | `<작성>`                 | `<role>`         | `<PASS/FAIL>` |
| Global threshold          | `<작성>`                 | `<role>`         | `<PASS/FAIL>` |
| Sentinel policy           | `<작성>`                 | `<role>`         | `<PASS/FAIL>` |
| Python–Go golden parity   | `<evidence reference>` | `<role>`         | `<PASS/FAIL>` |
| Evaluation command/config | `<작성>`                 | `<role>`         | `<PASS/FAIL>` |


Holdout access 승인 시각: `<작성>`

승인 전 promotion holdout score/model access 여부: `<없음이어야 함>`

## 14. Final Paired Holdout Evaluation



### 14.1 Statistical Method


| 항목                     | 값                                                           |
| ---------------------- | ----------------------------------------------------------- |
| Holdout role           | `<evaluation / promotion>`                                  |
| Paired unit            | `동일 record에서 B0 rule, B1 incumbent, C1 frozen candidate 비교` |
| Cluster unit           | `promptFamily`                                              |
| Bootstrap resamples    | `<예: 10,000>`                                               |
| Confidence level       | `<95%>`                                                     |
| Bootstrap seed         | `<작성>`                                                      |
| Optional McNemar       | `<N/A 또는 exact p-value; 보조 지표>`                             |
| Power / MDE assessment | `<사전 계산 reference와 결론>`                                     |




### 14.2 Overall Results


| Metric                       | Population       | B0 rule    | B1 incumbent | C1 candidate | Delta C1-B1 | 95% family-bootstrap CI | Gate               | Result            |
| ---------------------------- | ---------------- | ---------- | ------------ | ------------ | ----------- | ----------------------- | ------------------ | ----------------- |
| Difficulty accuracy          | End-to-end       | `<작성>`     | `<작성>`       | `<작성>`       | `<작성>`      | `<작성>`                  | `<사전 MDE/CI>`      | `<PASS/FAIL>`     |
| Joint routing-label accuracy | End-to-end       | `<작성>`     | `<작성>`       | `<작성>`       | `<작성>`      | `<작성>`                  | `B1 비악화`           | `<PASS/FAIL>`     |
| Complex → simple count       | End-to-end       | `<작성>`     | `<작성>`       | `<작성>`       | `<작성>`      | `<작성>`                  | `C1 <= min(B0,B1)` | `<PASS/FAIL>`     |
| Complex → simple rate        | Expected complex | `<작성>`     | `<작성>`       | `<작성>`       | `<작성>`      | `<작성>`                  | `C1 <= min(B0,B1)` | `<PASS/FAIL>`     |
| Simple → complex count       | End-to-end       | `<작성>`     | `<작성>`       | `<작성>`       | `<작성>`      | `<작성>`                  | `<사전 기준>`          | `<PASS/FAIL>`     |
| Simple → complex rate        | Expected simple  | `<작성>`     | `<작성>`       | `<작성>`       | `<작성>`      | `<작성>`                  | `<사전 기준>`          | `<PASS/FAIL>`     |
| Log loss                     | Model path only  | `N/A`      | `<작성>`       | `<작성>`       | `<작성>`      | `<작성>`                  | `B1 비악화`           | `<PASS/FAIL>`     |
| Brier score                  | Model path only  | `N/A`      | `<작성>`       | `<작성>`       | `<작성>`      | `<작성>`                  | `B1 비악화`           | `<PASS/FAIL>`     |
| Expected decision loss       | End-to-end       | `<작성/N/A>` | `<작성/N/A>`   | `<작성/N/A>`   | `<작성/N/A>`  | `<작성/N/A>`              | `<작성/N/A>`         | `<PASS/FAIL/N/A>` |




### 14.3 Oracle Category Versus End-To-End


| Evaluation path                         | Samples | Accuracy | Complex → simple count/rate | Simple → complex count/rate |
| --------------------------------------- | ------- | -------- | --------------------------- | --------------------------- |
| Oracle expected category                | `<작성>`  | `<작성>`   | `<작성>`                      | `<작성>`                      |
| Runtime actual category                 | `<작성>`  | `<작성>`   | `<작성>`                      | `<작성>`                      |
| Delta attributable to category mismatch | `<작성>`  | `<작성>`   | `<작성>`                      | `<작성>`                      |




### 14.4 Sentinel And Model-Path Coverage


| Path                              | Samples | Coverage | Accuracy | Complex → simple count | Failure/fallback count |
| --------------------------------- | ------- | -------- | -------- | ---------------------- | ---------------------- |
| Empty/meaningless simple sentinel | `<작성>`  | `<작성>`   | `<작성>`   | `<작성>`                 | `<작성>`                 |
| Hard-complex sentinel             | `<작성>`  | `<작성>`   | `<작성>`   | `<작성>`                 | `<작성>`                 |
| Logistic model path               | `<작성>`  | `<작성>`   | `<작성>`   | `<작성>`                 | `<작성>`                 |




## 15. Category And Required Slice Safety



### 15.1 By Category


| Category      | Simple n | Complex n | B0 FN count/rate | B1 FN count/rate | C1 FN count/rate | B1 FP count/rate | C1 FP count/rate | C1 FN ≤ min(B0,B1) | Evidence status             |
| ------------- | -------- | --------- | ---------------- | ---------------- | ---------------- | ---------------- | ---------------- | ------------------ | --------------------------- |
| General       | `<작성>`   | `<작성>`    | `<작성>`           | `<작성>`           | `<작성>`           | `<작성>`           | `<작성>`           | `<PASS/FAIL>`      | `<sufficient/insufficient>` |
| Code          | `<작성>`   | `<작성>`    | `<작성>`           | `<작성>`           | `<작성>`           | `<작성>`           | `<작성>`           | `<PASS/FAIL>`      | `<sufficient/insufficient>` |
| Translation   | `<작성>`   | `<작성>`    | `<작성>`           | `<작성>`           | `<작성>`           | `<작성>`           | `<작성>`           | `<PASS/FAIL>`      | `<sufficient/insufficient>` |
| Summarization | `<작성>`   | `<작성>`    | `<작성>`           | `<작성>`           | `<작성>`           | `<작성>`           | `<작성>`           | `<PASS/FAIL>`      | `<sufficient/insufficient>` |
| Reasoning     | `<작성>`   | `<작성>`    | `<작성>`           | `<작성>`           | `<작성>`           | `<작성>`           | `<작성>`           | `<PASS/FAIL>`      | `<sufficient/insufficient>` |




### 15.2 Required Evaluation Slices


| Slice                   | Total n | Simple n | Complex n | Baseline accuracy | Candidate accuracy | Baseline FN | Candidate FN | Result / evidence status |
| ----------------------- | ------- | -------- | --------- | ----------------- | ------------------ | ----------- | ------------ | ------------------------ |
| `negation`              | `<작성>`  | `<작성>`   | `<작성>`    | `<작성>`            | `<작성>`             | `<작성>`      | `<작성>`       | `<작성>`                   |
| `indirect_expression`   | `<작성>`  | `<작성>`   | `<작성>`    | `<작성>`            | `<작성>`             | `<작성>`      | `<작성>`       | `<작성>`                   |
| `synonym`               | `<작성>`  | `<작성>`   | `<작성>`    | `<작성>`            | `<작성>`             | `<작성>`      | `<작성>`       | `<작성>`                   |
| `short_complex`         | `<작성>`  | `0`      | `<작성>`    | `<작성>`            | `<작성>`             | `<작성>`      | `<작성>`       | `<작성>`                   |
| `long_simple`           | `<작성>`  | `<작성>`   | `0`       | `<작성>`            | `<작성>`             | `N/A`       | `N/A`        | `<작성>`                   |
| `payload_contamination` | `<작성>`  | `<작성>`   | `<작성>`    | `<작성>`            | `<작성>`             | `<작성>`      | `<작성>`       | `<작성>`                   |
| `korean`                | `<작성>`  | `<작성>`   | `<작성>`    | `<작성>`            | `<작성>`             | `<작성>`      | `<작성>`       | `<작성>`                   |
| `english`               | `<작성>`  | `<작성>`   | `<작성>`    | `<작성>`            | `<작성>`             | `<작성>`      | `<작성>`       | `<작성>`                   |
| `mixed_language`        | `<작성>`  | `<작성>`   | `<작성>`    | `<작성>`            | `<작성>`             | `<작성>`      | `<작성>`       | `<작성>`                   |
| `category_confusion`    | `<작성>`  | `<작성>`   | `<작성>`    | `<작성>`            | `<작성>`             | `<작성>`      | `<작성>`       | `<작성>`                   |
| `ood_terminology`       | `<작성>`  | `<작성>`   | `<작성>`    | `<작성>`            | `<작성>`             | `<작성>`      | `<작성>`       | `<작성>`                   |


표본이 부족한 slice는 개선으로 간주하지 않고 `insufficient evidence`로 기록한다.

## 16. Runtime And Operational Guardrails



### 16.1 Measurement Protocol


| 항목                            | 값                                                                   |
| ----------------------------- | ------------------------------------------------------------------- |
| Runtime build / artifact hash | `<작성>`                                                              |
| Hardware                      | `<작성>`                                                              |
| Warm-up iterations            | `<작성>`                                                              |
| Measured iterations / batches | `<작성>`                                                              |
| Input length distribution     | `<aggregate p50/p95 token or rune counts>`                          |
| Concurrency / threads         | `<작성>`                                                              |
| Actual configured timeout     | `<작성; default를 자동 가정하지 않음>`                                         |
| Latency protocol              | `<권장: batch1, worker1, warm-up100, measured>=1000>`                 |
| Stress protocol               | `<권장: worker1/queue4, concurrency 1/4/8, 각 5분, 고정 arrival pattern>` |
| Included stages               | `<tokenizer/encoder/PCA transform/heads/LR/calibrator 등>`           |
| Excluded stages               | `<file I/O/report serialization 등>`                                 |




### 16.2 Results


| Metric                              | Baseline   | Candidate | Delta  | Budget | Result        |
| ----------------------------------- | ---------- | --------- | ------ | ------ | ------------- |
| Classification latency p50          | `<작성>`     | `<작성>`    | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Classification latency p95          | `<작성>`     | `<작성>`    | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Classification latency max          | `<작성>`     | `<작성>`    | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Model load time                     | `<작성/N/A>` | `<작성>`    | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Peak RSS / memory delta             | `<작성/N/A>` | `<작성>`    | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Combined artifact size              | `<작성/N/A>` | `<작성>`    | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Encoder/runtime failure rate        | `<작성/N/A>` | `<작성>`    | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Rule fallback success rate          | `<작성/N/A>` | `<작성>`    | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Non-finite/out-of-range score count | `<작성/N/A>` | `<작성>`    | `<작성>` | `0`    | `<PASS/FAIL>` |




## 17. Consumed Holdout Record


| Dataset version | Holdout role | Split/artifact hash | Accessed at         | Frozen candidate hash | Purpose                       | Result reference | Consumed   | Future tuning eligible |
| --------------- | ------------ | ------------------- | ------------------- | --------------------- | ----------------------------- | ---------------- | ---------- | ---------------------- |
| `<작성>`          | Evaluation   | `<작성>`              | `<작성 또는 untouched>` | `<작성>`                | `internal acceptance`         | `<작성>`           | `<Yes/No>` | `<No if consumed>`     |
| `<작성>`          | Promotion    | `<작성>`              | `<작성 또는 untouched>` | `<작성>`                | `one-time promotion evidence` | `<작성>`           | `<Yes/No>` | `<No if consumed>`     |


Holdout 소비 선언:

`<이 holdout 결과를 확인한 뒤 feature, model, calibrator, threshold, parser 또는 sentinel policy를 변경하면 새 evidence run과 새 untouched holdout이 필요하다는 점을 명시>`

## 18. Deviations And Limitations



### 18.1 Protocol Deviations


| Planned protocol | Actual execution | Reason | Bias / impact | Remediation | Approved by role |
| ---------------- | ---------------- | ------ | ------------- | ----------- | ---------------- |
| `<작성 또는 없음>`     | `<작성>`           | `<작성>` | `<작성>`        | `<작성>`      | `<작성>`           |




### 18.2 Known Limitations

- Dataset provenance / representativeness: `<synthetic, redacted, human-review 범위와 한계>`
- Production prevalence mismatch: `<balanced evaluation과 실제 traffic 분포 차이>`
- Statistical power: `<검출 가능한 최소 개선폭과 부족한 segment>`
- Category-classifier dependency: `<oracle와 end-to-end 차이>`
- Calibration interpretation: `<평가 모집단에서의 확률 의미와 distribution drift 위험>`
- Runtime environment: `<측정 hardware와 production 차이>`
- 기타: `<작성>`

이 결과만으로 product GA, release completion 또는 production readiness 전체를 선언하지 않는다.

## 19. GO / NO-GO Gate Review


| Gate                         | 사전 기준                                                                                        | 관찰 결과  | Status            |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ------ | ----------------- |
| Dataset training eligibility | 모든 포함 family human-reviewed/approved 및 manifest gate 통과                                      | `<작성>` | `<PASS/FAIL>`     |
| Contract authorization       | Candidate shape, train screening, validation final-selection policy가 versioned contract로 승인됨 | `<작성>` | `<PASS/FAIL>`     |
| Tooling/runtime support      | Selected shape의 artifact/schema/verifier/codegen/parity 지원 또는 offline-only 명시                | `<작성>` | `<PASS/FAIL/N/A>` |
| Split leakage                | Cross-split family/duplicate leakage 0                                                       | `<작성>` | `<PASS/FAIL>`     |
| Parser gate                  | Exp0 acceptance 충족                                                                           | `<작성>` | `<PASS/FAIL>`     |
| Training convergence         | 선택 모델과 final refit warning 없음                                                                | `<작성>` | `<PASS/FAIL>`     |
| Score validity               | finite, inclusive `0.0~1.0`                                                                  | `<작성>` | `<PASS/FAIL>`     |
| Python–Go parity             | Golden parity acceptance 충족                                                                  | `<작성>` | `<PASS/FAIL>`     |
| Overall accuracy             | `<사전 target 및 paired CI 기준>`                                                                 | `<작성>` | `<PASS/FAIL>`     |
| Overall complex → simple     | C1이 B0와 B1 중 더 엄격한 baseline보다 증가하지 않음                                                        | `<작성>` | `<PASS/FAIL>`     |
| Category complex → simple    | 5개 category 각각 C1이 `min(B0,B1)` 비악화                                                          | `<작성>` | `<PASS/FAIL>`     |
| Calibration                  | 사전 log loss/Brier 선택 정책 충족                                                                   | `<작성>` | `<PASS/FAIL>`     |
| Runtime latency/memory       | 사전 budget 충족                                                                                 | `<작성>` | `<PASS/FAIL>`     |
| Runtime failure/fallback     | 사전 budget 충족                                                                                 | `<작성>` | `<PASS/FAIL>`     |
| Holdout integrity            | Freeze 전 score access 0, 단일 candidate 1회                                                     | `<작성>` | `<PASS/FAIL>`     |


Hard gate 하나라도 실패하면 최종 판단은 `NO-GO`다. 표본 부족으로 superiority를 판단할 수 없으면 `NO-GO — insufficient evidence`로 기록하고 새 untouched evidence를 준비한다.

## 20. Sign-Off



### 20.1 Final Decision

- [ ] `GO — 승인된 offline replay 또는 deployment observation contract 준비 승인`
- [ ] `GO — runtime 승격 검토 승인`
- [ ] `NO-GO — 수정 후 새 evidence run 필요`
- [ ] `NO-GO — insufficient evidence; untouched holdout 확대 필요`

최종 사유: `<작성>`

### 20.2 Role-Based Approval

개인 식별정보 대신 승인 역할과 승인 evidence reference를 기록한다.


| Approval role             | Decision               | Date   | Evidence / approval reference | Conditions |
| ------------------------- | ---------------------- | ------ | ----------------------------- | ---------- |
| Dataset owner             | `<approve/reject>`     | `<작성>` | `<작성>`                        | `<작성>`     |
| Model/evaluation owner    | `<approve/reject>`     | `<작성>` | `<작성>`                        | `<작성>`     |
| Gateway/runtime owner     | `<approve/reject>`     | `<작성>` | `<작성>`                        | `<작성>`     |
| Security/privacy reviewer | `<approve/reject/N/A>` | `<작성>` | `<작성>`                        | `<작성>`     |




## 21. Reproduction References


| 항목                                     | Reference |
| -------------------------------------- | --------- |
| Training command/config                | `<작성>`    |
| Evaluation command/config              | `<작성>`    |
| Aggregate CV report                    | `<작성>`    |
| Aggregate calibration/threshold report | `<작성>`    |
| Aggregate holdout report               | `<작성>`    |
| Runtime benchmark report               | `<작성>`    |
| Parity test report                     | `<작성>`    |


모든 reference는 immutable artifact 또는 commit에 연결한다. 이 섹션에도 금지 데이터나 per-sample score를 복사하지 않는다.