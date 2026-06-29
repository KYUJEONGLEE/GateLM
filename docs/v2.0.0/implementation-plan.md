# GateLM v2.0.0 Implementation Plan

## 1. Goal

This document is the PR-0 scope lock for P0 legacy cleanup.

It is not a v2 feature implementation plan. The immediate goal is to clean up existing legacy code paths that conflict with the frozen v2 contracts before starting RuntimeSnapshot live work, Actual Provider work, Streaming, or other v2 feature implementation.

P0 legacy cleanup means aligning existing status, naming, schema-facing read models, logs, metrics, and k6 expectations to:

1. `docs/v2.0.0/contracts.md`
2. `docs/v2.0.0/schemas/*.schema.json`
3. `docs/v2.0.0/fixtures/*.fixture.json`
4. `docs/v2.0.0/p0-legacy-field-cleanup.md`
5. `docs/v2.0.0/p0-contract-decisions.md`
6. `docs/README.md`

The cleanup PRs must keep v1.0.0 baseline behavior working while removing ambiguous legacy interpretation that would block v2 implementation.

## 2. Non-Goals

The P0 cleanup PRs must not implement or decide the following:

- RuntimeSnapshot live implementation
- Actual Provider 신규 연동
- Streaming 신규 구현
- Semantic Cache core response path 편입
- DB table/column physical rename
- raw prompt 저장
- raw response 저장
- API Key/App Token/Provider Key/Authorization header 저장 또는 노출
- actual secret 저장 또는 노출
- `contracts.md` 임의 수정
- schema/fixture 임의 수정
- new API route creation outside the frozen contracts
- new DB table/column creation outside an explicit migration plan
- Web Console or Employee Chat direct Provider call

If cleanup work hits one of these items, stop that part and move it to a separate decision or implementation-plan follow-up.

## 3. P0 Cleanup PR Sequence

### PR-1. Outcome bridge cleanup

Goal:

- Normalize existing legacy request status handling to canonical `terminalStatus + domainOutcomes`.
- Keep legacy `status`, `cacheStatus`, and `maskingAction` only as compatibility/read-model bridge fields where still required.
- Prevent Observability from inferring stage outcomes that Gateway did not produce.

Included scope:

- 조사 and cleanup for existing `status`, `cacheStatus`, and `maskingAction` usage.
- Map exact cache hit to:
  - `terminalStatus=success`
  - `cache.outcome=hit`
  - `provider.outcome=not_called`
- Remove `cache_hit` as a terminal status.
- Remove `error` as a terminal status.
- Map system failures to `terminalStatus=failed`.
- Map invalid API Key/App Token to `terminalStatus=blocked` with `httpStatus/errorCode`.
- Keep fallback success as `terminalStatus=success` and explain degraded path through provider/fallback outcomes.
- Align metrics and k6 status expectations to canonical terminal status values.

Excluded scope:

- Physical DB table/column rename.
- RuntimeSnapshot live adapter.
- Actual Provider integration.
- Full Dashboard redesign.
- New schema/fixture changes.

Likely investigation areas:

- Gateway request/response status mapping.
- invocation log writer/reader and event payload bridge.
- Request Log / Request Detail / Dashboard read model adapters.
- metrics recorder and k6 baseline expectations.
- Web components that display status, cache status, or safety masking status.

Completion criteria:

- Code does not treat `cache_hit`, `error`, or `partial_success` as canonical terminal status values.
- Exact cache hit is represented as `success + cache.hit + provider.not_called`.
- Auth, policy, provider, cache, fallback, streaming, and logging results are represented as domain outcomes instead of inferred downstream.
- Existing tests are updated only to reflect the frozen contract, not new feature behavior.

### PR-2. Budget scope propagation cleanup

Goal:

- Align existing Request Log, Request Detail, Dashboard, and Gateway context code with resolved budget scope semantics.
- Ensure cost, quota, and dashboard ownership are based on `budgetScopeType/budgetScopeId/resolvedBy`, not client-provided values.

Included scope:

- Propagate resolved budget scope through GatewayContext, Request Log, Request Detail, and Dashboard read models.
- Use only allowed `budgetScopeType` values:
  - `application`
  - `project`
  - `team`
- Use only allowed `resolvedBy` values:
  - `default_application`
  - `runtime_snapshot`
  - `control_plane_rule`
- Default to `budgetScopeType=application`, `budgetScopeId=applicationId`, `resolvedBy=default_application` when no verified override exists.
- Reject or ignore client-provided budget scope as authority.
- Align Dashboard filters/breakdowns with resolved budget scope.

Excluded scope:

- New quota engine behavior.
- New Control Plane budget policy editor.
- DB physical migration.
- New Dashboard feature work beyond read-model cleanup.
- Adding `department` budget scope.

Likely investigation areas:

- Gateway authenticated context and request context construction.
- invocation log write model and query model.
- Request Detail API/read model mappers.
- Dashboard overview query/read model.
- k6/dashboard assertions that group by application or status only.

Completion criteria:

- Existing code paths that write or expose Request Log/Detail have access to resolved budget scope fields.
- Dashboard read models can filter or aggregate by resolved budget scope without trusting client request body input.
- No `client_provided` budget source is introduced as a contract value.

### PR-3. RuntimeSnapshot provenance cleanup

Goal:

- Clean up existing RuntimeConfig/RuntimeSnapshot naming and provenance fields before RuntimeSnapshot live implementation starts.
- Keep editable `RuntimeConfig` and published immutable `RuntimeSnapshot` concepts separate.

Included scope:

- Align RuntimeSnapshot provenance with primary fields:
  - `runtimeSnapshotId`
  - `runtimeSnapshotVersion`
  - `contentHash`
  - `runtimeState`
  - `publishedAt`
  - `publishedBy`
  - `gatewayInstanceId`
- Ensure `runtimeSnapshotVersion` is treated as an integer monotonic version in v2-facing surfaces.
- Allow provenance `runtimeState` values only:
  - `snapshot_active`
  - `last_known_safe_used`
  - `stale_snapshot_used`
- Keep `no_snapshot` and `not_checked` only in stage outcome/read model paths.
- Treat `configHash`, `securityPolicyHash`, and `routingPolicyHash` as `legacyHashes` compatibility bridge values, not primary provenance.
- Use `credentialRef` as the v2 provider credential reference term where v2-facing provider catalog/runtime surfaces expose metadata.

Excluded scope:

- RuntimeSnapshot live reload implementation.
- RuntimeConfig/RuntimeSnapshot DB table split.
- Physical migration of existing runtime config tables.
- Provider key storage changes outside credential reference naming cleanup.
- New provider catalog implementation.

Likely investigation areas:

- Control Plane runtime config DTOs and naming.
- Gateway runtime config/domain types.
- Request Detail RuntimeSnapshot provenance mapper.
- Web RuntimeSnapshot provenance display.
- Provider catalog and provider connection DTO naming around `secretRef`/`credentialRef`.

Completion criteria:

- v2-facing provenance does not use `no_snapshot` or `not_checked` as actual RuntimeSnapshot state.
- v1 hash trio is not displayed or treated as primary RuntimeSnapshot identity.
- RuntimeSnapshot provenance is not a copy of full RuntimeSnapshot body.
- Provider credential plaintext, API Key, App Token, Authorization header, and actual secret never enter RuntimeSnapshot provenance or fixtures.

## 4. Do Not Decide In Cleanup PRs

Cleanup PRs must not independently decide:

- Whether `cacheHitRequestId` appears in public Request Detail, Admin-only Detail, or is removed.
- Whether `apiKeyId` or `appTokenId` appears in Request Detail.
- Whether hash fields appear in Admin UI.
- Physical rename of `p0_llm_invocation_logs` or its `status` column.
- RuntimeConfig/RuntimeSnapshot physical DB table/document/publish model.
- Provider/model metrics label cardinality final policy.
- Whether average latency remains a core Dashboard KPI.
- Raw prompt/raw response storage opt-in.
- Semantic Cache live response path.
- Audience-specific final policy for `detectedTypes` and `redactedPromptPreview`.

If a cleanup PR reaches one of these decisions, mark it as deferred and reference `docs/v2.0.0/p0-contract-decisions.md`.

## 5. Verification Plan

Each cleanup PR must run the smallest relevant test set plus the checks below.

Required checks:

- Existing unit/integration tests for touched packages.
- Related JSON syntax validation for schema/fixture files if read-model fixtures are touched.
- Fixture-schema validation if schema or fixture files are touched in a separate schema PR.
- `git diff --check`.
- Search for raw/sensitive exposure:
  - raw prompt
  - raw response
  - API Key
  - App Token
  - Provider Key
  - Authorization header
  - actual secret
  - provider raw error body
- Search for metrics label forbidden items:
  - `request_id`
  - `trace_id`
  - `prompt_hash`
  - `request_body_hash`
  - `cache_key_hash`
  - `api_key_id`
  - `app_token_id`
  - `authorization`
  - `provider_key`
  - raw error detail

Expected cleanup PR evidence:

- Commands run and results summarized in the PR description.
- No unrelated file churn.
- No contract/schema/fixture drift unless the PR is explicitly a follow-up schema/fixture PR.
- No actual credentials, secrets, authorization headers, or real personal data in tests, seeds, snapshots, docs, or fixtures.

## 6. Completion Criteria

PR-0 is complete when:

- This implementation plan exists at `docs/v2.0.0/implementation-plan.md`.
- P0 cleanup is clearly separated from v2 feature implementation.
- PR-1, PR-2, and PR-3 have clear included scope, excluded scope, likely investigation areas, and completion criteria.
- Cleanup PRs know which decisions must be deferred instead of decided in code.
- Verification expectations are explicit.
- Code, migrations, schema/fixture, `contracts.md`, legacy cleanup inventories, and decision documents are not modified by PR-0.

The P0 legacy cleanup phase is complete when:

- Existing legacy status handling no longer conflicts with canonical `terminalStatus + domainOutcomes`.
- Existing Request Log/Detail/Dashboard paths consistently carry resolved budget scope where required.
- Existing RuntimeSnapshot-facing provenance paths use integer `runtimeSnapshotVersion`, valid runtime provenance states, and `legacyHashes` bridge semantics.
- Sensitive, raw, and high-cardinality values do not leak into API responses, structured logs, fixtures, metrics labels, or Employee UI.
- Working tree is clean after each PR.
