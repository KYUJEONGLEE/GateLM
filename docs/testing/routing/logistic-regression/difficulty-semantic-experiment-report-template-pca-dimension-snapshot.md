# GateLM Difficulty Semantic 실험 결과 리포트 양식

> [!NOTE]
> 이 문서는 GateLM difficulty semantic 분류기의 오프라인 실험 결과를 기록하기 위한 복사·작성용 양식이다. `<작성>` 또는 `TBD`를 실제 값으로 교체하고, 사용하지 않는 선택 항목은 삭제하지 말고 `N/A`와 사유를 적는다.

> [!CAUTION]
> 이 리포트에는 **raw prompt, raw response, raw detected value, raw prompt fragment, 정규화 문자열, token/token ID, embedding, encoded feature vector, raw logit, 미보정 probability, per-sample score, feature별 coefficient contribution, API Key, App Token, Provider Key, Authorization header, provider raw error body 또는 실제 secret를 기록하지 않는다.** 실패 분석은 안전한 `sampleId`, 허용된 비식별화(redacted) 문맥과 집계 건수만 사용한다.

## 1. 의사결정 요약

| 항목 | 값 |
|---|---|
| 실험 실행 ID | `<작성>` |
| 실험 구성 | `6개 실험; Projection 방식은 고정하고 튜닝하지 않음` |
| 실행일 / 기준 시각대 | `<YYYY-MM-DD / 표준시간대>` |
| 평가 commit | `<commit SHA>` |
| 규칙 기준 모델 (`B0`) | `<현재 deterministic rule classifier 정책 버전>` |
| 현행 기준 모델 (`B1`) | `<현재 공식 기준 106D artifact/version/hash>` |
| 선택 후보 | `<42D / 42D+P / 42D+P+12D>` |
| 선택 calibrator | `<Platt / Isotonic>` |
| 선택 전역 threshold | `<0.000~1.000>` |
| 최종 판단 | `<GO / NO-GO>` |
| 판단 범위 | `<오프라인 통과 / 배포 관찰 contract 준비 / 런타임 승격 검토>` |
| 실패 또는 보류 통과 기준 | `<없음 또는 통과하지 못한 기준 목록>` |
| 다음 조치 | `<작성>` |

### 1.1 한 문단 결론

`<기준 모델 대비 무엇이 얼마나 개선 또는 악화됐고, 안전성 통과 기준과 런타임 보호 기준을 충족했는지, 다음 단계가 무엇인지 3~5문장으로 작성>`

### 1.2 핵심 근거

- 정확도: `B1 <값>` → `C1 <값>`; 대응 차이 `<값>`; family-cluster bootstrap 95% CI `<하한, 상한>`
- Complex → simple: `B0 <값> / B1 <값> / C1 <값>`; 더 엄격한 기준 모델의 전체 통과 여부 `<PASS/FAIL>`
- Category별 complex → simple 비악화: `<PASS/FAIL>`
- 확률 보정: log loss `<값>`, Brier score `<값>`, 선택 근거 `<작성>`
- 런타임: p95 `<값과 단위>`, encoder/runtime 실패율 `<값>`; 보호 기준 `<PASS/FAIL>`

## 2. 실험 범위와 사전 등록된 의사결정 규칙

### 2.1 목표와 가설

| 항목 | 사전 정의 |
|---|---|
| 제품 목표 | `동일한 안전성 제약 안에서 현재 106D 현행 모델과 규칙 기준 모델보다 difficulty accuracy를 개선한다.` |
| 1차 평가 지표 | `<overall accuracy 또는 사전 승인된 expected decision loss>` |
| 안전성 지표 | `complexToSimpleRate = complexToSimpleCount / complexExpectedSamples` |
| 효율성 지표 | `simpleToComplexRate = simpleToComplexCount / simpleExpectedSamples` |
| 확률 품질 지표 | `model-path-only log loss, Brier score` |
| 최소 실용 개선폭 | `C1-B1 >= +0.010 absolute (= +1.0%p); 결과 확인 전에 고정` |
| 통계 기준 | `<예: 대응 차이의 family-cluster bootstrap 95% CI 하한 > 0>` |
| 런타임 예산 | `B1 대비 p95/RSS +10% 이내, throughput -10% 이내, p99 < run manifest의 실제 configured timeout; 실행 전에 고정` |
| 비용 정책 | `<미사용 / C_FN:C_FP = x:1, 승인 참조>` |

### 2.2 Threshold 선택 우선순위

기본 정책은 제약 조건부 정확도다. 제품 책임자가 실제 비용비를 결과 확인 전에 승인한 경우에만 기대 의사결정 손실을 1차 목적으로 사용할 수 있다.

- [ ] 제약 조건부 정확도(Constrained accuracy): overall 및 category별 complex → simple 비악화 후보 중 accuracy 최대화
- [ ] 기대 의사결정 손실(Expected decision loss): 사전 승인된 `C_FN:C_FP`로 loss를 최소화하되 complex → simple 안전성 조건 유지

동률 처리 순서:

1. `simple → complex가 더 적은 threshold`
2. `그래도 같으면 더 낮은 threshold`

## 3. 동결된 출처 정보와 hash

### 3.1 데이터셋·정책·코드

| 산출물 / 정책 | 버전 | 경로 또는 불변 참조 | SHA-256 / commit | 동결 시각 |
|---|---|---|---|---|
| 학습 데이터셋 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 역할/split manifest | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Family 정책 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Label 지침 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Instruction/payload parser | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 42D vectorizer | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Model-path 적격성 / sentinel 정책 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 학습/평가 코드 | `<작성>` | `<작성>` | `<commit>` | `<작성>` |

### 3.2 모델 구성 요소

| 구성 요소 | 버전 / 설정 | 산출물 참조 | SHA-256 |
|---|---|---|---|
| Tokenizer | `<작성>` | `<작성>` | `<작성>` |
| Encoder | `<작성>` | `<작성>` | `<작성>` |
| PCA | `<작성>` | `<작성>` | `<작성>` |
| Semantic heads | `<작성>` | `<작성>` | `<작성>` |
| 최종 Logistic Regression | `<작성>` | `<작성>` | `<작성>` |
| Calibrator | `<작성>` | `<작성>` | `<작성>` |
| Threshold policy | `<작성>` | `<작성>` | `<작성>` |
| 통합 런타임 산출물 | `<작성>` | `<작성>` | `<작성>` |

### 3.3 실행 환경

| 항목 | 값 |
|---|---|
| OS / 아키텍처 | `<작성>` |
| CPU / 가속기 | `<작성>` |
| 사용 가능 메모리 | `<작성>` |
| Python / NumPy / scikit-learn | `<작성>` |
| Go / ONNX Runtime 등 runtime | `<작성>` |
| Encoder 정밀도 | `<float32 / int8 / 기타>` |
| Thread / batch 설정 | `<작성>` |

## 4. Split 및 데이터 누출 감사

### 4.1 역할별 표본과 family

| 역할 | 사용 목적 | Record 수 | Family 수 | Simple | Complex | 열람 상태 |
|---|---|---:|---:|---:|---:|---|
| Train | PCA/head/LR 학습 및 Train 내부 CV | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<열람 가능>` |
| Validation | 후보·calibrator OOF 선택 및 threshold 선택 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<열람 가능>` |
| Test | 모든 설정이 동결된 후보 1개의 일회성 최종 평가 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<미열람(untouched)/소비됨(consumed)>` |

역할 표의 Record 수는 데이터셋 전체다. 아래에서 현재 decision boundary가 만든 실제 학습 모집단을 분리한다.

| 역할 | Model-path record / family 수 | Sentinel record / family 수 | Semantic-head 적격 record / family 수 |
|---|---:|---:|---:|
| Train | `<작성>` | `<작성>` | `<작성>` |
| Validation | `<작성>` | `<작성>` | `<작성>` |
| Test | `<작성>` | `<작성>` | `<작성>` |

### 4.2 데이터 범위

| 구간 | Train record / family 수 | Validation record / family 수 | Test record / family 수 |
|---|---:|---:|---:|
| `general × simple` | `<작성>` | `<작성>` | `<작성>` |
| `general × complex` | `<작성>` | `<작성>` | `<작성>` |
| `code × simple` | `<작성>` | `<작성>` | `<작성>` |
| `code × complex` | `<작성>` | `<작성>` | `<작성>` |
| `translation × simple` | `<작성>` | `<작성>` | `<작성>` |
| `translation × complex` | `<작성>` | `<작성>` | `<작성>` |
| `summarization × simple` | `<작성>` | `<작성>` | `<작성>` |
| `summarization × complex` | `<작성>` | `<작성>` | `<작성>` |
| `reasoning × simple` | `<작성>` | `<작성>` | `<작성>` |
| `reasoning × complex` | `<작성>` | `<작성>` | `<작성>` |
| 한국어 | `<작성>` | `<작성>` | `<작성>` |
| 영어 | `<작성>` | `<작성>` | `<작성>` |
| 혼합 언어 | `<작성>` | `<작성>` | `<작성>` |

### 4.3 데이터 누출 감사 체크리스트

| 검사 | 기준 | 결과 | 근거 참조 |
|---|---|---|---|
| Split 간 promptFamily 중복 | `0` | `<PASS/FAIL; count>` | `<작성>` |
| 동일 family의 simple/complex 대비 쌍 분리 | `0` | `<PASS/FAIL; count>` | `<작성>` |
| 의역/동의어/언어 변형 분리 | `0` | `<PASS/FAIL; count>` | `<작성>` |
| Split 간 완전 중복 | `0` | `<PASS/FAIL; count>` | `<작성>` |
| Split 간 정규화 / 유사 중복 | `0` 또는 사전 승인 예외만 허용 | `<PASS/FAIL; count>` | `<작성>` |
| Decision boundary 배정 | 역할별 modelPath/empty/hard-sentinel count·family와 membership hash 동결 | `<PASS/FAIL>` | `<작성>` |
| 지원 경계 정답 | Exact match 100%, payload contamination 0 | `<PASS/FAIL>` | `<작성>` |
| Hard-sentinel 일치성 | B0 membership parity 100%; FP/precision/coverage 보고 | `<PASS/FAIL>` | `<작성>` |
| PCA 학습 범위 | 각 fold의 train-only | `<PASS/FAIL>` | `<작성>` |
| Semantic head 학습 범위 | 각 fold의 train-only | `<PASS/FAIL>` | `<작성>` |
| 12D stacking feature | LR train에는 cross-fitted OOF head probability 사용 | `<PASS/FAIL>` | `<작성>` |
| 후보별 calibrator 비교 | A/B/C 각각 validation family-grouped OOF | `<PASS/FAIL>` | `<작성>` |
| Threshold 선택 | Validation OOF calibrated score만 사용 | `<PASS/FAIL>` | `<작성>` |
| Test 후보 수 | 동결 후보 정확히 1개 | `<PASS/FAIL>` | `<작성>` |

데이터 누출 감사 결론: `<PASS / FAIL>`

## 5. 공통 실험 설정

### 5.1 고정 전처리와 encoder

| 설정 | 값 |
|---|---|
| Encoder 입력 | `instructionText`만 사용 |
| Payload 처리 | `<payload 구조 통계만; 상세 작성>` |
| Encoder 모델 | `<작성>` |
| 최대 token 길이 / truncation | `<현행 표준: 128 / 오른쪽 truncation>` |
| Pooling | `<masked mean pooling>` |
| Pre-PCA embedding normalization | `none` |
| PCA centering / solver / whitening | `center=true, svd_solver=full, whiten=false` |
| PCA output normalization | `L2, epsilon=1e-12` |
| Empty/meaningless sentinel | `<score 0.0 + simple 등>` |
| Hard-complex sentinel | `<score 1.0 + complex 등>` |
| Encoder/runtime failure fallback | `<rule difficulty 유지 등>` |

### 5.2 교차검증, seed 및 반복

| 설정 | 값 |
|---|---|
| 그룹 키 | `promptFamily` |
| 층화 기준 | `<category × difficulty 또는 사전 정의>` |
| Train 선별 CV | `5-fold StratifiedGroupKFold(shuffle=true, random_state=20260719)` |
| 후보 C stacking CV | `4-fold StratifiedGroupKFold(shuffle=true, random_state=20260720 + outerFoldIndex)` |
| Validation calibrator CV | `5-fold StratifiedGroupKFold(shuffle=true, random_state=20260721)` |
| 민감도 분석 seed | `<N/A 또는 결과 열람 전 고정한 값>` |
| 후보 공통 fold | `<PASS/FAIL>` |
| Bootstrap | `family-cluster, 10,000 resamples, seed 20260722` |
| 모델 RNG | `semantic heads=20260714, final LR=1729, Platt=1729` |
| Fold/software 고정 정보 | `<fold manifest SHA-256, sklearn/NumPy/BLAS/ONNX Runtime lock>` |
| 동률 허용 오차 | `log loss 및 Brier 차이 <= 1e-6` |

Seed 선택 원칙: 가장 좋은 seed 결과를 선택하지 않고, 주 seed로 후보를 선택한 뒤 민감도 분석 seed에서 결론 안정성만 확인한다.

### 5.3 요인 분리

| 비교 | 바꾸는 요인 | 반드시 고정하는 요인 |
|---|---|---|
| E1 | PCA 차원 | 고정 PCA pipeline, 후보 B 검증, 검증용 LR `C=10`, split, 5-fold manifest |
| E2 | Semantic-head 정규화 | 선택된 P, head label, fold |
| E3 × E4 | Feature 후보 / 최종 LR 정규화 | preprocessing, 선택된 P, head-generation rule, fold |
| E5 | 후보별 calibrator와 최종 base 후보 | A/B/C 후보군, 후보별 동결 raw model, Validation fold |
| E6 | threshold | 동결 model, 선택된 calibrator, OOF calibrated score |

## 6. G0 — Instruction/Payload 경계 검증

### 6.1 가설 및 설정

| 항목 | 값 |
|---|---|
| 가설 | `동결할 parser가 승인 label의 instruction/payload boundary를 재현하고 현행 parser보다 payload contamination을 악화시키지 않는다.` |
| 기준 | `<현재 parser 버전>` |
| 후보 | `<동일 버전 검증 또는 새 parser 버전>` |
| 대상 slice | `explicit boundary, ambiguous boundary, payload-only, empty instruction, payload_contamination` |
| 변경된 규칙 | `<집계 설명만 작성; prompt fragment 금지>` |

### 6.2 결과

| 지표 | 기준 | 후보 | 차이 | 통과 기준 | 결과 |
|---|---:|---:|---:|---|---|
| 지원 경계 exact-match accuracy | `<작성>` | `<작성>` | `<작성>` | `100%` | `<PASS/FAIL>` |
| 모호/미지원 입력의 강제 분리 방지 정확도 | `<작성>` | `<작성>` | `<작성>` | `100%` | `<PASS/FAIL>` |
| Payload 탐지 precision / recall | `<작성>` | `<작성>` | `<작성>` | `<분모와 사전 기준>` | `<PASS/FAIL>` |
| 지원 경계 payload contamination rate | `<작성>` | `<작성>` | `<작성>` | `0` | `<PASS/FAIL>` |
| 빈 instruction semantic-status/sentinel accuracy | `<작성>` | `<작성>` | `<작성>` | `100%` | `<PASS/FAIL>` |

결론: `<선택 parser와 근거>`

> Parser가 변경되면 기존 embedding cache, PCA, semantic heads, classifier, calibrator와 threshold 결과를 재사용하지 않는다.

### 6.3 Sentinel 및 Model-Path 동결

| 역할 | Model-path 비율 | Empty sentinel 표본 수/accuracy | Hard sentinel 표본 수 | Hard sentinel expected-simple FP 건수/비율 | Hard sentinel precision | Expected-complex coverage/recall | Membership 일치성/hash |
|---|---:|---|---:|---|---:|---|---|
| Train | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL; hash>` |
| Validation | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL; hash>` |
| Test | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<미열람; hash만>` |

## 7. E1 — PCA 차원

### 7.1 설정

| 항목 | 값 |
|---|---|
| 후보 차원 | `16, 32, 64, 96, 128` |
| 선택 CV | `Train 5-fold StratifiedGroupKFold(shuffle=true, random_state=20260719)` |
| 고정 PCA pipeline | `raw pooled → PCA(P, svd_solver=full, whiten=false) → L2(epsilon=1e-12)` |
| 학습 범위 | `각 CV fold의 train only` |
| 검증 후보 | `B = 42D + P` |
| 고정 검증용 LR | `L2 / liblinear / C=10 / fit_intercept=true / class_weight=None / max_iter=2000 / tol=1e-4 / random_state=1729` |
| 1차 선택 지표 | `downstream OOF log loss` |
| 선택 규칙 | `best mean log loss의 1-SE 범위 안에서 가장 작은 P` |
| 진단 지표 | `Brier score, explained variance ratio` |

### 7.2 결과

| P | 설명분산 진단값 | Train OOF log loss | Fold SE | Brier | PCA p95 지연시간 | Artifact 크기(bytes) | 비유한값 / 거의 0인 norm 건수 | 1-SE 집합 포함 여부 | 선택 여부 |
|---:|---:|---:|---:|---:|---:|---:|---|---|---|
| 16 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| 32 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| 64 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| 96 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| 128 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |

선택: `P=<작성>`

근거: `<작성>`

## 8. E2 — 4개 Semantic Head

### 8.1 설정

| 항목 | 값 |
|---|---|
| Head 종류 | `task, constraint, scope, dependency` |
| 출력 | `각 head 3-class softmax; 고정 순서 12D probability` |
| Label 출처 | `사람 검토로 승인된 semantic bucket label` |
| 분류기 | `multinomial Logistic Regression` |
| Penalty / solver | `L2 / lbfgs` |
| C 후보 | `0.01, 0.03, 0.1, 0.3, 1, 3, 10` |
| Class 가중치 | `None` |
| max_iter / tol | `2000 / 1e-4` |
| random_state | `20260714` |
| LR stacking 입력 | `cross-fitted OOF head probabilities` |
| 선택 규칙 | `최저 평균 log loss 후보의 mean + 1 SE 이내에서 평균 macro-F1 >= 기준 후보 평균 macro-F1 - 1e-6을 만족하는 가장 작은 C` |
| 무효 처리 규칙 | `한 fold라도 ConvergenceWarning이면 해당 C를 무효 처리` |

### 8.2 하이퍼파라미터 선택

| C | 4개 Head 평균 log loss | Fold SE | 평균 macro-F1 | 평균 multiclass Brier | 최고 복잡도 bucket recall | 수렴 여부 | 1-SE 범위 / 선택 여부 |
|---:|---:|---:|---:|---:|---:|---|---|
| 0.01 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<작성>` |
| 0.03 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<작성>` |
| 0.1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<작성>` |
| 0.3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<작성>` |
| 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<작성>` |
| 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<작성>` |
| 10 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<작성>` |

### 8.3 선택된 Head 성능

| Head | 3-class log loss | Macro-F1 | Multiclass Brier | ECE | 최고 복잡도 class recall | Class별 표본 수 | 통과 기준 |
|---|---:|---:|---:|---:|---:|---|---|
| Task | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<집계 건수>` | `<PASS/FAIL>` |
| Constraint | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<집계 건수>` | `<PASS/FAIL>` |
| Scope | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<집계 건수>` | `<PASS/FAIL>` |
| Dependency | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<집계 건수>` | `<PASS/FAIL>` |

4-head joint exact-match accuracy: `<작성>`

확률의 유한성·범위·합계 일치 여부: `<PASS/FAIL>`

언어/필수 slice 집계 참조: `<작성>`

선택 설정과 근거: `<작성>`

## 9. E3 — Feature 후보 기여도 비교(Ablation)

E3와 E4는 같은 fold에서 `feature candidate × Logistic Regression C` 공동 grid로 실행한다. 한 feature candidate에만 유리한 고정 `C`를 사용하지 않는다.

| 후보 | 입력 | 차원 | 최적 C | Train OOF log loss | Fold SE | Brier | 42D 대비 차이 | 후보군 재학습/수렴 여부 |
|---|---|---:|---:|---:|---:|---:|---:|---|
| A | `42D` | 42 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `기준` | `<예/아니요>` |
| B | `42D + P` | `<42+P>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` |
| C | `42D + P + 12D` | `<54+P>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` |

- PCA representation 증분 효과 A → B: `<작성>`
- Semantic heads 증분 효과 B → C: `<작성>`
- 동률 처리 적용 여부: `<작성>`
- Validation으로 전달한 후보군: `A / B / C` 또는 `<계약상 승인된 목록>`
- 최종 후보는 E5에서 후보별 확률 보정 뒤 선택하며 이 표에서 선택하지 않는다.

## 10. E4 — 최종 Logistic Regression

### 10.1 설정

| 항목 | 값 |
|---|---|
| 모델 | `binary Logistic Regression` |
| Penalty / solver | `L2 / liblinear` |
| C 후보 | `0.01, 0.03, 0.1, 0.3, 1, 3, 10` |
| fit_intercept | `true` |
| class_weight | `None` |
| max_iter / tol | `2000 / 1e-4` |
| random_state | `1729` |
| 선택 규칙 | `평균 log loss 최소 → 차이 <= 1e-6이면 Brier 최소 → 그래도 동률이면 더 작은 C` |
| 무효 처리 규칙 | `한 fold라도 미수렴이면 해당 C invalid` |

### 10.2 결과

아래 표는 후보 A/B/C 각각에 대해 7개 C를 모두 기록해 총 21개 조합을 남긴다.

| Feature 후보 | C | 평균 OOF log loss | Fold SE | Brier | 최대 n_iter | 경고 fold 수 | 유효 여부 | 후보 내 C 선택 여부 |
|---|---:|---:|---:|---:|---:|---:|---|---|
| A | 0.01 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| A | 0.03 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| A | 0.1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| A | 0.3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| A | 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| A | 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| A | 10 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| B | 0.01 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| B | 0.03 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| B | 0.1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| B | 0.3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| B | 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| B | 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| B | 10 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| C | 0.01 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| C | 0.03 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| C | 0.1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| C | 0.3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| C | 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| C | 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| C | 10 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |

| 후보 | 선택 C | 최종 재학습 수렴 / n_iter | Coefficient 유한성 | 예상 차원 일치 | 후보군 artifact hash |
|---|---:|---|---|---|---|
| A | `<작성>` | `<PASS/FAIL; n_iter>` | `<PASS/FAIL>` | `<42D; PASS/FAIL>` | `<작성>` |
| B | `<작성>` | `<PASS/FAIL; n_iter>` | `<PASS/FAIL>` | `<42+P; PASS/FAIL>` | `<작성>` |
| C | `<작성>` | `<PASS/FAIL; n_iter>` | `<PASS/FAIL>` | `<54+P; PASS/FAIL>` | `<작성>` |

선택 설정과 근거: `<작성>`

## 11. E5 — 확률 보정(Calibration)

### 11.1 절차

| 항목 | 값 |
|---|---|
| Base 후보군 | `<A/B/C artifact hash>` |
| Calibrator 입력 | `<active contract의 raw_probability>` |
| CV | `Validation 5-fold StratifiedGroupKFold(shuffle=true, random_state=20260721)` |
| 후보 | `Platt, exact-PAVA Isotonic` |
| Calibrator 선택 규칙 | `후보 내부 평균 OOF log loss 최소 → 차이 <= 1e-6이면 Brier 최소 → 그래도 동률이면 Platt` |
| 최종 base 후보 선택 규칙 | `선택된 calibrator의 OOF log loss 최소 → 차이 <= 1e-6이면 Brier 최소 → 그래도 동률이면 더 낮은 차원` |
| Isotonic 조회 규칙 | `inclusive-lower floor lookup; x 범위 밖은 양끝 y로 clip; interpolation 없음` |
| Isotonic 가중 방식 | `exact-tie aggregation + sample-count weighting` |
| 사용하지 않는 heuristic | `score rounding, epsilon grouping, post-hoc small-block merge, 임의 0.01~0.99 clipping/smoothing을 사용하지 않음` |

### 11.2 후보별 결과

| Base 후보 | 차원 | Calibrator | 설정 | 평균 OOF log loss | Brier | 학습/검증 실패 | 후보별 calibrator 선택 여부 | 최종 base 선택 여부 |
|---|---:|---|---|---:|---:|---|---|---|
| A | 42 | Platt | `L2/lbfgs, C=1e6, max_iter=2000, random_state=1729` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| A | 42 | Isotonic | `exact PAVA` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| B | `<42+P>` | Platt | `L2/lbfgs, C=1e6, max_iter=2000, random_state=1729` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| B | `<42+P>` | Isotonic | `exact PAVA` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| C | `<54+P>` | Platt | `L2/lbfgs, C=1e6, max_iter=2000, random_state=1729` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |
| C | `<54+P>` | Isotonic | `exact PAVA` | `<작성>` | `<작성>` | `<작성>` | `<예/아니요>` | `<예/아니요>` |

### 11.3 Isotonic 진단

Isotonic이 선택되지 않아도 A/B/C별 비교 후보 진단을 집계값으로 기록한다. 실제 score 경곗값은 기록하지 않는다.

| Base 후보 | Fold / 전체 학습 | 블록 수 | 최소 블록 표본 수 | 최대 블록 표본 수 | 극단 출력 집계 비율 | 경고 |
|---|---|---:|---:|---:|---:|---|
| A | Fold 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| A | Fold 2 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| A | Fold 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| A | Fold 4 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| A | Fold 5 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| A | 전체 Validation 학습 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| B | Fold 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| B | Fold 2 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| B | Fold 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| B | Fold 4 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| B | Fold 5 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| B | 전체 Validation 학습 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| C | Fold 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| C | Fold 2 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| C | Fold 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| C | Fold 4 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| C | Fold 5 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| C | 전체 Validation 학습 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 11.4 보정 결과 집계 구간

| 구간 ID | 표본 수 | 평균 최종 ComplexityScore | 관측 complex 비율 | 절대 차이 |
|---|---:|---:|---:|---:|
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

선택 base 후보 / calibrator와 근거: `<작성>`

## 12. E6 — 전역 임곗값(Threshold)

### 12.1 선택 절차

| 항목 | 값 |
|---|---|
| 점수 출처 | `E5에서 선택된 candidate–calibrator 조합의 Validation family-grouped OOF calibrated score` |
| 후보 규칙 | `사전 고정 0.000~1.000, step 0.001 grid; score-derived 후보 추가 금지` |
| 경계값 포함 판정 | `ComplexityScore >= threshold → complex` |
| 목적 함수 | `constrained accuracy; 실제 비용비가 사전 승인된 경우에만 expected decision loss로 변경` |
| FN cost / FP cost | `기본 선택에는 N/A; 민감도 분석은 C_FP=1, C_FN={1,3,5,10}` |
| 안전성 제약 | `전체 및 각 category에서 C1 complex → simple <= min(B0 규칙, B1 현행 모델)` |
| 동률 처리 | `accuracy 최대 → simple → complex(FP) 최소 → 더 낮은 threshold` |
| Bootstrap 안정성 | `family-cluster 10,000회, seed=20260722` |

### 12.2 후보 요약

모든 후보를 나열할 필요는 없다. 선택값, 인접 경쟁값과 사전 기준 threshold만 집계값으로 기록한다.

| Threshold | 정확도 | FN 건수 / 비율 | FP 건수 / 비율 | 기대 손실 | 안전성 통과 여부 | 선택 비고 |
|---:|---:|---|---|---:|---|---|
| `<기준 threshold>` | `<작성>` | `<작성>` | `<작성>` | `<작성/N/A>` | `<예/아니요>` | `기준` |
| `<아래 인접 후보>` | `<작성>` | `<작성>` | `<작성>` | `<작성/N/A>` | `<예/아니요>` | `<작성>` |
| `<선택값>` | `<작성>` | `<작성>` | `<작성>` | `<작성/N/A>` | `<예/아니요>` | `선택` |
| `<위 인접 후보>` | `<작성>` | `<작성>` | `<작성>` | `<작성/N/A>` | `<예/아니요>` | `<작성>` |

### 12.3 비용 민감도 분석

기본 threshold 선택에는 사용하지 않는다. 제품 책임자가 실제 비용비를 사전 승인한 경우에만 해당 승인값을 1차 목적에 적용한다.

| C_FP | C_FN | 안전성 제약 내 최적 threshold | 기대 손실 | Accuracy | FN 건수/비율 | FP 건수/비율 | 손익분기 FP/FN 비율 |
|---:|---:|---:|---:|---:|---|---|---:|
| 1 | 1 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 1 | 3 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 1 | 5 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| 1 | 10 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 12.4 Threshold 안정성

| 통계량 | 값 |
|---|---|
| 선택 threshold | `<작성>` |
| Family-bootstrap 중앙값 | `<작성>` |
| Family-bootstrap 95% 구간 | `<작성>` |
| 허용 오차 내 선택 빈도 | `<작성>` |
| 안정성 평가 | `<안정 / 불안정 / 근거 부족>` |

## 13. Test 열람 전 산출물(Artifact) 동결

| 동결 항목 | 값 / hash | 검증 역할 | 상태 |
|---|---|---|---|
| Feature 후보 | `<작성>` | `<역할>` | `<PASS/FAIL>` |
| Encoder / tokenizer | `<작성>` | `<역할>` | `<PASS/FAIL>` |
| PCA | `<작성>` | `<역할>` | `<PASS/FAIL>` |
| 4개 Semantic Head | `<작성>` | `<역할>` | `<PASS/FAIL>` |
| 최종 Logistic Regression | `<작성>` | `<역할>` | `<PASS/FAIL>` |
| Calibrator | `<작성>` | `<역할>` | `<PASS/FAIL>` |
| 전역 threshold | `<작성>` | `<역할>` | `<PASS/FAIL>` |
| Sentinel policy | `<작성>` | `<역할>` | `<PASS/FAIL>` |
| Python–Go golden parity | `<근거 참조>` | `<역할>` | `<PASS/FAIL>` |
| 평가 command/config | `<작성>` | `<역할>` | `<PASS/FAIL>` |

Test 열람 승인 시각: `<작성>`

승인 전 Test score/model 실행·열람 여부: `<없음이어야 함>`

## 14. 최종 대응 Test 평가

### 14.1 통계 방법

| 항목 | 값 |
|---|---|
| Test 역할 | `모든 설정이 동결된 후보 1개의 일회성 최종 평가` |
| 대응 비교 단위 | `동일 record에서 B0 규칙, B1 현행 모델, C1 동결 후보 비교` |
| Cluster 단위 | `promptFamily` |
| Bootstrap 재표집 횟수 | `10,000` |
| 신뢰수준 | `95%` |
| Bootstrap seed | `20260722` |
| 선택 McNemar 검정 | `<N/A 또는 exact p-value; 보조 지표>` |
| 검정력 / MDE 평가 | `<사전 계산 참조와 결론>` |

### 14.2 전체 결과

| 지표 | 모집단 | B0 규칙 | B1 현행 모델 | C1 후보 | C1-B1 차이 | 95% family-bootstrap CI | 판정 기준 | 결과 |
|---|---|---:|---:|---:|---:|---|---|---|
| Difficulty accuracy | End-to-end | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `C1-B1 >= +1.0%p이고 CI 하한 > 0` | `<PASS/FAIL>` |
| Category accuracy | End-to-end | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `B1 비악화` | `<PASS/FAIL>` |
| Joint routing-label accuracy | End-to-end | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `B1 비악화` | `<PASS/FAIL>` |
| Complex → simple count | End-to-end | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `C1 <= min(B0,B1)` | `<PASS/FAIL>` |
| Complex → simple rate | Expected complex | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `C1 <= min(B0,B1)` | `<PASS/FAIL>` |
| Simple → complex count | End-to-end | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<사전 기준>` | `<PASS/FAIL>` |
| Simple → complex rate | Expected simple | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<사전 기준>` | `<PASS/FAIL>` |
| Log loss | Model path만 | `N/A` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `B1 비악화` | `<PASS/FAIL>` |
| Brier score | Model path만 | `N/A` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `B1 비악화` | `<PASS/FAIL>` |
| Expected decision loss | End-to-end | `<작성/N/A>` | `<작성/N/A>` | `<작성/N/A>` | `<작성/N/A>` | `<작성/N/A>` | `<작성/N/A>` | `<PASS/FAIL/N/A>` |

### 14.3 Oracle Category와 End-to-End 비교

| 평가 경로 | 표본 수 | 정확도 | Complex → simple 건수/비율 | Simple → complex 건수/비율 |
|---|---:|---:|---|---|
| Oracle 정답 category를 사용한 difficulty | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Runtime 실제 category를 사용한 difficulty | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Category 불일치로 인한 difficulty 차이 | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 14.4 Sentinel 및 Model-Path 비율

| 경로 | 표본 수 | 비율 | 정확도 | Complex → simple 건수 | 실패/fallback 건수 |
|---|---:|---:|---:|---:|---:|
| Empty/meaningless simple sentinel | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Hard-complex sentinel | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| Logistic model path | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

## 15. Category 및 필수 Slice 안전성

### 15.1 Category별

| Category | Simple n | Complex n | B0 FN 건수/비율 | B1 FN 건수/비율 | C1 FN 건수/비율 | B1 FP 건수/비율 | C1 FP 건수/비율 | C1 FN ≤ min(B0,B1) | 근거 상태 |
|---|---:|---:|---|---|---|---|---|---|---|
| General | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<sufficient/insufficient>` |
| Code | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<sufficient/insufficient>` |
| Translation | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<sufficient/insufficient>` |
| Summarization | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<sufficient/insufficient>` |
| Reasoning | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` | `<sufficient/insufficient>` |

### 15.2 필수 평가 Slice

| Slice | 전체 n | Simple n | Complex n | B1 현행 모델 accuracy | C1 후보 accuracy | B1 FN | C1 FN | 결과 / 근거 상태 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| `negation` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| `indirect_expression` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| `synonym` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| `short_complex` | `<작성>` | `0` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| `long_simple` | `<작성>` | `<작성>` | `0` | `<작성>` | `<작성>` | `N/A` | `N/A` | `<작성>` |
| `payload_contamination` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| `korean` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| `english` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| `mixed_language` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| `category_confusion` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |
| `ood_terminology` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

표본이 부족한 slice는 개선으로 간주하지 않고 `근거 부족(insufficient evidence)`으로 기록한다.

## 16. 런타임 및 운영 보호 기준

### 16.1 측정 절차

| 항목 | 값 |
|---|---|
| 런타임 build / artifact hash | `<작성>` |
| 하드웨어 | `<작성>` |
| Warm-up 반복 횟수 | `<작성>` |
| 측정 반복 / 배치 수 | `<작성>` |
| 입력 길이 분포 | `<집계 p50/p95 token 또는 rune 수>` |
| 동시성 / thread 수 | `<작성>` |
| 실제 설정 timeout | `<작성; default를 자동 가정하지 않음>` |
| Latency 측정 절차 | `<권장: batch1, worker1, warm-up100, measured>=1000>` |
| Stress 측정 절차 | `<권장: worker1/queue4, concurrency 1/4/8, 각 5분, 고정 도착 패턴>` |
| 포함 단계 | `<tokenizer/encoder/PCA transform/heads/LR/calibrator 등>` |
| 제외 단계 | `<file I/O/report serialization 등>` |

### 16.2 결과

| 지표 | 기준 모델 | 후보 | 차이 | 허용 예산 | 결과 |
|---|---:|---:|---:|---:|---|
| 분류 latency p50 | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| 분류 latency p95 | `<작성>` | `<작성>` | `<작성>` | `B1 대비 +10% 이내` | `<PASS/FAIL>` |
| 분류 latency p99 | `<작성>` | `<작성>` | `<작성>` | `run manifest의 실제 configured timeout 미만` | `<PASS/FAIL>` |
| 분류 latency max | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| 처리량(throughput) | `<작성>` | `<작성>` | `<작성>` | `B1 대비 -10% 이내` | `<PASS/FAIL>` |
| 모델 load 시간 | `<작성/N/A>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Peak RSS / 메모리 차이 | `<작성/N/A>` | `<작성>` | `<작성>` | `B1 대비 +10% 이내` | `<PASS/FAIL>` |
| 통합 artifact 크기 | `<작성/N/A>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Encoder/runtime 실패율 | `<작성/N/A>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Busy 발생률 | `<작성/N/A>` | `<작성>` | `<작성>` | `B1 비악화` | `<PASS/FAIL>` |
| Timeout 발생률 | `<작성/N/A>` | `<작성>` | `<작성>` | `B1 비악화` | `<PASS/FAIL>` |
| Rule fallback 성공률 | `<작성/N/A>` | `<작성>` | `<작성>` | `<작성>` | `<PASS/FAIL>` |
| Request-local fallback 실패율 | `<작성/N/A>` | `<작성>` | `<작성>` | `0` | `<PASS/FAIL>` |
| Python–Go label mismatch 건수 | `<작성/N/A>` | `<작성>` | `<작성>` | `0` | `<PASS/FAIL>` |
| 비유한/범위 밖 score 수 | `<작성/N/A>` | `<작성>` | `<작성>` | `0` | `<PASS/FAIL>` |

## 17. 소비된 Test 기록

| 데이터셋 버전 | Test 역할 | Split/artifact hash | 열람 시각 | 동결 후보 hash | 목적 | 결과 참조 | 소비 여부 | 향후 튜닝 사용 가능 여부 |
|---|---|---|---|---|---|---|---|---|
| `<작성>` | 최종 Test | `<작성>` | `<작성 또는 미열람>` | `<작성>` | `일회성 최종 근거` | `<작성>` | `<예/아니요>` | `<소비 시 아니요>` |

Test 소비 선언:

`<이 Test 결과를 확인한 뒤 feature, model, calibrator, threshold, parser 또는 sentinel policy를 변경하면 새 run ID와 새로운 독립 미열람 Test 데이터가 필요하다는 점을 명시>`

## 18. 계획 대비 변경 및 한계

### 18.1 실험 절차 변경 사항

| 계획된 절차 | 실제 실행 | 사유 | 편향 / 영향 | 보완 조치 | 승인 역할 |
|---|---|---|---|---|---|
| `<작성 또는 없음>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` | `<작성>` |

### 18.2 알려진 한계

- 데이터셋 출처 / 대표성: `<synthetic, redacted, human-review 범위와 한계>`
- Production 분포 불일치: `<balanced evaluation과 실제 traffic 분포 차이>`
- 통계적 검정력: `<검출 가능한 최소 개선폭과 부족한 segment>`
- Category classifier 의존성: `<oracle와 end-to-end 차이>`
- Calibration 해석: `<평가 모집단에서의 확률 의미와 distribution drift 위험>`
- Runtime 환경: `<측정 hardware와 production 차이>`
- 기타: `<작성>`

이 결과만으로 product GA, release 완료 또는 전체 production readiness를 선언하지 않는다.

## 19. GO / NO-GO 통과 기준 검토

| 통과 기준 | 사전 기준 | 관찰 결과 | 상태 |
|---|---|---|---|
| 데이터셋 학습 적격성 | 모든 포함 family의 사람 검토·승인 및 manifest 통과 기준 충족 | `<작성>` | `<PASS/FAIL>` |
| Contract 승인 | 후보 shape, Train 선별, Validation 최종 선택 policy가 versioned contract로 승인됨 | `<작성>` | `<PASS/FAIL>` |
| Tooling/runtime 지원 | 선택된 shape의 artifact/schema/verifier/codegen/parity 지원 또는 offline-only 명시 | `<작성>` | `<PASS/FAIL/N/A>` |
| Split 누출 | Split 간 family/duplicate leakage 0 | `<작성>` | `<PASS/FAIL>` |
| Parser 통과 기준 | G0 acceptance 충족 | `<작성>` | `<PASS/FAIL>` |
| 학습 수렴 | 선택 모델과 final refit warning 없음 | `<작성>` | `<PASS/FAIL>` |
| Score 유효성 | finite, inclusive `0.0~1.0` | `<작성>` | `<PASS/FAIL>` |
| Python–Go parity | Golden parity acceptance 충족 | `<작성>` | `<PASS/FAIL>` |
| 전체 accuracy | `C1-B1 >= +1.0%p이고 paired family-bootstrap 95% CI 하한 > 0` | `<작성>` | `<PASS/FAIL>` |
| 전체 complex → simple | C1이 B0와 B1 중 더 엄격한 기준 모델보다 증가하지 않음 | `<작성>` | `<PASS/FAIL>` |
| Category별 complex → simple | 5개 category 각각 C1이 `min(B0,B1)` 비악화 | `<작성>` | `<PASS/FAIL>` |
| Calibration | 사전 log loss/Brier 선택 정책 충족 | `<작성>` | `<PASS/FAIL>` |
| Runtime latency/메모리 | 사전 budget 충족 | `<작성>` | `<PASS/FAIL>` |
| Runtime 실패/fallback | 사전 budget 충족 | `<작성>` | `<PASS/FAIL>` |
| Test 무결성 | 동결 전 Test score access 0, 단일 candidate 1회 | `<작성>` | `<PASS/FAIL>` |

필수 통과 기준 하나라도 실패하면 최종 판단은 `NO-GO`다. 표본 부족으로 우월성을 판단할 수 없으면 `NO-GO — 근거 부족(insufficient evidence)`으로 기록하고 새로운 독립 미열람 Test 데이터를 준비한다.

## 20. 최종 승인

### 20.1 최종 결정

- [ ] `GO — 승인된 offline replay 또는 배포 관찰 contract 준비 승인`
- [ ] `GO — runtime 승격 검토 승인`
- [ ] `NO-GO — 수정 후 새 근거 실험 필요`
- [ ] `NO-GO — 근거 부족; 새로운 독립 미열람 Test 데이터 필요`

최종 사유: `<작성>`

### 20.2 역할별 승인

개인 식별정보 대신 승인 역할과 승인 근거 참조를 기록한다.

| 승인 역할 | 결정 | 날짜 | 근거 / 승인 참조 | 조건 |
|---|---|---|---|---|
| 데이터셋 담당자 | `<승인/반려>` | `<작성>` | `<작성>` | `<작성>` |
| 모델/평가 담당자 | `<승인/반려>` | `<작성>` | `<작성>` | `<작성>` |
| Gateway/runtime 담당자 | `<승인/반려>` | `<작성>` | `<작성>` | `<작성>` |
| 보안/개인정보보호 검토자 | `<승인/반려/N/A>` | `<작성>` | `<작성>` | `<작성>` |

## 21. 재현 참조

| 항목 | 참조 |
|---|---|
| 학습 command/config | `<작성>` |
| 평가 command/config | `<작성>` |
| CV 집계 리포트 | `<작성>` |
| Calibration/threshold 집계 리포트 | `<작성>` |
| Test 집계 리포트 | `<작성>` |
| Runtime benchmark 리포트 | `<작성>` |
| Parity test 리포트 | `<작성>` |

모든 참조는 불변 artifact 또는 commit에 연결한다. 이 섹션에도 금지 데이터나 per-sample score를 복사하지 않는다.
