# GateLM Routing Classification Pipeline

| Field | Value |
|---|---|
| Status | Active routing target contract; logistic/calibration artifacts pending |
| Applies to | General Gateway category and difficulty classification hot path |
| Canonical implementation | Go structs and deterministic local inference |
| Active entrypoint | [`README.md`](README.md) |
| Last verified | 2026-07-13 |

이 문서는 일반 Gateway에서 앞으로 사용하는 category·difficulty 분류 구현 구조를 정의한다. Category와 difficulty의 의미, 허용 값, routing policy 연결은 [`contracts.md`](contracts.md)가 정의하고, 이 문서는 그 의미를 계산하는 canonical 내부 파이프라인을 정의한다. Logistic Regression 입력 encoder의 exact v1 계약은 [`difficulty-feature-vector-v1.md`](difficulty-feature-vector-v1.md)가 정의한다.

## 1. Canonical Pipeline

신규 런타임 코드와 offline 평가 코드는 다음 순서를 사용한다.

```text
Prompt
→ ExtractPromptFeatures
→ PromptFeatures
→ CategoryClassifier
→ CategoryResult
→ ExtractDifficultyFeatures(PromptFeatures, CategoryResult.Category)
→ DifficultyFeatures
→ DifficultyClassifier
→ DifficultyResult
```

공통 전처리는 요청당 한 번만 실행한다. Category를 먼저 확정한 뒤 해당 category의 난이도 규칙만 선택적으로 계산한다. 다른 category의 난이도 규칙을 미리 모두 계산하지 않는다.

## 2. Feature And Result Boundaries

`PromptFeatures`는 category와 difficulty가 공유하는 공통 전처리만 보관한다.

- 외부 노출 금지: 정규화 문자열, instruction/payload 분리 문자열, token 집합
- 안전한 파생 특징: prompt rune 길이, 단어 수, 절 수, 작업 수, 제약 수, scope 수, 의존 깊이, language bucket, code fence 여부, 의미 없는 입력 여부

Count 계열은 bounded local rule로 계산한다. `languageBucket`은 `ko | en | mixed | unknown`이고 언어 자체를 난이도로 사용하지 않는다. `instructionText`와 `payloadText`는 code fence처럼 명시적인 구조가 있을 때만 보수적으로 분리하며 둘 다 원문 파생 민감 값으로 취급한다. `PromptFeatures`에는 다음 분류 결과를 넣지 않는다.

- category
- category diagnostics 또는 category score
- difficulty
- complexity score

Category classifier는 `PromptFeatures`로부터 네 non-general category 각각의 내부 `CategoryIntentFeatures`를 만든다. 각 feature set은 action, object fit, structural evidence, action-object pair, negative context score만 가진다. `general`은 별도 intent score를 만들지 않고 다른 category가 충분한 근거를 얻지 못했을 때 fallback으로 선택한다. 이 내부 score 구조는 canonical pipeline에 새 전달 단계를 추가하지 않는다.

`CategoryResult`는 확정된 category와 `CategoryDiagnostics`를 반환한다.

`DifficultyFeatures`는 `PromptFeatures`와 확정된 category로부터 만든다. 공통 난이도 feature는 payload size bucket, 작업 수, 제약 수, scope 수, 의존 깊이다. Category별 feature는 다음처럼 분리한다.

- `general`: workflow depth, branch/exception 수, extraction breadth, cross-source synthesis
- `code`: operation kind, code scope breadth, causal complexity, engineering constraint 수
- `translation`: translation scope, preservation constraint 수, domain terminology level, localization degree
- `summarization`: source breadth, synthesis level, facet 수, traceability constraint
- `reasoning`: alternative 수, criteria/constraint 수, reasoning depth, uncertainty/scenario 수

`DifficultyFeatures`에는 확정된 category의 feature pointer 하나만 채운다. 다른 category의 feature를 미리 계산하거나 보관하지 않는다.

`DifficultyFeatureNamesV1`과 `VectorizeDifficultyFeaturesV1`은 `difficulty-feature-vector.v1`의 고정 42차원 이름·순서·scaling·enum·zero-fill 계약을 구현한다. Vectorizer는 현재 rule-based runtime 판정에 연결하지 않으며 exact 계약은 [`difficulty-feature-vector-v1.md`](difficulty-feature-vector-v1.md)를 따른다.

Artifact 승격 후 `DifficultyResult`가 가져야 할 canonical 내부 의미는 다음 두 값이다.

- `ComplexityScore`: 최종 보정된 finite inclusive `0.0~1.0`의 complex 확률 추정값
- `Difficulty`: `simple | complex`

`ComplexityScore`만 result에 둔다. 선형 logit `z`, Logistic Regression이 출력한 미보정 확률 `sigmoid(z)`, calibrator 중간값, threshold와 feature contribution은 `DifficultyResult`, `PromptFeatures` 또는 `DifficultyFeatures`에 넣지 않는다. 비었거나 의미 없는 입력은 모델과 calibrator를 통과하지 않고 `ComplexityScore = 0.0`, `Difficulty = simple`로 반환한다. 이 `0.0`은 calibrated estimate가 아니라 기존 empty-input 동작을 보존하는 sentinel이다.

Difficulty score의 target 계산은 다음 순서를 사용한다.

```text
DifficultyFeatures
→ VectorizeDifficultyFeaturesV1
→ difficulty-feature-vector.v1 []float64
→ difficulty-logistic-v1 single global regularized Logistic Regression
→ z = w·x + b
→ raw probability = sigmoid(z)
→ difficulty-calibration-v1 selected single global calibrator
→ ComplexityScore
→ difficulty-threshold-v1 global 0.5
→ Difficulty
```

모든 category는 하나의 Logistic Regression, 하나의 calibrator와 하나의 threshold를 공유한다. Category별 model, calibrator 또는 threshold는 허용하지 않는다. 기존 공통 및 선택된 category의 `DifficultyFeatures`만 model input으로 사용하며 raw text, token, matched phrase, provider/model/modelRef/tier/catalog metadata, resolved target, 실제 가격, tenant budget 또는 별도 runtime 신호를 추가하지 않는다.

정확한 feature 순서, 숫자 정규화, bucket/enum encoding과 category zero-fill은 `difficulty-feature-vector.v1`로 고정한다. Coefficient, intercept, regularization/solver 설정, model artifact hash와 calibrator parameter는 offline evidence 이후 별도의 immutable artifact version과 content hash로 고정한다. `difficulty-logistic-v1`과 `difficulty-calibration-v1`은 각각 model family와 calibrator 선택·검증 절차를 정의하는 policy version이며 아직 존재하지 않는 artifact가 구현됐음을 뜻하지 않는다.

초기 global threshold policy는 `difficulty-threshold-v1 = 0.5`다. `ComplexityScore >= 0.5`이면 `complex`, 미만이면 `simple`이다. `0.5`는 evidence-selected optimum이 아닌 bootstrap/default 값이다. 향후 evidence가 다른 값을 지지하면 v1을 수정하지 않고 새 global threshold policy version을 만든다. Request, tenant, RuntimeConfig, RuntimeSnapshot, 환경변수 또는 runtime caller가 threshold를 덮어쓰지 못한다.

Runtime inference는 `float64`, 고정 feature order/encoding, 고정 coefficient/intercept, 고정 sigmoid와 calibrator implementation을 사용한다. 판정 전에 표시용 반올림을 하지 않으며 같은 versioned artifact와 입력은 지원되는 Go runtime에서 같은 score와 difficulty를 만들어야 한다. 외부 LLM, embedding, network, clock, randomness, runtime 재학습 또는 자동 보정을 사용하지 않는다. `NaN`, infinity 또는 `0.0~1.0` 밖 값을 만들 수 있는 artifact는 승격하지 않는다. 이 계약은 다른 언어와 CPU 사이의 bit-for-bit 동일성을 약속하지 않는다.

Calibrated `0.8`은 평가 모집단에서 비슷한 score를 받은 표본의 실제 `complex` 비율이 약 80%에 가깝도록 보정됐다는 뜻이다. 개별 요청이 절대적으로 80% 확률로 complex임을 보장하지 않으며 dataset 구성, sample size, category 분포와 distribution drift에 영향을 받는다. Confidence, SLA 또는 개별 요청의 확정적 진실로 해석하지 않는다.

현재 as-built에는 `difficulty-feature-vector.v1` encoder만 존재하며 model/calibrator artifact와 `DifficultyResult.ComplexityScore`는 없다. Vectorizer는 rule-based runtime에서 호출하지 않는다. Versioned model artifact, family-disjoint train/calibration/holdout evidence와 현재 rule-based baseline 대비 safety gate가 준비되기 전까지 현재 runtime behavior를 유지한다.

`ModelCapabilityFeatures`의 input token estimate와 tool intent는 category/difficulty feature가 아니다. 별도 extractor와 struct로 유지하며 canonical classification pipeline에서는 호출하지 않는다.

## 3. Runtime Representation

“Feature JSON”은 구조 설명을 위한 표현일 뿐 Gateway wire format이 아니다. Gateway 내부에서는 JSON 직렬화나 역직렬화 없이 Go struct를 직접 전달한다.

다음 동작은 Gateway hot path에 추가하지 않는다.

- feature 추출을 위한 외부 LLM 호출
- embedding 호출
- 별도 네트워크 요청
- clock 또는 randomness에 의존하는 score 계산
- runtime model 학습 또는 calibrator 재학습
- feature 객체의 JSON 변환과 재파싱

정규화, 토큰화, 길이 계산은 `ExtractPromptFeatures`에서 한 번만 수행한다. Category 분류와 difficulty 분류는 같은 `PromptFeatures` 값을 공유한다.

## 4. Compatibility Policy

기존 `Classify(prompt)`, `Classify(prompt, category)`, `ExtractRoutingSignals`와 `RoutingSignals`는 기존 내부 호출을 위한 compatibility wrapper로만 유지한다. Wrapper는 새 feature/result 경로에 위임해야 한다.

다음 코드에서는 compatibility wrapper를 사용하지 않는다.

- `SimpleRouter`와 Gateway 제품 런타임
- routing evaluation CLI와 신규 offline 평가 코드
- 새로 작성하는 classifier consumer

새 코드는 `RuleBasedPromptClassifier` 또는 feature 기반 classifier 메서드를 사용한다.

## 5. Data Safety

정규화 문자열과 token은 원문 prompt에서 파생된 민감한 내부 값이다. Go 구조체의 비공개 필드로 유지하며 다음 경계로 전달하지 않는다.

- API response
- routing diagnostics
- structured log와 request log
- event payload
- metric name 또는 label
- fixture와 evaluation report

`PromptFeatures`와 `DifficultyFeatures`에 JSON field를 추가하지 않는다. 향후 `DifficultyResult.ComplexityScore`를 구현할 때도 외부 JSON 직렬화에서 제외하고, approved offline evaluator만 별도 report DTO에 최종 score를 명시적으로 투영한다. 제품 API/response, DB, Event, Metrics, RuntimeConfig, RuntimeSnapshot, routing policy, structured/request log, invocation summary, provider-attempt, 비용 정산, cache key와 제품 diagnostics에는 score, raw probability, logit, calibrator material 또는 threshold를 추가하지 않는다.

Offline evaluation은 synthetic 또는 안전하게 redacted된 approved data에서 sampleId, expected/actual category와 difficulty, 최종 `ComplexityScore`, policy/artifact provenance와 calibration 집계를 포함할 수 있다. Raw probability, logit, raw matched phrase, 정규화 문자열, token, 원문/encoded feature, feature별 coefficient contribution, provider/model/tier/catalog 정보, 실제 비용, raw prompt/response 또는 민감한 error detail은 offline report에도 추가하지 않는다.

## 6. Feature Decision And Tuning Boundary

이 문서는 공통, category intent, 공통 난이도, category별 난이도 feature family와 Logistic Regression·calibration·global threshold의 target 경계를 정의한다. 다음 항목은 여전히 별도 offline evidence와 artifact 승격이 필요하다.

- coefficient, intercept, regularization/solver 설정과 model artifact hash
- versioned calibrator candidate 목록, tie tolerance, 단순성 순서와 선택된 parameter
- family-disjoint train/calibration/holdout dataset과 split policy
- 외부 계약으로 사용하는 `complexity_score`
- score의 API, DB, Event, Metrics 또는 제품 diagnostics 노출

`train`은 단일 Logistic Regression 학습에, `calibration`은 전역 calibrator 선택·학습에, untouched `holdout`은 final gate에만 사용한다. 같은 prompt family나 단순 변형을 split 사이에 나누지 않는다. Calibrator는 calibration split 내부의 deterministic family-grouped cross-validation에서 평균 log loss, 허용 오차 안의 Brier score, versioned 단순성 순서로 선택하며 identity calibrator를 baseline 후보에 포함한다. 선택 후 calibration 전체로 다시 fit하고 holdout을 본 뒤 model, encoder 또는 calibrator를 재선택하지 않는다.

Holdout에서 candidate의 전체 및 각 category `complex -> simple` count/rate가 현재 rule-based baseline보다 증가하면 runtime으로 승격하지 않는다. 전체 및 category별 log loss, Brier score, reliability bin, directional error, oracle-category와 end-to-end 결과를 함께 보고한다. Score의 외부 노출은 이 구현 문서만으로 허용하지 않는다.

## 7. Acceptance

- 이번 문서 변경만으로 현재 fixture, evaluator 또는 runtime difficulty 결과를 바꾸지 않는다.
- `SimpleRouter`의 표준 경로는 공통 전처리를 한 번만 실행한다.
- Category 결과가 확정되기 전에 category별 difficulty feature를 계산하지 않는다.
- `DifficultyFeatures`에는 확정된 category의 전용 feature set 하나만 존재한다.
- `difficulty-feature-vector.v1`은 고정 순서와 encoding으로 항상 독립적인 42차원 `[]float64`를 반환한다.
- 확정 category block만 값을 가지며 다른 category block은 모두 zero-fill한다.
- Vectorizer 추가만으로 current rule-based runtime behavior를 변경하지 않는다.
- Artifact 승격 후 `ComplexityScore`는 finite한 inclusive `0.0~1.0`의 최종 calibrated estimate로만 `DifficultyResult`에 존재한다.
- Raw probability와 logit은 `DifficultyResult`, 제품 surface 또는 offline report에 노출되지 않는다.
- 하나의 전역 Logistic Regression, 전역 calibrator와 전역 `0.5` threshold만 사용한다.
- `ComplexityScore >= 0.5`이면 `complex`, 미만이면 `simple`이다.
- 비었거나 의미 없는 입력은 sentinel `0.0 + simple`이다.
- Score와 threshold는 runtime caller가 덮어쓰지 못하며 provider/model/routing target 또는 실제 비용 정보를 사용하지 않는다.
- Versioned artifact와 family-disjoint train/calibration/holdout evidence가 없으면 current runtime을 변경하지 않는다.
- Holdout에서 전체 및 category별 `complex -> simple` 오류가 current rule-based baseline보다 증가하면 승격하지 않는다.
- Model capability feature는 category/difficulty 분류 입력에 섞지 않는다.
- Product runtime과 evaluation CLI는 compatibility wrapper를 사용하지 않는다.
- Raw matched phrase, 정규화 문자열, token, 원문/encoded feature와 feature contribution은 제품 또는 offline diagnostics에 추가하지 않는다.
- 외부 API, DB, Event, Metrics, RuntimeSnapshot, routing policy shape는 변경하지 않는다.
