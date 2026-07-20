# Semantic Cache Response Cacheability Policy

이 문서는 Semantic Cache가 provider 응답을 저장해도 되는지 판단하는 `response cacheability` 기준을 정의한다.

현재 Semantic Cache hit 판단은 `category`, `canonicalIntent`, `requiredSlots`, `hardNegativeGuard`, `categoryThreshold`, `SemanticCacheBoundary`를 함께 사용한다. 하지만 hit 기준이 안전해도, 저장하면 안 되는 응답을 store하면 이후 재사용 위험이 생긴다. 따라서 production/beta 단계에서는 hit policy와 store policy를 분리해서 봐야 한다.

## 결론

Semantic Cache는 similarity가 높다고 바로 hit하면 안 되고, provider 응답도 성공했다고 바로 store하면 안 된다.

store 허용은 아래 조건을 모두 만족해야 한다.

```text
Semantic Cache enabled
+ deny category 아님
+ request intent material 존재
+ response cacheability allowed
+ forbidden data 없음
+ provider success
+ fallback 아님
+ stream 아님
+ category별 store policy 통과
```

하나라도 실패하면 provider 응답은 그대로 사용자에게 반환하되, Semantic Cache store는 bypass한다.

## Store 허용 조건

아래 조건을 모두 만족하는 응답만 Semantic Cache store 후보가 된다.

| 조건 | 설명 |
|---|---|
| `category` allow | `code`, `translation`, `unknown`, `sensitive`, `tool_call` 같은 deny category가 아님 |
| `canonicalIntent` 있음 | 요청이 policy material에서 low-cardinality intent로 안정적으로 분류됨 |
| `requiredSlots` 있음 | hit 호환성 판단에 필요한 slot이 누락되지 않음 |
| `SemanticCacheBoundary` valid | `tenantId`, `projectId`, `applicationId`, `providerId`, `modelId`, `routingPolicyHash`, `routingDecisionKeyHash` 등 boundary가 분리됨 |
| `responseCacheabilityClass=static_guidance` | 응답이 정적 안내, FAQ, 절차 설명, 일반 정책 설명에 가까움 |
| forbidden data 없음 | cache key, value, vector input, log/detail에 금지 데이터가 들어가지 않음 |
| provider success | provider 호출이 정상 완료됨 |
| fallback 아님 | fallback 응답은 실제 intended provider 응답이 아니므로 store하지 않음 |
| `stream=false` | streaming partial 또는 streaming 최종 조립 응답은 MVP에서 store하지 않음 |

## Store 금지 조건

아래 조건 중 하나라도 있으면 store하지 않는다.

| 금지 조건 | store 금지 이유 |
|---|---|
| forbidden data 포함 | 보안 사고 가능성 |
| 사용자별 상태 포함 | 다른 사용자 또는 다른 시점에 재사용하면 오답 가능 |
| 계정별 수치 포함 | 사용량, 비용, quota, 잔여량은 시점과 사용자에 종속됨 |
| 주문/환불/결제 상태 포함 | 특정 order/payment/refund 상태는 재사용하면 안 됨 |
| credential/token 값 포함 | API Key, App Token, Provider Key, secret은 절대 store 금지 |
| provider error/fallback 응답 | 오류나 fallback 결과를 정상 답변처럼 재사용할 수 있음 |
| response-side safety 미확인 동적 응답 | 응답에 민감 정보가 들어갔는지 보장할 수 없음 |
| `stream=true` | token-level partial과 최종 응답 조립 경계가 불명확함 |
| deny category | category 정책상 lookup/store 모두 bypass해야 함 |

금지 데이터 목록은 기존 v2 forbidden data 기준을 따른다.

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

위 값은 cache key, cache value, normalized text, vector input, log/detail, metric label에 남기지 않는다.

## `responseCacheabilityClass`

beta 단계에서는 응답을 아래 class로 나누는 것을 권장한다.

| class | store | 설명 |
|---|---:|---|
| `static_guidance` | 허용 후보 | 정적 FAQ, 사용 방법, 절차 안내 |
| `policy_summary` | 제한 허용 | 회사/서비스 정책 요약. category별 보수 기준 필요 |
| `dynamic_user_state` | 금지 | 계정, 사용량, 결제, 주문, 환불 상태 |
| `credential_or_secret` | 금지 | key, token, secret, credential |
| `provider_error` | 금지 | provider 오류, raw error, fallback 안내 |
| `unsafe_or_unknown` | 금지 | 안전성 또는 재사용 가능성을 판단하지 못함 |

초기 구현에서는 `static_guidance`만 store allowed로 시작하는 것이 안전하다.

## Category별 Store 정책

### `account_access`

허용 후보:

- 비밀번호 재설정 방법 안내
- API Key 발급 메뉴 위치 안내
- App Token 생성 절차 안내
- 계정 설정 페이지 위치 안내

금지:

- 실제 API Key/App Token 값
- 특정 사용자의 계정 상태
- 특정 사용자 권한, billing plan, quota
- 계정 삭제 실행 결과
- credential rotation 결과

정책:

```text
canonicalIntent required
requiredSlots required
credential value detected => store bypass
account-specific state detected => store bypass
```

### `general`

허용 후보:

- 정적 도움말
- 사용량 화면 위치 안내
- 일반 설정 위치 안내
- 기능 설명 FAQ

금지:

- 이번 달 실제 사용량 수치
- 비용 합계
- quota 잔여량
- 특정 project/application별 실시간 통계
- 현재 장애 상태처럼 시점 의존 정보

정책:

```text
FAQ/how-to response => store 후보
user-specific metric/value response => store bypass
```

### `support_refund`

허용 후보:

- 배송비 환불 가능 여부에 대한 정적 정책 안내
- 반품 접수 위치 안내
- 교환 접수 절차 안내

금지:

- 특정 주문의 취소 가능 여부
- 특정 결제의 환불 처리 상태
- 특정 반품/교환 접수 결과
- 주문번호, 결제번호, 환불번호 등 identifier가 포함된 응답

정책:

```text
support_refund는 store도 보수적으로 시작한다.
same category라도 canonicalIntent/requiredSlots가 다르면 hit 금지다.
hardNegativeGuard 없이 넓게 store/hit하지 않는다.
```

`support_refund`는 policy 설명형 응답만 제한적으로 store 후보가 될 수 있다. 실제 운영에서는 `candidate_only` 또는 낮은 traffic 비율의 shadow 모드로 검증한 뒤 provider bypass를 열어야 한다.

### `code`, `translation`, `unknown`

정책:

```text
lookup bypass
store bypass
```

이 category들은 같은 질문처럼 보여도 출력 기대값이 쉽게 달라진다. MVP/beta에서는 Semantic Cache provider bypass 대상에서 제외한다.

## 예시

| 요청/응답 성격 | category | responseCacheabilityClass | store |
|---|---|---|---|
| 비밀번호 재설정 화면으로 이동하는 방법 안내 | `account_access` | `static_guidance` | 후보 |
| 실제 API Key 값이 포함된 응답 | `account_access` | `credential_or_secret` | 금지 |
| 사용량 메뉴 위치 안내 | `general` | `static_guidance` | 후보 |
| 이번 달 token 사용량 수치 응답 | `general` | `dynamic_user_state` | 금지 |
| 배송비 환불 정책 안내 | `support_refund` | `policy_summary` | 제한 후보 |
| 특정 주문 취소 상태 안내 | `support_refund` | `dynamic_user_state` | 금지 |
| 번역 결과 | `translation` | `unsafe_or_unknown` | 금지 |
| 코드 수정 결과 | `code` | `unsafe_or_unknown` | 금지 |

## Store Decision Field 후보

log/detail에는 raw content 대신 아래 low-cardinality field만 남긴다.

| field | 설명 |
|---|---|
| `semanticStoreAllowed` | store 허용 여부 |
| `semanticStoreDecisionReason` | store 허용/거절 사유 enum |
| `semanticStorePolicyVersion` | store policy version |
| `semanticResponseCacheabilityClass` | 응답 cacheability class |
| `semanticCanonicalIntent` | policy에서 생성한 intent label |
| `semanticRequiredSlotsHash` | slot map 자체가 아닌 canonical hash |
| `semanticForbiddenPayloadDetected` | forbidden marker 탐지 여부 |

`requiredSlots` 원문 값이 사용자별 identifier일 수 있으므로, 초기에는 `semanticRequiredSlotsHash`만 남긴다.

## Decision Reason 후보

| reason | 의미 |
|---|---|
| `store_allowed` | store 허용 |
| `store_disabled` | Semantic Cache store 비활성화 |
| `category_denied` | deny category |
| `intent_unavailable` | `canonicalIntent` 생성 실패 |
| `required_slots_unavailable` | 필수 slot 누락 |
| `response_not_cacheable` | 응답이 정적 재사용 대상이 아님 |
| `dynamic_user_state` | 사용자별 동적 상태 포함 |
| `forbidden_payload` | forbidden data marker 탐지 |
| `fallback_response` | fallback 응답 |
| `streaming_response` | streaming 응답 |
| `provider_error` | provider 오류 응답 |
| `policy_unavailable` | store policy 없음 |

## MVP / Beta / Production 구분

### MVP

- Semantic Cache는 기본 off
- fake embedding 또는 opt-in OpenAI embedding
- in-memory store
- hit policy 중심 검증
- forbidden marker 기반 최소 store 방어

### Beta

- `responseCacheabilityClass` 기반 store decision 추가
- category별 store allow/deny 분리
- `support_refund`는 보수적으로 `candidate_only` 또는 제한 store
- dynamic user state store bypass 테스트 추가
- OpenAI API 없이 통과하는 정책 테스트 유지

### Production

- response cacheability guard를 release gate로 둠
- category별 threshold와 store policy를 versioned policy material로 관리
- eval dataset에 false positive/hard negative regression gate 추가
- log/detail/metric label forbidden data guard 자동화
- provider fallback/error/streaming store bypass 검증
- 필요 시 vector store를 도입하되, hit/store policy보다 먼저 도입하지 않음

## 다음 구현 우선순위

1. `SemanticCacheStorePolicy`와 `SemanticCacheStoreDecision` domain type 추가
2. `SemanticCacheService.Upsert` 앞단에 store eligibility guard 추가
3. `responseCacheabilityClass`를 policy material에서 판정
4. dynamic user state, credential, fallback, stream, provider error store bypass 테스트 추가
5. `semantic_cache_intent_eval_cases.json`과 별도로 store eligibility eval case 추가
