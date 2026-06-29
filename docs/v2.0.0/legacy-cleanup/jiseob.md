# P0 Legacy Cleanup Inventory - Jiseob / Gateway

## Scope

Gateway Data Plane & Governance 기준 inventory다. 이번 문서는 코드 수정이 아니라 v2.0.0 구현 전 정리해야 할 legacy field, naming, status, schema, fixture, log, metrics 위험을 기록한다.

기준 문서:

- `docs/v2.0.0/contracts.md`
- `docs/v2.0.0/schemas/*`
- `docs/v2.0.0/fixtures/*`
- `docs/v2.0.0/team-debate-contract-prep.md`
- `docs/README.md`

조사 범위:

- `apps/gateway-core/internal/domain/request`
- `apps/gateway-core/internal/pipeline`
- `apps/gateway-core/internal/http/handlers`
- `apps/gateway-core/internal/domain/invocationlog`
- `apps/gateway-core/internal/adapters/invocationlog/postgres`
- `apps/gateway-core/internal/domain/metrics`
- `db/migrations/006_create_p0_invocation_logs_fallback.sql`
- `scripts/dev/p0-*`

## Summary

가장 큰 cleanup 축은 세 가지다.

1. v1의 `status/cache_hit/error`를 v2의 `terminalStatus + domainOutcomes`로 분리한다.
2. v1의 `configHash/securityPolicyHash/routingPolicyHash/SecurityPolicyVersionID`를 RuntimeSnapshot provenance로 정리한다.
3. v2의 `budgetScopeType/budgetScopeId/resolvedBy`를 GatewayContext, Invocation Log, Request Detail에 안전하게 전파한다.

보안상 즉시 금지해야 하는 raw prompt/raw response/API Key/App Token/Provider Key/Authorization header 저장은 현재 주요 Gateway log writer/read model에서 발견되지 않았다. 다만 `redactedPromptPreview`, `cacheKeyHash`, error text는 계속 sanitized/detail-only 원칙을 유지해야 한다.

## Inventory

| Item | Location | Current meaning | v2 contract mapping | Decision | Risk | Suggested cleanup PR |
|---|---|---|---|---|---|---|
| `status` field | `internal/domain/invocationlog/*`, `internal/http/handlers/invocation_logs_handler.go`, `db/migrations/006_create_p0_invocation_logs_fallback.sql` | Request Log의 최종 결과 bucket. 현재 `success`, `cache_hit`, `blocked`, `rate_limited`, `error`, `cancelled` 사용 | `terminalStatus`. 허용 값은 `success`, `blocked`, `rate_limited`, `failed`, `cancelled` | rename | High. v2에서 `error`는 `failed`, `cache_hit`은 terminal status가 아님 | PR 1 |
| `cache_hit` terminal status | `internal/domain/invocationlog/auth_failure.go`, `query_models.go`, `chat_completions_handler.go`, metrics tests | cache hit을 별도 request status로 집계 | `terminalStatus=success`, `domainOutcomes.cache.outcome=hit`, `provider.outcome=not_called` | rename | High. success count와 cache hit count가 이중 의미를 가짐 | PR 1 |
| `error` terminal status | `chat_completions_handler.go`, `errors.go`, `metrics/recorder.go`, `query_reader.go` | provider/gateway failure bucket | `terminalStatus=failed`, sanitized `errorCode`로 원인 구분 | rename | High. v2 error rate 정의가 system failure 중심인데 field name이 모호함 | PR 1 |
| Auth failure logged as `StatusError` | `internal/domain/invocationlog/auth_failure.go` | `invalid_api_key`, `invalid_app_token` auth failure log를 `error` status로 저장 | `terminalStatus=blocked`, `httpStatus=401/403`, `errorCode=invalid_api_key/invalid_app_token` | rename | High. auth/policy block과 system failure가 섞임 | PR 1 |
| `cacheStatus=bypass` | `pipeline/context.go`, `request/context.go`, `stages/cache/stage.go`, handlers, scripts | cache를 사용하지 않았거나 쓰면 안 되는 상태 | v2 cache domain outcome은 `bypassed` | rename | Medium. HTTP header/API에는 `bypass`가 이미 노출되어 있어 adapter alias가 필요할 수 있음 | PR 1 |
| `RateLimitDecision.Reason=limit_exceeded` as metrics status | `domain/metrics/recorder.go`, `stages/ratelimit/stage.go` | rate limit decision reason을 metric `status` label로 사용 | `domainOutcomes.rateLimit.outcome=rate_limited`, reason은 sanitized detail/metadata | rename | Medium. v2 outcome과 reason이 섞일 수 있음 | PR 1 |
| No explicit `domainOutcomes` object in Go request/log path | `request/context.go`, `pipeline/context.go`, `terminal_log.go`, `query_models.go` | 각 stage 결과가 개별 field로 흩어져 있음 | `domainOutcomes.auth/runtime/rateLimit/budget/safety/routing/cache/provider/fallback/streaming/logging` | contract-change-needed | High. Observability가 stage 결과를 추측하지 않으려면 Gateway가 생산해야 함 | PR 1 |
| `configHash`, `securityPolicyHash`, `routingPolicyHash` | `runtimeconfig/config.go`, `request/context.go`, `pipeline/context.go`, `terminal_log.go`, v2 schemas/fixtures | v1 runtime/policy linkage hash | v2 RuntimeSnapshot provenance compatibility fields. `contentHash`와 연결 필요 | defer | Medium. 바로 제거하면 Web/Observability/Safety/cache key evidence가 깨질 수 있음 | PR 2 |
| `SecurityPolicyVersionID` populated from `securityPolicyHash` | `stages/runtimeconfig/stage.go`, `pipeline_bridge.go`, `terminal_log.go` | field name은 version ID지만 실제 값은 hash 계열 | v2 safety policy provenance는 `securityPolicyHash` 또는 RuntimeSnapshot policy basis로 표현 | rename | Medium. id/hash 의미가 섞임 | PR 2 |
| Missing RuntimeSnapshot provenance in Go GatewayContext | `request/context.go`, `pipeline/context.go`, `terminal_log.go` | 현재 Go hot path에는 `runtimeSnapshotId`, `runtimeSnapshotVersion`, `runtimeState`, `publishedAt`, `publishedBy`, `gatewayInstanceId`, `lookupKey`, `contentHash`가 없음 | `runtimeSnapshot` provenance object | contract-change-needed | High. live RuntimeSnapshot 적용 증거를 Request Detail/Dashboard에 남기기 어려움 | PR 2 |
| RuntimeConfig consumed shape still named `ActiveConfig` | `domain/runtimeconfig/config.go`, `adapters/runtimeconfig/static/provider.go`, runtimeconfig stage | v1 static/runtime config provider가 Gateway hot path config를 제공 | Gateway는 editable RuntimeConfig가 아니라 published RuntimeSnapshot을 소비 | rename | Medium. 구현상 adapter는 괜찮지만 이름이 v2 계약과 어긋남 | PR 2 |
| Missing `budgetScopeType/budgetScopeId/resolvedBy` in Go GatewayContext/log | `request/context.go`, `pipeline/context.go`, `terminal_log.go`, `query_models.go`, DB migration | v1은 tenant/project/application 중심으로만 추적 | default `budgetScopeType=application`, `budgetScopeId=applicationId`, `resolvedBy=default_application` | contract-change-needed | High. v2 비용/쿼터/대시보드 귀속이 구현 evidence로 이어지지 않음 | PR 3 |
| `p0_llm_invocation_logs` table name | `db/migrations/006_create_p0_invocation_logs_fallback.sql`, postgres writer/reader tests | v1 baseline log table | v2 canonical log/read model 이름으로 승격 필요. 단, DB migration은 역할 간 영향 큼 | defer | Medium. 이름만 legacy이지만 마이그레이션 비용이 큼 | PR 3 또는 later |
| `statusCounts` in dashboard overview | `query_models.go`, `invocation_logs_handler.go`, query reader SQL | status별 집계 | `terminalStatusCounts` 또는 v2 Dashboard read model의 terminal status breakdown | rename | Medium. UI/Observability와 함께 맞춰야 함 | PR 1 |
| Request Detail `cacheKeyHash` exposure | `invocation_logs_handler.go`, `query_reader.go`, `terminal_writer.go`, v2 request-detail schema | cache debug/detail 추적용 hash | Request Detail에는 허용 가능, metrics label에는 금지 | keep | Low. raw prompt는 아니지만 high-cardinality라 metrics에는 넣으면 안 됨 | N/A |
| `redactedPromptPreview` exposure | `terminal_log.go`, `invocation_logs_handler.go`, masking stage/handler tests | redacted/blocked preview | sanitized preview only. safe raw prompt를 preview로 복사하면 안 됨 | keep | Medium. detector/masking regression 시 raw fragment 노출 위험 | PR 3 audit |
| Logs containing `cache_key_hash`, `request_id`, sanitized error cause | `chat_completions_handler.go` | 운영 디버깅 로그 | raw prompt/secret 금지. hash/requestId는 structured log에는 제한적으로 허용, metrics label에는 금지 | keep | Low. 현재 `sanitizeLogValue` 사용. error cause가 raw provider body가 되지 않게 유지 필요 | N/A |
| p0 smoke scripts expecting `status=cache_hit/error` | `scripts/dev/p0-*` | v1 demo/evidence scripts | v2 demo scripts should read `terminalStatus/domainOutcomes`; old p0 scripts는 archive/defer | defer | Low. 구현 hot path 위험은 낮지만 혼란 유발 | later |
| Metrics label `status=cache_hit/error` | `domain/metrics/recorder.go`, handler metrics tests | Gateway request metric terminal bucket | `status` label value should follow v2 terminalStatus, so `cache_hit -> success`, `error -> failed` | rename | High. k6/performance baseline의 error rate 해석이 틀어질 수 있음 | PR 1 |
| Provider/model metric labels | `domain/metrics/recorder.go` | `selected_provider`, `selected_model` label | Provider/Model enum 고정 금지. metrics label은 low-cardinality catalog label만 허용 | defer | Medium. 실제 Provider 도입 후 model label cardinality 정책 필요 | later with Kyujeong |

## Raw/Sensitive Field Risk Notes

- `rawPrompt`, `rawResponse`, `Authorization`, provider raw error body를 Request Log writer/read model에 저장하는 경로는 조사 범위에서 발견하지 못했다.
- `Authorization`은 auth handler에서 입력으로만 읽는다. 로그/fixture 저장 금지 원칙은 유지한다.
- `redactedPromptPreview`는 허용 필드지만 raw prompt preview로 오용되면 보안 사고가 된다. safe prompt에서 preview를 비워 두는 현재 원칙을 유지한다.
- `cacheKeyHash`, `requestBodyHash`, `promptHash`는 raw 값은 아니지만 high-cardinality 값이다. Request Detail에서는 제한적으로 허용하고 metrics label에는 넣지 않는다.
- provider error는 `provider_error` 같은 sanitized code만 남긴다. provider raw error body는 저장하거나 응답하지 않는다.

## First Cleanup PR Candidates

### PR 1. Gateway outcome normalization bridge

목표:

- v1 `status`를 v2 `terminalStatus`로 정규화하는 mapper를 추가한다.
- `cache_hit -> terminalStatus=success + cache.outcome=hit + provider.outcome=not_called`
- `error -> terminalStatus=failed`
- auth failure는 `blocked`로 정리한다.
- `cacheStatus=bypass`는 v2 domain outcome에서는 `bypassed`로 표현한다.

주의:

- DB column rename까지 한 번에 하지 않는다.
- 기존 v1 API/테스트를 깨지 않도록 read model compatibility layer를 둔다.

### PR 2. RuntimeSnapshot provenance bridge

목표:

- GatewayContext/TerminalLog에 RuntimeSnapshot provenance object를 추가한다.
- 최소 필드: `runtimeSnapshotId`, `runtimeSnapshotVersion`, `contentHash`, `runtimeState`, `publishedAt`, `publishedBy`, `gatewayInstanceId`, `lookupKey`.
- 기존 `configHash/securityPolicyHash/routingPolicyHash`는 바로 제거하지 않고 provenance compatibility field로 둔다.
- `SecurityPolicyVersionID`와 `securityPolicyHash` 의미 충돌을 정리한다.

주의:

- live Control Plane adapter가 없어도 static adapter fixture로 증명할 수 있게 한다.
- RuntimeSnapshot full body를 Request Detail에 복사하지 않는다.

### PR 3. Budget scope propagation and sensitive-field audit

목표:

- GatewayContext/TerminalLog/Request Detail에 `budgetScopeType`, `budgetScopeId`, `resolvedBy`를 전파한다.
- 기본값은 `application/applicationId/default_application`.
- client request body의 budget scope는 신뢰하지 않는다.
- `redactedPromptPreview`, `cacheKeyHash`, error message가 v2 보안 규칙을 지키는지 regression test를 추가한다.

주의:

- budget scope를 RuntimeSnapshot lookup key에 넣지 않는다.
- Dashboard/API shape 변경은 Observability/Web 역할과 맞춘 뒤 진행한다.

## Deferred / Cross-Role Items

- `p0_llm_invocation_logs` table rename 또는 v2 table migration은 Observability/DB owner와 함께 결정한다.
- Provider/model metric label cardinality 정책은 Actual Provider 도입 후 Kyujeong role과 함께 정한다.
- p0 smoke script archive/rename은 v2 demo scenario가 확정된 뒤 처리한다.
- raw prompt/raw response 저장 opt-in은 v2.0.0 core가 아니며 별도 계약 전까지 금지한다.
