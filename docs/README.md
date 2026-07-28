# GateLM Documentation Guide

이 문서는 GateLM 개발자와 구현 에이전트를 위한 문서 라우터다. 제품의 현재 계약을 이 파일에 복제하지 않고, 작업 범위에 맞는 active 문서와 historical baseline을 연결한다.

## 1. Start Here

현재 작업은 항상 다음 세 문서로 시작한다.

1. [`docs/current/README.md`](current/README.md): 현재 문서 상태와 범위별 진입점
2. [`docs/current/source-of-truth.md`](current/source-of-truth.md): 문서 권한, 충돌 처리, 계약 변경 규칙
3. [`docs/current/contract-map.md`](current/contract-map.md): 범위별 active 계약과 proposal lifecycle

필요할 때만 다음 문서를 추가로 읽는다.

- [`docs/current/implementation-status.md`](current/implementation-status.md): 최신 `origin/dev` 기준 구현 사실
- [`docs/current/documentation-gaps.md`](current/documentation-gaps.md): 확인된 불일치와 사람 결정이 필요한 항목

일반 UI, 리팩터링, 버그 수정은 current 문서와 실제 코드/타입부터 확인한다. API, DB, Event, Metrics, 보안 필드의 의미를 바꾸는 작업만 해당 계약과 schema/fixture를 추가로 읽는다.

## 2. Documentation Status

| Path | Status | Authority | 사용 방법 |
|---|---|---|---|
| `docs/current/` | Active | 현재 문서 라우팅과 구현 스냅샷 | 모든 작업의 첫 진입점 |
| `docs/tenant-chat/` | Active scoped contract | 신규 Tenant Chat API/DB/Event/Metrics/Security 계약 | Tenant Chat 작업에서 current router를 통해 사용 |
| `docs/pre-v1/` | Active migration index | 과거 release-like workstream의 상태와 이관 순서 | v1/v2 폴더를 해석하기 전에 확인 |
| `docs/v2.1.0/` | Pre-v1 scoped workstream | Self-host delivery와 Advanced Routing offline evidence | current contract map이 연결한 범위에서만 사용 |
| `docs/v2.0.0/` | Pre-v1 historical baseline | 아직 대체되지 않은 행동 계약의 compatibility 기준 | current 문서가 연결할 때만 사용 |
| `docs/v1.0.0/` | Pre-v1 historical freeze | 초기 계약과 legacy fixture | 회귀/이력 조사에만 사용; 새 v1 문서로 덮어쓰지 않음 |
| `docs/architecture/` | Supporting reference | 설계 배경 | 현재 코드와 계약으로 재검증 |
| `docs/policies/` | Supporting policy | 코딩, 비용, PII 정책 | current 계약과 충돌 시 current 우선 |
| `docs/testing/` | Design/evidence | 특정 시점의 실험, 테스트, 결과 | 날짜와 commit 범위를 확인 |
| `docs/reference/` | Reference/draft | 장기 설계와 후보 계획 | 계약 권한 없음 |
| `docs/archive/` | Archived | 과거 기록 | 현재 기준 선언에 사용 금지 |

`current`는 새 계약을 복사해 두는 폴더가 아니다. 현재 어떤 scoped contract와 pre-v1 문서가 어느 범위에서 유효한지 설명하는 안정적인 진입점이다.

## 3. Source Of Truth Rules

문서가 충돌하면 다음 순서를 적용한다.

1. `docs/current/source-of-truth.md`의 상태와 범위 분류
2. current 문서가 해당 범위에 지정한 active contract
3. 해당 범위의 versioned contract와 schema/fixture
4. 명시적으로 상속된 baseline compatibility
5. architecture, policy, testing evidence, reference, archive

코드와 테스트는 현재 구현을 확인하는 evidence다. 계약과 코드가 다르면 코드를 자동으로 계약으로 승격하거나 과거 계약으로 코드를 되돌리지 않는다. 차이를 기록하고 별도 계약 결정을 요청한다.

## 4. Release Version Policy

현재 `dev` 개발본은 `Unreleased`이고, 리팩토링과 전체 release gate 완료 후 목표 제품 버전은 `v1.0.0`이다.

- 공식 GitHub 최신 릴리스: `v0.0.1`
- target product release: `v1.0.0`
- root package version: `0.0.0`
- app package versions: 일부 `0.1.0`
- 현재 개발 통합 브랜치: `dev`
- 기존 `docs/v1.0.0`, `v2.0.0`, `v2.1.0`: pre-v1 내부 workstream label

목표 버전이 정해졌다는 사실만으로 현재 dev를 v1.0.0이라고 부르지 않는다. exact release SHA, tag, package/image/docs 정렬과 전체 release evidence는 별도 gate에서 고정한다.

## 5. Scoped And Pre-v1 Documentation

### Tenant Chat active scope

[`docs/tenant-chat/README.md`](tenant-chat/README.md)를 먼저 읽는다. 이 scope는 release SemVer와 독립된 `tenant-chat/v1` contract이며, 기존 Project/Application Chat과 분리된 신규 제품의 계약·schema·fixture·구현 계획·통합 handoff를 제공한다.

독립 `chat-web`, `chat-api`, private Gateway, encrypted history와 usage ledger는 계약상 목표이며 현재 구현 사실은 `docs/current/implementation-status.md`에서 별도로 확인한다.

### Pre-v1 Self-host and Routing workstream (former v2.1.0)

[`docs/v2.1.0/README.md`](v2.1.0/README.md)를 먼저 읽는다.

former v2.1.0 문서는 두 가지 pre-v1 범위를 포함한다.

- Single-node Docker Compose self-host delivery
- Advanced/category routing offline evaluation evidence

이 폴더는 정식 v2 제품 릴리스를 뜻하지 않으며, 최근 UI, 직원 통제, 정책 관리 등 전체 제품을 포괄하는 계약도 아니다.

### Pre-v1 compatibility workstream (former v2.0.0)

[`docs/v2.0.0/README.md`](v2.0.0/README.md)에서 문서별 상태를 확인한다.

former v2.0.0 workstream은 출시되지 않은 historical baseline이다. 다음 항목은 아직 명시적으로 대체되지 않은 영역의 compatibility 검토에 사용한다.

1. `docs/v2.0.0/contracts.md`
2. `docs/v2.0.0/schemas/*.schema.json`
3. `docs/v2.0.0/fixtures/*.fixture.json`

아래 구현 문서는 과거 plan/criteria이며 current 작업 목록이나 전체 완료 증거가 아니다.

- `docs/v2.0.0/implementation-plan.md`
- `docs/v2.0.0/implementation-tasks.md`
- `docs/v2.0.0/implementation-pr-packets.md`
- `docs/v2.0.0/acceptance-test-matrix.md`
- `docs/v2.0.0/db-migration-plan.md`

## 6. Contract-Sensitive Work

다음 범위를 변경하면 current 문서에서 해당 계약을 찾고, 필요한 경우 baseline compatibility를 함께 확인한다.

- API route 또는 request/response field
- DB table, column, enum, migration
- Event payload 또는 version
- Metrics name 또는 label
- RuntimeSnapshot/RuntimeConfig 의미
- Provider/Model catalog 및 credential 경계
- Request Log/Detail/Dashboard outcome 의미
- raw prompt/response, secret, 개인정보 등 Security-sensitive field

현재 계약이 없는 경우 구현부터 하지 않는다. `docs/current/documentation-gaps.md`에 후보를 기록하고 계약 문서 또는 문서 PR을 먼저 제안한다.

## 7. Security Rules

아래 값은 DB, log, fixture, API response, metric label, UI에 평문으로 남기지 않는다.

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

실제 secret이나 개인정보처럼 보이는 값은 seed, test, snapshot, fixture에도 넣지 않는다.

## 8. Verification

문서와 진입점을 변경하면 다음을 실행한다.

```powershell
git diff --check
corepack pnpm run verify:docs
```

v2.1 category evaluation 계약, schema 또는 fixture를 변경하면 다음도 실행한다.

```powershell
corepack pnpm run verify:v2.1-category-eval
```

v2.1 difficulty evaluation 계약, schema 또는 fixture를 변경하면 다음도 실행한다.

```powershell
corepack pnpm run verify:v2.1-difficulty-eval
```

`verify:docs`는 current entrypoint, pre-v1 상태 README, baseline schema/fixture와 관리 대상 상대 링크를 검증한다. 저장소 전체 Markdown anchor 검사는 아직 별도 범위다.
