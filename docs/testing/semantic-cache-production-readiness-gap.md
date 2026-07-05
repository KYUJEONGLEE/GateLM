# Semantic Cache Production Readiness Gap 분석

이 문서는 현재 GateLM v2 Semantic Cache 구현이 production hit policy 기준에서 무엇이 부족한지 정리한다.

범위는 분석 보고서다. production code 변경 없이 현재 구현과 문서화된 production hit policy 사이의 gap을 확인한다.

기준 문서:

- `docs/README.md`
- `specs/gateway/v2.0.0/contracts.md`
- `docs/testing/semantic-cache-production-hit-policy.md`
- `docs/testing/semantic-cache-intent-slot-taxonomy.md`
- `apps/gateway-core/internal/domain/cache/testdata/semantic_cache_intent_eval_cases.json`

중요한 전제:

- `specs/gateway/v2.0.0/contracts.md` 기준으로 Semantic Cache는 v2.0.0 core response path가 아니라 Safety/Evaluation evidence track이다.
- 따라서 현재 구현은 production-ready cache hit 정책이 아니라 MVP/실험 경로로 봐야 한다.
- production 기준에서는 `semanticSimilarity >= threshold`만으로 이전 응답을 재사용하면 안 된다.

## 결론

현재 Semantic Cache는 routing-aware boundary, category allow/deny, redaction 이후 normalized input, embedding similarity 기반 lookup에 더해 `SemanticCacheHitPolicy` 기반 `canonicalIntent`/`requiredSlots`/`hardNegativeGuard`/`categoryThreshold` 최소 구현까지 갖췄다.

다만 production hit policy 기준으로는 아직 부족하다. 현재 최소 구현은 rule 기반 policy material로 동작하며, 운영 데이터 전체를 커버하는 taxonomy/evaluation gate가 아니다.

policy material이 없는 상태에서는 hit를 허용하지 않도록 바뀌었다. 즉 production에서 금지한 아래 방식은 더 이상 허용하지 않는다.

```text
same SemanticCacheBoundary
AND category allowed
AND semanticSimilarity >= single global threshold
```

현재 hit 후보는 아래 조건을 통과해야 한다.

```text
same canonicalIntent
AND requiredSlots compatible
AND hardNegativeGuard passed
AND semanticSimilarity >= categoryThreshold
```

그래도 `support_refund`는 정책 coverage가 부족하면 false positive 위험이 크다. 현재 구현은 hard negative guard로 넓은 hit를 막는 방향이지만, production 전에는 더 많은 실제 한국어 케이스로 taxonomy와 evaluation dataset을 확장해야 한다.

## 현재 가능한 것

현재 구현으로 가능한 것은 다음과 같다.

| 항목 | 현재 상태 |
|---|---|
| 기능 기본값 | `SEMANTIC_CACHE_ENABLED=false`로 기본 비활성화 |
| embedding provider | 현재 `feat/semantic-caching` 기준 `fake` provider만 runtime 지원. 기본값은 `fake` |
| store | `in_memory`만 지원 |
| cache boundary | `tenantId`, `projectId`, `applicationId`, `promptCategory`, `selectedProviderId`, `selectedModelId`, `providerCatalogContentHash`, `routingPolicyHash`, `routingDecisionKeyHash`, `semanticCachePolicyHash`, `safetyPolicyHash`, `maskingPolicyHash`, `requestParamsHash`, `cacheVersion` 포함 |
| exact cache 우선순위 | exact cache hit이면 semantic cache lookup bypass |
| stream 처리 | `stream=true` 요청은 semantic cache bypass |
| safety blocked 처리 | masking 결과 blocked이면 semantic cache bypass |
| fallback 응답 저장 | fallback 응답은 semantic cache store bypass |
| provider error 저장 | provider error 응답은 semantic cache store bypass |
| category allow/deny | `general`, `support_refund` allow. `code`, `translation`, `reasoning`, `sensitive`, `tool_call`, `unknown` deny |
| intent/slot policy | `SemanticCacheHitPolicy`가 있으면 `canonicalIntent`, `requiredSlots`, `hardNegativeGuard`, `categoryThreshold`를 hit 판단에 사용 |
| policy 미설정 | `intent_policy_unavailable`로 hit/store를 막음 |
| embedding 실패 | embedding 실패가 Gateway 요청 실패로 승격되지 않고 provider flow 계속 진행 |
| 금지 데이터 기본 방어 | normalized input과 cached response에 marker 기반 forbidden material scan 적용 |
| 로그 metadata | `semanticSimilarity`, `semanticMatchedRequestId`, `semanticCacheThreshold`, `embeddingProvider`, `semanticCacheDecisionReason` 중심으로 기록 |

이 상태는 MVP 검증에는 충분하지만, production hit policy에는 부족하다.

## 현재 Hit 조건 분석

현재 lookup 경로는 다음 순서다.

1. `ChatCompletionsHandler.writeSemanticCachedChatCompletionIfHit`
2. `semanticCacheBoundary` 생성
3. `semanticCategoryAllowed` 검사
4. `semanticEmbeddingInput(redactedPrompt)` 생성
5. `SemanticCacheService.Search`
6. `EmbeddingProvider.Embed`
7. `SemanticCacheStore.Search`
8. request의 `canonicalIntent`/`requiredSlots` material 생성
9. `categoryThreshold` 이상인 후보를 찾음
10. 후보 entry의 `IntentMaterial`을 `SemanticCacheHitPolicy.Evaluate`로 검증
11. `canonicalIntent`, `requiredSlots`, `hardNegativeGuard`, threshold가 모두 통과하면 hit 반환

`InMemorySemanticCacheStore.Search`는 같은 `SemanticCacheBoundary`를 가진 entry만 비교한다.

그 다음 `CosineSimilarity`를 계산하고, `similarity >= categoryThreshold`이면 match 후보가 된다. 후보가 생겨도 `SemanticCacheHitPolicy` 평가를 통과하지 못하면 miss다.

즉 현재 hit 판단은 boundary가 같은 상태에서 similarity threshold가 핵심이다.

```text
if entry.Boundary.Equal(boundary)
AND request.IntentMaterial matches entry.IntentMaterial
AND hardNegativeGuard passed
AND CosineSimilarity(queryVector, entry.EmbeddingVector) >= categoryThreshold
THEN semantic cache hit
```

이 구현에는 `canonicalIntent`, `requiredSlots`, `hardNegativeGuard`, `categoryThreshold` 판단이 없다.

## Category Allow/Deny Gap

현재 category policy는 `SemanticCacheCategoryPolicy`로 구현되어 있다.

현재 기본 정책:

```text
allow = general,support_refund
deny  = code,translation,reasoning,sensitive,tool_call,unknown
```

잘 되어 있는 부분:

- `code`와 `translation`은 deny category로 bypass된다.
- `unknown`은 명시적으로 allow되지 않는다.
- deny list가 allow list보다 우선한다.

부족한 부분:

- `account_access` category가 production taxonomy에는 있지만 production code category enum에는 없다.
- 비밀번호 재설정, API Key 발급 같은 account 계열 요청은 현재 `general`로 흘러갈 가능성이 높다.
- `support_refund`가 allow되어 있지만 refund/order cancel/exchange 같은 위험 intent를 구분하지 않는다.
- category allow/deny는 coarse gate일 뿐, 같은 category 안의 다른 intent를 막지 못한다.

production 기준 결론:

- `general`은 제한적으로 allow 가능하다.
- `account_access`는 category로 분리하거나 `general` 내부 `canonicalIntent`로 반드시 분리해야 한다.
- `support_refund`는 production에서는 기본 `hit_candidate` 또는 shadow mode로 두고, `canonicalIntent`와 `requiredSlots` 구현 전에는 provider bypass hit를 허용하지 않는 것이 안전하다.
- `translation`, `code`, `unknown` deny는 유지해야 한다.

## canonicalIntent Gap

문서와 평가셋에는 `canonicalIntent` 개념이 있다.

예:

```text
비밀번호 재설정 방법 알려줘
패스워드 초기화는 어떻게 해?
=> canonicalIntent=account.password_reset
```

하지만 production code에는 `canonicalIntent` field가 없다.

없는 위치:

- `SemanticCacheBoundary`
- `SemanticCacheEntry`
- `SemanticCacheLookupRequest`
- `SemanticCacheStoreRequest`
- `SemanticCacheDecision`
- invocation log metadata
- category policy
- hit evaluator

현재 영향:

- 같은 `support_refund` category 안에서 `배송비 환불`과 `주문 취소`를 구분하지 못한다.
- 같은 `general` category 안에서 `비밀번호 재설정`, `API Key 발급`, `사용량 확인`을 정책적으로 분리하지 못한다.
- embedding similarity가 우연히 높으면 다른 intent의 cached response가 재사용될 수 있다.

production 기준 필요 조건:

```text
request.canonicalIntent == cachedEntry.canonicalIntent
```

단, `canonicalIntent`는 raw prompt가 아니라 redaction 이후 normalized input에서 생성해야 한다.

## requiredSlots Gap

문서와 평가셋에는 `requiredSlots` 개념이 있다.

예:

```json
{
  "canonicalIntent": "support_refund.shipping_fee_refund",
  "requiredSlots": {
    "supportAction": "refund",
    "refundObject": "shipping_fee"
  }
}
```

하지만 production code에는 `requiredSlots` field나 비교 로직이 없다.

현재 영향:

- `반품하면 배송비도 돌려받나요?`
- `교환 신청은 어디서 하나요?`

위 두 요청은 같은 `support_refund` category로 볼 수 있지만, `requiredSlots`가 다르므로 같은 답을 재사용하면 안 된다.

현재 구현은 이 차이를 similarity에만 맡긴다.

production 기준 필요 조건:

```text
request.requiredSlots compatible cachedEntry.requiredSlots
```

최소한 아래 slot은 production policy에 필요하다.

| category | requiredSlots 예시 |
|---|---|
| `account_access` | `accountAction`, `credentialKind` |
| `general` | `usageObject`, `usageAnswerType`, `surface` |
| `support_refund` | `supportAction`, `refundObject`, `cancelObject`, `exchangeObject` |
| `translation` | deny category라 provider bypass hit 금지 |
| `code` | deny category라 provider bypass hit 금지 |
| `unknown` | deny category라 provider bypass hit 금지 |

## Category별 Threshold Gap

현재 `SemanticCacheServiceConfig`에는 단일 `Threshold`만 있다.

```text
SEMANTIC_CACHE_THRESHOLD=0.92
```

현재 store search도 단일 threshold를 받는다.

```text
Search(ctx, boundary, vector, threshold, topK)
```

production 기준으로는 category별 threshold가 필요하다.

이유:

- `general` FAQ성 요청은 비교적 낮은 threshold도 검토 가능하다.
- `account_access`는 계정/권한 안내라 `general`보다 보수적이어야 한다.
- `support_refund`는 금전/주문 상태와 연결될 수 있어 더 보수적이어야 한다.
- `translation`, `code`, `unknown`은 threshold와 무관하게 deny가 기본이다.

현재 구조에서 category별 threshold를 하려면 `SemanticCacheService.Search` 호출 전에 category 기반 threshold를 결정하거나, `SemanticCachePolicy` 객체가 threshold를 계산해야 한다.

권장 방향:

```text
threshold = SemanticCacheHitPolicy.ThresholdFor(category, canonicalIntent)
```

단, threshold는 최종 gate가 아니라 마지막 보조 조건이어야 한다.

## hardNegativeGuard Gap

문서와 평가셋에는 `hardNegative=true` case가 있다.

예:

```text
배송비도 환불되나요?
주문 취소하고 싶어요?
=> sameAnswerReusable=false
=> hardNegative=true
```

하지만 runtime code에는 hard negative guard가 없다.

현재 영향:

- 같은 category 안의 위험 pair를 policy로 강제 miss 처리할 수 없다.
- embedding model이나 threshold가 바뀔 때 false positive를 자동으로 막을 안전장치가 없다.
- `semantic_cache_intent_eval_cases.json`는 계약 데이터지만 release gate나 unit test로 아직 연결되어 있지 않다.

production 기준 필요 조건:

```text
hardNegativeGuard(request, cachedEntry) == passed
```

hard negative guard는 최소한 아래를 막아야 한다.

- `canonicalIntent` 불일치
- `requiredSlots` 충돌
- `support_refund` 안에서 refund/cancel/exchange intent 혼동
- `translation`, `code`, `unknown` deny category
- raw/secret/unsafe material이 canonical material에 들어온 경우

## Forbidden Data 분석

GateLM forbidden data 기준:

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

### normalized text

현재 embedding input은 `redactedPrompt`에서 생성된다.

```text
semanticEmbeddingInput(redactedPrompt)
```

그리고 `SemanticCacheService.Search`와 `Upsert`에서 `safeSemanticCacheText`를 다시 적용한다.

잘 되어 있는 부분:

- masking 이후 redacted prompt를 사용한다.
- 공백/대소문자 normalized input으로 바꾼다.
- `api_key=`, `app_token=`, `provider_key=`, `authorization:`, `bearer `, `raw prompt`, `provider raw error` 같은 marker가 있으면 차단한다.
- normalized text 자체를 `SemanticCacheEntry`에 저장하지 않는다.

남은 risk:

- marker 기반 검사라 모든 secret shape를 잡는 것은 아니다.
- redaction/masking이 놓친 실제 secret은 embedding provider로 전송될 수 있다.
- production에서는 semantic cache 전용 secret detector 또는 masking result confidence gate가 추가로 필요하다.

### vector

현재 `EmbeddingVector`는 `SemanticCacheEntry`에 저장된다.

현재 `in_memory` store에서는 process memory에만 존재하고 log로 출력하지 않는다.

남은 risk:

- vector는 raw text는 아니지만 입력 의미를 담는 derived data다.
- pgvector 같은 persistent store로 옮기면 retention, deletion, tenant isolation, export 금지 정책이 필요하다.
- vector를 API response, structured log, metric label에 절대 노출하면 안 된다.

### cache key / boundary

현재 `SemanticCacheBoundary`에는 raw prompt나 secret이 들어가지 않는다.

현재 포함 material:

- tenant/project/application identity
- prompt category
- provider/model stable identity
- provider catalog hash
- routing policy/hash
- safety/masking/cache policy hash
- request params hash
- cache version

이 방향은 맞다.

남은 gap:

- production policy material인 `canonicalIntent`, `requiredSlotsHash`, `canonicalizationVersion`이 없다.
- 향후 추가할 때도 raw prompt, prompt fragment, detected value, secret, provider raw error를 넣으면 안 된다.

### cache value

현재 cached response는 `providerResp`에서 `GateLM`과 `Raw`를 제거한 뒤 JSON으로 저장한다.

또한 `containsForbiddenSemanticCachePayload`가 forbidden marker를 검사한다.

남은 risk:

- marker 기반 scan이므로 provider response가 사용자의 민감 정보를 자연어로 echo하는 경우를 완전히 막지 못한다.
- response-side safety scan이 main path가 아니므로 production cache store 전에는 별도 `cacheableResponseGuard`가 필요하다.

### log

현재 semantic cache 관련 log/detail metadata는 주로 아래 값이다.

- `semanticCacheHit`
- `semanticSimilarity`
- `semanticMatchedRequestId`
- `semanticCacheThreshold`
- `semanticCachePolicyVersion`
- `semanticCacheDecisionReason`
- `embeddingProvider`

잘 되어 있는 부분:

- normalized text와 vector는 log에 남지 않는다.
- embedding 실패 시 provider flow가 계속되는 구조를 유지한다.
- cache key/value/log에 raw prompt, API Key, App Token, Provider Key, Authorization header가 남지 않는 테스트가 있다.

남은 risk:

- 향후 `canonicalIntent`, `requiredSlots`를 log/detail에 남길 경우 low-cardinality material만 허용해야 한다.
- slot value가 사용자 입력 원문이면 forbidden data가 될 수 있다.
- log에는 `requiredSlotsHash` 또는 safe canonical enum만 남기는 편이 안전하다.

## Gap Matrix

| production policy 요구사항 | 현재 구현 | Gap | 최소 변경 방향 |
|---|---|---|---|
| Semantic Cache 기본 비활성화 | `SEMANTIC_CACHE_ENABLED=false` | 없음 | 유지 |
| category allow/deny | allow/deny list 구현 | `support_refund`가 intent/slot 없이 allow됨. `account_access` category 없음 | `support_refund`는 strict/shadow로 낮추고 `account_access` 분리 검토 |
| same boundary | `SemanticCacheBoundary` 구현 | boundary 안에 intent/slot policy material 없음 | `semanticDecisionKeyHash` 또는 `canonicalIntent`/`requiredSlotsHash` 추가 |
| `canonicalIntent` | 문서/testdata에만 있음 | runtime hit 판단 없음 | canonicalizer 추가 후 entry와 lookup에 저장/비교 |
| `requiredSlots` | 문서/testdata에만 있음 | slot compatibility 판단 없음 | slot extractor와 compatibility evaluator 추가 |
| category별 threshold | 단일 `Threshold` | category risk 반영 불가 | `categoryThreshold` map 또는 policy resolver 추가 |
| hard negative guard | testdata에만 있음 | runtime false positive guard 없음 | hard negative evaluator와 dataset 기반 test 추가 |
| embedding similarity | 구현됨 | 현재 사실상 핵심 hit 조건 | 마지막 보조 조건으로 낮추기 |
| forbidden data guard | marker 기반 guard와 일부 테스트 있음 | secret shape 전체 보장 아님. vector는 derived sensitive data | semantic 전용 guard와 response cacheability guard 보강 |
| evaluation gate | JSON 계약 데이터 있음 | release gate에 연결 안 됨 | 외부 API 없이 도는 policy evaluator test 추가 |
| persistence | `in_memory` only | 재시작/다중 instance 공유 불가 | 정책 안정화 후 pgvector 검토 |

## 현재 구조에서 최소 구현으로 바꿀 위치

production-ready에 가까워지려면 전체 구조를 갈아엎을 필요는 없다.

최소 변경 단위는 아래가 적절하다.

### 1. `SemanticCacheHitPolicy` 추가

역할:

- category allow/deny
- `categoryThreshold` 결정
- `canonicalIntent` 필수 여부 판단
- `requiredSlots` compatibility 판단
- `hardNegativeGuard` 판단

handler가 embedding provider 구현체를 직접 알지 않는 현재 구조는 유지한다.

### 2. canonical material 생성기 추가

redaction 이후 normalized input을 받아 아래 material을 생성한다.

```json
{
  "category": "account_access",
  "canonicalIntent": "account.password_reset",
  "requiredSlots": {
    "accountAction": "password_reset"
  },
  "canonicalizationVersion": "ko-canon-v1"
}
```

주의:

- raw prompt를 넣지 않는다.
- prompt fragment를 넣지 않는다.
- secret/detected raw value를 넣지 않는다.
- slot value는 enum/low-cardinality 값만 허용한다.

### 3. store entry에 policy material 추가

`SemanticCacheEntry` 또는 별도 metadata에 아래를 저장한다.

- `Category`
- `CanonicalIntent`
- `RequiredSlotsHash`
- `CanonicalizationVersion`
- `SemanticCachePolicyVersion`

`requiredSlots` 원본 map을 저장할지는 신중해야 한다.

권장:

- hit 판단에는 canonical enum map 사용
- cache key/log에는 `requiredSlotsHash` 또는 safe enum summary만 사용
- raw value가 들어갈 가능성이 있으면 저장하지 않음

### 4. hit evaluator를 store search 이후에 추가

현재 store는 vector similarity 후보를 반환한다.

production에서는 store search 결과를 바로 hit로 쓰지 말고 evaluator를 통과시킨다.

```text
candidate = vectorStore.Search(...)

hit = candidate exists
  AND policy.CategoryAllowed(category)
  AND policy.IntentMatches(request, candidate)
  AND policy.RequiredSlotsCompatible(request, candidate)
  AND policy.HardNegativePassed(request, candidate)
  AND candidate.Similarity >= policy.ThresholdFor(category, canonicalIntent)
```

### 5. `support_refund` store/hit mode 분리

`support_refund`는 production에서 바로 provider bypass hit를 허용하지 않는다.

권장 mode:

```text
support_refund.mode = shadow | candidate_only | strict_hit
```

초기 production 권장값:

```text
support_refund.mode = candidate_only
```

즉 similarity와 policy 결과는 log/evidence로 남기되 provider bypass는 하지 않는다.

### 6. 평가셋 release gate 추가

`semantic_cache_intent_eval_cases.json`를 읽는 테스트를 추가한다.

이 테스트는 OpenAI API에 의존하면 안 된다.

검증해야 할 것:

- `sameAnswerReusable=true` case만 hit 후보
- `sameAnswerReusable=false` case는 miss
- `hardNegative=true` case는 무조건 miss
- `denyCategory=true` case는 bypass
- `canonicalIntent` 불일치면 miss
- `requiredSlots` 충돌이면 miss

## Production 전 필수 작업

production provider bypass hit를 허용하기 전에 최소한 아래는 끝나야 한다.

1. `canonicalIntent` taxonomy 확정
2. `requiredSlots` taxonomy 확정
3. redaction 이후 canonical material 생성기 구현
4. `requiredSlots` compatibility evaluator 구현
5. `hardNegativeGuard` 구현
6. category별 `categoryThreshold` 정책 구현
7. `support_refund`를 `candidate_only` 또는 strict mode로 분리
8. OpenAI API 없이 도는 evaluation dataset test 추가
9. OpenAI embedding model별 offline score report 유지
10. cache value 저장 전 `cacheableResponseGuard` 보강
11. vector를 derived sensitive data로 취급하는 retention/export/log 금지 정책 명시
12. production rollout은 shadow mode부터 시작

## 구현 우선순위

### P0. Provider bypass 안전 차단

`support_refund`는 `canonicalIntent`, `requiredSlots`, `hardNegativeGuard` 구현 전까지 provider bypass hit를 막는다.

`general`도 `canonicalIntent`가 없는 경우에는 hit가 아니라 miss 또는 candidate로 처리한다.

### P1. Policy material schema 추가

`SemanticCacheBoundary`에 바로 raw map을 넣기보다, 먼저 safe policy material을 정의한다.

후보:

```text
canonicalIntent
requiredSlotsHash
canonicalizationVersion
semanticCachePolicyHash
```

### P2. Intent/slot evaluator 구현

문서의 taxonomy와 `semantic_cache_intent_eval_cases.json`를 기준으로 deterministic evaluator를 만든다.

초기에는 ML 모델 없이 rule 기반으로 시작한다.

### P3. Category별 threshold

단일 `SEMANTIC_CACHE_THRESHOLD`를 유지하되, production policy에서는 category별 override를 둔다.

예:

```text
SEMANTIC_CACHE_THRESHOLD_GENERAL
SEMANTIC_CACHE_THRESHOLD_ACCOUNT_ACCESS
SEMANTIC_CACHE_THRESHOLD_SUPPORT_REFUND
```

또는 JSON policy로 관리한다.

### P4. Evaluation gate

OpenAI API 없이 통과하는 deterministic test를 먼저 추가한다.

그 다음 OpenAI smoke/eval은 선택 테스트로 둔다.

### P5. Store 고도화

pgvector/vector DB는 hit 품질을 올리는 장치가 아니다.

pgvector는 검색 성능과 persistence를 위한 작업이다.

따라서 정책 안전장치가 먼저이고, store 고도화는 그 다음이다.

## MVP 기준과 Production-ready 기준

### MVP 기준

MVP에서는 아래까지면 충분하다.

- 기본 비활성화
- opt-in으로만 semantic cache 사용
- category deny 적용
- stream/fallback/provider error bypass
- forbidden marker guard
- embedding 실패 시 provider flow 유지
- 한국어 embedding similarity와 threshold 실험 기록
- evaluation dataset 계약 문서화

현재 구현은 이 기준에는 근접해 있다.

### Production-ready 기준

Production-ready는 다르다.

아래가 모두 필요하다.

- embedding similarity만으로 hit 금지
- `canonicalIntent` 일치 필수
- `requiredSlots` compatibility 필수
- `hardNegativeGuard` 필수
- category별 `categoryThreshold` 필수
- `support_refund` strict policy 필수
- deny category는 threshold와 무관하게 bypass
- raw prompt, API Key, App Token, Provider Key, Authorization header, provider raw error body 저장 금지
- vector/normalized text/log에 forbidden data가 남지 않는 자동 테스트
- OpenAI API 없이 도는 production policy evaluation test
- shadow mode rollout evidence

현재 구현은 production-ready 기준에는 아직 도달하지 않았다.

## 최종 판단

지금 가능한 것:

- Semantic Cache MVP flow 검증
- 한국어 embedding provider 연결 검증
- category deny 기반 bypass 검증
- routing-aware boundary 기반 격리
- forbidden marker 기반 cache key/value/log 안전성 검증

부족한 것:

- `canonicalIntent` runtime 판단 없음
- `requiredSlots` runtime 판단 없음
- `hardNegativeGuard` 없음
- category별 threshold 없음
- `support_refund` production-safe hit 정책 없음
- evaluation dataset이 release gate로 연결되지 않음
- response cacheability guard가 marker scan 수준에 머무름

production 전 필수 작업:

- similarity 중심 hit를 policy 중심 hit로 바꾼다.
- `canonicalIntent`와 `requiredSlots`를 hit 필수 조건으로 넣는다.
- hard negative를 무조건 miss 처리한다.
- `support_refund`는 strict policy 전까지 candidate/shadow로 둔다.
- OpenAI API 없이 도는 한국어 intent/slot evaluation test를 release gate로 만든다.

구현 우선순위:

1. `support_refund` provider bypass hit 제한
2. `canonicalIntent` / `requiredSlots` policy material schema 확정
3. deterministic intent/slot extractor와 evaluator 구현
4. hard negative guard 구현
5. category별 threshold 적용
6. evaluation dataset 기반 자동 테스트 추가
7. shadow mode 운영 후 pgvector/store 고도화 검토
