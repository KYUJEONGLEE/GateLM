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

전환은 compatibility bridge가 없는 v2 hard cutover다. routing policy v1 payload를 더 이상 accept하거나 publish하지 않으며, Gateway는 v1 RuntimeSnapshot routing shape를 읽지 않는다. category evaluation record와 invocation event도 v2만 새로 생성한다. historical v1 schema 파일이 남아 있더라도 active 입력 규격이나 runtime 호환 계약이 아니다.

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
| `general` | 짧은 설명, 단일 작업 | 비교, 계획, 여러 제약 또는 복수 작업 |
| `code` | 문법 질문, 작은 수정, 단일 API | 디버깅, 설계, 리팩터링, 성능, multi-file 작업 |
| `translation` | 직접 번역 | 톤, 전문용어, 형식, 여러 제약을 함께 보존하는 번역 |
| `summarization` | 짧은 입력의 핵심 요약 | 긴 입력, 여러 문서, 비교 요약, 구조 제약 |
| `reasoning` | 조건이 적은 짧은 판단 | 다단계 추론, 여러 제약, trade-off 분석 |

현재 rule-based runtime baseline의 공통 fallback 규칙은 다음과 같다.

- 비었거나 의미 없는 입력: `general + simple`
- 의미 있는 입력이지만 simple/complex 판정 근거가 불충분함: `complex`
- 명확한 simple evidence가 있음: `simple`

Gateway 내부 difficulty target classifier는 deterministic 예외와 단일 model path를 결합한다. 비었거나 의미 없는 입력은 `0.0 + simple`, 현재 rule-based classifier의 명백한 공통 또는 category별 complex 구조 evidence는 `1.0 + complex`로 먼저 반환한다. 나머지 `DifficultyFeatures`만 versioned deterministic encoder로 변환한 뒤 `difficulty-logistic-v1`의 단일 전역 regularized Logistic Regression을 적용한다. Logistic Regression의 raw score는 선형 logit 자체가 아니라 미보정 확률 `sigmoid(w·x+b)`다. `difficulty-calibration-v1`이 선택한 단 하나의 전역 calibrator가 이 값을 inclusive `0.0~1.0`의 최종 model-path `DifficultyResult.ComplexityScore`로 보정한다. Category별 model 또는 calibrator는 두지 않는다. 기존 bounded-simple evidence와 수동 simple score는 target classifier를 short-circuit하지 않는다.

모든 category는 초기 bootstrap policy인 `difficulty-threshold-v1 = 0.45` 하나를 공유한다. `ComplexityScore >= 0.45`이면 `complex`, 미만이면 `simple`이다. Category별, tenant별, request별 threshold를 만들지 않으며 RuntimeConfig, RuntimeSnapshot, 환경변수 또는 runtime caller로 threshold를 주입하지 않는다. Deterministic `0.0`과 `1.0`은 calibrated estimate가 아니라 각각 empty-input과 hard-complex sentinel이다.

Exact encoder는 42차원 `difficulty-feature-vector.v1`로 고정한다. `difficulty-logistic-v1`과 `difficulty-calibration-v1`은 model family와 calibrator 선택 절차의 policy version이며 coefficient, intercept와 선택된 calibrator parameter는 아직 승격되지 않은 별도 immutable artifact다. Artifact는 최상위 `calibratorType` 없이 `calibrator.type`에 실제 선택값인 `platt` 또는 `isotonic`만 기록하고 같은 객체에 해당 종류의 parameter만 둔다. Platt의 `coefficient`와 `intercept`는 각각 `sigmoid(coefficient × raw_probability + intercept)`의 A와 B다. Isotonic은 exact-equal raw probability를 먼저 묶은 sample-count 가중 PAVA block을 저장하며, `xThresholds[i]`는 block의 포함 하한이고 `yThresholds[i]`는 실제 complex 비율이다. Runtime은 가장 큰 `xThresholds[i] <= raw_probability`의 값을 고르는 floor lookup과 양끝 clipping만 사용하고 선형 보간하지 않는다. PAVA가 하나의 constant block만 만들어도 유효하며 고정 bin, epsilon grouping 또는 임의의 작은 block 자동 병합을 사용하지 않는다. Identity calibrator와 무보정 fallback은 허용하지 않는다. Version과 content hash가 있는 model/calibrator artifact, family-disjoint train/calibration/holdout evidence와 현재 rule-based baseline 대비 safety gate가 준비되기 전까지 현재 runtime classifier를 바꾸지 않는다. `0.45`도 evidence-selected optimum으로 주장하지 않으며 이후 변경은 기존 version을 수정하지 않고 새 global threshold policy version으로 승격한다.

Model path의 `ComplexityScore`는 평가 모집단에서 비슷한 score를 받은 표본의 실제 `complex` 비율에 가까워지도록 보정한 확률 추정값이다. 예를 들어 calibrated `0.8`은 개별 요청이 절대적으로 80% 확률로 complex임을 보장하지 않으며 dataset 구성, sample size, category 분포와 distribution drift의 영향을 받는다. Sentinel은 probability calibration 집계에서 제외하고 hybrid end-to-end directional error에는 포함한다.

Score, raw probability, logit, calibrator material과 threshold는 package-private deterministic material이다. API, DB, Event, Metrics, RuntimeConfig, RuntimeSnapshot, routing policy, response, structured/request log, invocation summary, provider-attempt, 비용 정산, cache key와 제품 diagnostics에 추가하지 않는다. Provider, model, modelRef, tier, catalog metadata, resolved target, 실제 가격 또는 tenant budget과 결합하지 않는다. Synthetic 또는 안전하게 redacted된 approved offline evaluation만 최종 `ComplexityScore`를 명시적으로 투영할 수 있다. 외부 surface의 score 사용은 별도 contract proposal이 필요하다.

## 3. Routing Policy v2

authoring/storage policy의 canonical schema는 [`schemas/routing-policy.schema.json`](schemas/routing-policy.schema.json)이다.

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
- `modelRefs[1..n]`: 순서가 보존되는 fallback 후보
- `modelRef`: routing consumer가 파싱하지 않는 opaque catalog reference

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

라우팅 결과는 category, difficulty, 선택한 opaque modelRef와 safe routing outcome을 설명할 수 있다. `selectedProvider`/`selectedModel`은 routing field 이름을 바꾸어 우회 보존하지 않는다.

## 6. One-time Migration

legacy config에서 v2로 바꾸는 migration은 한 번만 실행한다.

1. 기존 `defaultModel`이 있으면 그 값만 10개 cell 각각의 `modelRefs[0]`으로 복사한다.
2. 기존 `defaultModel`이 없으면 10개 cell 모두 `modelRefs: ["mock-balanced"]`로 만든다.
3. `lowCostModel`, `highQualityModel`, legacy fallback model과 모든 legacy provider field는 migration 입력으로 사용하지 않는다.
4. v2 저장/발행이 끝난 뒤 runtime은 `defaultModel`을 포함한 legacy field를 읽지 않는다.
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
| `highQualityProvider`, `highQualityModel` | 저장/검증/발행/runtime 사용 금지 |
| `defaultProvider`, `defaultModel` | `defaultModel`은 one-time migration 입력만 허용; runtime 사용 금지 |
| `lowCostProvider`, `lowCostModel` | 저장/검증/발행/runtime 및 migration 사용 금지 |
| `fallbackProvider`, `fallbackModel` | ordered `modelRefs` fallback으로 대체; migration 사용 금지 |
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

- schema와 fixture가 정확히 5 category × 2 difficulty의 non-empty ordered `modelRefs`를 검증한다.
- v1 policy/RuntimeSnapshot은 accept 또는 publish되지 않는다.
- auto mode와 manual mode는 저장된 matrix를 공유하며 toggle로 matrix가 소실되지 않는다.
- category 누락과 삭제 label은 `general`로 정규화된다.
- difficulty classifier는 category를 입력으로 사용한다.
- difficulty target contract는 단일 전역 Logistic Regression, 전역 calibrator와 전역 `0.45` threshold만 허용한다.
- `ComplexityScore`는 model-path calibrated estimate 또는 deterministic `0.0`/`1.0` sentinel로만 `DifficultyResult`에 존재하고 제품 surface에는 노출되지 않는다.
- 검증된 artifact와 holdout safety gate가 승격되기 전까지 현재 rule-based runtime behavior를 유지한다.
- legacy tier/field와 `selectedProvider`/`selectedModel`이 새 routing surface에 다시 나타나지 않는다.
