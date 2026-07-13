# GateLM Routing Classification Pipeline

| Field | Value |
|---|---|
| Status | Active routing implementation contract |
| Applies to | General Gateway category and difficulty classification hot path |
| Canonical implementation | Go structs and deterministic local rules |
| Active entrypoint | [`README.md`](README.md) |
| Last verified | 2026-07-13 |

이 문서는 일반 Gateway에서 앞으로 사용하는 category·difficulty 분류 구현 구조를 정의한다. Category와 difficulty의 의미, 허용 값, routing policy 연결은 [`contracts.md`](contracts.md)가 정의하고, 이 문서는 그 의미를 계산하는 canonical 내부 파이프라인을 정의한다.

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

`DifficultyResult`는 내부 `ComplexityScore`와 `simple | complex` difficulty를 반환한다. `ComplexityScore`는 확률이나 confidence가 아니라 현재 `DifficultyFeatures`에서 관찰한 복잡성 근거의 상대적 강도이며 inclusive `0.0~1.0` 범위다. 공통 feature와 확정된 category 전용 feature의 정수 point, 의미는 있지만 simple 범위가 충분히 bounded되지 않은 요청의 risk point를 합산하고 최대점으로 cap한 뒤 마지막에만 정규화한다. 비었거나 의미 없는 입력은 `0.0`이다.

Difficulty classifier는 이 score에 하나의 global threshold를 적용해 `simple | complex`를 결정한다. Category별 threshold, score와 별개인 boolean difficulty 판정 경로, runtime configuration으로 주입되는 threshold를 두지 않는다. 같은 `DifficultyFeatures`는 clock, randomness, network, 외부 LLM, embedding과 무관하게 항상 같은 score와 difficulty를 만든다.

현재 `difficulty_score_points_v1`은 공통 evidence unit 10점, 선택된 category evidence unit 10점, strong signal 10점, unboundedness risk 20점을 사용하고 총점을 100점으로 cap한다. `ComplexityScore = points / 100`이며 global threshold는 `0.30`이다. 배점과 threshold 선택은 다음 offline calibration 명령으로 재현하며 runtime 설정으로 바꾸지 않는다.

```powershell
corepack pnpm run calibrate:v2.1-difficulty-score
```

Score 계산은 `DifficultyFeatures`만 입력받으며 provider ID, model ID, modelRef, tier, catalog metadata 또는 resolved target을 사용하지 않는다. 확정된 difficulty가 기존 routing matrix cell 선택에 사용될 수는 있지만 score 자체를 provider/model 선택 정보와 결합하거나 routing decision surface로 전달하지 않는다. Score는 API, DB, Event, Metrics, RuntimeSnapshot, routing policy, structured log, request log 또는 제품 diagnostics에 노출하지 않는다. 외부 surface에 score를 추가하려면 별도 contract proposal과 계약 변경이 필요하다.

`ModelCapabilityFeatures`의 input token estimate와 tool intent는 category/difficulty feature가 아니다. 별도 extractor와 struct로 유지하며 canonical classification pipeline에서는 호출하지 않는다.

## 3. Runtime Representation

“Feature JSON”은 구조 설명을 위한 표현일 뿐 Gateway wire format이 아니다. Gateway 내부에서는 JSON 직렬화나 역직렬화 없이 Go struct를 직접 전달한다.

다음 동작은 Gateway hot path에 추가하지 않는다.

- feature 추출을 위한 외부 LLM 호출
- embedding 호출
- 별도 네트워크 요청
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

`PromptFeatures`와 `DifficultyFeatures`에 JSON field를 추가하지 않는다. Complexity score는 domain result인 `DifficultyResult`에만 존재하며 offline evaluator가 안전한 예측값과 집계로 투영할 수 있다. 제품 진단에는 score, point breakdown, feature별 contribution을 추가하지 않는다. 기존 low-cardinality category score와 결과만 유지하고 prompt fragment, matched raw phrase/value, 정규화 문자열, token 또는 원문 파생 feature를 추가하지 않는다.

## 6. Feature Decision And Tuning Boundary

이 문서는 공통, category intent, 공통 난이도, category별 난이도 feature family와 내부 complexity score를 active 내부 구현 의미로 정의한다. 다음 항목은 여전히 별도 offline evidence와 변경 검토가 필요하다.

- point weight 변경
- count/bucket 경계와 global threshold 조정
- 외부 계약으로 사용하는 `complexity_score`
- score의 API, DB, event, metric 노출

내부 point와 threshold 변경은 synthetic 또는 안전하게 redacted된 offline 평가의 family-disjoint calibration/holdout으로 검증한다. Oracle-category 결과로 difficulty scorer를 조정하고 end-to-end 결과로 실제 pipeline 회귀를 확인하며, `complex -> simple` directional error를 우선한다. Score의 외부 노출은 이 구현 문서만으로 허용하지 않는다.

## 7. Acceptance

- 기존 fixture의 category, diagnostics, difficulty 결과가 유지된다.
- `SimpleRouter`의 표준 경로는 공통 전처리를 한 번만 실행한다.
- Category 결과가 확정되기 전에 category별 difficulty feature를 계산하지 않는다.
- `DifficultyFeatures`에는 확정된 category의 전용 feature set 하나만 존재한다.
- `ComplexityScore`는 finite한 `0.0~1.0` 값이며 하나의 global threshold가 difficulty를 결정한다.
- 비었거나 의미 없는 입력은 `0.0 + simple`이고 의미 있지만 bounded되지 않은 요청은 fail-closed risk를 보존한다.
- Score는 `DifficultyFeatures`만 사용하고 provider/model/routing target 정보를 사용하지 않는다.
- Model capability feature는 category/difficulty 분류 입력에 섞지 않는다.
- Product runtime과 evaluation CLI는 compatibility wrapper를 사용하지 않는다.
- Raw matched phrase, 원문 파생 feature와 point breakdown은 제품 또는 offline score diagnostics에 추가하지 않는다.
- 외부 API, DB, Event, Metrics, RuntimeSnapshot, routing policy shape는 변경하지 않는다.
