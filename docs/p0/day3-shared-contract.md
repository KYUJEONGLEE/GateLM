# GateLM P0 Day3 Shared Contract

## 1. 문서 목적

이 문서는 Day3 작업인 Security, Simple Routing, Exact Cache를 병렬로 구현하기 위한 짧은 공통 계약이다.

Day3에서 각 파트는 이 문서를 기준으로 개발한다.
이 문서와 기존 문서가 충돌하면 아래 우선순위로 판단한다.

1. `docs/p0/p0-contract.md`
2. `docs/p0/p0-log-event-payload.md`
3. `docs/p0/team-workplan.md`
4. `docs/p0/day3-shared-contract.md`

Day3 목표는 기능을 많이 여는 것이 아니라 아래 흐름을 끊기지 않게 만드는 것이다.

```text
인증된 Gateway 요청
-> 민감정보 검사
-> redact 또는 block
-> simple routing
-> exact cache lookup
-> cache miss면 mock provider 호출
-> cache hit/block 결과까지 request log에 남김
```

---

## 2. Day3에서 새로 만들지 않는 것

Day3에서는 아래를 새로 열지 않는다.

| 항목 | 판단 |
|---|---|
| Semantic Cache | P2. Day3는 Exact Cache만 구현 |
| Vector DB / Embedding | P2 |
| 실제 Provider 연동 | P1. Day3는 mock provider 기준 |
| Rate Limit / Budget hard block | P1 |
| Streaming | P1. P0는 `stream=true` 거부 유지 |
| 새 DB 테이블 | 원칙적으로 추가하지 않음 |
| 새 외부 API 계약 | 원칙적으로 추가하지 않음 |

필드가 부족해 보여도 먼저 `p0-contract.md`, `p0-log-event-payload.md`에 있는 필드로 표현한다.
정말 부족하면 Daily Sync에서 API/DB/Event 변경 여부를 먼저 공유한다.

---

## 3. Day3 기준 Active Config

Day3는 `docs/p0/a-day1-active-config.fixture.json`의 아래 값을 기준으로 한다.

### 3.1 Security

| 항목 | 값 |
|---|---|
| `securityPolicyHash` | `sec_p0_v1` |
| 검사 위치 | Gateway 내부, Provider 호출 전 |
| redact 대상 | `person_name`, `email`, `phone_number` |
| block 대상 | `resident_registration_number`, `api_key`, `authorization_header`, `jwt`, `private_key` |
| raw prompt 저장 | 금지 |
| raw response 저장 | 금지 |

Redaction placeholder:

| 타입 | placeholder |
|---|---|
| `person_name` | `[PERSON_NAME_REDACTED]` |
| `email` | `[EMAIL_REDACTED]` |
| `phone_number` | `[PHONE_NUMBER_REDACTED]` |
| `resident_registration_number` | `[RESIDENT_REGISTRATION_NUMBER_REDACTED]` |
| `api_key` | `[API_KEY_REDACTED]` |
| `authorization_header` | `[AUTHORIZATION_HEADER_REDACTED]` |
| `jwt` | `[JWT_REDACTED]` |
| `private_key` | `[SECRET_REDACTED]` |

### 3.2 Routing

| 항목 | 값 |
|---|---|
| `routingPolicyHash` | `route_p0_v1` |
| default provider | `mock` |
| default model | `mock-balanced` |
| low cost model | `mock-fast` |
| high quality model | `mock-smart` |

P0 simple routing rule:

| 조건 | selectedProvider | selectedModel | routingReason |
|---|---|---|---|
| 요청 model이 `auto`이고 prompt 길이 300자 이하 | `mock` | `mock-fast` | `short_prompt_low_cost` |
| 요청 model이 `auto`이고 위 조건에 해당하지 않음 | `mock` | `mock-balanced` | `default_balanced` |
| 요청 model이 명시 모델이고 model catalog에 있음 | `mock` | 요청 모델 | `pinned` |

주의:

```text
routing은 cacheStatus에 의존하지 않는다.
cacheStatus는 routing 이후 cache lookup 단계에서 결정된다.
```

### 3.3 Exact Cache

| 항목 | 값 |
|---|---|
| `cachePolicyHash` | `cache_p0_v1` |
| mode | `exact_only` |
| semantic cache | disabled |
| TTL | 3600 seconds |
| key material version | `p0-exact-v2` |

Cache key material:

```text
tenantId
projectId
applicationId
selectedProvider
selectedModel
normalizedRedactedPrompt
securityPolicyVersionId
routingPolicyVersionId
cachePolicyHash
requestParamsHash
```

Policy mapping:

```text
securityPolicyVersionId = securityPolicyHash 값 사용
routingPolicyVersionId = routingPolicyHash 값 사용
```

Cache key 원칙:

```text
raw prompt를 key material에 넣지 않는다.
redacted prompt를 normalize한 값을 사용한다.
selectedProvider/selectedModel이 확정된 뒤 cache key를 만든다.
cachePolicyHash가 비어 있으면 cacheStatus=bypass, cacheType=none으로 처리한다.
Go 코드의 KeyMaterial JSON tag는 securityPolicyVersionId, routingPolicyVersionId를 사용한다.
```

---

## 4. Gateway 처리 순서

Day3 통합 순서는 아래로 고정한다.

```text
1. receive request
2. assign requestId
3. parse OpenAI-compatible payload
4. authenticate API Key
5. validate App Token
6. resolve Tenant/Project/Application context
7. sensitive data detection
8. redact or block
9. simple routing
10. build exact cache key
11. exact cache lookup
12. if cache miss, call mock provider
13. build OpenAI-compatible response
14. write request log
```

분기 규칙:

| 상황 | Provider 호출 | Cache lookup | status | cacheStatus | cacheType | cost/token |
|---|---|---|---|---|---|---|
| safe request 1회차 | 함 | 함 | `success` | `miss` | `exact` | mock usage 기준 |
| same safe request 2회차 | 안 함 | 함 | `cache_hit` | `hit` | `exact` | 0 |
| redacted request | 함 | 함 | `success` | `miss` 또는 `hit` | `exact` | 경로에 따름 |
| blocked request | 안 함 | 안 함 | `blocked` | `bypass` | `none` | 0 |
| auth/context error | 안 함 | 안 함 | `error` | `bypass` | `none` | 0 |
| cache policy 없음 | 함 | 안 함 | `success` 또는 `error` | `bypass` | `none` | Provider 결과 기준 |

Cache hit 로그에는 가능하면 아래 값을 함께 남긴다.

```text
savedCostMicroUsd
savedPromptTokens
savedCompletionTokens
savedTotalTokens
cacheHitRequestId
```

`savedPromptTokens`, `savedCompletionTokens`, `savedTotalTokens`가 DB/Event에 아직 없다면 `metadata` 안에 저장한다.
이를 이유로 Day3에서 DB column을 새로 추가하지 않는다.

---

## 5. 역할별 구현 범위

### A. Control Plane / Runtime Config

할 일:

```text
security/routing/cache policy hash와 config 값을 문서 및 seed 기준으로 재확인한다.
Day3 팀원이 사용할 config key, model name, policy hash가 기존 fixture와 일치하는지 확인한다.
새 DB/API/Event를 만들지 않는다.
```

완료 기준:

```text
B/C/D/E가 sec_p0_v1, route_p0_v1, cache_p0_v1 기준으로 개발할 수 있다.
```

### B. Gateway Core / Provider Adapter

할 일:

```text
cache hit이면 mock provider를 호출하지 않는 response path를 만든다.
cache miss이면 기존 mock provider 호출 path를 유지한다.
response header에 X-GateLM-Cache-Status를 넣는다.
```

완료 기준:

```text
동일 safe request 1회차는 provider 호출, 2회차는 provider 호출 없이 응답한다.
```

### C. Auth / Context / Simple Routing

할 일:

```text
requestedModel과 selectedModel을 분리한다.
model=auto 요청을 simple rule로 selectedModel에 매핑한다.
routing은 cacheStatus에 의존하지 않는다.
```

완료 기준:

```text
Request Detail/Log에 requestedModel=auto, selectedProvider=mock, selectedModel=mock-fast 또는 mock-balanced가 남는다.
```

### D. Security / Exact Cache

할 일:

```text
email/phone/person_name은 redact한다.
RRN/API Key/Authorization header/JWT/private key는 block한다.
redacted prompt 기준으로 exact cache key를 만들고 Redis에서 조회/저장한다.
```

완료 기준:

```text
redaction은 provider 호출 전에 적용된다.
blocked 요청은 provider와 cache를 모두 호출하지 않는다.
cache key와 log에 raw prompt/secret이 들어가지 않는다.
```

### E. Observability / Log / Demo

할 일:

```text
masking/cache/routing 결과를 request log와 detail에 매핑한다.
cache hit, blocked request도 로그에 남긴다.
Dashboard 숫자는 request log canonical source 기준으로 계산한다.
```

완료 기준:

```text
requestId 하나로 routing, masking, cache, cost/token, status를 확인할 수 있다.
```

---

## 6. 구현 순서

Day3는 아래 순서로 구현하면 충돌이 가장 적다.

1. A가 이 문서와 config 기준을 먼저 공유한다.
2. C가 routing output shape을 확정한다.
3. D가 C의 selectedProvider/selectedModel을 받아 cache key와 masking/block을 구현한다.
4. B가 D의 cache result를 받아 provider 호출 또는 cache response로 분기한다.
5. E가 B/C/D의 context를 request log/detail에 매핑한다.
6. 마지막에 D 또는 B가 smoke test owner로 통합 curl을 확인한다.

병렬 가능 범위:

| 역할 | 병렬 가능 여부 | 조건 |
|---|---|---|
| A | 가능 | 기존 fixture/config를 바꾸지 않는다면 독립 진행 가능 |
| B | 부분 가능 | D의 cache result enum을 이 문서 기준으로 가정 |
| C | 가능 | routing output을 먼저 고정해야 함 |
| D | 부분 가능 | C의 selectedModel 필드를 이 문서 기준으로 가정 |
| E | 부분 가능 | 없는 값은 null/metadata로 받되 필드명은 이 문서 기준 유지 |

---

## 7. 추천 머지 순서

Day3 추천 머지 순서는 아래와 같다.

```text
1. A 문서/config 확인 PR
2. C routing PR
3. D security/cache PR
4. B cache/provider response path PR
5. E log/detail/dashboard mapping PR
6. Day3 통합 smoke fix PR
```

이유:

```text
C의 selectedModel이 있어야 D가 cache key를 안정적으로 만들 수 있다.
D의 cache result가 있어야 B가 provider 호출 여부를 결정할 수 있다.
B/C/D의 결과가 있어야 E가 로그와 상세 화면을 정확히 매핑할 수 있다.
```

긴급 병렬 개발이 필요하면 아래 가정으로 먼저 시작한다.

```text
Routing output:
requestedModel, selectedProvider, selectedModel, routingReason

Security output:
maskingAction, maskingDetectedTypes, maskingDetectedCount, redactedPromptPreview

Cache output:
cacheStatus, cacheType, cacheKeyHash, cacheHitRequestId
```

---

## 8. Day3 통합 테스트 시나리오

Day3 PR이 모두 머지되기 전이라도 각자 아래 시나리오를 기준으로 테스트를 작성한다.

| 시나리오 | 기대 결과 |
|---|---|
| safe request 1회차 | `status=success`, `cacheStatus=miss`, provider call count 증가 |
| same safe request 2회차 | `status=cache_hit`, `cacheStatus=hit`, provider call count 증가 없음 |
| `model=auto`, 짧은 prompt | `selectedModel=mock-fast`, `routingReason=short_prompt_low_cost` |
| `model=auto`, 긴 prompt | `selectedModel=mock-balanced`, `routingReason=default_balanced` |
| email/phone 포함 | `maskingAction=redacted`, provider에는 redacted prompt 전달 |
| JWT/API Key/RRN 포함 | `status=blocked`, `httpStatus=403`, provider/cache 호출 없음 |
| cachePolicyHash 없음 | `cacheStatus=bypass`, cache lookup 없음 |
| 모든 로그 조회 | raw prompt/raw response/secret 원문 없음 |

최소 smoke 순서:

```text
1. safe request 1회
2. 같은 safe request 1회 더
3. email/phone 포함 request 1회
4. JWT 또는 API key 형태 포함 request 1회
5. requestId로 log/detail 확인
```

---

## 9. PR 체크리스트

Day3 PR에는 아래를 본문에 표시한다.

```text
## 작업 내용
- 

## 확인한 내용
- [ ] 로컬 실행 확인
- [ ] 관련 기능 동작 확인
- [ ] 에러 케이스 확인
- [ ] README 또는 실행 방법 업데이트 확인
- [ ] raw prompt/raw response/secret 원문 저장 없음
- [ ] Provider 호출 전 security/cache/routing 순서 확인

## API/DB/Event 변경 여부
- API:
- DB:
- Event:

## 참고 사항
- 
```

API/DB/Event 변경이 있으면 관련 문서를 같이 수정한다.
문서에 없는 필드를 임의로 만들지 않는다.
