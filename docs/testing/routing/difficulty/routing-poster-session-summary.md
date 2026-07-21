# GateLM 라우팅 프로젝트 포스터 세션 정리

| 항목 | 내용 |
|---|---|
| 문서 목적 | 졸업 프로젝트·연구 논문 포스터 세션용 라우팅 연구 요약 |
| 기준일 | 2026-07-22 |
| 작업 기준 | `feat/routing-model` 작업 브랜치와 현재 로컬 실험 산출물 |
| 주의 | 신규 15,000건은 `training_eligible=false`인 candidate corpus이며 기존 모델 학습에 사용하지 않음 |

## 1. 추천 포스터 제목

### GateLM: 의미 기반 프롬프트 난이도 분류를 활용한 LLM 라우팅 시스템

부제:

> 규칙 기반 분류에서 384차원 의미 임베딩과 경량 머신러닝 모델로의 발전

연구 질문:

> 사용자 프롬프트의 난이도를 낮은 지연시간으로 분류하면서, 복잡한 요청을 단순 요청으로 오분류하는 under-routing을 최소화할 수 있는가?

## 2. 포스터에서 전달할 핵심 이야기

GateLM은 사용자 요청을 분석하여 적절한 LLM 후보로 전달하는 Gateway다. 모든 요청을 고성능 모델로 보내면 비용이 증가하고, 모든 요청을 저비용 모델로 보내면 복잡한 요청의 응답 품질이 낮아질 수 있다.

본 프로젝트에서는 다음 순서로 라우팅 분류기를 발전시켰다.

```text
규칙 기반 난이도 분류
→ multilingual-E5 384D 의미 임베딩 도입
→ Logistic Regression 입력 구조·보정 방식 비교
→ 106D Logistic Regression의 Gateway 적용
→ LightGBM 입력 차원·표현 비교
→ LightGBM 하이퍼파라미터 및 threshold 후속 실험
```

현재 개발 스냅샷의 권위 난이도 모델은 `42D 규칙 특징 + 64D 의미 특징`을 사용하는 106D Logistic Regression이다. LightGBM은 일부 작은 offline 실험에서 높은 성능을 보였지만 최종 승격 근거는 아직 완성되지 않았다.

## 3. 추천 포스터 레이아웃

### 왼쪽 열: 문제 정의와 데이터

- LLM 라우팅이 필요한 이유
- GateLM의 Category × Difficulty 구조
- 신규 15,000건 candidate corpus 구축
- 데이터 검수 상태와 사용 제한

### 가운데 열: 방법론

- 384D 임베딩 생성 과정
- 규칙 기반 baseline
- Logistic Regression 6개 설정 비교
- LightGBM 입력 표현·차원 실험
- LightGBM 하이퍼파라미터 탐색

### 오른쪽 열: 결과와 결론

- 현재 권위 모델 선정 근거
- 최종 Test 성능과 latency
- LightGBM의 가능성과 불확실성
- 한계 및 향후 연구

## 4. GateLM 라우팅 구조

```text
사용자 Prompt
  ↓
공통 특징 추출
  ↓
Category 분류
general / code / translation / summarization / reasoning
  ↓
Difficulty 분류
simple / complex
  ↓
5 Category × 2 Difficulty 라우팅 행렬
  ↓
적합한 LLM 후보와 fallback 선택
```

Category는 현재 규칙 기반이다. Difficulty는 empty·hard-complex sentinel을 제외한 model-path 요청에서 106D Logistic Regression 결과를 사용한다. 분류 결과는 5×2 routing matrix의 cell을 선택하는 데 사용한다.

관련 근거:

- [GateLM Routing Classification Pipeline](../../../routing/classification-pipeline.md)
- [GateLM Active Routing Contract](../../../routing/README.md)

## 5. 신규 15,000건 데이터 구축

### 5.1 데이터의 역할

신규 15,000건은 기존 `docs/v2.1.0`의 Dataset 1·2가 아닌 별도의 version-independent routing data work area에서 구축한 데이터다.

이 데이터는 아직 다음 상태다.

- `human_reviewed=false`
- `production_gold=false`
- `training_eligible=false`
- 기존 Logistic Regression 또는 LightGBM 성능 수치의 학습 데이터가 아님

따라서 포스터에서는 **차세대 모델 학습을 위한 candidate corpus 구축 결과**로 설명한다.

### 5.2 데이터 구성

| 구성 | 수량 | 목적 |
|---|---:|---|
| 공개 프롬프트 | 7,000 | 실제 사람이 사용하는 표현과 다양한 질의 형식 확보 |
| 기업 업무형 합성 | 6,000 | GateLM이 목표로 하는 사내 업무 분포 보강 |
| 경계·반례 | 2,000 | 길이·코드·전문 용어 등 표면 특징 편향 방지 |
| 합계 | 15,000 | Simple/Complex 난이도 분류 candidate corpus |

### 5.3 공개 프롬프트 수집

라이선스, provenance, 익명 접근성과 Prompt 필드 추출 가능성을 확인한 뒤 다음 source를 조합했다.

| Source | 채택 수량 | 주요 성격 |
|---|---:|---|
| OpenAssistant | 1,449 | 사람이 작성한 prompter message |
| KLUE | 142 | 한국어 질문 필드만 사용 |
| KITE | 154 | 한국어 instruction |
| Aya | 387 | 사람 annotation input |
| Dolly 15k | 607 | 직원 작성 instruction/context |
| KULLM-v2 Dolly subset | 3,100 | Dolly 계보 한국어 번역 instruction |
| HRM8K KSM | 979 | 사람 검수 수학 question |
| K2-Eval | 55 | handwritten instruction |
| HAE-RAE BENCH 2.0 | 127 | 한국어 benchmark question |
| 합계 | 7,000 | 9개 공개 source |

수집·정제 과정은 다음과 같다.

```text
공식 배포본 확보
→ 라이선스와 immutable revision 고정
→ user Prompt 필드만 추출
→ system/assistant/tool 응답 제거
→ 개인정보·secret·형식 오류 검사
→ 무의미한 입력 제거
→ exact/normalized/near-duplicate 제거
→ 언어·업무 유형·서비스 도메인 분류
→ 후보 난이도 라벨 부여
→ 독립 리뷰 및 사람 adjudication queue 생성
```

### 5.4 합성 및 경계 데이터

기업 업무형 합성 데이터 6,000건은 사내 정책, 문서 작성, 코드, 데이터 분석, 고객 지원, 보안, 법무, 프로젝트 관리 등 GateLM의 목표 업무 분포를 보강한다.

경계·반례 2,000건은 다음과 같은 잘못된 단축 규칙을 학습하지 않도록 설계했다.

- 코드가 있으면 항상 Complex
- Prompt가 길면 항상 Complex
- JSON 출력을 요구하면 항상 Complex
- 전문 용어가 많으면 항상 Complex
- 영어 또는 한영 혼합이면 Complex

대표 반례:

- 길지만 Simple / 짧지만 Complex
- 코드가 있지만 Simple / 코드가 없어도 Complex
- 조건은 많지만 기계적인 Simple
- 긴 문서의 단순 번역·복사·형식 변환
- 짧은 입력의 전문적 인과 분석
- 검색이 필요한 단순 사실 조회
- 검색 없이 수행하는 복잡한 논리 판단

### 5.5 다양성

| 항목 | 현재 구성 |
|---|---:|
| 한국어 | 12,000 |
| 영어 | 2,250 |
| 한영 혼합 | 750 |
| 언어 비율 | 80:15:5 |
| 작업 유형 | 23개 |
| 서비스 도메인 | 23개 |
| 합성·경계 group | 1,752개 |
| 공개 데이터 group | 7,000개 |
| split 간 group overlap | 0 |

### 5.6 라벨 검수 현황

초기 자동 라벨은 Simple 7,500 / Complex 7,500으로 설계했다. Reviewer B/C와 Codex advisory를 반영한 현재 검토용 revision의 후보 라벨은 다음과 같다.

| 상태 | 수량 |
|---|---:|
| 현재 Simple 후보 | 9,358 |
| 현재 Complex 후보 | 5,642 |
| `needs_adjudication` | 2,249 |
| `pending` | 12,751 |
| 사람 검수 완료 | 0 |

공개 7,000건 중 사람 원문 기원은 6,873건이지만 최종 Prompt를 직접 사람이 작성했다고 확인된 데이터는 2,674건이다. 60% 목표까지 1,526건이 부족하며, 익명 접근과 재배포가 승인된 실제 서비스 사용자 Prompt는 현재 0건이다.

정확·정규화 중복은 0건이지만 최신 advisory revision에는 cosine `0.985` 기준 의미 중복 후보 6쌍이 남아 있다. 따라서 포스터에는 “중복 완전 제거” 대신 **정확·정규화 중복 제거 완료, 의미 중복 후보 재검토 중**으로 표시한다.

관련 근거:

- [15,000건 데이터셋 구축 계획](../../../routing/datasets/difficulty/README.md)
- [현재 15,000건 candidate manifest](../../../routing/datasets/difficulty/data/initial-routing-difficulty-15000.codex-advisory-revised.manifest.json)
- [독립 LLM 리뷰 절차](../../../routing/datasets/difficulty/independent-llm-review.md)

포스터 상태 배지 권장 문구:

> 15,000 Candidate Prompts — Human Review Pending / Not Used for Training

## 6. 384D 의미 임베딩

### 6.1 Native embedding 생성

```text
정제된 instruction text
  ↓
"query: " prefix 추가
  ↓
Hugging Face Tokenizer
special token 포함, max length 128
  ↓
input_ids + attention_mask (+ token_type_ids)
  ↓
multilingual-e5-small dynamic-QInt8 ONNX
  ↓
last_hidden_state [1, sequence, 384]
  ↓
attention-mask mean pooling
  ↓
Prompt 의미 표현 float32[384]
```

Attention-mask mean pooling은 mask가 `1`인 유효 token의 hidden state만 합산한 뒤 유효 token 수로 나눈다. Padding token은 평균에서 제외한다.

포스터 표현:

> Gateway-compatible encoder의 native 출력은 Prompt의 의미를 표현하는 384차원 벡터다.

### 6.2 현재 106D Logistic Regression 입력

현재 권위 난이도 모델은 pooled 384D를 그대로 사용하지 않는다.

```text
384D pooled embedding
→ Train-only PCA
→ L2-normalized 64D 의미 특징

64D 의미 특징 + 42D 규칙 특징
→ 최종 106D Logistic Regression 입력
```

PCA는 Train embedding만으로 fit하며 Validation과 Test에는 transform만 적용한다. Prompt별 token, hidden state, 384D embedding, PCA vector와 개별 score는 API, 로그, metric 또는 report에 저장하지 않는다.

관련 근거:

- [E5 Encoder Contract](../../../routing/difficulty-e5-encoder.md)
- [Difficulty Feature Vector v1](../../../routing/difficulty-feature-vector-v1.md)

## 7. 모델 비교 실험

서로 다른 데이터 규모의 실험을 직접 동일 순위표로 합치지 않는다.

- 초기 공통 실험: owner-approved 500건, Train 300 / Validation 100 / Test 100
- 현재 권위 LR 실험: model-path 5,000건, Train 3,000 / Validation 1,000 / Test 1,000
- 신규 15,000건: 아직 학습에 사용하지 않음

## 8. 규칙 기반 모델 Baseline

규칙 기반 모델은 Prompt 길이, 작업 수, 제약 수, scope, 의존 깊이, 코드·도구·검증 요구와 category별 난이도 evidence를 사용한다.

장점:

- 매우 빠름
- 판단 근거를 설명하기 쉬움
- 모델·encoder 장애 시 fallback 가능
- 명백한 empty 또는 hard-complex 요청을 결정론적으로 처리

owner-approved 500건의 초기 holdout 결과:

| 지표 | 값 |
|---|---:|
| Accuracy | 86% |
| Complex → Simple FN | 10 |
| Simple → Complex FP | 4 |

규칙 기반 모델은 최종 경쟁 모델이라기보다 **속도·설명 가능성·장애 대응을 위한 안전 baseline**으로 해석한다.

## 9. Logistic Regression 실험

### 9.1 6개 설정

세 입력 구조와 두 calibrator를 조합한 총 6개 설정을 비교했다.

| 입력 구조 | 차원 | Calibrator |
|---|---:|---|
| 규칙 특징 | 42D | Platt / Isotonic |
| 규칙 42D + PCA 의미 특징 64D | 106D | Platt / Isotonic |
| 106D + semantic-head 확률 12D | 118D | Platt / Isotonic |

공통 실험 요소:

- L2 Logistic Regression
- `liblinear` solver
- `C ∈ {0.01, 0.03, 0.1, 0.3, 1, 3, 10}`
- family-group 5-fold CV
- Platt와 Isotonic calibration 비교
- Validation에서 threshold 선택
- feature·calibrator·threshold 동결 후 Test 1회 평가

### 9.2 model-path 5,000 Validation 결과

| 설정 | Joint Acc | Difficulty Acc | Complex F1 | FN |
|---|---:|---:|---:|---:|
| 42D + Platt | 51.8% | 85.2% | 84.49% | 96 |
| 42D + Isotonic | 51.4% | 84.8% | 83.97% | 101 |
| 106D + Platt | **59.8%** | **98.4%** | 98.41% | **5** |
| 106D + Isotonic | 59.8% | 98.4% | 98.40% | 6 |
| 118D + Platt | 59.7% | 98.3% | 98.28% | 13 |
| 118D + Isotonic | 59.4% | 98.3% | 98.29% | 9 |

### 9.3 선정된 LR 설정

```text
Feature: 42D rule + PCA 64D = 106D
Model: L2 Logistic Regression / liblinear
C: 10
Calibrator: Platt
Threshold: 0.096
```

선정 우선순위:

1. Validation joint routing accuracy
2. `Complex → Simple` FN 최소화
3. Balanced Accuracy
4. MCC
5. 성능이 비슷하면 낮은 입력 차원
6. 단순한 calibrator

관련 근거:

- [Logistic Training Contract](../../../routing/difficulty-logistic-training.md)
- [model-path 5,000 최종 보고서](../../../../reports/routing-difficulty-model/20260716-model-path-5000/REPORT.md)

## 10. 현재 권위 LR 모델의 최종 성능

Test 1,000건 결과:

| 지표 | 값 |
|---|---:|
| Difficulty Accuracy | **97.8%** |
| Balanced Accuracy | **97.75%** |
| Complex Precision | 96.81% |
| Complex Recall | **99.04%** |
| Complex F1 | 97.91% |
| Complex → Simple FN | **5** |
| Brier Score | 0.0126 |
| ECE | 0.0073 |
| Category Accuracy | 63.7% |
| Joint Routing Accuracy | 62.6% |
| Joint Accuracy 95% CI | 59.1–65.9% |

모델 경로 latency:

| Percentile | 지연시간 |
|---|---:|
| p50 | 29.1 ms |
| p95 | 41.6 ms |
| p99 | 46.9 ms |

핵심 해석:

> Difficulty 정확도는 97.8%지만 Joint Routing 정확도는 62.6%다. 현재 전체 라우팅의 주요 병목은 Difficulty보다 Category 분류다.

현재 개발 스냅샷에서는 이 exact 106D artifact가 private AI Service의 권위 model-path difficulty runtime으로 연결돼 있다. Category와 non-model-path sentinel/hard-rule 판정은 계속 Gateway 규칙 기반이다.

## 11. LightGBM 입력 표현·차원 실험

### 11.1 E5-base 입력 ablation

고정 LightGBM 설정에서 입력 표현만 변경했다.

| 후보 | 입력 | 차원 | Validation Acc | Test Acc | Test FN / FP |
|---|---|---:|---:|---:|---:|
| E1 | E5-base raw embedding | 768D | 88% | 84% | 7 / 9 |
| E2 | 규칙 42D + raw 768D | 810D | 87% | 87% | 7 / 6 |
| E3 | 규칙 42D + Train-only PCA128 | 170D | 90% | **94%** | 6 / 0 |
| E4 | 규칙 42D + semantic heads 12D | 54D | **91%** | 86% | **2** / 12 |

사전 정의된 Validation 선택 규칙은 E4 54D를 선택했다. 그러나 Test Accuracy는 E3 170D가 가장 높았다.

해석:

> 낮은 차원의 supervised semantic bottleneck은 Validation에서 효과적이었지만 작은 Test에서는 일반화가 유지되지 않았다. 500건 규모에서 feature 선택 불확실성이 존재한다.

모든 후보를 동일 Test에서 비교했으므로 이 실험은 strict one-shot promotion evidence가 아니라 exploratory offline comparison이다.

### 11.2 Runtime-compatible four-profile 비교

별도의 runtime-compatible 실험에서는 다음 네 후보를 비교했다.

| 후보 | 차원 | Validation Acc | Test Acc | Test FN |
|---|---:|---:|---:|---:|
| rule 42 + E5-small PCA64 | 106D | 95% | 96% | 2 |
| rule 42 + semantic heads 12 | 54D | **96%** | **97%** | **1** |
| E5-base raw | 768D | 87% | 87% | 6 |
| rule 42 + E5-base raw | 810D | 89% | 87% | 6 |

54D LightGBM이 가장 높은 Accuracy와 가장 적은 FN을 기록했지만, 이 결과도 300/100/100 규모의 `offline_shadow_only` evidence다.

관련 근거:

- [LightGBM Input Ablation Evidence](../../../../scripts/routing_difficulty_model/artifacts/lightgbm-input-ablation-owner-approved-500/input-ablation-evaluation.v1.json)
- [LightGBM Four-way Evidence](../../../../scripts/routing_difficulty_model/artifacts/lightgbm-four-way-owner-approved-500/four-way-evaluation.v1.json)
- [LightGBM Shadow Contract](../../../routing/difficulty-lightgbm-shadow.md)

## 12. LightGBM 하이퍼파라미터 실험

현재 진행 중인 후속 실험 설계:

- family-disjoint 70/15/15 분할: 350/75/75
- 후보별 Random Search 80개
- 각 후보 5-fold, 총 400 fold run
- 선택 지표: CV mean Average Precision, 표준편차
- calibration: none / Platt / Isotonic
- threshold: `C_FN=5` Expected Decision Loss와 FN safety gate
- 최종 Test bootstrap 1,000회 예정

현재 54D 후보의 선택 설정:

| Parameter | 값 |
|---|---:|
| `learning_rate` | 0.03 |
| `num_leaves` | 63 |
| `max_depth` | -1 |
| `min_data_in_leaf` | 100 |
| `feature_fraction` | 0.7 |
| `bagging_fraction` | 1.0 |
| `lambda_l1` | 1 |
| `lambda_l2` | 10 |
| `min_gain_to_split` | 0 |
| `best_iteration` | 557 |

현재 Validation 75건 결과:

| 지표 | 값 |
|---|---:|
| Accuracy | 88.0% |
| Macro F1 | 87.9% |
| Complex Recall | 97.3% |
| FN / FP | 1 / 8 |
| Average Precision | 98.7% |
| ROC-AUC | 98.2% |
| Brier Score | 0.026 |
| Log Loss | 0.122 |

현재 경계:

- 768D, 106D, 54D 후보의 tuning evidence가 생성됨
- 810D 후보 산출물은 아직 없음
- tuning Test 결과는 아직 동결되지 않음
- active LR 또는 routing decision을 교체하지 않음
- 최종 결론은 `exploratory_only`

관련 근거:

- [Hyperparameter Experiment Design](../lightgbm-hyperparameter-experiment-design.md)
- [Dimension Tuning Config](../fixtures/lightgbm-dimension-tuning-bridge.owner-approved-500.config.json)
- [54D Tuning Evidence](../../../../scripts/routing_difficulty_model/artifacts/lightgbm-dimension-tuning-owner-approved-500/candidates/rule_42_plus_semantic_heads_12/tuning-evidence.json)

## 13. 가장 우수한 모델 선정

### 13.1 현재 개발 스냅샷의 최종 모델

**106D Logistic Regression**

선정 이유:

- 사람 승인된 model-path 5,000건 사용
- family-disjoint Train 3,000 / Validation 1,000 / Test 1,000
- 여섯 LR 설정을 같은 Validation 기준으로 비교
- Test Difficulty Accuracy 97.8%
- Complex Recall 99.04%, FN 5
- Brier 0.0126, ECE 0.0073으로 양호한 calibration
- p95 41.6ms의 bounded runtime latency
- exact artifact와 fallback을 포함한 실제 Gateway 경로 연결

포스터 결론 문구:

> 현재 개발 스냅샷에서는 106D Logistic Regression이 충분한 평가 규모, 낮은 under-routing 오류, 우수한 확률 보정, 낮은 지연시간과 실제 Gateway 연결 근거를 모두 갖춰 최종 난이도 모델로 선택됐다.

### 13.2 LightGBM의 현재 위치

LightGBM은 일부 owner-approved 500건 실험에서 54D 또는 170D 입력이 높은 성능을 보였다. 그러나 다음 이유로 전체 최종 모델이라고 선언하지 않는다.

- 평가 데이터가 500건으로 작음
- Test support가 100건임
- 일부 실험에서 여러 후보가 동일 Test를 공유함
- 하이퍼파라미터 실험의 810D 후보와 최종 Test가 미완료
- 현재 권위 runtime으로 승격되지 않음

따라서 LightGBM은 **성능 가능성을 확인한 후속 연구 후보**로 표현한다.

## 14. 모델 선정 기준 제안

향후 Logistic Regression과 LightGBM을 같은 승인 데이터에서 최종 비교할 때 다음 순서를 사전 등록한다.

1. **Safety:** Complex Recall 최대화, FN 비악화
2. **Routing quality:** Joint Accuracy, Macro F1, Balanced Accuracy
3. **Ranking:** Average Precision, ROC-AUC
4. **Calibration:** Brier Score, Log Loss, ECE
5. **Decision cost:** `C_FP=1`, `C_FN∈{1,3,5,10}` Expected Decision Loss
6. **Efficiency:** 입력 차원, latency p50/p95/p99, artifact 크기
7. **Generalization:** category·언어·long-simple·short-complex slice
8. **Operational readiness:** artifact 검증, timeout, fail-safe, rollback

Test는 모든 설정을 동결한 후 단 한 번 최종 확인에만 사용한다. Test 결과가 예상과 다르더라도 Test를 보고 후보나 threshold를 다시 선택하지 않는다.

## 15. 포스터에서 보여줄 지표

### 핵심 성능 지표

- Difficulty Accuracy
- Joint Routing Accuracy
- Category Accuracy
- Balanced Accuracy와 Macro F1
- Complex Precision / Recall / F1
- FN과 FP가 포함된 confusion matrix

### 확률 품질

- Brier Score
- Log Loss
- ECE
- calibration curve

### Gateway 적용 가능성

- latency p50/p95/p99
- throughput
- 입력 차원
- artifact 크기
- timeout·failure 시 rule fallback 구조

### 데이터 품질

- 7,000 공개 + 6,000 합성 + 2,000 경계
- 언어 80:15:5
- 23개 작업 유형과 23개 서비스 도메인
- exact/normalized duplicate 0
- 의미 중복 후보 6쌍 재검토 중
- `human_reviewed=false`, `training_eligible=false`

## 16. 추천 시각 자료

포스터에는 다음 여섯 개를 우선 배치한다.

1. **전체 라우팅 파이프라인**  
   Prompt → Category → Difficulty → 5×2 matrix → Model

2. **15,000건 데이터 구성 stacked bar**  
   공개 7,000 / 합성 6,000 / 경계 2,000

3. **384D 임베딩 흐름도**  
   Tokenizer → QInt8 E5 → token embeddings → masked mean pooling → 384D → PCA64

4. **LR 6개 설정 Validation 비교 bar chart**  
   Difficulty Accuracy와 FN을 함께 표시

5. **최종 106D LR confusion matrix**  
   Complex Recall 99.04%와 FN 5 강조

6. **LightGBM 입력 차원 비교 scatter plot**  
   x축: 차원 또는 latency, y축: Accuracy, 점 크기 또는 색: FN

포스터 상단 핵심 숫자:

> **15,000 Candidate Prompts · Native 384D Embedding · 99.04% Complex Recall**

`15,000` 아래에는 반드시 다음 상태를 함께 표시한다.

> Human Review Pending / Not Used for Training

## 17. 한계와 향후 연구

### 현재 한계

- 신규 15,000건의 사람 adjudication 미완료
- 직접 사람 작성 Prompt 비율 부족
- 승인된 실제 서비스 사용자 Prompt 부재
- Category Accuracy 63.7%로 전체 Joint Routing의 병목 존재
- LightGBM 평가 표본과 category별 support 부족
- offline 분포와 실제 production traffic 간 drift 미검증
- 실제 비용 절감과 응답 품질 개선 효과를 직접 측정하지 않음

### 향후 작업

1. 신규 15,000건 독립 리뷰와 사람 adjudication 완료
2. 의미 중복 후보 6쌍 재검증
3. 승인된 실제 사용자 Prompt와 직접 사람 작성 데이터 보강
4. 동일한 승인 데이터·split에서 LR과 LightGBM 재비교
5. LightGBM 810D와 최종 untouched Test 완료
6. Category classifier 개선
7. shadow traffic에서 latency·drift·비용·응답 품질 평가

## 18. 포스터용 최종 요약문

> GateLM은 규칙 기반 라우팅에서 출발해 multilingual-E5의 384D 의미 표현과 통계적 난이도 모델을 결합했다. 현재 106D Logistic Regression은 Test 1,000건에서 97.8% 난이도 정확도와 99.04% Complex Recall을 기록했으며, 개발 스냅샷의 권위 model-path 난이도 분류기로 연결됐다. LightGBM은 저차원 의미 표현에서 높은 가능성을 보였지만 평가 규모와 Test 독립성 한계로 인해 후속 연구 대상으로 유지한다. 새로 구축한 15,000건 corpus는 차세대 모델 학습을 위한 후보 데이터이며, 독립 검수와 사람 adjudication 완료 후 사용할 예정이다.

## 19. 포스터에서 피해야 할 표현

다음 표현은 현재 근거보다 강하므로 사용하지 않는다.

- “15,000건으로 모델을 학습했다.”
- “15,000건은 사람이 검수한 gold dataset이다.”
- “LightGBM이 전체적으로 최종 우수 모델이다.”
- “의미 중복까지 모두 제거됐다.”
- “라우팅 전체 정확도가 97.8%다.”
- “실제 서비스에서 비용 절감이 검증됐다.”
- “현재 모델이 GA 또는 production-ready다.”

대신 다음처럼 표현한다.

- “15,000건 candidate corpus를 구축했다.”
- “Difficulty Accuracy는 97.8%, Joint Routing Accuracy는 62.6%다.”
- “현재 권위 모델은 106D Logistic Regression이며 LightGBM은 offline 연구 후보다.”
- “정확·정규화 중복 제거를 완료했고 의미 중복 후보를 재검토하고 있다.”
