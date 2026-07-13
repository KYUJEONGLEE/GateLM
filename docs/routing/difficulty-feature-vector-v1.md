# GateLM Difficulty Feature Vector v1

| Field | Value |
|---|---|
| Status | Active internal feature contract |
| Applies to | Logistic Regression input encoding for general Gateway difficulty classification |
| Feature version | `difficulty-feature-vector.v1` |
| Dimension | `42` |
| Index base | `0` |
| Canonical implementation | `VectorizeDifficultyFeaturesV1` in Go |
| Last verified | 2026-07-13 |

이 문서는 `DifficultyFeatures`를 단일 전역 Logistic Regression의 고정 길이 `[]float64` 입력으로 변환하는 v1 계약이다. 기존 `ExtractPromptFeatures`와 `ExtractDifficultyFeatures`의 추출 규칙은 바꾸지 않는다. 이 vectorizer의 존재만으로 model, coefficient, calibrator 또는 runtime 승격이 완료됐다고 간주하지 않는다.

## 1. Versioned API

Canonical Go API는 다음과 같다.

```go
const DifficultyFeatureVectorVersionV1 = "difficulty-feature-vector.v1"
const DifficultyFeatureVectorDimensionV1 = 42

func DifficultyFeatureNamesV1() []string
func VectorizeDifficultyFeaturesV1(features DifficultyFeatures) []float64
```

`DifficultyFeatureNamesV1`은 호출자가 계약 저장소를 변경하지 못하도록 복사본을 반환한다. `VectorizeDifficultyFeaturesV1`은 호출마다 독립적인 길이 42의 새 slice를 반환한다. Logistic Regression intercept `b`는 model artifact에 별도로 두며 이 벡터에 포함하지 않는다.

## 2. Feature Order

Feature 이름과 순서는 다음과 같이 고정한다.

| Index | Feature | Encoding |
|---:|---|---|
| 0 | `payloadEmpty` | payload one-hot |
| 1 | `payloadSmall` | payload one-hot |
| 2 | `payloadMedium` | payload one-hot |
| 3 | `payloadLarge` | payload one-hot |
| 4 | `taskCount` | numeric, max 5 |
| 5 | `constraintCount` | numeric, max 6 |
| 6 | `scopeCount` | numeric, max 4 |
| 7 | `dependencyDepth` | numeric, max 5 |
| 8 | `categoryGeneral` | category one-hot |
| 9 | `categoryCode` | category one-hot |
| 10 | `categoryTranslation` | category one-hot |
| 11 | `categorySummarization` | category one-hot |
| 12 | `categoryReasoning` | category one-hot |
| 13 | `generalWorkflowDepth` | numeric, max 5 |
| 14 | `generalBranchOrExceptionCount` | numeric, max 5 |
| 15 | `generalExtractionBreadth` | numeric, max 6 |
| 16 | `generalHasCrossSourceSynthesis` | boolean |
| 17 | `codeOperationUnknown` | code operation one-hot |
| 18 | `codeOperationSyntax` | code operation one-hot |
| 19 | `codeOperationExample` | code operation one-hot |
| 20 | `codeOperationSmallEdit` | code operation one-hot |
| 21 | `codeOperationDebug` | code operation one-hot |
| 22 | `codeOperationRefactor` | code operation one-hot |
| 23 | `codeOperationDesign` | code operation one-hot |
| 24 | `codeOperationMigration` | code operation one-hot |
| 25 | `codeOperationConcurrency` | code operation one-hot |
| 26 | `codeOperationPerformance` | code operation one-hot |
| 27 | `codeScopeBreadth` | numeric, max 4 |
| 28 | `codeCausalComplexity` | numeric, max 4 |
| 29 | `codeEngineeringConstraintCount` | numeric, max 6 |
| 30 | `translationScopeCount` | numeric, max 4 |
| 31 | `translationPreservationConstraintCount` | numeric, max 7 |
| 32 | `translationDomainTerminologyLevel` | numeric, max 2 |
| 33 | `translationLocalizationDegree` | numeric, max 2 |
| 34 | `summarizationSourceBreadth` | numeric, max 4 |
| 35 | `summarizationSynthesisLevel` | numeric, max 2 |
| 36 | `summarizationFacetCount` | numeric, max 7 |
| 37 | `summarizationHasTraceabilityConstraints` | boolean |
| 38 | `reasoningAlternativeCount` | numeric, max 4 |
| 39 | `reasoningCriteriaAndConstraintCount` | numeric, max 8 |
| 40 | `reasoningDepth` | numeric, max 5 |
| 41 | `reasoningUncertaintyScenarioCount` | numeric, max 6 |

## 3. Numeric And Boolean Encoding

모든 숫자형 feature는 해당 상한으로 clipping한 뒤 다음 공식으로 scaling한다.

```text
scaled = float64(clamp(value, 0, max)) / float64(max)
```

음수와 0은 `0.0`, 상한 이상은 `1.0`이다. 표시용 반올림은 적용하지 않는다.

Boolean은 `false -> 0.0`, `true -> 1.0`으로 변환한다.

## 4. Enum Encoding And Unknown Handling

### 4.1 Payload size

허용값은 `empty | small | medium | large`이고 index 0~3 순서로 one-hot encoding한다. 계약 밖의 값은 네 칸을 모두 `0.0`으로 둔다. 계약 밖의 값을 실제 empty payload로 간주하지 않는다.

실제 empty 입력에서 extractor가 만든 literal `empty`는 `payloadEmpty = 1.0`이다.

### 4.2 Category

허용값은 `general | code | translation | summarization | reasoning`이다. 계약 밖이거나 비어 있는 값은 기존 `canonicalCategory` 규칙으로 `general`에 접는다. 따라서 category one-hot은 항상 다섯 칸 중 정확히 하나가 `1.0`이다.

### 4.3 Code operation

허용값과 one-hot 순서는 다음과 같다.

```text
unknown | syntax | example | small_edit | debug |
refactor | design | migration | concurrency | performance
```

선택된 code pointer가 존재하면서 `codeOperationKind`가 비어 있거나 계약 밖이면 `codeOperationUnknown = 1.0`이다. 선택된 code pointer 자체가 nil이면 code block 전체가 `0.0`이다.

## 5. Category Block Zero-Fill

정규화된 확정 category만 block 선택에 사용한다.

- 선택 category의 pointer만 읽는다.
- 비선택 category pointer에 값이 있어도 무시한다.
- 선택 pointer가 nil이면 해당 block 전체를 `0.0`으로 둔다.
- pointer 상태로 category를 추론하거나 교정하지 않는다.
- 비정상 내부 입력에서도 panic하지 않고 길이 42의 벡터를 반환한다.

Category별 block 범위는 다음과 같다.

| Category | Active block |
|---|---:|
| `general` | 13~16 |
| `code` | 17~29 |
| `translation` | 30~33 |
| `summarization` | 34~37 |
| `reasoning` | 38~41 |

예를 들어 category가 `code`인데 `general` pointer만 존재하면 `categoryCode = 1.0`이고 모든 category-specific block은 `0.0`이다.

## 6. Empty Input And Runtime Boundary

Empty prompt를 정상 추출한 `DifficultyFeatures`는 다음 두 값만 `1.0`이다.

```text
payloadEmpty
categoryGeneral
```

Vectorizer는 이 입력도 계약대로 인코딩한다. 현재 rule-based runtime은 empty 또는 meaningless 입력을 기존 방식으로 `simple` 처리하며 vectorizer를 호출하지 않는다. 검증된 model·calibrator artifact와 holdout safety gate가 승격되기 전까지 `SimpleRouter`, Gateway hot path와 `RuleBasedDifficultyClassifier`의 동작을 바꾸지 않는다.

## 7. Data Safety

벡터는 package-private `DifficultyFeatures`의 숫자·boolean·low-cardinality enum만 사용한다. Raw prompt, raw response, 정규화 문자열, token, matched phrase, provider/model 정보, 실제 가격 또는 tenant budget을 추가하지 않는다.

Encoded vector는 API, DB, Event, Metrics, RuntimeConfig, RuntimeSnapshot, routing policy, structured/request log, invocation summary, provider-attempt, 비용 정산, cache key 또는 제품 diagnostics에 노출하지 않는다. `DifficultyFeatures`의 기존 JSON 결과 `{}`도 유지한다.

## 8. Version Policy

다음 변경은 v1을 수정하지 않고 새 feature version을 요구한다.

- feature 추가 또는 삭제
- feature 이름, 순서 또는 전체 차원 변경
- clipping 상한 또는 scaling 공식 변경
- enum 허용값, 순서 또는 unknown 처리 변경
- category 정규화 또는 zero-fill 의미 변경
- intercept 포함 여부 변경

구현이 이 문서의 v1 의미와 다르게 동작하는 버그를 계약대로 바로잡는 것은 새 version을 요구하지 않는다.
