# Semantic Cache Cacheability Classifier Gate Plan

이 문서는 Semantic Cache의 진입 판단 구조를 cacheability classifier gate 중심으로 바꾸기 위한 working design이다.

이 문서는 공식 계약이 아니다. API, DB, Event, Metrics, Security-sensitive field 판단의 기준을 새로 만들지 않는다. 기존 계약, schema, fixture와 충돌하면 기존 기준을 따른다.

## Overall Direction

현재 Semantic Cache는 특정 intent/rule materialization에 강하게 의존하고 있어, 표현이 조금만 달라져도 semantic cache lookup/store 경로에 진입하지 못할 수 있다.

이 구조는 Semantic Cache의 일반화 목적과 맞지 않으므로, "무슨 intent인가"보다 "캐시를 시도해도 안전한 요청인가"를 먼저 판단하는 구조로 바꾼다.

목표:

- Semantic Cache lookup/store 진입 조건을 cacheability classifier 결과 기반으로 변경한다.
- Classifier는 캐시 시도 가능 여부와 위험도를 판단한다.
- 실제 cache hit 여부는 기존 embedding similarity가 판단한다.
- Classifier가 cacheable로 판단하지 않거나 confidence가 낮으면 fail-closed로 Semantic Cache를 skip한다.
- Skip된 요청은 embedding 호출도 하지 않는다.
- 기존 exact cache와 request execution path는 깨지지 않아야 한다.

## Initial Labels

초기 label은 아래 4개만 둔다.

| Label | Meaning |
|---|---|
| `cacheable_static` | 일반적이고 정적인 정보성 응답 후보. 사용자별 상태, 최신 상태, 외부 실시간 값에 의존하지 않아야 한다. |
| `cacheable_policy` | versioned/static policy explanation에만 사용한다. 사용자별 현재 상태, 예산 잔액, 권한, 사용량, 계정별 정책 결과는 포함하지 않는다. |
| `dynamic_user_state` | 사용자별 상태, 계정, 결제, 주문, 권한, 사용량, 현재 값, 파일/도구 결과, 세션 문맥에 의존하는 요청. |
| `unsafe_or_unknown` | 판단 불가, 위험 가능성 있음, classifier confidence 부족, 기타 cacheable로 확정할 수 없는 요청. |

`cacheable_static`과 `cacheable_policy`는 Semantic Cache lookup/store 후보가 된다는 뜻이지, 즉시 hit/store 허용을 의미하지 않는다.

## Target Request Flow

```text
request
-> existing preconditions
-> exact cache lookup
-> exact cache miss
-> semantic cheap deny checks
-> request normalization/redaction
-> cacheability classifier
-> cacheable + confidence threshold pass
-> embedding lookup
-> semantic mode/boundary/threshold/hit policy
-> provider call or semantic cached response
-> provider response store eligibility
-> optional semantic store
```

기존 exact cache lookup 위치와 동작은 유지한다. Exact cache hit이면 cacheability classifier와 embedding provider를 호출하지 않는다.

Semantic Cache가 명백히 불가능하고 해당 시점에 이미 판정 가능한 cheap deny 조건은 classifier 호출 전에 처리한다.

예:

- Semantic Cache off
- stream request
- unsupported route
- 해당 시점에 이미 blocked로 판정된 request

Cheap deny 조건에 해당하면 classifier와 embedding provider를 모두 호출하지 않는다.

## Structural Requirements

- 기존 Semantic Cache 진입 조건 중 intent/rule materialization에 묶인 부분을 분리한다.
- 기존 intent/rule materialization은 제거하지 말고 optional secondary validation으로 격하한다.
- 초기 변경에서는 기존 intent/rule materialization을 Semantic Cache 진입 조건으로 사용하지 않는다.
- 기존 intent/rule materialization은 필요한 경우 hit candidate 검증 단계의 optional secondary validation으로만 사용한다.
- Classifier gate를 통과한 요청이 기존 materialization 실패 때문에 embedding lookup 자체를 skip해서는 안 된다.
- Classifier 결과를 Semantic Cache lookup과 store eligibility 양쪽에 전달한다.
- Lookup 단계에서 얻은 classifier result는 request context에 저장하고 store 단계에서 재사용한다.
- Classifier disabled/missing/error/timeout/invalid-response/low-confidence로 semantic lookup이 skip된 요청은 provider success 이후에도 semantic store를 하지 않는다.
- Classifier 실패가 request execution/provider call을 막아서는 안 된다.
- Embedding provider는 cacheability gate 통과 후에만 호출된다.
- Classifier 구현은 interface 뒤로 숨겨 pluggable하게 만든다.
- 기존 exact cache 정책, actual cacheHitRate 계산 분리, semantic evidence 비노출 정책은 유지한다.

## Hit And Store Constraints

Classifier는 request cacheability만 판단한다. Classifier가 직접 cache hit을 결정하지 않는다.

Hit은 기존 Semantic Cache mode, boundary, threshold, existing hit policy를 통과해야 한다.

Store eligibility는 classifier 결과만으로 결정하지 않는다. Store 시점에는 아래 조건을 모두 통과해야 한다.

- classifier result 통과
- provider success
- fallback false
- safety blocked false
- forbidden marker scan 통과
- 기존 store policy 통과

기존 Semantic Cache mode 의미는 유지한다.

| Mode | Requirement |
|---|---|
| `off` | Semantic Cache path no-op |
| `shadow` | Classifier가 cacheable이고 semantic candidate가 있어도 provider bypass하지 않는다. |
| `enforce` | 기존 hit policy를 통과한 semantic cached response만 반환할 수 있다. |

Cacheability gate를 통과해 semantic lookup을 수행하면서 생성한 embedding vector는 가능하면 request context에 저장해 store 단계에서 재사용한다. 동일 요청에서 lookup/store 때문에 embedding provider를 중복 호출하지 않는다.

`cacheable_policy` label은 현재 request context 또는 RuntimeSnapshot에서 이미 확인 가능한 policy/version/hash가 semantic cache boundary에 포함되어 있을 때만 store 후보가 될 수 있다. 새 Public API/DB/Event/Metrics 필드를 추가해서 policy/version/hash 값을 만들지 않는다. 정책 버전 또는 policy hash를 기존 경로에서 확인할 수 없으면 `unsafe_or_unknown`처럼 fail-closed 처리한다.

## Classifier Output Contract

Classifier output은 internal request context와 test assertion 용도로만 사용한다. Public API, DB schema, persisted event, dashboard metric label, normal UI surface에는 추가하지 않는다.

```text
label: cacheable_static | cacheable_policy | dynamic_user_state | unsafe_or_unknown
confidence: 0.0 ~ 1.0
reasonCode: string
modelVersion: string
```

Invalid label, invalid confidence, empty result는 classifier error로 간주하고 Semantic Cache no-op 처리한다.

## Config

초기 config 후보:

```dotenv
SEMANTIC_CACHE_CLASSIFIER_ENABLED=false
SEMANTIC_CACHE_CLASSIFIER_TYPE=stub
SEMANTIC_CACHE_CLASSIFIER_MIN_CONFIDENCE=0.90
SEMANTIC_CACHE_CLASSIFIER_TIMEOUT_MS=30
```

기본값은 안전하게 disabled 또는 no-op이어야 한다.

## Model Direction

- 1차 목표는 FastText supervised classifier 기반 local classifier다.
- 다만 Phase 1A/1B의 완료 기준은 classifier interface와 Semantic Cache gate 구조를 만드는 것이다.
- FastText 실제 학습/서빙 연동은 별도 Phase로 분리한다.
- Phase 1A에서는 deterministic stub/mock/local classifier로 테스트 가능한 구조를 우선한다.
- Deterministic local classifier는 test/demo 환경에서만 명시적 env 설정으로 enable되도록 한다.
- 새 profile/config 체계를 만들지 않는다.
- Deterministic local classifier는 production classifier가 아니다.
- Production 기본값은 disabled/no-op이며, 실제 운영 cacheable 판단은 이후 FastText local classifier 연동으로 대체할 수 있어야 한다.
- Classifier는 gateway process에 강하게 묶지 말고 interface 뒤에 둔다.
- 구현 경계는 FastText sidecar 또는 local model classifier로 교체 가능해야 한다.
- 외부 LLM API를 classifier로 호출하는 방식은 기본 경로로 사용하지 않는다.
- Classifier는 label과 confidence score를 반환해야 한다.
- Confidence threshold 미만은 fail-closed 처리한다.

## Training Data Direction

- 외부 범용 데이터셋보다 Semantic Cache 정책에 맞춘 synthetic 학습데이터를 우선한다.
- 같은 키워드가 여러 label에 등장하도록 positive/negative pair를 만든다.
- 사용자별 상태, 기록, 계정 정보, 현재 값, 개인화된 응답은 cache 금지 label로 충분히 포함한다.
- 일반 정보성 질문, 버전이 고정된 정책 설명, 정적 절차 안내는 cacheable label 후보로 포함한다.
- 가격, 재고, 최신 상태, 사용자별 권한/사용량/계정 상태가 필요한 제품/정책 질문은 cacheable로 분류하지 않는다.
- 학습데이터 생성/보관 위치와 format을 명확히 정한다.
- 초기 데이터는 작게 시작하되 재학습 가능한 구조로 둔다.

## Shared Non-Goals

- Classifier가 직접 cache hit를 결정하지 않는다.
- Label을 세분화해서 intent taxonomy를 새로 만들지 않는다.
- Public API를 변경하지 않는다.
- DB schema를 변경하지 않는다.
- Persisted Event schema를 변경하지 않는다.
- Dashboard Metrics contract를 변경하지 않는다.
- Semantic Cache evidence를 일반 API/UI surface에 다시 노출하지 않는다.
- 기존 테스트를 통과시키기 위해 Semantic Cache safety 조건을 완화하지 않는다.

## Phase Execution Protocol

모든 Phase 작업자는 작업을 시작하기 전에 반드시 이 문서를 먼저 읽는다.

각 Phase는 완료 시 결과 보고서 파일을 생성한다. 다음 Phase는 구현을 시작하기 전에 이전 Phase의 결과 보고서를 읽고, 이전 Phase의 실제 결과와 known gap을 기준으로 계획을 조정한다.

보고서 파일은 아래 경로를 사용한다.

| Phase | Required Input Before Work | Required Output After Work |
|---|---|---|
| Phase 1A | 이 문서 | `docs/testing/semantic-cache-cacheability-classifier-phase-1a-result-report.md` |
| Phase 1B | 이 문서, Phase 1A 결과 보고서 | `docs/testing/semantic-cache-cacheability-classifier-phase-1b-result-report.md` |
| Phase 2 | 이 문서, Phase 1A/1B 결과 보고서 | `docs/testing/semantic-cache-cacheability-classifier-phase-2-result-report.md` |
| Phase 3 | 이 문서, Phase 1A/1B/2 결과 보고서 | `docs/testing/semantic-cache-cacheability-classifier-phase-3-result-report.md` |

이전 Phase 결과 보고서가 필요한데 없으면 다음 Phase 구현을 시작하지 않는다. 먼저 누락된 결과 보고서를 작성하거나, 왜 없는지 명확히 기록한 뒤 진행 여부를 판단한다.

각 결과 보고서는 최소한 아래 항목을 포함한다.

- Summary
- Files Changed
- Behavior Changes
- Tests Run
- Acceptance Status
- Known Gaps
- Next Phase Handoff

결과 보고서에도 raw prompt, raw response, API key, token, secret, provider raw error body, 실제 개인정보를 남기지 않는다.

## Branch And PR Strategy

Phase 1A/1B/2/3은 서로 의존성이 있으므로 중간마다 `dev`를 pull 받고 새 브랜치를 파는 방식으로 진행하지 않는다.

권장 방식은 하나의 feature branch와 하나의 PR에서 Phase를 순서대로 쌓는 것이다.

```text
feature/semantic-cache-classifier-gate
  commit 1: phase 1A classifier contract/config/stub
  commit 2: phase 1B gateway gate integration
  commit 3: phase 2 training data / FastText prep
  commit 4: phase 3 runtime integration / demo evidence
```

PR:

```text
title: feat(semantic-cache): add cacheability classifier gate
base: dev
head: feature/semantic-cache-classifier-gate
```

이 방식의 목적은 Phase 2가 Phase 1 코드와 결과 보고서를 실제로 참조하고, Phase 3가 Phase 1/2 결과를 실제 코드와 함께 참조하도록 보장하는 것이다.

Phase 1 PR이 merge되지 않은 상태에서 Phase 2를 `dev` 기준 새 브랜치로 시작하면 Phase 1 코드가 없는 상태가 된다. 이 경우 중복 구현, 보고서와 실제 코드 불일치, Gateway path 재작업이 발생할 수 있으므로 피한다.

각 Phase는 같은 branch 안에서 별도 commit으로 남긴다. 각 commit에는 해당 Phase 결과 보고서도 함께 포함한다.

예외적으로 Phase를 PR로 분리해야 한다면, 다음 Phase branch는 `dev`가 아니라 직전 Phase branch를 base로 만들어 stacked PR로 운영한다. 이 경우에도 다음 Phase 시작 전 이전 Phase 결과 보고서를 읽고 실제 코드가 branch에 존재하는지 확인한다.

## Phased Execution Documents

Phase별 상세 범위, 비범위, 완료 기준, 검증 기준은 별도 문서에서 관리한다. 이 문서는 전체 방향과 공통 제약만 유지한다.

| Phase | Document | Purpose |
|---|---|---|
| Phase 1A/1B | [Gateway Gate Refactor](semantic-cache-cacheability-classifier-phase-1-gateway-gate-refactor.md) | FastText 없이 classifier 타입/설정/스텁을 먼저 만들고, 다음 단계에서 Gateway semantic cache path에 연결한다. |
| Phase 2 | [Training Data And FastText Model](semantic-cache-cacheability-classifier-phase-2-training-data-fasttext-model.md) | synthetic dataset과 FastText supervised classifier 학습 흐름을 준비한다. |
| Phase 3 | [Runtime Integration And Demo Evidence](semantic-cache-cacheability-classifier-phase-3-runtime-integration-demo-evidence.md) | FastText classifier를 runtime에 연결하고 demo evidence를 검증한다. |
