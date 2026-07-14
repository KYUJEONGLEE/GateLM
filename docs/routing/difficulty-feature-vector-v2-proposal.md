# GateLM Difficulty Feature Vector v2 Proposal

| Field | Value |
|---|---|
| Status | Proposed contract; not active |
| Applies to | Offline evaluation and opt-in shadow difficulty classification only |
| Proposed feature contract | `difficulty-feature-vector.v2` |
| Current active feature contract | [`difficulty-feature-vector.v1`](difficulty-feature-vector-v1.md), fixed 42 dimensions |
| Active routing contract | [`contracts.md`](contracts.md) |
| Last reviewed | 2026-07-14 |

이 문서는 instruction semantic representation과 payload structural statistics를 결합하는 차기 difficulty feature contract를 제안한다. 이 제안은 current Gateway hot path, `DifficultyResult`, routing policy, RuntimeSnapshot 또는 category × difficulty matrix를 변경하지 않는다. Exact artifact bundle과 offline evidence가 승인되고 active routing contract가 별도로 변경되기 전까지 `difficulty-feature-vector.v2`는 제품 판정에 사용할 수 없다.

`difficulty-feature-vector.v2`는 제품 release SemVer가 아니다. 이 이름은 내부 feature contract namespace이며 현재 공식 release 또는 다음 release 번호를 선언하지 않는다.

## 1. Goals

이 제안의 목표는 다음과 같다.

- Semantic encoder는 `PromptFeatures.instructionText`만 읽는다.
- Payload는 길이, 명시적 문서 수, 표와 code block 구조처럼 bounded deterministic statistics로만 표현한다.
- Tokenizer, encoder, pooling, projection, payload statistics, feature assembly, head, calibrator와 classifier decision policy를 독립적으로 versioning한다.
- Embedding, projected embedding, assembled vector와 head output을 민감한 package-private 파생값으로 유지한다.
- Difficulty classifier의 유일한 계약 결과를 `simple | complex`로 제한한다.
- Provider와 model 선택은 기존 category × difficulty routing matrix와 catalog resolution에 남긴다.
- Offline/shadow 실패, 지연 또는 결과가 current runtime 판정과 실제 요청 실행에 영향을 주지 않게 한다.

## 2. Non-goals And Rejected Alternatives

이 제안은 다음을 수행하지 않는다.

- `difficulty-feature-vector.v1`의 42차원 이름, 순서, scaling, enum 또는 zero-fill 의미 변경
- Current rule-based classifier 또는 v1 hybrid target의 대체
- Gateway hot path 활성화 또는 runtime 승격 선언
- API, DB, Event, Metrics, RuntimeConfig, RuntimeSnapshot, routing policy, cache key 또는 제품 diagnostics 확장
- Provider, model, modelRef, tier, catalog capability, 실제 가격 또는 tenant budget을 difficulty 입력으로 사용
- Raw payload content를 tokenizer 또는 semantic encoder에 입력
- 아직 선택되지 않은 tokenizer, model weight, dimension, threshold 또는 evidence가 존재한다고 주장

“최종 분류기가 라우팅 대상 모델까지 결정한다”는 설계는 명시적으로 제외한다. Difficulty classifier가 model 또는 modelRef를 고르면 현재 [`contracts.md`](contracts.md)의 5 category × 2 difficulty matrix, ordered fallback과 catalog resolution 책임을 우회하게 된다. 이 제안의 classifier는 난이도 label만 결정한다.

## 3. v1 Compatibility

`difficulty-feature-vector.v1`은 계속 독립적인 고정 42차원 contract다. V2는 v1 vector의 in-place 확장, tail append 또는 재해석이 아니다.

- V1 feature를 추가, 삭제, 재정렬하거나 다른 scaling으로 다시 읽어서는 안 된다.
- V1 artifact가 v2 vector를 v1처럼 읽거나 v2 artifact가 v1 vector를 자동 변환해서는 안 된다.
- Offline evaluator는 version을 명시적으로 선택해야 하며 두 결과를 비교할 수만 있다.
- V2 shadow가 없거나 invalid이면 current runtime과 v1 evaluator 결과를 그대로 유지해야 한다.
- V2 proposal, manifest 또는 artifact의 존재만으로 current classifier가 바뀌어서는 안 된다.

V1과 v2의 compatibility bridge는 동일 sample에 대한 label 비교와 aggregate evaluation뿐이다. Encoded vector, coefficient 또는 intermediate score를 version 사이에서 복사하는 bridge는 허용하지 않는다.

## 4. Input Separation

### 4.1 Semantic input

Semantic path의 canonical raw-text input은 `PromptFeatures.instructionText` 하나다.

- Tokenizer와 encoder는 `normalizedText`, `payloadText`, raw prompt 또는 attachment body를 읽어서는 안 된다.
- `instructionText`가 비어 있으면 tokenizer와 encoder를 호출하지 않는다.
- Empty semantic input은 versioned zero representation과 별도의 presence bit처럼 ambiguity가 없는 방식으로 표현해야 한다. Exact representation은 feature assembly layout과 함께 activation 전에 고정한다.
- Unicode normalization, maximum input length와 truncation은 tokenizer artifact contract에 고정한다.
- Truncation이 필요하면 bounded head+tail 또는 다른 하나의 deterministic 규칙을 선택해 versioning해야 하며 runtime caller가 바꿀 수 없다.
- 원문 instruction을 외부 LLM, hosted embedding API 또는 provider adapter로 보내서는 안 된다.

Category는 semantic input text가 아니다. Current category classifier가 먼저 확정한 `general | code | translation | summarization | reasoning` 중 하나를 별도의 low-cardinality control block으로 전달할 수 있다. Category block의 순서는 다음과 같이 고정한다.

```text
general | code | translation | summarization | reasoning
```

Difficulty는 계속 category-aware여야 하지만 category 값이 provider 또는 model capability를 전달하는 통로가 되어서는 안 된다.

### 4.2 Payload input

Payload path는 `PromptFeatures.payloadText`에서 content를 복원할 수 없는 bounded structural statistics만 만든다. 허용 feature family는 다음 범위로 제한한다.

| Family | Allowed evidence | Excluded evidence |
|---|---|---|
| Size | byte 또는 rune 길이, 줄 수, empty 여부 | 원문 fragment, token text, n-gram |
| Documents | 명시적 fenced source/block 또는 versioned delimiter로 구분한 문서 수 | 문서 제목, 작성자, 본문 keyword |
| Tables | Markdown 등 versioned syntax로 확인한 표 수, bounded 행·열 구조 | cell content, header text, inferred meaning |
| Code | code fence 수, bounded code rune/line count, fence presence | code token, identifier, language 내용 분석, embedding |

각 statistic은 extractor version에 다음을 고정해야 한다.

- Exact feature name과 order
- 구조 인식 syntax와 delimiter
- Count upper bound와 clipping
- Scaling 또는 bucket encoding
- Empty, malformed와 unknown 처리
- Scan limit과 truncation 처리

Payload에 tokenizer, semantic model, keyword matcher, identifier parser, content hash 또는 bag-of-words를 적용해서는 안 된다. Fence language tag처럼 원문에서 파생된 문자열도 feature value로 보관하지 않는다. 명시적 구조를 확정할 수 없으면 해당 statistic을 unknown 또는 zero로 처리하고 내용을 추론하지 않는다.

### 4.3 Excluded inputs

다음 값은 semantic block, payload statistics, category block, head 또는 classifier decision에 사용할 수 없다.

- provider, model, modelRef, tier와 catalog metadata
- resolved target와 ordered fallback 위치
- 실제 가격, usage, tenant budget와 quota 상태
- request identity, tenant identity와 employee identity
- cache hit 여부와 provider outcome
- raw response, provider error와 secret
- `ModelCapabilityFeatures`

## 5. Canonical V2 Pipeline

제안하는 logical dataflow는 다음과 같다.

```text
Prompt
  -> ExtractPromptFeatures
  -> PromptFeatures
  -> CategoryClassifier
  -> CategoryResult.Category

PromptFeatures.instructionText
  -> versioned tokenizer
  -> versioned encoder
  -> versioned pooling
  -> versioned projection
  -> semantic feature block

PromptFeatures.payloadText
  -> versioned deterministic payload statistics
  -> payload feature block

CategoryResult.Category
  -> fixed-order category block

semantic block + payload block + category block
  -> difficulty-feature-vector.v2 assembly
  -> versioned head
  -> versioned calibrator
  -> versioned classifier decision policy
  -> simple | complex

CategoryResult.Category + Difficulty
  -> existing category x difficulty routing matrix
  -> ordered modelRefs
  -> catalog resolution
  -> internal ResolvedTarget
```

Feature assembly order는 `semantic block -> payload block -> category block`으로 제안한다. Semantic-input presence 또는 truncation flag가 필요하면 semantic block contract 안에 위치와 encoding을 명시해야 한다.

Projection과 head의 역할을 숨겨진 구현 세부사항으로 합치지 않는다. Projection은 encoder representation을 v2 semantic feature block으로 변환하고, head는 assembled v2 vector에서 uncalibrated decision material을 계산한다. Calibrator는 head output을 classifier decision policy가 사용하는 내부 calibrated value로 변환한다. Classifier는 threshold와 equality rule을 적용해 label 하나만 반환한다.

Exact semantic dimension, payload dimension, total dimension과 numeric layout은 아직 승인되지 않았다. 이 값들이 고정된 manifest가 없으므로 이 proposal 상태에서는 v2 vector를 생성하거나 소비할 수 없다. Active 승격 전에는 다음 invariant를 만족해야 한다.

```text
totalDimension = semanticDimension + payloadDimension + 5
headInputDimension = totalDimension
```

Dimension, block order 또는 encoding 변경은 기존 v2 artifact를 조용히 바꾸지 않고 새 feature contract version을 요구한다.

## 6. Component And Artifact Versioning

모든 실행은 mutable `latest` 이름이 아니라 exact bundle manifest를 사용해야 한다. Component identifier 형식은 다음 namespace를 사용하되 concrete version과 artifact는 승인 전까지 `pending`이다.

| Component | Identifier format | Version must pin |
|---|---|---|
| Tokenizer | `difficulty-tokenizer.vN` | vocabulary, special token, normalization, max length, truncation |
| Encoder | `difficulty-encoder.vN` | architecture, weights, output shape, dtype |
| Pooling | `difficulty-pooling.vN` | token selection, mask와 aggregation rule |
| Projection | `difficulty-projection.vN` | input/output dimension, weights, activation와 normalization |
| Payload statistics | `difficulty-payload-statistics.vN` | parser, feature names/order, clipping와 scaling |
| Feature assembly | `difficulty-feature-vector.v2` | block order, exact total dimension와 missing representation |
| Head | `difficulty-head.vN` | input dimension, weights, output semantics |
| Calibrator | `difficulty-calibrator.vN` | family, parameter, valid input range와 output rule |
| Classifier | `difficulty-classifier.vN` | label set/order, threshold, equality와 invalid-value handling |
| Bundle | `difficulty-feature-bundle.vN` | exact compatible component tuple와 bundle hash |

Bundle manifest는 적어도 다음 값을 가져야 한다. 이 표현은 shape 제안이며 checked-in artifact가 존재한다는 뜻이 아니다.

```text
featureContractVersion
tokenizerVersion + tokenizerHash
encoderVersion + encoderHash
poolingVersion
projectionVersion + projectionHash
payloadStatisticsVersion
headVersion + headHash
calibratorVersion + calibratorHash
classifierVersion
semanticDimension
payloadDimension
totalDimension
bundleHash
```

Artifact hash는 canonical artifact content의 SHA-256처럼 검증 가능한 content hash여야 한다. Version과 hash가 둘 다 일치해야 하며 지원되지 않는 조합은 shadow 실행을 fail closed로 건너뛴다. Invalid bundle을 current runtime classifier로 대체했다는 식으로 v2 결과를 꾸며서는 안 된다.

다음 변경은 해당 component의 새 version과 bundle hash를 요구한다.

- Tokenizer vocabulary, normalization, max length 또는 truncation 변경
- Encoder, projection 또는 head weight와 architecture 변경
- Pooling, activation, dtype 또는 numeric evaluation rule 변경
- Payload parser, feature order, clipping, scaling 또는 unknown 처리 변경
- Calibrator family 또는 parameter 변경
- Threshold, equality, label mapping 또는 invalid-value handling 변경

Feature block의 의미, 순서 또는 dimension 변경은 component version만 바꾸는 것으로 충분하지 않으며 `difficulty-feature-vector.v2` 다음의 새 feature contract version을 요구한다. 동일 layout에서 학습된 새 weight는 component artifact version과 bundle을 새로 만들 수 있지만 기존 bundle content를 덮어써서는 안 된다.

## 7. Classifier Output And Routing Boundary

V2 classifier consumer contract의 결과는 다음 enum 하나다.

```text
simple | complex
```

Head output, raw score, calibrated value와 threshold는 classifier 내부의 일시적인 계산 material이다. V2 result DTO에 score, confidence, embedding 또는 route target을 추가하지 않는다. Offline evaluation은 aggregate calibration metric을 계산할 수 있지만 per-sample internal value를 직렬화하지 않는다.

Classifier는 provider, model, modelRef, tier, routing cell 또는 fallback 순서를 반환하지 않는다. 실제 target 선택은 active routing contract의 책임을 유지한다.

1. Category classifier가 category를 확정한다.
2. Difficulty classifier가 `simple | complex`를 확정한다.
3. Routing matrix가 `(category, difficulty)` cell의 ordered `modelRefs`를 읽는다.
4. Catalog resolution이 opaque modelRef를 internal `ResolvedTarget`으로 해석한다.

V2 shadow label은 이 네 단계 중 2번의 비교 후보일 뿐이며 offline/shadow 단계에서는 3번과 4번에 전달하지 않는다.

## 8. Data Safety And Non-exposure

`instructionText`, `payloadText`, token, embedding과 model intermediate는 raw prompt에서 파생된 민감한 값이다. 다음 값은 package-private, request-local 또는 approved offline process-local memory에만 존재해야 한다.

- tokenizer token과 attention mask
- encoder embedding과 pooled embedding
- projected embedding과 semantic feature block
- payload feature vector와 assembled v2 vector
- head output, raw score와 calibrated value
- feature contribution와 matched phrase

위 값은 다음 경계에 추가하거나 투영해서는 안 된다.

- API request/response와 제품 UI
- DB record
- Event payload
- Metric name, value dimension 또는 label
- RuntimeConfig, RuntimeSnapshot와 routing policy
- structured log, request log와 error detail
- invocation summary와 provider-attempt
- 비용 정산, cache key와 제품 diagnostics
- offline per-sample report

Tokenizer, encoder, projection, head와 calibrator의 immutable parameter artifact는 승인된 internal artifact store 또는 source-controlled generated artifact에 둘 수 있다. 이는 request별 embedding이나 head output을 저장할 수 있다는 뜻이 아니다.

Approved offline/shadow report는 다음 safe field만 포함할 수 있다.

- opaque sample ID
- expected/actual `simple | complex`
- low-cardinality category
- current baseline 대비 label 변경 방향
- component version과 artifact/bundle hash
- category별·전체 aggregate count/rate와 calibration metric
- sanitized failure code와 aggregate latency/memory

Raw prompt/response, raw detected value, raw fragment, embedding, encoded vector, head output, per-sample calibrated value, provider/model, secret와 민감한 error text는 report에 포함하지 않는다.

## 9. Offline And Shadow Lifecycle

첫 단계는 offline evaluation과 명시적인 opt-in shadow 실행으로 제한한다.

- Artifact bundle을 명시하지 않으면 v2 path를 실행하지 않는다.
- Shadow result는 current `DifficultyResult`, routing decision, response, retry, fallback, quota, cost 또는 cache behavior를 바꾸지 않는다.
- Timeout, panic, invalid numeric value, dimension mismatch 또는 artifact mismatch가 나면 v2 result를 폐기하고 safe aggregate failure만 기록한다.
- Shadow가 실패해도 current classifier를 실패시키거나 latency budget을 연장해서는 안 된다.
- Runtime caller, tenant 또는 request가 component version과 threshold를 덮어쓸 수 없다.
- Runtime 재학습, 자동 calibration, clock, network 또는 randomness에 의존하는 inference를 허용하지 않는다.
- Shadow result를 category × difficulty routing matrix에 입력하지 않는다.

Shadow 실행 위치, resource isolation과 latency budget은 activation 전 별도 구현 계획에서 고정한다. 이 proposal은 request hot path에 synchronous semantic inference를 추가하도록 승인하지 않는다.

## 10. Reproducibility

같은 normalized `instructionText`, payload structure, category와 exact bundle은 지원되는 동일 runtime profile에서 같은 difficulty label을 만들어야 한다.

재현성을 위해 다음을 manifest 또는 component contract에 고정한다.

- Unicode normalization과 instruction/payload split version
- Tokenizer vocabulary, special token과 truncation
- Encoder, projection와 head weight
- Pooling, activation, normalization와 dtype
- Payload structural parser와 scan limit
- Block order, dimension, clipping와 scaling
- Calibrator parameter, threshold와 inclusive/exclusive equality rule
- Dropout 비활성화와 random seed를 사용하지 않는 inference mode
- Local inference runtime와 허용 numeric tolerance

NaN, infinity, dimension mismatch 또는 contract range 밖 값은 valid label로 교정하지 않고 invalid shadow result로 처리한다. CPU architecture나 inference library가 다른 환경 사이의 bit-for-bit 동일성은 별도 evidence 없이 보장하지 않는다. 지원 환경별 tolerance와 label stability는 promotion evidence에 포함해야 한다.

## 11. Promotion Gates

V2를 current runtime 후보로 검토하기 전에 다음 evidence와 별도 active contract 변경이 모두 필요하다.

- Exact feature layout과 immutable component bundle 승인
- Dataset source, license, redaction와 review provenance
- Prompt family가 겹치지 않는 train/calibration/holdout split
- Current rule-based 및 v1 candidate와 동일 sample 비교
- 전체 및 category별 `complex -> simple` count/rate 비악화 gate
- 긴 simple, 짧은 complex, payload-heavy, payload-only와 instruction-only segment
- Calibration, class balance와 distribution drift 분석
- Latency, memory, concurrency와 failure isolation evidence
- 민감정보와 파생 embedding data safety review
- Supported runtime별 artifact validation과 deterministic replay
- Rollback, artifact revocation와 compatibility plan
- [`contracts.md`](contracts.md), [`classification-pipeline.md`](classification-pipeline.md)와 필요한 verifier의 별도 승인 변경

Holdout을 본 뒤 tokenizer, encoder, projection, head, calibrator, threshold 또는 feature layout을 다시 선택해서 같은 holdout 결과를 final evidence로 재사용해서는 안 된다.

## 12. Fixed Decisions And Open Decisions

다음 항목은 이 proposal에서 고정한다.

- V1 42D 불변
- 첫 단계 offline/shadow only
- Semantic raw-text input은 `instructionText` only
- Payload는 deterministic structural statistics only
- 모든 pipeline component와 exact bundle versioning
- Embedding, vector와 head output 비노출
- Classifier result는 `simple | complex` only
- Provider/model 선택은 existing category × difficulty routing matrix 책임

다음 항목은 activation 전 owner 승인이 필요한 open decision이다.

- Exact tokenizer와 encoder family, weight provenance와 license
- Pooling rule, semantic projection dimension와 normalization
- Payload statistic의 exact names, order, bounds와 scaling
- Empty semantic input의 representation과 presence/truncation flag layout
- Head architecture, calibrator family와 classifier threshold
- Total vector dimension과 bundle manifest schema
- Shadow execution 위치, isolation과 resource budget
- Approved dataset, evaluation population과 promotion threshold
- Supported runtime profile과 numeric tolerance

Open decision을 해결하지 않은 상태에서 placeholder artifact를 만들어 v2가 구현 또는 검증됐다고 선언해서는 안 된다.

## 13. Acceptance Criteria

- 문서와 구현 어디에서도 `difficulty-feature-vector.v1`의 42차원 계약을 변경하지 않는다.
- V2는 exact opt-in bundle 없이는 실행되지 않고 current runtime 결과를 바꾸지 않는다.
- Tokenizer와 encoder가 `instructionText` 외의 raw text를 읽지 않는다.
- Payload feature는 versioned bounded structural statistic만 사용한다.
- Category는 고정 5-value control block일 수 있지만 provider/model capability는 입력에 포함되지 않는다.
- Tokenizer, encoder, pooling, projection, payload statistics, assembly, head, calibrator, classifier와 bundle을 독립적으로 식별하고 검증한다.
- Exact dimension과 component tuple이 확정되기 전에는 proposal 상태를 유지한다.
- Embedding, encoded vector, head output와 per-sample internal score를 API, DB, Event, Metrics, log, 제품 diagnostics 또는 offline report에 노출하지 않는다.
- Classifier가 반환하는 의미는 `simple | complex`뿐이다.
- Shadow label을 routing matrix 또는 catalog resolution에 전달하지 않는다.
- Provider와 model 선택은 active category × difficulty matrix와 catalog resolution이 계속 담당한다.
- API, DB, Event, Metrics, RuntimeSnapshot, routing policy와 제품 코드 shape를 변경하지 않는다.

