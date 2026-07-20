# Semantic Cache canonicalIntent / requiredSlots Taxonomy

## 목적

이 문서는 Semantic Cache production hit policy를 구현하기 전에 필요한 `canonicalIntent`와 `requiredSlots` taxonomy 초안을 정리한다.

목표는 아래를 구분하는 것이다.

- 같은 답을 재사용해도 되는 요청
- 같은 category지만 답을 재사용하면 안 되는 요청
- embedding similarity가 높아도 hit하면 안 되는 hard negative pair

이 문서는 구현 문서가 아니다. production code를 수정하지 않고, 후속 구현에서 사용할 정책 material 초안을 정의한다.

## 전제

Semantic Cache production hit는 `semanticSimilarity >= threshold`만으로 허용하지 않는다.

production hit 후보는 최소 아래 조건을 만족해야 한다.

```text
same SemanticCacheBoundary
same category
same canonicalIntent
requiredSlots compatible
hardNegativeGuard passed
semanticSimilarity >= categoryThreshold
safe cached response
```

`canonicalIntent`와 `requiredSlots`는 raw prompt가 아니라 redaction 이후 normalized input에서 생성하는 low-cardinality material이다.

## category 운영 원칙

| category | production 기본값 | 설명 |
| --- | --- | --- |
| `general` | conditional allow | 일반 도움말, 사용량, 대시보드 위치처럼 같은 답 재사용이 가능한 요청 |
| `account_access` | conditional allow | 계정 접근, 비밀번호, 인증, API key 발급 같은 계정 작업. 현재 MVP에서는 `general` 안에 포함될 수 있지만 production taxonomy에서는 분리 후보 |
| `support_refund` | strict or bypass | 환불, 반품, 취소, 교환, 배송비처럼 같은 category 안에서도 의도가 갈리는 고위험 요청 |
| `translation` | deny | 입력 문장 자체가 응답을 결정하므로 cache hit 금지 |
| `code` | deny | 코드 내용, 에러 맥락, 런타임이 응답을 결정하므로 cache hit 금지 |
| `unknown` | deny | 의도 불명확 |

`account_access`는 현재 Gateway category enum에 바로 추가한다는 뜻이 아니다. production Semantic Cache taxonomy에서 `general` 내부 intent를 더 안전하게 나누기 위한 후보 category다.

## Slot 설계 규칙

`requiredSlots`는 hit 판단에 반드시 필요한 low-cardinality 값이다.

규칙:

- slot이 비어 있으면 hit 금지
- slot 값이 `unknown`이면 hit 금지
- raw prompt fragment를 slot 값으로 넣지 않음
- 주문번호, 이메일, 전화번호, 실제 API key, token 같은 사용자 고유값을 넣지 않음
- 같은 `canonicalIntent`라도 `requiredSlots`가 다르면 hit 금지

`optionalSlots`는 응답 재사용 여부를 더 세밀하게 판단하는 보조 material이다.

규칙:

- optional slot 충돌이 위험한 category에서는 hit 금지
- optional slot이 없다는 이유만으로 항상 hit 금지는 아님
- category별 policy에서 optional slot compatibility를 정함

## Taxonomy Summary

| category | canonicalIntent | requiredSlots | optionalSlots | hitAllowed |
| --- | --- | --- | --- | --- |
| `general` | `usage.monthly_usage_check` | `usageObject`, `usageAnswerType` | `surface` | `true` |
| `general` | `dashboard.location_help` | `surface` | `role` | `true` |
| `account_access` | `account.password_reset` | `accountAction` | `authFactor`, `surface` | `true` |
| `account_access` | `account.api_key_create` | `accountAction`, `credentialKind` | `surface`, `role` | `true` |
| `account_access` | `account.profile_settings_update` | `accountAction`, `settingsObject` | `surface` | `true` |
| `support_refund` | `support_refund.shipping_fee_refund` | `supportAction`, `refundObject` | `orderState`, `shippingDirection` | `strict` |
| `support_refund` | `support_refund.order_cancel` | `supportAction`, `cancelObject` | `paymentState`, `orderState` | `strict` |
| `support_refund` | `support_refund.exchange_request` | `supportAction`, `exchangeObject` | `orderState` | `strict` |
| `translation` | `translation.translate_text` | 없음 | `sourceLanguage`, `targetLanguage` | `false` |
| `code` | `code.explain_code` | 없음 | `language`, `errorType` | `false` |
| `unknown` | `unknown.unclassified` | 없음 | 없음 | `false` |

`hitAllowed=strict`는 기본 hit 허용이 아니라, hard negative guard와 stricter threshold, 필요 시 `reranker` 또는 `judge`까지 통과해야 한다는 뜻이다.

## general

`general`은 제품 도움말, 사용량 확인, 대시보드 위치 안내처럼 같은 답을 재사용할 수 있는 저위험 요청을 다룬다.

### Intent 목록

| canonicalIntent | requiredSlots | optionalSlots | hitAllowed | 설명 |
| --- | --- | --- | --- | --- |
| `usage.monthly_usage_check` | `usageObject=api_usage`, `usageAnswerType=static_guidance` | `surface=dashboard` | `true` | 사용량 화면/메뉴 위치 안내 |
| `dashboard.location_help` | `surface=dashboard` | `role=admin/developer` | `true` | 대시보드 위치 안내 |
| `docs.how_to_find` | `docsObject` | `surface` | `true` | 문서 위치나 사용법 안내 |

### 한국어 synonym 후보

| canonical term | synonyms |
| --- | --- |
| `usage` | 사용량, 이용량, 사용 통계, 사용량 통계 |
| `usage_help` | 어디서, 어디에서, 위치, 메뉴, 화면, 확인 방법, 보는 방법 |
| `dashboard` | 대시보드, 콘솔, 관리자 화면 |
| `where` | 어디서, 어디에서, 위치 |

### Hit 허용 예시

| first | second | canonicalIntent | requiredSlots | hitAllowed | 이유 |
| --- | --- | --- | --- | --- | --- |
| 사용량은 어디서 확인해? | API 사용량 확인 화면은 어디야? | `usage.monthly_usage_check` | `usageObject=api_usage`, `usageAnswerType=static_guidance` | `true` | 같은 사용량 화면 위치 안내 |
| 대시보드는 어디서 볼 수 있어? | 관리자 콘솔 위치 알려줘 | `dashboard.location_help` | `surface=dashboard` | `true` | 같은 화면 위치 안내 |

### Hard Negative Pair

| first | second | hitAllowed | hit 금지 이유 |
| --- | --- | --- | --- |
| 사용량 메뉴 위치 알려줘 | 내 이번 달 사용량 보여줘 | `false` | 정적 화면 안내와 사용자별 동적 사용량 조회는 같은 답을 재사용할 수 없음 |
| 사용량은 어디서 확인해? | 계정 설정은 어디서 바꿔? | `false` | `canonicalIntent` 다름 |
| 대시보드는 어디서 볼 수 있어? | 패스워드 초기화는 어떻게 해? | `false` | `dashboard.location_help`와 `account.password_reset` 혼동 |

## account_access

`account_access`는 production taxonomy에서 `general`에서 분리할 후보 category다. 비밀번호, 로그인, 인증, API key 발급, 계정 설정처럼 계정 접근이나 credential 관리에 가까운 요청을 다룬다.

### Intent 목록

| canonicalIntent | requiredSlots | optionalSlots | hitAllowed | 설명 |
| --- | --- | --- | --- | --- |
| `account.password_reset` | `accountAction=password_reset` | `authFactor=password/email/sso`, `surface` | `true` | 비밀번호 재설정 안내 |
| `account.api_key_create` | `accountAction=api_key_create`, `credentialKind=api_key` | `surface=developer_console`, `role=developer/admin` | `true` | API key 발급 위치 안내 |
| `account.profile_settings_update` | `accountAction=settings_update`, `settingsObject=profile/account` | `surface` | `true` | 계정 설정 변경 위치 안내 |
| `account.login_troubleshooting` | `accountAction=login_help` | `authFactor`, `errorType` | `candidate_only` | 로그인 문제는 원인이 다양하므로 보수 처리 |

### 한국어 synonym 후보

| canonical term | synonyms |
| --- | --- |
| `password` | 비밀번호, 패스워드, 비번, password |
| `password_reset` | 재설정, 초기화, 리셋, reset |
| `api_key` | API Key, API 키, api key |
| `create` | 발급, 생성, 만들기, 새로 만들기 |
| `settings` | 설정, 계정 설정, 프로필 설정 |

### 반드시 포함할 Positive Pair

| first | second | category | canonicalIntent | requiredSlots | optionalSlots | hitAllowed | 이유 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 비밀번호 재설정 방법 알려줘 | 패스워드 초기화는 어떻게 해? | `account_access` | `account.password_reset` | `accountAction=password_reset` | `authFactor=unknown`, `surface=unknown` | `true` | synonym normalization 후 같은 계정 작업 |

주의:

- `authFactor=unknown`이 위험하다고 판단되면 production에서는 `candidate_only`로 낮출 수 있다.
- 같은 답 재사용이 가능한 범위는 "비밀번호 재설정 절차 안내"로 제한한다.
- 실제 이메일, 전화번호, 사용자 ID는 slot에 넣지 않는다.

### Hit 허용 예시

| first | second | canonicalIntent | requiredSlots | hitAllowed | 이유 |
| --- | --- | --- | --- | --- | --- |
| API Key 발급 방법 알려줘 | 새 API 키는 어디서 만들 수 있어? | `account.api_key_create` | `accountAction=api_key_create`, `credentialKind=api_key` | `true` | 같은 developer credential 발급 안내 |
| 계정 설정은 어디서 바꿔? | 프로필 설정 위치 알려줘 | `account.profile_settings_update` | `accountAction=settings_update`, `settingsObject=profile/account` | `true` | 같은 계정 설정 위치 안내 |

### Hard Negative Pair

| first | second | hitAllowed | hit 금지 이유 |
| --- | --- | --- | --- |
| API Key 발급 방법 알려줘 | API Key가 노출됐을 때 어떻게 해? | `false` | `account.api_key_create`와 credential incident 대응은 다른 intent |
| 비밀번호 재설정 방법 알려줘 | 계정 삭제하고 싶어요 | `false` | `account.password_reset`과 account deletion은 다른 action |
| 로그인 안 돼요 | 비밀번호 재설정 방법 알려줘 | `candidate_only` | 일부 overlap이 있지만 원인이 다를 수 있음 |

## support_refund

`support_refund`는 같은 category 안에서도 환불, 반품, 취소, 교환, 배송비가 갈리므로 production에서 가장 보수적으로 다룬다.

### Intent 목록

| canonicalIntent | requiredSlots | optionalSlots | hitAllowed | 설명 |
| --- | --- | --- | --- | --- |
| `support_refund.shipping_fee_refund` | `supportAction=refund`, `refundObject=shipping_fee` | `shippingDirection=outbound/return`, `orderState` | `strict` | 배송비 환불 가능 여부 |
| `support_refund.return_shipping_fee` | `supportAction=return`, `refundObject=shipping_fee` | `shippingDirection=return`, `orderState` | `strict` | 반품 배송비 반환 여부 |
| `support_refund.order_cancel` | `supportAction=cancel`, `cancelObject=order` | `paymentState`, `orderState` | `strict` | 주문 취소 |
| `support_refund.payment_cancel` | `supportAction=cancel`, `cancelObject=payment` | `paymentState`, `paymentMethod` | `strict` | 결제 취소 |
| `support_refund.exchange_request` | `supportAction=exchange`, `exchangeObject=item` | `orderState`, `reasonType` | `strict` | 교환 신청 |
| `support_refund.refund_request_location` | `supportAction=refund`, `refundObject=item_or_order` | `surface` | `strict` | 환불 신청 위치 |

### 한국어 synonym 후보

| canonical term | synonyms |
| --- | --- |
| `refund` | 환불, 돌려받, 환급 |
| `return` | 반품, 반송 |
| `cancel` | 취소, 주문 취소, 결제 취소 |
| `exchange` | 교환, 교환 신청 |
| `shipping_fee` | 배송비, 운송비, 반품 배송비 |
| `payment` | 결제, 결제금액, 결제 취소 |

주의:

- `환불`, `취소`, `교환`을 같은 의미로 합치면 안 된다.
- `배송비 환불`과 `주문 취소`는 같은 `support_refund` category라도 다른 intent다.
- `반품 배송비`와 `교환 신청`은 slot이 달라 hit 금지다.

### 반드시 포함할 Hard Negative Pair 1

| first | second | category | canonicalIntent(first) | canonicalIntent(second) | requiredSlots(first) | requiredSlots(second) | hitAllowed | hit 금지 이유 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 배송비도 환불되나요? | 주문 취소하고 싶어요 | `support_refund` | `support_refund.shipping_fee_refund` | `support_refund.order_cancel` | `supportAction=refund`, `refundObject=shipping_fee` | `supportAction=cancel`, `cancelObject=order` | `false` | 같은 category지만 intent와 action/object가 다름 |

### 반드시 포함할 Hard Negative Pair 2

| first | second | category | canonicalIntent(first) | canonicalIntent(second) | requiredSlots(first) | requiredSlots(second) | hitAllowed | hit 금지 이유 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 반품하면 배송비도 돌려받나요? | 교환 신청은 어디서 하나요? | `support_refund` | `support_refund.return_shipping_fee` | `support_refund.exchange_request` | `supportAction=return`, `refundObject=shipping_fee` | `supportAction=exchange`, `exchangeObject=item` | `false` | 같은 category지만 `requiredSlots`가 다름 |

### Hit 허용 후보

| first | second | canonicalIntent | requiredSlots | hitAllowed | 이유 |
| --- | --- | --- | --- | --- | --- |
| 배송비도 환불되나요? | 반품하면 배송비도 돌려받나요? | `support_refund.shipping_fee_refund` 또는 `support_refund.return_shipping_fee` | `supportAction=refund/return`, `refundObject=shipping_fee` | `strict` | 배송비 반환 문의로 볼 수 있으나 `shippingDirection` 불명확 시 candidate only |
| 교환이나 환불은 어디서 하나요? | 환불 신청은 어디에서 해요? | `support_refund.refund_request_location` | `supportAction=refund`, `refundObject=item_or_order` | `strict` | 신청 위치 안내. 교환까지 섞인 경우 optional slot 검토 필요 |

### 추가 Hard Negative Pair

| first | second | hitAllowed | hit 금지 이유 |
| --- | --- | --- | --- |
| 결제 취소 가능한가요? | 교환 신청은 어디서 하나요? | `false` | payment cancel과 exchange request는 다른 action |
| 환불 신청은 어디에서 해요? | 배송비도 환불되나요? | `false` | 신청 위치 안내와 비용 환불 가능 여부는 다른 answer type |
| 반품 접수했는데 배송비는 누가 내나요? | 주문 취소하고 싶어요 | `false` | return shipping fee와 order cancel 혼동 |

## translation

`translation`은 production Semantic Cache hit 금지 category다.

이유:

- 입력 문장 자체가 output을 결정한다.
- 같은 "영어로 번역해줘"라도 source text가 다르면 답이 완전히 다르다.
- raw source text를 cache material로 저장하면 안 된다.

### Intent 목록

| canonicalIntent | requiredSlots | optionalSlots | hitAllowed | 설명 |
| --- | --- | --- | --- | --- |
| `translation.translate_text` | 없음 | `sourceLanguage`, `targetLanguage` | `false` | 번역 요청 |
| `translation.rewrite_language` | 없음 | `targetLanguage`, `style` | `false` | 다른 언어/표현으로 바꾸기 |

### 한국어 synonym 후보

| canonical term | synonyms |
| --- | --- |
| `translate` | 번역, 옮겨줘, 바꿔줘 |
| `english` | 영어, 영문 |
| `korean` | 한국어, 한글 |
| `japanese` | 일본어 |
| `chinese` | 중국어, 중문 |

### Hard Negative Pair

| first | second | hitAllowed | hit 금지 이유 |
| --- | --- | --- | --- |
| 이 문장을 영어로 번역해줘 | 다음 문장을 영문으로 바꿔줘 | `false` | source text가 다를 수 있고 입력 문장 자체가 응답을 결정 |
| 이걸 한국어로 바꿔줘 | 일본어로 번역해줘 | `false` | `targetLanguage` 다름 |

## code

`code`는 production Semantic Cache hit 금지 category다.

이유:

- 코드 내용, 언어, 런타임, 에러 메시지, dependency version이 응답을 결정한다.
- 코드 일부를 cache material로 저장하면 raw prompt fragment 저장 위험이 있다.
- 비슷한 에러 표현이라도 원인이 다를 수 있다.

### Intent 목록

| canonicalIntent | requiredSlots | optionalSlots | hitAllowed | 설명 |
| --- | --- | --- | --- | --- |
| `code.explain_code` | 없음 | `language`, `framework` | `false` | 코드 설명 |
| `code.debug_error` | 없음 | `language`, `errorType`, `runtime` | `false` | 에러/버그 디버깅 |
| `code.compile_error_help` | 없음 | `language`, `errorType` | `false` | 컴파일 오류 |

### 한국어 synonym 후보

| canonical term | synonyms |
| --- | --- |
| `code` | 코드, 함수, 메서드, 코드 블록 |
| `error` | 에러, 오류, exception |
| `compile` | 컴파일, 빌드 |
| `bug` | 버그, 문제, 안 됨 |

### Hard Negative Pair

| first | second | hitAllowed | hit 금지 이유 |
| --- | --- | --- | --- |
| 이 코드 설명해줘 | 이 함수 왜 에러나? | `false` | explain과 debug는 다른 answer type |
| 컴파일 오류가 나요 | 실행하면 버그가 생겨요 | `false` | compile-time error와 runtime bug는 다름 |
| 코드 블록이 포함된 요청 | 이 코드 설명해줘 | `false` | raw code content가 응답을 결정 |

## unknown

`unknown`은 production Semantic Cache hit 금지 category다.

이유:

- `canonicalIntent`를 안정적으로 만들 수 없다.
- `requiredSlots`를 검증할 수 없다.
- false positive 위험을 판단할 근거가 없다.

### Intent 목록

| canonicalIntent | requiredSlots | optionalSlots | hitAllowed | 설명 |
| --- | --- | --- | --- | --- |
| `unknown.unclassified` | 없음 | 없음 | `false` | 분류 실패 |
| `unknown.empty_input` | 없음 | 없음 | `false` | 빈 입력 |
| `unknown.ambiguous` | 없음 | 없음 | `false` | 모호한 입력 |

### Hard Negative Pair

| first | second | hitAllowed | hit 금지 이유 |
| --- | --- | --- | --- |
| 빈 문자열 | 공백 문자열 | `false` | embedding input 불가 |
| 이거 해줘 | 저거 처리해줘 | `false` | 지시 대상 불명확 |

## Pair-Level Decision Examples

### 1. account_access positive

```text
first:
비밀번호 재설정 방법 알려줘

second:
패스워드 초기화는 어떻게 해?
```

| field | value |
| --- | --- |
| `category` | `account_access` |
| `canonicalIntent` | `account.password_reset` |
| `requiredSlots` | `accountAction=password_reset` |
| `optionalSlots` | `authFactor=unknown`, `surface=unknown` |
| `hitAllowed` | `true` 또는 `candidate_only` |
| hit 금지 이유 | 없음. 단, `authFactor` 차이가 중요해지는 정책이면 `candidate_only` |
| 한국어 synonym 후보 | 패스워드 -> 비밀번호, 초기화 -> 재설정, 리셋 -> 재설정 |
| hard negative 여부 | 아님 |

### 2. support_refund hard negative: 배송비 환불 vs 주문 취소

```text
first:
배송비도 환불되나요?

second:
주문 취소하고 싶어요
```

| field | first | second |
| --- | --- | --- |
| `category` | `support_refund` | `support_refund` |
| `canonicalIntent` | `support_refund.shipping_fee_refund` | `support_refund.order_cancel` |
| `requiredSlots` | `supportAction=refund`, `refundObject=shipping_fee` | `supportAction=cancel`, `cancelObject=order` |
| `optionalSlots` | `shippingDirection=unknown`, `orderState=unknown` | `paymentState=unknown`, `orderState=unknown` |
| `hitAllowed` | `false` | `false` |
| hit 금지 이유 | 같은 category지만 intent/action/object가 다름 | 같은 category지만 intent/action/object가 다름 |
| 한국어 synonym 후보 | 배송비, 운송비, 환불, 돌려받 | 주문 취소, 취소 |
| hard negative 여부 | `true` | `true` |

### 3. support_refund hard negative: 반품 배송비 vs 교환 신청

```text
first:
반품하면 배송비도 돌려받나요?

second:
교환 신청은 어디서 하나요?
```

| field | first | second |
| --- | --- | --- |
| `category` | `support_refund` | `support_refund` |
| `canonicalIntent` | `support_refund.return_shipping_fee` | `support_refund.exchange_request` |
| `requiredSlots` | `supportAction=return`, `refundObject=shipping_fee` | `supportAction=exchange`, `exchangeObject=item` |
| `optionalSlots` | `shippingDirection=return`, `orderState=unknown` | `surface=unknown`, `orderState=unknown` |
| `hitAllowed` | `false` | `false` |
| hit 금지 이유 | `requiredSlots`가 다름 | `requiredSlots`가 다름 |
| 한국어 synonym 후보 | 반품, 반송, 배송비, 돌려받 | 교환, 교환 신청 |
| hard negative 여부 | `true` | `true` |

## Evaluation Dataset 후보

후속 평가셋에는 아래 field를 포함한다.

| field | 설명 |
| --- | --- |
| `caseId` | low-cardinality case id |
| `category` | category label |
| `canonicalIntent` | expected canonical intent |
| `requiredSlots` | expected required slot map |
| `optionalSlots` | expected optional slot map |
| `pairType` | `positive`, `negative`, `hard_negative`, `deny_category` |
| `hitAllowed` | expected hit decision |
| `reason` | 사람이 읽는 low-cardinality reason |

주의:

- raw prompt는 장기 fixture에 넣지 않는 방향을 우선 검토한다.
- 평가 목적의 non-sensitive synthetic prompt만 제한적으로 사용한다.
- 실제 고객 prompt, 실제 주문번호, 실제 이메일, 실제 secret은 금지한다.

## 후속 구현 순서

1. `account_access`를 실제 category로 분리할지, `general` 내부 `canonicalIntent`로만 둘지 결정
2. `canonicalIntent` 생성 정책 material 정의
3. `requiredSlots` / `optionalSlots` extractor 정의
4. 한국어 synonym dictionary를 code가 아니라 versioned policy material로 분리
5. hard negative 평가셋 작성
6. `hitAllowed` decision evaluator 작성
7. `support_refund`는 `candidate_only` 또는 `strict`로 shadow evaluation부터 시작
8. offline evaluation gate에서 false positive와 hard negative false positive를 차단

## 최종 결론

Semantic Cache production taxonomy의 핵심은 아래다.

```text
category는 큰 문맥
canonicalIntent는 같은 답을 재사용할 수 있는 의도
requiredSlots는 같은 intent 안에서 반드시 같아야 하는 조건
optionalSlots는 정책별 compatibility를 판단하는 보조 조건
hardNegativePair는 similarity와 무관하게 hit를 막는 안전장치
```

`support_refund`는 category가 같아도 `canonicalIntent`와 `requiredSlots`가 다르면 hit하면 안 된다.

`translation`, `code`, `unknown`은 production hit 대상이 아니다.
