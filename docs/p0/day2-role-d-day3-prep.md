# GateLM P0 Day 2 Role D Day 3 Prep

## 1. 작업 목적

이 문서는 Day 2에서 Role D 구현 범위를 더 늘리지 않고, Day 3 작업자가 민감정보 처리와 Exact Cache 구현을 바로 이어갈 수 있도록 남기는 handoff 메모다.

새 공개 API, DB schema, Event 계약을 추가하지 않는다. 기준 계약은 `docs/p0/p0-contract.md`, `docs/policies/pii-masking-policy.md`, `docs/architecture/gateway-flow.md`, `docs/p0/p0-log-event-payload.md`를 따른다.

## 2. Day 3 Role D 목표

Day 3에서 Role D가 이어서 구현할 목표는 아래다.

- Sensitive Data Detector registry 구현
- email, phone_number redaction 구현
- API key-like token, JWT, resident_registration_number block 구현
- Redis 기반 Exact Cache wiring
- Provider 호출 전에 masking과 cache 흐름이 적용되는지 보장

Day 3에서도 P0 범위를 넘지 않는다. Semantic Cache, custom detector UI, 복잡한 policy engine, 신규 API/DB/Event 계약은 별도 작업으로 남긴다.

## 3. Day 2까지 있는 기반

Day 1과 Day 2에서 Role D가 이어받을 수 있는 기반은 아래다.

- masking domain type, action, detector type, placeholder 계약
- masking stage skeleton과 `mask_or_block` stage name
- exact cache key builder와 redacted prompt 기반 key material
- cache stage skeleton과 blocked request cache bypass 처리
- `CacheStore` port
- auth 실패가 Provider 호출 전에 멈추는 handler safety test
- Day 2 auth smoke helper

이 기반은 실제 detector, Redis adapter, full Gateway pipeline wiring이 아니라 각 역할이 붙을 수 있는 boundary다.

## 4. 역할 간 의존성

Day 3 구현 전에 아래 연결값을 각 역할과 맞춘다.

- C: tenantId, projectId, applicationId, selectedProvider, selectedModel, routingPolicyHash 또는 equivalent config hash 제공
- B: provider call path에서 cache hit이면 provider adapter 호출을 생략
- E: masking/cache metadata를 request log와 detail에 저장
- A/C: security, cache, routing policy hash fixture 제공

Role D는 실제 인증 저장소, provider adapter 구현, request log writer 자체를 소유하지 않는다. 필요한 경우 test adapter나 stage wiring만 추가한다.

## 5. Day 3 Implementation Checklist

### 5.1 Masking

- Detector registry를 추가하되 detector type을 enum으로 닫지 않는다.
- email은 `[EMAIL_REDACTED]` placeholder로 치환한다.
- phone_number는 `[PHONE_NUMBER_REDACTED]` placeholder로 치환한다.
- API key-like token, JWT, resident_registration_number는 `sensitive_data_blocked`로 차단한다.
- 차단 응답은 HTTP `403`, `maskingAction=blocked`, `cacheStatus=bypass`, `cacheType=none`을 유지한다.
- block 요청은 cache lookup과 provider call을 모두 생략한다.
- redaction placeholder에는 원문 일부를 남기지 않는다.

### 5.2 Cache

- Redis 기반 `CacheStore` adapter를 붙인다.
- Cache key는 redacted prompt와 tenant/project/application context 기준으로 만든다.
- Cache key material에는 selectedProvider, selectedModel, security policy hash, routing policy hash를 포함한다.
- Safe request 1회차는 miss 후 provider call, 2회차는 hit 후 provider call 생략이어야 한다.
- Redis key, log, response, fixture에 raw prompt를 넣지 않는다.

### 5.3 Handler/Pipeline Wiring

- masking은 provider call보다 앞에 둔다.
- routing 결과가 확정된 뒤 exact cache key를 만든다.
- cache hit이면 OpenAI-compatible response를 반환하고 provider adapter를 호출하지 않는다.
- provider call이 필요한 경우에도 provider에는 redacted prompt만 전달한다.
- blocked request도 P0 request log 대상임을 유지한다.

### 5.4 금지

- raw prompt 저장
- raw response 저장
- raw API key, app token, provider key 저장
- raw prompt를 Redis key에 사용
- block 요청에서 cache lookup 수행
- Provider 호출 뒤에만 masking 적용
- P0 문서에 없는 API, DB column, Event field 추가

## 6. Day 3 Acceptance Checklist

Day 3 완료 판단은 아래 케이스를 기준으로 한다.

- email 포함 요청은 redacted prompt로 provider에 전달된다.
- phone_number 포함 요청은 redacted prompt로 provider에 전달된다.
- API key-like token 포함 요청은 Provider 호출 전에 block된다.
- JWT 포함 요청은 Provider 호출 전에 block된다.
- resident_registration_number 포함 요청은 Provider 호출 전에 block된다.
- 동일 safe request 1회차는 exact cache miss와 provider call 1회를 만든다.
- 동일 safe request 2회차는 exact cache hit이고 provider call count가 증가하지 않는다.
- block 요청은 provider call count가 증가하지 않는다.
- block 요청은 cache lookup을 수행하지 않는다.
- raw/secret scan을 통과한다.

## 7. Verification 기준

Day 3 구현 후 최소 검증 명령은 아래다.

```powershell
docker compose run --rm go-toolbox go test ./apps/gateway-core/...
```

보안 검증은 변경 파일과 gateway-core 대상으로 수행한다.

- forbidden raw field scan
- secret-like token scan
- mock provider `/__mock/reset`, `/__mock/stats` 기반 provider call count 확인

문서나 테스트 fixture에는 실제 secret, 실제 개인정보, 실제 production log를 넣지 않는다.

## 8. Assumptions

- 이 문서는 Day 2 handoff memo이며, 실제 Day 3 기능 구현은 별도 작업 단위에서 진행한다.
- API 변경은 없다.
- DB 변경은 없다.
- Event 변경은 없다.
- Day 3에서도 새 계약이 필요하면 먼저 `docs/p0/p0-contract.md` 또는 관련 P0 문서를 업데이트한 뒤 구현한다.
