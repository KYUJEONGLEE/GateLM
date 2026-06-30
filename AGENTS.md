# GateLM Agent Guide

이 문서는 GateLM에서 Codex, Claude Code 같은 구현 에이전트가 작업을 시작할 때 따르는 기준이다.

현재 구현 목표는 **v2.0.0 organization-based LLMOps Gateway MVP**다.

v1.0.0 baseline은 깨지지 않아야 하지만, 새 구현 판단의 우선 기준은 v2 문서다.

## 1. Reading Order And Source Of Truth

작업을 시작할 때는 먼저 `docs/README.md`를 읽는다.

문서끼리 충돌하면 아래 Source Of Truth 순서로 판단한다.

1. `docs/v2.0.0/contracts.md`
2. `docs/v2.0.0/schemas/*.schema.json`
3. `docs/v2.0.0/fixtures/*.fixture.json`
4. `docs/v2.0.0/implementation-plan.md`
5. `docs/v2.0.0/implementation-tasks.md`

충돌하면 항상 `contracts.md`를 우선한다.

계약 변경이 필요하면 기능 PR에 몰래 섞지 말고, 계약 PR이나 문서 수정 제안으로 분리한다.

아래 문서는 Source Of Truth를 새로 만들지 않는 실행 보조 문서다. 충돌하면 위 우선순위를 따른다.

- `docs/v2.0.0/implementation-pr-packets.md`: PR별 goal, files, order, acceptance, rollback 확인
- `docs/v2.0.0/acceptance-test-matrix.md`: PR별 완료 조건과 evidence 확인
- `docs/v2.0.0/db-migration-plan.md`: DB/Prisma/SQL migration 변경 전 호환성 계획 확인

Reference / Draft 문서는 구현 판단의 보조 자료로만 사용한다.

- `docs/v2.0.0/p0-legacy-field-cleanup.md`
- `docs/v2.0.0/p0-contract-decisions.md`

위 문서의 후보 표현을 공식 API, DB, Event, Metrics, Schema field로 바로 승격하지 않는다.

## 2. v2.0.0 Main Path

v2.0.0의 기본 흐름은 아래다.

```text
Customer App / Employee Chat
-> Gateway
-> RuntimeSnapshot policy
-> budget / safety / cache / routing
-> Actual Provider or Mock fallback
-> Request Log / Detail / Dashboard / Metrics / k6 evidence
```

구현은 아래 원칙을 지킨다.

- Gateway는 editable RuntimeConfig를 직접 소비하지 않는다.
- Gateway는 published RuntimeSnapshot만 소비한다.
- RuntimeSnapshot lookup key는 `tenantId/projectId/applicationId`다.
- 비용, 쿼터, 대시보드 귀속은 `budgetScopeType/budgetScopeId`로 표현한다.
- client-provided budget scope는 신뢰하지 않는다.
- Provider와 Model은 DB enum 또는 code enum으로 고정하지 않는다.
- Provider별 호출 로직은 Provider Adapter 안에 둔다.
- Mock fallback은 v2.0.0에서도 유지한다.
- Streaming은 thin slice만 구현하고 token-level logging은 하지 않는다.

## 3. Forbidden Data

아래 값은 API response, DB record, fixture, structured log, metric label, UI에 평문으로 남기지 않는다.

- raw prompt
- raw response
- raw detected value
- raw prompt fragment
- API Key
- App Token
- Provider Key
- Authorization header
- provider raw error body
- actual secret

cache key, metrics label, dashboard aggregate label에도 위 값이나 high-cardinality/hash/detail/error text를 넣지 않는다.

## 4. First PR Order

구체적인 파일 단위 작업은 `docs/v2.0.0/implementation-tasks.md`를 따른다.

각 PR을 시작할 때는 `docs/v2.0.0/implementation-pr-packets.md`에서 해당 unit의 실행 범위를 확인하고, 완료 전에는 `docs/v2.0.0/acceptance-test-matrix.md`의 acceptance를 확인한다. DB, Prisma schema, SQL migration, Request Log read model을 건드리면 `docs/v2.0.0/db-migration-plan.md`를 먼저 확인한다.

| Unit | Branch | Purpose |
|---|---|---|
| 0 | `docs/v2-environment-and-plan-baseline` | Node/pnpm baseline, README/AGENTS pointers, plan/task docs |
| 1 | `feat/gateway-outcome-adoption-gate` | `terminalStatus + domainOutcomes` canonical adoption |
| 2A | `feat/provider-adapter-openai-and-mock-fallback` | Actual OpenAI Provider Adapter and Mock fallback |
| 2B | `feat/runtime-snapshot-live-thin-slice` | RuntimeSnapshot execution view and provenance |
| 3 | `feat/v2-budget-safety-cache-routing` | budget, safety, exact cache, routing order |
| 4 | `feat/streaming-thin-slice` | streaming feel and final outcome logging |
| 5 | `feat/v2-observability-dashboard-k6` | Request Detail, Dashboard, metrics guard, k6 baseline |
| 6 | `feat/v2-demo-evidence` | Demo Scenario Runner, preset evidence, final presentation proof |

## 5. Work Rules

- 작업 범위가 계약/API/DB/Event/Metrics/Security-sensitive field에 닿으면 먼저 문서를 확인한다.
- 새 API route, DB column, Event field, Metrics label은 `contracts.md`와 schema/fixture 근거 없이 만들지 않는다.
- legacy field는 바로 삭제하지 말고 compatibility bridge 여부를 확인한다.
- 기존 v1 smoke가 깨지면 원인을 설명하고 복구하거나 명시적으로 범위 조정한다.
- 다른 사람의 변경을 되돌리지 않는다.
- repo의 기존 패턴과 모듈 경계를 우선한다.

## 6. Verification Baseline

기본 검증은 아래를 우선한다.

```powershell
git diff --check
corepack pnpm run verify:v2-docs
corepack pnpm run verify:v2-final
pnpm install --frozen-lockfile
```

영향 범위에 따라 추가로 실행한다.

```powershell
pnpm --filter @gatelm/control-plane-api typecheck
pnpm --filter @gatelm/web typecheck
go test ./...
```

공식 로컬/CI/agent 기준은 Node `22`, pnpm `9.15.0`이다.

## 7. Planning Template

코드, 계약, schema, fixture, 주요 문서를 변경하기 전에는 먼저 아래 형식으로 작업 계획을 제시한다.

```text
목표:
수정 예정 파일:
새로 생성할 파일:
참조 문서:
API 변경 여부:
DB 변경 여부:
Event 변경 여부:
Metrics 변경 여부:
보안 영향:
테스트 계획:
완료 기준:
```
