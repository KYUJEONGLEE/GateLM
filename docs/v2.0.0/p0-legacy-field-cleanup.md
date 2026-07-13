# GateLM v2.0.0 P0 legacy field cleanup

> [!IMPORTANT]
> **문서 상태: Historical cleanup inventory.** 현재 작업은 [`docs/current/README.md`](../current/README.md)에서 시작한다. 현재 legacy 상태는 실제 코드와 타입으로 다시 확인한다.

## 1. 요약

이 문서는 5명 역할별 inventory를 통합한 P0 legacy cleanup 합의 문서다. 기준은 `docs/v2.0.0/contracts.md`이며, 이 문서 자체는 코드/API/DB/schema/fixture 변경이 아니다.

반복해서 나온 핵심 cleanup 주제는 아래다.

- v1/P0의 `status=cache_hit`, `status=error`, `partial_success`, `cacheStatus=bypass`를 v2 `terminalStatus`와 domain outcome으로 분리한다.
- Gateway가 생산한 `domainOutcomes`를 Request Log / Request Detail / Dashboard / metrics / k6가 그대로 소비하게 한다. Observability가 stage outcome을 추측하지 않는다.
- editable `RuntimeConfig`와 published immutable `RuntimeSnapshot`의 naming, provenance, publish/reload 상태를 분리한다.
- `teamId`를 Gateway core identity로 승격하지 않고, 비용/쿼터/대시보드 귀속은 `budgetScopeType/budgetScopeId`로 정리한다.
- Dashboard는 v1 aggregate 필드에서 v2 freshness/query budget, exact cache, fallback, safety/cache/provider/fallback grain으로 이동한다.
- raw prompt/raw response/credential/header/secret/raw provider error body는 API response, DB record, fixture, structured log, metric label에 넣지 않는다.
- `promptHash`, `requestBodyHash`, `cacheKeyHash`, `cacheHitRequestId`, credential ID는 raw 값은 아니지만 high-cardinality/correlation 값이므로 노출 범위와 metrics label 금지를 분리한다.
- Semantic Cache는 v2.0.0 core actual cache 지표와 섞지 않고 evidence track으로 둔다.

P0에서 먼저 정리할 항목은 terminal status/domain outcome normalization, auth failure status, metrics/k6 status label, RuntimeSnapshot/budgetScope provenance bridge, sensitive/hash label guardrail이다.

계약 수정 또는 명확화가 필요한 항목은 `cacheHitRequestId`, credential ID 표시, v1 hash trio의 최종 위치, provenance의 `runtimeState`, `runtimeSnapshotVersion` type, `detectedTypes`/`redactedPromptPreview` 노출 범위, DB table/column rename 전략이다.

defer할 항목은 `p0_llm_invocation_logs` 물리 table rename, ClickHouse/Redpanda/장기 analytics 문서 정리, provider/model metrics cardinality 정책, p0 smoke script archive, Semantic Cache live path 구현이다.

## 2. 통합 cleanup table

| Item | Roles affected | Location | Current meaning | v2 contract mapping | Decision | Priority | Risk | Cleanup PR candidate | Contract/schema impact |
|---|---|---|---|---|---|---|---|---|---|
| `status=cache_hit` terminal status | Web, Gateway, Safety, Observability, k6 | `apps/gateway-core/internal/domain/invocationlog/auth_failure.go`, `apps/gateway-core/internal/http/handlers/chat_completions_handler.go`, `packages/contracts/events/invocation-finished-payload.ts`, `apps/web/src/**`, `scripts/perf/k6-gateway-baseline.js`, `docs/architecture/llm-log-schema.md` | Exact cache hit을 request terminal status로 저장/집계한다. | `terminalStatus=success`, `cache.outcome=hit`, `provider.outcome=not_called` | rename | P0 | High. v2 terminal status enum에 없고 success/cache/provider bypass 의미가 섞인다. | PR-1 | `gateway-stage-outcomes`, `request-detail`, `dashboard-overview` schema는 이미 v2 방향이므로 구현/read model/k6를 맞춘다. |
| `status=error` and auth failure as error | Web, Gateway, Safety, Observability, k6 | `apps/gateway-core/internal/domain/invocationlog/auth_failure.go`, `apps/gateway-core/internal/http/handlers/errors.go`, `apps/gateway-core/internal/domain/metrics/recorder.go`, `docs/architecture/dashboard-metrics.md` | Gateway/provider/auth failure를 `error` bucket으로 묶는다. | 시스템 실패는 `terminalStatus=failed`; invalid API Key/App Token은 `terminalStatus=blocked` + `httpStatus/errorCode` | rename | P0 | High. auth/policy block과 system failure rate가 섞인다. | PR-1 | schema/fixture의 terminal status 값과 맞춰야 한다. |
| `partial_success` status | Observability, Safety, k6 | `docs/architecture/llm-log-schema.md`, `docs/architecture/dashboard-metrics.md` | streaming 일부 실패 또는 fallback 후 응답을 별도 status로 설명한다. | v2 core terminal status에는 없음. fallback/streaming domain outcome으로 설명한다. | remove | P1 | Medium. 오래된 architecture docs가 status taxonomy를 오염시킬 수 있다. | PR-1 | 계약 변경 불필요. 장기 문서 정리 대상이다. |
| `cacheStatus=bypass` | Gateway, Web, Safety, Observability | `apps/gateway-core/internal/pipeline/stages/cache/stage.go`, `apps/gateway-core/internal/domain/invocationlog/auth_failure.go`, `apps/web/src/**`, `docs/architecture/llm-log-schema.md` | cache 미사용, pre-cache stop, disabled, blocked/rate-limited 등을 `bypass` 하나로 표현한다. | v2 cache outcome은 `bypassed`와 `not_used`를 구분한다. | rename | P0 | Medium. safety block, disabled cache, stage 미실행 의미가 뭉친다. | PR-1 | 기존 header/API compatibility가 필요하면 bridge alias를 둔다. |
| Missing explicit `domainOutcomes` in Gateway/log path | Gateway, Observability, Web, Safety | `apps/gateway-core/internal/domain/request`, `apps/gateway-core/internal/pipeline`, `apps/gateway-core/internal/domain/invocationlog`, `packages/contracts/events/invocation-finished-payload.ts` | stage 결과가 개별 status/cache/masking/error field로 흩어져 있다. | Gateway-produced `domainOutcomes.auth/runtime/rateLimit/budget/safety/routing/cache/provider/fallback/streaming/logging` | contract-change-needed | P0 | High. Observability가 outcome을 추측하면 v2 계약과 충돌한다. | PR-1 | 저장/API compatibility shape를 정해야 한다. |
| Metrics label `status=cache_hit/error` | Gateway, Observability, k6 | `apps/gateway-core/internal/domain/metrics/recorder.go`, `apps/gateway-core/internal/http/handlers/*metrics*`, `scripts/perf/k6-gateway-baseline.js` | Prometheus-compatible request metric status label이 v1 status 값을 쓴다. | status label을 유지한다면 v2 `terminalStatus` 값만 사용한다. cache/fallback은 별도 low-cardinality outcome metric/label 후보로 분리한다. | rename | P0 | High. k6와 성능 해석이 v1 status에 고정된다. | PR-1 | metrics label contract에 맞춰 forbidden label guard도 함께 확인한다. |
| Dashboard v1 aggregate fields | Web, Observability, Gateway | `apps/web/src/features/dashboard/components/dashboard-overview.tsx`, `apps/web/src/lib/gateway/live-dashboard-overview.ts`, `apps/gateway-core/internal/http/handlers/invocation_logs_handler.go`, `apps/gateway-core/internal/domain/invocationlog/query_models.go` | `successfulRequests`, `failedRequests`, `cacheHitRequests`, `cacheHitRate`, `statusCounts` 중심 v1 overview. | v2 Dashboard read model: terminal status counts, domain outcome breakdown, `exactCacheHitRate`, freshness, query budget. | rename | P0 | Medium. UI/API가 v2 outcome/freshness/query budget을 숨긴다. | PR-2 | `dashboard-overview.schema.json` 기준으로 read model을 맞춘다. |
| Dashboard latency/error-rate interpretation | Observability, Gateway, Web, k6 | `apps/gateway-core/internal/adapters/invocationlog/postgres/query_reader.go`, `docs/architecture/dashboard-metrics.md`, `apps/web/src/**` | average/p95 latency를 `success/cache_hit/error` 중심으로 집계하고 Gateway/provider latency가 섞인다. | `p95GatewayInternalLatencyMs`, `p95ProviderLatencyMs` 분리. error rate는 system failure만 포함한다. | rename | P0 | Medium. 운영 대시보드가 provider 병목과 Gateway 병목을 구분하지 못한다. | PR-2 | schema는 v2 fields를 가지고 있으므로 query/read model 구현을 맞춘다. |
| `p0_llm_invocation_logs.status` and table naming | Gateway, Observability | `db/migrations/006_create_p0_invocation_logs_fallback.sql`, postgres writer/reader tests | P0 canonical request log table과 `status` column을 사용한다. | logical read model은 `terminalStatus` + domain outcomes. 물리 rename 여부는 DB migration 계약 필요. | defer | P1 | High if rushed. DB migration은 compatibility와 데이터 이관이 필요하다. | none | `contract-change-needed`. 첫 PR에서 물리 table rename은 제외한다. |
| `ActiveRuntimeConfig` / `RuntimeConfig` consumed by Gateway | Control Plane, Gateway, Web, Observability | `apps/control-plane-api/src/modules/runtime-configs/**`, `apps/gateway-core/internal/domain/runtimeconfig/**`, `apps/web/src/features/onboarding/**` | active editable config를 Gateway runtime 입력처럼 표현한다. | Gateway는 published immutable `RuntimeSnapshot`만 소비한다. `RuntimeConfig`는 editable source다. | rename | P0 | High. draft/editable config를 Gateway가 신뢰해도 되는 것처럼 보인다. | PR-2 | RuntimeSnapshot bridge/compat naming이 필요하다. |
| Runtime config table/document publish model | Control Plane, Gateway | `apps/control-plane-api/prisma/schema.prisma`, `apps/control-plane-api/prisma/migrations/**`, `apps/control-plane-api/src/modules/runtime-configs/runtime-configs.service.ts` | `runtime_configs.document`와 `publishState`로 active/draft/superseded를 표현한다. | RuntimeConfig source와 immutable RuntimeSnapshot, active pointer, validation/publish/reload failure를 분리한다. | contract-change-needed | P0 | High. snapshot immutability와 last-known-safe path가 모호해진다. | PR-2 | DB/API 변경 여부를 implementation plan 전에 결정해야 한다. |
| v1 hash trio as primary runtime identity | Control Plane, Gateway, Web, Observability, Safety | `configHash`, `securityPolicyHash`, `routingPolicyHash` in schemas/fixtures/code/UI | v1 runtime/config/policy linkage hash를 primary provenance처럼 사용한다. | v2 primary provenance: `runtimeSnapshotId`, `runtimeSnapshotVersion`, `contentHash`, `runtimeState`, `publishedAt`, `publishedBy`, `gatewayInstanceId`; v1 hashes는 bridge/legacy hash 후보. | contract-change-needed | P0 | Medium. 바로 제거하면 v1 baseline이 깨지고, 계속 primary로 두면 v2 provenance가 약해진다. | PR-2 | `legacyHashes` 또는 provenance compatibility 위치를 확정해야 한다. |
| `runtimeSnapshotVersion` type mismatch | Web, Control Plane, Gateway, Observability | `docs/v2.0.0/schemas/kyumin-frontend-read-model.schema.json`, `docs/v2.0.0/fixtures/kyumin-frontend-read-model.fixture.json`, other v2 schemas | Frontend read model은 string version을 허용하고 fixture도 string을 사용한다. | v2 RuntimeSnapshot version은 integer monotonic version으로 정렬한다. | rename | P0 | Medium. schema 간 validation이 freeze 전에 갈라진다. | PR-2 | Kyumin frontend schema/fixture 수정 후보. 이번 문서에서는 수정하지 않는다. |
| `runtimeState=no_snapshot/not_checked` mixed into provenance | Web, Gateway, Observability | `docs/v2.0.0/schemas/request-detail.schema.json`, `docs/v2.0.0/schemas/kyumin-frontend-read-model.schema.json`, `docs/v2.0.0/contracts.md` | provenance object와 read model/stage outcome이 같은 runtimeState definition을 공유한다. | actual RuntimeSnapshot/GatewayContext provenance는 `snapshot_active`, `last_known_safe_used`, `stale_snapshot_used`; `no_snapshot/not_checked`는 read model/stage outcome 전용. | contract-change-needed | P0 | Medium. `runtimeSnapshot=null`과 `runtimeState=no_snapshot` 의미가 겹친다. | PR-2 | schema definition split 필요 후보. |
| Missing `budgetScopeType/budgetScopeId/resolvedBy` propagation | Gateway, Control Plane, Observability, Web | `apps/gateway-core/internal/domain/request`, `apps/gateway-core/internal/pipeline`, `apps/gateway-core/internal/domain/invocationlog`, dashboard/read model code | v1 request/log는 tenant/project/application 중심이다. | default `application/applicationId/default_application`; override는 RuntimeSnapshot/Control Plane rule만 신뢰한다. | contract-change-needed | P0 | High. 비용/쿼터/대시보드 귀속을 v2 방식으로 설명할 수 없다. | PR-2 | schema/fixture는 budgetScope를 포함한다. Gateway/log propagation 계약 필요. |
| `secretRef` vs `credentialRef` provider credential boundary | Control Plane, Gateway | `apps/control-plane-api/src/modules/provider-connections/**`, `apps/control-plane-api/src/modules/runtime-configs/**`, `db/migrations/004_create_provider_and_models.sql`, `docs/v2.0.0/schemas/provider-catalog.schema.json` | provider secret reference를 DTO/DB/runtime config에 포함한다. | Provider catalog는 `credentialRef` 또는 metadata reference만 포함한다. Provider Key/secret plaintext는 금지한다. | rename | P0 | High. secret storage path가 RuntimeSnapshot/fixture/log/UI로 과노출될 수 있다. | PR-3 | Provider catalog schema wording과 Control Plane DTO naming 정렬 후보. |
| API Key/App Token refs embedded in runtime config document | Control Plane, Gateway, Web | `apps/control-plane-api/src/modules/runtime-configs/dto/runtime-config.dto.ts`, v1 runtime config schema/fixtures | runtime config document가 auth credential lifecycle/read model 일부를 포함한다. | RuntimeSnapshot에는 API Key/App Token/Authorization header/secret plaintext를 포함하지 않는다. Auth result와 runtime policy를 분리한다. | remove | P0 | High. auth/runtime boundary가 섞인다. | PR-3 | Control Plane credential read model과 RuntimeSnapshot body 분리 필요. |
| Credential IDs in Request Detail/Web | Web, Observability, Gateway, Control Plane | `apps/web/src/features/request-logs/components/request-log-detail.tsx`, `apps/web/src/lib/gateway/live-request-detail.ts`, `apps/web/src/lib/gateway/live-request-logs.ts` | Admin detail에 `apiKeyId`, `appTokenId` 같은 credential identifiers를 표시한다. | raw key/token은 금지. credential ID 표시 여부는 Admin read model 후보로 계약 필요. metrics label은 금지. | contract-change-needed | P1 | Medium. identifier는 raw secret은 아니지만 correlation/operational exposure가 있다. | PR-3 | Request Detail schema 최소 필드에는 없음. 허용 여부 결정 필요. |
| `promptHash`, `requestBodyHash`, `cacheKeyHash` visibility | Web, Gateway, Safety, Observability, k6 | `apps/web/src/features/request-logs/components/request-log-detail.tsx`, `apps/gateway-core/internal/**`, `db/migrations/006_create_p0_invocation_logs_fallback.sql`, `docs/v2.0.0/schemas/gateway-request-context.schema.json` | raw 값 대신 hash를 log/debug/cache provenance로 저장/표시한다. | metrics label 금지. Request Detail/API/UI 노출은 별도 read model 계약 필요. | contract-change-needed | P0 | High. high-cardinality/correlation 값이 metrics/Dashboard로 번질 수 있다. | PR-3 | Gateway request context와 Request Detail visibility를 분리해야 한다. |
| `cacheHitRequestId` visibility | Gateway, Observability, Web, Safety | `db/migrations/006_create_p0_invocation_logs_fallback.sql`, `apps/gateway-core/internal/http/handlers/invocation_logs_handler.go`, `docs/v2.0.0/schemas/gateway-stage-outcomes.schema.json`, `apps/web/src/features/request-logs/components/request-log-detail.tsx` | cache hit source request를 detail에서 연결한다. | exact cache provenance 후보. metrics label에는 금지. Request Detail 최소 필드에는 없음. | contract-change-needed | P1 | Medium. request correlation/retention 노출 범위가 불명확하다. | PR-3 | schema에 남길지, detail-only로 제한할지 결정 필요. |
| Safety summary: `maskingAction`, `detectedTypes`, `redactedPromptPreview` | Safety, Web, Gateway, Observability | `docs/v2.0.0/schemas/gateway-stage-outcomes.schema.json`, `docs/v2.0.0/schemas/request-detail.schema.json`, `apps/web/src/**`, `apps/ai-service/**` | safety 표시값과 detector category/preview를 UI/log/evidence에 사용한다. | canonical은 `safety.outcome`; summary fields는 sanitized/RBAC-limited display 후보. raw value/raw offset/raw prompt fragment 금지. | contract-change-needed | P1 | Medium. Employee UI와 Admin/Developer UI 노출 범위가 다르다. | PR-3 | detector category granularity와 preview length/RBAC 확정 필요. |
| Forbidden metrics label guard | Safety, Gateway, Observability, k6 | `scripts/perf/k6-gateway-baseline.js`, `apps/gateway-core/internal/http/handlers/*metrics*`, `apps/gateway-core/internal/domain/metrics/*` | sensitive/high-cardinality labels 부재를 테스트로 확인한다. | MUST NOT label: request/trace IDs, prompt/request/cache hashes, credential IDs, authorization, provider key, raw error detail. | keep | P0 | Low as implemented, High if removed. 방어 테스트다. | PR-3 | `request_body_hash`, `provider_key`, raw error detail 누락 여부를 보강한다. |
| Semantic Cache mixed into actual cache metrics | Safety, Observability, Web, Control Plane | `docs/architecture/dashboard-metrics.md`, `apps/web/src/lib/gateway/live-dashboard-overview.ts`, `docs/v2.0.0/schemas/runtime-snapshot.schema.json` | `cacheHitRate`/saved cost에 semantic cache 언급이 섞인다. | Actual cache 지표는 Exact Cache만. Semantic Cache는 evidence track: would-have-hit/candidate/evaluation 후보. | remove | P0 | Medium. demo/metrics가 실제 provider bypass와 evidence를 혼동한다. | PR-3 | `semanticCacheMode=evidence_only`는 keep. actual dashboard field와 분리. |
| Employee/Demo request header and payload preview | Web, Safety, Gateway | `apps/web/src/features/customer-demo/components/customer-demo-app.tsx`, `apps/web/src/app/api/customer-demo/chat/route.ts`, v1 demo fixtures | Demo UI가 request header/payload/response JSON preview를 보여준다. | Employee UI는 response/requestId/simple status 중심. Admin/Developer만 sanitized metadata를 본다. | remove | P1 | Medium. browser surface에 credential mechanics 또는 prompt/response-shaped content가 노출될 수 있다. | PR-3 | demo scenario 계약 후 UI surface 정리. |
| Provider/model metrics label cardinality | Gateway, Observability, Control Plane | `apps/gateway-core/internal/domain/metrics/recorder.go`, Provider catalog schemas | selected provider/model을 metrics label로 사용할 수 있다. | Provider/Model은 enum 고정 금지. Prometheus label은 low-cardinality catalog label만 허용 후보. | defer | Later | Medium after actual provider. 실제 provider/model 도입 후 cardinality 정책 필요. | none | Actual Provider PR 이후 재검토. |
| p0 smoke scripts and long-term architecture docs | Gateway, Observability, Web | `scripts/dev/p0-*`, `docs/architecture/*` | v1/P0 status/read model 기대값을 smoke/docs에 보존한다. | v2 docs/schema/fixture/contracts 우선. legacy smoke/docs는 archive/defer. | defer | Later | Low. 직접 구현보다 혼선 위험이다. | none | v2 demo scenario 확정 후 정리. |

## 3. 보안 위험 항목

아래 값은 v2.0.0에서 API response, DB record, fixture, structured log, metric label에 평문으로 들어가면 안 된다.

| Risk | Current inventory signal | Required handling |
|---|---|---|
| raw prompt | Web demo payload preview, safety preview, test/evidence fixtures에서 prompt-shaped text가 반복 언급됨 | raw prompt 저장/표시 금지. `redactedPromptPreview`는 sanitized/RBAC-limited 후보로만 유지한다. |
| raw response | Employee/Demo response JSON preview와 provider response-shaped content 위험 | Employee UI는 응답 본문 자체를 사용자에게 보여줄 수 있으나 Request Log/Detail/fixture/metrics에는 raw response를 저장하지 않는다. |
| API Key | Control Plane credential lifecycle, Web onboarding/detail, Gateway auth path | raw key 금지. hash는 credential store 내부에만 두고 API/log/fixture/metrics label에 노출하지 않는다. |
| App Token | Control Plane credential lifecycle, Web Employee Chat boundary, Gateway auth path | raw token을 browser/local fixture/log에 두지 않는다. Web BFF/server-side boundary를 기본으로 둔다. |
| Provider Key | Provider connection/secret reference, Provider catalog | raw provider key 금지. `credentialRef`/metadata reference만 RuntimeSnapshot/Provider Catalog에 연결한다. |
| Authorization header | Gateway auth input, demo header preview, tests | raw header 저장/출력 금지. 테스트에서 쓰는 header 값도 log에는 redacted/synthetic 형태만 허용한다. |
| actual secret | seed/fixture/test marker, provider secret reference | 실제 secret 금지. synthetic placeholder라도 실제 secret처럼 보이지 않게 naming과 위치를 분리한다. |
| raw provider error body | Provider error path, dashboard guidance, error messages | sanitized `errorCode`/low-cardinality reason만 허용. raw provider body/text는 저장/응답/label 금지. |
| high-cardinality metrics label | request/trace IDs, credential IDs, prompt/request/cache hashes, cache source request ID | metrics label 금지. 필요하면 Request Detail/Admin-only read model 후보로 별도 계약한다. |
| hash/detail/error text as metrics label | `promptHash`, `requestBodyHash`, `cacheKeyHash`, raw error detail 후보 | metrics label에는 넣지 않는다. k6/metrics test guard를 유지하고 누락 label을 보강한다. |

## 4. `contracts.md`와 충돌하는 항목

| Conflict | Contract says | Cleanup direction |
|---|---|---|
| `cache_hit` terminal status | `terminalStatus`는 `success/blocked/rate_limited/failed/cancelled`만 사용한다. exact cache hit는 `success`다. | legacy를 정리한다. 계약 변경 불필요. |
| `error` terminal status | 시스템 실패는 `failed`, auth failure는 `blocked` + `httpStatus/errorCode`다. | legacy를 정리한다. 계약 변경 불필요. |
| `partial_success` terminal status | v2 core terminal status에 없다. fallback/streaming outcome으로 설명한다. | legacy docs를 정리한다. 계약 변경 불필요. |
| `cacheStatus=bypass` | cache outcome은 `bypassed`와 `not_used`를 구분한다. | legacy를 rename하고 compatibility alias가 필요한지 구현 PR에서 판단한다. |
| Gateway/Observability가 domain outcome 없이 status만 소비 | Observability는 Gateway가 생산한 outcome을 저장/집계하고 추측하지 않는다. | Gateway-produced domain outcome bridge를 만든다. 저장/API compatibility는 contract-change-needed다. |
| editable `RuntimeConfig`를 Gateway 소비본처럼 표현 | Gateway는 published immutable `RuntimeSnapshot`만 소비한다. | RuntimeConfig/RuntimeSnapshot naming split을 진행한다. DB/API 세부는 contract-change-needed다. |
| `teamId` 또는 client-provided budget scope를 core identity처럼 사용 | core identity는 `tenantId/projectId/applicationId`; 비용/쿼터/대시보드는 resolved `budgetScopeType/budgetScopeId`다. | Gateway/log/dashboard propagation을 정리한다. client-provided scope는 신뢰하지 않는다. |
| RuntimeSnapshot provenance에 `no_snapshot/not_checked` 혼재 | actual provenance는 `snapshot_active/last_known_safe_used/stale_snapshot_used`; `no_snapshot/not_checked`는 read model/stage outcome 전용이다. | schema definition split 또는 null semantics 명확화가 필요하다. |
| Semantic Cache를 actual cache hit/saved cost에 섞음 | Semantic Cache는 v2.0.0 core가 아니라 evidence track이다. | actual Exact Cache metric과 evidence metric을 분리한다. |
| credential/header/secret/hash 값을 metrics label로 사용 가능해 보이는 legacy | metrics label MUST NOT 목록에 포함된다. | metrics guardrail을 유지/확장한다. 계약 변경 불필요. |

## 5. 첫 cleanup PR 후보

### PR-1. Gateway outcome normalization bridge

- 목표:
  - `status=cache_hit`을 `terminalStatus=success + cache.outcome=hit + provider.outcome=not_called`로 정규화한다.
  - `status=error`를 `terminalStatus=failed`로 정규화한다.
  - invalid API Key/App Token은 `terminalStatus=blocked + httpStatus/errorCode`로 분리한다.
  - `cacheStatus=bypass`는 v2 domain outcome에서 `bypassed`/`not_used`로 분리한다.
  - metrics/k6/test expectation의 `status=cache_hit/error`를 v2 terminal status 기준으로 바꾼다.
- 포함 범위:
  - Gateway status mapper/compat layer 후보
  - invocation finished event contract bridge 후보
  - metrics recorder/test/k6 baseline expectation
  - Web read model이 소비할 terminal/domain outcome compatibility
- 제외 범위:
  - DB table/column 물리 rename
  - RuntimeSnapshot live adapter 구현
  - Dashboard 전체 redesign
- 막히는 계약:
  - 기존 DB/API response와 v2 read model을 동시에 유지할 compatibility shape
  - `domainOutcomes` 저장 위치와 event payload bridge 방식
- 영향을 받는 역할:
  - Gateway, Observability, Web, Safety
- 완료 기준:
  - v2 core path에서 terminal status 값이 `success/blocked/rate_limited/failed/cancelled`로만 설명된다.
  - cache hit, fallback success, auth failure, provider failure가 domain outcome으로 구분된다.
  - k6/metrics expectation이 v2 status 해석을 따른다.

### PR-2. RuntimeSnapshot, budget scope, Dashboard read model alignment

- 목표:
  - `ActiveRuntimeConfig`/editable `RuntimeConfig`와 published `RuntimeSnapshot` naming을 분리한다.
  - Request Log/Detail/Dashboard에 RuntimeSnapshot provenance와 resolved budget scope를 연결한다.
  - Dashboard v1 aggregate를 v2 freshness/query budget, exact cache, fallback, latency split, system error rate 기준으로 맞춘다.
  - v1 hash trio는 bridge/legacy field로만 남기고 primary provenance를 RuntimeSnapshot fields로 이동한다.
- 포함 범위:
  - RuntimeSnapshot provenance bridge 후보
  - `budgetScopeType/budgetScopeId/resolvedBy` propagation 후보
  - Dashboard overview/read model field rename 후보
  - `runtimeSnapshotVersion` type 및 `runtimeState` schema split 후보
- 제외 범위:
  - Actual Provider integration
  - RuntimeSnapshot full body 복사
  - `p0_llm_invocation_logs` 물리 table rename
- 막히는 계약:
  - v1 hash trio 최종 위치
  - RuntimeSnapshot table/document/publish model
  - `runtimeState=no_snapshot` 표현 위치
  - Dashboard average latency를 core로 유지할지 여부
- 영향을 받는 역할:
  - Control Plane, Gateway, Observability, Web, Safety
- 완료 기준:
  - Request Detail/Dashboard가 full RuntimeSnapshot이 아니라 provenance만 보여준다.
  - budget scope는 client body가 아니라 RuntimeSnapshot/Control Plane rule로 resolved된 값만 남는다.
  - Dashboard read model이 freshness/query budget을 숨기지 않는다.

### PR-3. Sensitive visibility, metrics guardrail, demo surface cleanup

- 목표:
  - `secretRef`/`credentialRef`, API Key/App Token/Provider Key/Authorization header 경계를 정리한다.
  - `promptHash`, `requestBodyHash`, `cacheKeyHash`, `cacheHitRequestId`, credential IDs의 API/UI/metrics 노출 범위를 분리한다.
  - forbidden metrics label guard를 v2 MUST NOT 목록에 맞춰 보강한다.
  - `maskingAction`, `detectedTypes`, `redactedPromptPreview`의 canonical outcome/display/RBAC 경계를 문서화한다.
  - Employee/Demo request header/payload preview와 Semantic Cache actual metric 혼선을 제거한다.
- 포함 범위:
  - metrics/k6 forbidden label list
  - Control Plane credential reference naming
  - Web Employee/Demo surface cleanup
  - Safety summary visibility contract 후보
  - Semantic Cache evidence-only separation
- 제외 범위:
  - raw prompt/raw response 저장 opt-in
  - Semantic Cache live response path
  - provider/model cardinality policy finalization
- 막히는 계약:
  - credential IDs를 Admin Request Detail에 표시할지 여부
  - `cacheHitRequestId`를 Request Detail에 남길지 여부
  - `detectedTypes`와 `redactedPromptPreview`의 audience별 노출 범위
- 영향을 받는 역할:
  - Control Plane, Web, Safety, Gateway, Observability
- 완료 기준:
  - sensitive/raw/high-cardinality 값이 metrics label/API fixture/log로 새지 않는 guardrail이 명확하다.
  - RuntimeSnapshot/Provider Catalog에는 secret plaintext가 없고 credential reference만 남는다.
  - Semantic Cache evidence가 actual cache hit/saved cost/provider bypass 지표와 분리된다.

## 6. `contract-change-needed` 항목

구현 PR 전에 아래는 계약 또는 schema/fixture 수정 방향을 먼저 확정해야 한다.

- `domainOutcomes`를 기존 invocation log/event/API response에 어떻게 bridge할지.
- `p0_llm_invocation_logs.status` 물리 column rename 여부와 migration strategy.
- `cacheHitRequestId`를 Request Detail에 남길지, exact cache provenance 후보로 별도 명시할지.
- `promptHash`, `requestBodyHash`, `cacheKeyHash`를 Gateway request context/internal log/detail 중 어디까지 허용할지.
- `apiKeyId`, `appTokenId` 같은 credential IDs를 Admin-only Request Detail에 허용할지.
- `configHash`, `securityPolicyHash`, `routingPolicyHash`를 `legacyHashes`로 둘지, RuntimeSnapshot provenance top-level bridge field로 둘지.
- `runtimeSnapshotVersion` type을 모든 v2 schema/fixture에서 integer로 통일할지.
- `runtimeState=no_snapshot/not_checked`를 provenance object에서 제거하고 read model/stage outcome에만 둘지.
- `RuntimeConfig`/`RuntimeSnapshot` DB table/document/publish model을 어떻게 분리할지.
- `budgetScope.resolvedBy`를 GatewayContext/log/detail/dashboard 어디까지 required로 둘지.
- `detectedTypes` category granularity, `redactedPromptPreview` length/RBAC/retention.
- `secretRef`를 `credentialRef`로 rename할 때 API/DB compatibility를 어떻게 유지할지.
- Dashboard average latency를 v2 core field로 유지할지, p95 중심 보조 필드로 둘지.
- provider/model metrics label cardinality 정책.

## 7. schema/fixture 반영 필요 항목

이번 작업에서는 schema/fixture를 수정하지 않는다. 아래는 후속 PR 후보만 기록한다.

- `docs/v2.0.0/schemas/kyumin-frontend-read-model.schema.json`
  - `runtimeSnapshotVersion`을 다른 v2 schema처럼 integer로 맞추는 후보.
  - provenance용 `runtimeState`와 read model/stage outcome용 runtime state definition을 분리하는 후보.
- `docs/v2.0.0/fixtures/kyumin-frontend-read-model.fixture.json`
  - string runtime snapshot version 값을 integer fixture로 맞추는 후보.
- `docs/v2.0.0/schemas/request-detail.schema.json`
  - `runtimeSnapshot=null` path와 `runtimeState=no_snapshot` path의 의미를 분리하는 후보.
  - `cacheHitRequestId`, hash 계열 field를 Request Detail schema에 둘지 계약 후 반영.
- `docs/v2.0.0/schemas/gateway-stage-outcomes.schema.json`
  - `cacheHitRequestId`가 stage outcome provenance인지, detail-only field인지 결정 후 반영.
  - safety summary fields가 raw value/raw offset/raw prompt fragment를 포함하지 않는다는 설명은 유지.
- `docs/v2.0.0/schemas/gateway-request-context.schema.json`
  - `requestBodyHash`/`promptHash`는 internal context 후보로 두되, metrics label/API exposure 금지 설명을 더 명확히 하는 후보.
- `docs/v2.0.0/schemas/provider-catalog.schema.json`
  - `credentialRef`는 keep. Control Plane `secretRef`와 naming bridge를 후속 PR에서 맞춘다.
- `docs/v2.0.0/schemas/dashboard-overview.schema.json`
  - `exactCacheHitRate`, freshness, query budget, p95 split은 keep. v1 `successfulRequests/cacheHitRate/averageLatencyMs` 구현을 schema에 맞춘다.
- `docs/v2.0.0/fixtures/*`
  - 실제 개인정보, 실제 secret, 실제 Authorization header, 실제 Provider Key처럼 보이는 값은 계속 금지한다.
  - Semantic Cache evidence 값은 actual cache hit/saved cost/provider bypass fixture와 섞지 않는다.
