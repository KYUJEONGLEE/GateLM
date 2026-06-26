# A Day1 Active Config

## 1. 문서 목적

이 문서는 GateLM P0 Day1에서 A파트가 다른 파트에 제공하는 active runtime config 계약을 정의한다.

2단계 문서가 seed identity를 고정했다면, 이 문서는 Gateway가 요청을 처리할 때 실제로 참조해야 하는 설정 묶음을 고정한다.

```text
Seed Contract -> Active Config -> B/C/D/E 병렬 개발 기준값
```

이 단계에서는 실제 Control Plane API, DB migration, Redis cache를 구현하지 않는다.
대신 각 파트가 같은 값을 가정하고 개발할 수 있도록 문서와 JSON fixture를 제공한다.

---

## 2. Fixture 파일

기계가 읽을 기준 fixture는 아래 파일이다.

```text
docs/p0/a-day1-active-config.fixture.json
```

이 fixture는 나중에 다음 구현물의 기준이 된다.

| 구현 대상 | fixture가 제공하는 기준 |
|---|---|
| Gateway | tenant/project/application 식별값, provider, model, policy hash |
| Security | 마스킹/차단 타입, redaction placeholder |
| Cache | exact cache TTL, cache key material |
| Mock Provider | provider base URL, model catalog |
| Analytics/Dashboard | project, application, pricing, policy metadata |

---

## 3. Active Config 범위

P0 Day1 Active Config는 다음 정보를 포함한다.

```text
tenant
project
application
api key metadata
app token metadata
mock provider connection
model catalog
pricing rules
security policy
routing policy
exact cache policy
Redis key naming guide
consumer usage guide
```

포함하지 않는 정보는 다음과 같다.

```text
API Key 원문
App Token 원문
Provider Key 원문
raw prompt
raw response
실제 DB connection string
실제 외부 provider credential
```

---

## 4. B/C/D/E가 사용하는 방식

### B. Gateway / Mock Provider

- `providerConnections[0].baseUrlInDocker`를 Docker 내부 mock provider 주소로 사용한다.
- `providerConnections[0].baseUrlOnHost`를 host 실행 mock provider 주소로 사용한다.
- `modelCatalog`의 `mock-fast`, `mock-balanced`, `mock-smart`를 모델 목록 응답과 routing 후보로 사용한다.
- Gateway 요청 처리 context에는 `tenantId`, `projectId`, `applicationId`, `apiKeyId`를 포함한다.

### C. Security / Masking

- `policies.security.redactTypes`는 provider 호출 전에 가려야 하는 값이다.
- `policies.security.blockTypes`는 provider 호출 전에 차단해야 하는 값이다.
- 로그에는 `redactedPromptPreview`와 탐지 count만 남긴다.
- 원문 prompt 저장은 하지 않는다.

### D. Cache / Routing

- `policies.cache.mode`가 `exact_only`이면 동일 요청 cache만 우선 구현한다.
- cache key는 `policies.cache.keyMaterial`에 적힌 값들을 정규화한 뒤 hash로 만든다.
- routing은 `model=auto` 요청에서 `routingPolicyHash`와 `routing.rules`를 기준으로 선택한다.

### E. Analytics / Dashboard

- 비용 계산은 `pricingRules`의 micro USD per 1M token 값을 사용한다.
- 로그와 대시보드에는 project/application/provider/model/policy hash를 metadata로 저장한다.
- 원문 prompt/response 대신 redacted preview, token, cost, latency, cache status, routing reason만 보여준다.

---

## 5. 보안 기준

Active Config fixture는 운영 secret 저장소가 아니다.

따라서 아래 기준을 반드시 지킨다.

```text
1. API Key/App Token/Provider Key 원문을 넣지 않는다.
2. key/token은 prefix와 hash placeholder만 넣는다.
3. mock provider도 secretRef만 남기고 credential 원문을 넣지 않는다.
4. raw prompt/raw response를 넣지 않는다.
5. cache key material에는 normalized redacted prompt만 허용한다.
6. 로그 저장 기준은 redacted prompt preview와 metadata 중심으로 둔다.
```

---

## 6. 검증 방법

PowerShell 기준:

```powershell
Test-Path .\docs\p0\a-day1-active-config.md
Test-Path .\docs\p0\a-day1-active-config.fixture.json
Get-Content .\docs\p0\a-day1-active-config.fixture.json -Raw | ConvertFrom-Json | Out-Null
rg -n "tenantId|projectId|applicationId|apiKeyId|appTokenId|providerConnectionId" .\docs\p0\a-day1-active-config*
rg -n "mock-fast|mock-balanced|sec_p0_v1|route_p0_v1|cache_p0_v1" .\docs\p0\a-day1-active-config*
```

검증 포인트:

- fixture JSON이 정상 파싱된다.
- 2단계 seed ID가 누락되지 않았다.
- 실제 secret 원문이 없다.
- raw prompt/raw response 저장을 전제로 하지 않는다.

---

## 7. 완료 기준

- `a-day1-active-config.fixture.json`이 생성되어 있다.
- fixture 안에 tenant/project/application/provider/model/policy/pricing/cache 기준값이 있다.
- B/C/D/E가 실제 DB/API 완성 전에도 이 fixture를 기준으로 개발을 시작할 수 있다.
- 다음 단계인 A 공유 검증에서 각 파트가 필요한 값이 누락되지 않았는지 확인할 수 있다.

---

## 8. 다음 단계

다음 단계는 `[A] 공유 검증`이다.

공유 검증에서는 아래를 확인한다.

- B가 mock provider/model 정보를 충분히 사용할 수 있는가
- C가 security policy와 credential metadata를 충분히 사용할 수 있는가
- D가 cache key material과 routing policy를 충분히 사용할 수 있는가
- E가 dashboard/log 기준 metadata와 pricing 정보를 충분히 사용할 수 있는가
