# P0 legacy cleanup inventory - kyujeong

## Scope

- Role: Request Log / Request Detail / Dashboard read model / metrics / k6
- 기준 계약: `docs/v2.0.0/contracts.md`
- 보조 확인: `docs/v2.0.0/schemas/`, `docs/v2.0.0/fixtures/`, `docs/v2.0.0/team-debate-contract-prep.md`, `docs/README.md`
- 주의: 요청의 `schemas/draft`, `fixtures/draft` 경로는 현재 브랜치에서 존재하지 않고, `contracts.md`는 최종 draft 위치를 `docs/v2.0.0/schemas/`, `docs/v2.0.0/fixtures/`로 명시한다.
- 이번 문서는 inventory 전용이며 코드 수정은 하지 않는다.

## Inventory

| Item | Location | Current meaning | v2 contract mapping | Decision | Risk | Suggested cleanup PR |
|---|---|---|---|---|---|---|
| `status = cache_hit` as request terminal status | `apps/gateway-core/internal/domain/invocationlog/auth_failure.go:11`, `apps/gateway-core/internal/domain/invocationlog/query_models.go:541`, `apps/gateway-core/internal/adapters/invocationlog/postgres/query_reader.go`, `docs/architecture/llm-log-schema.md:181` | Cache hit을 요청의 최종 status로 저장/집계한다. | `terminalStatus = success`, `domainOutcomes.cache = hit`, `domainOutcomes.provider = not_called` 후보로 분리한다. | rename | High. v2 `terminalStatus` enum에는 `cache_hit`이 없고 Dashboard/metrics/k6가 모두 같은 legacy status를 기대한다. | PR-1 |
| `status = error` | `apps/gateway-core/internal/domain/invocationlog/auth_failure.go:14`, `apps/gateway-core/internal/domain/invocationlog/query_models.go:546`, `docs/architecture/dashboard-metrics.md:279` | 시스템/Provider 실패를 `error` status로 표현한다. | `terminalStatus = failed`; 정책성 block/rate limit은 각각 `blocked`, `rate_limited`로 분리한다. | rename | High. v2 terminal status는 `failed`이며, error rate는 시스템 실패만 포함해야 한다. | PR-1 |
| `partial_success` status | `docs/architecture/llm-log-schema.md:350`, `docs/architecture/dashboard-metrics.md:249`, `docs/architecture/dashboard-metrics.md:300` | Streaming 일부 실패 또는 fallback 후 응답을 성공 요청으로 집계하는 장기 분석 status. | v2 core terminal status에는 없음. fallback/streaming outcome 후보로 분리하고 v2.0.0 core에서는 확정하지 않는다. | remove | Medium. 오래된 문서가 v2 status enum을 오염시킬 수 있다. | PR-1 |
| P0 table/status naming | `db/migrations/006_create_p0_invocation_logs_fallback.sql:1`, `db/migrations/006_create_p0_invocation_logs_fallback.sql:58`, `docs/architecture/db-schema.md:206` | `p0_llm_invocation_logs.status`를 canonical log source로 사용한다. | v2 Request Log는 `terminalStatus`와 domain outcome/read model 분리를 필요로 한다. 실제 DB rename 여부는 migration 계약 필요. | contract-change-needed | High. DB column/table rename은 API, query reader, migration compatibility와 함께 결정해야 한다. | PR-2 |
| Dashboard counters `successfulRequests`, `failedRequests`, `cacheHitRequests` | `apps/gateway-core/internal/http/handlers/invocation_logs_handler.go:91`, `apps/gateway-core/internal/domain/invocationlog/query_models.go:217`, `apps/web/src/features/dashboard/components/dashboard-overview.tsx:41` | v1 dashboard total counters. `cache_hit`을 별도 request status처럼 센다. | v2 Dashboard read model 후보: total/success/blocked/rateLimited/failed/cancelled counts plus cache outcome aggregation. | rename | Medium. 사용자 화면/API 필드명이 v2 계약의 terminal status/domain outcome 분리를 가린다. | PR-2 |
| Dashboard latency fields `averageLatencyMs`, `p95LatencyMs`, `averageResponseTimeMs` | `apps/gateway-core/internal/http/handlers/invocation_logs_handler.go:105`, `apps/gateway-core/internal/domain/invocationlog/query_models.go:440`, `docs/architecture/dashboard-metrics.md:343` | latency를 성공/cache/error status 중심으로 평균/p95 집계한다. | v2는 `p95GatewayInternalLatencyMs`, `p95ProviderLatencyMs`를 분리하고 p95를 primary로 둔다. 평균은 보조 read model 후보로만 둔다. | rename | Medium. Gateway 내부 latency와 Provider latency가 섞이면 운영 대시보드 판단이 틀어진다. | PR-2 |
| Metrics label `status="cache_hit"` | `apps/gateway-core/internal/domain/metrics/recorder.go:132`, `apps/gateway-core/internal/http/handlers/chat_completions_metrics_test.go:84`, `scripts/perf/k6-gateway-baseline.js:143` | Prometheus request metric의 low-cardinality status label 값으로 `cache_hit`을 사용한다. | request metric status label을 유지한다면 v2 terminal status 값만 사용하고, cache는 별도 cache outcome metric/label 후보로 분리한다. | rename | High. v2 metrics와 k6가 계약 이전 status taxonomy에 고정된다. | PR-1 |
| Forbidden metrics label guard | `scripts/perf/k6-gateway-baseline.js:24`, `apps/gateway-core/internal/http/handlers/chat_completions_metrics_test.go:266`, `apps/gateway-core/internal/http/handlers/chat_completions_metrics_handoff_smoke_test.go:413` | `request_id`, `trace_id`, `api_key_id`, `app_token_id`, `prompt_hash`, `cache_key_hash`, `authorization` label 노출을 테스트로 차단한다. | v2 보안 제약과 일치한다. `provider_key`, raw error detail 계열도 같은 guard로 확장 후보. | keep | Low. 유지해야 하는 방어선이다. 단, provider key/raw error detail까지 누락 없이 포함하는지 추가 확인 필요. | PR-3 |
| Request Detail `cacheKeyHash` | `apps/gateway-core/internal/http/handlers/invocation_logs_handler.go:180`, `apps/web/src/features/request-logs/components/request-log-detail.tsx:124`, `apps/web/src/lib/fixtures/v1-observability-fixtures.ts:48` | Request Detail에 exact cache key hash를 표시한다. | v2 Request Detail minimum에는 없음. metrics label에는 `cache_key_hash` 금지. 필요하면 cache provenance 후보로 별도 계약 필요. | remove | High. raw prompt는 아니지만 고카디널리티/상관 식별자라 Dashboard/metrics로 번질 위험이 크다. | PR-2 |
| Request Detail `cacheHitRequestId` | `db/migrations/006_create_p0_invocation_logs_fallback.sql:38`, `apps/gateway-core/internal/http/handlers/invocation_logs_handler.go:181`, `apps/web/src/features/request-logs/components/request-log-detail.tsx:68` | Cache hit이 참조한 원 요청 ID를 표시한다. | v2 Request Detail minimum에는 없음. 필요하면 exact cache hit provenance 후보로 계약에 명시하고 metrics label에는 절대 사용하지 않는다. | contract-change-needed | Medium. 요청 간 상관관계 노출 범위와 retention 정책이 불명확하다. | PR-2 |
| Runtime provenance legacy hashes `configHash`, `securityPolicyHash`, `routingPolicyHash` | `docs/v2.0.0/schemas/request-detail.schema.json:192`, `docs/v2.0.0/fixtures/request-detail.fixture.json:79`, `apps/web/src/features/request-logs/components/request-log-detail.tsx:120` | v1 runtime/config/policy 해시를 Request Detail provenance로 노출한다. | v2 최소 provenance는 `runtimeSnapshotId`, `runtimeSnapshotVersion`, `contentHash`, `runtimeState`, `publishedAt`, `publishedBy`, `gatewayInstanceId`. legacy hash는 연결 필드 후보. | defer | Medium. `contracts.md`가 P0 cleanup에서 최종 duplicate/rename을 결정하라고 남겼으므로 지금 임의 제거하면 안 된다. | PR-2 |
| `runtimeState = no_snapshot` inside RuntimeSnapshot provenance schema | `docs/v2.0.0/schemas/request-detail.schema.json:91`, `docs/v2.0.0/schemas/request-detail.schema.json:169`, `docs/v2.0.0/schemas/request-detail.schema.json:453` | Request Detail schema가 provenance object와 read model outcome에 `no_snapshot`을 모두 허용한다. | `contracts.md`는 actual runtime provenance에는 `snapshot_active`, `last_known_safe_used`, `stale_snapshot_used`만 두고, `no_snapshot`/`not_checked`는 read model/stage outcome으로 둔다. | contract-change-needed | Medium. `runtimeSnapshot = null`과 `runtimeState = no_snapshot`의 의미가 겹칠 수 있다. | PR-2 |
| `RuntimeConfig` naming in live request detail/read model | `apps/web/src/lib/gateway/live-request-logs.ts:136`, `apps/web/src/lib/gateway/live-request-detail.ts:147`, `apps/web/src/features/request-logs/components/request-log-detail.tsx:120` | live fallback/detail에서 runtime provenance를 `live-gateway` 또는 legacy config hash로 채운다. | v2 Gateway는 editable RuntimeConfig가 아니라 published RuntimeSnapshot provenance를 소비/노출해야 한다. | defer | Medium. Gateway/Control Plane RuntimeSnapshot publish 계약 확정 전에는 read model만 독립 수정하기 어렵다. | PR-2 |
| `promptHash` / `requestBodyHash` in log internals | `apps/gateway-core/internal/http/handlers/chat_completions_handler_test.go`, `docs/architecture/llm-log-schema.md` | raw prompt 대신 hash를 내부 log/debug key로 사용한다. | v2 metrics label에는 `prompt_hash`, `request_body_hash` 금지. Request Detail minimum에도 없음. 내부 저장 지속 여부는 별도 retention/security 계약 필요. | defer | Medium. raw prompt는 아니지만 detail/API/metrics로 노출되면 금지 label과 추적성 문제가 생긴다. | PR-3 |
| Semantic cache fields mixed into dashboard cache rate | `docs/architecture/dashboard-metrics.md:795` | `semanticCacheHits`를 `cacheHitRate` 예시에 포함한다. | v2.0.0 core는 Semantic Cache가 아니라 evidence track이다. Dashboard core cache rate는 exact cache 중심이어야 한다. | remove | Medium. core Dashboard 지표가 evidence track 기능을 전제로 해석될 위험이 있다. | PR-2 |
| ClickHouse/long-term analytics status examples | `docs/architecture/dashboard-metrics.md:653`, `docs/architecture/db-schema.md:1634`, `docs/architecture/dashboard-metrics.md:899` | P1/장기 ClickHouse schema와 SQL 예제가 `success/cache_hit/partial_success/error` status를 사용한다. | v2 MVP read model은 contracts/schema 우선. 장기 분석 문서는 v2 status/domain outcome 확정 뒤 다시 매핑한다. | defer | Low. 구현 직접 위험보다 문서 혼선 위험이 크다. | none |

## First cleanup PR candidates

1. PR-1: Terminal status/domain outcome normalization
   - `cache_hit` terminal status 제거 방향으로 `terminalStatus=success` + cache outcome 분리.
   - `error`를 `failed`로 매핑.
   - metrics/k6/test expectation에서 `status="cache_hit"` 제거.

2. PR-2: Request Detail / Dashboard read model v2 alignment
   - Dashboard field를 v2 schema 후보와 맞춘다.
   - Gateway internal latency와 Provider latency를 분리한다.
   - `cacheKeyHash`, `cacheHitRequestId`, runtime legacy hash 노출 범위를 계약으로 확정한 뒤 반영한다.

3. PR-3: Metrics/security guard hardening
   - 현재 forbidden label guard는 유지한다.
   - `provider_key`, raw provider error detail 계열까지 누락 없이 금지 목록과 테스트에 포함한다.
   - `promptHash`/`requestBodyHash`가 Dashboard/metrics/API response로 흘러나오지 않는지 확인한다.

## Open contract questions

- `cacheHitRequestId`를 v2 Request Detail에 남길지, exact cache provenance 후보로 별도 필드를 둘지 결정 필요.
- v1 legacy hashes(`configHash`, `securityPolicyHash`, `routingPolicyHash`)를 v2 `contentHash`/RuntimeSnapshot provenance와 어떻게 병합할지 결정 필요.
- Request Detail schema의 `runtimeSnapshot.runtimeState = no_snapshot` 허용이 계약 의도인지, 아니면 `runtimeSnapshot = null` + runtime domain outcome으로 표현해야 하는지 확인 필요.
- 평균 latency를 Dashboard v2 core에 남길지, p95 중심 read model의 보조 필드로만 둘지 결정 필요.
