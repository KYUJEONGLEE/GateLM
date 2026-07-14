# Employee Unified Usage Frontend Handoff

| Field | Value |
|---|---|
| Status | Implemented integration note; not an API/DB contract |
| Frontend branch | `feat/employee-unified-usage` |
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
- 개인 일일 토큰 한도는 기존 정책 API를 사용하며, 주간 토큰 한도만 백엔드 계약이 없어 비활성 placeholder다.

## 통합 연결 상태

직원 페이지는 Control Plane 통합 사용량 API를 직원 관리 모델과 병렬로 호출한다. 통합 응답에는 Project/Application과 Tenant Chat의 귀속 가능한 확정 사용량이 함께 포함된다.

- 오늘 토큰: UTC 당일 통합 `totalTokens`
- 주간 토큰: 현재 시각 기준 최근 7일 통합 `totalTokens`
- 월간 비용: UTC 월 시작부터 현재까지 통합 `costMicroUsd`
- Tenant Chat 사용량: `employeeId`에 안전하게 귀속된 확정 사용량 포함
- API 페이지네이션: 서버에서 전체 페이지를 순회한 뒤 기존 클라이언트 랭킹 UI에 전달
- 장애 폴백: 기간별 API 요청이 실패한 지표만 기존 Project/Application 배정 집계로 대체
- 출처 breakdown: API 응답에는 유지되지만 현재 랭킹 UI에는 합계만 표시
- 미귀속 Tenant Chat 사용자: 표현하지 않음

따라서 정상 응답 시 랭킹은 Project/Application과 Tenant Chat을 합친 직원별 오늘 토큰 기준이며, 기존 프로젝트 배정·정책 제어 UI는 그대로 유지한다.

## 통합 API 소비 계약

프론트는 기간별 직원 사용량 API에서 다음 정보를 소비한다.

- tenant 범위가 검증된 직원 식별자와 표시 정보
- 합산 token, cost micro-USD, request count
- `project_application`, `tenant_chat` 출처별 동일 지표 breakdown
- 집계 시작/종료 시각과 timezone 또는 명시된 period key
- 다음 페이지를 위한 cursor 또는 page metadata
- 미귀속 사용자를 안전하게 구분하는 bounded 상태
- 중복 제거가 완료된 집계라는 provenance/freshness 상태

raw prompt, raw response, credential, Authorization header, provider raw error는 응답이나 UI에 포함하지 않는다.

## 유지보수 분담

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

## 후속 범위

1. 사용자가 기간을 직접 선택하는 UI가 필요하면 현재 기간 생성기와 API query를 확장한다.
2. 출처별 breakdown이나 미귀속 사용량은 별도 표시 요구가 확정된 뒤 UI에 노출한다.
3. 운영 안정성이 확인되면 Project/Application-only compatibility fallback 제거 시점을 결정한다.
