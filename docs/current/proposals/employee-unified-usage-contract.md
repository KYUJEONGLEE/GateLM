# Employee Unified Usage Read Contract

| Field | Value |
|---|---|
| Status | Implementation companion proposal |
| Applies to | Control Plane employee usage reader and Web client |
| Does not apply to | Gateway quota enforcement, Tenant Chat accounting, employee policy mutation |
| Baseline | `origin/dev @ 11cc6506` |
| Last reviewed | 2026-07-14 |

## 1. Goal

Project/Application과 Tenant Chat의 확정 사용량을 tenant 직원 기준으로 조회한다. 이 계약은 기존 원천 로그와 정산 의미를 변경하지 않고, 직원 랭킹과 상세 화면이 사용할 read model만 추가한다.

## 2. Endpoint

```text
GET /admin/v1/tenants/{tenantId}/employees/usage
```

Query:

- `from`, `to`: ISO-8601 UTC interval. `from < to`, 최대 31일, half-open `[from,to)`.
- `metric`: `tokens|cost|requests`, 기본 `tokens`.
- `order`: `asc|desc`, 기본 `desc`.
- `limit`: `1..100`, 기본 `50`.
- `cursor`: 이전 응답에서 받은 opaque cursor. 다른 query 조합에 재사용할 수 없다.

직원 순위는 선택한 metric, employee id 순서로 안정화한다. `rank`는 선택 기간과 정렬 기준 전체에서의 1-based 순위다.

## 3. Attribution

Project/Application은 `p0_llm_invocation_logs`에서 다음 우선순위로 직원을 찾는다.

1. `end_user_id == employee.id`
2. `end_user_id == employee.userId`
3. `lower(end_user_id) == lower(employee.email)`

같은 우선순위에 후보가 둘 이상이면 임의로 귀속하지 않는다. Tenant Chat은 projected `employee_id`가 있는 invocation만 해당 직원에게 귀속한다. `employee_id`가 없는 tenant-admin 또는 연결되지 않은 사용자를 현재 Employee 관계로 추정하지 않는다.

Soft-delete된 직원은 현재 랭킹에서 제외하고 해당 기간의 사용량은 미귀속 합계에 남긴다. `archived` 상태는 soft-delete가 아니므로 일반 직원 row로 유지한다.

## 4. Usage Meaning

- Project/Application은 terminal invocation log의 token과 `cost_micro_usd`를 사용한다.
- Tenant Chat은 `tenant_chat_invocation_logs`의 `confirmed_*`만 사용한다.
- reservation, release, pending-unconfirmed, unconfirmed exposure를 confirmed total에 더하지 않는다.
- cache hit이나 차단 요청은 원천 로그에 기록된 request count에는 포함될 수 있지만 확정 token/cost가 0이면 그대로 0이다.
- `project_application`과 `tenant_chat`은 서로 다른 source row로 유지한 뒤 `total`을 더한다.
- 같은 source의 request id는 원천 테이블의 유일성 계약으로 한 번만 센다.

## 5. Response

각 직원 row는 다음을 제공한다.

- `employeeId`, `name`, `email`, `department`, `status`
- `rank`
- `total`: request, input/output/total token, micro-USD cost
- `sources.projectApplication`, `sources.tenantChat`: 동일한 additive metric

응답 메타데이터는 period, pagination, unattributed source totals, `raw|rollup|hybrid` provenance, source freshness를 제공한다. 미귀속 사용량은 특정 직원 row에 섞지 않는다.

## 6. Policy Boundary

통합 사용량은 관측용이다. Project 직원 일일 token limit·월간 비용 한도와 Tenant Chat user monthly quota는 서로 다른 enforcement scope이므로 하나의 quota status 또는 limit으로 합치지 않는다.

## 7. Storage And Rollout

직원 ID는 high-cardinality이므로 공통 `dashboard_rollup_dimensions`에 넣지 않는다. 별도 employee usage rollup은 tenant, employee, surface, project, UTC grain별 additive metric만 저장하며 raw content와 credential을 저장하지 않는다.

- migration은 additive이며 기존 migration checksum을 변경하지 않는다.
- rollup coverage가 확인되지 않은 구간은 raw source로 fallback한다.
- late correction은 bucket replacement로 처리하고 blind increment하지 않는다.
- employee id를 metric label이나 일반 Dashboard bounded dimension으로 노출하지 않는다.

## 8. Security

- Admin tenant authorization을 기존 `AdminAuthGuard`로 검증한다.
- 모든 raw/rollup query의 첫 scope는 `tenant_id`다.
- raw prompt, response, credential, Authorization, Provider raw error를 응답·로그·metric에 포함하지 않는다.

## 9. Acceptance

1. 다른 tenant의 직원·사용량이 섞이지 않는다.
2. Project/Application identity 우선순위와 ambiguous 미귀속 처리가 결정적이다.
3. Tenant Chat confirmed total만 합산된다.
4. source 합계와 total이 일치하며 재처리 후 중복되지 않는다.
5. UTC 기간 경계, 정렬, cursor pagination이 안정적이다.
6. raw와 rollup 결과가 같은 fixture에서 일치한다.
