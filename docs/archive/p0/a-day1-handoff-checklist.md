# A Day1 Handoff Checklist

## 1. 목적

이 문서는 A파트 Day1 산출물을 B/C/D/E가 바로 사용할 수 있는지 검증하기 위한 handoff checklist다.

A파트의 Day1 목표는 실제 Control Plane API나 DB migration을 완성하는 것이 아니라, 병렬 개발에 필요한 공통 기준값을 먼저 고정하는 것이다.

```text
A 산출물 -> B/C/D/E 병렬 개발 기준
```

---

## 2. A Day1 산출물

| 파일 | 역할 |
|---|---|
| `docs/p0/a-day1-scope.md` | A가 맡는 범위와 맡지 않는 범위 정리 |
| `docs/p0/a-day1-seed-contract.md` | tenant/project/application/key/token/provider/model seed 계약 |
| `docs/p0/a-day1-active-config.md` | active runtime config 설명 문서 |
| `docs/p0/a-day1-active-config.fixture.json` | 각 파트가 읽을 수 있는 JSON fixture |

---

## 3. 공통 기준

모든 파트는 아래 값을 같은 기준으로 사용한다.

| 항목 | 값 |
|---|---|
| tenantId | `00000000-0000-4000-8000-000000000100` |
| tenantName | `Acme Corp` |
| projectId | `00000000-0000-4000-8000-000000000200` |
| projectName | `CampaignBot` |
| applicationId | `00000000-0000-4000-8000-000000000300` |
| applicationName | `CampaignBot Web` |
| provider | `mock` |
| defaultModel | `mock-balanced` |
| lowCostModel | `mock-fast` |
| highQualityModel | `mock-smart` |
| securityPolicyHash | `sec_p0_v1` |
| routingPolicyHash | `route_p0_v1` |
| cachePolicyHash | `cache_p0_v1` |
| pricingVersion | `p0-demo` |

---

## 4. 파트별 Handoff

### B. Gateway / Mock Provider

읽을 파일:

```text
docs/p0/a-day1-active-config.fixture.json
docs/p0/p0-contract.md
docs/p0/mock-provider.md
```

사용할 값:

- `providerConnections[0].baseUrlInDocker`
- `providerConnections[0].baseUrlOnHost`
- `providerConnections[0].defaultModel`
- `modelCatalog`
- `pricingRules`
- `requestContextShape.required`

검증 질문:

- Gateway가 `mock-balanced`, `mock-fast`, `mock-smart` 모델명을 그대로 사용할 수 있는가
- Docker 내부 호출과 host 호출 주소를 구분할 수 있는가
- 요청 context에 tenant/project/application/apiKey 정보를 실을 수 있는가

완료 기준:

- Mock Provider 호출 시 fixture의 provider/model 값을 기준으로 요청을 만들 수 있다.
- 모델 목록 API 또는 내부 모델 목록이 fixture와 어긋나지 않는다.

---

### C. Security / Auth / Masking

읽을 파일:

```text
docs/p0/a-day1-seed-contract.md
docs/p0/a-day1-active-config.fixture.json
docs/p0/p0-contract.md
```

사용할 값:

- `credentials.apiKey`
- `credentials.appToken`
- `policies.security.redactTypes`
- `policies.security.blockTypes`
- `policies.security.redactionPlaceholders`
- `policies.security.logStorage`

검증 질문:

- API Key와 App Token 원문 없이 prefix/hash metadata만으로 인증 구현을 시작할 수 있는가
- redact 대상과 block 대상이 분리되어 있는가
- 로그에는 원문 prompt/response를 저장하지 않는 기준이 명확한가

완료 기준:

- 인증 결과가 request context에 `apiKeyId`, `tenantId`, `projectId`, `applicationId`를 채울 수 있다.
- 마스킹 결과가 redacted preview와 detection count 형태로 다음 단계에 전달될 수 있다.

---

### D. Cache / Routing

읽을 파일:

```text
docs/p0/a-day1-active-config.fixture.json
docs/p0/p0-contract.md
```

사용할 값:

- `policies.routing`
- `policies.cache`
- `redisKeys.exactCache`
- `redisKeys.projectConfig`
- `pricingRules`

검증 질문:

- `model=auto` 요청에서 fixture의 routing rule을 기준으로 모델을 선택할 수 있는가
- exact cache key material에 tenant/project/application/model/policy hash가 모두 포함되어 있는가
- semantic cache는 P0에서 꺼져 있다는 점이 명확한가

완료 기준:

- 동일 요청 cache key를 fixture 기준으로 계산할 수 있다.
- cache hit 시 provider 호출을 생략하고 token/cost saving metadata를 만들 수 있다.

---

### E. Analytics / Dashboard

읽을 파일:

```text
docs/p0/a-day1-active-config.fixture.json
docs/p0/p0-log-event-payload.md
docs/p0/demo-acceptance.md
```

사용할 값:

- `tenant`
- `project`
- `application`
- `providerConnections`
- `modelCatalog`
- `pricingRules`
- `policies.*PolicyHash`

검증 질문:

- 로그 목록과 상세 화면에 표시할 tenant/project/model/policy metadata가 충분한가
- 비용 계산에 필요한 pricing rule이 있는가
- raw prompt/response 없이도 대시보드와 로그 상세를 구성할 수 있는가

완료 기준:

- 대시보드 mock data 또는 API response가 fixture의 tenant/project/model 이름과 일치한다.
- 로그 상세에서 policy hash, routing reason, cache status, token/cost/latency를 같은 기준으로 보여줄 수 있다.

---

## 5. 금지 사항

아래 값은 어떤 파트도 문서, fixture, test snapshot, log에 추가하지 않는다.

```text
API Key 원문
App Token 원문
Provider Key 원문
raw prompt
raw response
실제 고객 개인정보
실제 provider credential
```

필요한 경우에는 다음 형태만 사용한다.

```text
keyPrefix
tokenPrefix
hash placeholder
redacted prompt preview
detection count
safe metadata
```

---

## 6. A파트 Day1 검증 명령

PowerShell 기준:

```powershell
Test-Path .\docs\p0\a-day1-scope.md
Test-Path .\docs\p0\a-day1-seed-contract.md
Test-Path .\docs\p0\a-day1-active-config.md
Test-Path .\docs\p0\a-day1-active-config.fixture.json
Test-Path .\docs\p0\a-day1-handoff-checklist.md
Get-Content .\docs\p0\a-day1-active-config.fixture.json -Raw | ConvertFrom-Json | Out-Null
rg -n "tenantId|projectId|applicationId|apiKeyId|appTokenId|providerConnectionId" .\docs\p0\a-day1-*
rg -n "mock-fast|mock-balanced|sec_p0_v1|route_p0_v1|cache_p0_v1" .\docs\p0\a-day1-*
```

---

## 7. 다음 단계

A파트 다음 구현 후보는 아래 순서다.

1. Control DB migration 초안
2. seed script 작성
3. active config 조회 API 또는 fixture loader
4. API Key/App Token hash 검증용 repository/service

단, 위 작업을 시작하기 전에 B/C/D/E가 현재 fixture로 개발을 시작할 수 있는지 먼저 확인한다.
