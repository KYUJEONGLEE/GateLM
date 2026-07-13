# GateLM Agent Guide

이 문서는 GateLM에서 Codex, Claude Code 같은 구현 에이전트가 작업을 시작할 때 따르는 기준이다.

GateLM의 현재 개발 상태는 하나의 확정된 SemVer로 선언되어 있지 않다. 공식 GitHub 최신 릴리스는 `v0.0.1`이고, 현재 제품 개발은 `dev` 브랜치에서 계속 진행된다. `v2.0.0` workstream은 더 이상 active가 아니며 문서는 historical behavior baseline으로 남는다. 최신 versioned 문서는 `v2.1.0` 범위까지 존재한다.

현재 작업의 고정 진입점은 `docs/current/README.md`다. 버전이 바뀌어도 에이전트의 첫 진입 경로는 이 파일을 유지한다.

## 1. Reading Order And Source Of Truth

모든 작업은 아래 두 문서로 시작한다.

1. `docs/current/README.md`
2. `docs/current/source-of-truth.md`

그다음 scope router에 따라 필요한 문서만 추가로 읽는다.

- 현재 구현 사실을 확인할 때: `docs/current/implementation-status.md`
- 문서/코드 충돌이나 미결정 사항이 있을 때: `docs/current/documentation-gaps.md`
- 계약 민감 작업일 때: current 문서가 연결한 contract, schema, fixture

일반 UI, 리팩터링, 버그 수정은 실제 코드와 타입을 먼저 확인한다. 계약/API/DB/Event/Metrics/Security-sensitive field에 닿지 않는 작업 때문에 과거 v2 구현 계획을 먼저 읽지 않는다.

문서 권한은 다음 원칙으로 판단한다.

1. `docs/current/source-of-truth.md`의 문서 상태와 범위 분류
2. current 문서가 해당 작업 범위에 명시적으로 지정한 active contract
3. 해당 범위의 versioned contract 또는 schema/fixture
4. 명시적으로 상속된 baseline compatibility 문서
5. architecture, policy, testing evidence, reference, archive

현재 versioned 범위는 다음처럼 사용한다.

- `docs/tenant-chat/`: 신규 Tenant Chat의 active scoped contract다. release SemVer와 독립되며 `docs/current` scope router가 연결한다.
- `docs/v2.1.0/`: 최신 versioned 문서 범위다. Self-host delivery와 Advanced Routing offline evidence 작업에 한해 사용한다.
- `docs/v2.0.0/`: 닫힌 historical workstream의 behavior baseline이다. 새 기능의 roadmap이나 착수 계획으로 사용하지 않는다.
- `docs/v1.0.0/`: 더 오래된 compatibility/history 문서다.

아직 current 계약으로 대체되지 않은 Gateway/API/DB/Event/Metrics/Security 의미를 검토할 때만 아래 v2.0.0 기준을 baseline compatibility로 확인한다.

1. `docs/v2.0.0/contracts.md`
2. `docs/v2.0.0/schemas/*.schema.json`
3. `docs/v2.0.0/fixtures/*.fixture.json`

위 목록은 호환성 기준이다. v2.0.0의 공식 release 또는 전체 구현 완료를 증명하는 목록은 아니다.

다음 문서는 historical plan/criteria로만 사용한다.

- `docs/v2.0.0/implementation-plan.md`
- `docs/v2.0.0/implementation-tasks.md`
- `docs/v2.0.0/implementation-pr-packets.md`
- `docs/v2.0.0/acceptance-test-matrix.md`
- `docs/v2.0.0/db-migration-plan.md`

문서와 현재 코드가 충돌하면 어느 한쪽을 추측으로 진실로 만들지 않는다. 차이를 `docs/current/documentation-gaps.md`에 기록하고, 계약 변경은 별도 문서/계약 PR 후보로 분리한다.

## 2. Current Development Path

현재 저장소의 기본 통합 흐름은 다음과 같다.

```text
feature / fix / docs branch
-> dev 대상 PR
-> 검증과 리뷰
-> 주기적인 dev -> main 승격 PR
```

새 작업은 최신 `origin/dev`를 확인한 뒤 분리 브랜치에서 시작한다. 열린 PR이나 원격 feature 브랜치의 내용은 `dev`에 병합되기 전까지 current 구현으로 간주하지 않는다.

현재 구현 범위와 검증 기준일은 `docs/current/implementation-status.md`에서 확인한다. 이 문서는 구현 스냅샷이지 새 API/DB/Event/Metrics 계약이 아니다.

## 3. Contract Change Rules

- 새 API route, DB column, Event field, Metrics label, Security-sensitive field는 근거 계약 없이 만들지 않는다.
- Tenant Chat 관련 계약 민감 작업은 `docs/tenant-chat/README.md`와 `contracts.md`부터 읽는다.
- current 계약이 없고 v2 baseline만 있는 영역은 baseline 호환성을 확인한 뒤 current 계약 제안부터 만든다.
- 기능 PR에 계약 의미 변경을 몰래 섞지 않는다.
- legacy field는 바로 삭제하지 말고 compatibility bridge 여부를 확인한다.
- Provider와 Model은 catalog/config data로 유지하며 DB enum 또는 code enum으로 고정하지 않는다.
- Gateway는 client-provided budget scope를 신뢰하지 않는다.
- Gateway runtime policy 변경은 현재 코드와 published RuntimeSnapshot 경계를 함께 확인한다.

## 4. Forbidden Data

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

## 5. Work Rules

- 다른 사람의 변경을 되돌리지 않는다.
- repo의 기존 패턴, 타입, 모듈 경계를 우선한다.
- 문서에 적혀 있다는 이유만으로 현재 구현 사실이라고 단정하지 않는다.
- 코드가 존재한다는 이유만으로 GA, production-ready, release-complete라고 단정하지 않는다.
- 특정 시점의 branch/PR/evidence는 기준 날짜와 commit을 함께 기록한다.
- versioned 문서는 자동으로 active가 되지 않는다. `docs/current/README.md`에서 상태를 승격해야 한다.
- release version은 tag, release, package metadata가 합의되기 전까지 임의로 만들지 않는다.

## 6. Verification Baseline

문서 변경의 기본 검증은 다음과 같다.

```powershell
git diff --check
corepack pnpm run verify:v2-docs
```

v2.1 routing dataset/schema/fixture에 닿으면 추가로 실행한다.

```powershell
corepack pnpm run verify:v2.1-category-eval
```

제품 구현을 넓게 변경하면 영향 범위에 따라 실행한다.

```powershell
corepack pnpm run verify:v2-final
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
