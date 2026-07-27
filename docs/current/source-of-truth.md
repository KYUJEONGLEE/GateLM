# GateLM Current Source Of Truth

| Field | Value |
|---|---|
| Status | Active |
| Authority | 문서 상태, 읽기 순서, 계약 변경 절차 |
| Last verified | 2026-07-27 |

## 1. Authority Model

GateLM은 current 계약을 versioned 계약과 별도로 복제하지 않는다. 문서 권한은 범위별로 연결한다.

| Priority | Document class | Authority |
|---:|---|---|
| 1 | `docs/current/README.md`, `source-of-truth.md`, `contract-map.md` | 문서 상태, lifecycle과 범위 라우팅만 결정 |
| 2 | contract map이 지정한 active scoped contract | 해당 범위의 현재 계약 의미 |
| 3 | 해당 active 또는 pre-v1 scoped 범위의 contract/schema/fixture | machine-readable 계약과 검증 데이터 |
| 4 | inherited baseline compatibility | 아직 current 계약으로 대체되지 않은 과거 행동 의미 |
| 5 | architecture/policy | 설계와 운영 원칙의 보조 근거 |
| 6 | implementation/testing/evidence | 특정 commit과 환경의 관찰 결과; 계약 아님 |
| 7 | proposal/reference/archive | 후보, 구현 동반 기록과 과거 이력; 비권위 |

`docs/current/implementation-status.md`와 현재 코드/테스트는 as-built evidence다. 코드가 문서와 다르다는 이유만으로 코드가 자동으로 계약이 되지는 않는다.

[`proposals/README.md`](proposals/README.md)는 current proposal의 lifecycle registry다. 그 안의 target v1.0.0 리팩토링 baseline을 포함한 모든 proposal은 [`contract-map.md`](contract-map.md)에서 Active로 승격되기 전까지 계약이 아니다.

### 1.1 Contract Lifecycle

| Lifecycle | 의미 | 계약 권위 |
|---|---|---|
| Proposed | 검토 중인 계약 후보 | 없음 |
| Accepted | owner가 방향을 승인했지만 current 승격 gate가 남음 | 명시된 검토 범위에만 제한 |
| Active | contract map이 현재 권위 진입점으로 연결 | 있음 |
| Superseded | 다른 active 계약이 대체 | 신규 작업 권위 없음 |
| Archived | 과거 결정과 evidence 보존 | 없음 |

`Implementation companion`, `planning baseline`, `reference`, `evidence`는 lifecycle이 아니라 문서 역할이다. 구현 존재나 feature branch 병합만으로 Proposed 또는 Accepted 문서가 Active가 되지 않는다.

### 1.2 Release Version Policy

현재 제품 상태는 `Unreleased`이며 리팩토링과 전체 release gate 완료 후 목표 버전은 `v1.0.0`이다. 기존 release-like 문서 폴더는 [`../pre-v1/README.md`](../pre-v1/README.md)의 workstream 분류를 따르며, 제품 SemVer나 GA 근거로 사용하지 않는다.

## 2. Active Scope Map

### Documentation governance

이 문서, [`README.md`](README.md)와 [`contract-map.md`](contract-map.md)가 문서 거버넌스의 active 기준이다.

### Tenant Chat Product

신규 Tenant Chat bounded context는 다음 문서를 active scoped contract로 사용한다.

- [`../tenant-chat/README.md`](../tenant-chat/README.md): 범위와 읽기 순서
- [`../tenant-chat/contracts.md`](../tenant-chat/contracts.md): API/DB/Event/Metrics/Security 계약
- `../tenant-chat/schemas/*.schema.json`: machine-readable integration schema
- `../tenant-chat/fixtures/*.fixture.json`: 민감정보 없는 계약 fixture
- [`../tenant-chat/implementation-plan.md`](../tenant-chat/implementation-plan.md): 구현 순서와 acceptance
- [`../tenant-chat/handoffs/employee-usage-integration.md`](../tenant-chat/handoffs/employee-usage-integration.md): Control Plane/Employee Usage 통합 경계

이 scope는 제품 release SemVer를 선언하지 않는다. 기존 Project/Application Chat과 public `/v1` 경로는 inherited compatibility로 보존한다. Tenant Chat 구현은 `origin/dev`에 존재하며, 현재 as-built 범위와 아직 연결되지 않은 end-to-end 경계는 [`implementation-status.md`](implementation-status.md)에서 구분한다. 구현 존재만으로 contract acceptance, release 완료 또는 GA를 선언하지 않는다.

### General Gateway routing

일반 Gateway의 category × difficulty 정책, auto/manual 요청 의미, RuntimeSnapshot routing, routing outcome과 provider-attempt 경계는 다음 active scoped contract를 사용한다.

- [`../routing/README.md`](../routing/README.md): 범위와 artifact 진입점
- [`../routing/contracts.md`](../routing/contracts.md): active 의미 계약
- [`../routing/classification-pipeline.md`](../routing/classification-pipeline.md): category·difficulty 분류의 active 내부 구현 계약
- [`../routing/schemas/routing-policy.schema.json`](../routing/schemas/routing-policy.schema.json): routing policy v2 schema
- [`../routing/fixtures/routing-policy.fixture.json`](../routing/fixtures/routing-policy.fixture.json): safe Mock bootstrap fixture
- [`../routing/schemas/runtime-snapshot-routing.schema.json`](../routing/schemas/runtime-snapshot-routing.schema.json): RuntimeSnapshot routing v2 schema

이 범위에서는 v2.0.0의 legacy category → tier → model, routingPolicy provider/model field, `selectedProvider`/`selectedModel` 계약을 상속하지 않는다. Tenant Chat의 별도 tier와 Provider Catalog의 `routing.costTier`는 이 scope 밖이다.

### Self-host delivery

다음 former v2.1.0 pre-v1 문서는 역할을 구분해서 사용한다.

- [`../v2.1.0/contracts.md`](../v2.1.0/contracts.md): versioned self-host contract
- [`../v2.1.0/production-images.md`](../v2.1.0/production-images.md): versioned image target reference
- [`../v2.1.0/implementation-plan.md`](../v2.1.0/implementation-plan.md): versioned planning reference
- [`../v2.1.0/implementation-tasks.md`](../v2.1.0/implementation-tasks.md): versioned task plan/reference
- [`../v2.1.0/acceptance-test-matrix.md`](../v2.1.0/acceptance-test-matrix.md): versioned acceptance criteria

plan/task/acceptance는 current backlog나 완료 evidence가 아니다. 실제 fresh-host evidence와 release 결정은 별도로 확인한다.

### Advanced Routing offline evidence

다음 former v2.1.0 pre-v1 문서를 해당 offline 평가 범위에서 사용한다.

- [`../v2.1.0/category-evaluation-dataset-contract.md`](../v2.1.0/category-evaluation-dataset-contract.md)
- [`../v2.1.0/schemas/category-evaluation-record.schema.json`](../v2.1.0/schemas/category-evaluation-record.schema.json)
- [`../v2.1.0/difficulty-evaluation-dataset-contract.md`](../v2.1.0/difficulty-evaluation-dataset-contract.md)
- [`../v2.1.0/schemas/difficulty-evaluation-record.schema.json`](../v2.1.0/schemas/difficulty-evaluation-record.schema.json)
- [`../v2.1.0/difficulty-label-guide.md`](../v2.1.0/difficulty-label-guide.md)
- [`../v2.1.0/schemas/difficulty-label-record.schema.json`](../v2.1.0/schemas/difficulty-label-record.schema.json)
- [`../v2.1.0/schemas/difficulty-label-dataset-manifest.schema.json`](../v2.1.0/schemas/difficulty-label-dataset-manifest.schema.json)
- [`../v2.1.0/schemas/difficulty-model-path-role-manifest.schema.json`](../v2.1.0/schemas/difficulty-model-path-role-manifest.schema.json)
- [`../v2.1.0/fixtures/difficulty-label-contract-smoke.manifest.json`](../v2.1.0/fixtures/difficulty-label-contract-smoke.manifest.json)
- [`../v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json`](../v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.smoke-manifest.json)
- `../v2.1.0/fixtures/*.fixture.jsonl`
- [`../v2.1.0/routing-advanced-plan.md`](../v2.1.0/routing-advanced-plan.md)
- [`../v2.1.0/routing-performance-test-scenario.md`](../v2.1.0/routing-performance-test-scenario.md)
- [`../v2.1.0/routing-random-probe.md`](../v2.1.0/routing-random-probe.md)

이 범위는 Gateway hot path의 새 API/DB/Event/Metrics 계약을 만들지 않는다.

### Gateway behavior compatibility

Gateway, RuntimeSnapshot, Provider, Request Log, Dashboard, API, DB, Event, Metrics, Security-sensitive field에서 current 대체 계약이 없는 부분은 [`../v2.0.0/README.md`](../v2.0.0/README.md)의 baseline compatibility 분류를 확인한다.

former v2.0.0 implementation plan, tasks, PR packets는 pre-v1 historical plan/record다. 새 작업의 순서나 branch 이름을 지시하지 않는다.

## 3. Conflict Handling

문서끼리 또는 문서와 코드가 충돌하면 다음 절차를 따른다.

1. 각 문서의 Status, Authority, Applies to, Last verified를 확인한다.
2. [`contract-map.md`](contract-map.md)가 해당 범위를 Active로 연결하는지 확인한다.
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
proposal을 Active로 승격하거나 active 계약을 대체·폐기할 때는 같은 contract PR에서 `contract-map.md`, 이 문서와 compatibility 경계를 함께 갱신한다.

## 5. Development Branch Evidence

현재 관찰된 통합 흐름은 feature/fix/docs 브랜치에서 `dev` 대상 PR을 만들고, 검증된 `dev`를 별도 PR로 `main`에 승격하는 방식이다.

브랜치 흐름은 계약이 아니므로 변경될 수 있다. 작업 시작 시 최신 `origin/dev`와 PR base를 다시 확인한다.
