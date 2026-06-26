# GateLM P0 A Day3 Runtime Config

## 1. 문서 목적

이 문서는 A 파트가 Day3 전에 B/C/D/E에게 뿌리는 Security, Routing, Exact Cache 런타임 설정 기준이다.

Day3의 목적은 새 기능을 넓히는 것이 아니라 아래 세 가지가 같은 계약으로 이어지게 하는 것이다.

```text
Security result
-> Routing decision
-> Exact Cache key/result
-> Provider response or cache response
-> Request Log / Detail mapping
```

---

## 2. 참조 문서

Day3 작업자는 최소 아래 문서를 함께 본다.

| 문서 | 용도 |
|---|---|
| `docs/p0/day3-shared-contract.md` | Day3 전체 공통 계약 |
| `docs/p0/a-day1-active-config.fixture.json` | Day3 config 기준값 |
| `docs/p0/p0-contract.md` | P0 상태값, cache, masking, routing 계약 |
| `docs/p0/p0-log-event-payload.md` | E가 저장/조회할 request log 필드 |
| `docs/p0/p0-test-matrix.md` | Day3 acceptance 테스트 기준 |

---

## 3. Day3 A 결론

Day3 A는 새 DB/API/Event를 만들지 않는다.

| 영역 | Day3 A 판단 |
|---|---|
| API 변경 | 없음 |
| DB 변경 | 없음 |
| Event 변경 | 없음 |
| seed 추가 | 없음 |
| fixture 기준 | 기존 `a-day1-active-config.fixture.json` 유지 |
| 코드 상수 기준 | cache key version `p0-exact-v2` 유지 |

Day3 B/C/D/E는 아래 config를 변경하지 않고 구현한다.

```text
securityPolicyHash=sec_p0_v1
routingPolicyHash=route_p0_v1
cachePolicyHash=cache_p0_v1
defaultProvider=mock
defaultModel=mock-balanced
lowCostModel=mock-fast
highQualityModel=mock-smart
exactCacheTtlSeconds=3600
exactKeyMaterialVersion=p0-exact-v2
```

---

## 4. Security Config

Source:

```text
docs/p0/a-day1-active-config.fixture.json
policies.security
```

| 항목 | 값 |
|---|---|
| security policy hash | `sec_p0_v1` |
| inspection mode | `sync_gateway_pre_provider` |
| raw prompt 저장 | `false` |
| raw response 저장 | `false` |
| redacted prompt preview 저장 | `true` |
| detection count 저장 | `true` |

Redact 대상:

```text
person_name
email
phone_number
```

Block 대상:

```text
resident_registration_number
api_key
authorization_header
jwt
private_key
```

Redaction placeholder:

| type | placeholder |
|---|---|
| `person_name` | `[PERSON_NAME_REDACTED]` |
| `email` | `[EMAIL_REDACTED]` |
| `phone_number` | `[PHONE_NUMBER_REDACTED]` |
| `resident_registration_number` | `[RESIDENT_REGISTRATION_NUMBER_REDACTED]` |
| `api_key` | `[API_KEY_REDACTED]` |
| `authorization_header` | `[AUTHORIZATION_HEADER_REDACTED]` |
| `jwt` | `[JWT_REDACTED]` |
| `private_key` | `[SECRET_REDACTED]` |

Day3 구현 규칙:

```text
redact 대상은 provider 호출 전에 placeholder로 치환한다.
block 대상이 있으면 provider 호출과 cache lookup을 모두 하지 않는다.
로그에는 raw prompt/raw response/secret 원문을 저장하지 않는다.
```

---

## 5. Routing Config

Source:

```text
docs/p0/a-day1-active-config.fixture.json
policies.routing
```

| 항목 | 값 |
|---|---|
| routing policy hash | `route_p0_v1` |
| requested model mode | `auto` |
| default provider | `mock` |
| default model | `mock-balanced` |
| low cost model | `mock-fast` |
| high quality model | `mock-smart` |

Routing rule:

| 조건 | selectedProvider | selectedModel | routingReason |
|---|---|---|---|
| `requestedModel=auto` and `prompt_length_chars <= 300` | `mock` | `mock-fast` | `short_prompt_low_cost` |
| `requestedModel=auto` and otherwise | `mock` | `mock-balanced` | `default_balanced` |
| 명시 model 요청 | `mock` | requested model | `pinned` |

주의:

```text
routing은 cacheStatus를 읽지 않는다.
cacheStatus는 routing 이후 exact cache lookup에서 결정된다.
```

---

## 6. Exact Cache Config

Source:

```text
docs/p0/a-day1-active-config.fixture.json
policies.cache
apps/gateway-core/internal/domain/cache/cache_key.go
```

| 항목 | 값 |
|---|---|
| cache policy hash | `cache_p0_v1` |
| cache mode | `exact_only` |
| exact cache enabled | `true` |
| semantic cache enabled | `false` |
| TTL | `3600` seconds |
| Redis key pattern | `gatelm:cache:exact:{cacheKeyHash}` |
| exact key material version | `p0-exact-v2` |

Cache key material:

```text
tenantId
projectId
applicationId
selectedProvider
selectedModel
normalizedRedactedPrompt
securityPolicyHash
routingPolicyHash
cachePolicyHash
```

현재 코드의 `KeyMaterial`에는 `RequestParamsHash`가 필수로 포함되어 있다.
따라서 D는 cache key 생성 시 아래를 함께 채워야 한다.

```text
requestParamsHash
```

Day3 구현 규칙:

```text
cache key는 raw prompt가 아니라 redacted prompt를 normalize한 값으로 만든다.
selectedProvider/selectedModel이 확정된 뒤 cache key를 만든다.
cachePolicyHash가 비어 있으면 cacheStatus=bypass, cacheType=none으로 처리한다.
cache hit이면 provider/mock provider를 호출하지 않는다.
```

---

## 7. Context 필드 기준

Day3는 필드명을 새로 만들지 않는다.

Routing output:

```text
requestedModel
selectedProvider
selectedModel
routingReason
routingPolicyHash
```

Security output:

```text
maskingAction
maskingDetectedTypes
maskingDetectedCount
redactedPromptPreview
securityPolicyHash
```

Cache output:

```text
cacheStatus
cacheType
cacheKeyHash
cacheHitRequestId
cachePolicyHash
```

현재 코드에는 두 종류의 context가 있다.

| context | 현재 용도 |
|---|---|
| `apps/gateway-core/internal/domain/request.GatewayContext` | pipeline stage 일부가 사용하는 가벼운 context |
| `apps/gateway-core/internal/pipeline.RequestContext` | log/event까지 고려한 넓은 context |

Day3에서 B/C/D/E가 새 필드를 추가해야 한다면 위 필드명을 유지한다.
E가 저장할 최종 필드는 `docs/p0/p0-log-event-payload.md`와 맞춘다.

---

## 8. B/C/D/E 전달 기준

### B에게 전달

```text
cacheStatus=hit이면 provider 호출을 생략한다.
cacheStatus=miss이면 기존 mock provider 호출을 유지한다.
response header에는 X-GateLM-Cache-Status를 사용한다.
```

### C에게 전달

```text
requestedModel과 selectedModel을 분리한다.
model=auto는 short prompt일 때 mock-fast, 그 외 mock-balanced로 보낸다.
routingReason은 short_prompt_low_cost 또는 default_balanced를 사용한다.
```

### D에게 전달

```text
securityPolicyHash=sec_p0_v1
cachePolicyHash=cache_p0_v1
cache key version=p0-exact-v2
cache key material에는 selectedProvider/selectedModel과 normalizedRedactedPrompt가 반드시 들어간다.
```

### E에게 전달

```text
cache hit, blocked, success 모두 request log 대상이다.
cache hit의 cost/token은 0으로 기록한다.
cache hit에서 절감 추정값은 savedCostMicroUsd 또는 metadata에 남길 수 있다.
raw prompt/raw response/secret 원문은 저장하지 않는다.
```

---

## 9. Day3 A 완료 기준

Day3 A는 아래 조건을 만족하면 완료다.

```text
1. Security/Routing/Cache config 기준이 문서화되어 있다.
2. B/C/D/E가 사용할 policy hash, model name, routingReason, cache key material이 고정되어 있다.
3. p0-test-matrix의 routingReason 값이 fixture와 일치한다.
4. config 검증 스크립트로 fixture와 코드 상수를 확인할 수 있다.
5. API/DB/Event 변경이 없다.
```

