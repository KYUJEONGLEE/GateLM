# A Day1 Seed Contract

## 1. 문서 목적

이 문서는 GateLM P0 Day1에서 A파트가 B/C/D/E에 공유할 demo seed 계약을 정의한다.

목표는 실제 Control Plane API나 DB migration을 완성하는 것이 아니라, 각 파트가 같은 seed 값을 기준으로 fixture 기반 개발을 시작할 수 있게 하는 것이다.

```text
A -> B/C/D/E
seed identity
credential metadata
mock provider metadata
model catalog
policy/config hash
```

---

## 2. Seed 계약 원칙

```text
1. 실제 API Key/App Token/Provider Key 원문을 문서에 쓰지 않는다.
2. raw prompt/raw response를 seed나 fixture에 넣지 않는다.
3. Provider와 Model은 enum으로 고정하지 않고 string으로 둔다.
4. DB PK는 UUID 기준으로 구현 가능하게 둔다.
5. 팀 공유용 alias는 사람이 읽기 쉬운 값을 함께 둔다.
6. Day1에는 DB 구현 완료를 기다리지 않고 fixture로 소비 가능해야 한다.
```

원문 key/token은 나중에 seed script 또는 local `.env`에서만 다룬다.

이 문서에는 아래만 기록한다.

```text
id
alias
prefix
hash shape
scope
status
safe metadata
```

---

## 3. Demo Seed ID

### 3.1 Tenant

| Field | Value |
|---|---|
| tenantId | `00000000-0000-4000-8000-000000000100` |
| tenantAlias | `tenant_acme_p0` |
| tenantName | `Acme Corp` |
| tenantSlug | `acme` |
| status | `active` |
| defaultTimezone | `Asia/Seoul` |
| defaultCurrency | `USD` |

### 3.2 Admin User

| Field | Value |
|---|---|
| adminUserId | `00000000-0000-4000-8000-000000000110` |
| email | `admin@example.com` |
| name | `P0 Admin` |
| role | `tenant_admin` |
| status | `active` |

주의:

- `admin@example.com`은 demo용 placeholder다.
- 실제 이메일이나 비밀번호를 문서에 쓰지 않는다.

### 3.3 Tenant Membership

| Field | Value |
|---|---|
| tenantMembershipId | `00000000-0000-4000-8000-000000000120` |
| tenantId | `00000000-0000-4000-8000-000000000100` |
| userId | `00000000-0000-4000-8000-000000000110` |
| role | `tenant_admin` |
| status | `active` |

### 3.4 Project

| Field | Value |
|---|---|
| projectId | `00000000-0000-4000-8000-000000000200` |
| projectAlias | `project_campaign_p0` |
| tenantId | `00000000-0000-4000-8000-000000000100` |
| projectName | `CampaignBot` |
| projectSlug | `campaign-bot` |
| defaultProvider | `mock` |
| defaultModel | `mock-balanced` |
| status | `active` |

### 3.5 Project Membership

| Field | Value |
|---|---|
| projectMembershipId | `00000000-0000-4000-8000-000000000210` |
| tenantId | `00000000-0000-4000-8000-000000000100` |
| projectId | `00000000-0000-4000-8000-000000000200` |
| userId | `00000000-0000-4000-8000-000000000110` |
| role | `project_admin` |
| status | `active` |

### 3.6 Application

| Field | Value |
|---|---|
| applicationId | `00000000-0000-4000-8000-000000000300` |
| applicationAlias | `app_campaign_web_p0` |
| tenantId | `00000000-0000-4000-8000-000000000100` |
| projectId | `00000000-0000-4000-8000-000000000200` |
| applicationName | `CampaignBot Web` |
| applicationSlug | `campaign-web` |
| type | `customer_app` |
| status | `active` |

---

## 4. Credential Metadata

### 4.1 Gateway API Key Metadata

| Field | Value |
|---|---|
| apiKeyId | `00000000-0000-4000-8000-000000000400` |
| tenantId | `00000000-0000-4000-8000-000000000100` |
| projectId | `00000000-0000-4000-8000-000000000200` |
| applicationId | `00000000-0000-4000-8000-000000000300` |
| name | `CampaignBot Gateway Key` |
| keyPrefix | `glm_api_p0_demo` |
| keyHash | `<sha256-or-hmac-hash-of-local-only-api-key>` |
| scopes | `["gateway:chat", "gateway:models"]` |
| status | `active` |

금지:

```text
Gateway API Key 원문을 문서, DB, log, test snapshot에 저장하지 않는다.
```

local-only seed output 예시 이름:

```text
GATELM_DEMO_API_KEY=<local-only value>
```

### 4.2 App Token Metadata

| Field | Value |
|---|---|
| appTokenId | `00000000-0000-4000-8000-000000000500` |
| tenantId | `00000000-0000-4000-8000-000000000100` |
| projectId | `00000000-0000-4000-8000-000000000200` |
| applicationId | `00000000-0000-4000-8000-000000000300` |
| name | `CampaignBot App Token` |
| tokenPrefix | `glm_app_p0_demo` |
| tokenHash | `<sha256-or-hmac-hash-of-local-only-app-token>` |
| scopes | `["app:invoke"]` |
| status | `active` |

금지:

```text
App Token 원문을 문서, DB, log, test snapshot에 저장하지 않는다.
```

local-only seed output 예시 이름:

```text
GATELM_DEMO_APP_TOKEN=<local-only value>
```

---

## 5. Provider Connection

P0는 mock provider를 기준으로 시작한다.

| Field | Value |
|---|---|
| providerConnectionId | `00000000-0000-4000-8000-000000000600` |
| tenantId | `00000000-0000-4000-8000-000000000100` |
| projectId | `00000000-0000-4000-8000-000000000200` |
| name | `P0 Mock Provider` |
| provider | `mock` |
| baseUrlInDocker | `http://mock-provider:8090` |
| baseUrlOnHost | `http://localhost:8090` |
| defaultModel | `mock-balanced` |
| secretRef | `local/mock-provider/no-secret-required` |
| credentialPreview | `mock-provider` |
| status | `active` |

주의:

- mock provider는 실제 Provider Key가 필요 없다.
- `secretRef`는 SecretResolver interface 흐름을 맞추기 위한 안전한 placeholder다.
- 실제 Provider Key를 문서에 쓰지 않는다.

---

## 6. Model Catalog

P0 model catalog는 최소 `mock-fast`, `mock-balanced`를 포함한다.

| modelId | provider | model | displayName | purpose | status |
|---|---|---|---|---|---|
| `00000000-0000-4000-8000-000000000701` | `mock` | `mock-fast` | `Mock Fast` | low-cost / short prompt | `active` |
| `00000000-0000-4000-8000-000000000702` | `mock` | `mock-balanced` | `Mock Balanced` | default model | `active` |
| `00000000-0000-4000-8000-000000000703` | `mock` | `mock-smart` | `Mock Smart` | optional high-quality demo | `active` |

P0 routing 기본값:

```text
model=auto
-> 짧은 prompt: mock-fast
-> 기본값: mock-balanced
```

`mock-smart`는 Day1 필수 routing 대상은 아니며, demo에서 고성능 모델 구분이 필요할 때 사용할 수 있는 optional model이다.

---

## 7. Pricing Rules

비용은 float가 아니라 micro USD integer 기준으로 계산한다.

| pricingRuleId | provider | model | inputMicroUsdPer1MTokens | outputMicroUsdPer1MTokens | pricingVersion |
|---|---|---|---:|---:|---|
| `00000000-0000-4000-8000-000000000801` | `mock` | `mock-fast` | `100000` | `400000` | `p0-demo` |
| `00000000-0000-4000-8000-000000000802` | `mock` | `mock-balanced` | `300000` | `800000` | `p0-demo` |
| `00000000-0000-4000-8000-000000000803` | `mock` | `mock-smart` | `1000000` | `3000000` | `p0-demo` |

설명:

- `100000 micro USD = 0.1 USD`
- P0에서는 mock usage 기반 예상 비용 계산을 허용한다.
- Dashboard/Request Log는 `costMicroUsd`를 canonical value로 사용한다.

---

## 8. Policy / Config Hash

Day1에는 복잡한 정책 엔진을 만들지 않는다.

대신 cache key와 log metadata에 넣을 config hash를 고정한다.

| Field | Value | 소비 역할 |
|---|---|---|
| securityPolicyHash | `sec_p0_v1` | D, E |
| routingPolicyHash | `route_p0_v1` | C, D, E |
| cachePolicyHash | `cache_p0_v1` | D |
| pricingVersion | `p0-demo` | B, E |

주의:

- 이 값들은 실제 hash 알고리즘 결과가 아니라 Day1 fixture version string이다.
- 실제 config hash 계산은 Active Config 또는 구현 단계에서 확정한다.

---

## 9. B/C/D/E 소비 기준

### B가 사용할 값

```text
provider=mock
providerConnectionId=00000000-0000-4000-8000-000000000600
baseUrlInDocker=http://mock-provider:8090
modelCatalog=[mock-fast, mock-balanced, mock-smart]
defaultModel=mock-balanced
pricingVersion=p0-demo
```

### C가 사용할 값

```text
apiKeyId=00000000-0000-4000-8000-000000000400
appTokenId=00000000-0000-4000-8000-000000000500
tenantId=00000000-0000-4000-8000-000000000100
projectId=00000000-0000-4000-8000-000000000200
applicationId=00000000-0000-4000-8000-000000000300
routingPolicyHash=route_p0_v1
```

### D가 사용할 값

```text
tenantId=00000000-0000-4000-8000-000000000100
projectId=00000000-0000-4000-8000-000000000200
applicationId=00000000-0000-4000-8000-000000000300
securityPolicyHash=sec_p0_v1
routingPolicyHash=route_p0_v1
cachePolicyHash=cache_p0_v1
```

### E가 사용할 값

```text
tenantId=00000000-0000-4000-8000-000000000100
projectId=00000000-0000-4000-8000-000000000200
applicationId=00000000-0000-4000-8000-000000000300
apiKeyId=00000000-0000-4000-8000-000000000400
appTokenId=00000000-0000-4000-8000-000000000500
providerConnectionId=00000000-0000-4000-8000-000000000600
adminUserId=00000000-0000-4000-8000-000000000110
```

---

## 10. Seed Contract JSON Preview

이 JSON은 Day1 계약 확인용 preview다. 실제 active config fixture는 다음 단계에서 별도 작성한다.

```json
{
  "tenantId": "00000000-0000-4000-8000-000000000100",
  "projectId": "00000000-0000-4000-8000-000000000200",
  "applicationId": "00000000-0000-4000-8000-000000000300",
  "apiKeyId": "00000000-0000-4000-8000-000000000400",
  "appTokenId": "00000000-0000-4000-8000-000000000500",
  "providerConnectionId": "00000000-0000-4000-8000-000000000600",
  "provider": "mock",
  "defaultModel": "mock-balanced",
  "securityPolicyHash": "sec_p0_v1",
  "routingPolicyHash": "route_p0_v1",
  "cachePolicyHash": "cache_p0_v1",
  "pricingVersion": "p0-demo"
}
```

---

## 11. 보안 금지 기준

이 문서와 이후 seed/fixture에서 아래 값을 저장하지 않는다.

```text
raw prompt
raw response
Gateway API Key 원문
App Token 원문
Provider Key 원문
Authorization header 원문
Cookie 원문
raw provider error body
raw detected sensitive value
실제 secret
실제 개인정보
```

저장 가능한 값:

```text
keyPrefix
tokenPrefix
keyHash
tokenHash
credentialPreview
secretRef
requestId
tenantId
projectId
applicationId
apiKeyId
appTokenId
providerConnectionId
model metadata
policy hash
config hash
```

---

## 12. 완료 기준

```text
[ ] tenant/project/application seed ID가 고정되어 있다.
[ ] API Key/App Token metadata가 원문 없이 정의되어 있다.
[ ] mock provider connection이 정의되어 있다.
[ ] mock model catalog가 정의되어 있다.
[ ] pricing rule이 micro USD 기준으로 정의되어 있다.
[ ] security/routing/cache policy hash가 정의되어 있다.
[ ] B/C/D/E가 소비할 값이 역할별로 정리되어 있다.
[ ] 다음 단계인 Active Config fixture 작성으로 넘어갈 수 있다.
```

---

## 13. 다음 단계

다음 작업은 `[A] Active Config`다.

다음 단계에서는 이 seed 계약을 바탕으로 Gateway가 직접 읽을 수 있는 JSON fixture를 작성한다.
