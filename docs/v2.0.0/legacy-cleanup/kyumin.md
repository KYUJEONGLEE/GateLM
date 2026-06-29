# P0 Legacy Cleanup Inventory - Kyumin

Owner: 김규민  
Scope: Web / Employee Chat / Dashboard UI / demo fixture  
Branch: `docs/team-debate-v2`

## 기준

- Primary contract: `docs/v2.0.0/contracts.md`
- Compared sources:
  - `docs/v2.0.0/schemas/*.json`
  - `docs/v2.0.0/fixtures/*.json`
  - `docs/v2.0.0/team-debate-contract-prep.md`
  - `apps/web/src/**`
  - `docs/v1.0.0/fixtures/**`
  - `docs/v1.0.0/schemas/**`

## Inventory

| Item | Location | Current meaning | v2 contract mapping | Decision | Risk | Suggested cleanup PR |
|---|---|---|---|---|---|---|
| `InvocationLogRecord.status=cache_hit` | `apps/web/src/lib/fixtures/v1-observability-fixtures.ts:61`, `apps/web/src/features/dashboard/components/dashboard-overview.tsx:15`, `apps/web/src/app/api/customer-demo/chat/route.ts:396` | v1 treats exact cache hit as a terminal status. | v2 says `terminalStatus=success`, `cache.outcome=hit`, `provider.outcome=not_called`. | rename | Dashboard and Request Log can overcount status categories and hide provider bypass reason. | PR 1 - Web outcome model migration |
| `status=error` | `apps/web/src/lib/fixtures/v1-observability-fixtures.ts:61`, `apps/web/src/lib/gateway/live-request-logs.ts:144` | v1 UI status bucket for failed requests. | v2 terminal status is `failed`; domain outcomes carry `provider.error`, `fallback.failed`, or gateway failure reason. | rename | UI language diverges from v2 `terminalStatus`; mixed status names complicate demo explanation. | PR 1 - Web outcome model migration |
| `cacheStatus` and `cacheType` display | `apps/web/src/lib/fixtures/v1-observability-fixtures.ts:46`, `apps/web/src/features/request-logs/components/request-log-table.tsx:76`, `apps/web/src/features/request-logs/components/request-log-detail.tsx:67`, `apps/web/src/features/customer-demo/components/customer-demo-app.tsx:210` | v1 cache fields shown as `cacheType:cacheStatus`. | v2 uses cache domain outcome: `cache.outcome=hit/miss/bypassed/error/not_used`. | rename | `bypass` vs `bypassed` naming drift; cache can look like a top-level result instead of a domain outcome. | PR 1 - Web outcome model migration |
| `requestBodyHash`, `promptHash`, `cacheKeyHash` in Request Detail | `apps/web/src/features/request-logs/components/request-log-detail.tsx:79`, `apps/web/src/features/request-logs/components/request-log-detail.tsx:123`, `apps/web/src/features/request-logs/components/request-log-detail.tsx:124`, `apps/web/src/lib/fixtures/v1-observability-fixtures.ts:38` | v1 sanitized metadata/hashes displayed in admin detail. | v2 Request Detail minimum does not require these fields; metrics labels explicitly forbid `prompt_hash`, `request_body_hash`, `cache_key_hash`. | defer | Not raw values, but high-cardinality/hash-like identifiers can leak correlation material and may be mistaken for metrics-safe fields. | PR 2 - Request Detail provenance cleanup |
| `apiKeyId` and `appTokenId` in Request Detail | `apps/web/src/features/request-logs/components/request-log-detail.tsx:53`, `apps/web/src/features/request-logs/components/request-log-detail.tsx:54`, `apps/web/src/lib/gateway/live-request-logs.ts:84`, `apps/web/src/lib/gateway/live-request-detail.ts:95` | v1 shows credential identifiers or synthetic placeholders. | v2 hides raw token/credential values; Request Detail minimum does not list credential IDs. Metrics labels forbid `api_key_id` and `app_token_id`. | contract-change-needed | ID display may be acceptable for Admin only, but contract must say whether credential IDs are allowed read model fields. | PR 2 - Request Detail provenance cleanup |
| Runtime Config block in onboarding | `apps/web/src/features/onboarding/components/admin-onboarding-flow.tsx:216`, `apps/web/src/lib/fixtures/v1-admin-fixtures.ts:221` | v1 shows `configVersion`, `publishState`, `configHash`, `securityPolicyHash`, `routingPolicyHash`. | v2 splits editable `RuntimeConfig` from published immutable `RuntimeSnapshot`; Request Detail/Dashboard should show snapshot provenance only. | rename | Web UI may imply Gateway consumes editable config directly, which conflicts with v2 snapshot contract. | PR 2 - Request Detail provenance cleanup |
| v1 hash trio as primary runtime identity | `apps/web/src/lib/fixtures/v1-observability-fixtures.ts:5`, `apps/web/src/lib/gateway/live-request-detail.ts:147`, `docs/v2.0.0/contracts.md:165` | `configHash/securityPolicyHash/routingPolicyHash` are v1 runtime metadata and current Web display fields. | v2 minimum provenance is `runtimeSnapshotId`, integer `runtimeSnapshotVersion`, `contentHash`, `runtimeState`, `publishedAt`, `publishedBy`, `gatewayInstanceId`; v1 hashes are bridge fields. | defer | Safe as bridge metadata, but must not remain the primary runtime identity in UI. | PR 2 - Request Detail provenance cleanup |
| `runtimeSnapshotVersion` type in Kyumin read model | `docs/v2.0.0/schemas/kyumin-frontend-read-model.schema.json:184`, `docs/v2.0.0/fixtures/kyumin-frontend-read-model.fixture.json:52` | Frontend schema currently accepts version as string and fixture uses `"v2.0.0-1"`. | Other v2 schemas use integer monotonic version. | rename | Cross-schema validation will diverge before freeze. | PR 2 - Request Detail provenance cleanup |
| `runtimeState` includes read model states in provenance shape | `docs/v2.0.0/schemas/kyumin-frontend-read-model.schema.json:119`, `docs/v2.0.0/schemas/kyumin-frontend-read-model.schema.json:190`, `docs/v2.0.0/contracts.md:200` | Frontend read model allows `no_snapshot` and `not_checked` through the shared `runtimeState` definition. | v2 says actual RuntimeSnapshot/GatewayContext provenance uses `snapshot_active`, `last_known_safe_used`, `stale_snapshot_used`; `no_snapshot` and `not_checked` are stage outcome/read model only. | contract-change-needed | The current shared definition blurs snapshot provenance and runtime domain outcome. | PR 2 - Request Detail provenance cleanup |
| Customer Demo request header preview | `apps/web/src/features/customer-demo/components/customer-demo-app.tsx:198`, `apps/web/src/features/customer-demo/components/customer-demo-app.tsx:413`, `apps/web/src/lib/fixtures/v1-customer-demo-fixtures.ts:133`, `apps/web/src/app/api/customer-demo/chat/route.ts:332` | UI shows request header names and masked/synthetic auth-like values. | v2 Employee Chat must use Web BFF/server-side boundary and must not expose raw App Token or Authorization header values in browser UI/logs. | remove | Even masked headers keep the demo centered on credential mechanics and risk accidental raw header display if sanitization regresses. | PR 3 - Employee Chat demo surface cleanup |
| Customer Demo payload/response preview | `apps/web/src/features/customer-demo/components/customer-demo-app.tsx:199`, `apps/web/src/features/customer-demo/components/customer-demo-app.tsx:220`, `apps/web/src/features/customer-demo/components/customer-demo-app.tsx:435` | UI renders JSON request/response body previews for demo inspection. | v2 Employee UI shows response, requestId, simple status; Admin/Developer detail shows sanitized metadata, not raw prompt/response. | remove | Payload preview can expose prompt-like content or provider response content and conflicts with presentation guidance for Employee Chat. | PR 3 - Employee Chat demo surface cleanup |
| `promptPreview` in demo live model | `apps/web/src/lib/gateway/customer-demo-live-model.ts:23`, `apps/web/src/features/customer-demo/components/customer-demo-app.tsx:153` | Demo scenarios keep prompt-like text for chat preview and Gateway request body. | v2 allows sanitized Employee response/simple status; raw prompt/raw response storage/display is forbidden. Redacted preview requires explicit sanitized contract. | defer | Current values are synthetic, but the field name and UI position can normalize showing prompt text. | PR 3 - Employee Chat demo surface cleanup |
| Dashboard v1 aggregate fields | `apps/web/src/lib/fixtures/v1-observability-fixtures.ts:105`, `apps/web/src/features/dashboard/components/dashboard-overview.tsx:40`, `apps/web/src/lib/gateway/live-dashboard-overview.ts:136` | v1 dashboard uses totals like `successfulRequests`, `failedRequests`, `statusCounts`, `cacheHitRate`. | v2 dashboard has freshness/query budget metadata and terminal/domain outcome breakdowns. | rename | UI can keep presenting v1 aggregates and miss freshness/query budget, which are explicit v2 requirements. | PR 1 - Web outcome model migration |
| Dashboard freshness shape | `apps/web/src/lib/gateway/live-dashboard-overview.ts:170`, `apps/web/src/features/dashboard/components/dashboard-overview.tsx:160`, `docs/v2.0.0/schemas/dashboard-overview.schema.json:74` | v1/live Web uses `recordCount`, `lastLogCreatedAt`, `generatedAt`. | v2 requires `lastIngestedAt`, `lastAggregatedAt`, `source`, `isStale` and query budget state. | rename | Operation UI can hide stale/partial/unavailable states and overpromise live freshness. | PR 1 - Web outcome model migration |
| `integrationMode=fixture/gateway` | `apps/web/src/lib/gateway/customer-demo-client.ts:8`, `apps/web/src/app/(chat)/tenants/[tenantId]/chat/page.tsx:27` | Web switches between local fixture replay and Gateway live mode. | v2 demo can use preset scenario runner, but Employee Chat core path is Application -> Web BFF/server-side -> Gateway. | keep | Keep as evidence/demo toggle, but do not let fixture mode masquerade as v2 Employee Chat live path. | PR 3 - Employee Chat demo surface cleanup |
| `$id` namespace | `docs/v2.0.0/schemas/*.json` | v2 schemas now use `https://gatelm.local/schemas/v2.0.0/...`; v1 schemas use `https://gatelm.local/docs/v1.0.0/...`. | v2 freeze should keep one `$id` convention. | keep | No current v2 conflict after latest pull; just avoid reintroducing `gatelm.dev` or `/docs/` variants. | none |

## Security Exposure Notes

- No actual secret was found in the inventory pass.
- High-risk Web surfaces for future cleanup are request/response JSON preview, request header preview, and visible hash/credential identifiers in Request Detail.
- `promptPreview` values are synthetic today, but the v2 UI should avoid normalizing prompt-body display in Employee Chat.
- Metrics label risk is mostly indirect in Web: fields like `requestId`, `traceId`, credential IDs, prompt/request/cache hashes should not be treated as dashboard metric labels.

## First Cleanup PR Candidates

1. PR 1 - Web outcome model migration
   - Replace `cache_hit` terminal status with `terminalStatus=success` plus cache/provider domain outcomes in Web read models.
   - Rename `error` status display to `failed`.
   - Add v2 freshness/query budget display shape to Dashboard UI.

2. PR 2 - Request Detail provenance cleanup
   - Move Runtime Config display toward RuntimeSnapshot provenance.
   - Align `runtimeSnapshotVersion` to integer in Kyumin frontend schema/fixture.
   - Split actual runtime provenance state from runtime domain outcome states.
   - Hide or defer request/prompt/cache hash and credential ID fields unless contracts explicitly allow them.

3. PR 3 - Employee Chat demo surface cleanup
   - Remove request header preview from Employee/Demo UI.
   - Remove raw-shaped payload/response JSON previews.
   - Keep preset scenario runner, but show requestId, terminal status, domain outcome summary, and sanitized response only.
