# Exact Cache Routing-Aware 구현 검증

이 문서는 v2.0.0 Exact Cache 수정 범위와 검증 기준을 정리한다.

이번 작업의 목표는 Semantic Cache가 아니다. Semantic Cache는 별도 material, 별도 policy hash, 별도 acceptance로 분리한다.

## 변경 전 흐름

기존 Exact Cache는 provider/model routing decision이 확정되기 전에 lookup될 수 있었다.

```text
auth/context
-> RuntimeSnapshot
-> budget/rate limit
-> request-side safety
-> exact cache lookup
-> routing/category/provider/model decision
-> provider/fallback
-> exact cache store
```

이 흐름에서는 같은 prompt라도 routing 결과가 달라지는 경우 provider/model/category/routing policy 경계를 cache key가 충분히 표현하지 못할 수 있다.

## 변경 후 흐름

Exact Cache lookup은 routing-aware path로 이동한다.

```text
auth/context
-> RuntimeSnapshot
-> budget/rate limit
-> request-side safety
-> routing/category/provider/model decision
-> routing-aware exact cache key generation and lookup
-> provider/fallback
-> exact cache store
```

즉, `tenantId`, `projectId`, `applicationId`, routing 결과, provider/model stable execution identity가 확정된 뒤에만 Exact Cache key를 생성한다. cache hit이어도 routing pipeline은 실행하고 provider call만 우회한다.

## routing-aware exact cache key material

현재 Exact Cache key version은 `v2-exact-routing-aware-v1`이다.

key material은 아래 값을 포함한다.

| material | 설명 |
|---|---|
| `tenantId` | tenant 경계 |
| `projectId` | project 경계 |
| `applicationId` | application 경계 |
| `requestedModel` | client 요청 model |
| `providerCatalogContentHash` | RuntimeSnapshot provider catalog content hash |
| `providerId` | provider canonical identity 기본값 |
| `providerCatalogStableKey` | `providerId`가 없는 catalog-only/legacy 경로 fallback |
| `modelId` | model canonical identity |
| `routingPolicyHash` | routing policy 변경 경계 |
| `routingDecisionKeyHash` | low-cardinality routing decision material hash |
| `cachePolicyHash` | cache policy 변경 경계 |
| `safetyPolicyHash` | safety policy 변경 경계 |
| `maskingPolicyHash` | masking/redaction policy 변경 경계 |
| `normalizedMaskedRequestBodyHash` | masking 적용 후 request body hash |
| `requestParamsHash` | `temperature`, `max_tokens`, `stream` 등 응답 영향 parameter hash |
| `cacheVersion` | Exact Cache key material version |

`providerName`, display name, provider-facing model display name은 cache key identity로 사용하지 않는다. `providerId`가 있으면 `providerCatalogStableKey`는 key material에서 비운다.

아래 값은 cache key material, cache value, structured log, metric label에 평문으로 남기지 않는다.

- raw prompt
- raw response
- raw detected value
- raw prompt fragment
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret
- provider raw error text

## RoutingDecision 계약

`routingDecisionKeyHash`는 자유 문자열이 아니다. 아래 low-cardinality material을 canonical JSON으로 만든 뒤 hash한다.

```json
{
  "routingMode": "auto | pinned",
  "category": "general | code | translation | support_refund | unknown",
  "tier": "low_cost | balanced | high_quality",
  "capability": "chat | reasoning | code | translation",
  "policyVariant": "default"
}
```

생성 규칙은 아래와 같다.

- 정해진 key 순서로 canonical JSON을 생성한다.
- 비어 있는 값은 `unknown`, `balanced`, `chat`, `default` 같은 canonical default로 고정한다.
- raw prompt, prompt fragment, detected value, secret, provider raw error body는 포함하지 않는다.
- cache key에는 canonical JSON 자체가 아니라 `routingDecisionKeyHash`를 넣는다.

## `stream=true` bypass 정책

`stream=true` 요청은 streaming cache contract가 별도로 생기기 전까지 Exact Cache lookup/store를 모두 bypass한다.

구현 기준:

- lookup 전에 `cacheStatus=bypass`, `cacheType=none`, `cacheDecisionReason=streaming_request`로 정리한다.
- `ExactCacheStore.GetExact`를 호출하지 않는다.
- provider 성공 후에도 `ExactCacheStore.SetExact`를 호출하지 않는다.

## fallback response 저장 bypass 정책

primary provider 실패 후 fallback provider가 성공한 응답은 Exact Cache에 저장하지 않는다.

구현 기준:

- fallback 성공 시 `FallbackOccurred=true`로 기록한다.
- `cacheStatus=store_skipped`, `cacheType=exact`, `cacheDecisionReason=fallback_response_store_bypassed`로 정리한다.
- `ExactCacheStore.SetExact`를 호출하지 않는다.

fallback 응답 cacheability는 fallback-aware contract가 별도로 확정된 뒤 다시 정의한다.

## 기존 key migration 정책

기존 Exact Cache key와 routing-aware Exact Cache key는 섞지 않는다.

정책:

- 새 key version은 `v2-exact-routing-aware-v1`을 사용한다.
- 기존 key는 새 lookup path에서 재사용하지 않는다.
- 기존 entry는 TTL 만료 또는 별도 invalidation으로 정리한다.
- migration 기간에도 `tenantId/projectId/applicationId/category/provider/model/routingPolicyHash/routingDecisionKeyHash` 경계를 넘는 cache hit는 허용하지 않는다.

## 완료 기준

필수 acceptance는 아래 테스트로 확인한다.

- 같은 prompt라도 `tenantId`가 다르면 exact cache miss
- 같은 prompt라도 `projectId`가 다르면 exact cache miss
- 같은 prompt라도 `applicationId`가 다르면 exact cache miss
- 같은 prompt라도 `category` 또는 `routingDecisionKeyHash`가 다르면 exact cache miss
- 같은 prompt라도 `providerId`가 다르면 exact cache miss
- 같은 prompt라도 `modelId`가 다르면 exact cache miss
- 같은 prompt라도 `providerCatalogContentHash`가 다르면 exact cache miss
- 같은 prompt라도 `requestParamsHash`가 다르면 exact cache miss
- `stream=true`는 lookup/store bypass
- fallback success response는 store bypass
- cache key material에 raw prompt, secret, API Key, App Token, Provider Key가 포함되지 않음

## 수동 검증 방법

아래 명령으로 핵심 검증을 수행한다.

```powershell
go test ./apps/gateway-core/internal/domain/cache -count=1
go test ./apps/gateway-core/internal/domain/routing -count=1
go test ./apps/gateway-core/internal/http/handlers -run 'TestChatCompletionsExactCacheRoutingAware' -count=1
go test ./apps/gateway-core/internal/http/handlers -count=1
git diff --check
corepack pnpm run verify:v2-docs
```

릴리즈 전에는 영향 범위가 커졌는지 확인한 뒤 `go test ./apps/gateway-core/...`도 추가 실행한다.
