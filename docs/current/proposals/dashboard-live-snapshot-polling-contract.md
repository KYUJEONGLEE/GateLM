# Dashboard Aggregate Snapshot And Live Requests Polling Contract Proposal

| Field | Value |
|---|---|
| Status | Proposed; implementation companion, not active until merged and accepted |
| Applies to | Web Console Dashboard BFF and browser refresh behavior |
| Baseline | `origin/dev @ 4e92fab2` |
| Polling target | Aggregate snapshot 30 seconds; Live Requests 2 seconds after the previous request settles |

## 1. 목적

Dashboard의 KPI, 비용 시계열, Provider/Model 사용량, 월 누적 비용은 하나의 저빈도 aggregate snapshot으로 교체하고, 최신 요청 목록만 별도 고빈도 polling으로 갱신한다. 집계 조회와 최신 로그 조회의 실패 및 부하를 분리하면서 1~5초 단위의 운영 데모 체감을 유지한다. 이 계약은 Gateway Request Log, Tenant Chat projection, Metrics 의미를 변경하지 않는다.

## 2. Web BFF

`GET /api/dashboard/snapshot`은 기존 Console session을 사용한다. `tenantId`는 필수이며 Dashboard의 `range`, `surface`, `projectId`, `budgetScopeType`, `budgetScopeId`, `resolvedBy` filter를 선택적으로 받는다. Live Requests의 `status`, `model` filter는 받지 않는다.

응답은 다음 read model을 한 번에 반환한다.

- `overview`: 기존 unified Dashboard overview
- `costOverTime`: 기존 unified cost series
- `monthToDateCostMicroUsd`: 기존 Project/Application과 Tenant Chat confirmed cost의 합
- `generatedAt`: BFF가 snapshot 조합을 완료한 UTC timestamp

`GET /api/dashboard/live-requests`는 기존 Console session과 권한 검사를 유지하며 Live Requests의 `status`, `model` filter와 Dashboard scope filter를 받는다. 응답은 기존 sanitized Live Requests payload다.

두 응답과 오류는 `Cache-Control: no-store`다. raw prompt, raw response, credential, token, provider raw error는 포함하지 않는다.

## 3. 권한과 실패

- 인증되지 않은 요청은 `401`이다.
- tenant 접근이 없거나 project scope를 벗어나면 `403`이다.
- aggregate snapshot의 필수 source를 조합하지 못하면 `502`이며 browser는 마지막 정상 snapshot을 유지한다.
- Live Requests 조회 실패는 aggregate snapshot을 실패시키지 않으며 browser는 마지막 정상 요청 목록을 유지한다.
- project-scoped admin과 project/budget filter가 존재하면 `surface=project_application`으로 제한한다.

## 4. Browser 갱신

- aggregate snapshot은 이전 요청 완료 후 30초, Live Requests는 이전 요청 완료 후 2초에 각각 다시 요청한다.
- 각 polling loop는 동일 filter에서 in-flight 요청을 중첩하지 않는다.
- visible document에서만 polling하고 다시 visible이 되면 두 loop 모두 즉시 갱신한다.
- aggregate snapshot은 `generatedAt`이 현재 snapshot보다 최신인 응답만 적용한다.
- 하나의 aggregate React state 교체로 KPI, 비용, Provider/Model 사용량, 월 누적 비용을 같은 render에서 갱신한다.
- Live Requests의 status/model filter 변경은 aggregate snapshot을 다시 요청하지 않는다.
- 기존 요청 추이 차트는 `overview` aggregate에서 계산된 표시용 시계열이며 실제 1초 또는 5초 요청 event bucket 계약이 아니다.
- ECharts update animation은 허용하되 `prefers-reduced-motion: reduce`에서는 비활성화한다.
