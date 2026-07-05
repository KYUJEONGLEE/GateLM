# GateLM Agent Guide

이 문서는 GateLM에서 Codex, Claude Code 같은 구현 에이전트가 작업을 시작할 때 따르는 기준이다.

현재 릴리즈 준비 목표는 **v0.1.0 Organization-Based Gateway MVP**다. `v2.0.0`은 GitHub Release 번호가 아니라 Gateway 계약, schema, fixture의 spec version이다.

## 1. Reading Order And Source Of Truth

작업을 시작할 때는 먼저 `docs/README.md`를 읽는다.

문서끼리 충돌하면 아래 Source Of Truth 순서로 판단한다.

1. `specs/gateway/v2.0.0/contracts.md`
2. `specs/gateway/v2.0.0/schemas/*.schema.json`
3. `specs/gateway/v2.0.0/fixtures/*.fixture.json`
4. `docs/releases/v0.1.0.md`
5. archive/draft가 아닌 현재 공개 문서

충돌하면 항상 `specs/gateway/v2.0.0/contracts.md`를 우선한다.

계약 변경이 필요하면 기능 PR이나 README/release note에 몰래 섞지 말고, 계약 PR이나 별도 문서 수정 제안으로 분리한다.

아래 문서는 Source Of Truth를 새로 만들지 않는 실행 보조 또는 historical 문서다. 현재 계약과 충돌하면 위 우선순위를 따른다.

- `docs/archive/gateway-v2.0.0-planning/implementation-plan.md`
- `docs/archive/gateway-v2.0.0-planning/implementation-tasks.md`
- `docs/archive/gateway-v2.0.0-planning/implementation-pr-packets.md`
- `docs/archive/gateway-v2.0.0-planning/acceptance-test-matrix.md`
- `docs/archive/gateway-v2.0.0-planning/db-migration-plan.md`
- `docs/archive/gateway-v2.0.0-planning/p0-legacy-field-cleanup.md`
- `docs/archive/gateway-v2.0.0-planning/p0-contract-decisions.md`

`docs/archive/v1.0.0/`은 legacy milestone 기록이며 현재 product release가 아니다. `docs/drafts/gateway-v2.1.0/`은 future/draft material이며 현재 v0.1.0 release readiness나 Gateway v2.0.0 계약을 대체하지 않는다.

Draft 문서의 후보 표현을 공식 API, DB, Event, Metrics, Schema field로 바로 승격하지 않는다.

## 2. v2.0.0 Main Path

v2.0.0 Gateway 계약의 기본 흐름은 아래다.

```text
Customer App / Employee Chat
-> Gateway
-> published RuntimeSnapshot policy
-> budget / rate limit / safety / routing-aware exact cache
-> Actual Provider or Mock fallback
-> Request Log / Detail / Dashboard / Metrics / evidence
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

아래 값은 API response, DB record, fixture, structured log, metric label, UI, release evidence에 평문으로 남기지 않는다.

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

## 4. Work Rules

- 작업 범위가 계약/API/DB/Event/Metrics/Security-sensitive field에 닿으면 먼저 `specs/gateway/v2.0.0/contracts.md`를 확인한다.
- 새 API route, DB column, Event field, Metrics label은 계약과 schema/fixture 근거 없이 만들지 않는다.
- legacy field는 바로 삭제하지 말고 compatibility bridge 여부를 확인한다.
- archive/draft 문서를 현재 계약처럼 승격하지 않는다.
- 기존 smoke나 verifier가 깨지면 원인을 설명하고 복구하거나 명시적으로 범위를 조정한다.
- 다른 사람의 변경을 되돌리지 않는다.
- repo의 기존 패턴과 모듈 경계를 우선한다.

## 5. Verification Baseline

기본 검증은 아래를 우선한다.

```powershell
git diff --check
corepack pnpm run verify:v2-docs
corepack pnpm run verify:v2-final
```

영향 범위에 따라 추가로 실행한다.

```powershell
pnpm --filter @gatelm/control-plane-api typecheck
pnpm --filter @gatelm/web typecheck
pnpm --filter @gatelm/application typecheck
go test ./...
```

공식 로컬/CI/agent 기준은 Node `22`, pnpm `9.15.0`이다.

## 6. Planning Template

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
