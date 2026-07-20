# GateLM Difficulty Semantic Routing 실험 결과 보고서 템플릿

> [!NOTE]
> 이 문서는 [`routing-plan-base.md`](./routing-plan-base.md)에 정의된 Dataset 2 기반 B1-D2 control과 C1 offline 실험 결과를 기록하는 복사·작성용 템플릿이다. `[작성]`을 실제 값으로 교체하고, 적용되지 않는 항목은 삭제하지 말고 `N/A — 사유`를 적는다. 계획과 실행이 다르면 값을 조용히 바꾸지 말고 변경 사항과 영향을 16절에 기록한다.

> [!CAUTION]
> 이 보고서와 연결 산출물에는 raw prompt/response, raw detected value, normalized string, prompt fragment, token/token ID, attention mask, hidden state, embedding, vector, raw logit, raw probability, per-sample calibrated score, coefficient contribution, API Key, App Token, Provider Key, Authorization header, provider raw error body 또는 실제 secret를 기록하지 않는다. 안전한 aggregate count·metric·version·hash와 허용된 sample ID만 사용한다.

## 간단한 구현 목표

Dataset 2에서 동결한 B1-D2와 단일 C1 후보를 동일 조건으로 비교하고, 선택 과정·재현 정보·성능·안전성·런타임 결과를 빠짐없이 기록해 GO/NO-GO를 판단할 수 있는 단일 보고서를 만든다.

## 1. 의사결정 요약

| 항목 | 값 |
|---|---|
| Run ID | `[작성]` |
| 보고서 상태 | `[DRAFT / FINAL]` |
| 실행일 / 시간대 | `[YYYY-MM-DD / timezone]` |
| 계획 문서 | `docs/testing/routing-plan-base.md` |
| 평가 commit / branch | `[commit SHA / branch]` |
| 실행 책임자 | `[작성]` |
| 검토·승인 책임자 | `[작성]` |
| 평가 범위 | `modelPathOnly: true`, `sentinelExcluded: true` |
| 기준 모델 | `B1-D2 — Dataset 2 42D, L2/liblinear C=10, Isotonic, threshold 0.5` |
| 선택 후보 | `[C1 candidate / P / head C / final LR C / calibrator / threshold]` |
| 최종 판단 | `[GO / NO-GO / INSUFFICIENT PLANNED EVIDENCE / OFFLINE WINNER; RUNTIME UNSUPPORTED]` |
| 판단 범위 | `offline evidence only / 별도 승인된 승격 범위 [작성]` |
| Holdout 상태 | `[UNTOUCHED / CONSUMED / NOT OPENED]` |
| 핵심 실패·보류 사유 | `[없음 또는 목록]` |
| 다음 조치 | `[작성]` |

### 1.1 한 문단 결론

`[B1-D2 대비 C1의 핵심 성능 변화, 95% CI, overall/category safety, 확률 품질, 런타임 보호 기준, runtime 지원 여부와 다음 조치를 3~5문장으로 작성]`

### 1.2 핵심 판정표

| Gate | 사전 기준 | 측정 결과 | 판정 | 근거 |
|---|---|---|---|---|
| Difficulty accuracy | `C1 - B1-D2 >= +1.0%p` | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Paired CI | Family-cluster bootstrap 95% CI 하한 `> 0` | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Overall under-routing | C1 complex → simple이 B1-D2보다 악화되지 않음 | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Category under-routing | 5개 category 각각 비악화 | `[작성]` | `[PASS/FAIL/INSUFFICIENT]` | `[참조]` |
| 확률 품질 | Test log loss와 Brier가 B1-D2 대비 비악화 | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Joint routing-label accuracy | B1-D2 대비 비악화 | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Leakage / provenance | 모든 G0·leakage·hash gate 통과 | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Artifact parity | Non-finite `0`, Python-Go label mismatch `0`, tolerance 통과 | `[작성]` | `[PASS/FAIL/N/A]` | `[참조]` |
| Runtime | Latency·RSS·throughput·fallback 예산 통과 | `[작성]` | `[PASS/FAIL/N/A]` | `[참조]` |
| Holdout discipline | 동결 뒤 단일 후보로 Test 1회 실행 | `[작성]` | `[PASS/FAIL/NOT OPENED]` | `[참조]` |

## 2. 실험 범위와 사전 등록

### 2.1 목표와 성공 기준

| 항목 | 사전 등록값 | 실행 확인값 |
|---|---|---|
| Primary target | `Difficulty accuracy` | `[일치/변경 및 사유]` |
| 최소 실용 개선폭(MDE) | `+1.0%p` | `[작성]` |
| 최종 통계 | Paired family-cluster bootstrap 10,000회, 95% CI | `[작성]` |
| Bootstrap seed | `20260722` | `[작성]` |
| Power 기준 | `80%` | `[작성]` |
| Under-routing safety | Overall과 5개 category의 complex → simple 비악화 | `[작성]` |
| 효율성 | Simple → complex count/rate | `[작성]` |
| 확률 품질 | Model-path log loss, Brier score | `[작성]` |
| 제품 보호 | Joint routing-label accuracy 비악화, category accuracy 병기 | `[작성]` |
| 작은 category/slice | 넓은 interval이면 PASS가 아닌 `insufficient evidence` | `[작성]` |

오류율 분모를 다음과 같이 확인한다.

- `complexToSimpleRate = complexToSimpleCount / actualComplexCount`
- `simpleToComplexRate = simpleToComplexCount / actualSimpleCount`
- Baseline complex → simple count가 0인 category는 C1도 0이어야 한다.

### 2.2 실험 baseline과 후보 공간

| 구분 | 고정·선택 조건 | 결과 |
|---|---|---|
| B1-D2 입력 | `difficulty-feature-vector.v1` 42D | `[확인값]` |
| B1-D2 LR | L2/liblinear, `C=10` | `[확인값]` |
| B1-D2 calibrator | Exact-tie sample-count PAVA Isotonic | `[확인값]` |
| B1-D2 threshold | `0.5`, `score >= 0.5 → complex`; 선택하지 않음 | `[확인값]` |
| E1 P | `{16,32,64,96,128}` | `[선택값]` |
| E2 head C | `{0.01,0.03,0.1,0.3,1,3,10}` | `[선택값]` |
| E3 feature | `A=42D`, `B=42D+P`, `C=42D+P+12D` | `[선택값]` |
| E4 final LR C | 후보별 `{0.01,0.03,0.1,0.3,1,3,10}` | `[A/B/C 선택값]` |
| E5 calibrator | 후보별 `Platt / Isotonic` | `[후보별 선택값]` |
| E6 threshold | `0.000~1.000`, step `0.001` | `[선택값]` |

### 2.3 선택 순서와 데이터 역할

| 단계 | 사용 데이터 | 선택 또는 검증 | 완료 상태 |
|---|---|---|---|
| G0 | Dataset 2 manifest와 전체 role | 데이터/parser/model-path 동결 | `[PASS/FAIL]` |
| B1-D2 fit | Train | 42D LR 고정 fit | `[완료/실패]` |
| B1-D2 calibration | Validation | 고정 Isotonic OOF와 full-validation refit | `[완료/실패]` |
| E1 | Train grouped CV | PCA 차원 P 선택 | `[완료/실패]` |
| E2 | Train grouped CV | 공통 head C 선택과 cross-fitting | `[완료/실패]` |
| E3 × E4 | Train grouped CV | A/B/C별 final LR C 선택·refit | `[완료/실패]` |
| E5 | Validation grouped OOF | 후보별 calibrator와 final candidate 선택 | `[완료/실패]` |
| E6 | Validation OOF | Safety-constrained threshold 선택 | `[완료/실패]` |
| G7 freeze | Validation / artifact | Power·hash·parity 동결 | `[완료/실패]` |
| Final | Untouched Test | B1-D2와 단일 C1 paired 평가 | `[완료/미실행/실패]` |
| Runtime | 고정 benchmark 환경 | 비회귀·fallback·rollback 검증 | `[완료/N/A/실패]` |

### 2.4 범위와 제외 항목

| 항목 | 상태 / 사유 |
|---|---|
| 새 API·DB·Event·Metrics·RuntimeSnapshot 의미 | `변경 없음` |
| 제품 runtime 승격 | `이 offline 보고서만으로 승인하지 않음` |
| Encoder fine-tuning / 다른 embedding model | `제외` |
| Token length / prefix / pooling / quantization sweep | `제외` |
| Per-category classifier / calibrator | `제외` |
| Isotonic min-block merge / 임의 clipping / smoothing | `제외` |
| Sentinel combined threshold 변경 | `제외` |
| Category classifier 학습 | `제외` |
| Provider/model 가격과 business cost 자동 추정 | `제외` |
| Production prevalence 기반 calibration | `제외` |

### 2.5 Run manifest와 도구 사전 점검

| 사전 등록 항목 | Manifest 값 / 참조 | 결과 열람 전 동결 | 판정 |
|---|---|---|---|
| E1~E6 후보 grid | `[작성]` | `[시각/hash]` | `[PASS/FAIL]` |
| 단계별 primary metric과 선택 hierarchy | `[작성]` | `[시각/hash]` | `[PASS/FAIL]` |
| 허용 오차와 tie-break | `[작성]` | `[시각/hash]` | `[PASS/FAIL]` |
| Final MDE와 B1-D2 safety gate | `[작성]` | `[시각/hash]` | `[PASS/FAIL]` |
| Dataset/fold/label/parser/vectorizer version과 hash | `[작성]` | `[시각/hash]` | `[PASS/FAIL]` |
| Encoder/tokenizer/ONNX revision과 hash | `[작성]` | `[시각/hash]` | `[PASS/FAIL]` |
| CV와 bootstrap seed | `[작성]` | `[시각/hash]` | `[PASS/FAIL]` |
| Runtime budget과 actual timeout | `[작성]` | `[시각/hash]` | `[PASS/FAIL]` |
| Test 접근 owner와 허용 시점 | `[작성]` | `[시각/hash]` | `[PASS/FAIL]` |

| Runner 기능 | 준비 상태 | 근거 / 제한 |
|---|---|---|
| Canonical pipeline을 고정한 fold-local P grid | `[READY/MISSING]` | `[작성]` |
| 12D semantic-head cross-fitting | `[READY/MISSING]` | `[작성]` |
| `feature candidate × C` grouped screening과 nested stacking | `[READY/MISSING]` | `[작성]` |
| Calibrator grouped OOF를 process-local로 E6에 전달 | `[READY/MISSING]` | `[작성]` |
| Score-derived 후보를 추가하지 않는 fixed-grid selector | `[READY/MISSING]` | `[작성]` |
| B1-D2/C1 paired family-bootstrap report | `[READY/MISSING]` | `[작성]` |
| Freeze manifest와 candidate hash 기반 holdout 차단 | `[READY/MISSING]` | `[작성]` |
| 가변 P/dimension offline schema와 verifier | `[READY/MISSING]` | `[작성]` |
| 가변 dimension Python trainer/report | `[READY/MISSING]` | `[작성]` |
| Codegen·Go inference·parity | `[READY/MISSING/N/A]` | `[runtime evidence 가능 여부]` |

Tooling smoke 데이터/결과: `[N/A 또는 참조]`

Quality metric이나 GO/NO-GO 근거로 사용하지 않았는가: `[PASS/FAIL]`

## 3. 데이터·코드·환경 출처 추적

### 3.1 Dataset 2 고정 정보

| 항목 | 계획 고정값 | 실행 확인값 | 판정 |
|---|---|---|---|
| Dataset version | `difficulty_independent_ood_5000_2026_07_20_owner_approved_v1` | `[작성]` | `[PASS/FAIL]` |
| Policy-finalized manifest | `docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.policy-finalized.manifest.json` | `[작성]` | `[PASS/FAIL]` |
| Policy-finalized manifest SHA-256 | `ae2944c6f518c0bd55dee37df8b8db67f1e628a8c5d8b7fbb829ca83201bde17` | `[작성]` | `[PASS/FAIL]` |
| 전체 output SHA-256 | `60921fca6c26e02fba26e3b770b471c0fb683f96f074bf76561770bae13c6af0` | `[작성]` | `[PASS/FAIL]` |
| Split manifest SHA-256 | `a3a14b2f406bed5e06c048aae276c1b94b5da36d1de11f88b3e629ce74df8693` | `[작성]` | `[PASS/FAIL]` |
| Train SHA-256 | `bbfd0e20289a0cd84d81fa4a0f2f0609ac25703289bdadb55376c591b9df0ec4` | `[작성]` | `[PASS/FAIL]` |
| Validation SHA-256 | `3bcf3152536cce5e02180db35ef9dd12e8b820e0282841da9a527746857a6d24` | `[작성]` | `[PASS/FAIL]` |
| Test SHA-256 | `fb645fd615468e6ce3d383871310102bb91bd6d3794da6363110ab6940e42e8d` | `[작성]` | `[PASS/FAIL]` |
| `trainingEligible` | `true` | `[작성]` | `[PASS/FAIL]` |
| `recordLevelHumanReview` | `true` | `[작성]` | `[PASS/FAIL]` |
| Owner approval 참조 | `[계획/승인 참조]` | `[작성]` | `[PASS/FAIL]` |

### 3.2 역할별 split과 평가 모집단

| 역할 | 전체 record | Family | Model-path record | Model-path family | Simple | Complex | Membership SHA-256 | 상태 |
|---|---:|---:|---:|---:|---:|---:|---|---|
| Train | `3,000` | `600` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` |
| Validation | `1,000` | `200` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` |
| Test | `1,000` | `200` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[UNTOUCHED/CONSUMED]` |

| 동결 항목 | 값 |
|---|---|
| `decisionBoundaryVersion` | `[작성]` |
| `modelPathOnly` | `true` |
| `sentinelExcluded` | `true` |
| Train family split hash | `[작성]` |
| Validation family split hash | `[작성]` |
| Test family split hash | `[작성]` |
| Label/parser/vectorizer version과 hash | `[작성]` |

### 3.3 코드·runner·software lock

| 항목 | 버전 / commit | 경로 또는 불변 참조 | SHA-256 / lock | 비고 |
|---|---|---|---|---|
| 학습 runner | `[작성]` | `[작성]` | `[작성]` | `[작성]` |
| 평가/report runner | `[작성]` | `[작성]` | `[작성]` | `[작성]` |
| Parser | `[작성]` | `[작성]` | `[작성]` | `[작성]` |
| 42D vectorizer | `difficulty-feature-vector.v1` | `[작성]` | `[작성]` | `[작성]` |
| Offline artifact schema/verifier | `[작성]` | `[작성]` | `[작성]` | `[P와 가변 dimension 지원 여부]` |
| Codegen / Go inference | `[작성]` | `[작성]` | `[작성]` | `[지원/N/A]` |
| Python / NumPy / scikit-learn | `[작성]` | `[lock 참조]` | `[작성]` | `[작성]` |
| BLAS / ONNX Runtime | `[작성]` | `[lock 참조]` | `[작성]` | `[작성]` |

### 3.4 Encoder와 고정 pipeline

| 구성 | 계획 고정값 | 실행 확인값 |
|---|---|---|
| Encoder | `intfloat/multilingual-e5-small` | `[작성]` |
| Source revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` | `[작성]` |
| Runtime | Dynamic QInt8 ONNX, CPU | `[작성]` |
| 입력 | `instructionText`만, `query:` prefix | `[작성]` |
| Tokenization | Special token 포함, max length 128, 오른쪽 truncation, batch 1 | `[작성]` |
| Pooling | Attention-mask mean pooling, float32 `[384]` | `[작성]` |
| 빈 instruction | Encoder 미호출, `not_applicable` | `[작성]` |
| PCA | `full`, whitening `false` | `[작성]` |
| PCA pipeline | `raw pooled → PCA(P) → L2`, epsilon `1e-12` | `[작성]` |
| Category 입력 | 실제 runtime rule category | `[작성]` |
| Decision | `score >= threshold → complex` | `[작성]` |
| 실패 동작 | Request-local rule difficulty fallback | `[작성]` |

### 3.5 Fold와 seed

| 용도 | 계획 고정값 | Manifest / 실행 확인값 |
|---|---|---|
| Train screening | 5-fold `StratifiedGroupKFold`, seed `20260719` | `[작성]` |
| Candidate C stacking | 4-fold, seed `20260720 + outerFoldIndex` | `[작성]` |
| Validation calibration | 5-fold `StratifiedGroupKFold`, seed `20260721` | `[작성]` |
| Group | `promptFamily` | `[작성]` |
| Stratification | `expectedCategory × expectedDifficulty` | `[작성]` |
| Semantic heads RNG | `20260714` | `[작성]` |
| Final LR RNG | `1729` | `[작성]` |
| Platt RNG | `1729` | `[작성]` |
| Bootstrap | 10,000회, seed `20260722` | `[작성]` |

### 3.6 Prior evidence와 Test 접근 원장

Dataset 1과 과거 promotion/evaluation holdout은 이번 run의 fit·선택·최종 판정에 사용하지 않는다.

| 시각 | 주체 | 데이터 / split | 행위 | Artifact / hash | 허용 여부와 사유 |
|---|---|---|---|---|---|
| `[작성]` | `[작성]` | `[작성]` | `[historical aggregate 참조 / 접근]` | `[작성]` | `[작성]` |

| 시각 | 주체 | Test 접근 행위 | Freeze hash | 결과 |
|---|---|---|---|---|
| `[작성]` | `[작성]` | `[ACL 확인 / 실행 / 결과 열람]` | `[작성]` | `[차단/허용/consumed]` |

Test score 접근 owner: `[작성]`

허용 시점: `[artifact와 설정 동결 뒤의 시각]`

Score-blind one-shot 보장 근거: `[작성]`

## 4. G0 — 데이터·parser·model-path 검증

### 4.1 데이터 승인과 누출 감사

| 검사 | 필수 결과 | 측정 결과 | 판정 | 근거 |
|---|---|---|---|---|
| Schema·label·review 적격성 | 모든 사용 record/family approved | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Split 간 family 중복 | `0` | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Exact duplicate | `0` | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Normalized duplicate | `0` | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Near-duplicate | 상위 pair 수동 검토, 누출 `0` | `[검토 수/누출 수]` | `[PASS/FAIL]` | `[참조]` |
| 동일 family 변형 분리 | Contrast·paraphrase·synonym·언어·payload 변형 분리 `0` | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Category × difficulty × language support | 각 role의 모든 필수 cell 존재 | `[작성]` | `[PASS/FAIL]` | `[참조]` |

### 4.2 Cell support

| Category / language | Train simple / complex | Validation simple / complex | Test simple / complex | 판정 |
|---|---:|---:|---:|---|
| `general` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` |
| `code` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` |
| `translation` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` |
| `summarization` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` |
| `reasoning` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` |
| `korean` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` |
| `english` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` |
| `mixed_language` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` |

### 4.3 Parser·decision boundary·model-path

| 검사 | 필수 결과 | 분모 | 측정값 | 판정 | 근거 |
|---|---|---:|---:|---|---|
| 지원되는 명시적 경계 exact match | Human-approved label 대비 `100%` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| 모호·미지원 입력 강제 분리 방지 | Human-approved label 대비 `100%` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| 지원 경계 payload contamination | `0` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Payload detection precision | 값과 분모 보고 | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Payload detection recall | 값과 분모 보고 | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[참조]` |
| Model-path coverage | Role/category/difficulty별 count/rate 및 minimum support 충족 | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[참조]` |

| Role / category / difficulty | 전체 | Model-path count | Coverage rate | Family | Membership hash |
|---|---:|---:|---:|---:|---|
| `[Train / category / difficulty]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` |
| `[필요 행 추가]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` |

G0 결론: `[PASS / FAIL]`

변경이 발생한 parser/vectorizer/decision boundary: `[없음 또는 새 version과 전면 재실행 근거]`

### 4.4 사전 검정력과 단일 요청 embedding

| 검사 | 계획 / 기준 | 결과 | 판정 / 근거 |
|---|---|---|---|
| Provisional power simulation | B1-D2 Validation error, 사전 MDE와 결과 열람 전 disagreement 범위만 사용 | `[방법/반복/예상 power]` | `[PASS/FAIL; C1 미사용 근거]` |
| Planned Test 규모 | 명백히 부족하지 않음 | `[작성]` | `[PASS/FAIL]` |
| Encoder 호출 모집단 | Role별 modelPath=true이며 semantic input 필요 sample만 | `[count/family]` | `[PASS/FAIL]` |
| Batch shape | Batch size 1, 단건 결과 뒤 aggregate stack | `[작성]` | `[PASS/FAIL]` |
| Raw pooled embedding 수명 | Process-local memory only | `[감사 결과]` | `[PASS/FAIL]` |
| Invalid/non-finite embedding | `0` | `[작성]` | `[PASS/FAIL]` |
| Tokenizer/encoder/ONNX revision·hash | Run manifest와 일치 | `[작성]` | `[PASS/FAIL]` |

## 5. B1-D2 고정 baseline 결과

| 항목 | 고정 조건 | 결과 | 판정 / 근거 |
|---|---|---|---|
| Train model-path LR fit | 42D, L2/liblinear, `C=10` | `[수렴, n_iter, sample/family]` | `[PASS/FAIL; 참조]` |
| Validation fold | C1과 같은 family-grouped fold manifest | `[manifest hash]` | `[PASS/FAIL]` |
| Isotonic OOF | Exact-tie sample-count PAVA | `[log loss/Brier/진단]` | `[PASS/FAIL]` |
| Full Validation refit | 선택 없이 한 번 refit | `[결과/hash]` | `[PASS/FAIL]` |
| Threshold | 고정 `0.5` | `[확인]` | `[PASS/FAIL]` |
| Dataset/split 연결 | Dataset 2 version과 split hash | `[작성]` | `[PASS/FAIL]` |
| B1-D2 artifact | LR·Isotonic·threshold content hash | `[작성]` | `[PASS/FAIL]` |

Gateway B1 incumbent 참고값: `[artifact ID와 기존 published aggregate 또는 N/A]`

이번 run 선택·판정에 사용하지 않았다는 근거: `[작성]`

## 6. E1 — PCA 차원

### 6.1 설정과 후보 결과

Probe는 Candidate B `42D + P`, L2/liblinear LR `C=10`으로 고정한다.

| P | Mean OOF log loss | SE | 최저 mean + 1 SE 이내 | Brier | Explained variance | Artifact bytes | PCA-only p95 | Non-finite | Near-zero norm | 판정 |
|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---|
| 16 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[valid/invalid]` |
| 32 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[valid/invalid]` |
| 64 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[valid/invalid]` |
| 96 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[valid/invalid]` |
| 128 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[valid/invalid]` |

### 6.2 선택

| 항목 | 값 |
|---|---|
| 최저 mean log loss P | `[작성]` |
| One-standard-error 경계 | `[작성]` |
| 경계 안의 P | `[작성]` |
| 선택 P | `[가장 작은 적격 P]` |
| 선택 근거 | `[작성]` |
| PCA 보호 기준 | `Non-finite/near-zero norm count = 0; 결과 [작성]` |
| Fold-local fit 감사 | `[PASS/FAIL; 근거]` |

## 7. E2 — 4개 semantic head

### 7.1 Head 계약과 C 선택

Head class order는 Task `count_1/count_2/count_3_plus`, Constraint `count_0_to_1/count_2/count_3_plus`, Scope `count_1/count_2_to_3/count_4_plus`, Dependency `depth_0_to_1/depth_2/depth_3_plus`로 고정한다.

| C_head | 4-head mean log loss | SE | 1 SE 이내 | Mean macro-F1 | 기준 macro-F1 충족 | Invalid fold | Max n_iter | 판정 |
|---:|---:|---:|---|---:|---|---:|---:|---|
| 0.01 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` |
| 0.03 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` |
| 0.1 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` |
| 0.3 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` |
| 1 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` |
| 3 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` |
| 10 | `[작성]` | `[작성]` | `[Y/N]` | `[작성]` | `[Y/N]` | `[작성]` | `[작성]` | `[작성]` |

선택 head C: `[작성]`

One-standard-error·macro-F1 선택 근거: `[작성]`

### 7.2 선택된 head 측정값

| Head | Log loss | Macro-F1 | Multiclass Brier | 10-bin ECE | Highest-complexity recall | Class support | Convergence / n_iter |
|---|---:|---:|---:|---:|---:|---|---|
| Task | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` |
| Constraint | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` |
| Scope | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` |
| Dependency | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` |

| 추가 측정 | 결과 | 판정 / 근거 |
|---|---|---|
| 4-head joint exact-match accuracy | `[작성]` | `[작성]` |
| Korean aggregate | `[작성]` | `[작성]` |
| English aggregate | `[작성]` | `[작성]` |
| Mixed-language aggregate | `[작성]` | `[작성]` |
| Required slice aggregate | `[작성]` | `[참조]` |
| Probability finite / `[0,1]` / head sum `1.0` | `[위반 count]` | `[PASS/FAIL]` |
| 구현 간 probability parity | `[max/mean error]` | `[PASS/FAIL]` |
| Nested cross-fitting / leakage | `[작성]` | `[PASS/FAIL]` |
| Candidate B → C paired delta | `[Train 진단값]` | `[selection evidence only]` |

## 8. E3 × E4 — Feature 후보와 최종 Logistic Regression

### 8.1 후보별 C screening

동일 Train fold에서 각 candidate의 모든 C를 비교한다. 미수렴 fold가 하나라도 있으면 해당 C 전체가 invalid다.

| Candidate | Dimension | C | Mean OOF log loss | Brier | AUROC 또는 AP | Invalid fold | Max n_iter | 선택 |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| A | 42 | 0.01 | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| A | 42 | 0.03 | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| A | 42 | 0.1 | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| A | 42 | 0.3 | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| A | 42 | 1 | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| A | 42 | 3 | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| A | 42 | 10 | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| B | `42 + P` | `[7개 C 행 또는 근거 표 참조]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| C | `54 + P` | `[7개 C 행 또는 근거 표 참조]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |

> B와 C도 `C={0.01,0.03,0.1,0.3,1,3,10}`의 개별 결과를 이 표에 모두 추가하거나, 동일 열을 가진 불변 aggregate 파일을 참조한다.

### 8.2 후보별 선택·refit·ablation

| Candidate | 입력 | 선택 C | 선택 근거(log loss → Brier → 작은 C) | Full-train 수렴 | Coefficient finite | Expected dimension | Artifact hash |
|---|---|---:|---|---|---|---|---|
| A | 42D | `[작성]` | `[작성]` | `[PASS/FAIL; n_iter]` | `[PASS/FAIL]` | `[PASS/FAIL]` | `[작성]` |
| B | 42D + P | `[작성]` | `[작성]` | `[PASS/FAIL; n_iter]` | `[PASS/FAIL]` | `[PASS/FAIL]` | `[작성]` |
| C | 42D + P + 12D | `[작성]` | `[작성]` | `[PASS/FAIL; n_iter]` | `[PASS/FAIL]` | `[PASS/FAIL]` | `[작성]` |

| Train screening 진단 | Paired delta | 비고 |
|---|---:|---|
| A → B log loss / Brier | `[작성]` | `PCA 순증분; final superiority 아님` |
| B → C log loss / Brier | `[작성]` | `Semantic head 순증분; final superiority 아님` |

모든 A/B/C를 Validation E5로 전달했는가: `[PASS/FAIL]`

Candidate C 12D family cross-fit 감사: `[PASS/FAIL; 근거]`

## 9. E5 — Candidate별 calibration과 최종 model 선택

### 9.1 Candidate × calibrator 결과

| Candidate | Dimension | Calibrator | Mean OOF log loss | Brier | 10-bin ECE | Convergence / validity | Candidate 내부 선택 |
|---|---:|---|---:|---:|---:|---|---|
| A | 42 | Platt | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| A | 42 | Isotonic | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| B | `42 + P` | Platt | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| B | `42 + P` | Isotonic | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| C | `54 + P` | Platt | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |
| C | `54 + P` | Isotonic | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[Y/N]` |

Candidate 내부 calibrator 선택은 `log loss → Brier → Platt`, final candidate 선택은 `log loss → Brier → lower dimension` 순이다. 동률 허용 오차는 `<= 1e-6`이다.

### 9.2 Isotonic 진단

| Candidate | Fold | Block count | Minimum block support | Output 0 rate | Output 1 rate | Exact-tie / endpoint clip / interpolation 검사 | 판정 |
|---|---:|---:|---:|---:|---:|---|---|
| `[A/B/C]` | `[1~5]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[valid/invalid]` |

### 9.3 Reliability table

| Candidate / calibrator | Bin | Support | Mean predicted | Observed complex rate | Absolute gap |
|---|---:|---:|---:|---:|---:|
| `[작성]` | `[1~10]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` |

### 9.4 최종 선택

| 항목 | 값 |
|---|---|
| A selected calibrator / 근거 | `[작성]` |
| B selected calibrator / 근거 | `[작성]` |
| C selected calibrator / 근거 | `[작성]` |
| Final base candidate | `[A/B/C]` |
| Final calibrator | `[Platt/Isotonic]` |
| 선택 근거 | `[log loss, Brier, dimension 비교]` |
| Full Validation calibrator refit | `[수렴/validity/artifact hash]` |
| Production 확률로 해석하지 않는다는 확인 | `[확인/위반]` |

## 10. E6 — 전역 threshold

### 10.1 선택 정책 확인

| 항목 | 값 |
|---|---|
| 점수 출처 | `Selected calibrator의 Validation family-grouped OOF calibrated score` |
| Grid | `0.000~1.000`, step `0.001` |
| 사후 unique score / midpoint 추가 | `[없음이어야 함]` |
| 1순위 | Overall complex → simple B1-D2 비악화 |
| 2순위 | 5개 category 각각 complex → simple B1-D2 비악화 |
| 3순위 | Safe 후보 중 difficulty accuracy 최대 |
| 4순위 | 동률이면 simple → complex 최소 |
| 5순위 | 그래도 동률이면 더 낮은 threshold |
| 승인된 실제 cost ratio | `[없음 / 승인값과 참조]` |

### 10.2 선택값과 인접 grid

전체 1,001개 threshold 결과 aggregate 참조: `[경로/hash]`

| Threshold | Accuracy | FN count / rate | FP count / rate | Overall safety | 5-category safety | 선택 |
|---:|---:|---|---|---|---|---|
| `[선택값 - 0.001]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[PASS/FAIL]` | `N` |
| `[선택값]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[PASS/FAIL]` | `Y` |
| `[선택값 + 0.001]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[PASS/FAIL]` | `N` |

Safe threshold 수: `[작성]`

선택 threshold: `[작성]`

선택 근거: `[작성]`

Safe threshold가 없을 때의 판정: `[NO-GO / N/A]`

### 10.3 Validation category safety

| Category | B1-D2 FN count / rate | C1 FN count / rate | FP count / rate | Safety | 비고 |
|---|---|---|---|---|---|
| general | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| code | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| translation | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| summarization | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| reasoning | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |

### 10.4 선택 안정성과 비용 민감도

| 측정 | 결과 | 근거 |
|---|---|---|
| Family-cluster bootstrap 반복 / seed | `10,000 / 20260722` | `[참조]` |
| Selected-threshold 분포 | `[quantile / frequency table]` | `[참조]` |
| 선택 안정성 결론 | `[안정/불안정/insufficient evidence]` | `[작성]` |
| `C_FN=1`, `C_FP=1` safety-constrained EDL optimum | `[threshold / EDL]` | `[참조]` |
| `C_FN=3`, `C_FP=1` safety-constrained EDL optimum | `[threshold / EDL]` | `[참조]` |
| `C_FN=5`, `C_FP=1` safety-constrained EDL optimum | `[threshold / EDL]` | `[참조]` |
| `C_FN=10`, `C_FP=1` safety-constrained EDL optimum | `[threshold / EDL]` | `[참조]` |
| Break-even FP/FN ratio | `[작성]` | `[계산 근거]` |

비용 분석은 승인된 cost ratio가 없는 한 민감도 분석이며 primary threshold 선택을 바꾸지 않았는가: `[PASS/FAIL]`

## 11. Artifact 동결·검정력·parity

### 11.1 Artifact 구성과 hash

| 구성 요소 | 버전 / 설정 | Artifact 참조 | SHA-256 |
|---|---|---|---|
| Dataset / split | `[작성]` | `[작성]` | `[작성]` |
| Parser / decision boundary | `[작성]` | `[작성]` | `[작성]` |
| Tokenizer | `[작성]` | `[작성]` | `[작성]` |
| Encoder | `[작성]` | `[작성]` | `[작성]` |
| PCA | `[P와 recipe]` | `[작성]` | `[작성]` |
| Semantic heads | `[C와 class order]` | `[작성]` | `[작성]` |
| Final LR | `[candidate/dimension/C]` | `[작성]` | `[작성]` |
| Calibrator | `[작성]` | `[작성]` | `[작성]` |
| Threshold | `[작성]` | `[작성]` | `[작성]` |
| C1 combined artifact | `[version]` | `[작성]` | `[작성]` |
| B1-D2 combined artifact | `[version]` | `[작성]` | `[작성]` |

Freeze 시각: `[작성]`

Freeze 승인자: `[작성]`

Freeze 후 설정 변경: `[없음 / 있으면 NO-GO와 consumed 처리]`

### 11.2 Final power check

| 항목 | 값 |
|---|---|
| Validation B1-D2/C1 paired prediction hash | `[작성]` |
| MDE | `[작성]` |
| Disagreement 구조 | `[안전한 aggregate]` |
| Cluster-aware simulation 방법 / 반복 / seed | `[작성]` |
| 예상 power | `[작성]` |
| 80% 기준 | `[PASS/FAIL]` |
| Test 개방 결정 | `[OPEN / DO NOT OPEN]` |

Power가 부족한 경우 종료 상태와 새 untouched dataset 계획: `[작성]`

### 11.3 Python-Go parity와 runtime 지원

| 검사 | 허용 기준 | 결과 | 판정 |
|---|---|---|---|
| Non-finite / out-of-range score | `0` | `[작성]` | `[PASS/FAIL]` |
| Artifact shape/hash mismatch | `0` | `[작성]` | `[PASS/FAIL]` |
| PCA transform numeric difference | `[사전 승인 tolerance]` | `[max/mean]` | `[PASS/FAIL/N/A]` |
| Score numeric difference | `[사전 승인 tolerance]` | `[max/mean]` | `[PASS/FAIL/N/A]` |
| Python-Go label mismatch | `0` | `[작성]` | `[PASS/FAIL/N/A]` |
| Selected P/dimension schema 지원 | 필수 | `[작성]` | `[PASS/FAIL]` |
| Codegen/Go runtime 지원 | Deployment evidence에 필수 | `[작성]` | `[PASS/FAIL/N/A]` |

Runtime이 선택 shape를 지원하지 않을 때 기록할 상태: `[OFFLINE WINNER; RUNTIME UNSUPPORTED / N/A]`

## 12. Untouched Test 단회 paired 평가

### 12.1 실행 기록

| 항목 | 값 |
|---|---|
| 실행 시각 | `[작성]` |
| 실행 주체 / 승인 | `[작성]` |
| Test hash | `[작성]` |
| B1-D2 artifact hash | `[작성]` |
| C1 artifact hash | `[작성]` |
| Test 후보 수 | `1` |
| 실행 횟수 | `1` |
| Holdout 상태 변경 | `UNTOUCHED → CONSUMED` |
| 결과 artifact / hash | `[작성]` |

### 12.2 핵심 paired 결과

| 지표 | B1-D2 | C1 | Paired delta | 95% CI | 기준 | 판정 |
|---|---:|---:|---:|---|---|---|
| Difficulty accuracy | `[작성]` | `[작성]` | `[작성]` | `[하한, 상한]` | `>= +1.0%p, CI 하한 > 0` | `[PASS/FAIL]` |
| Complex → simple count | `[작성]` | `[작성]` | `[작성]` | `[선택]` | C1 비악화 | `[PASS/FAIL]` |
| Complex → simple rate | `[작성]` | `[작성]` | `[작성]` | `[선택]` | C1 비악화 | `[PASS/FAIL]` |
| Simple → complex count | `[작성]` | `[작성]` | `[작성]` | `[선택]` | 진단·tie-break | `[작성]` |
| Simple → complex rate | `[작성]` | `[작성]` | `[작성]` | `[선택]` | 진단·tie-break | `[작성]` |
| Model-path log loss | `[작성]` | `[작성]` | `[작성]` | `[선택]` | C1 비악화 | `[PASS/FAIL]` |
| Brier score | `[작성]` | `[작성]` | `[작성]` | `[선택]` | C1 비악화 | `[PASS/FAIL]` |
| Category accuracy | `[작성]` | `[동일 값 또는 작성]` | `[작성]` | `[선택]` | 함께 보고 | `[작성]` |
| Oracle-category difficulty accuracy | `[작성]` | `[작성]` | `[작성]` | `[선택]` | 진단 | `[작성]` |
| Runtime-category difficulty accuracy | `[작성]` | `[작성]` | `[작성]` | `[선택]` | Primary population 확인 | `[작성]` |
| Joint routing-label accuracy | `[작성]` | `[작성]` | `[작성]` | `[선택]` | B1-D2 비악화 | `[PASS/FAIL]` |

통계 방법: `promptFamily cluster bootstrap 10,000회, 95% interval, seed 20260722`

Exact McNemar 보조 결과(선택): `[작성 또는 N/A]`

일반 t-test를 사용하지 않았는가: `[PASS/FAIL]`

### 12.3 Category별 safety

| Category | Actual complex support | B1-D2 FN count / rate | C1 FN count / rate | Actual simple support | B1-D2 FP count / rate | C1 FP count / rate | Safety | Evidence 상태 |
|---|---:|---|---|---:|---|---|---|---|
| general | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[sufficient/insufficient]` |
| code | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[sufficient/insufficient]` |
| translation | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[sufficient/insufficient]` |
| summarization | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[sufficient/insufficient]` |
| reasoning | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[sufficient/insufficient]` |

### 12.4 필수 11개 slice

각 slice에는 total/simple/complex support, accuracy와 FN count를 반드시 기록한다. 작은 support는 개선으로 해석하지 않고 `insufficient evidence`로 표시한다.

| Slice | Total | Simple | Complex | B1-D2 accuracy | C1 accuracy | B1-D2 FN | C1 FN | Safety | Evidence 상태 |
|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| `negation` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| `indirect_expression` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| `synonym` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| `short_complex` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| `long_simple` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| `payload_contamination` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| `korean` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| `english` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| `mixed_language` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| `category_confusion` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |
| `ood_terminology` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` | `[작성]` |

## 13. Runtime·fallback·rollback 결과

### 13.1 Benchmark 환경과 절차

| 항목 | 값 |
|---|---|
| Target hardware / CPU | `[작성]` |
| OS / architecture | `[작성]` |
| Build / commit | `[작성]` |
| CPU affinity | `[작성]` |
| Thread / worker | `[작성 / worker=1]` |
| Batch | `1` |
| Warm-up | `100 requests` |
| 측정 request 수 | `[최소 1,000]` |
| Configured request timeout | `[실제 값과 근거]` |
| Input-length aggregate | `[분포 요약]` |
| Runtime / library versions | `[작성]` |
| Arrival pattern | `[고정 패턴]` |

### 13.2 성능 결과

| 지표 | B1-D2 | C1 | 변화율 | 예산 | 판정 |
|---|---:|---:|---:|---|---|
| p50 model-path latency | `[작성]` | `[작성]` | `[작성]` | `보고` | `[작성]` |
| p95 model-path latency | `[작성]` | `[작성]` | `[작성]` | B1-D2 대비 `+10%` 이내 | `[PASS/FAIL]` |
| p99 model-path latency | `[작성]` | `[작성]` | `[작성]` | Actual configured timeout 미만 | `[PASS/FAIL]` |
| Throughput | `[작성]` | `[작성]` | `[작성]` | B1-D2 대비 `-10%` 이내 | `[PASS/FAIL]` |
| Cold load | `[작성]` | `[작성]` | `[작성]` | `[사전 등록 예산/보고]` | `[작성]` |
| Peak RSS | `[작성]` | `[작성]` | `[작성]` | B1-D2 대비 `+10%` 이내 | `[PASS/FAIL]` |
| Failure rate | `[작성]` | `[작성]` | `[작성]` | B1-D2보다 악화되지 않음 | `[PASS/FAIL]` |
| Fallback rate | `[작성]` | `[작성]` | `[작성]` | B1-D2보다 악화되지 않음 | `[PASS/FAIL]` |

### 13.3 Stress와 실패 격리

Worker 1, waiting queue 4, 각 5분, 동일 timeout·arrival pattern으로 실행한다.

| Concurrency | Model | Duration | Busy count/rate | Timeout count/rate | Invalid embedding | Inference failure | Rule fallback success | Panic recovery | 판정 |
|---:|---|---|---|---|---:|---:|---|---|---|
| 1 | B1-D2 | `5m` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[기준]` |
| 1 | C1 | `5m` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` |
| 4 | B1-D2 | `5m` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[기준]` |
| 4 | C1 | `5m` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` |
| 8 | B1-D2 | `5m` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[기준]` |
| 8 | C1 | `5m` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[PASS/FAIL]` |

| 검증 | 결과 | 판정 / 근거 |
|---|---|---|
| Request-local fallback | `[작성]` | `[PASS/FAIL]` |
| Rule fallback failure 비악화 | `[작성]` | `[PASS/FAIL]` |
| Rollback test | `[작성]` | `[PASS/FAIL]` |
| Runtime aggregate artifact / hash | `[작성]` | `[참조]` |

## 14. 배포 관찰 경계

| 항목 | 선택 / 결과 |
|---|---|
| Offline evidence로 종료 | `[Y/N; 사유]` |
| Approved redacted/label-audited offline replay | `[Y/N/N/A; 승인 참조와 aggregate 결과]` |
| B1↔C1 dual evaluation | `[Y/N; 별도 observer/metrics/security contract 참조]` |
| Runtime canary | `[Y/N; 별도 promotion/canary contract 참조]` |
| Score 또는 score distribution 기록 | `금지; 위반 여부 [PASS/FAIL]` |
| Production calibration 주장 | `별도 label-audited evidence 필요; 주장 여부 [없음/위반]` |

제품 runtime 승격 판단: `[승격 아님 / 별도 contract gate로 이관]`

Owner gate 결과: `[작성]`

## 15. 절대 NO-GO 점검

하나라도 `발생`이면 결과가 좋아 보여도 승격하지 않는다.

| 조건 | 발생 여부 | 근거 / 조치 |
|---|---|---|
| Human approval 또는 training eligibility 없는 데이터 사용 | `[미발생/발생]` | `[작성]` |
| Versioned schema/verifier 없이 가변 shape를 runtime·promotion evidence로 해석 | `[미발생/발생]` | `[작성]` |
| Cross-split family/duplicate leakage | `[미발생/발생]` | `[작성]` |
| PCA/head/12D stacking leakage | `[미발생/발생]` | `[작성]` |
| Selection 전 Test score 접근 | `[미발생/발생]` | `[작성]` |
| 모든 후보 invalid 또는 selected head/final LR 미수렴 또는 calibrator invalid | `[미발생/발생]` | `[작성]` |
| Non-finite/out-of-range score 또는 artifact shape/hash mismatch | `[미발생/발생]` | `[작성]` |
| Python-Go label mismatch | `[미발생/발생/N/A]` | `[작성]` |
| Runtime/codegen 미지원 shape를 deployment evidence로 해석 | `[미발생/발생]` | `[작성]` |
| Overall 또는 category complex → simple 악화 | `[미발생/발생]` | `[작성]` |
| 사전 MDE/CI 기준 미충족 | `[미발생/발생]` | `[작성]` |
| Runtime latency/memory/fallback budget 실패 | `[미발생/발생/N/A]` | `[작성]` |
| Holdout 결과를 본 뒤 candidate/calibrator/threshold 변경 | `[미발생/발생]` | `[작성]` |

NO-GO 총평: `[해당 없음 / 발생 조건과 종료 조치]`

## 16. 계획 대비 변경·한계·다음 조치

### 16.1 계획 대비 변경

| 시각 | 변경 항목 | 계획값 | 실행값 | 결과 열람 전/후 | 승인 | 영향·재실행 범위 |
|---|---|---|---|---|---|---|
| `[작성]` | `[없음 또는 변경]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` | `[작성]` |

### 16.2 한계

- Balanced synthetic/redacted benchmark의 calibration을 production prevalence의 `P(complex | x)`로 해석할 수 없는 한계: `[작성]`
- Category 또는 slice support와 `insufficient evidence`: `[작성]`
- Model-path-only, sentinel-excluded 범위의 한계: `[작성]`
- Label-blind가 아닌 score-blind one-shot 절차의 한계: `[작성]`
- Runtime/schema/codegen 지원 한계: `[작성]`
- 그 밖의 한계: `[작성]`

### 16.3 Holdout 소비와 다음 조치

| 항목 | 값 |
|---|---|
| Holdout consumed 여부 / 시각 | `[작성]` |
| Consumed ledger 참조 / hash | `[작성]` |
| 재사용 금지 범위 | `[P/C/calibrator/threshold 선택 및 superiority 주장]` |
| 새 run 필요 여부 | `[Y/N]` |
| 새 untouched dataset/split 필요 여부 | `[Y/N]` |
| Artifact/runtime 계약 후속 작업 | `[작성]` |
| Owner / 기한 | `[작성]` |

## 17. 최종 승인

| 역할 | 이름 | 결정 | 시각 | 근거 / 서명 참조 |
|---|---|---|---|---|
| 실험 실행 책임자 | `[작성]` | `[제출]` | `[작성]` | `[작성]` |
| 데이터 owner | `[작성]` | `[승인/거절]` | `[작성]` | `[작성]` |
| Model-quality owner | `[작성]` | `[승인/거절]` | `[작성]` | `[작성]` |
| Runtime owner | `[작성]` | `[승인/거절/N/A]` | `[작성]` | `[작성]` |
| Product owner | `[작성]` | `[GO/NO-GO]` | `[작성]` | `[작성]` |

최종 결정: `[GO / NO-GO / INSUFFICIENT PLANNED EVIDENCE / OFFLINE WINNER; RUNTIME UNSUPPORTED]`

결정 이유: `[작성]`

## 18. 재현 참조

| 산출물 | 경로 / 불변 참조 | SHA-256 / commit |
|---|---|---|
| Immutable run manifest | `[작성]` | `[작성]` |
| Fold manifests | `[작성]` | `[작성]` |
| G0 aggregate report | `[작성]` | `[작성]` |
| E1 aggregate report | `[작성]` | `[작성]` |
| E2 aggregate report | `[작성]` | `[작성]` |
| E3 × E4 aggregate report | `[작성]` | `[작성]` |
| E5 aggregate report | `[작성]` | `[작성]` |
| E6 threshold aggregate report | `[작성]` | `[작성]` |
| B1-D2 artifact | `[작성]` | `[작성]` |
| C1 artifact | `[작성]` | `[작성]` |
| Parity report | `[작성]` | `[작성]` |
| Final paired report | `[작성]` | `[작성]` |
| Runtime report | `[작성]` | `[작성]` |
| Holdout access ledger | `[작성]` | `[작성]` |

재현 명령과 예상 출력:

```powershell
# [비밀값이나 금지 데이터를 인자로 넣지 않는다.]
[작성]
```

## 19. 완료 체크리스트

- [ ] 정확도의 의미와 primary target을 고정했다.
- [ ] Dataset version/output/split hash, human approval과 training eligibility를 고정했다.
- [ ] B1-D2를 Train에서 fit하고 Validation에서 Isotonic OOF/refit한 뒤 고정했다.
- [ ] Family/exact/normalized/near-duplicate leakage가 0이다.
- [ ] Parser, vectorizer, decision boundary와 role별 model-path membership을 동결했다.
- [ ] E1은 canonical PCA pipeline을 고정하고 Train 5-fold grouped CV에서 P만 선택했다.
- [ ] E2는 사전 grid와 one-standard-error/macro-F1 규칙으로 head C를 선택했다.
- [ ] E3 × E4를 공동 grid와 동일 fold로 실행했다.
- [ ] A/B/C마다 final LR C를 별도로 선택하고 full Train refit 수렴을 확인했다.
- [ ] PCA/head fit과 12D stacking을 family cross-fit했다.
- [ ] E5에서 A/B/C 각각의 Platt/Isotonic을 grouped OOF로 비교했다.
- [ ] E6 threshold는 selected calibrator의 Validation OOF score와 사전 grid만 사용했다.
- [ ] Artifact/hash/parity 뒤 Test candidate가 정확히 하나다.
- [ ] Final power가 80% 이상이거나 Test를 열지 않고 종료했다.
- [ ] Final Test를 한 번만 열고 holdout을 consumed로 기록했다.
- [ ] Difficulty accuracy MDE/CI와 overall/category FN gate를 판정했다.
- [ ] Category, oracle-category, joint routing-label과 11개 required slice를 보고했다.
- [ ] Runtime/fallback/rollback gate를 판정했다.
- [ ] 절대 NO-GO 조건을 모두 점검했다.
- [ ] Holdout 소비, 한계와 다음 action을 기록했다.
- [ ] 보고서와 연결 산출물에 금지 데이터를 기록하지 않았다.
