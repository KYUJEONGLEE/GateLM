# GateLM General Routing Contract v2

> [!IMPORTANT]
> **문서 상태: Active scoped contract.** 일반 Gateway 라우팅의 category, difficulty, policy, RuntimeSnapshot, routing outcome 의미는 이 문서가 기준이다.

## 1. Scope And Cutover

이 계약은 다음 경계를 함께 바꾼다.

- Control Plane의 routing policy 검증, 저장, 발행
- published RuntimeSnapshot의 routing section
- Gateway `/v1/chat/completions`의 auto/manual routing
- routing decision, response, invocation summary event와 log
- provider attempt, 비용 정산, exact-cache isolation 경계
- Tenant routing 설정 UI

신규 authoring과 publish는 v2 hard cutover다. routing policy v1 payload를 accept하거나 v1 RuntimeSnapshot routing shape를 새로 publish하지 않는다. 다만 전환 전에 저장된 v1 RuntimeSnapshot과 이번 authoring profile보다 넓은 기존 v2 matrix는 read/execution compatibility 대상으로만 보존한다. Control Plane은 유효한 legacy snapshot을 연결된 RuntimeConfig로부터 v2 응답으로 계산하며 v1 shape를 consumer에 반환하지 않는다. malformed v2를 legacy로 간주하거나 자동 복구하지 않는다. category evaluation record와 invocation event도 v2만 새로 생성한다. historical v1 schema 파일이 남아 있더라도 active 입력 규격이나 신규 runtime 계약이 아니다.

Tenant Chat의 별도 tier와 Provider Catalog의 `routing.costTier` metadata는 이 범위에 포함하지 않는다.

## 2. Classification Pipeline

라우팅 분류는 외부 LLM을 호출하지 않는 deterministic local 두 단계다. Category는 기존 rule-based classifier를 유지하고, difficulty의 active target contract는 단일 전역 regularized Logistic Regression과 전역 calibrator를 사용한다. 내부 구현 구조와 artifact 승격 경계는 [`classification-pipeline.md`](classification-pipeline.md)가, exact encoder는 [`difficulty-feature-vector-v1.md`](difficulty-feature-vector-v1.md)가, 아직 승격되지 않은 offline 학습·codegen 준비 경계는 [`difficulty-logistic-training.md`](difficulty-logistic-training.md)가 정의한다.

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

공통 전처리는 한 번만 실행한다. 난이도 판정은 먼저 확정된 category를 반드시 참고하고, 해당 category의 난이도 feature만 선택적으로 계산한다. Prompt 길이는 보조 신호일 뿐 단독 판정 기준이 아니다. 기존 prompt 직접 분류 메서드는 compatibility wrapper일 뿐 제품 런타임과 신규 평가 코드의 표준 진입점이 아니다.

### Request input boundary

`/v1/chat/completions`는 모든 role의 `messages[].content`에 JSON string만 허용한다. Array형 content part, object, `null`, 누락 content와 이미지·오디오·파일 attachment는 문자열로 flatten하거나 추출하지 않으며 masking, routing, cache, provider 호출 전에 HTTP `400 invalid_request_error`로 거부한다. 이 text-only 제한은 별도 upstream 구현 backlog가 아니다. 향후 지원은 기존 요청을 암묵적으로 확장하지 않고 active 계약을 명시적으로 대체해야 한다.

Masking 이후 라우팅 입력은 message role을 보존한다. `system | developer`의 string content는 request-local private instruction context이면서 분류용 instruction에 포함된다. `user`와 알 수 없는 role의 delimiter 없는 string content는 전체가 instruction이고, `assistant | tool | function` string content는 대화 context payload다. Raw role별 content와 분리 결과는 외부 surface에 노출하지 않는다.

### 2.1 Category

허용 category는 정확히 다섯 개다.

| Category | 의미 |
|---|---|
| `general` | 다른 네 업무 category에 속하지 않는 일반 설명, 안내, 질의, 구조화/지원 업무 |
| `code` | 코드 작성, 분석, 디버깅, 설계, 리팩터링 |
| `translation` | 언어 번역, 현지화, 번역 톤 조정 |
| `summarization` | 문서, 대화, 기록의 요약과 압축 |
| `reasoning` | 비교, 계획, 다단계 추론, 의사결정 |

`extraction_json`, `support_refund`, `unknown`은 삭제한다. 해당 legacy label과 분류 누락, 새 taxonomy에 맞지 않는 입력은 모두 `general`로 정규화한다.

### 2.2 Difficulty

허용 difficulty는 `simple | complex`뿐이다.

| Category | `simple` evidence | `complex` evidence |
|---|---|---|
| `general` | bounded 단일 작업; payload 길이만으로 complex가 되지 않음 | 비교, 계획, 여러 제약 또는 복수 작업 |
| `code` | 문법 질문, 작은 수정, 단일 API, 추가 구조 근거가 없는 bounded `debug`/`refactor` | operation과 넓은 scope, causal complexity 또는 여러 engineering constraint가 결합된 작업 |
| `translation` | 직접 번역 | 톤, 전문용어, 형식, 여러 제약을 함께 보존하는 번역 |
| `summarization` | 단일 source의 직접 요약; payload 길이만으로 complex가 되지 않음 | 여러 문서, 비교·종합, 다수 facet 또는 traceability 제약 |
| `reasoning` | 조건이 적은 짧은 판단 | 다단계 추론, 여러 제약, trade-off 분석 |

현재 rule-based runtime baseline의 공통 fallback 규칙은 다음과 같다.

- 비었거나 의미 없는 입력: `general + simple`
- `large` payload 또는 bounded `debug`/`refactor` operation 하나만 있고 작업·제약·scope·의존 깊이와 category별 구조가 단순함: `simple`
- 길이와 operation처럼 독립적인 proxy가 둘 이상이거나 별도 구조 근거가 있음: 기존 complex rule 적용
- 의미 있는 입력이지만 simple/complex 판정 근거가 불충분함: `complex`
- 명확한 simple evidence가 있음: `simple`

Gateway 내부 difficulty target classifier는 deterministic 예외와 단일 model path를 결합한다. 비었거나 의미 없는 입력은 `0.0 + simple`, 공통 또는 category별 evidence score가 hard threshold에 도달한 명백한 복합 구조는 `1.0 + complex`로 먼저 반환한다. `large` payload 하나와 bounded `debug`/`refactor` operation 하나는 hard threshold에 도달하지 않으며 model path로 전달한다. 나머지 `DifficultyFeatures`만 versioned deterministic encoder로 변환한 뒤 `difficulty-logistic-v1`의 단일 전역 regularized Logistic Regression을 적용한다. Logistic Regression의 raw score는 선형 logit 자체가 아니라 미보정 확률 `sigmoid(w·x+b)`다. `difficulty-calibration-v1`이 선택한 단 하나의 전역 calibrator가 이 값을 inclusive `0.0~1.0`의 최종 model-path `DifficultyResult.ComplexityScore`로 보정한다. Category별 model 또는 calibrator는 두지 않는다. 기존 bounded-simple evidence와 single-proxy simple 예외는 target classifier를 short-circuit하지 않는다.

모든 category는 초기 bootstrap policy인 `difficulty-threshold-v1 = 0.45` 하나를 공유한다. `ComplexityScore >= 0.45`이면 `complex`, 미만이면 `simple`이다. Category별, tenant별, request별 threshold를 만들지 않으며 RuntimeConfig, RuntimeSnapshot, 환경변수 또는 runtime caller로 threshold를 주입하지 않는다. Deterministic `0.0`과 `1.0`은 calibrated estimate가 아니라 각각 empty-input과 hard-complex sentinel이다.

Threshold tuning은 model·calibrator 선택과 분리된 별도 calibration-side evidence 단계다. `0.45`를 바꾸려면 threshold candidate grid, 목적 함수, cost ratio, tie-break와 safety constraint를 Holdout 접근 전에 versioned policy로 고정하고 family-grouped calibration OOF calibrated score만 사용해 단일 전역 `difficulty-threshold-v2` 후보를 제안한다. Untouched Holdout은 freeze된 threshold의 final safety/evaluation에만 사용하며 threshold 선택이나 재조정에 사용할 수 없다. `difficulty-threshold-v2` 제안만으로 active policy가 바뀌지는 않으며 별도 계약 승격이 필요하다. Category별 threshold는 이 절차로도 허용되지 않는다.

Exact encoder는 42차원 `difficulty-feature-vector.v1`로 고정한다. `difficulty-logistic-v1`과 `difficulty-calibration-v1`은 model family와 calibrator 선택 절차의 policy version이며 coefficient, intercept와 선택된 calibrator parameter는 아직 승격되지 않은 별도 immutable artifact다. Artifact는 최상위 `calibratorType` 없이 `calibrator.type`에 실제 선택값인 `platt` 또는 `isotonic`만 기록하고 같은 객체에 해당 종류의 parameter만 둔다. Platt의 `coefficient`와 `intercept`는 각각 `sigmoid(coefficient × raw_probability + intercept)`의 A와 B다. Isotonic은 exact-equal raw probability를 먼저 묶은 sample-count 가중 PAVA block을 저장하며, `xThresholds[i]`는 block의 포함 하한이고 `yThresholds[i]`는 실제 complex 비율이다. Runtime은 가장 큰 `xThresholds[i] <= raw_probability`의 값을 고르는 floor lookup과 양끝 clipping만 사용하고 선형 보간하지 않는다. PAVA가 하나의 constant block만 만들어도 유효하며 고정 bin, epsilon grouping 또는 임의의 작은 block 자동 병합을 사용하지 않는다. Identity calibrator와 무보정 fallback은 허용하지 않는다. Version과 content hash가 있는 model/calibrator artifact, family-disjoint train/calibration/holdout evidence와 현재 rule-based baseline 대비 safety gate가 준비되기 전까지 현재 runtime classifier를 바꾸지 않는다. `0.45`도 evidence-selected optimum으로 주장하지 않으며 이후 변경은 기존 version을 수정하지 않고 새 global threshold policy version으로 승격한다.

Model path의 `ComplexityScore`는 평가 모집단에서 비슷한 score를 받은 표본의 실제 `complex` 비율에 가까워지도록 보정한 확률 추정값이다. 예를 들어 calibrated `0.8`은 개별 요청이 절대적으로 80% 확률로 complex임을 보장하지 않으며 dataset 구성, sample size, category 분포와 distribution drift의 영향을 받는다. Sentinel은 probability calibration 집계에서 제외하고 hybrid end-to-end directional error에는 포함한다.

Score, raw probability, logit, calibrator material과 threshold는 package-private deterministic material이다. API, DB, Event, Metrics, RuntimeConfig, RuntimeSnapshot, routing policy, response, structured/request log, invocation summary, provider-attempt, 비용 정산, cache key와 제품 diagnostics에 추가하지 않는다. Provider, model, modelRef, tier, catalog metadata, resolved target, 실제 가격 또는 tenant budget과 결합하지 않는다. Synthetic 또는 안전하게 redacted된 approved offline evaluation만 최종 `ComplexityScore`를 명시적으로 투영할 수 있다. 외부 surface의 score 사용은 별도 contract proposal이 필요하다.

### 2.1 Authoritative 106D difficulty runtime

Optional Linux amd64 E5 runtime profile은 masking 이후 정상적으로 확정된 `model: "auto"` 요청의 model path에서 106D difficulty를 권위값으로 사용한다. 고정 입력은 `42D rule vector + 64D PCA projection`이며 Logistic Regression L2/liblinear `C=10`, Platt calibrator와 전역 `difficulty-threshold.model-path-5000.2026-07-16.v1 = 0.096`을 사용한다. Category는 기존 rule classifier가 계속 확정한다. Semantic result가 `ready`이면 그 `simple | complex` 값을 routing matrix lookup, `modelRef`, candidate 순서와 decision key에 사용한다. Manual modelRef, auto disabled와 route 실패 요청에는 semantic runtime을 실행하지 않는다. Empty/sentinel/hard-rule 경로처럼 model path가 아닌 요청은 rule difficulty를 그대로 사용한다.

Runtime은 동시 encoder worker 1개와 bounded waiting job 4개를 사용한다. 각 요청의 기본 timeout은 `100ms`, 허용 범위는 `1..1000ms`다. Queue가 가득 찬 `busy`, request cancellation, `timeout`, invalid embedding, inference failure와 recovered panic은 해당 요청의 rule difficulty로 즉시 fail-safe fallback한다. 초기화 또는 startup smoke 실패도 Gateway를 중단하지 않고 process 전체를 rule difficulty fallback mode로 시작한다. 이미 시작된 native call은 worker 안에서 끝나지만 timeout된 요청을 다시 깨우거나 provider path를 지연시키지 않으며, 취소된 queued job은 평가 전에 버린다.

Hot-path 활성화는 process-local `GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED=true`를 사용한다. `GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS`는 bounded request timeout을 설정한다. Runtime과 historical request shadow를 동시에 활성화하면 configuration error로 시작을 거부한다. Checked-in artifact는 current `semantic-empty / combined score-8` boundary와 일치하며 historical baseline waiver를 요구하거나 허용하지 않는다. 기본 CGO-free Gateway image는 E5를 포함하지 않고 runtime을 disabled로 유지한다. 권위 runtime image는 [`../../infra/docker/gateway-core-e5-runtime.Dockerfile`](../../infra/docker/gateway-core-e5-runtime.Dockerfile)이다.

### 2.2 Historical request-shadow observability

기존 `GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED`와 exact-pair allowlist 경로는 non-authoritative 비교용 compatibility surface로만 유지한다. Hot-path runtime이 enabled이면 사용할 수 없다. Shadow 결과는 routing matrix, modelRef, cache 또는 provider 호출에 영향을 주지 않는다.

Request별 log, event, response 또는 DB record를 추가하지 않는다. 허용되는 제품 관측은 다음 두 aggregate metric뿐이다.

- `gatelm_routing_difficulty_shadow_total{status,category,comparison}`
- `gatelm_routing_difficulty_shadow_duration_seconds{status}`

`status`는 `ready | not_applicable | unavailable | busy | timeout | invalid_embedding | inference_failed | panic_recovered`, `category`는 active 5 category, `comparison`은 `match | rule_simple_shadow_complex | rule_complex_shadow_simple | not_compared`로 고정한다. Raw/redacted prompt 본문, instruction/payload text, token, embedding, vector, weight, raw probability, logit, 개별 `ComplexityScore`, artifact hash, request/trace ID, modelRef, provider/model과 error detail은 metric 또는 다른 외부 surface에 넣지 않는다.

## 3. Routing Policy v2

신규 authoring/publish policy의 canonical schema는 [`schemas/routing-policy.schema.json`](schemas/routing-policy.schema.json)이다.

```json
{
  "schemaVersion": "gatelm.routing-policy.v2",
  "mode": "auto",
  "bootstrapState": "mock_bootstrap",
  "routingPolicyHash": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "routes": {
    "general": {
      "simple": { "modelRefs": ["mock-balanced"] },
      "complex": { "modelRefs": ["mock-balanced"] }
    }
  }
}
```

Control Plane draft 입력은 `{ "mode", "routes" }`만 받는다. `schemaVersion`, `bootstrapState`, `routingPolicyHash`는 클라이언트가 지정하지 않으며 서버가 검증된 matrix로부터 계산해 저장·응답·발행한다. `routingPolicyHash`는 자신을 제외한 canonical published policy content의 SHA-256이다.

실제 policy는 `general`, `code`, `translation`, `summarization`, `reasoning` 각각에 `simple`, `complex`를 모두 포함해야 한다. 총 10개 cell은 모두 비어 있지 않은 ordered `modelRefs[]`를 가진다.

- `modelRefs[0]`: primary
- `modelRefs[1]`: 선택 사항인 단일 fallback 후보
- `modelRef`: routing consumer가 파싱하지 않는 opaque catalog reference

현재 Control Plane authoring profile은 다음 의미를 5 × 2 matrix에 투영한다.

- `Simple model`: low-cost 역할이며 transitional default/balanced 역할도 같은 modelRef를 사용한다.
- `Complex model`: high-cost/premium 역할이다. Simple과 같은 modelRef도 허용한다.
- `Fallback model`: 선택 사항인 전역 modelRef 하나이며 Simple과 Complex primary와 달라야 한다.
- 다섯 category의 `simple` primary는 모두 같고 `complex` primary도 모두 같다.
- fallback을 사용하면 10개 cell 모두 같은 두 번째 modelRef를 사용하며, 사용하지 않으면 모든 cell 길이는 1이다.

따라서 신규 authoring/publish에서 각 cell의 `modelRefs` 길이는 `1..2`다. 기존에 저장된 category별 primary 또는 여러 fallback의 v2 matrix는 read/execution compatibility를 위해 그대로 실행할 수 있지만 신규 draft로 간주하지 않는다. 정책 UI는 이를 자동으로 덮어쓰지 않고 사용자가 전역 profile 전환을 명시적으로 확인한 뒤에만 새 draft를 publish한다.

Gateway consumer는 호환성과 향후 고도화를 위해 ordered candidate list를 일반적으로 읽을 수 있다. 이 일반성은 현재 Control Plane이 여러 fallback이나 category별 authoring을 허용한다는 뜻이 아니다. Provider/model 역할은 catalog/config data로 유지하며 모델명 문자열로 추론하지 않는다.

Published Provider Catalog의 `routing.costTier`는 일반 routing decision 입력이 아니다. 다만 Tenant employee cost guard는 검증된 exact catalog entry의 값을 비용 제한 분류로 사용할 수 있다. 이때 Control Plane publisher는 authoring role에서 다음 canonical 값을 만들어야 한다.

- Simple-only primary: `low`
- Complex-only primary와 routing profile에 없는 일반 model: `premium`
- Simple/Complex shared primary, configured fallback, `mock-balanced`: `balanced`

Gateway는 이 값을 모델명, provider family, category 또는 difficulty에서 다시 추정하지 않는다. missing/unknown cost tier는 employee cost rollout `enforce`에서 guard unavailable이며, 일반 routing 자체의 provider/model 선택 의미는 바꾸지 않는다.

Control Plane이 일반 catalog entry에서 생성하는 canonical reference는 `${providerId}:${modelId}` 형식이지만 Gateway와 다른 consumer는 `:`를 분해해서 provider/model을 추론하지 않는다. 반드시 published catalog mapping으로 resolve한다. `mock-balanced`는 built-in Mock target에 연결되는 예약 bootstrap reference다.

정책에는 provider/model 문자열 쌍, tier, routePolicyRef를 넣지 않는다.

## 4. Auto And Manual Request Semantics

요청자는 `routePolicyRef`를 보내지 않는다. Gateway는 인증된 tenant/project/application 문맥으로 published RuntimeSnapshot을 조회하고 그 안의 routing policy를 사용한다. 요청자가 선택하는 값은 Auto의 `model: "auto"` 또는 Manual의 explicit opaque modelRef뿐이다.

### Auto mode

- UI는 end user model picker를 숨기고 `model: "auto"`를 자동 전송한다.
- Gateway는 category와 category-aware difficulty를 판정한 뒤 대응하는 cell의 ordered `modelRefs`를 사용한다.
- exact modelRef를 보낸 요청을 별도 정책으로 자동 재해석하지 않는다.

### Manual mode

- UI는 end user가 선택한 exact opaque modelRef를 `model`에 전송한다.
- `model: "auto"` 요청은 HTTP `400`, safe error code `auto_routing_disabled`로 거부한다.
- 저장된 10개 auto route cell은 삭제하지 않는다. mode를 다시 `auto`로 바꾸면 그대로 복원한다.

Mock target이 실제 응답을 만들면 응답에는 `executionMode: "mock"`를 표시한다. 실제 provider target이면 `executionMode: "provider"`를 사용할 수 있다. 응답에 `selectedProvider` 또는 `selectedModel`을 넣지 않는다.

## 5. RuntimeSnapshot And Resolution Boundary

published RuntimeSnapshot v2의 routing section은 다음 shape다.

```text
mode
bootstrapState
routingPolicyHash
routes
```

`routes`는 policy의 완전한 5 × 2 matrix다. legacy provider/model/tier field는 발행하지 않는다. `routingPolicyHash`는 canonical v2 policy content의 무결성/provenance 값이며 modelRef 대신 사용하거나 modelRef를 해석하는 값이 아니다.

Gateway 내부 실행에는 다음 target을 유지한다.

```text
ResolvedTarget {
  providerId
  modelId
}
```

`ResolvedTarget`은 catalog resolution과 provider adapter 호출을 위한 내부 값이다. routing decision, 외부 response, invocation summary event/log에는 실제 provider/model을 넣지 않는다. 실제 호출된 `providerId`/`modelId`는 별도의 provider-attempt 및 비용 정산 record에만 남긴다.

관리자 Request Log의 목록과 상세 응답은 실제 호출 증거를 표시하기 위해 중첩된 `providerAttempt` record를 노출할 수 있다. 이 record는 routing decision이나 invocation summary가 아니며, 실제 provider 호출이 없으면 `null`이다. UI는 `requestedModel: "auto"`를 실제 모델명으로 바꾸지 않고 요청 모드로 유지하며, 실행 대상은 `providerAttempt.providerId`와 `providerAttempt.modelId`에서 별도로 표시한다.

라우팅 결과는 category, difficulty, 선택한 opaque modelRef와 safe routing outcome을 설명할 수 있다. `selectedProvider`/`selectedModel`은 routing field 이름을 바꾸어 우회 보존하지 않는다.

## 6. One-time Migration

legacy config에서 v2로 바꾸는 migration은 한 번만 실행한다.

1. Simple primary는 유효한 legacy `lowCostProvider`/`lowCostModel`을 우선하고, 없으면 유효한 `defaultProvider`/`defaultModel`, 그것도 없으면 `mock-balanced`를 사용한다.
2. Complex primary는 유효한 legacy `highQualityProvider`/`highQualityModel`을 우선하고, 없으면 Simple primary를 사용한다.
3. 유효한 legacy `fallbackProvider`/`fallbackModel`이 두 primary와 다르면 전역 fallback으로 사용하고, 그렇지 않으면 fallback을 두지 않는다.
4. 위 역할을 10개 cell에 동일하게 투영하고 v2 저장/발행 뒤 runtime은 legacy routing field를 읽지 않는다.
5. 생성된 matrix 어디에든 예약 ref `mock-balanced`가 있으면 `mock_bootstrap`, 없으면 `configured`로 저장한다.

Migration으로 만든 reference도 opaque modelRef로 취급한다. runtime consumer는 문자열을 분해하지 않고 catalog mapping으로만 target을 resolve한다.

## 7. Mock Bootstrap Safeguards

Mock은 개발 tenant뿐 아니라 일반 운영 tenant와 production tenant에도 허용한다. 다음 안전장치는 tenant 종류와 무관하게 적용한다.

- 초기 10개 cell: `mock-balanced`
- 초기 상태: `bootstrapState: "mock_bootstrap"`
- 하나라도 `mock-balanced`가 남아 있으면 UI에 “현재 Mock 모델을 사용 중입니다” 경고를 계속 표시
- `mock-balanced`가 모두 제거된 뒤에만 `bootstrapState: "configured"` 허용
- Mock 응답: `executionMode: "mock"`
- Mock 실행의 실제 target: provider-attempt record에 기록

Mock bootstrap은 silent production provider substitution이 아니다. UI 경고와 response marker로 실행 성격을 드러낸다.

## 8. Retired Contract Surface

다음 일반 routing 의미는 v2에서 폐기한다.

| Retired surface | v2 rule |
|---|---|
| `low_cost`, `balanced`, `high_quality` route tier | category + difficulty cell을 사용 |
| category → tier → model hardcoded rules | category는 category만, difficulty는 category를 참고해 별도 판정 |
| `highQualityProvider`, `highQualityModel` | 신규 입력에서는 금지; one-time migration에서 Complex 역할로만 사용 |
| `defaultProvider`, `defaultModel` | 신규 입력에서는 금지; one-time migration에서 Simple 보조 입력으로만 사용 |
| `lowCostProvider`, `lowCostModel` | 신규 입력에서는 금지; one-time migration에서 Simple 역할로만 사용 |
| `fallbackProvider`, `fallbackModel` | 신규 입력에서는 금지; one-time migration에서 유효한 단일 fallback 역할로만 사용 |
| `selectedProvider`, `selectedModel` | decision/response/summary event/log에서 삭제 |
| `extraction_json`, `support_refund`, `unknown` | `general`로 병합 |

v2.0 historical 문서나 schema에 위 이름이 남아 있는 것은 history 보존일 뿐 active runtime 허용 근거가 아니다.

## 9. Event, Cost, Cache, And Data Safety

- invocation summary event v2는 category, difficulty, routing outcome, execution mode 같은 low-cardinality routing summary만 가진다.
- provider attempt와 비용 정산 record는 실제 provider/model, attempt 순서, sanitized outcome, usage/cost를 가진다.
- exact cache는 내부 `ResolvedTarget`의 stable identity와 routing policy provenance를 사용해 target 간 격리를 유지한다. 외부 routing response에 실제 provider/model을 노출할 필요는 없다.
- 내부 `ComplexityScore`, raw probability, logit, calibrator와 threshold는 invocation summary, provider-attempt, 비용 정산, cache key, log, metric label 또는 RuntimeSnapshot으로 전달하지 않는다.
- routing policy, event, log, fixture에는 raw prompt, raw response, raw detected value, raw prompt fragment, secret, Authorization header, provider raw error body를 넣지 않는다.

## 10. Acceptance Rules

- schema와 fixture가 정확히 5 category × 2 difficulty의 전역 Simple/Complex primary와 optional 단일 fallback profile을 검증한다.
- v1 policy/RuntimeSnapshot은 신규 입력 또는 publish shape로 accept되지 않는다. persisted v1 snapshot은 연결된 RuntimeConfig가 있을 때만 v2 응답으로 계산한다.
- 기존 category별 또는 multi-fallback v2 matrix는 read/execution compatibility만 가지며 명시적 전환 전에는 새 draft로 publish되지 않는다.
- auto mode와 manual mode는 저장된 matrix를 공유하며 toggle로 matrix가 소실되지 않는다.
- category 누락과 삭제 label은 `general`로 정규화된다.
- difficulty classifier는 category를 입력으로 사용한다.
- difficulty target contract는 artifact마다 단일 전역 Logistic Regression, 전역 calibrator와 전역 threshold 하나만 허용한다. 현재 106D authoritative model-path runtime은 `0.096`을 사용하며 category와 non-model-path difficulty는 계속 rule-based다.
- Semantic artifact의 PCA fit, training, calibration, evaluation과 Gateway replay는 `difficulty-e5-single-request-execution.2026-07-15.v1`의 batch size `1`을 사용한다.
- `ComplexityScore`는 model-path calibrated estimate 또는 deterministic `0.0`/`1.0` sentinel로만 `DifficultyResult`에 존재하고 제품 surface에는 노출되지 않는다.
- Semantic runtime이 non-ready이면 요청 단위로 기존 rule difficulty를 유지하고 provider execution을 실패시키지 않는다.
- legacy tier/field와 `selectedProvider`/`selectedModel`이 새 routing surface에 다시 나타나지 않는다.
