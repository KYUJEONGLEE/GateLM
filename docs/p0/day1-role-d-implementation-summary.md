# GateLM P0 Day 1 Role D Implementation Summary

## 1. 작업 개요

Role D의 Day 1 목표는 민감정보 처리와 Exact Cache가 Gateway pipeline에 안전하게 들어갈 수 있도록 내부 계약과 skeleton을 고정하는 것이었다.

이번 작업은 완성형 detector, Redis adapter, Gateway live wiring까지 구현하지 않고, B/C/E 역할이 붙을 수 있는 최소 내부 타입과 stage 경계를 만드는 데 집중했다.

## 2. 구현한 내용

### 2.1 Masking 계약 추가

추가 파일:

```text
apps/gateway-core/internal/domain/masking/types.go
```

구현 내용:

- P0 `maskingAction` 값 고정
  - `none`
  - `redacted`
  - `blocked`
- P0 detector type 고정
  - `email`
  - `phone_number`
  - `resident_registration_number`
  - `api_key`
  - `authorization_header`
  - `jwt`
  - `private_key`
- P0 placeholder 고정
  - `[EMAIL_REDACTED]`
  - `[PHONE_NUMBER_REDACTED]`
  - `[RESIDENT_REGISTRATION_NUMBER_REDACTED]`
  - `[API_KEY_REDACTED]`
  - `[AUTHORIZATION_HEADER_REDACTED]`
  - `[JWT_REDACTED]`
  - `[SECRET_REDACTED]`
- detector type별 P0 action mapping helper 추가
  - `email`, `phone_number`은 `redacted`
  - `resident_registration_number`, `api_key`, `authorization_header`, `jwt`, `private_key`는 `blocked`
  - 알 수 없는 detector type은 known 여부를 `false`로 반환해 조용히 허용되지 않게 했다.

### 2.2 Exact Cache key builder 추가

추가 파일:

```text
apps/gateway-core/internal/domain/cache/cache_key.go
apps/gateway-core/internal/domain/cache/cache_key_test.go
```

구현 내용:

- P0 cache status/type 값 고정
  - `hit`, `miss`, `bypass`, `error`
  - `none`, `exact`, `semantic`
- Exact cache key material 구조 추가
  - `tenantId`
  - `projectId`
  - `applicationId`
  - `selectedProvider`
  - `selectedModel`
  - `securityPolicyVersionId`
  - `routingPolicyVersionId`
  - `normalizedRedactedPrompt`
  - `requestParamsHash`
- redacted prompt normalization helper 추가
  - 앞뒤 공백 제거
  - 연속 whitespace를 단일 space로 정규화
- `BuildExactKey` 추가
  - HMAC-SHA256 기반 key 생성
  - 반환 형식은 `hmac-sha256:<hex>`
  - raw prompt나 redacted prompt 원문을 최종 key string에 노출하지 않음

### 2.3 CacheStore port 추가

추가 파일:

```text
apps/gateway-core/internal/ports/cache_store.go
```

구현 내용:

- Redis 구현체가 나중에 붙을 수 있도록 `CacheStore` interface 추가
  - `GetExact`
  - `SetExact`
- cache lookup 결과와 저장 entry 타입 추가
- Gateway pipeline이 concrete Redis client에 직접 의존하지 않도록 경계만 먼저 만들었다.

### 2.4 Masking stage skeleton 추가

추가 파일:

```text
apps/gateway-core/internal/pipeline/stages/masking/stage.go
```

구현 내용:

- stage name을 `mask_or_block`으로 고정
- masking engine interface 추가
- stage result에 E가 사용할 P0 metadata 포함
  - `maskingAction`
  - `maskingDetectedTypes`
  - `maskingDetectedCount`
  - `redactedPromptPreview`
  - `securityPolicyVersionId`
- block 결과일 때 error metadata 고정
  - `errorCode=sensitive_data_blocked`
  - `errorStage=mask_or_block`

### 2.5 Exact cache stage skeleton 추가

추가 파일:

```text
apps/gateway-core/internal/pipeline/stages/cache/stage.go
```

구현 내용:

- stage name을 `exact_cache_lookup`으로 고정
- cache key builder와 cache store interface 경계 추가
- `maskingAction=blocked`이면 cache lookup을 생략
  - `cacheStatus=bypass`
  - `cacheType=none`
- cache lookup 결과 mapping 고정
  - hit이면 `cacheStatus=hit`, `cacheType=exact`
  - miss이면 `cacheStatus=miss`, `cacheType=exact`
  - 오류이면 `cacheStatus=error`, `cacheType=exact`

## 3. 변경된 파일 목록

새로 생성한 파일:

```text
apps/gateway-core/internal/domain/cache/cache_key.go
apps/gateway-core/internal/domain/cache/cache_key_test.go
apps/gateway-core/internal/domain/masking/types.go
apps/gateway-core/internal/pipeline/stages/cache/stage.go
apps/gateway-core/internal/pipeline/stages/masking/stage.go
apps/gateway-core/internal/ports/cache_store.go
```

수정한 기존 파일:

```text
없음
```

## 4. 계약 변경 여부

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

이번 구현은 `docs/p0/p0-contract.md`, `docs/p0/p0-log-event-payload.md`, `docs/architecture/gateway-flow.md`, `docs/policies/pii-masking-policy.md`에 이미 정의된 P0 계약을 코드 내부 타입과 stage boundary로 옮긴 것이다.

## 5. 새로 맞춰야 하는 역할 간 내부 계약

문서상 새 공개 계약은 없지만, B/C/E와 아래 내부 연결 값은 확인해야 한다.

### C -> D

Cache key 생성을 위해 C가 routing/context 이후 아래 값을 제공해야 한다.

```text
tenantId
projectId
applicationId
selectedProvider
selectedModel
securityPolicyVersionId
routingPolicyVersionId
```

### D -> E

Request Log / Detail / Dashboard 저장을 위해 D가 아래 metadata를 넘긴다.

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

### B/C/D pipeline 순서

아래 순서는 유지해야 한다.

```text
detect sensitive data
-> mask or block
-> decide model route
-> build exact cache key
-> exact cache lookup
-> provider call on cache miss only
```

중요 규칙:

```text
block 요청은 cache lookup과 provider call을 모두 생략한다.
cache key는 raw prompt가 아니라 redacted prompt 기준이다.
cache key material에는 selectedProvider와 selectedModel이 포함된다.
```

## 6. 검증 결과

실행한 테스트:

```powershell
docker compose run --rm -e GO111MODULE=off --workdir /workspace/apps/gateway-core go-toolbox go test ./...
```

결과:

```text
PASS
```

검증된 내용:

- 같은 redacted prompt와 같은 context는 같은 exact cache key를 만든다.
- tenant/project/application/provider/model/policy/prompt가 바뀌면 cache key가 바뀐다.
- 최종 cache key string에 prompt 원문 또는 redacted prompt 원문이 포함되지 않는다.
- block 요청은 cache lookup 대상이 아니다.

보안 scan:

```powershell
rg -n "rawPrompt|rawResponse|fullRequestBody|fullResponseBody|providerApiKey|apiKeyPlaintext|appTokenPlaintext|authorizationHeader|rawProviderErrorBody|maskingSampleRawValue" apps packages .github .env.example docker-compose.yml
rg -n "(sk-|AKIA|BEGIN PRIVATE KEY|Authorization: Bearer|api_key=|xoxb-|ghp_)" apps packages .github .env.example docker-compose.yml
```

결과:

```text
매치 없음
```

## 7. 남은 작업

Day 3 또는 B/C wiring 이후 진행할 작업:

- 실제 detector registry 구현
- email/phone redaction 구현
- api_key/JWT/RRN/private_key/authorization_header block 구현
- Redis 기반 `CacheStore` adapter 구현
- Gateway RequestContext와 stage runner에 masking/cache stage 연결
- cache hit이면 mock provider 호출을 생략하는 provider path 연결
- cache 저장 payload shape 확정
- `RequestParamsHash`에 포함할 content-affecting parameter 범위 확정
- 보안 리뷰 진행

## 8. 리뷰 필요

보안 리뷰 필요:

```text
민감정보 detector/action mapping
redaction placeholder
cache key material
raw prompt 미노출 보장 방식
block 요청의 cache/provider bypass 처리
```

DB/API/Event 리뷰:

```text
필요 없음
```
