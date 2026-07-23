# GateLM Current Documentation

| Field | Value |
|---|---|
| Status | Active documentation entrypoint |
| Applies to | 현재 GateLM 개발 작업 |
| Development baseline | `origin/dev` |
| Last verified | 2026-07-14 |
| Version policy | 다음 개발 SemVer 미확정 |

이 폴더는 GateLM의 새 계약을 복제하는 장소가 아니다. 현재 어떤 문서가 어느 범위에서 유효한지 알려주는 안정적인 진입점이다.

## Common Reading

1. [`source-of-truth.md`](source-of-truth.md): 문서 권한과 충돌 처리
2. 아래 범위 표에서 작업에 필요한 문서만 추가 확인

필요할 때만 다음 문서를 읽는다.

- [`implementation-status.md`](implementation-status.md): 현재 구현 사실을 확인할 때
- [`documentation-gaps.md`](documentation-gaps.md): 문서/코드 충돌이나 미결정 항목을 확인할 때
- [`technical-challenges.md`](technical-challenges.md): 현재 구현의 기술적 난제와 코드·테스트 근거를 설명할 때

Tenant Chat handoff 준비 자료는 계약이 아니라 검토 및 수신 도구다.

- [`tenant-chat-integration-impact-audit.md`](tenant-chat-integration-impact-audit.md): 기존 구조와의 충돌 지점
- [`tenant-chat-contract-intake-checklist.md`](tenant-chat-contract-intake-checklist.md): Chat 팀 계약 수신 체크리스트
- [`tenant-chat-v1-gateway-implementation-plan.md`](tenant-chat-v1-gateway-implementation-plan.md): Active 계약 기반 GateLM 구현 순서
- [`proposals/legacy-application-chat-employee-guard-notes.md`](proposals/legacy-application-chat-employee-guard-notes.md): 기존 Application Chat 동결 범위

현재 구현 PR과 함께 검토해야 하는 계약 후보는 다음과 같다. 병합 전까지 active 계약으로 간주하지 않는다.

- [`proposals/dashboard-observability-rollup-contract.md`](proposals/dashboard-observability-rollup-contract.md): Request-start TTFT와 Project/Application Dashboard hour/day/month rollup 구현 동반 계약
- [`proposals/control-plane-account-recovery-contract.md`](proposals/control-plane-account-recovery-contract.md): 로그인 ID 안내, 비밀번호 정책, 일회용 reset token, 세션 폐기 구현 동반 계약
- [`proposals/employee-unified-usage-contract.md`](proposals/employee-unified-usage-contract.md): Project/Application과 Tenant Chat의 직원별 통합 사용량 read contract
- [`proposals/employee-security-analytics-contract.md`](proposals/employee-security-analytics-contract.md): 원문 없이 직원별 마스킹·차단 현황을 조회하는 Analytics read contract
- [`proposals/dashboard-live-snapshot-polling-contract.md`](proposals/dashboard-live-snapshot-polling-contract.md): Web Dashboard 전체 관측 데이터를 1초 단일 snapshot으로 갱신하는 BFF 계약 후보
- [`proposals/tenant-employee-cost-policy-contract.md`](proposals/tenant-employee-cost-policy-contract.md): Tenant 직원별 일일·주간 비용 정책과 공통 집행 원장 구현 동반 계약

- [`proposals/analytics-policy-impact-data-contract.md`](proposals/analytics-policy-impact-data-contract.md): Analytics policy-impact aggregates, complex-based high-performance request semantics, and executed-model time buckets
- [`proposals/analytics-cache-surface-contract.md`](proposals/analytics-cache-surface-contract.md): Analytics Exact Cache aggregates across Project/Application and Tenant Chat surfaces
- [`proposals/unified-analytics-performance-contract.md`](proposals/unified-analytics-performance-contract.md): Project/Application과 Tenant Chat을 surface별 latency 의미를 보존해 합치는 Analytics performance read contract
- [`proposals/tenant-unified-reliability-read-contract.md`](proposals/tenant-unified-reliability-read-contract.md): Project/Application과 Tenant Chat의 terminal outcome과 fallback을 canonical surface aggregate로 합치는 Analytics reliability read contract
- [`proposals/p0-invocation-log-monthly-partitioning.md`](proposals/p0-invocation-log-monthly-partitioning.md): P0 Request Log의 UTC 월 단위 PostgreSQL range partitioning과 `request_id` 전역 멱등성 보존 제안
- [`proposals/clickhouse-analytics-mirror-contract.md`](proposals/clickhouse-analytics-mirror-contract.md): PostgreSQL canonical log를 유지한 Gateway 비동기 ClickHouse mirror와 직원별 Project/Application usage read cutover gate 제안

## Scope Router

| 작업 범위 | 먼저 읽을 문서 | 상태 |
|---|---|---|
| 일반 UI, 리팩터링, 버그 수정 | current 문서와 실제 코드/타입 | Active |
| 일반 Gateway 라우팅, RuntimeSnapshot routing | [`../routing/README.md`](../routing/README.md) | Active scoped contract |
| 신규 Tenant Chat Product | [`../tenant-chat/README.md`](../tenant-chat/README.md) | Active scoped contract; implementation present in `origin/dev` |
| Self-host 설치와 이미지 | [`../v2.1.0/README.md`](../v2.1.0/README.md) | Latest versioned scope |
| Advanced Routing offline 평가 | [`../v2.1.0/README.md`](../v2.1.0/README.md) | Versioned evidence scope |
| Gateway/API/DB/Event/Metrics 호환성 | [`../v2.0.0/README.md`](../v2.0.0/README.md)에서 해당 baseline 선택 | Baseline compatibility |
| 보안/PII/비용 정책 | `../policies/`의 관련 문서와 current 계약 | Supporting policy |
| 아키텍처 배경 | `../architecture/`의 관련 문서 | Supporting reference |
| 실험 및 성능 결과 | `../testing/`, `../ai-safety-lab/` | Evidence, 날짜 확인 필요 |
| 과거 계획과 결정 | `../archive/`, versioned implementation docs | Historical only |

## Current Classification

- `v2.0.0`: 닫힌 historical workstream의 행동 계약 baseline 및 과거 plan/criteria
- `v2.1.0`: 저장소에 존재하는 최신 versioned 범위. Self-host와 Advanced Routing evidence를 다룸
- `routing/v2`: 일반 Gateway category × difficulty 라우팅의 active scoped contract
- `tenant-chat/v1`: release SemVer와 독립된 신규 Tenant Chat active scoped contract. 구현 상태는 별도로 확인
- `origin/dev`: 현재 통합 중인 unreleased development snapshot
- `v0.0.1`: 공식 GitHub 최신 릴리스

위 네 가지는 같은 의미의 버전 신호가 아니다. 팀이 다음 SemVer를 결정하기 전까지 `current`를 임의의 `v2.2.0` 같은 번호로 치환하지 않는다.

## Rules

- versioned 폴더가 있다는 이유만으로 전체 제품의 active source가 되지 않는다.
- historical implementation plan/task를 새 작업의 backlog로 사용하지 않는다.
- current 계약이 없는 영역에서 baseline과 코드가 다르면 추측으로 맞추지 않는다.
- API/DB/Event/Metrics/Security 의미 변경은 별도 계약 후보로 기록한다.
- 코드 존재와 GA/release/production-ready 상태를 구분한다.
- 열린 PR은 병합 전까지 current 구현으로 기록하지 않는다.

## Related Entry Points

- [`../README.md`](../README.md): 전체 문서 라우터
- [`../../AGENTS.md`](../../AGENTS.md): 구현 에이전트 규칙
- [`../../README.md`](../../README.md): 저장소 개요와 로컬 baseline
