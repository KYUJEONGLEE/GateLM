# GateLM P0 Role D Summary

## 1. 문서 목적

이 문서는 Role D가 P0 Day 1과 Day 2에서 구현하거나 고정한 내용을 한곳에 정리한 summary다.

Role D의 책임은 민감정보 처리, Exact Cache, 인증 실패 시 Provider 미호출 보장처럼 Gateway 요청이 Provider 호출 전 안전하게 멈추거나 변환되는 경계를 고정하는 것이다.

이 문서는 새 공개 API, DB schema, Event 계약을 만들지 않는다. 기준 계약은 아래 문서를 따른다.

- `docs/p0/p0-contract.md`
- `docs/p0/p0-log-event-payload.md`
- `docs/architecture/gateway-flow.md`
- `docs/policies/pii-masking-policy.md`

## 2. Day 1 요약: Masking / Exact Cache Boundary

Day 1 목표는 민감정보 처리와 Exact Cache가 Gateway pipeline에 안전하게 들어갈 수 있도록 내부 타입과 stage boundary를 먼저 고정하는 것이었다.

완성형 detector, Redis adapter, Gateway live wiring까지 구현하지 않고, B/C/E 역할이 붙을 수 있는 최소 내부 계약과 skeleton을 만드는 데 집중했다.

### 2.1 Masking 계약

추가 파일:

```text
apps/gateway-core/internal/domain/masking/types.go
```

구현 내용:

- P0 `maskingAction` 값을 `none`, `redacted`, `blocked`로 고정
- P0 detector type을 `email`, `phone_number`, `resident_registration_number`, `api_key`, `authorization_header`, `jwt`, `private_key`로 고정
- P0 placeholder를 문서 계약과 맞춤
- detector type별 P0 action mapping helper 추가
- 알 수 없는 detector type은 known 여부를 `false`로 반환

### 2.2 Exact Cache Key Builder

추가 파일:

```text
apps/gateway-core/internal/domain/cache/cache_key.go
apps/gateway-core/internal/domain/cache/cache_key_test.go
```

구현 내용:

- P0 cache status/type 값을 고정
  - status: `hit`, `miss`, `bypass`, `error`
  - type: `none`, `exact`, `semantic`
- Exact cache key material 구조 추가
  - tenant/project/application
  - selected provider/model
  - security/routing policy version
  - normalized redacted prompt
  - request params hash
- redacted prompt normalization helper 추가
- HMAC-SHA256 기반 `BuildExactKey` 추가
- 최종 cache key string에 prompt 원문 또는 redacted prompt 원문이 노출되지 않도록 보장

### 2.3 CacheStore Port

추가 파일:

```text
apps/gateway-core/internal/ports/cache_store.go
```

구현 내용:

- Redis 구현체가 나중에 붙을 수 있도록 `CacheStore` interface 추가
- `GetExact`, `SetExact` 경계 추가
- cache lookup result와 stored entry 타입 추가
- Gateway pipeline이 concrete Redis client에 직접 의존하지 않도록 분리

### 2.4 Masking Stage Skeleton

추가 파일:

```text
apps/gateway-core/internal/pipeline/stages/masking/stage.go
```

구현 내용:

- stage name을 `mask_or_block`으로 고정
- masking engine interface 추가
- E가 저장할 P0 metadata를 stage result에 포함
  - `maskingAction`
  - `maskingDetectedTypes`
  - `maskingDetectedCount`
  - `redactedPromptPreview`
  - `securityPolicyVersionId`
- block 결과의 error metadata를 `sensitive_data_blocked`, `mask_or_block`으로 고정

### 2.5 Exact Cache Stage Skeleton

추가 파일:

```text
apps/gateway-core/internal/pipeline/stages/cache/stage.go
```

구현 내용:

- stage name을 `exact_cache_lookup`으로 고정
- cache key builder와 `CacheStore` interface 경계 연결
- `maskingAction=blocked`이면 cache lookup을 생략
- blocked request의 cache metadata를 `cacheStatus=bypass`, `cacheType=none`으로 고정
- cache lookup 결과를 `hit`, `miss`, `error`로 mapping

## 3. Day 2 요약: Auth Safety / Provider 미호출 보장

Day 2 목표는 C가 붙일 API Key/App Token 인증 wiring이 Provider 호출 전에 실패 요청을 멈추는지 Role D 관점에서 고정하는 것이었다.

실제 인증 저장소, hash 검증, seed/DB 조회는 C 소유로 두고, Role D는 handler/router/smoke 레벨에서 Provider 미호출 safety contract를 고정했다.

### 3.1 Day 2 Step 1: C에게 받을 Auth 계약 고정

수정 파일:

```text
apps/gateway-core/internal/http/handlers/chat_completions_handler.go
apps/gateway-core/internal/pipeline/stage.go
apps/gateway-core/internal/pipeline/stages/appauth/stage.go
apps/gateway-core/internal/pipeline/stages/authenticate/stage.go
apps/gateway-core/internal/pipeline/stages/identify/stage.go
apps/gateway-core/internal/pipeline/stages/routing/stage.go
```

핵심 변경:

- `ChatCompletionsHandler`에 auth 주입 지점 추가
  - `APIKeyAuthenticator`
  - `AppTokenValidator`
- handler 처리 순서를 Provider lookup/call보다 auth가 먼저 오도록 고정
  - body parse
  - stream/body/messages validation
  - API Key 인증
  - App Token 검증 및 scope 확인
  - provider registry lookup
  - provider call
- `Authorization` bearer token 누락 또는 불일치를 `invalid_api_key`로 반환
- `X-GateLM-App-Token` 누락 또는 불일치를 `invalid_app_token`으로 반환
- tenant/project/application 불일치를 `scope_mismatch`로 반환
- `GatewayError`를 HTTP status/code/message/stage로 그대로 변환
- auth 실패 응답 metadata를 아래처럼 고정
  - `cacheStatus=bypass`
  - `cacheType=none`
  - `maskingAction=none`
- auth 실패 시 provider registry lookup과 provider adapter call을 생략
- pipeline stage interface/import를 현재 domain request context와 맞게 정리

### 3.2 Day 2 Step 2: Fake 기반 Auth Safety Test 작성

추가 파일:

```text
apps/gateway-core/internal/http/handlers/chat_completions_auth_safety_test.go
```

테스트 helper:

- fake API key authenticator
- fake app token validator
- mock provider server
- synthetic redacted fixture token

고정한 테스트 시나리오:

- invalid API Key
  - HTTP `401`
  - error code `invalid_api_key`
  - app token validator 호출 없음
  - provider call count `0`
- invalid App Token
  - HTTP `403`
  - error code `invalid_app_token`
  - provider call count `0`
- scope mismatch
  - HTTP `403`
  - error code `scope_mismatch`
  - provider call count `0`
- valid auth
  - HTTP `200`
  - API key/app token fake 각각 1회 호출
  - provider call count `1`

모든 실패 테스트에서 `X-GateLM-Cache-Status=bypass`, `X-GateLM-Masking-Action=none`을 함께 확인한다.

### 3.3 Day 2 Step 3: C Auth Merge 후 Router Wiring Test 연결

수정 파일:

```text
apps/gateway-core/internal/app/router.go
```

추가 파일:

```text
apps/gateway-core/internal/app/router_test.go
```

핵심 변경:

- `NewRouter`에 optional auth wiring 경로 추가
- `RouterOptions`, `RouterOption`, `WithGatewayAuth` 추가
- router composition에서 `ChatCompletionsHandler`로 authenticator/validator를 전달
- 기존 call site가 깨지지 않도록 variadic option 방식 사용
- router-level smoke test 추가
  - `app.NewRouter` 경로로 invalid API Key 요청 전송
  - handler auth가 실제 router wiring을 통해 호출되는지 확인
  - app token validator와 provider call이 실행되지 않는지 확인
  - cache bypass header 확인

이 단계에서 실제 C repository/service 구현은 아직 없어서, service 자체가 아니라 router wiring 계약을 fake로 검증했다.

### 3.4 Day 2 Step 4: Auth Smoke Helper 추가

추가 파일:

```text
scripts/dev/p0-day2-auth-smoke.ps1
```

핵심 기능:

- Windows PowerShell 기반 Day2 auth 실패 smoke helper
- 기본 입력 env 제공
  - `GATEWAY_BASE_URL`
  - `MOCK_PROVIDER_BASE_URL`
  - `GATELM_API_KEY`
  - `GATELM_APP_TOKEN`
  - `GATELM_INVALID_API_KEY`
  - `GATELM_INVALID_APP_TOKEN`
  - `GATELM_SCOPE_MISMATCH_APP_TOKEN`
- mock provider `/__mock/reset`, `/__mock/stats`로 call count 확인
- 실패 케이스별 expected HTTP status와 error code 확인
- 실패 케이스 후 mock provider call count가 `0`인지 확인
- scope mismatch token fixture가 없으면 해당 케이스는 skip 처리

Smoke 대상:

- invalid API Key
  - expected HTTP `401`
  - expected code `invalid_api_key`
  - expected provider calls `0`
- invalid App Token
  - expected HTTP `403`
  - expected code `invalid_app_token`
  - expected provider calls `0`
- scope mismatch
  - expected HTTP `403`
  - expected code `scope_mismatch`
  - expected provider calls `0`
  - mismatch token env가 있을 때만 실행

### 3.5 Day 2 Step 5: Day 3 준비 메모

Day 3 준비 메모 내용은 현재 summary에 흡수했다. Day 3 작업자가 이어갈 내용은 아래로 정리한다.

Day 3 Role D 목표:

- detector registry 구현
- email/phone redaction 구현
- API key-like token, JWT, RRN block 구현
- Redis exact cache wiring
- Provider 호출 전 masking/cache 적용 보장

Day 3 구현 기준:

- detector type을 enum으로 닫지 않는다.
- email은 `[EMAIL_REDACTED]`로 redact한다.
- phone_number는 `[PHONE_NUMBER_REDACTED]`로 redact한다.
- API key-like token, JWT, RRN은 `sensitive_data_blocked`, HTTP `403`, `maskingAction=blocked`로 block한다.
- block 요청은 cache lookup과 provider call을 모두 생략한다.
- cache key는 redacted prompt와 selected provider/model/policy hash 기준으로 만든다.
- safe request 1회차는 miss/provider call, 2회차는 hit/provider call 없음이어야 한다.
- raw prompt, raw response, raw credential, raw token, provider key 원문을 저장하지 않는다.
- P0 문서에 없는 API/DB/Event를 추가하지 않는다.

## 4. Day 2 변경 파일 목록

수정한 기존 파일:

```text
apps/gateway-core/internal/http/handlers/chat_completions_handler.go
apps/gateway-core/internal/app/router.go
apps/gateway-core/internal/pipeline/stage.go
apps/gateway-core/internal/pipeline/stages/appauth/stage.go
apps/gateway-core/internal/pipeline/stages/appauth/stage_test.go
apps/gateway-core/internal/pipeline/stages/authenticate/stage.go
apps/gateway-core/internal/pipeline/stages/identify/stage.go
apps/gateway-core/internal/pipeline/stages/identify/stage_test.go
apps/gateway-core/internal/pipeline/stages/routing/stage.go
apps/gateway-core/internal/pipeline/stages/routing/stage_test.go
```

새로 생성한 파일:

```text
apps/gateway-core/internal/http/handlers/chat_completions_auth_safety_test.go
apps/gateway-core/internal/app/router_test.go
scripts/dev/p0-day2-auth-smoke.ps1
docs/p0/role-d-summary.md
```

통합 후 제거한 별도 문서:

```text
Day 1 Role D implementation summary
Day 2 Role D Day 3 prep memo
```

## 5. 계약 변경 여부

API 변경:

```text
없음
```

DB 변경:

```text
없음
```

Event 변경:

```text
없음
```

Policy 변경:

```text
없음
```

Day 1과 Day 2 작업은 이미 P0 문서에 정의된 계약을 코드 내부 타입, handler wiring, test, smoke helper, handoff 문서로 옮긴 것이다.

## 6. 역할 간 연결 계약

### 6.1 C -> D

Auth safety:

```text
AuthenticateAPIKey(ctx, bearerToken) -> APIKeyIdentity
ValidateAppToken(ctx, appToken) -> AppTokenIdentity
```

Cache key와 request context:

```text
tenantId
projectId
applicationId
selectedProvider
selectedModel
securityPolicyVersionId 또는 securityPolicyHash
routingPolicyVersionId 또는 routingPolicyHash
```

### 6.2 D -> E

Request Log / Detail / Dashboard 저장을 위해 D가 넘겨야 하는 metadata:

```text
maskingAction
maskingDetectedTypes
maskingDetectedCount
redactedPromptPreview
cacheStatus
cacheType
cacheKeyHash
cacheHitRequestId
```

### 6.3 B/C/D Pipeline 순서

유지해야 하는 순서:

```text
parse and validate request
-> authenticate API key
-> validate app token and scope
-> detect sensitive data
-> mask or block
-> decide model route
-> build exact cache key
-> exact cache lookup
-> provider call on cache miss only
```

중요 규칙:

```text
auth 실패 요청은 provider lookup/call 전에 멈춘다.
block 요청은 cache lookup과 provider call을 모두 생략한다.
cache key는 raw prompt가 아니라 redacted prompt 기준이다.
cache key material에는 selectedProvider와 selectedModel이 포함된다.
```

## 7. 검증 결과

Day 1 검증:

```powershell
docker compose run --rm -e GO111MODULE=off --workdir /workspace/apps/gateway-core go-toolbox go test ./...
```

결과:

```text
PASS
```

Day 2 검증:

```powershell
docker compose run --rm go-toolbox go test ./apps/gateway-core/internal/http/handlers
docker compose run --rm go-toolbox go test ./apps/gateway-core/internal/app
docker compose run --rm go-toolbox go test ./apps/gateway-core/...
```

결과:

```text
PASS
```

PowerShell smoke script syntax:

```text
PASS
```

보안 scan:

```text
forbidden raw field scan: match 없음
secret-like token scan: match 없음
```

검증된 내용:

- 같은 redacted prompt와 같은 context는 같은 exact cache key를 만든다.
- tenant/project/application/provider/model/policy/prompt가 바뀌면 cache key가 바뀐다.
- 최종 cache key string에 prompt 원문 또는 redacted prompt 원문이 포함되지 않는다.
- auth 실패는 Provider 호출 전에 멈춘다.
- invalid API Key는 app token validator와 provider를 호출하지 않는다.
- invalid App Token은 provider를 호출하지 않는다.
- scope mismatch는 provider를 호출하지 않는다.
- valid auth는 provider를 1회 호출한다.
- router wiring에서도 invalid API Key가 provider call 전에 멈춘다.
- Day2 smoke helper는 mock provider call count를 기준으로 auth 실패 3케이스를 확인한다.

## 8. 남은 작업

Day 3 또는 B/C wiring 이후 이어서 진행할 작업:

- 실제 detector registry 구현
- email/phone redaction 구현
- API key-like token/JWT/RRN/private key/authorization header block 구현
- Redis 기반 `CacheStore` adapter 구현
- Gateway RequestContext와 stage runner에 masking/cache stage 연결
- cache hit이면 mock provider 호출을 생략하는 provider path 연결
- cache 저장 payload shape 확정
- `RequestParamsHash`에 포함할 content-affecting parameter 범위 확정
- request log/detail에 masking/cache metadata 저장
- 보안 리뷰 진행

## 9. 리뷰 필요

보안 리뷰 필요:

```text
민감정보 detector/action mapping
redaction placeholder
cache key material
raw prompt 미노출 보장 방식
auth 실패의 provider bypass 처리
block 요청의 cache/provider bypass 처리
smoke fixture가 실제 secret을 포함하지 않는지 확인
```

DB/API/Event 리뷰:

```text
필요 없음
```
