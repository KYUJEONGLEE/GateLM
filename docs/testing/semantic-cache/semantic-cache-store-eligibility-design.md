# Semantic Cache Store Eligibility Design

이 문서는 Semantic Cache beta 구현에서 provider 응답을 store할지 판단하는 최소 설계를 정의한다.

기존 intent 기반 hit policy는 "찾은 cache entry를 재사용해도 되는가"를 판단한다. Store eligibility는 "이번 provider 응답을 cache entry로 저장해도 되는가"를 판단한다. 두 판단은 서로 다르며, production에서는 둘 다 통과해야 안전하다.

## 목표

- `embedding similarity`만으로 hit/store하지 않는다.
- `canonicalIntent`, `requiredSlots`, `hardNegativeGuard`는 hit 판단에 유지한다.
- store 단계에는 `responseCacheabilityClass`와 forbidden data guard를 추가한다.
- raw prompt, raw response, API Key, App Token, Provider Key, Authorization header는 저장하거나 log/detail/metric label에 남기지 않는다.
- OpenAI API 호출 테스트는 opt-in으로 유지한다.
- DB/API/Event/Metrics 계약 변경 없이 domain 내부 type부터 시작한다.

## 새 Domain Type 후보

### `SemanticCacheStorePolicy`

store 가능 여부를 판단하는 policy다.

```go
type SemanticCacheStorePolicy struct {
    Version string
    Categories map[string]SemanticCacheCategoryStorePolicy
    DefaultMode string
}
```

category별 설정 후보:

```go
type SemanticCacheCategoryStorePolicy struct {
    Mode string
    AllowCacheabilityClasses []string
    DenyCacheabilityClasses []string
    RequiresIntent bool
    RequiresRequiredSlots bool
    RequiresForbiddenPayloadGuard bool
    RequiresProviderSuccess bool
    DenyFallback bool
    DenyStream bool
}
```

`Mode` 후보:

| mode | 의미 |
|---|---|
| `disabled` | store 항상 bypass |
| `strict_store` | 모든 guard 통과 시 store |
| `candidate_only` | store 또는 hit을 제한하고 evidence만 남김 |

초기 beta 권장값:

```json
{
  "version": "semantic_store_ko_v1",
  "defaultMode": "disabled",
  "categories": {
    "account_access": {
      "mode": "strict_store",
      "allowCacheabilityClasses": ["static_guidance"],
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresForbiddenPayloadGuard": true,
      "requiresProviderSuccess": true,
      "denyFallback": true,
      "denyStream": true
    },
    "general": {
      "mode": "strict_store",
      "allowCacheabilityClasses": ["static_guidance"],
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresForbiddenPayloadGuard": true,
      "requiresProviderSuccess": true,
      "denyFallback": true,
      "denyStream": true
    },
    "support_refund": {
      "mode": "candidate_only",
      "allowCacheabilityClasses": ["policy_summary"],
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresForbiddenPayloadGuard": true,
      "requiresProviderSuccess": true,
      "denyFallback": true,
      "denyStream": true
    },
    "code": { "mode": "disabled" },
    "translation": { "mode": "disabled" },
    "unknown": { "mode": "disabled" }
  }
}
```

### `SemanticCacheStoreMaterial`

store 판단에 필요한 low-cardinality material이다.

```go
type SemanticCacheStoreMaterial struct {
    Category string
    CanonicalIntent string
    RequiredSlotsHash string
    ResponseCacheabilityClass string
    ProviderOutcome string
    FallbackUsed bool
    Stream bool
    ContainsForbiddenPayload bool
    ContainsDynamicUserState bool
    StorePolicyVersion string
}
```

저장하거나 log/detail에 남기면 안 되는 값:

- raw request text
- raw response bytes
- raw detected value
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret

`RequiredSlotsHash`는 canonical slot map의 hash만 남긴다. slot 원문 값이 identifier일 수 있기 때문이다.

### `SemanticCacheStoreDecision`

store 판단 결과다.

```go
type SemanticCacheStoreDecision struct {
    Enabled bool
    Allowed bool
    Reason string
    Category string
    CanonicalIntent string
    RequiredSlotsHash string
    ResponseCacheabilityClass string
    StorePolicyVersion string
}
```

`Reason` 후보:

| reason | 의미 |
|---|---|
| `store_allowed` | store 허용 |
| `store_disabled` | store 비활성화 |
| `category_denied` | category store 금지 |
| `intent_unavailable` | `canonicalIntent` 없음 |
| `required_slots_unavailable` | `requiredSlots` 없음 |
| `response_not_cacheable` | 응답 class가 store 허용 대상이 아님 |
| `dynamic_user_state` | 사용자별 동적 상태 |
| `forbidden_payload` | forbidden marker 탐지 |
| `fallback_response` | fallback 응답 |
| `streaming_response` | streaming 응답 |
| `provider_error` | provider 오류 |
| `policy_unavailable` | store policy 없음 |

## 평가 위치

권장 흐름은 `SemanticCacheService.Upsert` 직전 또는 내부에서 store eligibility를 평가하는 것이다.

### Handler 책임

handler는 아래 사실을 알고 있다.

- provider 호출 성공/실패
- fallback 사용 여부
- `stream=true` 여부
- category
- request-side normalized text
- provider 응답 bytes

handler는 raw content를 log하지 않고 `SemanticCacheStoreRequest`에 safe material만 넘긴다.

### Domain 책임

`SemanticCacheService.Upsert`는 최종 방어선이다.

권장 순서:

```text
1. Semantic Cache enabled 확인
2. store/policy/embedding provider 존재 확인
3. normalized request text forbidden guard
4. intent material 생성
5. store eligibility material 생성
6. StorePolicy.Evaluate(material)
7. store deny면 embedding 생성 없이 bypass
8. store allow면 embedding 생성
9. store.Upsert 호출
10. store 내부 forbidden payload guard 재확인
```

중요한 점은 store deny가 확정된 응답에 대해 embedding을 만들 필요가 없다는 것이다. 특히 `code`, `translation`, `unknown`, `dynamic_user_state`, `forbidden_payload`는 OpenAI embedding 호출 전에 bypass되어야 한다.

## `responseCacheabilityClass` 생성 위치

MVP/beta에서는 LLM judge 실시간 호출을 쓰지 않는다.

초기 생성 방식:

1. category와 `canonicalIntent` 기반 allow list
2. response-side forbidden marker scanner
3. dynamic state marker scanner
4. provider outcome/fallback/stream flag
5. policy material의 cacheability rule

예시:

| signal | class |
|---|---|
| FAQ/how-to intent + static response marker | `static_guidance` |
| support refund policy explanation | `policy_summary` |
| 사용량 수치, 비용, quota, order/refund/payment status marker | `dynamic_user_state` |
| key/token/secret marker | `credential_or_secret` |
| provider error/fallback | `provider_error` |
| 판단 불가 | `unsafe_or_unknown` |

scanner는 raw response를 저장하지 않고, boolean/classification 결과만 반환한다.

## Policy Material 분리

synonym, intent, store allow rule은 코드에 하드코딩하지 않는다.

권장 파일 구조:

```text
apps/gateway-core/internal/domain/cache/testdata/semantic_cache_policy_ko_v1.json
apps/gateway-core/internal/domain/cache/testdata/semantic_cache_store_policy_ko_v1.json
apps/gateway-core/internal/domain/cache/testdata/semantic_cache_store_eval_cases.json
```

production에서는 testdata가 아니라 config/policy artifact로 승격한다. 다만 beta 구현은 같은 구조를 먼저 test policy material로 검증한다.

## Cache Boundary 포함 여부

`responseCacheabilityClass`와 `StorePolicyVersion`은 cache key boundary에는 넣지 않는다.

이유:

- cache key boundary는 tenant/project/application/provider/model/routing/policy 경계를 분리하는 역할이다.
- store eligibility는 entry를 저장할지 말지 결정하는 guard다.
- 이미 저장된 entry의 hit 호환성은 `SemanticCacheIntentMaterial`과 `SemanticCachePolicyVersion`으로 판단한다.

다만 entry metadata에는 아래를 저장할 수 있다.

- `StorePolicyVersion`
- `ResponseCacheabilityClass`
- `StoreDecisionReason`

초기 in-memory 구현에서는 metadata 확장 없이 decision log/test부터 시작할 수 있다.

## Log / Detail Field

safe field 후보:

| field | 저장 가능 여부 | 비고 |
|---|---:|---|
| `semanticStoreAllowed` | 가능 | boolean |
| `semanticStoreDecisionReason` | 가능 | low-cardinality enum |
| `semanticStorePolicyVersion` | 가능 | version string |
| `semanticResponseCacheabilityClass` | 가능 | low-cardinality enum |
| `semanticCanonicalIntent` | 가능 | policy enum |
| `semanticRequiredSlotsHash` | 가능 | hash만 |
| `semanticForbiddenPayloadDetected` | 가능 | boolean |

금지:

- provider 응답 원문
- request 원문
- marker와 매칭된 실제 substring
- provider raw error body
- credential/token/secret 값

## Existing Semantic Cache와의 호환

### Hit Policy

기존 `SemanticCacheHitPolicy`, `SemanticCacheIntentMaterial`, `SemanticCacheIntentDecision`은 유지한다.

store policy는 hit policy를 대체하지 않는다.

```text
store allowed != hit allowed
hit allowed != store allowed
```

### Exact Cache

Exact Cache key와 policy에는 영향을 주지 않는다.

- Exact Cache는 routing-aware exact match path를 유지한다.
- Semantic Cache의 `canonicalIntent`/`requiredSlots`를 Exact Cache key에 넣지 않는다.
- Store eligibility는 Semantic Cache 전용 guard다.

### 기존 entry

기존 entry에 store policy metadata가 없어도 강제 migration하지 않는다.

권장:

```text
metadata missing => hit policy는 기존처럼 평가
store policy는 새 Upsert부터 적용
TTL 만료로 기존 entry 자연 소멸
```

`SemanticCachePolicyVersion` 또는 `StorePolicyVersion` 변경이 큰 경우에는 compatibility가 확인될 때까지 miss 처리할 수 있다.

## 최소 구현 순서

1. `SemanticCacheStorePolicy` / `SemanticCacheStoreMaterial` / `SemanticCacheStoreDecision` type 추가
2. `semantic_cache_store_policy_ko_v1.json` test policy material 추가
3. `semantic_cache_store_eval_cases.json` 추가
4. response cacheability scanner 추가
5. `SemanticCacheService.Upsert`에서 store deny 시 embedding 호출 전 bypass
6. handler integration test에서 fallback/stream/provider error store bypass 확인
7. log/detail field는 별도 PR에서 계약 확인 후 연결

## 테스트 계획

OpenAI API 없이 통과해야 하는 테스트:

| 테스트 | 기대 |
|---|---|
| password reset static guidance | store allowed |
| API Key 발급 방법 안내 | store allowed |
| 실제 API Key 값 marker 포함 | store bypass |
| 사용량 화면 위치 안내 | store allowed |
| 이번 달 사용량 수치 응답 | store bypass |
| 배송비 환불 정책 안내 | support_refund candidate 또는 제한 store |
| 주문 취소 상태 응답 | store bypass |
| refund/order/payment identifier 포함 | store bypass |
| `code` category | store bypass |
| `translation` category | store bypass |
| `unknown` category | store bypass |
| fallback response | store bypass |
| provider error response | store bypass |
| `stream=true` | store bypass |

추가 regression:

- store bypass case에서 embedding provider가 호출되지 않음
- forbidden data가 cache value/log/detail에 남지 않음
- hard negative case는 store 여부와 관계없이 hit miss
- 기존 Semantic Cache boundary isolation 테스트 유지

## 남은 결정

1. `support_refund`를 beta에서 `candidate_only`로만 둘지, `policy_summary` 제한 store까지 허용할지
2. `general`의 dynamic user state scanner 범위
3. response-side safety scan과 store eligibility의 책임 분리
4. store decision field를 Request Detail에 언제 노출할지
5. production policy material을 testdata에서 runtime config artifact로 승격하는 방식
