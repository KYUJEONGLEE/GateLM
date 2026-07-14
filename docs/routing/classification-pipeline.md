# GateLM Routing Classification Pipeline

| Field | Value |
|---|---|
| Status | Active routing target contract; logistic/calibration artifacts pending |
| Applies to | General Gateway category and difficulty classification hot path |
| Canonical implementation | Go structs and deterministic local inference |
| Active entrypoint | [`README.md`](README.md) |
| Last verified | 2026-07-14 |

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

Count 계열은 bounded local rule로 계산한다. 영문 phrase는 단어 경계와 제한된 굴절 suffix에서만 일치시키고, 한국어 phrase는 rule에 명시한 어근만 사용한다. 동의어·표기 변형은 semantic family로 묶어 같은 의미를 중복 계수하지 않는다. 작업 수는 서로 다른 키워드 수가 아니라 문장·목록·연결어로 분리한 instruction 작업 단위 수이며, 같은 action이 서로 다른 작업 단위에 반복되면 각각 계산한다.

입력이 scan limit을 넘으면 전체 prefix만 사용하는 대신 bounded head와 tail을 함께 사용하고 truncation 여부를 내부에 보관한다. 줄바꿈과 불릿·번호 목록 구조는 whitespace collapse 전에 추출한다. 숫자+단위 scope, `A와 B` 형태의 명시적 named pair, instruction 목록 항목 수와 명시적인 top-level payload block 수를 bounded scope evidence로 사용한다.

`languageBucket`은 `ko | en | mixed | unknown`이고 언어 자체를 난이도로 사용하지 않는다. `instructionText`와 `payloadText`는 아래의 명시적인 구조가 있을 때만 보수적으로 분리하며 둘 다 원문 파생 민감 값으로 취급한다. 명시적 경계가 없으면 길이, 문체 또는 keyword만으로 payload를 추측하지 않는다. API의 structured content part와 attachment 경계는 이 parser의 입력이 아니며 별도 upstream 작업이다.

현재 deterministic payload boundary parser가 인식하는 문법은 다음과 같다.

- 모든 triple-backtick code fence
- attribute를 허용하는 paired XML-like role tag
- 한 줄 전체를 사용하는 bracket, Markdown heading 또는 colon role heading
- 한 줄 전체의 `BEGIN role`/`END role`, `role 시작`/`role 끝`과 선택적인 `---`/`===` 장식
- 바깥의 비어 있지 않은 instruction에 승인된 처리 action이 있는 연속 Markdown blockquote
- 승인된 처리 action과 `following content | following text | content below | text below | 다음 내용 | 다음 원문 | 다음 자료 | 아래 내용 | 아래 원문 | 아래 자료`가 같은 줄의 `:` 앞에 함께 있는 제한 cue; 이 경우 delimiter 뒤부터 EOF까지 payload

Instruction role whitelist는 `instruction | instructions | task | request | 명령 | 지시 | 요청 | 작업`이고 payload role whitelist는 `document | source | content | payload | attachment | 원문 | 처리할 원문 | 처리할 내용 | 내용 | 자료 | 첨부`다. 승인된 action family는 summarize/condense, translate/localize, analyze/review, extract, compare, explain, fix/debug/refactor와 대응하는 한국어 `요약/압축/정리`, `번역/현지화`, `분석/검토`, `추출`, `비교`, `설명`, `수정/디버깅/리팩터링`으로 제한한다. `input`, `output`, `data`, `context`, `body`, `message`, `system`, `requirements`, `constraints`, `format`은 role로 해석하지 않는다.

텍스트에서 가장 먼저 열린 outermost payload boundary가 내부 marker를 소유하므로 nested marker는 별도 payload block이나 evidence로 다시 세지 않는다. 짝 없는 closing marker와 self-closing tag는 instruction에 남긴다. 짝 없는 payload opening tag, code fence 또는 BEGIN marker는 EOF까지 payload로 분리하되 confidence를 `low`로 둔다. Bounded head+tail scan의 생략 구간을 경계가 가로지르거나 tail의 첫 명시적 closing으로 opening을 복원한 경우에도 `low`다. 독립적인 payload block이 여러 개면 evidence bit를 OR하고 confidence는 가장 낮은 block 기준으로 집계한다. Evidence와 `none | low | medium | high` confidence는 package-private이며 API, log, event, metric 또는 report로 투영하지 않는다.

모든 code fence를 순서대로 파싱하고, task·constraint·dependency는 instruction만 사용한다. 분리된 payload는 기존 payload size bucket, top-level payload block count와 code structural evidence에만 사용하며 scope는 instruction을 기준으로 하되 명시적인 source block 수만 보완한다. Category intent phrase와 token은 instruction만 사용하고 fenced payload는 code-like structure가 확인될 때만 code structural evidence가 된다. `PromptFeatures`에는 다음 분류 결과를 넣지 않는다.

- category
- category diagnostics 또는 category score
- difficulty
- complexity score

Category classifier는 `PromptFeatures`로부터 네 non-general category 각각의 내부 `CategoryIntentFeatures`를 만든다. 각 feature set은 action, object fit, structural evidence, action-object pair, negative context score만 가진다. `general`은 별도 intent score를 만들지 않고 다른 category가 충분한 근거를 얻지 못했을 때 fallback으로 선택한다. 이 내부 score 구조는 canonical pipeline에 새 전달 단계를 추가하지 않는다.

Category intent는 단일 keyword가 아니라 bounded action-object family를 우선한다. Code의 재현·진단·계측·롤백과 로그·회귀 테스트·상태 전이, reasoning의 선택·결론과 후보·차선책·변수, summarization의 종합·중복 제거와 공통 흐름·추세·출처, translation의 명시적 대상 언어와 source text family를 결합한다. 메뉴명이나 설정명 같은 negative context는 action-object pair가 없으면 해당 category를 억제한다. 명시적인 action-object pair가 있으면 negative term을 payload 설명으로 보고 penalty만 적용하므로 `code review를 번역` 같은 요청을 code로 고정하지 않는다.

`CategoryResult`는 확정된 category와 `CategoryDiagnostics`를 반환한다.

`DifficultyFeatures`는 `PromptFeatures`와 확정된 category로부터 만든다. 공통 난이도 feature는 payload size bucket, 작업 수, 제약 수, scope 수, 의존 깊이다. Category별 feature는 다음처럼 분리한다.

- `general`: workflow depth, branch/exception 수, extraction breadth, cross-source synthesis
- `code`: operation kind, code scope breadth, causal complexity, engineering constraint 수
- `translation`: translation scope, preservation constraint 수, domain terminology level, localization degree
- `summarization`: source breadth, synthesis level, facet 수, traceability constraint
- `reasoning`: alternative 수, criteria/constraint 수, reasoning depth, uncertainty/scenario 수

`DifficultyFeatures`에는 확정된 category의 feature pointer 하나만 채운다. 다른 category의 feature를 미리 계산하거나 보관하지 않는다.

Category별 난이도 phrase도 instruction에서만 읽고 alias를 semantic family로 묶는다. General은 준비·실행·검증 단계, 정상·예외·대체 경로와 cross-source synthesis를 구분한다. Code는 재현 조건·원인·간헐 실패·관측 지점과 동작·오류 처리·성능·무중단·순서·중복·롤백 제약을 구분한다. Translation은 대상 언어 수와 정의 용어·용어집·번호·참조·단위·변수·서식·톤 보존을 구분하며 명시적인 no-localization 문맥은 localization 근거로 세지 않는다. Summarization은 source breadth, 공통 흐름·timeline·중복 제거 synthesis, 결정·근거·충돌·후속 조치·추세·예외 facet과 traceability를 구분한다. Reasoning은 후보·차선책, 예산·선행 조건·실패 비용, 시나리오·가정·결론 반전 근거를 구분한다.

`DifficultyFeatureNamesV1`과 `VectorizeDifficultyFeaturesV1`은 `difficulty-feature-vector.v1`의 고정 42차원 이름·순서·scaling·enum·zero-fill 계약을 구현한다. Vectorizer는 현재 rule-based runtime 판정에 연결하지 않으며 exact 계약은 [`difficulty-feature-vector-v1.md`](difficulty-feature-vector-v1.md)를 따른다.

Artifact 승격 후 `DifficultyResult`가 가져야 할 canonical 내부 의미는 다음 두 값이다.

- `ComplexityScore`: model path에서는 최종 보정된 finite inclusive `0.0~1.0`의 complex 확률 추정값이며 deterministic bypass에서는 아래 sentinel
- `Difficulty`: `simple | complex`

`ComplexityScore`만 result에 둔다. 선형 logit `z`, Logistic Regression이 출력한 미보정 확률 `sigmoid(z)`, calibrator 중간값, threshold와 feature contribution은 `DifficultyResult`, `PromptFeatures` 또는 `DifficultyFeatures`에 넣지 않는다. 비었거나 의미 없는 입력은 모델과 calibrator를 통과하지 않고 `ComplexityScore = 0.0`, `Difficulty = simple`로 반환한다. 결합된 hard-complex evidence score가 threshold에 도달하면 `ComplexityScore = 1.0`, `Difficulty = complex`로 반환한다. `0.0`과 `1.0`은 calibrated estimate가 아니라 각각 empty-input과 hard-complex 동작을 보존하는 deterministic sentinel이다.

Difficulty score의 target 계산은 다음 순서를 사용한다. Bounded-simple 수동 점수나 별도 simple short-circuit은 target classifier에 두지 않는다.

```text
empty or meaningless → 0.0 + simple sentinel
hard-complex structural evidence → 1.0 + complex sentinel
remaining DifficultyFeatures
  → VectorizeDifficultyFeaturesV1
  → difficulty-feature-vector.v1 []float64
  → difficulty-logistic-v1 single global regularized Logistic Regression
  → z = w·x + b
  → raw probability = sigmoid(z)
  → difficulty-calibration-v1 selected single global calibrator
  → ComplexityScore
  → difficulty-threshold-v1 global 0.45
  → Difficulty
```

`hasHardComplexEvidence`는 기존 `DifficultyFeatures`만 사용하는 bounded evidence score로 계산한다. 공통 score와 확정 category score를 따로 계산하고 어느 한쪽이 `3` 이상일 때만 hard sentinel을 적용하며 두 score를 서로 더하지 않는다.

- 공통 score: `medium | large` payload는 `+1`; task/constraint는 `2+`에서 `+1`, `3+`에서 `+2`; scope는 `2+`에서 `+1`, `4+`에서 `+2`; dependency depth는 `2+`에서 `+1`, `3+`에서 `+2`
- category score: 기존 category complex threshold 하나는 일반적으로 `+2`; code operation kind 자체와 summarization source breadth·traceability처럼 단일 proxy 성격이 강한 값은 `+1`
- 따라서 `large`, `debug`, `refactor` 하나만으로는 hard sentinel이 되지 않는다. 여러 category 근거 또는 강한 근거와 추가 proxy가 결합되어 score `3+`가 되어야 한다.

현재 rule-based product runtime은 안전한 비악화를 위해 부족한 근거를 계속 `complex`로 처리한다. 다만 작업·제약·scope·의존 깊이가 모두 `1` 이하이고 category별 추가 구조 근거가 없는 경우, `medium | large` payload size 하나 또는 `debug`/`refactor` operation 하나는 bounded single-proxy simple 예외로 처리한다. 독립 proxy가 둘 이상이면 이 예외를 적용하지 않는다. 이 product-only simple 예외와 기존 bounded-simple 규칙은 hybrid model path를 short-circuit하지 않는다. Hard-complex 조건 변경은 feature·dataset·holdout evidence와 함께 검토한다.

모든 category는 하나의 Logistic Regression, 하나의 calibrator와 하나의 threshold를 공유한다. Category별 model, calibrator 또는 threshold는 허용하지 않는다. 기존 공통 및 선택된 category의 `DifficultyFeatures`만 model input으로 사용하며 raw text, token, matched phrase, provider/model/modelRef/tier/catalog metadata, resolved target, 실제 가격, tenant budget 또는 별도 runtime 신호를 추가하지 않는다.

정확한 feature 순서, 숫자 정규화, bucket/enum encoding과 category zero-fill은 `difficulty-feature-vector.v1`로 고정한다. Coefficient, intercept, regularization/solver 설정, model artifact hash와 calibrator parameter는 offline evidence 이후 별도의 immutable artifact version과 content hash로 고정한다. `difficulty-logistic-v1`과 `difficulty-calibration-v1`은 각각 model family와 calibrator 선택·검증 절차를 정의하는 policy version이며 아직 존재하지 않는 artifact가 구현됐음을 뜻하지 않는다.

Platt와 Isotonic은 둘 다 Logistic Regression의 미보정 `raw_probability`를 입력으로 사용하고 연속 적용하지 않는다. Platt는 `sigmoid(coefficient × raw_probability + intercept)`를 계산한다. Isotonic은 exact-equal raw probability를 sample count로 묶은 뒤 인접 complex 비율 위반을 PAVA로 병합한다. Artifact의 `xThresholds`는 각 block의 포함 하한이며 runtime은 `xThresholds[i] <= raw_probability < xThresholds[i+1]`인 `yThresholds[i]`를 반환하는 계단형 floor lookup과 양끝 clipping을 사용한다. 선형 보간, 고정 score bin, epsilon grouping, label-confidence weighting과 자동 small-block 병합은 사용하지 않는다. PAVA가 하나의 constant block만 만들어도 유효하다.

초기 global threshold policy는 `difficulty-threshold-v1 = 0.45`다. `ComplexityScore >= 0.45`이면 `complex`, 미만이면 `simple`이다. `0.45`는 evidence-selected optimum이 아닌 bootstrap/default 값이다. 향후 evidence가 다른 값을 지지하면 v1을 수정하지 않고 새 global threshold policy version을 만든다. Request, tenant, RuntimeConfig, RuntimeSnapshot, 환경변수 또는 runtime caller가 threshold를 덮어쓰지 못한다.

Runtime inference는 `float64`, 고정 feature order/encoding, 고정 coefficient/intercept, 고정 sigmoid와 calibrator implementation을 사용한다. 판정 전에 표시용 반올림을 하지 않으며 같은 versioned artifact와 입력은 지원되는 Go runtime에서 같은 score와 difficulty를 만들어야 한다. 외부 LLM, embedding, network, clock, randomness, runtime 재학습 또는 자동 보정을 사용하지 않는다. `NaN`, infinity 또는 `0.0~1.0` 밖 값을 만들 수 있는 artifact는 승격하지 않는다. 이 계약은 다른 언어와 CPU 사이의 bit-for-bit 동일성을 약속하지 않는다.

Model path의 calibrated `0.8`은 평가 모집단에서 비슷한 score를 받은 표본의 실제 `complex` 비율이 약 80%에 가깝도록 보정됐다는 뜻이다. 개별 요청이 절대적으로 80% 확률로 complex임을 보장하지 않으며 dataset 구성, sample size, category 분포와 distribution drift에 영향을 받는다. Confidence, SLA 또는 개별 요청의 확정적 진실로 해석하지 않는다. 두 deterministic sentinel은 calibration bin, log loss와 Brier score에서 제외하고 model-path calibration과 end-to-end hybrid directional error를 분리해서 보고한다.

현재 as-built에는 `difficulty-feature-vector.v1` encoder, [`difficulty-logistic-training.md`](difficulty-logistic-training.md)의 비활성 offline 준비 tooling, validated artifact를 명시적으로 입력받는 hybrid classifier와 opt-in shadow evaluator가 존재한다. Tooling은 500건 synthetic training-tooling smoke 재생성, smoke 내부 family-disjoint partition, sentinel과 model path를 구분하는 canonical Go vector export, model-path 표본만 사용하는 Python Logistic Regression·calibrator fit, JSON artifact 검증·Go code generation과 package-private inference math를 제공한다. 500건은 모두 `human review pending`이고 별도 manifest가 `trainingEligible=false`로 고정하므로 model/calibrator/threshold 또는 promotion evidence로 사용할 수 없다. Checked-in model/calibrator artifact도 없다. Shadow evaluator는 `-difficulty-shadow-model-artifact`가 없으면 실행되지 않으며 `SimpleRouter`와 current product runtime은 계속 rule-based classifier를 사용한다. Versioned minimum-family policy를 만족하는 approved human-reviewed dataset, immutable artifact, family-disjoint train/calibration/holdout evidence와 현재 rule-based baseline 대비 safety gate가 준비되기 전까지 runtime behavior를 유지한다.

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

Unicode compatibility normalization, bounded head+tail scan, code-fence 분리, 목록 구조 추출, whitespace 정규화, 토큰화와 길이 계산은 `ExtractPromptFeatures`에서 한 번만 수행한다. Category 분류와 difficulty 분류는 같은 `PromptFeatures` 값을 공유한다.

Package-private `difficultyEmbeddingInput`은 향후 semantic encoder를 위한 dormant input boundary다. 의미 있는 `instructionText`만 반환하며 `normalizedText`, `payloadText` 또는 raw prompt로 fallback하지 않는다. Payload-only 또는 의미 없는 instruction이면 encoder candidate가 없다고 반환한다. 이 helper는 tokenizer, embedding model, projection, head 또는 classifier를 호출하지 않으며 current hot path와 `difficulty-feature-vector.v1` 42차원 계약을 변경하지 않는다.

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

Offline evaluation은 synthetic 또는 안전하게 redacted된 approved data에서 sampleId, expected/actual category와 difficulty, model-path calibrated score 또는 deterministic sentinel인 최종 `ComplexityScore`, policy/artifact provenance, current runtime 대비 변경, 긴 simple·짧은 complex segment와 분리된 calibration 집계를 포함할 수 있다. Raw probability, logit, raw matched phrase, 정규화 문자열, token, 원문/encoded feature, feature별 coefficient contribution, provider/model/tier/catalog 정보, 실제 비용, raw prompt/response 또는 민감한 error detail은 offline report에도 추가하지 않는다.

## 6. Feature Decision And Tuning Boundary

이 문서는 공통, category intent, 공통 난이도, category별 난이도 feature family와 Logistic Regression·calibration·global threshold의 target 경계를 정의한다. 다음 항목은 여전히 별도 offline evidence와 artifact 승격이 필요하다.

- 실제 evidence run에서 선택된 coefficient, intercept, regularization 강도와 model artifact hash
- 실제 evidence run에서 선택된 calibrator와 parameter
- synthetic pilot의 human review 또는 별도 승인된 학습 dataset
- 외부 계약으로 사용하는 `complexity_score`
- score의 API, DB, Event, Metrics 또는 제품 diagnostics 노출

`train`은 단일 Logistic Regression 학습에, `calibration`은 전역 calibrator 선택·학습에, untouched `holdout`은 final gate에만 사용한다. 같은 prompt family나 단순 변형을 split 사이에 나누지 않는다. Calibrator candidate는 `platt`, `isotonic` 두 종류만 허용한다. Calibration split 내부의 deterministic family-grouped cross-validation에서 평균 log loss를 먼저 비교하고 `0.000001` 허용 오차 안이면 평균 Brier score, 그래도 같으면 Platt 순서로 선택한다. 한 후보의 fit 또는 검증이 실패하면 유효한 다른 후보를 사용할 수 있지만 둘 다 실패하면 artifact를 만들지 않고 학습을 실패시킨다. Identity calibrator와 무보정 fallback은 없다. 선택된 후보 하나만 calibration 전체로 한 번 다시 fit하고 holdout을 본 뒤 model, encoder 또는 calibrator를 재선택하지 않는다. Isotonic CV report에는 fold별 block count와 최소 block 표본 수만 두고, 선택된 Isotonic의 전체 calibration fit에는 block count와 block sample count만 둘 수 있다. Raw probability, logit과 score 경계는 report에 두지 않는다.

Holdout에서 sentinel을 포함한 end-to-end candidate의 전체 및 각 category `complex -> simple` count/rate가 현재 rule-based baseline보다 증가하면 runtime으로 승격하지 않는다. Model path만의 전체 및 category별 log loss, Brier score와 reliability bin, sentinel을 포함한 directional error, oracle-category와 end-to-end 결과, 긴 simple과 짧은 complex segment를 함께 보고한다. Score의 외부 노출은 이 구현 문서만으로 허용하지 않는다.

## 7. Acceptance

- Opt-in shadow artifact가 없으면 현재 fixture, evaluator 또는 runtime difficulty 결과를 바꾸지 않는다.
- `SimpleRouter`의 표준 경로는 공통 전처리를 한 번만 실행한다.
- Category 결과가 확정되기 전에 category별 difficulty feature를 계산하지 않는다.
- `DifficultyFeatures`에는 확정된 category의 전용 feature set 하나만 존재한다.
- `difficulty-feature-vector.v1`은 고정 순서와 encoding으로 항상 독립적인 42차원 `[]float64`를 반환한다.
- 확정 category block만 값을 가지며 다른 category block은 모두 zero-fill한다.
- Vectorizer 추가만으로 current rule-based runtime behavior를 변경하지 않는다.
- Hybrid `ComplexityScore`는 model path의 finite inclusive `0.0~1.0` calibrated estimate 또는 deterministic `0.0`/`1.0` sentinel로만 존재한다.
- Raw probability와 logit은 `DifficultyResult`, 제품 surface 또는 offline report에 노출되지 않는다.
- 하나의 전역 Logistic Regression, 전역 calibrator와 전역 `0.45` threshold만 사용한다.
- Platt와 Isotonic을 calibration family group CV에서 비교하되 선택된 하나만 artifact와 inference에 둔다.
- Isotonic은 포함 하한 기반 계단형 floor lookup이며 선형 보간하지 않고 single-block artifact도 허용한다.
- `ComplexityScore >= 0.45`이면 `complex`, 미만이면 `simple`이다.
- 비었거나 의미 없는 입력은 sentinel `0.0 + simple`이다.
- 명백한 hard-complex 구조 evidence는 sentinel `1.0 + complex`다.
- `medium | large` payload size, `debug`, `refactor` 단일 proxy는 hard-complex sentinel이 아니며 hybrid model path로 전달한다.
- Current rule-based runtime은 bounded single-proxy 요청만 `simple` 예외로 처리하고 독립 proxy가 둘 이상이면 기존 complex 판정을 유지한다.
- Bounded-simple 수동 score와 short-circuit은 hybrid classifier에 적용하지 않는다.
- Score와 threshold는 runtime caller가 덮어쓰지 못하며 provider/model/routing target 또는 실제 비용 정보를 사용하지 않는다.
- Versioned artifact와 family-disjoint train/calibration/holdout evidence가 없으면 current runtime을 변경하지 않는다.
- Holdout에서 전체 및 category별 `complex -> simple` 오류가 current rule-based baseline보다 증가하면 승격하지 않는다.
- Model capability feature는 category/difficulty 분류 입력에 섞지 않는다.
- 명시적 payload boundary가 없으면 payload를 추측하지 않고, outermost boundary 내부 marker를 중복 계수하지 않는다.
- Payload split evidence와 confidence는 package-private이며 제품 또는 offline surface에 노출하지 않는다.
- Dormant semantic input helper는 의미 있는 `instructionText`만 허용하고 `normalizedText` 또는 payload로 fallback하지 않는다.
- Tokenizer, encoder, embedding, projection 또는 semantic head를 Gateway hot path에서 실행하지 않는다.
- Product runtime과 evaluation CLI는 compatibility wrapper를 사용하지 않는다.
- Raw matched phrase, 정규화 문자열, token, 원문/encoded feature와 feature contribution은 제품 또는 offline diagnostics에 추가하지 않는다.
- 외부 API, DB, Event, Metrics, RuntimeSnapshot, routing policy shape는 변경하지 않는다.
