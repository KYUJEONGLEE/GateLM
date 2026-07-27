# GateLM Current Documentation

| Field | Value |
|---|---|
| Status | Active documentation entrypoint |
| Applies to | 현재 GateLM 개발 작업 |
| Development baseline | `origin/dev` |
| Verified snapshot | `origin/dev @ e54d35b94d0409cf4b6ceba8036735f1ee7afe6e` |
| Last verified | 2026-07-27 |
| Version policy | `Unreleased`; 리팩토링과 전체 release gate 완료 후 target `v1.0.0` |

이 폴더는 GateLM의 새 계약을 복제하는 장소가 아니다. 현재 어떤 문서가 어느 범위에서 유효한지 알려주는 안정적인 진입점이다.

## Common Reading

1. [`source-of-truth.md`](source-of-truth.md): 문서 권한, lifecycle과 충돌 처리
2. [`contract-map.md`](contract-map.md): 범위별 active contract와 proposal 상태 판별
3. 아래 범위 표에서 작업에 필요한 권위 문서만 추가 확인

과거 release-like 폴더명을 해석할 때는 [`../pre-v1/README.md`](../pre-v1/README.md)를 확인한다.

필요할 때만 다음 문서를 읽는다.

- [`implementation-status.md`](implementation-status.md): 현재 구현 사실을 확인할 때
- [`documentation-gaps.md`](documentation-gaps.md): 문서/코드 충돌이나 미결정 항목을 확인할 때
- [`technical-challenges.md`](technical-challenges.md): 현재 구현의 기술적 난제와 코드·테스트 근거를 설명할 때

현재 리팩토링과 target `v1.0.0` 준비 자료는 계약이 아닌 planning baseline이다.

- [`proposals/v1-release-candidate-refactoring-baseline.md`](proposals/v1-release-candidate-refactoring-baseline.md): 최신 dev 기준선, release gate와 legacy 기본 챗봇 종료 경계
- [`proposals/README.md`](proposals/README.md): 모든 current proposal의 lifecycle registry

Tenant Chat handoff 준비 자료는 계약이 아니라 검토 및 수신 도구다.

- [`tenant-chat-integration-impact-audit.md`](tenant-chat-integration-impact-audit.md): 기존 구조와의 충돌 지점
- [`tenant-chat-contract-intake-checklist.md`](tenant-chat-contract-intake-checklist.md): Chat 팀 계약 수신 체크리스트
- [`tenant-chat-v1-gateway-implementation-plan.md`](tenant-chat-v1-gateway-implementation-plan.md): Active 계약 기반 GateLM 구현 순서
- [`proposals/legacy-application-chat-employee-guard-notes.md`](proposals/legacy-application-chat-employee-guard-notes.md): 기존 Application Chat 동결 범위

계약 후보, 구현 동반 기록, planning, reference와 superseded 문서는
[`proposals/README.md`](proposals/README.md)에서 분리한다. registry 등록만으로
active 계약이 되지 않는다.

## Scope Router

| 작업 범위 | 먼저 읽을 문서 | 상태 |
|---|---|---|
| 일반 UI, 리팩터링, 버그 수정 | current 문서와 실제 코드/타입 | Active |
| 일반 Gateway 라우팅, RuntimeSnapshot routing | [`../routing/README.md`](../routing/README.md) | Active scoped contract |
| 신규 Tenant Chat Product | [`../tenant-chat/README.md`](../tenant-chat/README.md) | Active scoped contract; implementation present in `origin/dev` |
| Self-host 설치와 이미지 | [`../v2.1.0/README.md`](../v2.1.0/README.md) | Pre-v1 scoped contract |
| Advanced Routing offline 평가 | [`../v2.1.0/README.md`](../v2.1.0/README.md) | Pre-v1 evidence scope |
| Gateway/API/DB/Event/Metrics 호환성 | [`../v2.0.0/README.md`](../v2.0.0/README.md)에서 해당 baseline 선택 | Pre-v1 baseline compatibility |
| 계약 후보와 구현 동반 문서 | [`proposals/README.md`](proposals/README.md) | Non-authoritative registry |
| 보안/PII/비용 정책 | `../policies/`의 관련 문서와 current 계약 | Supporting policy |
| 아키텍처 배경 | `../architecture/`의 관련 문서 | Supporting reference |
| 실험 및 성능 결과 | `../testing/`, `../ai-safety-lab/` | Evidence, 날짜 확인 필요 |
| pre-v1 workstream 분류와 이관 | [`../pre-v1/README.md`](../pre-v1/README.md) | Active migration index |
| 과거 계획과 결정 | `../archive/`, pre-v1 implementation docs | Historical only |

## Current Classification

- [`../v1.0.0/README.md`](../v1.0.0/README.md): pre-v1 초기 계약 동결안과 legacy fixture
- [`../v2.0.0/README.md`](../v2.0.0/README.md): pre-v1 historical compatibility workstream
- [`../v2.1.0/README.md`](../v2.1.0/README.md): pre-v1 Self-host와 Advanced Routing workstream
- `routing/v2`: 제품 SemVer와 독립된 일반 Gateway category × difficulty routing schema/contract version
- `tenant-chat/v1`: 제품 SemVer와 독립된 신규 Tenant Chat active scoped contract
- `origin/dev`: 현재 통합 중인 `Unreleased` development snapshot
- `v0.0.1`: 공식 GitHub 최신 릴리스
- `v1.0.0`: 리팩토링과 전체 release gate 완료 후 목표 제품 버전

위 버전 신호들은 같은 의미가 아니다. target이 정해졌더라도 exact release SHA와 evidence를 고정하기 전에는 current 개발본을 `v1.0.0`이라고 선언하지 않는다.

## Rules

- pre-v1 폴더가 있다는 이유만으로 전체 제품의 active source나 출시본이 되지 않는다.
- historical implementation plan/task를 새 작업의 backlog로 사용하지 않는다.
- current 계약이 없는 영역에서 baseline과 코드가 다르면 추측으로 맞추지 않는다.
- API/DB/Event/Metrics/Security 의미 변경은 별도 계약 후보로 기록한다.
- 코드 존재와 GA/release/production-ready 상태를 구분한다.
- 열린 PR은 병합 전까지 current 구현으로 기록하지 않는다.

## Related Entry Points

- [`../README.md`](../README.md): 전체 문서 라우터
- [`contract-map.md`](contract-map.md): 범위별 current contract 지도
- [`../../AGENTS.md`](../../AGENTS.md): 구현 에이전트 규칙
- [`../../README.md`](../../README.md): 저장소 개요와 로컬 baseline
