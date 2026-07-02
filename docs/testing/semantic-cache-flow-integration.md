# Semantic Cache Flow Integration 검증 문서

## 목표

이번 단계의 목표는 Semantic Cache foundation을 `/v1/chat/completions` Gateway flow에 연결하는 것이다.

Semantic Cache는 Exact Cache 뒤, Provider 호출 전에 위치한다. Exact Cache hit가 나면 Semantic Cache lookup은 하지 않는다. Semantic Cache hit가 나면 provider를 호출하지 않고 저장된 `CachedResponse`를 반환한다. Semantic Cache miss면 기존 provider 호출 흐름을 그대로 탄다.

## 1단계 Foundation과의 차이

1단계 foundation은 아래 부품만 준비했다.

- `SemanticCacheConfig`
- `EmbeddingProvider` interface
- `FakeEmbeddingProvider`
- `SemanticCacheStore` interface
- `InMemorySemanticCacheStore`
- `SemanticCacheBoundary`
- `SemanticCacheEntry`
- `SemanticCacheSearchResult`
- `SemanticCacheDecision`
- category policy

이번 단계는 위 부품을 handler flow에 연결한다. 단, 아래는 여전히 제외한다.

- `OpenAIEmbeddingProvider`
- OpenAI API 호출
- pgvector, Redis Vector Search, Qdrant, Pinecone
- frontend 변경
- production vector DB 운영 검증

## Gateway Flow 삽입 위치

변경 후 주요 흐름은 아래다.

```text
auth/app-token 검증
-> tenant/project/application 식별
-> RuntimeSnapshot load
-> request-side masking/block
-> category/routing/provider/model 결정
-> exact cache lookup
-> exact cache hit이면 응답 반환
-> semantic cache lookup
-> semantic cache hit이면 provider 호출 없이 cached response 반환
-> semantic cache miss이면 provider 호출
-> provider 성공 응답이면 exact cache store
-> provider 성공 응답이면 semantic cache store
-> request log 저장
```

`stream=true`, safety block, auth failure는 Semantic Cache lookup/store에 도달하지 않는다.

## Hit / Miss / Bypass / Store 조건

### Lookup 조건

- `SEMANTIC_CACHE_ENABLED=true`
- `stream=false`
- safety block 아님
- auth failure 아님
- Exact Cache hit 아님
- category allowlist
- boundary 생성 성공
- masking 이후 normalized text 생성 성공
- embedding 생성 성공

### Hit 조건

- 같은 `SemanticCacheBoundary`
- similarity가 `SEMANTIC_CACHE_THRESHOLD` 이상
- `SemanticCacheStore.Search`가 matched entry 반환

hit 시 기대 결과:

- `cacheType=semantic`
- `cacheOutcome=hit`
- `providerCalled=false`
- `semanticCacheHit=true`
- `semanticMatchedRequestId`가 원본 requestId를 가리킴

### Miss 조건

- boundary는 유효하지만 matched entry 없음
- similarity가 threshold 미만
- 같은 prompt라도 selected provider/model/routing material 등이 다름

miss 시 provider 호출 흐름을 유지한다.

### Bypass 조건

- `SEMANTIC_CACHE_ENABLED=false`
- Exact Cache hit
- `stream=true`
- safety block
- auth failure
- category denylist 또는 `unknown`
- boundary 생성 실패
- normalized embedding input 생성 실패
- embedding 생성 실패

### Store 조건

- Semantic Cache enabled
- category allowlist
- exact cache miss
- semantic cache miss
- `stream=false`
- safety block 아님
- provider 성공 응답
- fallback 발생 아님
- provider error 아님
- cached response payload 안전성 검사 통과

Store 금지:

- `stream=true`
- fallback response
- provider error
- safety block
- auth failure
- category denylist
- raw PII/secret/provider raw body 위험 payload

## Category Policy

MVP allowlist:

- `general`
- `support_refund`

MVP denylist:

- `code`
- `translation`
- `reasoning`
- `sensitive`
- `tool_call`
- `unknown`

category가 비어 있거나 애매하면 `unknown`으로 보고 bypass한다.

## Boundary Fields

Semantic Cache boundary는 routing-aware material만 사용한다.

| Field | 설명 |
| --- | --- |
| `tenantId` | tenant 경계 |
| `projectId` | project 경계 |
| `applicationId` | application 경계 |
| `promptCategory` | `RoutingDecisionMaterial.Category` |
| `selectedProviderId` | routing 이후 확정된 provider stable identity |
| `selectedModelId` | routing 이후 확정된 model stable identity |
| `providerCatalogContentHash` | provider catalog 변경 감지 |
| `routingPolicyHash` | routing policy 변경 감지 |
| `routingDecisionKeyHash` | canonical routing decision material hash |
| `semanticCachePolicyHash` | Semantic Cache policy version/hash |
| `safetyPolicyHash` | safety policy 변경 감지 |
| `maskingPolicyHash` | masking policy 변경 감지 |
| `requestParamsHash` | temperature 등 응답 영향 parameter 변경 감지 |
| `cacheVersion` | Semantic Cache key/material version |

raw prompt, raw PII, API Key, App Token, Provider Key, Authorization header, provider raw error, provider raw response body는 boundary에 넣지 않는다.

## Request Log / Detail Fields

Request Log metadata와 Request Detail에서 아래 정보를 확인할 수 있어야 한다.

- `cacheType`
- `cacheOutcome`
- `providerCalled`
- `semanticCacheHit`
- `semanticSimilarity`
- `semanticMatchedRequestId`
- `semanticCacheThreshold`
- `semanticCachePolicyVersion`
- `semanticCacheDecisionReason`
- `embeddingProvider`
- `promptCategory`
- `selectedProviderId`
- `selectedModelId`
- `routingPolicyHash`
- `routingDecisionKeyHash`

`semanticCacheDecisionReason`은 사람이 hit/miss/bypass/store 이유를 확인하기 위한 sanitized low-cardinality 값이다.

## Handler Integration Test 목록

| ID | 테스트 |
| --- | --- |
| SC-HANDLER-001 | `TestChatCompletionsSemanticCacheDisabledKeepsExistingFlow` |
| SC-HANDLER-002 | `TestChatCompletionsSemanticCacheFirstRequestMissThenStores` |
| SC-HANDLER-003 | `TestChatCompletionsSemanticCacheSimilarSecondRequestHits` |
| SC-HANDLER-004 | `TestChatCompletionsSemanticCacheThresholdMissCallsProvider` |
| SC-HANDLER-005 | `TestChatCompletionsSemanticCacheExactHitHasPriority` |
| SC-HANDLER-006 | `TestChatCompletionsSemanticCacheCategoryDenylistBypasses` |
| SC-HANDLER-007 | `TestChatCompletionsSemanticCacheTenantProjectApplicationIsolation` |
| SC-HANDLER-008 | `TestChatCompletionsSemanticCacheSelectedProviderIdIsolation` |
| SC-HANDLER-009 | `TestChatCompletionsSemanticCacheSelectedModelIdIsolation` |
| SC-HANDLER-010 | `TestChatCompletionsSemanticCacheRoutingPolicyHashIsolation` |
| SC-HANDLER-011 | `TestChatCompletionsSemanticCacheRoutingDecisionKeyHashIsolation` |
| SC-HANDLER-012 | `TestChatCompletionsSemanticCacheStreamBypassesLookupAndStore` |
| SC-HANDLER-013 | `TestChatCompletionsSemanticCacheFallbackResponseDoesNotStore` |
| SC-HANDLER-014 | `TestChatCompletionsSemanticCacheProviderErrorDoesNotStore` |
| SC-HANDLER-015 | `TestChatCompletionsSemanticCacheSafetyBlockBypassesLookupAndStore` |
| SC-HANDLER-016 | `TestChatCompletionsSemanticCacheDoesNotPersistRawPromptOrSecrets` |

추가로 `TestChatCompletionsSemanticCacheAuthFailureBypassesLookupAndStore`에서 auth failure가 Semantic Cache에 도달하지 않는 것도 확인한다.

## 수동 검증 방법

### 1. Semantic Cache OFF

설정:

```dotenv
SEMANTIC_CACHE_ENABLED=false
```

절차:

1. `비밀번호 재설정 방법 알려줘` 요청
2. `패스워드 초기화는 어떻게 해?` 요청
3. 두 요청 모두 provider가 호출되는지 확인

통과 기준:

- `providerCalled=true`
- `cacheType`이 `semantic` hit로 표시되지 않음

### 2. Semantic Cache ON + first miss

설정:

```dotenv
SEMANTIC_CACHE_ENABLED=true
SEMANTIC_CACHE_STORE=in_memory
SEMANTIC_CACHE_EMBEDDING_PROVIDER=fake
```

절차:

1. `비밀번호 재설정 방법 알려줘` 요청
2. Request Detail 확인

통과 기준:

- `providerCalled=true`
- `cacheType=semantic`
- `cacheOutcome=miss`
- `semanticCacheDecisionReason=stored` 또는 miss/store에 해당하는 low-cardinality reason

### 3. Semantic Cache ON + similar hit

절차:

1. first miss 요청 후 같은 application/provider/model/routing boundary 유지
2. `패스워드 초기화는 어떻게 해?` 요청
3. Request Detail 확인

통과 기준:

- `providerCalled=false`
- `cacheType=semantic`
- `semanticCacheHit=true`
- `semanticMatchedRequestId`가 첫 요청 requestId

### 4. Category deny

절차:

1. code 또는 translation 요청 전송
2. Request Detail 확인

통과 기준:

- semantic lookup/store 없음
- `semanticCacheDecisionReason=semantic_category_disabled`
- provider flow 유지

### 5. Boundary isolation

절차:

1. allow category 요청으로 semantic entry 생성
2. `selectedModelId` 또는 `applicationId`를 바꿔 유사 요청 전송

통과 기준:

- semantic hit 금지
- `providerCalled=true`

## Security / Privacy

Semantic Cache는 아래 값을 key/value/log/metric label에 평문 저장하지 않는다.

- raw prompt
- raw PII
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error
- provider raw response body

Boundary는 stable execution identity와 policy hash/version만 포함한다. Cached response는 store 전에 unsafe payload marker 검사를 통과해야 한다.

## 한계

- `OpenAIEmbeddingProvider`는 아직 없다.
- `InMemorySemanticCacheStore`는 운영용 persistence나 cross-instance 공유를 보장하지 않는다.
- production vector DB는 아직 도입하지 않았다.
- 실제 semantic similarity 품질은 fake embedding으로 검증할 수 없다.

## 다음 단계

- `OpenAIEmbeddingProvider` optional smoke test
- pgvector 또는 production vector DB store 검토
- semantic similarity 품질과 threshold tuning 검증
