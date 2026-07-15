# Tenant Employee Cost Policy Contract

| Field | Value |
|---|---|
| Status | Accepted implementation companion contract |
| Applies to | Tenant-scoped employee daily/weekly cost policy, Control Plane mutation, Web Console, Gateway enforcement |
| Does not replace | Project employee assignment policy, Tenant Chat user token quota, Tenant monthly cost budget |
| Baseline | `origin/dev` after employee unified usage integration |
| Last reviewed | 2026-07-15 |

## 1. Goal

Tenant 관리자는 직원별 일일 비용 제한과 주간 비용 한도를 수정할 수 있다. 정책의 사용 비용은 같은 Tenant에 속한 Project/Application과 Tenant Chat의 Provider-confirmed 실제 비용을 합산한다.

직원 비용 정책은 기존 Project별 직원 정책과 별도다.

- Project 직원 월 비용/일일 token/rate limit은 Project 안의 compatibility guard다.
- Tenant Chat user monthly token quota는 `(tenantId,userId)` 개인 quota다.
- Tenant Chat tenant monthly cost budget은 Tenant 전체 hard budget이다.
- 이 계약의 일일/주간 비용 정책은 `(tenantId,employeeId)` 통합 employee guard다.

어느 정책도 다른 정책의 한도나 사용량으로 변환하지 않는다. 여러 정책이 동시에 적용되면 가장 제한적인 routing 결과를 사용하고, Tenant budget hard stop을 우회하지 않는다.

## 2. Usage Meaning

직원 랭킹과 confirmed usage 조회는 기존 통합 endpoint를 사용한다.

```text
GET /admin/v1/tenants/{tenantId}/employees/usage
```

- `metric=cost`이면 `costMicroUsd` 내림차순이 기본이다.
- Project/Application은 terminal `p0_llm_invocation_logs.cost_micro_usd`를 사용한다.
- Tenant Chat은 projected `tenant_chat_invocation_logs.confirmed_cost_micro_usd`를 사용한다.
- Project/Application과 Tenant Chat source row를 먼저 분리한 뒤 employee total을 더한다.
- cache hit, safety/rate block, Provider pre-call failure처럼 confirmed billable usage가 없는 요청의 비용은 0이다.
- primary와 fallback이 모두 billable이면 모든 Provider-confirmed attempt를 합산한다.
- reservation, released reservation, pending reservation을 confirmed 랭킹 비용에 더하지 않는다.
- 미귀속 사용량은 특정 직원 row에 추정해서 넣지 않는다.

통합 usage endpoint와 rollup은 관측용 read model이다. projection lag와 동시 요청 때문에 enforcement source로 사용하지 않는다.

## 3. Period Contract

정책 기간은 저장 시점의 IANA `periodTimezone`을 사용한다. DB timestamp는 UTC로 저장한다.

### 3.1 Day

- calendar day
- local `00:00:00` inclusive부터 다음 local day `00:00:00` exclusive
- DST가 있는 timezone에서는 고정 24시간으로 계산하지 않는다.

### 3.2 Week

- ISO calendar week
- local Monday `00:00:00` inclusive부터 다음 Monday `00:00:00` exclusive
- rolling 7×24시간과 혼용하지 않는다.

모든 period는 half-open `[periodStart,periodEnd)`이며 response에 UTC `periodStart`, `periodEnd`, IANA `periodTimezone`, `resetAt`을 함께 제공한다.

MVP 기본 timezone은 `Asia/Seoul`이다. 정책 row가 만들어진 뒤에는 default 변경으로 기존 row의 timezone을 암묵적으로 바꾸지 않는다.

## 4. Policy

정책 shape:

```json
{
  "tenantId": "<tenant uuid>",
  "employeeId": "<employee uuid>",
  "currency": "USD",
  "periodTimezone": "Asia/Seoul",
  "daily": {
    "enabled": true,
    "limitMicroUsd": 5000000
  },
  "weekly": {
    "enabled": true,
    "limitMicroUsd": 25000000
  },
  "warningThresholdPercent": 80,
  "enforcementMode": "restrict_high_cost",
  "version": 1
}
```

Rules:

- canonical currency는 `USD`, canonical amount는 non-negative safe integer micro-USD다.
- `enabled=false`이면 해당 period limit을 집행하지 않는다.
- `enabled=true`이면 `limitMicroUsd > 0`이어야 한다.
- `0`을 disabled 또는 immediate block의 sentinel로 해석하지 않는다.
- `warningThresholdPercent`는 `1..99`, 기본 `80`이다.
- `enforcementMode`는 `monitor|restrict_high_cost`다.
- `monitor`는 state와 decision evidence만 기록하고 route를 바꾸지 않는다.
- `restrict_high_cost`는 projected exposure가 limit 이상이면 high-quality route를 제외한다.
- 요청 전체 hard block은 이 계약의 MVP 범위가 아니다.
- daily와 weekly가 동시에 적용되면 더 제한적인 state를 사용한다.
- 정책 수정은 version을 1 증가시키고 다음 새 요청부터 적용한다. 이미 예약된 요청은 예약 시 pin한 policy version으로 정산한다.

## 5. State And Enforcement

관리 화면의 confirmed 사용 비용과 enforcement state는 의미를 구분한다.

```text
confirmed usage = Provider-confirmed actual cost
exposure = confirmed + reserved + unconfirmed incident exposure
```

State:

- `not_configured`: 해당 period disabled
- `pending_ledger`: policy는 enabled지만 authoritative period ledger가 아직 traffic-on 되지 않음
- `normal`: exposure < warning threshold
- `warning`: warning threshold <= exposure < limit
- `exceeded`: exposure >= limit

랭킹은 confirmed usage만 사용한다. 한도 badge와 routing decision은 authoritative period exposure를 사용한다.

`restrict_high_cost`에서 `exceeded`이면:

1. high-quality route를 후보에서 제외한다.
2. standard/economy eligible route가 있으면 요청을 계속한다.
3. lower-cost eligible route가 없으면 기존 surface의 bounded no-eligible-route 오류를 반환한다.
4. employee guard는 Tenant Chat tenant budget hard stop을 완화하지 않는다.

## 6. Control Plane API

### 6.1 Batch read

```text
GET /admin/v1/tenants/{tenantId}/employees/cost-policies
```

Query는 기존 employee list pagination과 동일한 tenant-scoped pagination을 사용한다. response row는 policy와 현재 day/week state를 제공한다.

```json
{
  "data": [
    {
      "employeeId": "<employee uuid>",
      "enforcementReady": true,
      "exposureSource": "authoritative_ledger",
      "policy": {},
      "daily": {
        "periodStart": "2026-07-14T15:00:00.000Z",
        "periodEnd": "2026-07-15T15:00:00.000Z",
        "confirmedCostMicroUsd": 1000000,
        "reservedCostMicroUsd": 0,
        "unconfirmedCostMicroUsd": 0,
        "state": "normal",
        "resetAt": "2026-07-15T15:00:00.000Z"
      },
      "weekly": {}
    }
  ],
  "pagination": {}
}
```

정책/API만 먼저 배포되고 authoritative period ledger가 아직 traffic-on 되지 않은
단계에서는 `enforcementReady=false`, `exposureSource=confirmed_read_model`을 반환한다.
이때 enabled period의 `state`는 `pending_ledger`이고 reserved/unconfirmed 값은 `null`이다.
클라이언트는 이 값을 0원 또는 정상 집행 상태로 표시하지 않는다.

### 6.2 Mutation

```text
PATCH /admin/v1/tenants/{tenantId}/employees/{employeeId}/cost-policy
```

Request:

```json
{
  "daily": { "enabled": true, "limitMicroUsd": 5000000 },
  "weekly": { "enabled": true, "limitMicroUsd": 25000000 },
  "warningThresholdPercent": 80,
  "enforcementMode": "restrict_high_cost",
  "expectedVersion": 1
}
```

Rules:

- `AdminAuthGuard` tenant authorization을 사용한다.
- service가 `(tenantId,employeeId)` same-tenant 관계를 다시 검증한다.
- `expectedVersion` mismatch는 `409 EMPLOYEE_COST_POLICY_VERSION_CONFLICT`다.
- invalid limit/timezone/mode는 `400 EMPLOYEE_COST_POLICY_INVALID`다.
- employee missing 또는 soft-deleted는 tenant 경계를 노출하지 않는 bounded `404`다.
- mutation은 실제 admin actor와 old/new policy를 append-only audit에 기록한다.
- response는 저장된 policy version을 반환한다.

## 7. Storage

Migration은 additive이며 기존 migration checksum을 변경하지 않는다.

### 7.1 Policy

`tenant_employee_cost_policies`:

- `(tenant_id,employee_id)` primary or unique key
- same-tenant composite FK to `employees(id,tenantId)`
- daily/weekly enabled와 limit micro-USD
- currency, period timezone, warning threshold, enforcement mode
- positive version
- `updated_by`, timestamps

`tenant_employee_cost_policy_audits`:

- tenant, employee, actor, policy version
- previous/next bounded policy JSON
- action, created timestamp
- append-only

### 7.2 Authoritative period ledger

`tenant_employee_cost_periods`:

- tenant, employee, `day|week`, period start/end/timezone, currency
- policy version
- confirmed/reserved/unconfirmed cost
- bounded state

`tenant_employee_cost_reservations`:

- `surface`, request id, tenant, employee
- day/week period keys
- policy version and reserved cost
- `reserved|settled|released|unconfirmed`
- unique `(surface,request_id)` idempotency

`tenant_employee_cost_ledger_entries`:

- append-only reserve/settle/release/unconfirmed/late-correction delta
- unique reservation event version

Employee identity를 일반 Dashboard dimension이나 Prometheus label로 넣지 않는다.

## 8. Gateway Integration

### 8.1 Project/Application

- trusted actor를 current tenant/project의 active Employee assignment와 대조한 뒤 canonical employee ID를 사용한다.
- 기존 Project employee guard와 Tenant employee cost guard를 별도 decision으로 유지한다.
- routing과 pinned price가 결정된 뒤 Provider call 전 day/week exposure를 atomic reserve한다.
- routing은 policy decision을 실제 후보 선택에 반영한다.
- terminal writer는 actual billable cost를 settle하고 unused reservation을 release한다.

### 8.2 Tenant Chat

- signed workload context의 employee actor `employeeId`만 사용한다.
- Gateway는 User/Membership/Employee identity table을 재조회하거나 browser scope를 신뢰하지 않는다.
- existing user token period와 tenant cost period transaction 안에서 employee day/week period를 함께 lock/reserve/settle한다.
- tenant admin처럼 employee ID가 없는 actor는 employee guard를 사용하지 않지만 user quota와 tenant budget은 그대로 적용한다.

### 8.3 Retry, fallback, cache

- same logical retry/replay는 동일 request reservation을 재사용한다.
- cache hit과 pre-call terminal outcome은 employee confirmed/reserved cost 0이다.
- fallback 전 additional exposure를 top-up한다.
- 모든 Provider-confirmed billable attempt를 settle한다.
- missing usage는 기존 surface의 unconfirmed 처리와 함께 employee exposure에 보수적으로 반영한다.

## 9. Event, Log, Metrics

Terminal/settlement evidence는 bounded employee cost outcome을 기록한다.

- `policyVersion`
- daily/weekly state
- enforcement mode와 outcome
- limit/confirmed/reserved/unconfirmed micro-USD
- period start/end/timezone

Tenant Chat event는 `additionalProperties:false` schema를 사용하므로 schema version, fixture, projector consumer를 함께 갱신한다.

Metrics에는 bounded label만 사용한다.

- allowed: `surface`, `period=day|week`, `outcome`, `enforcement_mode`
- forbidden: tenant ID, employee ID, user ID, request ID, policy version, raw error/detail

## 10. Security

- browser가 tenant, employee, quota, budget scope를 집행 근거로 보내지 않는다.
- Admin mutation은 tenant authorization과 same-tenant Employee 확인을 모두 통과한다.
- raw prompt, raw response, raw detected value, credential, Authorization, Provider raw error는 policy/audit/ledger/event/UI에 포함하지 않는다.
- employee ID는 admin response와 tenant-scoped DB row에는 허용하지만 metric label에는 금지한다.

## 11. Rollout

1. policy/API와 ledger schema를 traffic-off로 배포한다.
2. policy default는 disabled다. 기존 Project 정책을 자동 변환하지 않는다.
3. `monitor`에서 dual-write하고 통합 confirmed usage와 ledger를 비교한다.
4. 기존 period 중간에 강제로 활성화하지 않고 다음 local day/week boundary에서 selected tenant를 활성화한다.
5. rollback은 enforcement mode를 `monitor`로 내리고 policy/ledger/audit row를 보존한다.

## 12. Acceptance

1. 다른 tenant의 직원, 정책, period, 사용량이 섞이지 않는다.
2. Project/Application과 Tenant Chat confirmed 비용 합이 직원 랭킹과 일치한다.
3. calendar day/week와 DST 경계가 정확하다.
4. concurrent request가 같은 day/week exposure를 atomic하게 예약한다.
5. cache hit과 pre-call failure 비용은 0이다.
6. primary/fallback의 모든 billable attempt가 exactly-once 반영된다.
7. 정책 version conflict와 in-flight version pinning이 결정적이다.
8. high-quality restriction이 production routing에서 실제로 적용된다.
9. UI 저장 후 reload해도 policy와 state가 유지된다.
10. 기존 Project employee policy, Tenant Chat user quota, tenant budget 의미가 바뀌지 않는다.
