# Employee Security Analytics Read Contract

| Field | Value |
|---|---|
| Status | Implementation companion proposal |
| Applies to | Control Plane employee security reader and Web Analytics |
| Does not apply to | Safety enforcement, prompt inspection, incident investigation |
| Baseline | `feat/employee_dash` |
| Last reviewed | 2026-07-18 |

## Goal

Project/Application과 Tenant Chat의 보안 처리 결과를 tenant 직원 기준으로 집계한다. 원문, 탐지 값, prompt, response는 조회하거나 반환하지 않는다.

## Endpoint

```text
GET /admin/v1/tenants/{tenantId}/employees/security
```

Query:

- `from`, `to`: ISO-8601 UTC half-open interval `[from,to)`. 최대 31일.
- `limit`: `1..100`, 기본 `100`.

## Attribution

Project/Application은 직원 사용량 계약과 동일하게 `employee.id`, `employee.userId`, `employee.email` 우선순위로 `end_user_id`를 결정적으로 연결한다. 같은 우선순위의 후보가 둘 이상이면 귀속하지 않는다. Tenant Chat은 projected `employee_id`가 있는 invocation만 사용한다.

## Metrics

- `requestCount`: 선택 기간의 해당 직원 요청 수.
- `maskedRequestCount`: Project/Application의 `masking_action=redacted` 요청 수.
- `blockedRequestCount`: Project/Application의 block 결과와 Tenant Chat의 `safety_blocked` terminal outcome 요청 수.
- `protectedRequestCount`: masked와 blocked의 합계.
- `sources.projectApplication`, `sources.tenantChat`: 동일 metric의 source별 구분.

Tenant Chat invocation log에는 마스킹 유형별 확정 필드가 없으므로 Tenant Chat masked count를 추정하지 않는다.

## Security

- `AdminAuthGuard`로 tenant 관리자 권한을 검증한다.
- 모든 원천 SQL은 인증된 route tenant를 첫 범위 조건으로 사용한다.
- soft-delete된 직원은 현재 row에서 제외한다.
- raw prompt, response, detected value, API key, credential은 응답·로그·metric에 포함하지 않는다.
- employee id를 metric label에 넣지 않는다.

## Acceptance

1. 다른 tenant의 직원 또는 보안 결과가 섞이지 않는다.
2. ambiguous identity는 임의 직원에게 귀속하지 않는다.
3. Tenant Chat은 `employee_id`가 있는 `safety_blocked`만 직원 차단으로 집계한다.
4. 화면은 API 실패 시 합성값을 표시하지 않는다.
