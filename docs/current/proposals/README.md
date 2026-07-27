# GateLM Current Proposal Registry

| Field | Value |
|---|---|
| Status | Active proposal registry |
| Authority | contract lifecycle, non-contract role과 파일 존재 여부 |
| Development baseline | `origin/dev @ e54d35b94d0409cf4b6ceba8036735f1ee7afe6e` |
| Last verified | 2026-07-27 |
| Contract effect | proposal을 active contract로 승격하지 않음 |

이 목록은 `docs/current/proposals/`의 계약 lifecycle과 비계약 문서 역할을
서로 다른 축으로 관리한다. 파일명이나 구현 존재만으로 계약 권위를 부여하지
않으며, 현재 권위 범위는 [`../contract-map.md`](../contract-map.md)에서만
판별한다.

## Contract Lifecycle

### Proposed

아직 owner approval과 current 승격이 끝나지 않은 계약 후보다.

| 문서 | 역할 | 현재 권위 |
|---|---|---|
| [`analytics-cache-surface-contract.md`](analytics-cache-surface-contract.md) | Contract proposal with feature-branch implementation | Non-authoritative |
| [`analytics-policy-impact-data-contract.md`](analytics-policy-impact-data-contract.md) | Contract proposal with feature-branch implementation | Non-authoritative |
| [`control-plane-account-recovery-contract.md`](control-plane-account-recovery-contract.md) | Contract proposal with implementation | Non-authoritative |
| [`dashboard-live-snapshot-polling-contract.md`](dashboard-live-snapshot-polling-contract.md) | Contract proposal and implementation companion | Non-authoritative |
| [`p0-invocation-log-monthly-partitioning.md`](p0-invocation-log-monthly-partitioning.md) | Contract proposal | Non-authoritative |
| [`tenant-unified-reliability-read-contract.md`](tenant-unified-reliability-read-contract.md) | Contract proposal; owner approval 전 비활성 | Non-authoritative |
| [`unified-analytics-performance-contract.md`](unified-analytics-performance-contract.md) | Contract proposal with feature-branch implementation | Non-authoritative |

### Accepted

현재 registry에 Accepted lifecycle 문서는 없다.

### Active

현재 registry에 Active lifecycle 문서는 없다. Active 계약은 이 폴더 목록이
아니라 [`../contract-map.md`](../contract-map.md)가 범위별로 연결한다.

### Superseded

| 문서 | 대체 관계 | 현재 권위 |
|---|---|---|
| [`tenant-employee-cost-policy-contract.md`](tenant-employee-cost-policy-contract.md) | Tenant Chat employee weekly token quota contract가 대체 | Historical reference only |

### Archived

현재 registry에 Archived lifecycle 계약 문서는 없다.

## Non-contract Documents

아래 분류는 계약 lifecycle이 아니라 문서 역할이다. Contract lifecycle은
`N/A`이며 구현 또는 참고 자료가 존재해도 API/DB/Event/Metrics/Security
변경 권한을 갖지 않는다.

### Implementation Companion

| 문서 | 역할 | Contract lifecycle | 현재 권위 |
|---|---|---|---|
| [`analytics-live-project-traffic-contract.md`](analytics-live-project-traffic-contract.md) | Implementation companion proposal | N/A | Non-authoritative |
| [`clickhouse-analytics-mirror-contract.md`](clickhouse-analytics-mirror-contract.md) | Multi-phase implementation companion | N/A | Non-authoritative |
| [`dashboard-observability-rollup-contract.md`](dashboard-observability-rollup-contract.md) | Feature-branch implementation behind rollout controls | N/A | Non-authoritative |
| [`employee-security-analytics-contract.md`](employee-security-analytics-contract.md) | Implementation companion proposal | N/A | Non-authoritative |
| [`employee-unified-usage-contract.md`](employee-unified-usage-contract.md) | Implementation companion proposal | N/A | Non-authoritative |

### Planning Baseline

| 문서 | 용도 | Contract lifecycle | 현재 권위 |
|---|---|---|---|
| [`v1-release-candidate-refactoring-baseline.md`](v1-release-candidate-refactoring-baseline.md) | target `v1.0.0` 준비 리팩토링 순서와 검증 경계 | N/A | Planning only |

### Reference And Handoff

| 문서 | 용도 | Contract lifecycle | 현재 권위 |
|---|---|---|---|
| [`employee-unified-usage-frontend-handoff.md`](employee-unified-usage-frontend-handoff.md) | Frontend integration note | N/A | Reference only |
| [`legacy-application-chat-employee-guard-notes.md`](legacy-application-chat-employee-guard-notes.md) | 기존 Application Chat 동결 경계 | N/A | Reference only |

## Registry Rules

1. 새 계약 proposal은 Contract Lifecycle에 등록하고 원문 상단에 Status와
   Applies to를 둔다.
2. implementation companion, planning baseline, reference와 handoff는
   Non-contract Documents에 역할로 등록한다.
3. owner가 승인해도 [`../contract-map.md`](../contract-map.md)에서 해당
   범위를 Active로 연결하기 전에는 current active contract가 아니다.
4. 승격 PR은 대체하는 문서, compatibility 기간, schema/fixture와 구현 gate를
   함께 기록한다.
5. Superseded 문서는 current 후보 목록에 다시 노출하지 않는다.
6. archive 이동은 링크와 이력 보존 계획을 별도 검토한 뒤 수행한다.
