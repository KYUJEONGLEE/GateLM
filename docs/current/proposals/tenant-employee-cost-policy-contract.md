# Superseded: Tenant Employee Cost Policy Contract

> Superseded on 2026-07-17 by the Tenant Chat employee weekly token quota contract in [`docs/tenant-chat/contracts.md`](../../tenant-chat/contracts.md). The historical cost-policy tables and audit evidence remain preserved, but Tenant Chat no longer uses this cross-surface cost ledger for enforcement. Project/API-key compatibility policy is unchanged.

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
- public terminal cost와 employee ledger confirmed cost는 같은 pinned attempt 가격 계산을 사용하며 request의 모든 billable primary/fallback attempt 합계로 수렴해야 한다. 마지막 성공 attempt 비용만 terminal log에 남기지 않는다.
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

### 3.3 Threshold arithmetic

- warning threshold는 `ceil(limitMicroUsd * warningThresholdPercent / 100)`으로 계산한다.
- 곱셈, 덧셈, period balance 계산은 overflow를 검사하는 integer arithmetic만 사용한다.
- period identity는 `(tenantId,employeeId,periodKind,periodStart,currency)`다. policy version은 evidence일 뿐 identity가 아니며, period 중간의 policy 수정으로 누적 비용을 0으로 초기화하지 않는다.

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
- authoritative rollout이 `shadow|enforce`인 Tenant에서는 policy가 없거나 disabled여도 canonical employee 비용을 dual-write한다. policy row가 없을 때만 virtual version `0`/monitor evidence를 사용하고, disabled policy row가 있으면 실제 version/mode를 pin하되 route를 제한하지 않는다. 그래야 period 중간에 limit을 켰을 때 같은 period의 기존 confirmed 비용이 빠지지 않는다.

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

후보 예약 자체로 `exceeded`가 되는 경우도 같은 결정을 적용한다. premium/high-quality 후보의 projected exposure가 limit 이상이면 어떤 reserve row도 쓰지 않고 lower-cost 후보 재선택을 요구한다. lower-cost 후보는 reserve한 뒤 state가 `exceeded`가 되더라도 요청 전체를 hard block하지 않는다.

surface별 high-cost 의미는 섞지 않는다.

- Tenant Chat: active RuntimeSnapshot route의 exact `tier=high_quality`다.
- Project/Application: 검증된 published Provider Catalog model의 exact `routing.costTier=premium`이다. 모델명, provider family, category, difficulty 문자열로 추정하지 않는다.
- Project/Application catalog publisher는 active routing authoring role에서 canonical cost tier를 만든다. Simple-only primary는 `low`, Complex-only primary와 routing profile에 없는 일반 model은 `premium`, Simple/Complex shared primary와 configured fallback 및 `mock-balanced`는 `balanced`다.
- enabled limit이 있는 직원에서 published catalog의 cost tier가 없거나 허용값이 아니면 `enforce`에서 fail closed한다. day/week limit이 모두 disabled인 직원은 비용 evidence를 계속 기록하되 route를 제한하지 않고 coverage를 invalid 상태로 내려 이후 limit 활성화 전 복구가 필요함을 표시한다. `shadow`에서도 요청을 유지하되 rollout coverage를 invalid 상태로 내려 authoritative/enforcement-ready로 표시하지 않는다.
- Manual explicit model도 같은 catalog cost tier를 사용한다. exceeded 상태의 explicit premium model은 다른 model로 암묵 치환하지 않고 public `403 employee_cost_route_restricted`를 반환한다.
- Auto 후보에서 premium을 제외한 뒤 eligible target이 없을 때도 public `403 employee_cost_route_restricted`를 반환한다. Tenant Chat은 기존 `503 CHAT_NO_ELIGIBLE_ROUTE`를 유지한다.

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
      "rolloutMode": "enforce",
      "enforcementReady": true,
      "exposureSource": "authoritative_ledger",
      "policy": {},
      "daily": {
        "periodStart": "2026-07-14T15:00:00.000Z",
        "periodEnd": "2026-07-15T15:00:00.000Z",
        "periodTimezone": "Asia/Seoul",
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

Rollout response 규칙:

- `rolloutMode=off`: `enforcementReady=false`, `confirmed_read_model`이다.
- `rolloutMode=shadow`이고 현재 enabled day/week의 두 surface coverage가 모두 완전하면 authoritative balance와 state를 반환하지만 `enforcementReady=false`다.
- `rolloutMode=enforce`이고 activation boundary가 지났으며 현재 enabled day/week coverage가 모두 완전하고 invalidation이 없을 때만 `enforcementReady=true`다.
- enabled period 중 하나라도 coverage가 불완전하면 row 전체를 `confirmed_read_model`/`pending_ledger`로 유지한다. period row가 없다는 사실만으로 authoritative 0원을 만들지 않는다.
- `periodTimezone`은 day/week 각각에 명시한다. policy timezone과 현재 period row timezone이 다르면 fail closed하고 pending으로 표시한다.

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
- identity는 `(tenant_id,employee_id,period_kind,period_start,currency)`이며 policy version을 key에 넣지 않음
- created/last-evaluated policy version evidence
- confirmed/reserved/unconfirmed cost
- bounded state

`tenant_employee_cost_reservations`:

- `surface`, request id, tenant, employee
- enabled 여부와 무관하게 원래 day/week period keys
- pinned policy version, enforcement mode, threshold/limit decision evidence
- pricing rule/version, estimate version과 reserved/confirmed/unconfirmed total
- `reserved|settled|released|unconfirmed`
- unique `(surface,request_id)` idempotency

`tenant_employee_cost_provider_attempts`:

- reservation, bounded attempt number와 `primary|fallback`
- provider/model opaque identifiers, pinned pricing rule/version와 regular input/output 및 nullable Provider cache-read input 단가
- estimated input/max output, confirmed regular/cache-read/output token split, reserved/confirmed/unconfirmed cost
- bounded outcome, usage quality, started/completed timestamp
- unique `(surface,request_id,attempt_no)` idempotency

`tenant_employee_cost_ledger_entries`:

- append-only `reserve|top_up|settle|release|unconfirmed|late_correction` signed delta
- unique `(reservation_id,event_version)`과 unique event ID

`tenant_employee_cost_ledger_rollouts`:

- tenant별 `off|shadow|enforce`, activation boundary와 monotonic version
- Project/Application 및 Tenant Chat writer coverage 시작 timestamp
- bounded coverage invalidation timestamp/error code
- actual actor와 old/new rollout을 append-only audit에 기록

Rollout row와 period/reservation/attempt/ledger FK는 correctness row가 암묵적으로 삭제되지 않도록 `RESTRICT`를 기본으로 한다. tenant 삭제나 retention purge는 별도 audited lifecycle 없이는 이 범위의 worker가 수행하지 않는다.

Employee identity를 일반 Dashboard dimension이나 Prometheus label로 넣지 않는다.

## 8. Gateway Integration

### 8.1 Project/Application

- trusted actor를 current tenant/project의 active Employee assignment와 대조한 뒤 canonical employee ID를 사용한다.
- 기존 Project employee guard와 Tenant employee cost guard를 별도 decision으로 유지한다.
- exact/semantic cache miss 뒤 routing target과 pinned price가 결정된 다음 Provider call 전 day/week exposure를 main PostgreSQL에서 atomic reserve한다.
- routing은 policy decision을 실제 후보 선택에 반영한다.
- public async terminal writer와 별도 Log DB는 enforcement correctness에 사용하지 않는다. 각 Provider attempt 종료 시 main PostgreSQL에서 actual billable cost를 settle하고 unused reservation을 release한다.

Public reservation input은 다음처럼 결정한다.

1. `estimatedInputTokens`는 masking 이후 실제 Provider에 전달할 text message content의 UTF-8 byte length 합계이며 최소 `1`이다. 원문이나 canonical bytes는 저장하지 않고 `estimateVersion=utf8_message_bytes_v1`만 pin한다.
2. `maxOutputTokens`는 `max_completion_tokens`, `max_tokens`, published catalog `capabilities.maxOutputTokens` 순서다. request field가 존재하면 positive integer여야 하며 non-positive 또는 catalog 상한 초과는 기존 public invalid-request `400`이다. 어느 값도 결정할 수 없으면 guard unavailable이다.
3. request 시작 시점에 main pricing catalog에서 exact provider/model pricing rule을 조회해 rule/version/regular input/output 및 지원되는 Provider cache-read input micro-USD 단가를 pin한다.
4. reservation은 cache discount를 가정하지 않고 input/output cost를 각각 `ceil(tokens * price / 1_000_000)` 후 합한다. confirmed cache-read token이 있으면 Tenant Chat active 계약처럼 regular input, cache-read input, output을 각각 pinned 단가로 올림 계산하며, cache-read 단가가 없으면 모든 input을 regular input으로 계산한다. `cacheReadInputTokens <= inputTokens`, `cacheReadInputPrice <= regularInputPrice`를 검증한다.
5. enabled `enforce`에서 estimate/pricing을 pin할 수 없으면 Provider를 호출하지 않고 public `503 employee_cost_guard_unavailable`로 fail closed한다.
6. public Provider adapter는 bounded `not_started|started` dispatch evidence를 accounting path에 반환한다. credential/validation/serialization처럼 `not_started`인 오류만 release할 수 있고, transport dispatch 뒤 usage가 없으면 pending이다. 기존 `ProviderAttemptStarted` boolean이나 async terminal log는 dispatch evidence가 아니다.

### 8.2 Tenant Chat

- signed workload context의 employee actor `employeeId`만 사용한다.
- Gateway는 User/Membership/Employee identity table을 재조회하거나 browser scope를 신뢰하지 않는다.
- existing user token period와 tenant cost period transaction 안에서 employee day/week period를 함께 lock/reserve/settle한다.
- tenant admin처럼 employee ID가 없는 actor는 employee guard를 사용하지 않지만 user quota와 tenant budget은 그대로 적용한다.
- 공용 employee adapter는 호출자가 소유한 `pgx.Tx`를 받아야 하며 자체 begin/commit을 하지 않는다. native reservation과 employee period/reservation/attempt/ledger 중 하나라도 실패하면 admission consume을 포함한 전체 transaction을 rollback한다.

### 8.3 Retry, fallback, cache

- same logical retry/replay는 동일 request reservation을 재사용한다.
- exact/semantic cache hit은 premium/high-quality target에서 만들어진 entry여도 Provider 비용이 0이므로 employee reservation 없이 반환할 수 있다. miss 뒤 guard가 lower target을 요구하면 target-bound cache를 한 번 다시 조회한다.
- definitely-dispatched가 아닌 pre-call terminal outcome은 employee confirmed/reserved cost 0으로 release한다.
- fallback 전 additional exposure를 top-up한다.
- 모든 Provider-confirmed billable attempt를 settle한다.
- Provider dispatch 뒤 usage가 없으면 0으로 추정하지 않고 reservation을 pending으로 유지한다.

### 8.4 Pending, reconciliation, late usage

- pending attempt는 `usage_pending_at`부터 15분 동안 reserved exposure를 유지한다.
- deadline 뒤 reconciliation은 확인된 attempt를 confirmed로 옮기고, usage가 없는 attempt의 pinned reserved cost를 unconfirmed exposure로 옮긴다.
- late usage는 original day/week period와 pinned price에 exactly-once 적용한다. 해당 attempt의 unconfirmed hold를 역분개하고 actual confirmed cost를 더한다.
- receipt replay는 no-op이어야 하며 같은 attempt의 다른 usage는 idempotency conflict다.
- 이 MVP에는 unaudited manual release를 두지 않는다. operator correction은 actor, reason, evidence code와 expected ledger version을 요구하는 별도 audited CAS path에서만 허용한다.

## 9. Event, Log, Metrics

Terminal/settlement evidence는 bounded employee cost outcome을 기록한다.

- `policyVersion`
- daily/weekly state
- enforcement mode와 outcome
- limit/confirmed/reserved/unconfirmed micro-USD
- period start/end/timezone

Tenant Chat event는 `additionalProperties:false` schema를 사용하므로 schema version, fixture, projector consumer를 함께 갱신한다.

Employee evidence를 Tenant Chat outbox에 추가할 때는 기존 event에 임의 field를 넣지 않는다. 새 schema version에서 bounded `policyVersion`, rollout/enforcement outcome, day/week period/state/amount evidence를 추가하고 schema, vector, projector를 같은 변경에서 승격한다.

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
3. selected tenant의 rollout을 `shadow`로 올리고 canonical employee의 두 surface를 policy enabled 여부와 무관하게 dual-write한다.
4. current day/week 시작보다 이른 두 surface coverage와 read-model 대조, pricing/estimate capability, pending reconciliation을 확인한다.
5. 기존 period 중간에 강제로 활성화하지 않고 다음 local day/week boundary를 `enforce` activation으로 기록한다.
6. runtime accounting 오류는 bounded coverage invalidation으로 기록하고 authoritative/enforcement-ready 표시를 즉시 내린다.
7. rollback은 rollout을 `shadow`로 내리고 policy/period/reservation/attempt/ledger/audit row를 보존한다.

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
11. `off|shadow|enforce`와 두 surface coverage가 API readiness를 결정하며 빈 period row를 authoritative 0원으로 오인하지 않는다.
12. 공개 Gateway의 async terminal log가 drop되거나 별도 DB를 사용해도 main employee ledger 정산은 영향을 받지 않는다.
13. pending 15분 전환과 late usage correction이 original period에서 exactly-once 수렴한다.
