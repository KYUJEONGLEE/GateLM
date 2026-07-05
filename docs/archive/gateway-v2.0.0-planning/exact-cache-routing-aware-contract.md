# Exact Cache Routing-Aware 계약

이 문서는 Exact Cache와 Routing 팀 간 공유용 계약 요약이다.

공식 기준 문서는 `specs/gateway/v2.0.0/contracts.md`다. 이 문서와 충돌하면 `contracts.md`를 우선한다.

## 1. 결론

Exact Cache는 routing-aware path로 이동한다.

Gateway 실행 순서:

```text
auth/context
-> RuntimeSnapshot
-> budget/rate limit
-> request-side safety
-> routing/category/provider/model decision
-> routing-aware exact cache key generation and lookup
-> provider/fallback
```

즉, Exact Cache key 생성과 lookup은 category, selected provider, selected model, routing decision material이 확정된 뒤에만 수행한다.

## 2. 필수 Cache Key Material

Exact Cache key는 tenant/project/application 경계를 반드시 포함하고, provider/model 표시명이 아니라 stable execution identity를 사용한다.

필수 material:

```text
tenantId
projectId
applicationId
requestedModel
providerCatalogContentHash
providerId
providerCatalogStableKey
modelId
routingPolicyHash
routingDecisionKeyHash
cachePolicyHash
safetyPolicyHash
maskingPolicyHash
normalizedMaskedRequestBodyHash
requestParamsHash
cacheVersion
```

`category`는 별도 자유 문자열이 아니라 `routingDecisionKeyHash`를 만드는 canonical material 내부의 `category`로 반영한다.

provider identity 우선순위:

| 우선순위 | 값 | 사용 여부 |
|---|---|---|
| 1 | `providerId` | cache key 기본값 |
| 2 | `providerCatalogStableKey` | `providerId`가 없는 catalog-only 경로에서만 fallback |
| Forbidden | `providerName`, display name | cache key 사용 금지 |

model identity:

- cache key에는 `modelId`를 사용한다.
- provider API 호출용 표시명이나 provider-facing model name은 cache key identity로 사용하지 않는다.

provider catalog:

- `providerCatalogContentHash`는 RuntimeSnapshot의 `providerCatalogRef.contentHash`와 실제 로드한 catalog body의 content hash가 일치하는 값을 사용한다.
- 같은 `providerId/modelId`라도 catalog 실행 설정이 바뀌면 cache key가 달라져야 한다.

## 3. RoutingDecisionKey

`RoutingDecisionKey`는 자유 문자열이 아니다. 아래 low-cardinality material에서 canonical JSON을 만들고, cache key에는 그 hash인 `routingDecisionKeyHash`를 사용한다.

canonical material:

```json
{
  "routingMode": "auto | pinned",
  "category": "general | code | translation | support_refund | unknown",
  "tier": "low_cost | balanced | high_quality",
  "capability": "chat | reasoning | code | translation",
  "policyVariant": "default | provider_health_fallback"
}
```

canonical 생성 규칙:

- 정해진 key 순서로 JSON을 생성한다.
- 비어 있는 값은 `unknown` 또는 `default`로 고정한다.
- `provider_health_fallback`은 provider/model 후보 상태가 실제 응답 경로를 바꾼 경우에만 사용한다.
- `provider_health_fallback`은 비용 통제를 깨지 않도록 `high_quality` tier로 승격하지 않고, `balanced` 또는 더 낮은 tier 후보만 선택한다.
- raw prompt, prompt fragment, detected value, secret, provider raw error body는 절대 포함하지 않는다.
- cache key에는 canonical JSON 자체보다 `routingDecisionKeyHash`를 사용한다.
- log/detail에는 사람이 확인할 수 있도록 canonical material을 남길 수 있다.

## 4. 금지 Cache Key Material

아래 값은 Exact Cache key material에 포함하지 않는다.

- raw prompt
- raw response
- raw detected value
- raw prompt fragment
- API Key
- App Token
- Provider Key
- Authorization header
- actual secret
- provider raw error body
- provider display name
- provider marketing/display model name
- raw provider error text

## 5. Streaming 정책

`stream=true` 요청은 별도 streaming cache contract가 생기기 전까지 Exact Cache lookup/store를 bypass한다.

## 6. Semantic Cache 제외

Semantic Cache는 Exact Cache와 별도 material, 별도 policy hash, 별도 acceptance를 가진다.

v2.0.0 core response path에는 Semantic Cache를 넣지 않는다.

## 7. Migration 정책

기존 Exact Cache는 audit 후 단계적으로 migration한다.

migration 규칙:

- 새 routing-aware exact cache key version을 도입한다.
- 기존 exact cache entry는 새 routing-aware key와 섞지 않는다.
- 기존 key는 TTL 만료 또는 별도 invalidation으로 정리한다.
- migration 기간에도 tenant/project/application/category/provider/model/routing policy 경계를 넘는 cache hit는 허용하지 않는다.

## 8. Acceptance 기준

필수 테스트:

- 같은 prompt라도 tenant가 다르면 exact cache miss
- 같은 prompt라도 project가 다르면 exact cache miss
- 같은 prompt라도 application이 다르면 exact cache miss
- 같은 prompt라도 category가 다르면 exact cache miss
- 같은 prompt라도 providerId가 다르면 exact cache miss
- 같은 prompt라도 modelId가 다르면 exact cache miss
- 같은 prompt라도 providerCatalogContentHash가 다르면 exact cache miss
- 같은 prompt라도 routingDecisionKeyHash가 다르면 exact cache miss
- `stream=true`는 exact cache lookup/store bypass
