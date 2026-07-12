# GateLM v2.0.0 Documentation Status

| Field | Value |
|---|---|
| Status | Historical baseline |
| Lifecycle | Closed historical workstream; release/implementation completion not asserted |
| Active entrypoint | [`../current/README.md`](../current/README.md) |
| Change policy | 상태 설명, errata, compatibility annotation만 허용 |

이 폴더는 삭제하지 않는다. v2.0.0에서 합의한 행동 계약과 schema/fixture는 아직 대체되지 않은 영역의 baseline compatibility로 남기고, 구현 계획과 PR 문서는 과거 실행 evidence로 보존한다.

## Baseline Compatibility

| Path | Status | Use |
|---|---|---|
| `contracts.md` | Baseline contract | current 대체 계약이 없는 API/DB/Event/Metrics/Security 의미의 호환성 검토 |
| `schemas/*.schema.json` | Baseline schema | `contracts.md`에 종속되는 검증 shape |
| `fixtures/*.fixture.json` | Baseline fixture | schema pairing과 최소 compatibility evidence |
| `exact-cache-routing-aware-contract.md` | Supporting contract summary | `contracts.md`와 충돌 시 `contracts.md` 우선 |

baseline은 새 제품 roadmap이 아니다. 새 기능을 설계할 때 이 문서에서 필드나 구현 단계를 자동으로 복사하지 않는다.

## Historical Plans And Criteria

| Path | Status |
|---|---|
| `implementation-plan.md` | Historical plan |
| `implementation-tasks.md` | Historical task breakdown |
| `implementation-pr-packets.md` | Historical PR execution packets |
| `acceptance-test-matrix.md` | Historical acceptance criteria |
| `db-migration-plan.md` | Point-in-time migration plan |
| `demo-scenario.md` | Point-in-time demo/evidence runbook |
| `release-rc-checklist.md` | Historical RC checklist |
| `release-notes-v2.0.0-rc.md` | Unfinished RC release-note draft |

## Historical Drafts

- `p0-contract-decisions.md`
- `p0-legacy-field-cleanup.md`

이 문서들의 후보 표현은 current API, DB, Event, Metrics, schema field가 아니다.

## Usage Rule

1. 현재 작업은 [`../current/README.md`](../current/README.md)에서 시작한다.
2. current 문서가 baseline compatibility 확인을 요구할 때만 이 폴더를 연다.
3. 현재 코드와 baseline이 다르면 추측으로 하나를 선택하지 않는다.
4. 차이를 [`../current/documentation-gaps.md`](../current/documentation-gaps.md)에 기록한다.
5. 계약 의미 변경은 별도 current/versioned contract proposal로 처리한다.
