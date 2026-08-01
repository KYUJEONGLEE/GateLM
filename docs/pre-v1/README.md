# GateLM Pre-v1 Workstream Registry

| Field | Value |
|---|---|
| Status | Active migration index |
| Authority | 정식 제품 릴리스 전 작업명과 현재 사용 범위의 분류 |
| Current release state | Unreleased development |
| Target product release | 리팩토링과 전체 release gate 완료 후 `v1.0.0` |
| Official release history | GitHub Release `v0.0.1` |
| Contract effect | API/DB/Event/Metrics/Security 의미 변경 없음 |

이 문서는 과거 폴더명을 새 제품 버전으로 해석하지 않도록 연결하는
마이그레이션 지도다. 현재 작업의 진입점과 계약 권위는 계속
[`../current/README.md`](../current/README.md)와
[`../current/contract-map.md`](../current/contract-map.md)가 소유한다.

## Legacy Workstream Map

| 기존 경로 | former label | 현재 분류 | 사용 규칙 |
|---|---|---|---|
| [`../v1.0.0/`](../v1.0.0/) | `v1.0.0` | Pre-v1 historical contract freeze | 회귀와 이력 조사 전용. 새 공식 v1 계약 또는 릴리스 문서로 덮어쓰지 않음 |
| [`../v2.0.0/`](../v2.0.0/) | `v2.0.0` | Pre-v1 historical compatibility workstream | current 대체 계약이 없는 행동 의미만 제한적으로 확인 |
| [`../v2.1.0/`](../v2.1.0/) | `v2.1.0` | Pre-v1 Self-host·Routing scoped workstream | current contract map이 연결한 범위에서만 사용 |

위 label은 내부 개발 순서를 나타낸 과거 작업명이다. Git tag나 GitHub Release,
전체 제품 구현 완료 또는 GA를 뜻하지 않는다.

## Version Boundary

다음 표기는 제품 SemVer와 독립적이므로 이 마이그레이션에서 바꾸지 않는다.

- public API `/v1`
- `tenant-chat/v1`
- event와 schema의 `v1`, `v2`
- routing policy와 RuntimeSnapshot schema version
- dataset, model artifact, manifest와 provenance version
- Go module dependency의 major version

## Why Paths Stay Temporarily

기존 경로는 문서 링크만이 아니라 fixture import, Docker `COPY`, 평가 도구,
schema `$id`, manifest source path와 artifact hash에 연결돼 있다. 따라서 이번
문서 정리에서 폴더를 기계적으로 이동하거나 모든 `v1`/`v2` 문자열을 치환하지
않는다.

물리 경로 정리는 다음 순서의 별도 마이그레이션으로 진행한다.

1. 실행 코드와 검증기의 release-named fixture 경로 의존성을 조사하고 분리한다.
2. 현재 유효한 계약을 `docs/gateway/`, `docs/self-host/` 같은 기능 범위로 승격한다.
3. 과거 plan, checklist와 evidence를 `docs/archive/pre-v1/`로 이동한다.
4. 링크, schema `$id`, manifest source path와 hash/provenance 영향을 검증한다.
5. 호환 기간이 끝난 legacy alias와 검증 명령을 제거한다.

## v1.0.0 Release Snapshot

`docs/releases/v1.0.0/`은 실제 release candidate SHA가 확정된 뒤에만 만든다.
이 폴더에는 계약 원문을 복제하지 않고 다음을 고정한다.

- exact source commit과 release tag
- active contract 목록과 필요한 artifact hash
- package와 image version 정책
- 전체 release gate 명령, 결과와 제외 범위
- migration, rollback, backup/restore와 security evidence
- 알려진 제한과 기능별 maturity

리팩토링 계획이나 일부 문서 검증만 통과한 상태에서는 `v1.0.0` 릴리스
snapshot, tag 또는 GA를 선언하지 않는다.
