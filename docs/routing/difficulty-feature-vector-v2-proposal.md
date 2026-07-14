# GateLM Difficulty Feature Vector v2 Proposal

| Field | Value |
|---|---|
| Status | Proposed contract; not active |
| Applies to | Offline evaluation and opt-in shadow difficulty classification only |
| Proposed feature contract | `difficulty-feature-vector.v2` |
| Current active feature contract | [`difficulty-feature-vector.v1`](difficulty-feature-vector-v1.md), fixed 42 dimensions |
| Active routing contract | [`contracts.md`](contracts.md) |
| Canonical offline encoder | [`difficulty-e5-encoder.md`](difficulty-e5-encoder.md); Gateway runtime에는 미활성 |
| Last reviewed | 2026-07-15 |

이 문서는 instruction semantic representation과 payload structural statistics를 결합하는 차기 difficulty feature contract를 제안한다. 이 제안은 current Gateway hot path, `DifficultyResult`, routing policy, RuntimeSnapshot 또는 category × difficulty matrix를 변경하지 않는다. Exact artifact bundle과 offline evidence가 승인되고 active routing contract가 별도로 변경되기 전까지 `difficulty-feature-vector.v2`는 제품 판정에 사용할 수 없다.

`difficulty-feature-vector.v2`는 제품 release SemVer가 아니다. 이 이름은 내부 feature contract namespace이며 현재 공식 release 또는 다음 release 번호를 선언하지 않는다.

## 1. Goals

이 제안의 목표는 다음과 같다.

- Semantic encoder는 `PromptFeatures.instructionText`만 읽는다.
- Payload는 길이, 명시적 문서 수, 표와 code block 구조처럼 bounded deterministic statistics로만 표현한다.
- Tokenizer, encoder, pooling, projection, payload statistics, feature assembly, head, calibrator와 classifier decision policy를 독립적으로 versioning한다.
- Embedding, projected embedding, assembled vector와 head output을 민감한 package-private 파생값으로 유지한다.
- 첫 offline 비교에서는 `ruleVectorV1`, `semanticProjection`, `semanticHeads`를 이름과 segment가 분리된 상태로 조립한다.
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
- 아직 선택되지 않은 semantic/difficulty head, calibrator, threshold 또는 promotion evidence가 존재한다고 주장

“최종 분류기가 라우팅 대상 모델까지 결정한다”는 설계는 명시적으로 제외한다. Difficulty classifier가 model 또는 modelRef를 고르면 현재 [`contracts.md`](contracts.md)의 5 category × 2 difficulty matrix, ordered fallback과 catalog resolution 책임을 우회하게 된다. 이 제안의 classifier는 난이도 label만 결정한다.

## 3. v1 Compatibility

`difficulty-feature-vector.v1`은 계속 독립적인 고정 42차원 contract다. 초기 offline 후보는 v1 값을 복사하거나 semantic 결과로 교체하지 않고 exact `ruleVectorV1[42]` segment로 포함할 수 있다. 이 실험용 concat은 v1 contract 자체의 in-place 확장이나 runtime v2 승격이 아니다.

- V1 feature를 추가, 삭제, 재정렬하거나 다른 scaling으로 다시 읽어서는 안 된다.
- `ruleVectorV1`의 feature name, order와 value는 세 offline 후보에서 동일해야 한다.
- V1 artifact가 결합 후보를 v1처럼 읽거나 결합 후보 artifact가 v1 artifact를 자동 변환해서는 안 된다.
- Offline evaluator는 candidate version을 명시적으로 선택해야 하며 동일 sample에서 결과를 비교할 수만 있다.
- V2 shadow가 없거나 invalid이면 current runtime과 v1 evaluator 결과를 그대로 유지해야 한다.
- V2 proposal, manifest 또는 artifact의 존재만으로 current classifier가 바뀌어서는 안 된다.

V1과 semantic 후보의 compatibility bridge는 동일 sample에 대한 exact `ruleVectorV1` segment와 label·aggregate 비교뿐이다. Semantic output을 v1 slot에 기록하거나 v1 값을 semantic 값으로 덮어쓰는 bridge는 허용하지 않는다.

## 4. Input Separation

### 4.1 Semantic input

Semantic path의 canonical raw-text input은 `PromptFeatures.instructionText` 하나다.

- Tokenizer와 encoder는 `normalizedText`, `payloadText`, raw prompt 또는 attachment body를 읽어서는 안 된다.
- `instructionText`가 비어 있으면 tokenizer와 encoder를 호출하지 않는다.
- Empty semantic input은 tokenizer 이전에 `not_applicable`로 판정하고 encoder/PCA 입력과 initial candidate vector 조립에서 제외한다.
- 향후 empty sample을 assembled feature에 포함하려면 별도의 presence flag layout을 새 contract로 승인해야 한다. Presence bit 없이 zero vector만 넣는 fallback은 허용하지 않는다.
- Canonical tokenizer 입력은 `query: ` prefix를 붙이고 special token을 포함하며 maximum 128 token, right truncation, batch-longest right padding을 사용한다.
- Token ID와 attention mask는 같은 `[batch, sequence]` shape의 `int64`다. Attention mask가 `0`인 padding 위치는 mean pooling에서 제외한다.
- Custom head+tail 처리, caller가 정하는 max length/truncation 또는 runtime tokenizer override는 허용하지 않는다.
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

## 5. Initial Offline Feature Shape

첫 비교의 feature shape version은 `difficulty-offline-feature-shape.v1`이다. 이는 runtime `difficulty-feature-vector.v2` 계약이 아니며 다음 세 segment namespace를 사용한다.

```text
ruleVectorV1[42]
semanticProjection[P]
semanticHeads[12]
├─ semanticTaskBucket[3]
├─ semanticConstraintBucket[3]
├─ semanticScopeBucket[3]
└─ semanticDependencyBucket[3]
```

Canonical E5 projection에서 `P = 64`다. Feature shape descriptor에는 `projectionVersion`, `semanticHeadsVersion`, `P`, head class order, segment offset과 전체 dimension이 모두 있어야 한다. Mutable `latest` 또는 dimension 추론은 허용하지 않는다.

초기 head class order는 v1 rule feature의 clipping·enum 의미와 정렬하되 확률 자체는 별도 semantic output이다.

| Head | Ordered classes | Dimension |
|---|---|---:|
| `semanticTaskBucket` | `count_1, count_2, count_3_plus` | 3 |
| `semanticConstraintBucket` | `count_0_to_1, count_2, count_3_plus` | 3 |
| `semanticScopeBucket` | `count_1, count_2_to_3, count_4_plus` | 3 |
| `semanticDependencyBucket` | `depth_0_to_1, depth_2, depth_3_plus` | 3 |

각 head probability vector는 위 class order를 사용하고 모든 값이 finite inclusive `0.0~1.0`이며 합이 `1.0`이어야 한다. Initial head probability dimension `H`는 `3 + 3 + 3 + 3 = 12`다. `codeOperation`, `terminology`, `synthesis`, `reasoningDepth`는 semantic head에 포함하지 않지만 그 정보가 이미 존재하는 `ruleVectorV1`의 feature name, order, value와 scaling은 변경하지 않는다. 누락·추가 head, dimension mismatch, NaN, infinity, 범위 밖 값과 합 오류는 candidate invalid이며 zero-fill 또는 rule 값 fallback으로 교정하지 않는다.

고정 비교 후보는 다음 세 개다.

| Candidate | Segment order | Total dimension |
|---|---|---:|
| `42d-rule-vector-v1` | `ruleVectorV1` | `42` |
| `42d-rule-vector-v1-plus-projection` | `ruleVectorV1 -> semanticProjection` | `42 + P` |
| `42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities` | `ruleVectorV1 -> semanticProjection -> semanticHeads` | `42 + P + 12 = 54 + P` |

모든 후보에서 `ruleVectorV1`은 offset `0`, dimension `42`다. Projection은 offset `42`이고, semantic head probability는 offset `42 + P`부터 위 표의 head 순서로 이어진다. Feature name도 `ruleVectorV1.*`, `semanticProjection[*]`, `semanticHeads.<head>.<class>.probability`로 분리한다.

따라서 canonical E5/PCA bundle을 사용하는 세 후보의 total dimension은 각각 `42`, `106`, `118`이다.

Canonical offline assembly 구현은 [`../../scripts/routing_difficulty_model/gatelm_difficulty_model/semantic_features.py`](../../scripts/routing_difficulty_model/gatelm_difficulty_model/semantic_features.py)다. 이 구현은 assembled vector 또는 head probability의 JSON/report serializer를 제공하지 않는다.

현재 구현된 `FeatureShapeDescriptor`는 candidate, segment offset, exact `totalDimension`과 deterministic `featureNames`를 함께 고정한다. Candidate A는 semantic segment를 받지 않고, Candidate B는 projection만, Candidate C는 projection과 고정 4-head probability를 모두 받아들인다. 누락뿐 아니라 선택 candidate에 없는 추가 segment도 거부한다. 이 descriptor는 process-local generic training validation에 사용되며 assembled vector 자체를 artifact나 report로 직렬화하지 않는다.

비활성 offline 준비 tooling은 다음 경계를 추가로 구현한다.

- [`../../apps/gateway-core/cmd/difficulty-semantic-head-training-export`](../../apps/gateway-core/cmd/difficulty-semantic-head-training-export)는 `trainingEligible=true`, complete label coverage, versioned family policy와 human-approved record/family만 받아들이고 canonical `instructionText`, 고정 4-head label과 low-cardinality evaluation metadata를 process-local JSON pipe로 전달한다. Empty instruction은 `not_applicable` label을 확인한 뒤 encoder 입력에서 제외한다.
- [`../../scripts/routing_difficulty_model/gatelm_difficulty_model/semantic_heads.py`](../../scripts/routing_difficulty_model/gatelm_difficulty_model/semantic_heads.py)는 canonical L2-normalized E5/PCA `float32[64]` representation에서 4개의 3-class linear-softmax candidate head를 train split으로만 fit하고, exact head/class order, 총 12차원, immutable weight hash와 aggregate macro-F1·class recall·Brier/ECE·language/slice report를 검증한다. Embedding과 per-sample probability serializer는 제공하지 않는다.
- `gatelm-train-difficulty-semantic-heads` CLI는 pinned local encoder lock과 network-disabled inference를 사용하며 artifact와 aggregate report만 쓴다.

현재 저장소에는 500건/89-family의 owner-approved `trainingEligible=true` dataset과 family-disjoint train 300/calibration 100/holdout 100 partition이 있다. Train 300건에만 fit한 PCA 64D와 semantic heads, 세 개의 독립 difficulty decision head·calibrator artifact 및 aggregate selection report가 checked in돼 있다. 이 evidence는 세 후보 비교를 위한 offline selection evidence이며 active runtime bundle, final promotion holdout 또는 Gateway 승격 승인이 아니다. CLI는 기존 `trainingEligible=false` smoke fixture와 300/100/100에서 벗어난 입력을 fail closed로 거부한다.

첫 offline dataflow는 다음과 같다.

```text
Prompt
  -> ExtractPromptFeatures
  -> PromptFeatures
  -> CategoryClassifier
  -> CategoryResult.Category

PromptFeatures.instructionText
  -> query-prefix/right-truncation-128 tokenizer
  -> multilingual-e5-small QInt8 ONNX
  -> attention-mask mean pooling -> raw pooled float32[384]
  -> train-only PCA 384->64
  -> L2 normalization -> semanticProjection[64]
  -> versioned semantic heads -> semanticHeads[12]

DifficultyFeatures
  -> VectorizeDifficultyFeaturesV1
  -> ruleVectorV1[42]

explicit candidate selection
  -> difficulty-offline-feature-shape.v1 assembly
  -> versioned difficulty decision head
  -> versioned calibrator
  -> versioned classifier decision policy
  -> simple | complex

CategoryResult.Category + Difficulty
  -> existing category x difficulty routing matrix
  -> ordered modelRefs
  -> catalog resolution
  -> internal ResolvedTarget
```

Projection, semantic heads와 difficulty decision head의 역할을 합치지 않는다. Projection과 semantic heads는 encoder representation에서 서로 분리된 feature material을 만들고, difficulty decision head는 선택된 assembled candidate에서 uncalibrated decision material을 계산한다. Calibrator와 classifier policy도 별도 version을 유지한다.

Payload structural statistics와 별도 category control block은 이 세 후보에 추가하지 않는다. 필요하면 현재 holdout을 보기 전에 별도의 candidate와 새 offline shape version으로 고정해야 한다. Current `ruleVectorV1`에 이미 존재하는 payload/category rule feature의 의미는 그대로 유지한다.

세 후보 중 어느 조합도 이 proposal만으로 runtime `difficulty-feature-vector.v2`가 되지 않는다. Runtime 계약의 이름, exact shape와 bundle은 offline evidence 이후 별도 active contract 변경에서 결정한다.

### 5.1 Prepared Decision-head Infrastructure

차원 독립 Logistic Regression scorer, 기존 Platt/Isotonic calibrator, descriptor 기반 Python training API와 별도 offline artifact/codegen 경로가 준비돼 있다. 공통 scorer는 empty weight, vector/weight dimension mismatch, NaN, infinity와 dot-product overflow를 panic 없이 거부한다. v1 adapter는 계속 exact 42 names/weights와 고정 threshold policy만 받는다.

Offline candidate artifact는 [`../v2.1.0/schemas/difficulty-offline-model-artifact.schema.json`](../v2.1.0/schemas/difficulty-offline-model-artifact.schema.json)의 `gatelm.difficulty-offline-model-artifact.v1`을 사용한다. 이 schema는 기존 `gatelm.difficulty-model-artifact.v1`을 확장하지 않으며 두 parser는 교차 입력을 거부한다. Artifact는 feature shape, preprocessing, tokenizer·encoder·pooling version과 hash, projection parameter, 고정 4-head/12D parameter, exact feature names와 classifier coefficient/bias, candidate별 새 calibrator, threshold/equality, dataset/split hash와 training policy를 보존한다. Bundle hash는 component tuple과 parameter/shape를, artifact content hash는 classifier·calibrator와 전체 training provenance를 추가로 묶는다. Go/Python은 같은 length-prefixed IEEE-754 material 규칙을 사용한다.

Version-aware codegen은 v1 artifact에는 exact 42D 기존 변수를, offline artifact에는 candidate와 total dimension을 보존한 별도 package-private 변수를 생성한다. Offline 생성물에는 제품 routing 등록이 없으며 `SimpleRouter`, routing matrix와 Gateway hot path에서 참조하지 않는다. 이 infrastructure와 synthetic test artifact는 실제 difficulty decision weight, approved calibrator, runtime bundle 또는 promotion evidence가 존재한다는 뜻이 아니다.

## 6. Component And Artifact Versioning

모든 실행은 mutable `latest` 이름이 아니라 exact bundle manifest를 사용해야 한다. Canonical offline encoder component는 다음과 같이 고정한다. Downstream semantic head, difficulty head와 calibrator는 아직 pending이다.

| Component | Identifier format | Version must pin |
|---|---|---|
| Tokenizer | `difficulty-e5-query-prefix-right-truncation-128.v1` | pinned E5 tokenizer, `query: `, special token, max 128, right truncation, batch-longest right padding |
| Encoder | `difficulty-encoder.multilingual-e5-small-qint8.v1` | pinned revision·QInt8 hash, ONNX Runtime CPU, `float32[batch,sequence,384]` |
| Pooling | `difficulty-attention-masked-mean.v2` | attention mask `1` token의 mean, padding 제외, `float32[batch,384]` |
| Projection | `difficulty-e5-pca-full-svd-64.v1` | train 300 raw pooled embedding, mean `[384]`, components `[64,384]`, post-projection L2 |
| Semantic heads | `difficulty-semantic-heads.vN` | 4개 head class order, output dimension, weights와 probability rule |
| Offline feature assembly | `difficulty-offline-feature-shape.v1` | candidate names, block order, exact dimension와 missing handling |
| Difficulty decision head | `difficulty-head.vN` | candidate input dimension, weights와 output semantics |
| Calibrator | `difficulty-calibrator.vN` | family, parameter, valid input range와 output rule |
| Classifier | `difficulty-classifier.vN` | label set/order, threshold, equality와 invalid-value handling |
| Bundle | `difficulty-feature-bundle.vN` | exact compatible component tuple와 bundle hash |

Encoder/PCA bundle은 [`../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v1.json`](../../scripts/routing_difficulty_model/artifacts/difficulty-e5-encoder-manifest.v1.json)에 고정한다. 이 manifest는 적어도 다음 값을 가진다.

```text
offlineFeatureShapeVersion
candidateName
ruleVectorVersion
preprocessingVersion
tokenizerVersion + tokenizerHash
encoderVersion + encoderHash
poolingVersion
projectionVersion + projectionHash
projectionDimension = 64
projectionParameters = mean[384] + components[64,384]
projectionFitSplit = train[300]
normalization = L2 after PCA
semanticHeadsVersion + semanticHeadsHash
semanticHeadClassOrder
semanticHeadParameters
difficultyHeadVersion + classifier coefficient/bias
calibratorVersion + calibratorHash
classifierVersion + threshold + equality rule
datasetVersion + datasetHash
splitPolicyVersion + splitManifestHash
trainingPolicyVersion
totalDimension
bundleHash
```

Artifact hash는 canonical artifact content의 SHA-256처럼 검증 가능한 content hash여야 한다. Version과 hash가 둘 다 일치해야 하며 지원되지 않는 조합은 shadow 실행을 fail closed로 건너뛴다. Invalid bundle을 current runtime classifier로 대체했다는 식으로 v2 결과를 꾸며서는 안 된다.

Large tokenizer/ONNX artifact는 Git에 넣지 않고 local artifact cache에서 관리한다. 향후 Docker image build는 manifest의 tokenizer와 QInt8 ONNX, committed PCA와 manifest를 image에 반드시 포함해야 한다. Runtime/container 시작 후 network download는 금지하며 시작 시 path, size와 hash를 검증한다. 자세한 배포 경계는 [`difficulty-e5-encoder.md`](difficulty-e5-encoder.md)를 따른다.

다음 변경은 해당 component의 새 version과 bundle hash를 요구한다.

- Tokenizer vocabulary, normalization, max length 또는 truncation 변경
- Encoder, projection, semantic head 또는 difficulty decision head weight와 architecture 변경
- Pooling, activation, dtype 또는 numeric evaluation rule 변경
- Candidate name, segment order, head class order, dimension 또는 missing 처리 변경
- Calibrator family 또는 parameter 변경
- Threshold, equality, label mapping 또는 invalid-value handling 변경

Offline feature block의 의미, 순서 또는 dimension 변경은 component version만 바꾸는 것으로 충분하지 않으며 새 offline shape version을 요구한다. Runtime feature contract가 승인된 뒤 해당 의미를 변경하면 그 runtime feature contract의 새 version이 필요하다. 동일 layout에서 학습된 새 weight는 component artifact version과 bundle을 새로 만들 수 있지만 기존 bundle content를 덮어써서는 안 된다.

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

고정된 세 후보는 같은 untouched holdout에서 비교하며 그 결과 이후에만 runtime 계약 후보를 선택할 수 있다. 이 holdout을 보고 조합을 선택했다면 해당 holdout은 selection evidence이며 final promotion evidence로 재사용할 수 없다. 선택 조합과 모든 component를 다시 고정한 뒤 새로운 untouched holdout에서 promotion gate를 통과해야 한다. Holdout을 본 뒤 같은 dataset version에서 tokenizer, encoder, projection, semantic head, difficulty decision head, calibrator, threshold 또는 feature layout을 바꾸는 것도 허용하지 않는다.

## 12. Fixed Decisions And Open Decisions

다음 항목은 이 proposal에서 고정한다.

- V1 42D 불변
- 첫 단계 offline/shadow only
- Semantic raw-text input은 `instructionText` only
- `intfloat/multilingual-e5-small` pinned QInt8 ONNX, `query: ` prefix, max 128 right truncation과 attention-mask mean pooling
- Train 300 raw pooled 384D embedding에만 full-SVD PCA를 fit하고 64D projection 뒤 L2 정규화
- Empty instruction은 `not_applicable`, degenerate/non-finite projection은 `invalid_embedding`
- Canonical `P=64` 초기 비교 후보는 `42`, `106`, `118` 세 shape만 사용
- 4개 semantic head의 이름·순서·class order와 총 12차원 고정
- `ruleVectorV1`, `semanticProjection`, `semanticHeads` namespace와 segment 분리
- Payload raw content는 semantic encoder 입력에서 제외
- 모든 pipeline component와 exact bundle versioning
- Embedding, vector와 head output 비노출
- Classifier result는 `simple | complex` only
- Provider/model 선택은 existing category × difficulty routing matrix 책임

다음 항목은 activation 전 owner 승인이 필요한 open decision이다.

- Empty semantic input을 downstream assembled feature에 포함할 경우의 presence flag layout
- 생성된 semantic head·difficulty head·calibrator 조합을 runtime contract로 수용할지 여부
- 세 후보 중 runtime 계약 검토 대상으로 선택할 조합과 runtime bundle manifest schema
- Payload structural statistic을 후속 candidate로 추가할지 여부
- Shadow execution 위치, isolation과 resource budget
- 생성된 300/100/100 selection evidence 이후의 final evaluation population과 promotion threshold
- Supported runtime profile과 numeric tolerance

Open decision을 해결하지 않은 상태에서 placeholder artifact를 만들어 v2가 구현 또는 검증됐다고 선언해서는 안 된다.

## 13. Acceptance Criteria

- 문서와 구현 어디에서도 `difficulty-feature-vector.v1`의 42차원 계약을 변경하지 않는다.
- Initial offline assembler는 `ruleVectorV1`을 exact 42차원 첫 segment로 보존하고 semantic 값으로 덮어쓰지 않는다.
- 세 후보의 차원은 `42`, `106`, `118`이며 segment와 feature name이 분리되어 있다.
- 4개 semantic head probability는 고정 class order의 총 12차원이고 invalid/missing 값은 fail closed로 거부한다.
- `codeOperation`, `terminology`, `synthesis`, `reasoningDepth`는 semantic head에서 제외하지만 기존 `ruleVectorV1`의 대응 feature는 그대로 보존한다.
- V2는 exact opt-in bundle 없이는 실행되지 않고 current runtime 결과를 바꾸지 않는다.
- Tokenizer와 encoder가 `instructionText` 외의 raw text를 읽지 않는다.
- Initial semantic 후보는 raw payload content를 tokenizer/encoder에 전달하지 않으며 별도 payload feature를 추가하지 않는다.
- Empty instruction은 tokenizer 이전에 `not_applicable`로 제외하고 zero-fill하지 않는다.
- Category는 고정 5-value control block일 수 있지만 provider/model capability는 입력에 포함되지 않는다.
- Tokenizer, encoder, pooling, projection, payload statistics, assembly, head, calibrator, classifier와 bundle을 독립적으로 식별하고 검증한다.
- Canonical offline E5/PCA와 downstream candidate artifact가 존재하더라도 active runtime contract와 새 promotion holdout이 승인되기 전에는 proposal 상태를 유지한다.
- Embedding, encoded vector, head output와 per-sample internal score를 API, DB, Event, Metrics, log, 제품 diagnostics 또는 offline report에 노출하지 않는다.
- Classifier가 반환하는 의미는 `simple | complex`뿐이다.
- Shadow label을 routing matrix 또는 catalog resolution에 전달하지 않는다.
- Provider와 model 선택은 active category × difficulty matrix와 catalog resolution이 계속 담당한다.
- API, DB, Event, Metrics, RuntimeSnapshot, routing policy와 제품 코드 shape를 변경하지 않는다.
