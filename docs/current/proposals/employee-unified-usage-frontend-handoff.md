# Employee Unified Usage Frontend Handoff

| Field | Value |
|---|---|
| Status | Working handoff; not an API/DB contract |
| Frontend branch | `feat/ui-ux-final` |
| Applies to | 직원 사용량 랭킹과 직원 관리 상세 UI |
| Last verified | 2026-07-14 |

이 문서는 Project/Application과 Tenant Chat 직원 사용량 통합 API를 구현하는 담당자에게 현재 프론트 구조와 충돌 방지 경계를 전달한다. 아래 API 응답 형태는 계약이 아니라 프론트 소비 요구사항 후보이며, 실제 필드는 active contract와 Control Plane 구현에서 확정해야 한다.

## 현재 프론트 범위

- 페이지: `/tenants/[tenantId]/employees`
- 서버 페이지: `apps/web/src/app/(console)/tenants/[tenantId]/employees/page.tsx`
- UI 컴포넌트: `apps/web/src/features/employees/components/employee-control-management.tsx`
- 현재 read model: `apps/web/src/features/employees/employee-usage-read-model.ts`
- 현재 단위 테스트: `apps/web/src/features/employees/employee-usage-read-model.spec.ts`
- Analytics의 별도 직원 탭은 제거했고, 직원별 랭킹과 상세는 직원 관리 페이지에 모았다.
- 메인 Dashboard에는 직원 랭킹을 추가하지 않았다.

## 현재 상호작용

- 직원별 사용 토큰 상위 10명을 세로 막대 차트로 표시한다.
- 기본 직원 목록 정렬은 오늘 토큰 내림차순이다.
- 이름, 부서, 프로젝트, 토큰 기준 클라이언트 정렬을 지원한다.
- 직원 목록은 클라이언트에서 10명씩 페이지네이션한다.
- 직원 행 전체를 누르면 상세 Dialog를 연다.
- 상세에는 오늘/주간 토큰, 개인 한도 placeholder, 프로젝트 추가/추방, 프로젝트 정책 이동을 표시한다.
- 개인 일일/주간 토큰 한도 저장은 아직 백엔드 계약이 없어 비활성 placeholder다.

## 현재 데이터 한계

현재 `buildEmployeeUsageReadModel`은 `EmployeeControlModel.assignmentsByProjectId`의 active Project/Application 직원 배정만 합산한다.

- 오늘 토큰: `ProjectEmployeeAssignmentRecord.dailyTokenUsed` 합계
- 월간 비용: `ProjectEmployeeAssignmentRecord.monthlyUsedUsd` 합계
- 주간 토큰: API 근거가 없어 `null`
- Tenant Chat 사용량: 포함하지 않음
- 기간 필터: 없음. 오늘 토큰과 기존 월간 비용 필드에 고정
- 출처 breakdown: 없음
- 미귀속 Tenant Chat 사용자: 표현하지 않음

따라서 현재 랭킹은 통합 직원 사용량 랭킹이 아니라 Project/Application 배정 집계다.

## 통합 API 소비 요구사항 후보

프론트는 선택 기간에 대해 직원별로 다음 정보를 소비해야 한다.

- tenant 범위가 검증된 직원 식별자와 표시 정보
- 합산 token, cost micro-USD, request count
- `project_application`, `tenant_chat` 출처별 동일 지표 breakdown
- 집계 시작/종료 시각과 timezone 또는 명시된 period key
- 다음 페이지를 위한 cursor 또는 page metadata
- 미귀속 사용자를 안전하게 구분하는 bounded 상태
- 중복 제거가 완료된 집계라는 provenance/freshness 상태

raw prompt, raw response, credential, Authorization header, provider raw error는 응답이나 UI에 포함하지 않는다.

## 충돌 방지 분담

통합 집계 담당:

- Control Plane 집계 API와 tenant isolation
- API DTO/type 및 전용 Web client
- 미귀속 사용자와 source breakdown 의미
- 기간, 정렬, 페이지네이션 wire contract

프론트 담당:

- API DTO를 `EmployeeUsageReadModel`로 변환하는 adapter
- 랭킹 차트, 직원 목록, 상세 Dialog와 필터 상호작용
- loading/empty/error/freshness 표시
- 기존 Project 배정/정책 제어 UI 유지

통합 담당자는 가능하면 `employee-usage-read-model.ts`와 `employee-control-management.tsx`를 직접 수정하지 않고 새 Control Plane client/type 파일을 제공한다. 프론트 담당자가 해당 client를 페이지에 연결하면 같은 파일 충돌을 줄일 수 있다.

## 연결 순서

1. 통합 API 계약과 DTO를 확정한다.
2. 전용 Control Plane client와 parser 테스트를 추가한다.
3. 직원 페이지에서 직원 관리 모델과 통합 사용량 요청을 병렬 호출한다.
4. 기존 read model builder를 API adapter로 교체하거나 compatibility fallback으로 제한한다.
5. 기간 필터와 서버 정렬/페이지네이션을 UI에 연결한다.
6. Project/Application-only 합산 fallback을 제거할 시점을 별도로 결정한다.
