# A Day1 Scope - Control Plane / DB / Runtime Config

## 1. 문서 목적

이 문서는 GateLM P0 Day1에서 A파트가 맡을 범위와 맡지 않을 범위를 정리한다.

A파트의 Day1 목표는 Control Plane 전체 구현이 아니다. B/C/D/E가 막히지 않도록 Gateway가 사용할 demo seed와 active config 계약을 먼저 고정하는 것이다.

```text
A는 Gateway가 읽을 데이터를 만든다.
B는 Gateway 요청/응답의 뼈대를 책임진다.
C는 요청 주체와 모델 선택을 확정한다.
D는 Provider 호출 전에 보안과 캐시를 적용한다.
E는 결과를 사람이 확인할 수 있게 만든다.
```

---

## 2. 참조 문서

이 범위는 아래 문서를 기준으로 정리했다.

```text
docs/README.md
docs/p0/team-workplan.md
docs/p0/p0-db-migration-plan.md
docs/architecture/db-schema.md
docs/architecture/api-spec.md
```

문서끼리 충돌하면 P0 문서를 우선한다.

우선순위:

```text
1. docs/p0/p0-contract.md
2. docs/p0/implementation-cut.md
3. docs/p0/team-workplan.md
4. docs/p0/p0-db-migration-plan.md
5. docs/architecture/api-spec.md
6. docs/architecture/db-schema.md
```

---

## 3. A파트 Day1 핵심 책임

A는 Day1에 아래 항목을 확정하거나 fixture로 제공한다.

| 항목 | Day1 산출 형태 | 소비 역할 | 목적 |
|---|---|---|---|
| tenant | seed id / fixture | C, E | 요청 scope, 로그 scope |
| project | seed id / fixture | C, D, E | 인증, 캐시, 로그 기준 |
| application | seed id / fixture | C, E | App Token 검증, 로그 기준 |
| admin user | seed id / fixture | A, E | local admin 또는 seed owner |
| tenant membership | seed relation | A, E | 관리자 권한 확인 |
| project membership | seed relation | A, E | project scope 확인 |
| API Key metadata | key id, prefix, hash shape | C, E | Gateway API Key 인증 |
| App Token metadata | token id, prefix, hash shape | C, E | Application 접근 검증 |
| provider connection | mock provider metadata | B, C | Provider 호출 대상 |
| model catalog | mock model list | B, C | `/v1/models`, routing 후보 |
| pricing rule | mock pricing metadata | B, E | costMicroUsd 계산 |
| security policy hash | fixture string | D, E | masking/cache 기록 기준 |
| routing policy hash | fixture string | C, D, E | routing/cache 기록 기준 |
| active config | JSON fixture | B, C, D | Gateway runtime config |

Day1의 핵심 완료 기준:

```text
Gateway가 seed 데이터만으로도 인증, 식별, routing, cache, log를 수행할 수 있다.
```

---

## 4. A가 Day1에 만들 Seed / Config 항목

### 4.1 Identity / Scope

Day1에는 최소 하나의 demo tenant, project, application을 제공한다.

필요 항목:

```text
tenantId
tenantName
projectId
projectName
applicationId
applicationName
adminUserId
adminEmail
```

주의:

- 실제 이메일을 쓰지 않는다.
- demo 값은 `example.com`, `example.invalid` 같은 안전한 도메인을 사용한다.
- DB PK는 장기적으로 uuid 기준이지만, 팀 간 공유 fixture에는 읽기 쉬운 opaque id를 사용할 수 있다.

### 4.2 Credential Metadata

Day1에는 API Key와 App Token의 원문을 저장하지 않는다.

제공해야 하는 정보:

```text
apiKeyId
apiKeyPrefix
apiKeyHash shape
apiKeyScopes
apiKeyStatus
appTokenId
appTokenPrefix
appTokenHash shape
appTokenScopes
appTokenStatus
```

금지:

```text
api_key_plaintext
app_token_plaintext
provider_api_key_plaintext
Authorization header 원문
```

원문 key/token은 생성 응답 또는 seed output에서 local only로 1회 확인 가능하지만, Day1 범위 확인 문서에는 실제 값을 적지 않는다.

### 4.3 Provider / Model

P0는 mock provider를 기준으로 시작한다.

필요 항목:

```text
providerConnectionId
provider
providerBaseUrl
secretRef
defaultModel
modelCatalog
modelPricingRules
```

최소 model catalog:

```text
mock-fast
mock-balanced
mock-smart
```

P0 team-workplan 기준 최소값은 `mock-fast`, `mock-balanced`이다. `mock-smart`는 demo에서 고성능 모델 구분이 필요할 때 사용할 수 있는 확장 후보로 둔다.

### 4.4 Active Config

Active Config는 Gateway가 요청 처리 중 읽는 runtime 설정이다.

Day1에는 DB 구현 완료를 기다리지 않고 JSON fixture로 먼저 제공할 수 있다.

포함해야 하는 개념:

```text
tenantId
projectId
applicationId
apiKeyId
appTokenId
providerConnections
modelCatalog
defaultProvider
defaultModel
securityPolicyHash
routingPolicyHash
cachePolicyHash
pricingVersion
```

---

## 5. A가 Day1에 만들지 않을 것

Day1 A는 아래를 구현하지 않는다.

### 5.1 Gateway 로직

```text
/v1/chat/completions handler
/v1/models handler
API Key 인증 stage
App Token 검증 stage
model=auto routing stage
masking/block detector
exact cache lookup/write
Provider adapter
OpenAI-compatible response 변환
```

### 5.2 Web / Dashboard

```text
Web Console 화면
Request Log 화면
Dashboard 화면
Chat UI
Traffic simulator
```

### 5.3 P0 제외 또는 후순위 DB/API

```text
groups
group_memberships
tenant_invitations
runtime_policies
runtime_policy_versions
policy_bindings
routing_rules
sensitive_data_rules
quota_rules
budget_policies
rate_limit_rules
budget_ledger_entries
conversations
chat_messages
outbox_events
alert_rules
alert_events
webhook_endpoints
```

### 5.4 보안상 금지

```text
raw prompt 저장
raw response 저장
API Key 평문 저장
App Token 평문 저장
Provider Key 평문 저장
Authorization header 로그 출력
Provider raw error body 저장
cache key에 raw prompt 사용
실제 secret이나 개인정보를 seed/test/snapshot에 사용
```

---

## 6. 역할별 A 산출물 소비 방식

### 6.1 B - Gateway Core / Provider Adapter

B가 A에게 필요한 것:

```text
mock provider base URL
provider connection id
provider string
model catalog
default provider/model
allowed model 목록
pricing metadata
```

B는 이 값을 사용해 `/v1/models`와 mock provider 호출 흐름을 만든다.

### 6.2 C - Auth / Context / Simple Routing

C가 A에게 필요한 것:

```text
apiKeyId
apiKeyHash 검증 기준
appTokenId
appTokenHash 검증 기준
tenantId
projectId
applicationId
model catalog
routing policy hash
```

C는 이 값을 사용해 요청 주체를 식별하고 `requestedModel`과 `selectedModel`을 분리한다.

### 6.3 D - Security / Exact Cache

D가 A에게 필요한 것:

```text
tenantId
projectId
applicationId
selectedProvider
selectedModel
securityPolicyHash
routingPolicyHash
cachePolicyHash
```

D는 이 값을 cache key material에 포함한다.

cache key는 raw prompt가 아니라 redacted prompt 기준이어야 한다.

### 6.4 E - Observability / Web Console / Demo Flow

E가 A에게 필요한 것:

```text
tenantId
projectId
applicationId
apiKeyId
appTokenId
providerConnectionId
model catalog
admin user id
```

E는 이 값을 request log, request detail, dashboard scope에 사용한다.

---

## 7. Day1 A 완료 기준

A Day1 1단계 범위 확인은 아래를 만족하면 완료다.

```text
[ ] A가 만들 seed/config 항목 목록이 정리되어 있다.
[ ] A가 만들지 않을 API/DB/Event/로직 목록이 정리되어 있다.
[ ] B/C/D/E가 어떤 값을 소비하는지 정리되어 있다.
[ ] API Key/App Token/Provider Key 원문 저장 금지가 명시되어 있다.
[ ] raw prompt/raw response 저장 금지가 명시되어 있다.
[ ] 다음 단계인 Seed 계약 작성으로 넘어갈 수 있다.
```

---

## 8. 다음 단계

다음 작업은 `[A] Seed 계약`이다.

다음 단계에서 정할 값:

```text
tenantId
projectId
applicationId
apiKeyId
appTokenId
providerConnectionId
modelCatalog
securityPolicyHash
routingPolicyHash
cachePolicyHash
```
