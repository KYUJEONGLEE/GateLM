# GateLM Pre-v1 Historical Contract Freeze (former v1.0.0)

| Field | Value |
|---|---|
| Status | Pre-v1 historical contract freeze |
| Former label | `v1.0.0`; 정식 v1 제품 릴리스가 아님 |
| Active entrypoint | [`../current/README.md`](../current/README.md) |
| Pre-v1 registry | [`../pre-v1/README.md`](../pre-v1/README.md) |
| Change policy | 상태 설명, errata와 회귀 호환성 주석만 허용 |

이 폴더는 초기 MVP 설계와 fixture를 보존한다. 현재 구현과 다른 가정이 포함돼
있으며, 리팩토링 완료 후 목표인 공식 `v1.0.0` 계약이나 릴리스 문서로
재사용하거나 덮어쓰지 않는다.

## Contents

| Path | Current role |
|---|---|
| `contracts.md` | 초기 행동 계약의 historical snapshot |
| `additional-contracts-by-role.md` | 역할별 초기 계약 보충 자료 |
| `remote-safety-engine-contract.md` | 초기 remote safety 경계 |
| `schemas/`, `fixtures/` | 일부 테스트와 Docker build가 참조하는 legacy fixture |
| `implementation-plan.md` | Historical implementation plan |
| `demo-scenario.md` | Point-in-time demo scenario |

## Usage Rule

1. 현재 작업은 [`../current/README.md`](../current/README.md)에서 시작한다.
2. 이 폴더는 회귀 조사나 legacy fixture consumer 확인에만 사용한다.
3. 현재 계약과 충돌하면 이 문서로 코드를 되돌리지 않는다.
4. 새 v1 release snapshot은 실제 release SHA가 확정된 뒤
   `docs/releases/v1.0.0/`에 별도로 만든다.
5. fixture를 이동하기 전에는 TypeScript import, Docker `COPY`, Safety test와
   검증 스크립트의 모든 consumer를 먼저 분리한다.
