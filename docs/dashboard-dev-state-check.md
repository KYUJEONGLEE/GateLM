# Dashboard Dev State Check

작성 기준: `feat/dashboard-rebuild` 브랜치에서 실제 파일과 API 호출 경로를 확인했다. 이후 2026-07-06에 로컬 GateLM demo stack을 구동하고 Web Console/Gateway/Control Plane API 및 Playwright 브라우저 화면을 추가 확인했다. 운영 배포 환경, 실제 운영 DB, upstream 인증 계층은 확인 대상이 아니다.

## 1. Branch Status

- 현재 브랜치: `feat/dashboard-rebuild`
- 브랜치 처리: 최초 `git switch feat/dashboard-rebuild`는 `fatal: invalid reference`로 실패했다. `dev`가 `origin/dev`와 같은 커밋이고 작업 트리가 비어 있어 `git switch -c feat/dashboard-rebuild`로 dev 기준 새 브랜치를 만들었다.
- 최근 커밋:
  - `b36a4937` `Merge pull request #221 from KYUJEONGLEE/feat/console-logout`
  - `728efe7c` `Merge pull request #219 from KYUJEONGLEE/test/dash-latency`
  - `660fb63a` `merge dev into dashboard latency branch`
- 작업 트리 상태: 분석 시작 직후 `git status --short --branch`는 `## feat/dashboard-rebuild`만 표시했다. 즉 기존 변경사항은 없었다. 라이브 검증 후 현재 작업 트리에는 이 문서와 Playwright screenshot 출력물(`output/playwright/`)이 untracked로 남는다.

## 2. Frontend Structure

### 주요 디렉터리

- Web Console 앱: `apps/web`
  - `apps/web/package.json` 기준 Next `15.3.5`, React `19.0.0`, ECharts `6.1.0`, lucide-react 사용.
  - `axios` 사용 흔적은 `apps/web`에서 확인되지 않았다. API 호출은 `fetch` 기반이다.
- App Router 루트:
  - `apps/web/src/app/layout.tsx`: `GateLM Web Console` metadata, locale 기반 `<html lang>`, theme 초기화 script.
  - `apps/web/src/app/page.tsx`: `WebConsoleInitView` 진입.
- Console 라우팅:
  - `apps/web/src/app/(console)/tenants/[tenantId]/dashboard/page.tsx`
  - `apps/web/src/app/(console)/tenants/[tenantId]/request-logs/page.tsx`
  - `apps/web/src/app/(console)/tenants/[tenantId]/request-logs/[requestId]/page.tsx`

### Dashboard 관련 파일

- 페이지: `apps/web/src/app/(console)/tenants/[tenantId]/dashboard/page.tsx`
  - `getLiveDashboardOverview`, `getLiveGatewayRequestLogs`, `getLiveGatewayRequestDetail`를 서버 컴포넌트에서 호출한다.
  - `getApplicationsModel`, `getProjectsModel`로 application name 보조 데이터를 가져온다.
- 로딩 UI: `apps/web/src/app/(console)/tenants/[tenantId]/dashboard/loading.tsx`
  - hero skeleton, `metric-grid` 4개 skeleton, chart skeleton 2개가 있다.
- 주요 Dashboard 컴포넌트: `apps/web/src/features/dashboard/components/dashboard-overview.tsx`
  - `DashboardOverviewView`
  - `DashboardTabs`
  - `DashboardFilterBar`
  - `RequestTrendRangeToggle`
  - `DashboardTabPanel`
  - `RecentRequestList`
  - `StatusBars`
  - `FocusStat`
  - `LineTrendChart`
  - `PieShareChart`
- Chart wrapper: `apps/web/src/features/dashboard/components/dashboard-echarts.tsx`
  - `DashboardLineEChart`
  - `DashboardPieEChart`

### Layout / Sidebar 관련 파일

- Shell: `apps/web/src/components/layout/console-shell.tsx`
  - client component.
  - sidebar, mobile topbar, tenant settings popover, language switcher, theme switch, logout button을 포함한다.
  - navigation section은 `dashboard`, `management`, `analytics`로 구성된다.
  - Analytics 하위에 `Health`, `Request logs`가 있다.
- CSS: `apps/web/src/app/globals.css`
  - `.console-shell`, `.console-sidebar`, `.console-main`, `.console-content`, `.dashboard-chart-grid`, `.dashboard-focus-stats`, `.request-log-workspace`, `.request-log-detail-aside` 등이 정의되어 있다.
- 별도 Header 컴포넌트는 확인되지 않았다. Header 역할은 `ConsoleShell` 내부의 mobile topbar/sidebar topbar가 담당한다.

### Request Logs 화면

- 별도 화면 존재: `apps/web/src/app/(console)/tenants/[tenantId]/request-logs/page.tsx`
- 상세 route 존재: `apps/web/src/app/(console)/tenants/[tenantId]/request-logs/[requestId]/page.tsx`
  - 실제 상세 페이지를 렌더하지 않고 `/request-logs?requestId=...`로 redirect한다.
- 테이블 컴포넌트: `apps/web/src/features/request-logs/components/request-log-table.tsx`
- 상세 패널: `apps/web/src/features/request-logs/components/request-log-detail.tsx`
- dashboard도 `RequestLogDetailAside`를 재사용한다.

### API client 관련 파일

- Dashboard overview: `apps/web/src/lib/gateway/live-dashboard-overview.ts`
  - `GET ${config.baseUrl}/api/dashboard/overview?...`
  - `LiveDashboardOverviewResponse`를 `DashboardOverview`로 변환한다.
- Request logs: `apps/web/src/lib/gateway/live-request-logs.ts`
  - `GET ${config.baseUrl}/api/projects/{projectId}/logs?...`
  - `GatewayProjectLogsResponse`를 `InvocationLogRecord[]`로 변환한다.
- Request detail: `apps/web/src/lib/gateway/live-request-detail.ts`
  - `GET ${config.baseUrl}/api/llm-requests/{requestId}?...`
  - `GatewayRequestDetailResponse`를 `InvocationLogRecord`로 변환한다.
- Gateway config: `apps/web/src/lib/gateway/live-gateway-config.ts`
  - `GATELM_GATEWAY_BASE_URL` 또는 `GATEWAY_BASE_URL` 없으면 `http://localhost:8080`.
- Control Plane 보조 client:
  - `apps/web/src/lib/control-plane/projects-client.ts`
  - `apps/web/src/lib/control-plane/applications-client.ts`

### Mock / fixture / 실제 API 사용 판단

- Dashboard overview/log/detail은 Gateway Core live API를 직접 호출한다. 실패 시 dashboard overview는 fixture fallback 없이 `undefined`를 반환한다.
- 타입은 `apps/web/src/lib/fixtures/v1-observability-fixtures.ts`의 `DashboardOverview`, `InvocationLogRecord`를 재사용한다. 이것은 타입/compatibility bridge 용도이며 dashboard page에서 v1 fixture 데이터를 직접 렌더하는 흐름은 확인되지 않았다.
- Control Plane project/application 이름 조회는 실패 시 v1 runtime config fixture를 fallback으로 반환한다.
- Requests Over Time과 Cache trend 차트는 실제 time bucket API 응답이 아니다. `buildTrendSeries`가 aggregate total을 hardcoded shape 배열로 분배한다.

## 3. Current Dashboard Feature Matrix

| Feature | Status | Evidence File | Notes |
|---|---|---|---|
| Total Requests 카드 | 부분 구현 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:299`, `:578` | Overview 상단 KPI card가 아니라 request trend chart header와 Requests 탭의 `FocusStat`에 표시된다. |
| Success Rate 카드 | 미구현 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:579` | `successfulRequests` count는 있지만 success rate percent 카드가 없다. |
| Average Latency 카드 | 부분 구현 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:581` | Requests 탭에서 Average/P95를 하나의 값으로 묶어 표시한다. Overview KPI card는 아니다. |
| p95 Latency 카드 | 부분 구현 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:581` | Average/P95 묶음으로만 표시된다. 독립 p95 카드가 아니다. |
| Cache Hit Rate 카드 | 부분 구현 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:651` | Cache 탭의 `FocusStat`로만 표시된다. Overview KPI card는 아니다. |
| Estimated Cost 카드 | 부분 구현 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:596` | Routing 탭에서 `totalCostUsd`를 표시한다. Overview KPI card나 `Estimated Cost` 명칭은 아니다. |
| Requests Over Time 차트 | mock/placeholder | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:244`, `:1199` | live total을 쓰지만 시간대별 실제 bucket이 아니라 hardcoded shape로 분배한다. |
| Model/Provider Usage 차트 | 부분 구현 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:258`, `:326`, `:604` | 모델 share pie는 있다. provider/model breakdown 데이터는 쓰지만 chart label은 compact model 중심이다. |
| App별 사용량 차트 | 부분 구현 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:331`, `:1333`, `:1340` | `applicationTokenRecords`의 recent logs token 합산 기반이다. Dashboard overview `breakdowns.byApplication`을 직접 쓰지 않는다. |
| Request Logs 테이블 | 부분 구현 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:573`, `apps/web/src/features/request-logs/components/request-log-table.tsx:205` | Dashboard에는 Recent logs compact list만 있다. 별도 Request Logs 화면에는 table이 있다. |
| 필터: 시간 범위 | 구현됨 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:1082` | `15m`, `1h`, `1d`, `1w` range toggle이 있다. |
| 필터: project/application | 부분 구현 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:424`, `apps/web/src/app/(console)/tenants/[tenantId]/request-logs/page.tsx:120` | Dashboard에는 `projectId`만 있다. Request Logs 화면에는 `applicationId` query는 있지만 UI select/input은 확인되지 않았다. |
| 필터: provider/model | 부분 구현 | `apps/web/src/app/(console)/tenants/[tenantId]/request-logs/page.tsx:118`, `apps/web/src/features/request-logs/components/request-log-table.tsx:240` | Request Logs에는 model select가 있다. provider는 query state에는 있지만 table UI에서 provider control은 확인되지 않았다. Dashboard 필터에는 없다. |
| 필터: status | 부분 구현 | `apps/web/src/features/request-logs/components/request-log-table.tsx:227` | Request Logs 화면에는 status select가 있다. Dashboard 필터에는 없다. |
| 필터: cache | 부분 구현 | `apps/web/src/features/request-logs/components/request-log-table.tsx:255` | Request Logs 화면에는 cache select가 있다. Dashboard 필터에는 없다. |
| 필터: safety | 미구현 | `apps/web/src/features/dashboard/components/dashboard-overview.tsx:670` | Safety 탭은 있지만 safety outcome 필터 control은 확인되지 않았다. |
| 실시간 갱신 / polling / WebSocket | 미구현 | `apps/web/src/app/(console)/tenants/[tenantId]/dashboard/page.tsx:60`, `apps/web/src/lib/gateway/live-dashboard-overview.ts:155` | `cache: "no-store"` 서버 fetch는 있으나 dashboard/request-log 코드에서 `setInterval`, `WebSocket`, `EventSource`, `router.refresh()` 기반 자동 갱신은 확인되지 않았다. |
| 요청 로그 상세 열기 | 부분 구현 | `apps/web/src/app/(console)/tenants/[tenantId]/dashboard/page.tsx:75`, `apps/web/src/features/dashboard/components/dashboard-overview.tsx:804`, `apps/web/src/features/request-logs/components/request-log-table.tsx:310` | Dashboard Requests 탭의 recent item과 별도 Request Logs table에서 detail aside를 열 수 있다. Overview 하단 table 기반 추적은 없다. |

## 4. API Integration Status

| Endpoint | Used By | Data Source | Status | Notes |
|---|---|---|---|---|
| `GET /api/dashboard/overview?from&to&tenantId&projectId&budgetScopeType&budgetScopeId&resolvedBy` | `apps/web/src/app/(console)/tenants/[tenantId]/dashboard/page.tsx` via `getLiveDashboardOverview` | Gateway Core `DashboardOverviewReader` | 부분 구현 | Frontend interface는 `LiveDashboardOverviewResponse`, display model은 `DashboardOverview`. `cache: "no-store"`와 `X-GateLM-Request-Id`만 보낸다. 실패하거나 `payload.data.totals`가 없으면 `undefined`. |
| `GET /api/projects/{projectId}/logs?from&to&tenantId&limit&status&provider&model&cacheStatus&applicationId&budgetScope...&requestId` | Dashboard recent logs, Dashboard rate-limited logs, Request Logs page | Gateway Core `ProjectLogsReader` | 구현됨 | Frontend interface는 `GatewayProjectLogsResponse`, display model은 `InvocationLogRecord[]`. 여러 projectId를 concurrency 4로 가져와 merge/sort/slice한다. |
| `GET /api/llm-requests/{requestId}?tenantId&projectId` | Dashboard detail aside, Request Logs detail aside | Gateway Core `RequestDetailReader` | 구현됨 | Frontend interface는 `GatewayRequestDetailResponse`, display model은 `InvocationLogRecord`. 404/비정상 응답은 `undefined`로 처리한다. |
| `GET /admin/v1/tenants/{tenantId}/projects?limit=50` | Dashboard application names, request-log project id discovery | Control Plane API | 부분 구현 | `getProjectsModel`이 control-plane 실패 시 fixture project를 반환한다. 이 fallback은 dashboard log query의 project id에도 영향을 줄 수 있다. |
| `GET /admin/v1/projects/{projectId}/applications?limit=50` | Dashboard application name mapping | Control Plane API | 부분 구현 | `getApplicationsModel`이 control-plane 실패 시 fixture application을 반환한다. App usage chart label이 fixture일 수 있다. |

추가 확인 사항:

- Gateway Core route 등록은 `apps/gateway-core/internal/app/router.go:268`, `:272`, `:277`에서 확인된다.
- Gateway handler는 `ProjectLogsHandler`, `RequestDetailHandler`, `DashboardOverviewHandler`를 `apps/gateway-core/internal/http/handlers/invocation_logs_handler.go:440`, `:469`, `:498`에 구현한다.
- Dashboard loading state는 `apps/web/src/app/(console)/tenants/[tenantId]/dashboard/loading.tsx`에 있다.
- Dashboard overview 실패 처리는 `Dashboard unavailable` 화면이다.
- Request Logs 실패 처리는 `sourceState="unavailable"`일 때 table row로 `Live Gateway request logs are not available right now.`를 표시한다.
- Request Logs empty state는 `No Gateway request logs found for the current range.` row다.
- Refresh 방식은 수동 navigation/filter submit/link click 또는 browser reload다. 자동 polling/WebSocket은 확인되지 않았다.
- 인증 헤더: dashboard/log/detail client는 `Authorization`이나 `X-GateLM-App-Token`을 보내지 않고 `X-GateLM-Request-Id`만 보낸다. 2026-07-06 로컬 검증에서 `GET /api/dashboard/overview`, `GET /api/projects/{projectId}/logs`, `GET /api/llm-requests/{requestId}`는 별도 Authorization/App Token 없이 200을 반환했다. Gateway observability endpoint가 운영 배포 계층에서 별도 보호되는지는 확인 불가다.
- v2 schema 정합성 리스크: `docs/v2.0.0/schemas/dashboard-overview.schema.json:189`의 totals는 `requestCount`, `successCount`, `estimatedCostMicroUsd`를 요구한다. 현재 Gateway handler는 `totalRequests`, `successfulRequests`, `totalCostMicroUsd`를 반환하고, frontend adapter가 양쪽 이름을 모두 받는 compatibility bridge를 둔다.
- 라이브 데이터 검증: 로컬 Gateway dashboard 응답은 `freshness.source=postgresql_request_log`, `recordCount=51572`, `isStale=false`를 반환했다. 검증 요청 1건 생성 후 `totalRequests`가 `51571`에서 `51572`로 증가했고, logs/detail에서도 같은 `requestId`를 확인했다.
- Control Plane live 검증: `GET /admin/v1/tenants/00000000-0000-4000-8000-000000000100/projects?limit=50`는 200과 project 6개를 반환했고, `GET /admin/v1/projects/00000000-0000-4000-8000-000000000200/applications?limit=50`는 200과 application 1개를 반환했다. 따라서 이번 실행에서는 project/application fixture fallback이 아니라 live Control Plane 응답을 사용했다.

## 5. Current Problems

1. Overview가 KPI-first 화면이 아니다.
   - 현재 Overview는 hero, tab row, chart grid, status distribution 순서다. Total/success/latency/cache/cost KPI는 Overview 상단에 5~6개 카드로 모이지 않고 탭별로 흩어져 있다.

2. Requests Over Time이 실제 운영 time series가 아니다.
   - `buildTrendSeries`가 aggregate total을 hardcoded shape로 나눠 그린다. 발표 화면에서 실제 트래픽 곡선처럼 보이지만, backend time bucket 근거가 없다.

3. Request Logs 추적 흐름이 Dashboard 하단에 없다.
   - 별도 Request Logs 화면은 존재하지만 Dashboard Overview 하단에는 full table이 없다. Dashboard Requests 탭에는 최근 5개 compact list만 있다.

4. Dashboard 필터가 목표 범위보다 좁다.
   - Dashboard 자체 필터는 range, projectId, budgetScopeType, budgetScopeId, resolvedBy만 확인된다. application, provider, model, status, cache, safety 필터는 Dashboard에 없다.

5. 요청 발생 직후 자동 갱신 구조가 없다.
   - live fetch는 `cache: "no-store"`지만 server component navigation 시점에만 다시 로드된다. polling/WebSocket/EventSource는 dashboard/request-log 경로에서 확인되지 않았다.

6. Dashboard API contract naming이 v2 schema와 맞지 않는다.
   - v2 schema는 `requestCount/successCount/estimatedCostMicroUsd` 계열인데 Gateway handler는 `totalRequests/successfulRequests/totalCostMicroUsd` 계열을 반환한다. frontend compatibility bridge가 이를 흡수하고 있어 문제를 숨긴다.

7. 한글/영어 표기가 섞여 있다.
   - Korean locale에서도 `Overview`, `Requests`, `Cache`, `Routing`, `Safety`, `Limits`, `Project`, `Scope type`, `Resolved by`, `Provider` 등 영어가 그대로 노출된다.

8. App별 사용량 차트의 의미가 약하다.
   - 현재 App chart는 dashboard overview breakdown이 아니라 recent request logs의 token 합산이다. 요청 수/비용/토큰 중 무엇을 보여주는지 제품 화면에서 명확하지 않다.

9. Empty/failure/freshness 표현이 발표용으로 약하다.
   - Dashboard unavailable은 있지만 정상 응답에서 empty chart는 `none/0` fallback 중심이다. `freshness`, `lastIngestedAt`, `recordCount`, stale 상태를 화면 핵심에 드러내지 않는다.

10. Request detail은 유용하지만 보안/정책 문구 정리가 필요하다.
    - `RequestLogDetailPanel`은 `promptCapture.capturedPrompt`가 있으면 표시한다. 이 값이 log-safe post-masking prompt라는 전제가 코드 밖에서 명확하지 않으면 AGENTS Forbidden Data 원칙과 충돌해 보일 수 있다.

## 6. Recommended Dashboard Redesign Plan

1. Dashboard view model을 먼저 정리한다.
   - `DashboardOverview`를 그대로 UI에 흘리지 말고, KPI/view 전용 selector를 만든다.
   - success rate는 `successfulRequests / totalRequests`로 계산하되, v2 schema의 `successCount/requestCount`와 Gateway live field naming 중 어느 쪽을 canonical로 삼을지 먼저 결정한다.

2. Overview 상단 KPI 카드 5~6개를 구현 단위로 분리한다.
   - Total Requests
   - Success Rate
   - Avg Latency
   - p95 Latency
   - Cache Hit Rate
   - Estimated Cost
   - 기존 탭별 `FocusStat`를 그대로 끌어오지 말고 Overview 전용 card grid로 재구성한다.

3. Requests Over Time을 실제 데이터 기반으로 바꾼다.
   - 단기안: 기존 `/api/projects/{projectId}/logs` 응답의 `createdAt`을 range별 bucket으로 group한다.
   - 제한: logs endpoint `limit=100`이면 고트래픽 구간에서는 불완전할 수 있다.
   - 장기안: v2 계약에 맞는 dashboard time bucket field 또는 별도 rollup endpoint를 계약 변경으로 제안한다.

4. Provider/Model Usage chart를 `breakdowns.byProviderModel` 기준으로 재구성한다.
   - label은 `provider / model`을 함께 보여준다.
   - request count, p95 provider latency, cost 중 chart 목적을 하나로 정한다.

5. App별 사용량 chart를 `breakdowns.byApplication` 기준으로 바꾼다.
   - app name mapping은 Control Plane에서 가져오되, Control Plane fixture fallback일 때 UI에 demo/fallback 상태를 표시한다.
   - metric은 request count 또는 cost로 고정한다. token 합산 chart라면 title을 `Application Token Usage`로 명확히 한다.

6. Dashboard 하단 Request Logs table을 별도 화면에서 추출해 재사용한다.
   - 목표 column: `time`, `requestId`, `application`, `provider`, `model`, `status`, `cache`, `safety`, `latency`, `cost`.
   - 기존 `RequestLogTable`은 페이지 전체 layout/search/pagination을 포함하므로 table-only component 또는 row component를 추출하는 쪽이 안전하다.
   - row click/detail aside는 기존 `RequestLogDetailAside`를 재사용한다.

7. Refresh 구조를 polling부터 추가한다.
   - 우선 5~10초 polling으로 overview/logs를 갱신한다.
   - 현재 Dashboard가 server component 중심이라 polling을 하려면 client wrapper/API route/SWR류 패턴 중 하나를 선택해야 한다.
   - WebSocket/EventSource는 현재 Web Console dashboard 코드에서 확인되지 않았으므로 재사용 가능성은 확인 불가다.

8. Filter scope를 단계적으로 넓힌다.
   - 1차: Dashboard table/chart client-side filter로 application/provider/model/status/cache/safety를 적용한다.
   - 2차: overview aggregate까지 같은 필터가 필요하면 Gateway API 계약에 필터를 추가하는 문서/계약 PR을 먼저 분리한다.

9. Loading/empty/failure/freshness 상태를 제품 화면 수준으로 정리한다.
   - empty: request count 0, no logs, filter no result를 구분한다.
   - failure: Gateway unavailable, Control Plane fallback, partial project fetch를 구분한다.
   - freshness: `lastIngestedAt`, `lastAggregatedAt`, `isStale`, `recordCount`를 작은 status area에 표시한다.

10. Placeholder처럼 보이는 요소를 제거한다.
    - hardcoded trend shape 제거.
    - `none` pie fallback은 empty state로 대체.
    - 혼합 언어 label 정리.

## 7. Risk / Unknowns

- 실행 화면: 확인됨. `powershell -NoProfile -ExecutionPolicy Bypass -File "C:\Users\KJ\.codex\skills\gatelm-dev-servers\scripts\start-gatelm-servers.ps1"`로 로컬 stack을 구동했고, Web Console `http://localhost:3000/`와 Application `http://localhost:3002/`가 HTTP 200을 반환했다. Playwright/Edge로 dashboard desktop/mobile 화면을 열어 chart canvas 3개와 ECharts role 3개를 확인했다. screenshot은 `output/playwright/dashboard-overview-1440.png`, `output/playwright/dashboard-overview-390.png`다. 단, 실제 사용자 기기별 애니메이션 품질은 추가 수동 QA가 필요하다.
- 라이브 데이터: 확인됨. Gateway dashboard API는 로컬 PostgreSQL request log read model을 사용했고 `freshness.source=postgresql_request_log`, `recordCount=51572`, `isStale=false`를 반환했다. 검증용 Gateway 요청 1건은 HTTP 500으로 실패했지만 request log에 `terminalStatus=failed`, `cacheStatus=bypass`, `safetyOutcome=passed`로 남았고 dashboard total도 1 증가했다.
- observability endpoint 인증: 로컬에서는 무인증 접근 가능함이 확인됨. frontend client도 `Authorization`/`X-GateLM-App-Token` 없이 `X-GateLM-Request-Id`만 보낸다. 운영 배포에서 reverse proxy, ingress, network policy, session auth 등 upstream 보호가 있는지는 이 repo/local stack만으로 확인 불가다.
- v2 schema와 live Gateway response naming 불일치: 확인됨. 라이브 `totals` key는 `totalRequests`, `successfulRequests`, `totalCostMicroUsd` 등을 포함하고, v2 schema required key인 `requestCount`, `successCount`, `blockedCount`, `rateLimitedCount`, `failedCount`, `cancelledCount`, `estimatedCostMicroUsd`는 응답에 없었다. frontend compatibility bridge가 이를 흡수한다.
- time-series source: 불확실이 아니라 현재 구현상 placeholder 성격으로 확인됨. Dashboard overview API 응답에서 실제 bucket series field는 확인되지 않았고, UI의 `Requests Over Time`은 `buildTrendSeries`가 aggregate count를 hardcoded shape로 분배한다. 같은 dashboard 화면에서 검증 요청 후 7초 대기해도 값이 바뀌지 않았고, reload 후 `Request trend` 값이 2에서 3으로 바뀌었다. 즉 자동 polling 없이 reload 시점에만 live data가 반영된다.
- application usage source: 구현 불일치 확인됨. 라이브 dashboard API에는 `breakdowns.byApplication`이 존재했고 row 1개를 반환했다. 그러나 현재 UI의 application chart는 `overview.breakdowns.byApplication`이 아니라 recent logs의 `totalTokens` 합산(`getApplicationTokenRows`)을 사용한다. 발표 핵심 지표를 request count, token, cost 중 무엇으로 둘지 결정이 필요하다.
- prompt capture UI 정책: 이번 생성 request detail에서는 `promptCapture.enabled=false`, `capturedPromptPresent=false`로 확인됐다. 다만 `apps/web/src/features/request-logs/components/request-log-detail.tsx`는 `record.promptCapture?.enabled && record.promptCapture.capturedPrompt`일 때 captured prompt를 표시한다. log-safe post-masking 값이라는 계약/라벨이 명확하지 않으면 Forbidden Data 정책 리스크가 남는다.
- Control Plane fixture fallback: 이번 실행에서는 fallback이 아니라 live Control Plane 응답을 사용함이 확인됐다. 다만 `projects-client.ts`와 `applications-client.ts`는 Control Plane 실패 시 v1 runtime config fixture를 반환하므로, Control Plane 장애 상황에서는 demo/fixture label이 실제 데이터처럼 보일 수 있는 코드 리스크가 남는다.
- Request Log detail 추적: 확인됨. Request Logs 화면 `http://localhost:3000/tenants/00000000-0000-4000-8000-000000000100/request-logs?requestId=request_codex_dashboard_poll_1783341651469`에서 detail aside가 열렸고 `Gateway outcome`과 HTTP 500 context를 표시했다. screenshot은 `output/playwright/request-logs-detail-1440.png`다. 다만 현재 table column은 `REQUEST`, `STATUS`, `MODEL`, `SAFETY`, `CACHE`, `LATENCY`, `TOKENS`, `CREATED`이며 목표 column(`time`, `requestId`, `application`, `provider`, `model`, `status`, `cache`, `safety`, `latency`, `cost`)과 다르다.
- Browser console: dashboard/request-log 화면에서 page error는 없었다. console에는 404 resource error 1건이 있었으나 요청 실패 목록에는 잡히지 않았다. favicon 등 정적 리소스 가능성이 있지만 정확한 resource URL은 추가 확인이 필요하다.

## Next Implementation Tasks

- Task 1: Dashboard API/view model canonical field 정리
- Task 2: Dashboard KPI cards 재구성
- Task 3: Requests Over Time을 실제 logs bucket 기반으로 교체
- Task 4: Provider/Model Usage chart를 `breakdowns.byProviderModel` 기반으로 재구성
- Task 5: Application Usage chart source와 metric 확정
- Task 6: Request Logs table-only component 추출 및 Dashboard 하단 배치
- Task 7: Request detail aside를 Dashboard table row와 연결
- Task 8: polling 기반 refresh 추가
- Task 9: Dashboard filter set 확장
- Task 10: placeholder/mock chart shape 제거 및 empty/freshness/failure 상태 정리
