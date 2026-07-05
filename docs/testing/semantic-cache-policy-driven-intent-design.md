# Semantic Cache Policy-Driven Intent Cache 최소 구현 설계

## 목적

이 문서는 GateLM v2 Semantic Cache hit 판단을 기존 similarity 중심 MVP에서 policy-driven intent cache로 확장하기 위한 최소 구현 설계를 정리한다.

이번 문서는 구현 전 설계다. production code를 수정하지 않는다.

핵심 목표:

```text
기존:
hit = same SemanticCacheBoundary AND semanticSimilarity >= threshold

목표:
hit =
  category allowed
  AND same SemanticCacheBoundary
  AND same canonicalIntent
  AND requiredSlots compatible
  AND hardNegativeGuard passed
  AND semanticSimilarity >= categoryThreshold
```

중요 전제:

- `specs/gateway/v2.0.0/contracts.md` 기준으로 Semantic Cache는 v2.0.0 core response path가 아니라 Safety/Evaluation evidence track이다.
- production 전환 전까지는 shadow/candidate evaluation을 우선한다.
- raw prompt, raw response, raw detected value, raw prompt fragment, API Key, App Token, Provider Key, Authorization header, provider raw error body, actual secret은 저장하거나 log/detail/metric label에 남기지 않는다.
- LLM judge 실시간 호출은 이번 MVP 구현 범위에서 제외한다.
- 한국어 synonym dictionary는 code 하드코딩이 아니라 versioned policy material로 분리한다.
- `support_refund`는 보수적으로 처리한다.

## 최소 설계 결론

구조를 크게 바꾸지 않고 아래 3개를 추가하는 방향이 가장 작다.

1. `SemanticCacheIntentMaterial`
   - redaction 이후 normalized input에서 생성한 low-cardinality intent/slot material
2. `SemanticCacheHitPolicy`
   - category allow/deny, category threshold, slot compatibility, hard negative rule을 가진 versioned policy
3. `SemanticCacheIntentDecision`
   - 현재 요청 material과 cached entry material을 비교한 hit/miss/bypass/store decision

기존 `EmbeddingProvider`, `SemanticCacheStore`, handler의 provider adapter 경계는 유지한다.

vector similarity는 계속 사용하지만 최종 hit 결정의 단독 기준이 아니라 마지막 보조 조건으로 낮춘다.

## 새 Domain Type 후보

### SemanticCacheHitPolicy

`SemanticCacheHitPolicy`는 versioned policy material을 runtime에서 읽어 hit 가능 여부를 판단하는 객체다.

후보 위치:

```text
apps/gateway-core/internal/domain/cache/semantic_hit_policy.go
```

후보 shape:

```go
type SemanticCacheHitPolicy struct {
    PolicyVersion           string
    CanonicalizationVersion string
    DefaultThreshold        float64
    Categories              map[string]SemanticCacheCategoryPolicyConfig
    Synonyms                SemanticCacheSynonymPolicy
    ForbiddenIntentPairs    []SemanticCacheIntentPair
}

type SemanticCacheCategoryPolicyConfig struct {
    Enabled               bool
    Mode                  string
    CategoryThreshold     float64
    RequiresIntent        bool
    RequiresRequiredSlots bool
    RequiresHardNegative  bool
}
```

`Mode` 후보:

| mode | 의미 |
|---|---|
| `disabled` | lookup/store 모두 bypass |
| `candidate_only` | decision/log/evidence만 남기고 provider bypass hit 금지 |
| `strict_hit` | 모든 policy gate 통과 시 hit 허용 |

초기 권장:

```text
general=strict_hit 또는 candidate_only
account_access=candidate_only
support_refund=candidate_only
translation=disabled
code=disabled
unknown=disabled
```

`support_refund`는 처음부터 `strict_hit`로 열지 않는다.

### SemanticCacheIntentMaterial

`SemanticCacheIntentMaterial`은 현재 요청 또는 cache entry에 붙는 safe canonical material이다.

후보 위치:

```text
apps/gateway-core/internal/domain/cache/semantic_intent_material.go
```

후보 shape:

```go
type SemanticCacheIntentMaterial struct {
    Category                string
    CanonicalIntent         string
    RequiredSlots           map[string]string
    RequiredSlotsHash       string
    OptionalSlots           map[string]string
    OptionalSlotsHash       string
    CanonicalizationVersion string
    SynonymPolicyVersion    string
    MaterialHash            string
}
```

규칙:

- `Category`는 existing routing/category classifier 결과를 canonicalize한 값이다.
- `CanonicalIntent`는 `account.password_reset` 같은 low-cardinality label이다.
- `RequiredSlots` 값은 enum/low-cardinality 값만 허용한다.
- `RequiredSlotsHash`는 canonical JSON 기반 hash다.
- `OptionalSlots`는 hit 판단 보조용이고, category별 policy가 compatibility 의미를 정한다.
- `MaterialHash`는 log/detail에서 긴 material 대신 사용할 수 있는 safe hash다.

저장 금지:

- raw prompt
- prompt fragment
- raw detected value
- 주문번호, 이메일, 전화번호, 실제 credential
- API Key, App Token, Provider Key, Authorization header
- provider raw error body

### SemanticCacheIntentDecision

`SemanticCacheIntentDecision`은 policy evaluator 결과다.

후보 위치:

```text
apps/gateway-core/internal/domain/cache/semantic_intent_decision.go
```

후보 shape:

```go
type SemanticCacheIntentDecision struct {
    Allowed                  bool
    Outcome                  string
    Reason                   string
    Category                 string
    CanonicalIntent          string
    RequiredSlotsHash        string
    CategoryThreshold        float64
    SemanticSimilarity       float64
    PolicyVersion            string
    CanonicalizationVersion  string
    HardNegativeMatched      bool
    ProviderBypassAllowed    bool
}
```

`Outcome` 후보:

| outcome | 의미 |
|---|---|
| `hit` | provider bypass 가능한 semantic cache hit |
| `miss` | lookup했지만 hit 불가, provider 호출 |
| `bypass` | lookup/store 자체를 하지 않음 |
| `candidate_only` | hit 후보지만 provider bypass 금지 |
| `store_skipped` | provider 응답 후 store 금지 |

`Reason` 후보:

| reason | 의미 |
|---|---|
| `category_disabled` | deny/disabled category |
| `intent_unavailable` | `canonicalIntent` 생성 실패 |
| `slots_unavailable` | required slot 누락 |
| `intent_mismatch` | cached entry와 intent 불일치 |
| `slots_mismatch` | required slot 불일치 |
| `hard_negative` | forbidden pair 또는 slot conflict |
| `threshold_miss` | similarity가 category threshold 미만 |
| `candidate_only` | policy mode상 provider bypass 금지 |
| `hit` | 모든 gate 통과 |

## Policy Material 예시

policy material은 code에 하드코딩하지 않고 파일 또는 RuntimeSnapshot policy source로 분리한다.

초기 MVP에서는 repository의 static JSON fixture로 시작하고, 후속으로 Control Plane published policy에 포함하는 흐름이 안전하다.

후보 파일:

```text
apps/gateway-core/internal/domain/cache/testdata/semantic_cache_policy_ko_v1.json
```

예시:

```json
{
  "semanticCachePolicyVersion": "semantic-cache-policy-ko-v1",
  "canonicalizationVersion": "ko-canon-v1",
  "synonymPolicyVersion": "ko-synonym-v1",
  "defaultThreshold": 0.55,
  "categories": {
    "general": {
      "enabled": true,
      "mode": "strict_hit",
      "categoryThreshold": 0.55,
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresHardNegative": true
    },
    "account_access": {
      "enabled": true,
      "mode": "candidate_only",
      "categoryThreshold": 0.60,
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresHardNegative": true
    },
    "support_refund": {
      "enabled": true,
      "mode": "candidate_only",
      "categoryThreshold": 0.75,
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresHardNegative": true
    },
    "translation": {
      "enabled": false,
      "mode": "disabled"
    },
    "code": {
      "enabled": false,
      "mode": "disabled"
    },
    "unknown": {
      "enabled": false,
      "mode": "disabled"
    }
  },
  "synonyms": {
    "ko": {
      "password": ["비밀번호", "패스워드", "비번"],
      "password_reset": ["재설정", "초기화", "리셋"],
      "api_key": ["API Key", "API 키", "api key"],
      "refund": ["환불", "환급", "돌려받"],
      "return": ["반품", "반송"],
      "cancel": ["취소", "주문 취소", "결제 취소"],
      "exchange": ["교환", "교환 신청"],
      "shipping_fee": ["배송비", "운송비", "반품 배송비"]
    }
  },
  "intents": {
    "account.password_reset": {
      "category": "account_access",
      "requiredSlots": {
        "accountAction": "password_reset"
      }
    },
    "account.api_key_create": {
      "category": "account_access",
      "requiredSlots": {
        "accountAction": "api_key_create",
        "credentialKind": "api_key"
      }
    },
    "support_refund.shipping_fee_refund": {
      "category": "support_refund",
      "requiredSlots": {
        "supportAction": "refund",
        "refundObject": "shipping_fee"
      }
    },
    "support_refund.order_cancel": {
      "category": "support_refund",
      "requiredSlots": {
        "supportAction": "cancel",
        "cancelObject": "order"
      }
    }
  },
  "forbiddenIntentPairs": [
    {
      "category": "support_refund",
      "first": "support_refund.shipping_fee_refund",
      "second": "support_refund.order_cancel",
      "reason": "shipping fee refund and order cancel are not answer-compatible"
    },
    {
      "category": "support_refund",
      "first": "support_refund.return_shipping_fee",
      "second": "support_refund.exchange_request",
      "reason": "return shipping fee and exchange request are not answer-compatible"
    }
  ]
}
```

숫자 threshold는 예시다. production 값은 한국어 evaluation dataset과 실제 traffic shadow evaluation으로 정한다.

## canonicalIntent 생성 위치

생성 위치는 handler보다 domain service 쪽이 낫다.

권장 흐름:

```text
ChatCompletionsHandler
-> applyMasking
-> semanticEmbeddingInput(redactedPrompt)
-> SemanticCacheIntentMaterializer.Build(normalizedText, category, policy)
-> SemanticCacheService.Search(..., intentMaterial)
```

이유:

- handler는 HTTP orchestration에 집중한다.
- intent/slot 생성 규칙은 cache domain policy에 묶는다.
- 테스트가 handler integration과 domain unit test로 나뉜다.
- handler가 synonym dictionary나 intent 규칙을 직접 알지 않아도 된다.

생성 입력:

- `redactedPrompt`에서 만든 normalized text
- routing/category classifier가 만든 `category`
- `semanticCachePolicyVersion`
- `canonicalizationVersion`
- `synonymPolicyVersion`

생성 출력:

- `SemanticCacheIntentMaterial`
- 실패 시 `SemanticCacheIntentDecision{Outcome: "miss" 또는 "bypass", Reason: "intent_unavailable"}`

주의:

- raw prompt를 입력으로 받지 않는다.
- LLM judge를 실시간 호출하지 않는다.
- synonym dictionary는 policy material에서 로드한다.
- dictionary가 없거나 version mismatch면 hit가 아니라 miss/candidate로 처리한다.

## requiredSlots 생성 위치

`requiredSlots`는 `canonicalIntent` 생성과 같은 materializer에서 생성한다.

권장 이름:

```text
SemanticCacheIntentMaterializer
```

역할:

1. normalized text tokenization
2. synonym policy 적용
3. category별 intent 후보 선택
4. required slot enum 추출
5. optional slot enum 추출
6. canonical JSON 생성
7. `RequiredSlotsHash`, `OptionalSlotsHash`, `MaterialHash` 생성

slot 생성 규칙:

- slot value는 policy에 정의된 enum 값만 허용한다.
- slot value가 사용자 입력 원문이면 실패 처리한다.
- required slot이 비어 있거나 `unknown`이면 production hit 금지다.
- optional slot 충돌은 category policy에 따라 miss 또는 candidate로 처리한다.

예:

```json
{
  "category": "support_refund",
  "canonicalIntent": "support_refund.shipping_fee_refund",
  "requiredSlots": {
    "supportAction": "refund",
    "refundObject": "shipping_fee"
  },
  "requiredSlotsHash": "sha256:...",
  "canonicalizationVersion": "ko-canon-v1"
}
```

## Cache Boundary에 포함할지 여부

결론:

- `canonicalIntent`, `requiredSlotsHash`, `canonicalizationVersion`은 production hit compatibility material이다.
- 하지만 기존 `SemanticCacheBoundary`에 바로 모든 material을 넣기보다, `SemanticCacheBoundary`와 `SemanticCacheIntentMaterial`을 분리하는 편이 안전하다.

권장 구조:

```text
SemanticCacheBoundary:
  tenant/project/application/provider/model/routing/safety/masking/request params/version

SemanticCacheIntentMaterial:
  category/canonicalIntent/requiredSlotsHash/canonicalizationVersion/synonymPolicyVersion
```

hit 평가에서는 둘 다 본다.

```text
same SemanticCacheBoundary
AND compatible SemanticCacheIntentMaterial
```

분리하는 이유:

- 기존 exact cache/routing-aware boundary와 충돌을 줄인다.
- `SemanticCacheBoundary`가 너무 커져 cache partition이 과하게 쪼개지는 문제를 피한다.
- intent material 변경 시 migration과 backward compatibility를 별도로 관리할 수 있다.
- required slot 원본 map을 boundary에 넣는 실수를 막는다.

단, store 검색 효율이 필요해지면 아래 safe hash를 secondary index로 둘 수 있다.

```text
semanticIntentMaterialHash
canonicalIntent
requiredSlotsHash
canonicalizationVersion
```

이 값은 raw prompt가 아니라 canonical material에서 만든 low-cardinality/hash 값이어야 한다.

## Log/Detail에 남길 Field

log/detail에는 사람이 debugging할 수 있는 최소 safe field만 남긴다.

권장 field:

| field | 저장 여부 | 설명 |
|---|---|---|
| `semanticCacheHit` | 저장 | 기존 유지 |
| `semanticSimilarity` | 저장 | 기존 유지 |
| `semanticCacheThreshold` | 저장 | 기존 유지. category threshold 적용 후에는 실제 적용 threshold |
| `semanticCacheDecisionReason` | 저장 | `intent_mismatch`, `slots_mismatch`, `hard_negative` 등 low-cardinality reason |
| `semanticMatchedRequestId` | 저장 | 기존 유지 |
| `embeddingProvider` | 저장 | 기존 유지 |
| `semanticCachePolicyVersion` | 저장 | policy 추적 |
| `canonicalizationVersion` | 저장 | canonicalizer 추적 |
| `semanticIntentCategory` | 저장 가능 | low-cardinality category |
| `semanticCanonicalIntent` | 저장 가능 | low-cardinality intent label |
| `semanticRequiredSlotsHash` | 저장 가능 | slot 원문 대신 hash 권장 |
| `semanticIntentMaterialHash` | 저장 가능 | 전체 material hash |
| `semanticPolicyMode` | 저장 가능 | `disabled`, `candidate_only`, `strict_hit` |
| `hardNegativeMatched` | 저장 가능 | boolean |

저장 금지 field:

- normalized text
- raw prompt
- prompt fragment
- required slot raw value
- optional slot raw value가 사용자 입력에서 온 경우
- vector
- provider raw error body
- actual secret

`requiredSlots`가 모두 policy enum이면 detail에 safe summary를 남길 수도 있지만, 초기 구현에서는 `semanticRequiredSlotsHash`만 남기는 편이 안전하다.

## Forbidden Data 금지 규칙

Semantic Cache policy-driven intent material에는 아래를 절대 넣지 않는다.

```text
raw prompt
raw response
raw detected value
raw prompt fragment
API Key
App Token
Provider Key
Authorization header
provider raw error body
actual secret
```

추가 금지:

```text
주문번호
이메일
전화번호
계정 ID
사용자 ID
실제 API key 값
token 값
credentialRef secret value
provider credential value
```

허용:

```text
category=account_access
canonicalIntent=account.password_reset
requiredSlots.accountAction=password_reset
requiredSlots.credentialKind=api_key
policyVersion=semantic-cache-policy-ko-v1
canonicalizationVersion=ko-canon-v1
```

원칙:

- materializer 입력은 redaction 이후 normalized text다.
- materializer 출력은 low-cardinality enum 또는 hash다.
- slot 값이 enum whitelist에 없으면 hit 금지다.
- forbidden marker가 발견되면 `bypass` 또는 `store_skipped` 처리한다.
- vector는 derived sensitive data로 보고 log/detail/API response/metric label에 노출하지 않는다.

## 기존 Exact Cache / Semantic Cache Boundary와 충돌 여부

### Exact Cache와의 관계

Exact Cache는 prompt/request의 exact identity와 routing-aware execution identity를 기준으로 한다.

Semantic Cache는 유사 요청 재사용이므로 Exact Cache material과 섞으면 안 된다.

유지해야 할 원칙:

- Exact Cache key에는 `canonicalIntent`/`requiredSlots`를 넣지 않는다.
- Semantic Cache hit는 Exact Cache miss 이후에만 검토한다.
- Exact Cache hit이면 Semantic Cache는 bypass한다.
- Exact Cache의 `routingPolicyHash`, `routingDecisionKeyHash`, provider/model identity 계약은 그대로 유지한다.

### 기존 SemanticCacheBoundary와의 관계

기존 `SemanticCacheBoundary`는 계속 사용한다.

유지할 field:

- `tenantId`
- `projectId`
- `applicationId`
- `promptCategory`
- `selectedProviderId`
- `selectedModelId`
- `providerCatalogContentHash`
- `routingPolicyHash`
- `routingDecisionKeyHash`
- `semanticCachePolicyHash`
- `safetyPolicyHash`
- `maskingPolicyHash`
- `requestParamsHash`
- `cacheVersion`

새 intent material은 boundary와 별도 비교 조건으로 둔다.

최소 runtime 공식:

```text
boundaryEqual = request.Boundary == entry.Boundary
intentCompatible = request.IntentMaterial compatible entry.IntentMaterial
thresholdPassed = similarity >= policy.CategoryThreshold(category, canonicalIntent)

hit = boundaryEqual AND intentCompatible AND thresholdPassed
```

## Backward Compatibility

기존 Semantic Cache entry에는 intent material이 없다.

기본 처리:

```text
entry.IntentMaterial missing => production hit 금지
```

decision:

```text
Outcome=miss
Reason=intent_material_missing
```

store 정책:

- 새 entry부터 `SemanticCacheIntentMaterial`을 같이 저장한다.
- 기존 entry는 TTL 만료로 자연 소멸시킨다.
- 강제 migration은 MVP 범위에서 하지 않는다.
- `SemanticCachePolicyVersion` 또는 `canonicalizationVersion`이 바뀌면 compatibility 확인 전까지 miss 처리한다.

config compatibility:

- 기존 `SEMANTIC_CACHE_THRESHOLD`는 fallback/default threshold로 유지한다.
- 새 category threshold가 있으면 category threshold가 우선한다.
- 기존 `SEMANTIC_CACHE_ALLOW_CATEGORIES`, `SEMANTIC_CACHE_DENY_CATEGORIES`는 coarse gate로 유지한다.
- 새 policy material의 category mode가 더 보수적이면 더 보수적인 쪽을 따른다.

권장 우선순위:

```text
deny category
> policy mode disabled
> missing intent material
> hard negative
> slot mismatch
> threshold miss
> hit/candidate
```

## 최소 구현 흐름

### Lookup

```text
1. auth/app-token/context 통과
2. request-side safety/masking 적용
3. Exact Cache lookup
4. Exact Cache hit이면 Semantic Cache bypass
5. Semantic Cache enabled 확인
6. stream/fallback/safety blocked/category disabled bypass
7. redactedPrompt -> normalizedText
8. SemanticCacheIntentMaterializer.Build(normalizedText, category, policy)
9. material 생성 실패 시 miss 또는 bypass
10. embedding 생성
11. store.Search(boundary, vector, broadThreshold, topK)
12. candidate별 SemanticCacheHitPolicy.Evaluate(requestMaterial, candidateMaterial, similarity)
13. `strict_hit`이고 모든 gate 통과하면 provider bypass
14. `candidate_only`이면 provider 호출하고 decision/evidence만 기록
15. miss이면 provider 호출
```

### Store

```text
1. provider response 성공
2. fallback 아님
3. provider error 아님
4. stream 아님
5. category store allowed
6. request intent material 존재
7. response cacheability guard 통과
8. SemanticCacheEntry + SemanticCacheIntentMaterial 저장
```

`support_refund` store는 허용하더라도 hit mode는 `candidate_only`로 시작한다.

## support_refund 보수 처리

`support_refund` 초기 production policy:

```text
mode=candidate_only
requiresIntent=true
requiresRequiredSlots=true
requiresHardNegative=true
providerBypassAllowed=false
```

즉 아래를 모두 만족해도 첫 단계에서는 provider bypass하지 않는다.

```text
same boundary
same canonicalIntent
requiredSlots compatible
hardNegativeGuard passed
similarity >= categoryThreshold
```

대신 log/detail에는 아래를 남긴다.

```text
semanticPolicyMode=candidate_only
semanticCacheDecisionReason=candidate_only
semanticCanonicalIntent=support_refund.shipping_fee_refund
semanticRequiredSlotsHash=sha256:...
semanticSimilarity=...
```

`support_refund`를 `strict_hit`로 올리는 조건:

- hard negative false positive 0
- category별 false positive 0
- slot mismatch false positive 0
- 실제 traffic shadow evaluation 통과
- CS/정책 담당자 확인

## LLM Judge 제외

이번 MVP 구현 범위에서는 실시간 LLM judge를 호출하지 않는다.

이유:

- latency 증가
- 비용 증가
- judge output의 재현성 문제
- judge prompt/log에 forbidden data가 들어갈 위험
- cache hit 판단 경로가 외부 모델 품질에 다시 의존

대신 MVP는 아래로 제한한다.

- deterministic synonym policy
- deterministic intent/slot materializer
- deterministic hard negative guard
- OpenAI API 없이 도는 policy evaluation test

LLM judge가 필요하다면 후속 단계에서 offline evaluation 또는 ambiguous band 전용 shadow 평가로만 검토한다.

## 테스트 계획

### Domain Unit Test

대상:

- `SemanticCacheIntentMaterializer`
- `SemanticCacheHitPolicy`
- `SemanticCacheIntentDecision`

필수 테스트:

| 테스트 | 기대 |
|---|---|
| 한국어 비밀번호 재설정 pair | 같은 `canonicalIntent=account.password_reset`, 같은 `requiredSlotsHash` |
| API Key 발급 pair | 같은 `canonicalIntent=account.api_key_create` |
| 사용량 확인 pair | 같은 usage intent |
| 배송비 환불 vs 주문 취소 | `hard_negative`, miss |
| 반품 배송비 vs 교환 신청 | `slots_mismatch` 또는 `hard_negative`, miss |
| translation category | bypass |
| code category | bypass |
| unknown category | bypass |
| forbidden marker 포함 input | bypass 또는 unsafe |
| missing intent material entry | miss |

### Store Test

필수 테스트:

- intent material이 없는 legacy entry는 hit 금지
- 같은 boundary라도 `canonicalIntent`가 다르면 miss
- 같은 boundary/intent라도 `requiredSlotsHash`가 다르면 miss
- same boundary/intent/slots이고 threshold 이상이면 hit
- `candidate_only` mode에서는 provider bypass 금지

### Handler Integration Test

필수 테스트:

- Exact Cache hit이면 Semantic Cache policy evaluator 호출 없음
- `stream=true`면 semantic intent material 생성 전 bypass
- deny category는 embedding 호출 전 bypass
- masking 이후 normalized text만 materializer 입력으로 전달
- forbidden data가 cache key/value/log/detail에 남지 않음
- OpenAI embedding 실패 시 provider flow 계속 진행
- `support_refund` candidate는 log/detail에 남기되 providerCalled=true

### Evaluation Dataset Test

대상 파일:

```text
apps/gateway-core/internal/domain/cache/testdata/semantic_cache_intent_eval_cases.json
```

검증:

- `sameAnswerReusable=true` case는 hit 후보 또는 strict candidate
- `sameAnswerReusable=false` case는 miss
- `hardNegative=true` case는 무조건 miss
- `denyCategory=true` case는 bypass
- `expectedDecision`과 evaluator decision 일치
- `OPENAI_API_KEY` 없이 통과

### Security Test

필수 테스트:

- raw prompt가 `SemanticCacheIntentMaterial`에 저장되지 않음
- normalized text가 log/detail에 남지 않음
- vector가 log/detail/API response/metric label에 남지 않음
- API Key/App Token/Provider Key/Authorization header marker 차단
- provider raw error body가 decision reason/log에 남지 않음
- slot 값이 enum whitelist 밖이면 hit 금지

## 단계별 구현 순서

1. policy JSON/testdata schema 추가
2. `SemanticCacheIntentMaterial` type 추가
3. `SemanticCacheHitPolicy` type 추가
4. deterministic materializer 추가
5. intent/slot evaluator 추가
6. existing `SemanticCacheService.Search` 결과를 hit candidate로 낮추고 evaluator 통과 후 hit 확정
7. `SemanticCacheEntry`에 intent material 저장
8. legacy entry miss 처리
9. log/detail safe field 추가
10. evaluation dataset test 연결
11. `support_refund` candidate_only shadow evaluation

## 열어둘 결정 사항

1. `account_access`를 실제 category로 추가할지, `general` 내부 intent로 둘지
2. `RequiredSlots` 원본 enum map을 entry에 저장할지, hash만 저장할지
3. `semanticIntentMaterialHash`를 `SemanticCacheBoundary`에 넣을지 secondary metadata로 둘지
4. category threshold config를 env 변수로 둘지 policy JSON으로만 둘지
5. `support_refund` store는 허용하고 hit만 막을지, store도 candidate 단계까지 막을지

## 최종 설계 요약

최소 구현은 Semantic Cache를 vector cache가 아니라 policy-driven intent cache로 바꾸는 것이다.

핵심은 세 가지다.

1. redaction 이후 normalized input에서 `SemanticCacheIntentMaterial`을 만든다.
2. vector search 결과를 바로 hit로 쓰지 않고 `SemanticCacheHitPolicy`로 검증한다.
3. `support_refund`는 처음에는 `candidate_only`로 두고 provider bypass hit를 막는다.

이렇게 하면 기존 routing-aware `SemanticCacheBoundary`와 Exact Cache 계약을 깨지 않으면서, production hit policy에 필요한 `canonicalIntent`, `requiredSlots`, `hardNegativeGuard`, `categoryThreshold`를 단계적으로 넣을 수 있다.
