# P0 Legacy Cleanup Inventory - Hyeok

Owner: 재혁님  
Scope: Control Plane / RuntimeConfig / RuntimeSnapshot / credential reference  
Branch: `docs/team-debate-v2`  
Date: 2026-06-29

## 기준

우선순위는 `docs/v2.0.0/contracts.md`를 최상위 기준으로 두었다.

주의: 현재 `contracts.md` 기준 schema/fixture 위치는 아래다.

```text
docs/v2.0.0/schemas/
docs/v2.0.0/fixtures/
```

`docs/v2.0.0/schemas/draft/`와 `docs/v2.0.0/fixtures/draft/`는 현재 브랜치에는 없으며, 더 이상 기준 위치가 아니다.

## 조사 방법

주요 검색:

```text
rg -n "RuntimeConfig|ActiveRuntimeConfig|runtimeConfig|RuntimeSnapshot|runtimeSnapshot|snapshot|activeSnapshot|lastKnownSafe|publish|published|configHash|securityPolicyHash|routingPolicyHash|policyVersion|contentHash|runtimeState" apps db docs/v1.0.0 docs/architecture packages
rg -n "credentialRef|credential_ref|credentialHash|credential_hash|providerKey|provider_key|apiKey|api_key|appToken|app_token|Authorization|secret|secretHash|hashedSecret|keyHash|tokenHash" apps/control-plane-api db docs/v1.0.0 docs/architecture packages
```

## Inventory

| Item | Location | Current meaning | v2 contract mapping | Decision | Risk | Suggested cleanup PR |
|---|---|---|---|---|---|---|
| `ActiveRuntimeConfigResponseDto` | `apps/control-plane-api/src/modules/runtime-configs/dto/runtime-config.dto.ts:393` | Gateway가 소비하는 v1 active runtime config 응답. `schemaVersion=gatelm.active-runtime-config.v1` | v2에서는 Gateway가 editable `RuntimeConfig`가 아니라 published immutable `RuntimeSnapshot`을 소비 | rename | 이름이 계속 `ActiveRuntimeConfig`이면 Gateway live path가 draft/editable 설정을 소비해도 되는 것처럼 보임 | PR-1 RuntimeConfig/RuntimeSnapshot naming split |
| `runtime_configs` table | `apps/control-plane-api/prisma/schema.prisma:173` | draft와 active config를 같은 테이블에서 `publishState`로 구분하고 `document Json`에 runtime document 저장 | v2는 `RuntimeConfig` editable source와 `RuntimeSnapshot` immutable published execution body를 분리. DB가 source of truth, Redis는 active pointer/cache | contract-change-needed | active row 갱신/상태 전이 중심 모델은 immutable snapshot과 active pointer 계약을 흐릴 수 있음 | PR-1 RuntimeConfig/RuntimeSnapshot naming split |
| `configVersion` | `apps/control-plane-api/src/modules/runtime-configs/dto/runtime-config.dto.ts:395`, `apps/control-plane-api/src/modules/runtime-configs/runtime-configs.service.ts:1331` | 문자열 버전. publish 시 `runtime_config_<timestamp>` 생성 | `runtimeSnapshotVersion`은 schema에서 integer. `runtimeSnapshotId`와 함께 provenance 최소 필드 | rename | string config version과 integer snapshot version이 UI/schema/Gateway에서 충돌 가능 | PR-1 RuntimeConfig/RuntimeSnapshot naming split |
| `configHash` | `apps/control-plane-api/src/modules/runtime-configs/dto/runtime-config.dto.ts:396`, `docs/v2.0.0/schemas/runtime-snapshot.schema.json:171` | v1 runtime config 전체 hash | v2 `contentHash`가 primary. `configHash`는 `legacyHashes.configHash`로 연결 | keep | 바로 제거하면 v1 Gateway/Request Detail/fixtures가 깨짐. primary provenance로 계속 쓰면 v2 snapshot 의미가 약해짐 | PR-1 RuntimeConfig/RuntimeSnapshot naming split |
| `securityPolicyHash` / `routingPolicyHash` | `apps/control-plane-api/src/modules/runtime-configs/dto/runtime-config.dto.ts:334`, `:358`; `docs/v2.0.0/schemas/runtime-snapshot.schema.json:190` | v1 safety/routing policy hash | v2에서는 `legacyHashes` 또는 domain policy hash lineage로만 연결. full policy body 복사 금지 | keep | 제거하면 downstream Gateway/Observability 깨짐. 반대로 공식 primary field처럼 남기면 P0 cleanup이 미뤄짐 | PR-1 RuntimeConfig/RuntimeSnapshot naming split |
| `publishState=draft/active/superseded/rolled_back` | `apps/control-plane-api/prisma/schema.prisma:23`, `apps/control-plane-api/src/modules/runtime-configs/dto/runtime-config.dto.ts:18` | RuntimeConfig row 상태 | v2는 validation failed/publish failed/reload failed와 Gateway `runtimeState`를 분리. `lastKnownSafe`는 snapshot 상태가 아니라 Gateway runtime state | contract-change-needed | publish 상태와 runtime 적용 상태가 섞이면 Web/Request Detail이 실패 원인을 잘못 표시할 수 있음 | PR-1 RuntimeConfig/RuntimeSnapshot naming split |
| `getActiveRuntimeConfig` | `apps/control-plane-api/src/modules/runtime-configs/runtime-configs.service.ts:67`; `docs/v1.0.0/fixtures/control-plane-admin-api.fixture.json:278` | applicationId 기준 active config 조회 | v2 active lookup key는 `tenantId/projectId/applicationId`. Gateway는 published RuntimeSnapshot만 조회 | rename | applicationId-only 조회가 tenant/project 경계를 암묵화하고 snapshot lookup key와 어긋날 수 있음 | PR-1 RuntimeConfig/RuntimeSnapshot naming split |
| `toRuntimeConfigDocument` weak validation | `apps/control-plane-api/src/modules/runtime-configs/runtime-configs.service.ts:1252` | JSON object인지 확인 후 `ActiveRuntimeConfigResponseDto`로 cast | v2는 `runtime-snapshot.schema.json`과 fixture 기준 최소 shape 검증 필요 | contract-change-needed | malformed document가 publish되면 Gateway reload 실패/last known safe path를 설명하기 어려움 | PR-1 RuntimeConfig/RuntimeSnapshot naming split |
| `RuntimeConfigProviderDto.secretRef` | `apps/control-plane-api/src/modules/runtime-configs/dto/runtime-config.dto.ts:300`, service `:1126` | provider secret reference를 runtime config provider DTO에 포함 | v2 provider catalog는 `credentialRef` / credential metadata만 연결. Provider key 평문 금지, secret reference 노출 범위는 최소화 | rename | `secretRef`가 RuntimeSnapshot/Request Detail로 흘러가면 secret storage path가 운영 UI/fixture에 과노출될 수 있음 | PR-2 Credential reference/provider catalog cleanup |
| `ProviderConnection.secretRef` API input | `apps/control-plane-api/src/modules/provider-connections/dto/provider-connection.dto.ts:50`, service `:112` | Admin이 provider secret reference를 직접 저장/수정 가능 | v2는 provider credential을 reference/hash metadata로 연결하고 RuntimeSnapshot에는 secret plaintext/Provider Key 금지 | rename | `secretRef` 자체는 평문 secret은 아니지만 external secret path가 로그/API/fixture에 과노출될 수 있음 | PR-2 Credential reference/provider catalog cleanup |
| `provider_connections.secret_ref not null` in SQL migration | `db/migrations/004_create_provider_and_models.sql:10` | P0 provider connection은 `secret_ref` 필수 | v2 mock fallback/evidence provider는 credentialRef가 metadata-only일 수 있음. Prisma는 이미 `secretRef String?` | defer | DB migration과 Prisma schema 의미가 다르고 Mock provider에 가짜 secret ref가 필요해짐 | PR-2 Credential reference/provider catalog cleanup |
| `ProviderConnection.provider` and `model_catalog(provider, model)` | `apps/control-plane-api/prisma/schema.prisma:97`; `db/migrations/004_create_provider_and_models.sql:27` | provider/model을 string data로 저장 | v2도 Provider/Model enum 금지. Provider catalog source of truth는 Control Plane DB | keep | enum 고정 위험은 낮음. 다만 v2 schema는 `providerName`, `adapterType`, `modelName` naming을 사용 | PR-2 Credential reference/provider catalog cleanup |
| `apiKey` / `appToken` embedded in runtime config document | `apps/control-plane-api/src/modules/runtime-configs/dto/runtime-config.dto.ts:408`, `:412`; v1 schema `docs/v1.0.0/schemas/runtime-config.schema.json:91` | active runtime config 안에 API Key/App Token ref/status/prefix/last4 포함 | v2 RuntimeSnapshot에는 API Key/App Token/Authorization header/secret plaintext 포함 금지. Auth result와 snapshot consumption은 분리 | remove | snapshot body가 credential lifecycle/read model까지 포함하면 raw credential 금지 원칙은 지켜도 auth/runtime 경계가 흐려짐 | PR-2 Credential reference/provider catalog cleanup |
| `secretHash` stored in credential tables | `apps/control-plane-api/prisma/schema.prisma:125`, `:152`; `db/migrations/003_create_gateway_credentials.sql:8`, `:37` | API Key/App Token 검증용 hash 저장 | v2에서도 raw key/token 금지. hash는 credential store 내부 값으로 keep 가능. RuntimeSnapshot/fixture/log/metrics에는 노출 금지 | keep | DB 내부 검증 필드로는 필요하지만 metrics label/API response/fixture에 나오면 고위험 | PR-3 Sensitive field guardrail cleanup |
| `FORBIDDEN_RUNTIME_CONFIG_KEYS` | `apps/control-plane-api/src/modules/runtime-configs/runtime-configs.service.ts:45` | runtime config document에 금지할 credential-like key 목록 | v2 MUST NOT 목록: raw prompt/raw response/raw detected value/raw prompt fragment/API Key/App Token/Provider Key/Authorization header/provider raw error body/actual secret | keep | 현재 가드는 유용하지만 v2 금지 목록 전체를 완전히 덮지는 않음 | PR-3 Sensitive field guardrail cleanup |
| `hashing.promptHash`, `requestBodyHash`, `cacheKeyHash` inside runtime config | `apps/control-plane-api/src/modules/runtime-configs/dto/runtime-config.dto.ts:379`; service `:1086` | v1 hashing guidance를 runtime config 응답에 포함 | v2 metrics label에는 `prompt_hash`, `request_body_hash`, `cache_key_hash` 금지. cache/evidence는 raw prompt 없이 normalized redacted prompt 사용 | defer | runtime config 응답에 hashing recipe가 있으면 구현자가 metrics label로 오용할 수 있음 | PR-3 Sensitive field guardrail cleanup |
| P0 seed credential placeholders | `db/seeds/001_seed_p0_demo_data.sql:190`, `:226`, `:267` | synthetic API key/app token hash placeholder와 mock provider secret ref | v2 fixture/seed는 실제 secret/Authorization/Provider Key 금지. synthetic placeholder는 허용 | keep | placeholder 문구는 안전하지만 `local/mock-provider/no-secret-required` 같은 secret-like path가 실제 secret ref로 오해될 수 있음 | PR-3 Sensitive field guardrail cleanup |
| Project metadata policy hashes | `db/seeds/001_seed_p0_demo_data.sql:103` | project metadata에 `securityPolicyHash`, `routingPolicyHash`, `cachePolicyHash` 저장 | v2 RuntimeSnapshot provenance/legacyHashes로 연결해야 함. Project metadata가 source of truth가 되면 안 됨 | remove | 정책 provenance source가 project metadata와 RuntimeSnapshot으로 갈라질 수 있음 | PR-1 RuntimeConfig/RuntimeSnapshot naming split |
| v1 runtime fixture imports in Web | `apps/web/src/lib/fixtures/v1-admin-fixtures.ts:3`, `apps/web/src/lib/gateway/customer-demo-live-model.ts:1` | Web이 v1 runtime config fixture를 읽어 Admin/Demo 모델 구성 | v2 Web은 RuntimeSnapshot provenance/read model fixture를 소비해야 함 | defer | 재혁님 소유는 아니지만 Control Plane 계약 rename 시 Web UI가 깨지는 downstream dependency | PR-1 RuntimeConfig/RuntimeSnapshot naming split |
| `InvocationStatus.cache_hit` downstream event | `packages/contracts/events/invocation-finished-payload.ts:3` | cache hit을 terminal status로 표현 | v2는 `terminalStatus=success`, `cache.outcome=hit`, `provider.outcome=not_called` | defer | 재혁님 직접 소유는 아니지만 RuntimeSnapshot provenance가 log/event와 연결될 때 status 의미 충돌 가능 | PR-3 Sensitive field guardrail cleanup |

## 첫 Cleanup PR 후보

최대 3개만 제안한다.

### PR-1 RuntimeConfig/RuntimeSnapshot naming split

목표:

- Control Plane 문서/DTO/fixture에서 `ActiveRuntimeConfig`와 `RuntimeSnapshot` 경계를 명확히 한다.
- `configVersion/configHash/publishState`가 v2 `runtimeSnapshotId/runtimeSnapshotVersion/contentHash/runtimeState`와 어떻게 연결되는지 정리한다.
- `runtime_configs.document`에 대한 JSON shape validation 지점을 설계한다.
- Project metadata에 남은 policy hash를 RuntimeSnapshot provenance/legacyHashes로 이관할지 판단한다.

범위:

- 코드 수정 전 inventory/계약 PR을 먼저 권장한다.
- 구현 PR에서는 기존 v1 endpoint를 깨지 않도록 adapter/compat layer가 필요하다.

### PR-2 Credential reference/provider catalog cleanup

목표:

- `secretRef`를 v2 Provider Catalog의 `credentialRef` 개념으로 정리한다.
- RuntimeSnapshot/Request Detail/fixture에는 Provider Key, API Key, App Token, Authorization header, secret plaintext가 들어가지 않게 한다.
- `apiKey/appToken` credential ref를 RuntimeSnapshot body에서 제거할지, 별도 Control Plane credential read model로 유지할지 결정한다.
- Prisma와 SQL migration의 `secretRef` nullability 차이를 정리한다.

범위:

- Provider/Model은 enum으로 고정하지 않는다.
- Mock fallback provider는 credential-less 또는 metadata-only credentialRef를 허용할 수 있어야 한다.

### PR-3 Sensitive field guardrail cleanup

목표:

- `FORBIDDEN_RUNTIME_CONFIG_KEYS`를 v2 MUST NOT 목록과 맞춘다.
- `secretHash`, `promptHash`, `requestBodyHash`, `cacheKeyHash`가 API response/log/metrics/fixture로 노출되는 경계를 재확인한다.
- synthetic seed/fixture가 실제 secret처럼 보이지 않게 naming을 정리한다.

범위:

- raw prompt/raw response/raw detected value/raw prompt fragment/API Key/App Token/Provider Key/Authorization header/provider raw error body/actual secret은 모든 문서/fixture/log/metrics에서 금지한다.
- hash 계열은 DB 내부 검증 또는 provenance/evidence 목적과 metrics label 목적을 분리한다.

## 빠른 결론

- 가장 먼저 정리할 것은 `ActiveRuntimeConfig`와 `RuntimeSnapshot`의 naming/ownership 경계다.
- 두 번째는 `secretRef`를 v2 `credentialRef`로 바꾸는 provider catalog 경계다.
- 세 번째는 hash/secret/prompt 계열 필드가 fixture/log/metrics로 새지 않도록 guardrail을 확장하는 것이다.
