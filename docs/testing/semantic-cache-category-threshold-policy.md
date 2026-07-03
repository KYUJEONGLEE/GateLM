# Semantic Cache Category Threshold 정책 검토

## 목적

이 문서는 Semantic Cache의 `categoryThreshold`를 category별로 분리할 필요가 있는지 검토한 결과다.

이번 작업은 production runtime 기본값 변경이 아니다. OpenAI embedding eval 결과를 근거로 `semantic_cache_policy_ko_v1.json` test policy material에 beta 후보 threshold를 반영하고, production 적용 전 남은 검증 조건을 정리한다.

## 전제

threshold는 단독 hit 조건이 아니다.

Semantic Cache hit는 반드시 아래 순서를 통과한 뒤에만 허용한다.

```text
category allow
+ canonicalIntent match
+ requiredSlots match
+ hardNegativeGuard pass
+ similarity >= categoryThreshold
```

따라서 `categoryThreshold`를 낮추더라도 `canonicalIntent`, `requiredSlots`, `hardNegativeGuard`를 우회하면 안 된다.

## Current Beta Policy

현재 test policy material에는 OpenAI eval 결과를 반영한 beta 후보 threshold를 적용한다.

- 파일: `apps/gateway-core/internal/domain/cache/testdata/semantic_cache_policy_ko_v1.json`
- `defaultThreshold`: `0.92`

현재 category 설정:

| category | mode | categoryThreshold | requiresIntent | requiresRequiredSlots | requiresHardNegative |
| --- | --- | ---: | --- | --- | --- |
| `account_access` | `strict_hit` | 0.50 | true | true | true |
| `general` | `strict_hit` | 0.50 | true | true | true |
| `support_refund` | `strict_hit` | 0.70 | true | true | true |
| `translation` | `disabled` | 없음 | - | - | - |
| `code` | `disabled` | 없음 | - | - | - |
| `unknown` | `disabled` | 없음 | - | - | - |

기존 일괄 `0.92`는 fake embedding test에서는 의미가 있지만, 실제 OpenAI embedding 한국어 eval에서는 너무 높았다. `text-embedding-3-small`, `text-embedding-3-large` 모두 `0.80` 이상에서 positive pair가 0건이었다.

중요한 점은 `categoryThreshold`를 낮췄더라도 hit 허용 조건은 그대로다.

```text
category allow
+ canonicalIntent match
+ requiredSlots match
+ hardNegativeGuard pass
+ similarity >= categoryThreshold
```

## 2026-07-03 Beta Rollout 재검토 결론

normalization과 reranker actual eval 이후 beta rollout 정책은 test policy material보다 더 좁게 잡는다.

핵심 결론:

- `general` static guidance만 limited enforce 후보로 둔다.
- `account_access`는 shadow 유지가 맞다.
- `support_refund`는 enforce 금지 또는 strict shadow 유지가 맞다.
- `code`, `translation`, `unknown`은 deny 유지다.
- `dynamic_user_state`는 embedding/reranker 전에 bypass 유지다.
- `text-embedding-3-large`가 현재 한국어 beta 후보로 더 적합하다.
- threshold는 단독 hit 조건이 아니며, `canonicalIntent`, `requiredSlots`, `dynamic_user_state`, `hardNegativeGuard`, `reranker` 이후의 마지막 numeric gate로만 사용한다.

runtime rollout 정책과 test policy material은 아래처럼 구분한다.

| category | test/eval material | beta rollout 권장 | 이유 |
| --- | --- | --- | --- |
| `general` | `strict_hit`, `categoryThreshold=0.50` | limited enforce 가능 | static guidance에 한정하면 actual eval에서 positive 유지 가능 |
| `account_access` | `strict_hit`, `categoryThreshold=0.50` | shadow 유지 | credential/계정 workflow는 false positive 비용이 높고 hard negative가 더 필요 |
| `support_refund` | `strict_hit`, `categoryThreshold=0.70` | enforce 금지, strict shadow 또는 candidate_only | 환불/취소/교환은 같은 category 안 false positive 비용이 큼 |
| `code` | `disabled` | deny | 입력 코드와 에러 맥락이 응답을 결정함 |
| `translation` | `disabled` | deny | 입력 문장 자체가 응답을 결정함 |
| `unknown` | `disabled` | deny | intent/slot 신뢰 불가 |

### `general` Static Guidance Enforce 가능 범위

enforce 가능한 `general`은 아래 조건을 모두 만족하는 정적 안내성 요청으로 제한한다.

- `canonicalIntent=usage.monthly_usage_check`처럼 low-cardinality intent가 있어야 함
- `requiredSlots`가 `usageObject=api_usage`, `usageAnswerType=static_guidance`처럼 정적 안내임을 보여야 함
- "내 이번 달 사용량", "오늘 토큰 사용량", "현재 프로젝트별 비용"처럼 사용자별 값이 필요한 요청은 `dynamic_user_state`로 bypass
- cached response가 실제 사용량/비용/토큰 수 같은 사용자별 값을 포함하지 않아야 함
- `semanticSimilarity >= categoryThreshold`
- reranker가 켜진 경우 `reranker pass`

현재 actual eval 기준으로는 `text-embedding-3-large` + `categoryThreshold=0.50`을 beta 후보로 볼 수 있다. `0.45`는 recall은 좋지만 raw dynamic negative도 같이 threshold를 넘는 구간이므로 shadow/canary 관찰용 후보로만 둔다.

### `account_access` Shadow 유지

`account_access`는 password reset, API Key 생성 안내처럼 재사용 가능한 FAQ가 있지만, credential 또는 계정 상태가 섞이면 위험하다.

현실형 확장 OpenAI eval에서 아래 위험이 확인됐다.

- `API Key 생성` vs `API Key 삭제`: `small=0.714895`, `large=0.769811`
- `API Key 발급 메뉴` vs `내 API Key 값 다시 보여줘`: `small=0.484014`, `large=0.605155`
- `App Token 생성` positive는 `large=0.498377`로 threshold `0.50` 근처에 걸친다.

즉 `account_access`는 positive recall과 hard negative 위험이 같이 존재한다. threshold를 낮춰 enforce하는 방식은 맞지 않다.

정책:

- beta enforce 대상에서 제외
- shadow에서 `categoryThreshold=0.50` 기준으로 측정
- API Key, App Token, Provider Key, Authorization header, actual secret 모양 값이 감지되면 lookup/store 모두 금지
- account hard negative 평가셋을 늘리기 전 enforce 금지

### `support_refund` Enforce 금지

`support_refund`는 `shipping_fee_refund`, `order_cancel`, `exchange_request`, `refund_request`가 같은 category 안에 있지만 답이 다르다.

정책:

- beta enforce 금지
- 필요하면 strict shadow 또는 candidate_only만 허용
- `categoryThreshold=0.70`은 shadow 측정 기준으로 유지
- hard negative가 하나라도 pass하면 즉시 rollout 후보에서 제외
- reranker가 pass해도 `canonicalIntent` mismatch, `requiredSlots` mismatch, `hardNegativeGuard`를 override하면 안 됨

### Threshold 후보

| category | beta 후보 | production 후보 | 설명 |
| --- | ---: | ---: | --- |
| `general` static guidance | 0.45 shadow, 0.50 limited enforce | 0.50부터 재검증 | `large` 기준 positive 3/3, dynamic negative는 guard 필수 |
| `account_access` | 0.50 shadow | 미정 | hard negative/credential guard 확대 전 enforce 금지 |
| `support_refund` | 0.70 strict shadow | 미정 | false positive 비용이 커서 enforce 금지 |
| `code` / `translation` / `unknown` | 없음 | 없음 | threshold와 무관하게 deny |

현실형 확장 eval 기준으로 `general` static guidance positive는 `large`에서 대체로 `0.55~0.60`대였다. 반면 `account_access` hard negative는 `0.76`대까지 올라갔다. 따라서 category를 넓히는 것이 아니라 `general` static guidance로 더 좁히는 쪽이 맞다.

### Reranker Score 기준

현재 최소 구현에서 `rerankerScore`는 safe observability field이며, production 보정된 독립 score가 아니다.

beta 기준:

- reranker off면 기존 policy guard + threshold 결과만 shadow/eval로 본다.
- deterministic reranker는 `Passed=true/false`와 `rerankerDecisionReason`을 우선한다.
- score 기반 reranker를 붙일 경우 `general` static guidance에서만 먼저 shadow 측정한다.
- score 기반 enforce 후보는 최소 `rerankerScore >= 0.80`부터 검토하되, dataset false positive 0건이 먼저 필요하다.
- `support_refund`는 `rerankerScore`가 높아도 enforce하지 않는다.

### False Positive / False Negative Tradeoff

현재 정책은 false negative를 감수하고 false positive를 줄이는 쪽이다.

- false positive: 서로 다른 요청에 이전 답을 재사용하는 사고. production에서 더 위험하다.
- false negative: 재사용 가능했지만 provider를 호출하는 비용 문제. beta에서는 감수 가능하다.

따라서 애매한 경우는 hit가 아니라 miss/provider path가 맞다.

### Latency / Cost 영향

- normalization은 외부 호출이 없어서 latency/cost 영향이 작다.
- OpenAI embedding은 semantic lookup/store 후보에서 외부 호출 비용이 발생한다.
- deterministic reranker는 외부 API 호출이 없으므로 추가 OpenAI 비용이 없다.
- external reranker 또는 LLM judge는 top-k 후보별 추가 latency/cost가 생기므로 beta 기본값으로 켜지 않는다.

### Rollback 조건

아래 중 하나라도 발생하면 enforce를 즉시 shadow 또는 disabled로 되돌린다.

- `dynamic_user_state` 요청에서 hit 발생
- `code`, `translation`, `unknown` category에서 hit 발생
- `support_refund`에서 provider bypass hit 발생
- `canonicalIntent` mismatch 또는 `requiredSlots` mismatch인데 hit 발생
- `hardNegativeGuard` 대상 pair에서 hit 발생
- `reranker_provider_failure`, `reranker_timeout`이 증가하면서 provider path 안정성에 영향
- raw prompt, API Key, App Token, Provider Key, Authorization header가 log/detail/cache/test output에 남는 정황 발견

### 모니터링 Safe Field

log/detail/metric label에는 low-cardinality safe field만 남긴다.

- `cacheType`
- `semanticCacheHit`
- `semanticCacheDecisionReason`
- `semanticSimilarity` 또는 score bucket
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
- `rerankerScore` 또는 score bucket
- `rerankerDecisionReason`
- `providerCalled`
- `cacheMode`

금지:

- raw prompt
- raw response
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- 주문번호, 이메일, 전화번호, 실제 secret 같은 raw identifier

## Evaluation Basis

OpenAI eval 문서:

- `docs/testing/semantic-cache-openai-embedding-eval.md`

사용 모델:

- `text-embedding-3-small`
- `text-embedding-3-large`

평가 pair 구성:

- positive 4개
- hard negative 2개
- unrelated 3개

category별로 보면 아래 한계가 있다.

- `account_access`: positive 2개는 측정됨. 같은 category hard negative는 이번 OpenAI eval에 직접 포함되지 않았고, cross-category unrelated만 있다.
- `general`: positive 1개는 측정됨. 같은 category hard negative는 직접 측정되지 않았다.
- `support_refund`: positive 1개와 hard negative 2개가 직접 측정됨.

따라서 production threshold 확정 전에는 category별 expanded eval set이 더 필요하다.

## OpenAI Eval 요약

### `text-embedding-3-small`

| category | positive score | hard negative score | unrelated score |
| --- | --- | --- | --- |
| `account_access` | 0.355520, 0.776339 | 직접 측정 없음 | 0.246612, 0.144123 |
| `general` | 0.589263 | 직접 측정 없음 | 0.246612, 0.222343 |
| `support_refund` | 0.571208 | 0.442448, 0.345092 | 0.144123, 0.222343 |

### `text-embedding-3-large`

| category | positive score | hard negative score | unrelated score |
| --- | --- | --- | --- |
| `account_access` | 0.517135, 0.743104 | 직접 측정 없음 | 0.296511, 0.256464 |
| `general` | 0.522061 | 직접 측정 없음 | 0.296511, 0.193894 |
| `support_refund` | 0.776243 | 0.371424, 0.438555 | 0.256464, 0.193894 |

## Threshold 후보 비교

### `account_access`

`account_access`는 password reset, API Key/App Token 생성 같은 FAQ성 workflow가 많지만 credential 실제 값이 포함되면 store/hit 금지여야 한다.

`text-embedding-3-small`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 2/2 | 직접 측정 없음 | 0/2 | password reset까지 잡지만 margin이 낮음 |
| 0.45 | 1/2 | 직접 측정 없음 | 0/2 | password reset miss |
| 0.50 | 1/2 | 직접 측정 없음 | 0/2 | password reset miss |
| 0.60 | 1/2 | 직접 측정 없음 | 0/2 | recall 낮음 |
| 0.70 | 1/2 | 직접 측정 없음 | 0/2 | recall 낮음 |
| 0.80 이상 | 0/2 | 직접 측정 없음 | 0/2 | 실사용 hit 어려움 |

`text-embedding-3-large`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 2/2 | 직접 측정 없음 | 0/2 | recall은 좋지만 낮은 threshold라 guard 필수 |
| 0.45 | 2/2 | 직접 측정 없음 | 0/2 | demo/local 후보 |
| 0.50 | 2/2 | 직접 측정 없음 | 0/2 | production 후보 시작점 |
| 0.60 | 1/2 | 직접 측정 없음 | 0/2 | password reset miss |
| 0.70 | 1/2 | 직접 측정 없음 | 0/2 | recall 낮음 |
| 0.80 이상 | 0/2 | 직접 측정 없음 | 0/2 | 실사용 hit 어려움 |

권장:

- `text-embedding-3-large` 기준 `0.50`
- `text-embedding-3-small`은 password reset score가 낮아 production 기본 후보로 추천하지 않음
- API Key/App Token 실제 값이 포함된 요청은 threshold 이전에 forbidden data guard로 store/hit 금지

### `general`

`general`은 usage FAQ처럼 비교적 안전한 요청이 있지만, 사용자별 동적 정보가 들어가면 이전 응답 재사용이 위험하다. 예를 들어 "이번 달 사용량"이 실제 계정별 수치를 반환하는 응답이면 response cacheability guard가 필요하다.

`text-embedding-3-small`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 1/1 | 직접 측정 없음 | 0/2 | 가능 |
| 0.45 | 1/1 | 직접 측정 없음 | 0/2 | 가능 |
| 0.50 | 1/1 | 직접 측정 없음 | 0/2 | 가능 |
| 0.60 이상 | 0/1 | 직접 측정 없음 | 0/2 | usage pair miss |

`text-embedding-3-large`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 1/1 | 직접 측정 없음 | 0/2 | 가능 |
| 0.45 | 1/1 | 직접 측정 없음 | 0/2 | demo/local 후보 |
| 0.50 | 1/1 | 직접 측정 없음 | 0/2 | production 후보 시작점 |
| 0.60 이상 | 0/1 | 직접 측정 없음 | 0/2 | usage pair miss |

권장:

- `text-embedding-3-large` 기준 `0.50`
- response가 정적 FAQ인지, 사용자별 동적 데이터인지 구분하는 response cacheability guard가 필요
- `general`을 너무 넓게 allow하지 말고 `canonicalIntent`가 있는 FAQ/usage 계열부터 제한적으로 허용

### `support_refund`

`support_refund`는 같은 category 안에서도 배송비 환불, 주문 취소, 교환 신청, 환불 접수가 서로 다른 답을 요구한다. false positive 비용이 크므로 가장 보수적으로 유지한다.

`text-embedding-3-small`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 1/1 | 1/2 | 0/2 | raw similarity 단독으로 위험 |
| 0.45 | 1/1 | 0/2 | 0/2 | raw risk는 낮지만 margin 작음 |
| 0.50 | 1/1 | 0/2 | 0/2 | demo/local 후보 |
| 0.60 이상 | 0/1 | 0/2 | 0/2 | support positive miss |

`text-embedding-3-large`:

| threshold | positive 통과 | hard negative 통과 | unrelated 통과 | 해석 |
| ---: | ---: | ---: | ---: | --- |
| 0.35 | 1/1 | 2/2 | 0/2 | raw similarity 단독으로 매우 위험 |
| 0.45 | 1/1 | 0/2 | 0/2 | demo/local 후보 |
| 0.50 | 1/1 | 0/2 | 0/2 | 가능하지만 support에는 낮은 편 |
| 0.60 | 1/1 | 0/2 | 0/2 | 보수 후보 |
| 0.70 | 1/1 | 0/2 | 0/2 | production 후보 시작점 |
| 0.80 이상 | 0/1 | 0/2 | 0/2 | support positive miss |

권장:

- `text-embedding-3-large` 기준 `0.70`
- `support_refund`는 `0.45~0.50`까지 낮추면 demo/local에서는 hit가 잘 보이지만 production 기본값으로는 아직 이르다.
- `support_refund`는 반드시 `canonicalIntent`, `requiredSlots`, `hardNegativeGuard`를 통과해야 하며, 다른 intent면 similarity가 높아도 miss다.

## Category Recommendation

세 category를 같은 threshold로 두는 것은 권장하지 않는다.

- `account_access`: measured positive가 `0.517~0.743`으로 갈라진다. `0.50`이 최소 후보.
- `general`: measured positive가 `0.522` 수준이라 `0.50`이 최소 후보.
- `support_refund`: measured positive는 높지만 false positive 비용이 크다. `0.70`처럼 더 보수적인 threshold가 맞다.

권장안은 `text-embedding-3-large`를 전제로 한다.

```json
{
  "defaultThreshold": 0.92,
  "categories": {
    "account_access": {
      "mode": "strict_hit",
      "categoryThreshold": 0.50,
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresHardNegative": true
    },
    "general": {
      "mode": "strict_hit",
      "categoryThreshold": 0.50,
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresHardNegative": true
    },
    "support_refund": {
      "mode": "strict_hit",
      "categoryThreshold": 0.70,
      "requiresIntent": true,
      "requiresRequiredSlots": true,
      "requiresHardNegative": true
    }
  }
}
```

## Policy Guard 적용 전/후 위험

policy guard 적용 전:

- `support_refund`에서 threshold `0.35`는 hard negative까지 통과한다.
- `text-embedding-3-small`은 password reset positive가 `0.355520`이라 낮은 threshold를 요구하는데, 이 값은 support hard negative score와도 가깝다.
- threshold만 낮추면 서로 다른 workflow의 응답을 재사용할 위험이 있다.

policy guard 적용 후:

- 같은 `canonicalIntent`가 아니면 miss
- `requiredSlots`가 다르면 miss
- `forbiddenIntentPairs`에 걸리면 miss
- 따라서 hard negative가 threshold 이상이어도 hit하지 않는다.

## 결론

질문별 답변:

- 세 category가 같은 threshold를 써도 되는가?
  - 아니다. `support_refund`는 false positive 비용이 높아 더 보수적이어야 한다.

- `support_refund` threshold를 낮춰도 되는가?
  - demo/local에서는 `0.50`까지 낮출 수 있지만, production 기본값으로 바로 낮추면 안 된다. `text-embedding-3-large` 기준 `0.70`부터 추가 검증하는 것이 안전하다.

- demo/local threshold와 production threshold를 분리해야 하는가?
  - 분리해야 한다. demo/local은 hit 관찰 목적이고, production은 false positive 방지가 우선이다.

- threshold 조정만으로 충분한가?
  - 충분하지 않다. threshold는 `canonicalIntent`, `requiredSlots`, `hardNegativeGuard` 이후의 마지막 조건이다.

- policy guard 없이 threshold를 낮추면 어떤 위험이 생기는가?
  - 배송비 환불과 주문 취소, 반품 배송비와 교환 신청처럼 같은 support category 안의 다른 workflow가 hit될 수 있다.
  - API Key/App Token/계정 관련 workflow도 실제 credential 또는 계정 상태가 얽히면 잘못된 응답 재사용 위험이 있다.

## Production 적용 전 남은 조건

- category별 expanded eval set 추가
- `account_access` hard negative의 실제 OpenAI similarity 측정
- `general`의 동적 응답 cacheability guard 정의
- `support_refund` positive/hard negative 확대
- 실제 응답이 정적 FAQ인지 동적 사용자 데이터인지 구분하는 store policy 추가
- `OPENAI_API_KEY`, App Token, Provider Key, Authorization header, raw prompt가 cache/log/test output에 남지 않는지 지속 검증

normalization + reranker 이후 추가 조건:

- `general` static guidance에서 최소 shadow 기간 동안 false positive 0건 확인
- `dynamic_user_state`가 embedding/reranker 전에 bypass되는지 운영 로그에서 확인
- `rerankerDecisionReason` 분포가 low-cardinality enum으로만 남는지 확인
- `reranker_provider_failure`, `reranker_timeout` 시 provider path가 정상 동작하는지 확인
- `account_access`는 credential-like input guard와 hard negative dataset 확대 전 enforce 금지
- `support_refund`는 strict shadow에서도 hard negative hit 0건 전까지 enforce 금지
- `semanticSimilarity`, `rerankerScore`는 metric label이 아니라 numeric value 또는 bucket으로 집계
