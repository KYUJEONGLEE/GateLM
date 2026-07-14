# Dashboard Live Snapshot Polling Contract Proposal

| Field | Value |
|---|---|
| Status | Proposed; implementation companion, not active until merged and accepted |
| Applies to | Web Console Dashboard BFF and browser refresh behavior |
| Baseline | `origin/dev @ cc23ffac` |
| Polling target | 1 second after the previous request settles |

## 1. 목적

Dashboard의 KPI, 비용 시계열, Provider/Model 사용량, Live Requests, 월 누적 비용을 서로 다른 시점에 갱신하지 않고 하나의 browser-visible snapshot으로 교체한다. 이 계약은 Gateway Request Log, Tenant Chat projection, Metrics 의미를 변경하지 않는다.

## 2. Web BFF

`GET /api/dashboard/snapshot`은 기존 Console session을 사용한다. `tenantId`는 필수이며 Dashboard의 `range`, `surface`, `projectId`, `budgetScopeType`, `budgetScopeId`, `resolvedBy`와 Live Requests의 `status`, `model` filter를 선택적으로 받는다.

응답은 다음 read model을 한 번에 반환한다.

- `overview`: 기존 unified Dashboard overview
- `costOverTime`: 기존 unified cost series
- `liveRequests`: 기존 sanitized Live Requests payload
- `monthToDateCostMicroUsd`: 기존 Project/Application과 Tenant Chat confirmed cost의 합
- `generatedAt`: BFF가 snapshot 조합을 완료한 UTC timestamp

응답과 오류는 `Cache-Control: no-store`다. raw prompt, raw response, credential, token, provider raw error는 포함하지 않는다.

## 3. 권한과 실패

- 인증되지 않은 요청은 `401`이다.
- tenant 접근이 없거나 project scope를 벗어나면 `403`이다.
- 필수 source를 조합하지 못하면 `502`이며 browser는 마지막 정상 snapshot을 유지한다.
- project-scoped admin과 project/budget filter가 존재하면 `surface=project_application`으로 제한한다.

## 4. Browser 갱신

- 동일 filter에서 in-flight 요청을 중첩하지 않는다.
- visible document에서만 polling하고 다시 visible이 되면 즉시 갱신한다.
- `generatedAt`이 현재 snapshot보다 최신인 응답만 적용한다.
- 하나의 React state 교체로 모든 dashboard 관측 카드를 같은 render에서 갱신한다.
- ECharts update animation은 허용하되 `prefers-reduced-motion: reduce`에서는 비활성화한다.
