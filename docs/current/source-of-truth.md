# GateLM Current Source Of Truth

| Field | Value |
|---|---|
| Status | Active |
| Authority | 문서 상태, 읽기 순서, 계약 변경 절차 |
| Last verified | 2026-07-11 |

## 1. Authority Model

GateLM은 current 계약을 versioned 계약과 별도로 복제하지 않는다. 문서 권한은 범위별로 연결한다.

| Priority | Document class | Authority |
|---:|---|---|
| 1 | `docs/current/` | 현재 문서 상태와 범위 라우팅 |
| 2 | current가 지정한 active contract | 해당 범위의 계약 의미 |
| 3 | 해당 범위의 versioned contract/schema/fixture | versioned 범위의 계약과 검증 데이터 |
| 4 | inherited baseline compatibility | 아직 대체되지 않은 과거 행동 계약 |
| 5 | architecture/policy | 설계와 운영 원칙의 보조 근거 |
| 6 | testing/evidence | 특정 commit과 환경에서 관찰한 결과 |
| 7 | reference/archive | 후보 설계와 과거 이력 |

`docs/current/implementation-status.md`와 현재 코드/테스트는 as-built evidence다. 코드가 문서와 다르다는 이유만으로 코드가 자동으로 계약이 되지는 않는다.

## 2. Active Scope Map

### Documentation governance

이 문서와 [`README.md`](README.md)가 active 기준이다.

### Self-host delivery

다음 v2.1.0 문서는 역할을 구분해서 사용한다.

- [`../v2.1.0/contracts.md`](../v2.1.0/contracts.md): versioned self-host contract
- [`../v2.1.0/production-images.md`](../v2.1.0/production-images.md): versioned image target reference
- [`../v2.1.0/implementation-plan.md`](../v2.1.0/implementation-plan.md): versioned planning reference
- [`../v2.1.0/implementation-tasks.md`](../v2.1.0/implementation-tasks.md): versioned task plan/reference
- [`../v2.1.0/acceptance-test-matrix.md`](../v2.1.0/acceptance-test-matrix.md): versioned acceptance criteria

plan/task/acceptance는 current backlog나 완료 evidence가 아니다. 실제 fresh-host evidence와 release 결정은 별도로 확인한다.

### Advanced Routing offline evidence

다음 v2.1.0 문서를 해당 offline 평가 범위에서 사용한다.

- [`../v2.1.0/category-evaluation-dataset-contract.md`](../v2.1.0/category-evaluation-dataset-contract.md)
- [`../v2.1.0/schemas/category-evaluation-record.schema.json`](../v2.1.0/schemas/category-evaluation-record.schema.json)
- `../v2.1.0/fixtures/*.fixture.jsonl`
- [`../v2.1.0/routing-advanced-plan.md`](../v2.1.0/routing-advanced-plan.md)
- [`../v2.1.0/routing-performance-test-scenario.md`](../v2.1.0/routing-performance-test-scenario.md)
- [`../v2.1.0/routing-random-probe.md`](../v2.1.0/routing-random-probe.md)

이 범위는 Gateway hot path의 새 API/DB/Event/Metrics 계약을 만들지 않는다.

### Gateway behavior compatibility

Gateway, RuntimeSnapshot, Provider, Request Log, Dashboard, API, DB, Event, Metrics, Security-sensitive field에서 current 대체 계약이 없는 부분은 [`../v2.0.0/README.md`](../v2.0.0/README.md)의 baseline compatibility 분류를 확인한다.

v2.0.0 implementation plan, tasks, PR packets는 historical plan/record다. 새 작업의 순서나 branch 이름을 지시하지 않는다.

## 3. Conflict Handling

문서끼리 또는 문서와 코드가 충돌하면 다음 절차를 따른다.

1. 각 문서의 Status, Authority, Applies to, Last verified를 확인한다.
2. current scope map에 명시된 문서인지 확인한다.
3. 현재 `origin/dev` 코드와 테스트에서 실제 동작을 확인한다.
4. 차이를 [`documentation-gaps.md`](documentation-gaps.md)에 기록한다.
5. 계약 의미가 바뀌면 구현 PR과 분리된 문서/계약 변경 후보를 만든다.
6. 합의 전에는 과거 계약으로 현재 코드를 되돌리거나 현재 코드를 새 계약으로 선언하지 않는다.

## 4. Contract Change Gate

다음 변경은 contract-sensitive다.

- API route와 request/response field
- DB table, column, enum, migration semantics
- Event payload와 version
- Metrics name과 label
- RuntimeConfig/RuntimeSnapshot 의미
- Provider/Model/credential 경계
- Request Log/Detail/Dashboard outcome 의미
- raw prompt/response, secret, 개인정보 등 보안 민감 필드

contract-sensitive 변경은 다음 근거 중 하나가 필요하다.

- current active contract 변경
- versioned overlay contract 변경
- inherited baseline을 대체하는 명시적 contract proposal

기능 PR 안에서 문서 의미를 암묵적으로 바꾸지 않는다.

## 5. Development Branch Evidence

현재 관찰된 통합 흐름은 feature/fix/docs 브랜치에서 `dev` 대상 PR을 만들고, 검증된 `dev`를 별도 PR로 `main`에 승격하는 방식이다.

브랜치 흐름은 계약이 아니므로 변경될 수 있다. 작업 시작 시 최신 `origin/dev`와 PR base를 다시 확인한다.
