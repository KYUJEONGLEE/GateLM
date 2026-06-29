# Hyeok - v2 Contract Dependencies

> Control Plane / RuntimeConfig / RuntimeSnapshot / Publish 관점의 계약 의존성 초안입니다.
> 이 문서는 공식 계약이 아니며, API/DB/Event/Metrics/Schema 필드를 확정하지 않습니다.

## 1. 내 역할의 v2 main path

Control Plane의 main path는 관리자가 수정한 정책을 검증하고, Gateway가 소비 가능한 immutable `RuntimeSnapshot`으로 publish하는 흐름입니다.

```text
RuntimeConfig draft 작성
-> validation
-> RuntimeSnapshot 생성
-> active snapshot pointer/cache 갱신
-> Gateway가 snapshot 소비
-> Request Detail에서 snapshot provenance 확인
```

핵심 원칙:

- `RuntimeConfig`는 편집본입니다.
- `RuntimeSnapshot`은 검증 후 publish된 Gateway 적용본입니다.
- Gateway는 draft config를 직접 소비하지 않습니다.
- DB는 source of truth입니다.
- Redis는 active snapshot pointer/cache 용도입니다.
- 실패 시 Gateway는 last loaded snapshot을 계속 사용합니다.

## 2. 내가 다른 역할에게 받아야 하는 계약

| 역할 | 받아야 하는 계약 |
| -- | -- |
| 지섭 / Gateway | Gateway가 실제로 소비할 RuntimeSnapshot 최소 shape, reload 방식, reload 실패 시 runtime state 표현 |
| 규민 / Web | Policy Editor와 Runtime 상태 UI가 구분해야 하는 상태 목록, Request Detail에서 보여줄 provenance 요구 |
| 윤지 / Safety | snapshot에 포함되어야 하는 safety policy 후보, request-side safety가 provider 호출 전 끝나기 위한 최소 설정 |
| 규정 / Observability | Request Log/Detail/Dashboard가 필요로 하는 snapshot provenance, runtimeState, publish/reload evidence |
| DB 담당 | RuntimeConfig, RuntimeSnapshot, publish job, active binding 저장 경계 |

## 3. 내가 다른 역할에게 제공해야 하는 계약

| 제공 계약 | 소비 역할 |
| -- | -- |
| RuntimeConfig와 RuntimeSnapshot의 의미 경계 | Gateway, Web, Observability, Safety |
| publish 가능한 snapshot metadata 후보 | Gateway, Web, Observability |
| validation/publish/reload 실패 상태 후보 | Web, Observability |
| active snapshot과 last known safe 기준 | Gateway, Observability |
| snapshot provenance 후보 | Request Log, Request Detail, Dashboard |
| official contract 승격 전 가드레일 | 모든 역할 |

## 4. 내가 막히는 dependency

- Gateway가 snapshot을 어떤 방식으로 로드할지 정해지지 않으면 publish 경계를 확정하기 어렵습니다.
- Observability가 Request Detail에 필요한 provenance 최소 세트를 정하지 않으면 snapshot metadata가 과하거나 부족해질 수 있습니다.
- Safety/routing/cache/budget/provider 정책이 snapshot 안에서 어떤 구조로 들어갈지 역할별 최소 요구가 필요합니다.
- Identity/Budget Scope가 확정되지 않으면 snapshot lookup key와 active binding key가 흔들립니다.

## 5. 내가 늦어지면 막히는 다른 역할

- Gateway는 검증된 RuntimeSnapshot 소비 경로를 붙이기 어렵습니다.
- Web은 policy publish, validation failed, last known safe 상태를 화면에 설명하기 어렵습니다.
- Observability는 요청이 어떤 정책으로 처리됐는지 Request Detail과 Dashboard에 연결하기 어렵습니다.
- Safety는 어떤 safety policy가 적용됐는지 evaluation/corpus 결과와 연결하기 어렵습니다.

## 6. 계약 확정 전 병렬 shadow/evidence 작업

- static RuntimeSnapshot fixture 작성
- validation success/failure fixture 작성
- publish failed / reload failed / last known safe 시나리오 문서화
- Redis active pointer key 후보 실험
- Request Detail용 provenance sample 작성
- raw secret 없는 sanitized snapshot sample 작성
- Gateway reload smoke용 fake snapshot 만들기

## 7. P0로 먼저 확정해야 하는 항목

1. `RuntimeConfig`와 `RuntimeSnapshot`의 경계
2. Gateway가 소비할 RuntimeSnapshot 최소 shape
3. active snapshot lookup key 기준
4. publish/reload 실패 상태 표현
5. last known safe의 의미
6. Request Detail에 남길 snapshot provenance 최소 세트
7. snapshot에 포함할 policy 범위: safety/routing/cache/rate/budget/provider
8. client-provided budgetScope를 신뢰하지 않는 검증 흐름

## 8. 아직 공식 필드로 확정하면 안 되는 후보 용어

아래 이름은 contracts.md 확정 전까지 후보로만 둡니다.

```text
runtimeSnapshotId
runtimeSnapshotVersion
policyVersion
contentHash
configHash
runtimeState
gatewayInstanceId
activeSnapshotId
lastKnownSafeSnapshotId
publishState
reloadState
validationResult
```

주의:

- `team-debate`나 역할별 `readme.md`에 적힌 이름을 바로 DB column/API field로 박지 않습니다.
- 공식 field는 `docs/v2.0.0/contracts.md`에서만 확정합니다.
- secret, raw prompt, raw response, provider key, authorization header는 snapshot/fixture/log에 넣지 않습니다.

## 9. 첫 구현 PR로 쪼갤 수 있는 단위

| PR 후보 | 내용 |
| -- | -- |
| PR-1 | RuntimeConfig/RuntimeSnapshot 용어와 최소 fixture 문서화 |
| PR-2 | RuntimeSnapshot immutable 저장 테이블 또는 repository 초안 |
| PR-3 | active snapshot binding과 Redis pointer/cache 초안 |
| PR-4 | publish validation success/failure 상태 모델 초안 |
| PR-5 | Gateway가 static snapshot fixture를 읽는 thin slice |
| PR-6 | Request Detail에 snapshot provenance를 보여주는 fixture/read model |

## 10. 추가 검토 필요

- Employee Chat이 browser direct로 Gateway를 호출할지, Web BFF/server-side로 호출할지
- active snapshot key를 `tenant/project/application` 기준으로 할지, budgetScope까지 포함할지
- 일부 Gateway만 reload 성공했을 때 Web/Observability에 어떻게 표시할지
- `policyVersion`, `configHash`, `contentHash` 중 무엇을 최소 provenance로 둘지
- P0 legacy field cleanup에서 기존 `configHash`, `securityPolicyHash`, `routingPolicyHash`를 어떻게 v2 provenance로 연결할지
