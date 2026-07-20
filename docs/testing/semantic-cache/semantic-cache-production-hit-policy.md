# Semantic Cache Production Hit Policy

## 목적

이 문서는 GateLM Semantic Cache를 실서비스 response path에 넣기 전에 필요한 production hit policy를 정리한다.

핵심 결론은 아래다.

- production에서는 `semanticSimilarity >= threshold`만으로 cache hit를 허용하지 않는다.
- 이전 응답 재사용은 `category`, `canonicalIntent`, `requiredSlots`, `dynamic_user_state` guard, `hardNegativeGuard`, `categoryThreshold`, `reranker`, `SemanticCacheBoundary`가 모두 통과할 때만 허용한다.
- false negative보다 false positive가 더 위험하다. 애매하면 miss 또는 bypass한다.
- v2.0.0 계약상 Semantic Cache는 core response path가 아니라 evidence track이다. 이 문서는 production 전환을 위한 후속 정책 설계 문서다.

## 현재 전제

현재 Semantic Cache MVP는 아래 수준이다.

- `SEMANTIC_CACHE_ENABLED=false` 기본값
- `SEMANTIC_CACHE_EMBEDDING_PROVIDER=fake` 기본값
- 현재 `feat/semantic-caching` 기준 runtime embedding provider는 `fake`만 지원한다.
- `SEMANTIC_CACHE_EMBEDDING_PROVIDER=openai` opt-in은 별도 OpenAI provider PR 범위다.
- `InMemorySemanticCacheStore`
- 단일 `SEMANTIC_CACHE_THRESHOLD`
- category allow/deny 기반 lookup/store bypass
- `SemanticCacheBoundary` 기반 tenant/project/application/provider/model/routing 격리

이 상태는 production-ready가 아니다. 특히 단일 threshold만으로 이전 응답을 재사용하면 아래 문제가 생긴다.

- 같은 의미인데 miss되는 false negative
- 다른 의도인데 hit되는 false positive
- 같은 category 안에서 의도가 다른 요청을 잘못 재사용
- embedding model 변경 시 score 분포 변화
- category별 위험도가 다른데 같은 threshold를 쓰는 문제

## Production Hit 허용 조건

production Semantic Cache hit는 아래 조건을 모두 만족해야 한다.

1. `SEMANTIC_CACHE_ENABLED=true`
2. `stream=false`
3. request-side safety block 아님
4. auth/app-token 실패 아님
5. Exact Cache hit 아님
6. category가 production allow 대상
7. `SemanticCacheBoundary`가 기존 entry와 동일
8. redaction 이후 normalized input만 사용
9. `canonicalIntent`가 생성되고 기존 entry와 동일
10. `requiredSlots`가 모두 추출되고 기존 entry와 동일하거나 정책상 compatible
11. `hardNegativeGuard` 통과
12. `dynamic_user_state` 요청이 아님
13. `semanticSimilarity >= categoryThreshold`
14. `reranker`가 켜진 category에서는 `reranker pass`
15. `semanticCachePolicyVersion`, `canonicalizationVersion`, `embeddingProvider`, `embeddingModel`이 기존 entry와 compatible
16. cached response가 안전한 payload 검증을 통과
17. 기존 entry가 fallback 응답, provider error 응답, unsafe payload가 아님

하나라도 실패하면 production hit가 아니다.

실패 시 처리는 아래 중 하나다.

- `miss`: provider 호출 후 안전하면 store 후보
- `bypass`: lookup/store 모두 하지 않음
- `store_skipped`: lookup은 했지만 store 금지

## 금지 조건

아래 경우는 production hit를 금지한다.

- `semanticSimilarity >= threshold` 단독 판단
- `canonicalIntent` 없음
- `requiredSlots` 일부 누락
- `requiredSlots` 값 충돌
- `dynamic_user_state` 요청
- category가 deny 대상
- `hardNegativeGuard`가 위험 pair로 판단
- `reranker` 필수 category에서 `reranker` reject, timeout, provider failure
- `semanticCachePolicyVersion` 불일치
- `canonicalizationVersion` 불일치
- `embeddingProvider` 또는 `embeddingModel` 변경 후 compatibility 미확인
- safety/masking policy 변경 후 compatibility 미확인
- fallback 응답
- provider error 응답
- streaming 응답
- raw prompt 또는 secret-like input이 redaction 전에 cache material로 들어온 경우

## Category Policy

category별 정책은 단일 allowlist가 아니라 risk tier를 가져야 한다.

| category | production 기본 정책 | 이유 |
| --- | --- | --- |
| `general` | 조건부 allow | FAQ, 계정 도움말, 사용량 안내처럼 같은 답 재사용이 가능한 영역이 있음 |
| `support_refund` | 기본 strict, 초기 production에서는 bypass 또는 reranker 필요 | 환불, 반품, 취소, 교환, 배송비는 같은 category 안에서도 의도가 갈림 |
| `translation` | deny | 입력 문장 자체가 응답을 결정하므로 재사용 위험 큼 |
| `code` | deny | 코드 내용, 에러 맥락, 버전이 다르면 응답 재사용 위험 큼 |
| `reasoning` | deny | reasoning trace나 문제 조건이 다르면 오답 위험 큼 |
| `sensitive` | deny | 민감정보 처리 경로는 cache 재사용 금지 |
| `tool_call` | deny | 외부 state, tool result, side effect 가능성 |
| `unknown` | deny | 의도 불명확 |

`support_refund`는 allow category로 남기더라도 production에서는 아래 조건 없이는 hit하지 않는다.

- `canonicalIntent`가 세분화되어야 함
- `requiredSlots`가 명확해야 함
- hard negative 평가셋을 통과해야 함
- 가능하면 `reranker` 또는 `judge`를 애매한 score band에만 적용

## Normalization + Reranker 이후 Beta Rollout 정책

2026-07-03 actual eval 기준으로 beta rollout 범위는 아래처럼 제한한다.

| category | beta 정책 | threshold 후보 | reranker 정책 | 이유 |
| --- | --- | ---: | --- | --- |
| `general` static guidance | limited enforce 후보 | 0.50 | policy guard 통과 후 pass 필요 | `text-embedding-3-large`에서 positive 3/3 유지, dynamic guard 필수 |
| `account_access` | shadow 유지 | 0.50 shadow | shadow 측정만 | credential/계정 상태/권한 안내가 섞이면 위험 |
| `support_refund` | enforce 금지, strict shadow 또는 candidate_only | 0.70 shadow | pass해도 enforce 금지 | 환불/취소/교환 false positive 비용이 큼 |
| `code` | deny | 없음 | 호출 전 bypass | 코드 내용과 실행 맥락이 응답을 결정 |
| `translation` | deny | 없음 | 호출 전 bypass | 입력 문장 자체가 응답을 결정 |
| `unknown` | deny | 없음 | 호출 전 bypass | intent/slot 신뢰 불가 |

### `general` Static Guidance

limited enforce 후보는 정적 안내성 답변으로 좁힌다.

허용 후보:

- 메뉴 위치 안내
- 설정 위치 안내
- 사용량 확인 화면 안내
- API 사용량 dashboard 위치 안내
- 계정 설정 화면 위치 안내

금지 후보:

- 실제 이번 달 사용량 수치
- 오늘 토큰 사용량
- 현재 프로젝트별 비용
- 계정 상태, 잠김 여부, 개인별 quota 잔여량

필수 조건:

```text
category=general
+ canonicalIntent 존재
+ requiredSlots.usageAnswerType=static_guidance
+ dynamic_user_state 아님
+ semanticSimilarity >= 0.50
+ reranker pass
```

`0.45`는 shadow/canary 관찰 후보로만 둔다. raw dynamic negative가 threshold를 넘는 구간이므로, guard 없이 enforce하면 안 된다.

### `account_access`

`account_access`는 shadow 유지가 맞다.

이 category에는 비밀번호 재설정처럼 재사용 가능한 FAQ가 있지만, API Key/App Token/Provider Key 발급, credential rotation, 계정 잠김, 사용자 권한 같은 요청이 섞일 수 있다.

정책:

- beta enforce 금지
- `categoryThreshold=0.50`은 shadow 측정 기준
- credential-like input이 있으면 lookup/store bypass
- raw API Key, App Token, Provider Key, Authorization header는 cache key/value/log/detail/metric label에 금지
- account hard negative 평가셋 확장 전 provider bypass 금지

### `support_refund`

`support_refund`는 enforce 금지다.

정책:

- `support_refund=disabled`, `candidate_only`, 또는 strict shadow
- `categoryThreshold=0.70`은 shadow 측정 기준
- `shipping_fee_refund`, `order_cancel`, `exchange_request`, `refund_request`는 다른 workflow로 취급
- `rerankerScore`가 높아도 `canonicalIntent` mismatch, `requiredSlots` mismatch, `hardNegativeGuard`를 override하지 않음
- hard negative hit가 하나라도 나오면 rollout 후보에서 제외

### Reranker Score 기준

현재 최소 구현에서 `rerankerScore`는 safe observability field다. production용 calibrated score로 확정된 값은 아니다.

beta 기준:

- deterministic reranker는 `rerankerPassed=true`와 `rerankerDecisionReason=reranker_pass`를 우선한다.
- score 기반 reranker를 붙이면 `general` static guidance shadow에서만 먼저 측정한다.
- enforce 후보는 `rerankerScore >= 0.80`부터 검토하되, false positive 0건과 충분한 eval sample이 먼저 필요하다.
- `reranker_provider_failure`, `reranker_timeout`, `reranker_input_unsafe`는 hit가 아니라 miss/provider path다.
- `support_refund`는 `rerankerScore`와 무관하게 enforce 금지다.

### False Positive / False Negative 기준

beta 정책은 false negative보다 false positive를 더 위험하게 본다.

- false positive: 다른 요청에 이전 답을 재사용한다. 사용자에게 틀린 정책/비용/계정 안내가 갈 수 있다.
- false negative: 재사용 가능했지만 provider를 호출한다. 비용은 늘지만 정합성 사고는 아니다.

따라서 애매하면 hit가 아니라 miss다.

### Latency / Cost 영향

- normalization은 외부 호출이 없어 latency/cost 영향이 작다.
- OpenAI embedding provider를 쓰면 lookup/store 후보마다 embedding 호출 비용이 생긴다.
- deterministic reranker는 추가 OpenAI 비용이 없다.
- external reranker 또는 LLM judge는 top-k 후보 수만큼 추가 latency/cost가 생기므로 beta 기본값 off다.

### Rollback 조건

아래 조건 중 하나라도 발견되면 해당 tenant/application/category enforce를 즉시 shadow 또는 disabled로 되돌린다.

- `dynamic_user_state` 요청에서 `semanticCacheHit=true`
- `code`, `translation`, `unknown`에서 `semanticCacheHit=true`
- `support_refund`에서 provider bypass hit 발생
- `canonicalIntent` mismatch인데 hit 발생
- `requiredSlotsHash` mismatch인데 hit 발생
- `hardNegativeGuard` 대상 pair에서 hit 발생
- `rerankerDecisionReason=reranker_provider_failure` 또는 `reranker_timeout` 증가로 provider path 안정성이 낮아짐
- raw prompt, API Key, App Token, Provider Key, Authorization header, provider raw error body가 log/detail/cache/test output에 남음

### 모니터링 Safe Field

관측에는 low-cardinality 또는 numeric safe field만 남긴다.

- `cacheType`
- `cacheMode`
- `semanticCacheHit`
- `semanticCacheDecisionReason`
- `semanticSimilarity`
- `semanticCacheThreshold`
- `semanticCachePolicyVersion`
- `normalizationVersion`
- `embeddingProvider`
- `embeddingModel`
- `category`
- `canonicalIntent`
- `requiredSlotsHash`
- `rerankerApplied`
- `rerankerPassed`
- `rerankerScore`
- `rerankerDecisionReason`
- `providerCalled`

metric label에는 high-cardinality value를 넣지 않는다. score는 가능하면 bucket으로 집계한다.

## canonicalIntent

`canonicalIntent`는 Semantic Cache hit 판단을 위한 low-cardinality intent label이다.

예:

```text
account.password_reset
account.api_key_create
usage.monthly_usage_check
support_refund.shipping_fee_refund
support_refund.order_cancel
support_refund.exchange_request
```

규칙:

- raw prompt를 그대로 넣지 않는다.
- prompt fragment를 넣지 않는다.
- detected raw value를 넣지 않는다.
- 사용자별 고유값, 주문번호, 이메일, 전화번호, secret을 넣지 않는다.
- 사람이 관리 가능한 low-cardinality label이어야 한다.
- `canonicalIntent` 생성 규칙은 `semanticCachePolicyVersion` 또는 별도 `canonicalizationVersion`에 묶는다.

예시:

```text
비밀번호 재설정 방법 알려줘
패스워드 초기화는 어떻게 해?
```

두 요청은 production policy에서 아래처럼 같은 intent로 볼 수 있다.

```text
canonicalIntent=account.password_reset
```

반면 아래 두 요청은 같은 `support_refund` category라도 intent가 다르다.

```text
배송비도 환불되나요?
주문 취소하고 싶어요
```

```text
canonicalIntent=support_refund.shipping_fee_refund
canonicalIntent=support_refund.order_cancel
```

이 경우 `semanticSimilarity`가 threshold 이상이어도 hit하면 안 된다.

## requiredSlots

`requiredSlots`는 같은 `canonicalIntent` 안에서도 응답 재사용 가능성을 가르는 필수 속성이다.

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

다른 예:

```json
{
  "canonicalIntent": "account.password_reset",
  "requiredSlots": {
    "accountAction": "password_reset"
  }
}
```

production hit 조건:

- 현재 요청의 `requiredSlots`가 모두 존재해야 한다.
- 기존 cache entry의 `requiredSlots`와 현재 요청의 `requiredSlots`가 동일하거나 policy에서 compatible로 정의되어야 한다.
- slot이 비어 있거나 `unknown`이면 hit하지 않는다.
- slot 값은 low-cardinality 값이어야 한다.
- raw order id, raw email, raw phone, raw API key 같은 값은 slot에 넣지 않는다.

`requiredSlots` 예시:

| category | canonicalIntent | requiredSlots |
| --- | --- | --- |
| `general` | `account.password_reset` | `accountAction=password_reset` |
| `general` | `account.api_key_create` | `accountAction=api_key_create` |
| `general` | `usage.monthly_usage_check` | `usageObject=api_usage`, `usageAnswerType=static_guidance` |
| `support_refund` | `support_refund.shipping_fee_refund` | `supportAction=refund`, `refundObject=shipping_fee` |
| `support_refund` | `support_refund.order_cancel` | `supportAction=cancel`, `refundObject=order_payment` |
| `support_refund` | `support_refund.exchange_request` | `supportAction=exchange` |

## categoryThreshold

production에서는 단일 `SEMANTIC_CACHE_THRESHOLD`만으로 충분하지 않다.

필요한 이유:

- category마다 false positive 비용이 다르다.
- `general` FAQ와 `support_refund` 문의는 재사용 위험도가 다르다.
- embedding model마다 score 분포가 다르다.
- 한국어 짧은 문장에서는 positive score가 낮게 나올 수 있다.
- hard negative가 positive보다 높게 나오는 경우가 있다.

정책 예시:

```json
{
  "semanticCachePolicyVersion": "semantic-cache-policy-ko-v1",
  "categories": {
    "general": {
      "enabled": true,
      "categoryThreshold": 0.50,
      "requiresCanonicalIntent": true,
      "requiresRequiredSlots": true
    },
    "support_refund": {
      "enabled": false,
      "categoryThreshold": 0.75,
      "requiresCanonicalIntent": true,
      "requiresRequiredSlots": true,
      "requiresHardNegativeGuard": true,
      "ambiguousBand": {
        "min": 0.55,
        "max": 0.75,
        "action": "miss"
      }
    }
  }
}
```

위 숫자는 예시다. 실제 값은 평가셋과 traffic 기반 offline evaluation으로 정해야 한다.

## hardNegativeGuard

`hardNegativeGuard`는 embedding similarity가 높아도 응답 재사용이 위험한 pair를 막는 장치다.

필수 원칙:

- hard negative pair는 category별 평가셋에 포함한다.
- hard negative false positive가 발생하면 해당 policy는 production-ready가 아니다.
- hard negative가 확인된 intent 조합은 `forbiddenIntentPairs` 또는 slot conflict rule로 막는다.

예:

```json
{
  "category": "support_refund",
  "forbiddenIntentPairs": [
    ["support_refund.shipping_fee_refund", "support_refund.order_cancel"],
    ["support_refund.return_shipping_fee", "support_refund.exchange_request"]
  ]
}
```

아래 pair는 같은 `support_refund` category지만 production hit 금지 후보다.

```text
배송비도 환불되나요?
주문 취소하고 싶어요
```

```text
반품하면 배송비도 돌려받나요?
교환 신청은 어디서 하나요?
```

## support_refund 처리 원칙

`support_refund`는 실서비스에서 위험 category로 취급한다.

이유:

- 환불, 반품, 취소, 교환은 고객 지원 정책과 비용에 직접 연결된다.
- 배송비, 상품비, 결제 취소, 쿠폰, 포인트처럼 응답 조건이 갈린다.
- 같은 category 안에서도 재사용 가능한 답과 불가능한 답이 섞인다.

원칙:

- production 초기에는 `support_refund`를 `bypass`로 둔다.
- allow하려면 `canonicalIntent`와 `requiredSlots`가 필수다.
- `support_refund`에는 `categoryThreshold`를 `general`보다 보수적으로 둔다.
- hard negative guard 통과 전에는 provider bypass를 허용하지 않는다.
- 애매한 score band는 hit가 아니라 miss로 처리한다.
- 필요하면 `reranker` 또는 `judge`를 `support_refund`의 ambiguous case에만 적용한다.

## 저장 금지 데이터

아래 값은 cache key, cache value, DB record, fixture, structured log, metric label, UI에 평문으로 남기지 않는다.

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

Semantic Cache production material에도 아래를 직접 넣지 않는다.

- raw prompt
- prompt fragment
- 사용자 고유 식별값
- 실제 주문번호
- 실제 이메일
- 실제 전화번호
- 실제 credential
- provider raw error

허용 가능한 material은 redaction 이후 안전한 low-cardinality 값이다.

예:

```text
category=general
canonicalIntent=account.password_reset
requiredSlots.accountAction=password_reset
semanticCachePolicyVersion=semantic-cache-policy-ko-v1
canonicalizationVersion=ko-canon-v1
```

## Production-Ready 기준

production-ready로 보려면 아래 기준을 만족해야 한다.

1. category별 policy가 문서화되어 있음
2. `canonicalIntent` 생성 규칙이 versioned policy로 관리됨
3. `requiredSlots` 추출 규칙이 versioned policy로 관리됨
4. `categoryThreshold`가 평가셋 기반으로 승인됨
5. hard negative 평가셋이 category별로 존재함
6. hard negative false positive가 release gate에서 차단됨
7. `support_refund` 같은 위험 category는 stricter mode 또는 bypass로 운영 가능함
8. embedding model 변경 시 재평가가 필수임
9. `semanticCachePolicyVersion`, `canonicalizationVersion`, `embeddingProvider`, `embeddingModel` 변경 시 cache compatibility가 명확함
10. fallback/provider error/unsafe payload store bypass가 검증됨
11. raw prompt/secret 저장 금지 검증이 자동화됨
12. request detail/log에는 low-cardinality decision reason만 남음
13. offline evaluation report가 PR 또는 release evidence에 포함됨
14. `dynamic_user_state` bypass가 lookup/store/reranker 전에 검증됨
15. `reranker`가 필요한 category에서는 failure-safe miss가 검증됨
16. rollback 조건과 safe monitoring field가 운영 문서에 정의됨

## Production Evaluation Dataset

Semantic Cache production hit policy는 embedding score만 보는 평가셋이 아니라 intent/slot 정답지를 기준으로 검증한다.

평가셋 위치:

```text
apps/gateway-core/internal/domain/cache/testdata/semantic_cache_intent_eval_cases.json
```

Beta 확장 계획:

```text
docs/testing/semantic-cache-beta-eval-dataset-plan.md
```

이 평가셋은 OpenAI API 호출 결과가 아니다. `OPENAI_API_KEY` 없이 읽고 검증할 수 있는 static contract다.

필수 field:

| field | 의미 |
| --- | --- |
| `caseId` | low-cardinality case id |
| `category` | 요청 category |
| `canonicalIntent` | 같은 답 재사용 가능성을 판단하는 canonical intent |
| `requiredSlots` | hit 허용에 반드시 필요한 slot map |
| `optionalSlots` | compatibility 판단 보조 slot map |
| `sameAnswerReusable` | 이전 응답 재사용 가능 여부 |
| `hardNegative` | 같은 category 또는 높은 similarity에도 hit하면 안 되는 pair 여부 |
| `denyCategory` | category policy상 Semantic Cache bypass 대상 여부 |
| `expectedDecision` | `hit_candidate`, `strict_hit_candidate`, `miss`, `bypass` 중 기대 결정 |
| `reason` | 사람이 읽는 low-cardinality 이유 |

평가 기준:

- `sameAnswerReusable=true`인 case는 `category`, `canonicalIntent`, `requiredSlots`가 compatible할 때만 hit 후보가 된다.
- `sameAnswerReusable=false`인 case는 similarity가 높아도 hit하면 안 된다.
- `hardNegative=true`인 case가 hit되면 release gate 실패다.
- `denyCategory=true`인 case는 lookup/store 모두 bypass해야 한다.
- `support_refund`의 `sameAnswerReusable=true`는 바로 production hit가 아니라 `strict_hit_candidate`로 본다.

현재 필수 case:

| caseId | sameAnswerReusable | hardNegative | denyCategory | 의미 |
| --- | --- | --- | --- | --- |
| `account_password_reset_positive_ko` | `true` | `false` | `false` | password reset / password initialization |
| `account_api_key_create_positive_ko` | `true` | `false` | `false` | API Key 발급 / API Key 생성 |
| `general_usage_stats_positive_ko` | `true` | `false` | `false` | 사용량 확인 / 사용량 통계 |
| `support_refund_shipping_fee_positive_ko` | `true` | `false` | `false` | 배송비 환불 / 반품 배송비 환불 |
| `support_refund_shipping_fee_vs_order_cancel_hard_negative_ko` | `false` | `true` | `false` | 배송비 환불 / 주문 취소 |
| `support_refund_return_shipping_fee_vs_exchange_hard_negative_ko` | `false` | `true` | `false` | 반품 배송비 / 교환 신청 |
| `translation_deny_ko` | `false` | `false` | `true` | translation deny |
| `code_deny_ko` | `false` | `false` | `true` | code deny |
| `unknown_deny_empty_ko` | `false` | `false` | `true` | unknown deny |

주의:

- 평가셋에는 실제 API Key 값을 넣지 않는다. `API Key 발급`은 credential 값이 아니라 intent label 검증용 synthetic 문장이다.
- 실제 고객 prompt, 주문번호, 이메일, 전화번호, token, Authorization header는 넣지 않는다.
- 이 평가셋은 threshold tuning dataset이 아니라 production hit policy dataset이다.

## MVP 기준

MVP는 아래 수준으로 제한한다.

- Semantic Cache 기본값 disabled
- `fake` embedding provider 기본값
- OpenAI embedding provider는 후속 opt-in 범위
- in-memory store
- category allow/deny
- 단일 threshold
- 한국어 small evaluation set
- production hit 보장 아님
- demo/local 검증 목적

MVP에서 허용할 수 있는 표현:

```text
Semantic Cache flow integration verified
policy-driven intent/slot guard verified with fake embedding
Korean intent/slot evaluation dataset documented
demo/local threshold candidate requires separate embedding provider validation
```

MVP에서 금지할 표현:

```text
production-ready semantic cache
safe for all support requests
threshold alone is sufficient
provider bypass is generally safe
```

## 후속 구현 단계

### Step 1. Policy Material 정의

`semanticCachePolicyVersion` 단위로 아래 material을 정의한다.

```json
{
  "semanticCachePolicyVersion": "semantic-cache-policy-ko-v1",
  "canonicalizationVersion": "ko-canon-v1",
  "embeddingProvider": "openai",
  "embeddingModel": "text-embedding-3-large",
  "categories": {}
}
```

### Step 2. canonicalIntent 생성기

redaction 이후 normalized input에서 `canonicalIntent`를 생성한다.

주의:

- raw prompt 저장 금지
- deterministic이어야 함
- low-cardinality여야 함
- versioned policy에 묶어야 함

### Step 3. requiredSlots 추출기

category별 `requiredSlots`를 추출한다.

주의:

- slot 값은 low-cardinality
- raw PII/secret 금지
- slot 누락 시 hit 금지

### Step 4. Category별 Threshold

단일 `SEMANTIC_CACHE_THRESHOLD`를 production 기준으로 대체한다.

예:

```text
general.categoryThreshold
support_refund.categoryThreshold
```

### Step 5. hardNegativeGuard

category별 hard negative 평가셋과 runtime guard를 추가한다.

### Step 6. Evaluation Gate

PR 또는 release 전 아래를 자동 확인한다.

- positive hit rate
- negative false positive
- hard negative false positive
- category별 false positive
- latency
- provider bypass safety

### Step 7. Risky Category 운영 모드

`support_refund` 같은 category는 아래 모드를 지원한다.

```text
disabled
candidate_only
strict_hit
rerank_required
```

초기 production 권장값:

```text
support_refund=disabled 또는 candidate_only
```

### Step 8. Store/Index 고도화

pgvector, Redis Vector Search, Qdrant, Pinecone 등은 hit policy가 안정된 뒤 검토한다.

vector store는 검색 성능과 공유 저장소 문제를 해결하지만, 잘못된 hit policy를 안전하게 만들지는 않는다.

## 최종 결론

Semantic Cache production hit는 아래 공식으로 판단한다.

```text
hit =
  semantic cache enabled
  AND category allowed
  AND same SemanticCacheBoundary
  AND same canonicalIntent
  AND requiredSlots compatible
  AND dynamic_user_state is false
  AND hardNegativeGuard passed
  AND semanticSimilarity >= categoryThreshold
  AND reranker passed when required
  AND safe cached response
```

아래 공식은 production에서 금지한다.

```text
hit = semanticSimilarity >= threshold
```

GateLM production Semantic Cache는 단순 vector similarity cache가 아니라 policy-driven intent cache로 설계해야 한다.
