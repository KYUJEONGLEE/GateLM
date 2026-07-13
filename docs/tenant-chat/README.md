# GateLM Tenant Chat Contract Scope

상태: **Active implementation contract**
적용 범위: 신규 Tenant Chat Product
계약 revision: `tenant-chat/v1`
기준일: 2026-07-12
소유 범위: Tenant Chat workstream

이 디렉터리는 신규 Tenant Chat의 구현 기준이다. `proposal`이 아니라 구현 중 active로 간주하며, 명시적인 후속 ADR 또는 contract revision이 merge되기 전까지 구현 에이전트는 이 기준을 따른다.

## 1. 버전과 기존 문서의 관계

- `docs/v2.0.0`: 기존 Project/Application Gateway 경로의 legacy baseline이다. 회귀 검증과 호환성 근거로 보존한다.
- `docs/v2.1.0`: 기존 self-host 및 advanced routing 범위다. Tenant Chat 계약 namespace가 아니다.
- `docs/tenant-chat`: Project/Application과 분리된 신규 Tenant Chat의 active scoped contract다. 제품 release SemVer를 선언하지 않는다.

기존 문서는 절대적인 진리가 아니라 당시 합의를 기록한 versioned baseline이다. 현재 구현과 요구가 달라졌다면 오래된 의미를 억지로 재사용하지 않고, 이 namespace에서 변경 이유와 compatibility boundary를 명시한다.

Tenant Chat 구현이 기존 `/v1` Project/Application 경로를 변경하지 않는 한, 두 계약은 각자 범위에서 유효하다. 같은 field 또는 route에 서로 다른 의미를 부여해야 한다면 구현하지 말고 이 문서의 revision을 먼저 만든다.

## 2. 읽기 순서

Tenant Chat 작업은 다음 순서로 읽는다.

1. `docs/tenant-chat/contracts.md`
2. `docs/tenant-chat/execution-contract.md`
3. `docs/tenant-chat/openapi/chat-auth.openapi.json`
4. `docs/tenant-chat/openapi/private-gateway.openapi.json`
5. `docs/tenant-chat/db/tenant-chat-usage.sql`
6. `docs/tenant-chat/schemas/*.schema.json`
7. `docs/tenant-chat/fixtures/*.fixture.json`, `docs/tenant-chat/vectors/*.json`
8. `docs/tenant-chat/implementation-plan.md`
9. `docs/tenant-chat/handoffs/*.md`
10. 기존 경로 호환성 확인이 필요할 때만 `docs/v2.0.0/**`, `docs/v2.1.0/**`

`contracts.md`와 schema/fixture가 충돌하면 `contracts.md`를 먼저 고치고 schema/fixture를 함께 맞춘다. 로컬 PR packet은 구현 순서와 acceptance를 제공하지만 active contract를 덮어쓰지 않는다.

## 3. 고정 제품 경계

- Tenant Chat은 기존 `apps/application` Application Chat과 별도 제품이다.
- Tenant Chat runtime key는 tenant 단위이며 hidden Project/Application을 만들지 않는다.
- 기존 Project/Application Gateway endpoint, RuntimeSnapshot, budget scope, Request Log는 의미를 바꾸지 않는다.
- 신규 브라우저 제품은 `chat-web`, core API는 `chat-api`다.
- 브라우저는 `chat-web` BFF만 호출하고 Gateway나 Provider를 직접 호출하지 않는다.
- Chat API와 Gateway는 private service network 및 workload JWT로 통신한다.
- 사용자 원문 저장 모듈의 공식 이름은 `EncryptedChatStore`다. 문서의 과거 `vault` 표현은 HashiCorp Vault 제품을 뜻하지 않는다.

## 4. 구현 우선순위

### Demo-critical

- invite/login/tenant selection/session
- active tenant admin과 active employee entitlement
- conversation CRUD, encrypted history, SSE chat
- tenant RuntimeSnapshot publish/execute
- request rate, 단계형 quota/budget, exact cache, provider/fallback
- confirmed usage ledger와 Dashboard aggregate
- admin policy/BYOK 및 감사되는 단건 content diagnostic
- local/self-host Compose, seed, smoke, browser/load evidence

### Follow-up PR

- Semantic Cache live execution. 정책 확장점은 지금 유지하되 MVP publish는 capability가 없으면 거부한다.
- OAuth-only 계정의 Google re-auth + email re-proof 기반 password 추가
- content diagnostic four-eyes approval 옵션
- legal hold
- native desktop/mobile public edge
- managed KMS/HSM adapter
- multi-node HA와 대규모 enterprise client 기능

## 5. 변경 규칙

- 이 contract는 바꿀 수 있다. 다만 구현 중 field 의미를 조용히 바꾸지 않는다.
- 변경 PR은 `현재 의미`, `변경 이유`, `호환성`, `migration`, `acceptance`를 함께 기록한다.
- 다른 Codex나 팀원은 이 계약을 검토하고 문제를 제기할 수 있다. 피드백은 revision 전까지 active 구현을 자동으로 중단시키지 않는다.
- API/DB/Event/Metrics/Security-sensitive field 변경은 contract와 schema/fixture를 먼저 또는 같은 contract PR에서 갱신한다.
- raw prompt/response, credentials, provider raw error body는 fixture, log, metric label, Dashboard aggregate에 넣지 않는다.

## 6. 빠른 링크

- [Active contract](./contracts.md)
- [Executable integration contract](./execution-contract.md)
- [Chat auth OpenAPI](./openapi/chat-auth.openapi.json)
- [Private Gateway OpenAPI](./openapi/private-gateway.openapi.json)
- [Tenant Chat usage DDL contract](./db/tenant-chat-usage.sql)
- [Employee usage integration handoff](./handoffs/employee-usage-integration.md)
- [Tenant RuntimeSnapshot schema](./schemas/tenant-runtime-snapshot.schema.json)
- [Completion SSE event schema](./schemas/completion-sse-event.schema.json)
- [Binding digest test vectors](./vectors/binding-digest-vectors.json)
- [Usage event transition vectors](./vectors/usage-event-vectors.json)
- [Workload JWT phase vectors](./vectors/workload-jwt-phase-vectors.json)
- [Workload JWT claims schema](./schemas/workload-jwt-claims.schema.json)
- [Gateway request context schema](./schemas/gateway-request-context.schema.json)
- [Usage settlement event schema](./schemas/usage-settlement-event.schema.json)
- [Pre-ledger terminal event schema](./schemas/invocation-terminal-event.schema.json)
- [Dashboard aggregate schema](./schemas/dashboard-aggregate.schema.json)
- [Chat auth session schema](./schemas/chat-auth-session.schema.json)
- [Chat entitlement schema](./schemas/chat-entitlement.schema.json)
- [Auth shell first PR verification evidence](./evidence/auth-shell-first-pr.md)
