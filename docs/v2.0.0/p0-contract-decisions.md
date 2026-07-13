# GateLM v2.0.0 P0 contract decisions draft

> [!IMPORTANT]
> **문서 상태: Historical draft.** 현재 작업은 [`docs/current/README.md`](../current/README.md)에서 시작한다. 이 문서의 후보 표현은 current 계약이나 schema field가 아니다.

## 1. Summary

이 문서는 `docs/v2.0.0/p0-legacy-field-cleanup.md`의 `contract-change-needed` 항목을 팀 리뷰용 결정안으로 정리한다.

주의:

- 이 문서는 공식 계약이 아니다.
- `recommended decision`, `contract candidate`, `schema impact candidate`, `implementation impact candidate`는 팀 합의 전 후보 표현이다.
- `docs/v2.0.0/contracts.md`를 수정하기 전 검토 목록으로만 사용한다.

P0 전에 반드시 결정해야 하는 항목:

- 기존 invocation log/event/API response와 v2 `terminalStatus + domainOutcomes` bridge 방식
- hash 계열 field의 허용 위치와 metrics/API/UI 노출 금지 경계
- RuntimeSnapshot provenance에서 v1 hash trio의 위치
- `runtimeSnapshotVersion` type 통일
- `runtimeState=no_snapshot/not_checked`의 provenance 제외 여부
- RuntimeConfig/RuntimeSnapshot DB/document/publish model 분리 방향
- `budgetScope.resolvedBy` required 범위
- `secretRef` to `credentialRef` compatibility 방향

P1 또는 Later로 미룰 수 있는 항목:

- `cacheHitRequestId`를 detail-only provenance로 남길지 여부
- `apiKeyId/appTokenId` Admin-only 표시 여부
- `detectedTypes`, `redactedPromptPreview`의 audience별 세부 노출 정책
- Dashboard average latency의 core/read model 보조 필드 여부
- provider/model metrics label cardinality 정책
- `p0_llm_invocation_logs.status` 물리 column/table rename 여부

`contracts.md` 수정 후보:

- `domainOutcomes` bridge and compatibility rule clarification
- hash/credential ID visibility boundary clarification
- `legacyHashes` placement for v1 hash trio
- RuntimeSnapshot provenance/runtime outcome state split
- RuntimeConfig/RuntimeSnapshot storage and publish model clarification
- budget scope `resolvedBy` propagation requirement

schema/fixture 수정 후보:

- `kyumin-frontend-read-model`의 `runtimeSnapshotVersion` integer alignment
- provenance runtime state definition과 read model/stage outcome state definition split
- Request Detail/Gateway Stage Outcomes의 `cacheHitRequestId` 위치 결정
- Gateway Request Context hash field 설명 보강
- Provider Catalog `credentialRef` naming bridge 설명

## 2. Decision Table

| ID | Topic | Current ambiguity | Recommended decision | Priority | Contract impact | Schema/fixture impact | Implementation impact | Owner roles | Notes |
|---|---|---|---|---|---|---|---|---|---|
| DEC-001 | `domainOutcomes` bridge | v1 log/event/API는 `status`, `cacheStatus`, `maskingAction` 중심이고 v2는 `terminalStatus + domainOutcomes` 중심이다. | recommended decision: Gateway-produced `terminalStatus + domainOutcomes`를 canonical으로 두고, legacy `status/cacheStatus`는 compatibility mapper에서만 제공한다. Observability는 추측하지 않는다. | P0 | clarify | gateway-stage-outcomes/request-detail fixtures align candidate | mapper, event payload bridge, read model compatibility 필요 | Gateway, Observability, Web, Safety | DB physical rename은 포함하지 않는다. |
| DEC-002 | `cacheHitRequestId` visibility | cache hit source request id를 Request Detail에 남길지, 제거할지, stage outcome에 둘지 불명확하다. | recommended decision: P0 core에서는 required로 만들지 않는다. 필요하면 Admin-only Request Detail의 detail-only provenance candidate로 nullable 유지하고 metrics/dashboard labels에는 금지한다. | P1 | clarify | gateway-stage-outcomes/request-detail 위치 결정 candidate | detail API compatibility와 RBAC/retention 검토 필요 | Gateway, Observability, Web, Safety | P0 cleanup PR에서 제거/승격을 결정하지 않는다. |
| DEC-003 | `promptHash`, `requestBodyHash`, `cacheKeyHash` allowed locations | hash는 raw 값은 아니지만 high-cardinality/correlation 값이다. 내부 context, DB, detail, UI, metrics 중 어디까지 허용할지 불명확하다. | recommended decision: internal Gateway context/evidence storage candidate로만 허용하고, metrics label과 Dashboard aggregate, Employee UI에는 금지한다. Admin Request Detail 표시는 별도 P1 decision으로 둔다. | P0 | clarify | gateway-request-context descriptions and request-detail visibility candidate | logging/API mapper guardrail, metrics forbidden label tests 필요 | Gateway, Observability, Safety, Web | raw prompt 대체물처럼 사용하지 않는다. |
| DEC-004 | `apiKeyId`, `appTokenId` Admin display | credential ID가 raw secret은 아니지만 Request Detail에 보여도 되는지 불명확하다. | recommended decision: metrics label과 Employee UI에는 금지한다. Admin-only credential management 화면은 별도 read model로 허용 후보, Request Detail 기본값에서는 제외 후보로 둔다. | P1 | clarify | Request Detail schema field addition/removal candidate | UI/RBAC/audit 정책 필요 | Web, Control Plane, Observability, Gateway | cleanup PR에서 임의로 추가/삭제하지 않는다. |
| DEC-005 | `configHash`, `securityPolicyHash`, `routingPolicyHash` placement | contracts는 v2 provenance와 연결하라고 하지만 top-level 유지인지 nested `legacyHashes`인지 불명확하다. | recommended decision: v2 primary provenance는 `runtimeSnapshotId/runtimeSnapshotVersion/contentHash/runtimeState/publishedAt/publishedBy/gatewayInstanceId`; v1 hash trio는 optional `legacyHashes` candidate로 둔다. | P0 | clarify | runtime-snapshot and gateway-request-context already use `legacyHashes`; request-detail/kyumin schema alignment candidate | compatibility mapper와 UI display label 정리 필요 | Control Plane, Gateway, Web, Observability, Safety | primary identity로 표시하지 않는다. |
| DEC-006 | `runtimeSnapshotVersion` type | 일부 frontend schema/fixture는 string, 다른 v2 schema/fixture는 integer를 사용한다. | recommended decision: integer monotonic version으로 통일한다. display label이 필요하면 UI에서 string으로 format한다. | P0 | clarify | kyumin frontend schema/fixture update candidate | Control Plane/Gateway/Frontend DTO type alignment 필요 | Control Plane, Gateway, Web, Observability | schema freeze 전에 맞춘다. |
| DEC-007 | `runtimeState=no_snapshot/not_checked` scope | provenance object와 read model/stage outcome이 같은 runtimeState definition을 공유한다. | recommended decision: actual RuntimeSnapshot/GatewayContext provenance는 `snapshot_active/last_known_safe_used/stale_snapshot_used` only. `no_snapshot/not_checked`는 read model/stage outcome only. | P0 | clarify | request-detail/kyumin schema definition split candidate | mapper에서 `runtimeSnapshot=null` and runtime domain outcome 분리 필요 | Gateway, Web, Observability | contracts.md 방향과 일치하나 schema 표현을 분리해야 한다. |
| DEC-008 | RuntimeConfig/RuntimeSnapshot DB and publish model | `runtime_configs.document`와 `publishState`를 계속 쓸지, immutable RuntimeSnapshot table/document를 분리할지 불명확하다. | recommended decision: RuntimeConfig editable source와 RuntimeSnapshot immutable published execution body를 분리하는 방향을 P0 contract candidate로 둔다. P0 cleanup에서는 DB migration을 바로 하지 않고 implementation plan에서 thin-slice storage를 확정한다. | P0 | change-needed | runtime-snapshot fixture/schema may stay; storage schema not defined | Control Plane DB/API plan, Gateway adapter compatibility 필요 | Control Plane, Gateway, Web, Observability | 이 결정 없이는 live RuntimeSnapshot PR이 흔들린다. |
| DEC-009 | `budgetScope.resolvedBy` required scope | contracts는 Request Log/Detail/Dashboard에 resolved scope를 남긴다고 하지만 GatewayContext/log/detail/dashboard required 범위가 구현 관점에서 불명확하다. | recommended decision: GatewayContext, Request Log, Request Detail은 `budgetScopeType/budgetScopeId/resolvedBy` required candidate. Dashboard는 filter/breakdown grain에 resolved budget scope를 사용하되 aggregate row에는 source/freshness와 함께 표현한다. | P0 | clarify | request-detail and gateway-request-context already need `resolvedBy`; dashboard overview may need alignment | Gateway propagation, log writer, query reader, UI filter alignment 필요 | Gateway, Control Plane, Observability, Web | client-provided budget scope는 신뢰하지 않는다. |
| DEC-010 | `detectedTypes`, `redactedPromptPreview` audience scope | Admin/Developer와 Employee UI에서 보여도 되는 safety detail 수준이 다르다. | recommended decision: `safety.outcome` is canonical. `detectedTypes` and `redactedPromptPreview` are sanitized Admin/Developer detail candidates only; Employee UI hides detector detail and policy internals. | P1 | clarify | safety-domain/gateway-stage/request-detail descriptions candidate | RBAC/display policy and fixture wording updates needed | Safety, Web, Gateway, Observability | preview length/retention은 별도 P1 policy로 둔다. |
| DEC-011 | `secretRef` to `credentialRef` compatibility | Control Plane uses `secretRef`; v2 Provider Catalog uses `credentialRef`. API/DB compatibility 방향이 불명확하다. | recommended decision: v2 contract term is `credentialRef`. Existing `secretRef` remains legacy compatibility in Control Plane DTO/DB until migration; RuntimeSnapshot/Provider Catalog exposes only `credentialRef` metadata. | P0 | clarify | provider-catalog schema already uses `credentialRef`; fixture keep | DTO mapper, migration plan, naming deprecation note 필요 | Control Plane, Gateway | Provider Key/secret plaintext 금지. |
| DEC-012 | Dashboard average latency | v2 says p95 primary and Gateway/Provider latency split, but average latency를 core field로 유지할지 불명확하다. | recommended decision: p95 split is core. average latency is optional read model candidate for backward compatibility, not primary KPI. | P1 | clarify | dashboard-overview optional field candidate if kept | query reader compatibility and UI label cleanup 필요 | Observability, Web, Gateway | P0 cleanup can avoid deleting existing avg fields until schema decision. |
| DEC-013 | provider/model metrics label cardinality | selected provider/model label이 실제 provider 도입 후 high-cardinality가 될지 불명확하다. | recommended decision: Prometheus-compatible labels allow only controlled low-cardinality catalog labels. High-cardinality model/version/detail goes to Dashboard read model, not metrics label. | Later | clarify | none now | revisit after Actual Provider catalog shape | Gateway, Observability, Control Plane | Provider/Model enum 고정은 금지한다. |
| DEC-014 | `p0_llm_invocation_logs.status` physical rename | logical `status` cleanup과 physical DB table/column rename을 같이 할지 불명확하다. | recommended decision: do not physically rename table/column in P0 cleanup. Use logical mapper/read model bridge first. Consider physical migration only after v2 contract/schema freeze. | Later | none | none now | avoids migration blast radius | Observability, Gateway | 구현 PR에서 DB table/column rename을 하지 않는다. |

## 3. P0 Decisions Before Implementation

### DEC-001. `domainOutcomes` bridge

- Current ambiguity: v1 surfaces still expose `status/cacheStatus/maskingAction`, while v2 requires Gateway-produced `terminalStatus + domainOutcomes`.
- Recommended decision: canonical v2 state is `terminalStatus + domainOutcomes`; legacy fields are compatibility output only.
- Why: Observability must not invent stage outcomes.
- Contract impact: clarify.
- Schema/fixture impact: gateway-stage-outcomes/request-detail are directionally aligned; compatibility examples may be needed later.
- Implementation impact: add mapper/bridge before broad log/dashboard cleanup.
- If not decided: cleanup PRs will either duplicate status logic or infer outcomes in Observability.

### DEC-003. hash field visibility

- Current ambiguity: `promptHash`, `requestBodyHash`, `cacheKeyHash` appear in internal context/detail/history, but metrics labels forbid them.
- Recommended decision: allow only internal/evidence candidates; forbid metrics label, Dashboard aggregate, Employee UI. Admin Detail display remains P1.
- Why: hash fields are high-cardinality correlation material even when not raw values.
- Contract impact: clarify.
- Schema/fixture impact: Gateway Request Context descriptions should distinguish internal fields from API/UI exposure.
- Implementation impact: metrics guard and read model filtering must be explicit.
- If not decided: a cleanup PR may accidentally promote hash fields to public/API/metrics surfaces.

### DEC-005. v1 hash trio placement

- Current ambiguity: v1 hash trio is still used as runtime identity in some surfaces.
- Recommended decision: use optional `legacyHashes` candidate under RuntimeSnapshot provenance compatibility, not primary provenance.
- Why: v2 provenance should be RuntimeSnapshot-first while preserving v1 traceability.
- Contract impact: clarify.
- Schema/fixture impact: align request-detail and frontend schema with existing runtime-snapshot/gateway-request-context `legacyHashes` direction.
- Implementation impact: UI labels and log mapper must stop treating v1 hashes as the main identity.
- If not decided: RuntimeSnapshot live work will conflict with existing provenance displays.

### DEC-006. `runtimeSnapshotVersion` type

- Current ambiguity: string in one frontend schema/fixture, integer elsewhere.
- Recommended decision: integer monotonic version.
- Why: ordering, comparison, and schema validation should be consistent.
- Contract impact: clarify.
- Schema/fixture impact: frontend read model schema/fixture update candidate.
- Implementation impact: DTO and UI format conversion needed.
- If not decided: schema freeze will preserve incompatible shapes.

### DEC-007. `runtimeState` scope

- Current ambiguity: `no_snapshot/not_checked` can appear in provenance definitions.
- Recommended decision: provenance values only `snapshot_active/last_known_safe_used/stale_snapshot_used`; `no_snapshot/not_checked` only stage outcome/read model.
- Why: absence of snapshot and state of an actual snapshot are different concepts.
- Contract impact: clarify.
- Schema/fixture impact: split definitions in request-detail/frontend schema.
- Implementation impact: mapper uses `runtimeSnapshot=null` plus runtime domain outcome when no snapshot exists.
- If not decided: UI/API may show impossible RuntimeSnapshot provenance states.

### DEC-008. RuntimeConfig/RuntimeSnapshot storage model

- Current ambiguity: editable config and published snapshot are conceptually split, but DB/document model is not fully decided.
- Recommended decision: separate editable RuntimeConfig source from immutable RuntimeSnapshot execution body; defer physical migration details to implementation plan.
- Why: Gateway must consume published RuntimeSnapshot, not editable config.
- Contract impact: change-needed.
- Schema/fixture impact: current runtime-snapshot schema can remain the target shape.
- Implementation impact: Control Plane/Gateway adapter compatibility must be planned.
- If not decided: RuntimeSnapshot live PR may encode draft/editable semantics in the hot path.

### DEC-009. budget scope `resolvedBy`

- Current ambiguity: required scope across GatewayContext/log/detail/dashboard is not explicit enough for implementation.
- Recommended decision: required candidate in GatewayContext, Request Log, Request Detail; Dashboard aggregates by resolved budget scope and shows freshness/query budget separately.
- Why: cost/quota/dashboard ownership must not depend on client-provided values.
- Contract impact: clarify.
- Schema/fixture impact: align request-detail/dashboard/gateway-request-context required fields.
- Implementation impact: Gateway context propagation and query reader filters required.
- If not decided: Dashboard and logs may disagree on budget ownership.

### DEC-011. `credentialRef` compatibility

- Current ambiguity: Control Plane uses `secretRef`; v2 schema uses `credentialRef`.
- Recommended decision: `credentialRef` is the v2 contract term; `secretRef` remains legacy compatibility until migration.
- Why: `credentialRef` better describes metadata/reference without implying secret exposure.
- Contract impact: clarify.
- Schema/fixture impact: provider-catalog schema can remain; Control Plane docs/DTO mapping candidate.
- Implementation impact: mapper/deprecation path needed.
- If not decided: RuntimeSnapshot/Provider Catalog may leak storage-path terminology into public contracts.

## 4. Can Defer

- DEC-002 `cacheHitRequestId`: keep out of P0 required contract; revisit as Admin-only detail provenance candidate.
- DEC-004 credential ID display: defer until RBAC/audit/read model policy is reviewed.
- DEC-010 safety detail visibility: defer preview length, detector granularity, and audience-specific UI rules to P1 contract hardening.
- DEC-012 average latency: keep p95 split as primary; average can be compatibility/read model candidate later.
- DEC-013 provider/model metrics cardinality: revisit after actual provider/model catalog is wired.
- DEC-014 physical DB rename: do not rename P0 tables/columns during contract cleanup.

## 5. Do Not Decide In Cleanup PR

Cleanup implementation PRs must not independently decide:

- whether `cacheHitRequestId` is public Request Detail, Admin-only, or removed;
- whether credential IDs appear in Request Detail;
- whether hash fields appear in Admin UI;
- where v1 hash trio lives if `legacyHashes` is not accepted;
- RuntimeSnapshot table/document/migration shape;
- physical rename of `p0_llm_invocation_logs` or its `status` column;
- provider/model Prometheus label cardinality rules;
- raw prompt/raw response storage opt-in;
- Semantic Cache live response path.

If a cleanup PR hits one of these, it should mark the work as blocked/deferred and reference this document.

## 6. Suggested Next Step

1. Team review this decision draft.
2. Accept or revise P0 decisions DEC-001, DEC-003, DEC-005, DEC-006, DEC-007, DEC-008, DEC-009, DEC-011.
3. Create a small `contracts.md` clarification PR for accepted P0 decisions.
4. Update schema/fixture only after the contract clarification lands.
5. Write `docs/v2.0.0/implementation-plan.md` with cleanup PR boundaries.
6. Start code cleanup PRs only for contract-clear items.
