import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const overviewSourceUrl = new URL("./dashboard-overview.tsx", import.meta.url);
const chartSourceUrl = new URL("./dashboard-echarts.tsx", import.meta.url);
const costSourceUrl = new URL("./cost-over-time-card.tsx", import.meta.url);
const dashboardStylesSourceUrl = new URL("../../../app/globals.css", import.meta.url);
const liveRequestViewSourceUrl = new URL("./live-requests-view.tsx", import.meta.url);
const liveRequestsSourceUrl = new URL("./live-requests-card.tsx", import.meta.url);
const providerUsageSourceUrl = new URL("./provider-model-usage-card.tsx", import.meta.url);
const tenantChatLiveRequestsSourceUrl = new URL(
  "../../../lib/dashboard/tenant-chat-live-requests.ts",
  import.meta.url
);

test("dashboard separates aggregate and live-request polling", async () => {
  const source = await readFile(overviewSourceUrl, "utf8");
  const liveRequestsSource = await readFile(liveRequestsSourceUrl, "utf8");

  expect(source).toContain("/api/dashboard/snapshot?${snapshotQueryString}");
  expect(source).toContain("DASHBOARD_SNAPSHOT_POLL_INTERVAL_MS");
  expect(source).toContain('document.visibilityState !== "visible"');
  expect(source).toContain('document.addEventListener("visibilitychange"');
  expect(source).toContain("controller?.abort()");
  expect(source).toContain("setSnapshot(payload.data)");
  expect(source.match(/pollingEnabled=\{false\}/g)).toHaveLength(1);
  expect(source).toContain("initialPayload={initialLiveRequests}");
  expect(source).not.toContain("setLiveStatusFilter");
  expect(source).not.toContain("setLiveModelFilter");
  expect(liveRequestsSource).toContain("LIVE_REQUESTS_POLL_INTERVAL_MS = 2000");
  expect(liveRequestsSource).toContain("pollingEnabled = true");
});

test("dashboard cards render their incoming payload without an effect-delayed copy", async () => {
  const [costSource, liveRequestsSource] = await Promise.all([
    readFile(costSourceUrl, "utf8"),
    readFile(liveRequestsSourceUrl, "utf8")
  ]);

  expect(costSource).toContain("pollingEnabled ? summary : normalizedInitialSummary");
  expect(costSource).toContain("resampleCostOverTimeForDisplay(displayedSummary, range)");
  expect(costSource.match(/points=\{renderedSummary\.points\}/g)).toHaveLength(2);
  expect(liveRequestsSource).toContain("normalizeLiveRequestRows(initialPayload?.rows)");
  expect(liveRequestsSource).toContain("displayedRows.slice(0, COMPACT_LIVE_REQUEST_LIMIT)");
});

test("compact request detail opens the focus view before nested request detail", async () => {
  const source = await readFile(liveRequestsSourceUrl, "utf8");
  const compactViewStart = source.indexOf(
    "<LiveRequestsView",
    source.indexOf('className="dashboard-live-requests-slot"')
  );
  const focusDialogStart = source.indexOf("<LiveRequestsFocusDialog");
  const requestDetailHandlerStart = source.indexOf("function openRequestDetail");
  const requestDetailHandlerEnd = source.indexOf(
    "function closeRequestDetail",
    requestDetailHandlerStart
  );
  const compactView = source.slice(compactViewStart, focusDialogStart);
  const focusView = source.slice(focusDialogStart);
  const requestDetailHandler = source.slice(
    requestDetailHandlerStart,
    requestDetailHandlerEnd
  );

  expect(compactView).toContain("onOpenRequest={openFocusView}");
  expect(focusView).toContain("onOpenRequest={openRequestDetail}");
  expect(requestDetailHandler).not.toContain("openFocusView()");
});

test("overview keeps four live KPI cards with month-to-date cost in the final position", async () => {
  const source = await readFile(overviewSourceUrl, "utf8");
  const totalCostIndex = source.indexOf("label: text.kpi.totalCost");
  const totalRequestsIndex = source.indexOf("label: text.kpi.totalRequests");
  const averageLatencyIndex = source.indexOf("label: text.kpi.averageLatency");
  const monthCostIndex = source.indexOf("label: text.kpi.monthCost");

  expect(totalCostIndex).toBeGreaterThan(0);
  expect(totalRequestsIndex).toBeGreaterThan(totalCostIndex);
  expect(averageLatencyIndex).toBeGreaterThan(totalRequestsIndex);
  expect(monthCostIndex).toBeGreaterThan(averageLatencyIndex);
  expect(source).toContain('monthCost: "이번 달 총 비용"');
  expect(source).not.toContain('monthCost: "이번 달 누적 비용"');
  expect(source).toContain("value: formatMicroUsd(overview.totalCostMicroUsd)");
  expect(source).toContain(
    "value: formatLatency(Math.round(overview.averageLatencyMs))"
  );
  expect(source).toContain("snapshot.monthToDateCostMicroUsd");
});

test("overview removes the redundant data freshness timestamp from the main header", async () => {
  const source = await readFile(overviewSourceUrl, "utf8");

  expect(source).not.toContain("dashboard-data-freshness");
  expect(source).not.toContain("dataAsOf");
  expect(source).not.toContain("formatDashboardDataAsOf");
});

test("live requests show the executed model, TTFT, and readable cost only", async () => {
  const source = await readFile(liveRequestViewSourceUrl, "utf8");

  expect(source).toContain("formatResponseTimeSeconds(row.ttftMs)");
  expect(source).toContain("formatLiveRequestCostUsd(row.costUsd)");
  expect(source).toContain('className="dashboard-live-col-cost"');
  expect(source.match(/colSpan=\{9\}/g)).toHaveLength(2);
  expect(source).toContain("row.ttftMs");
  expect(source).not.toContain("row.category");
  expect(source).not.toContain("row.difficulty");
  expect(source).not.toContain("row.routingReason");
});

test("live request columns place cost before status and size columns by content length", async () => {
  const [source, styles] = await Promise.all([
    readFile(liveRequestViewSourceUrl, "utf8"),
    readFile(dashboardStylesSourceUrl, "utf8")
  ]);
  const tableSource = source.slice(source.indexOf("<colgroup>"), source.indexOf("</table>"));

  expect(tableSource).toMatch(
    /dashboard-live-col-model[\s\S]*dashboard-live-col-cost[\s\S]*dashboard-live-col-policy[\s\S]*dashboard-live-col-latency[\s\S]*dashboard-live-col-status[\s\S]*dashboard-live-col-action/
  );
  expect(tableSource).toMatch(
    /"Model"[\s\S]*"Cost"[\s\S]*"Outcome"[\s\S]*"Response time"[\s\S]*"Status"[\s\S]*text\.detail/
  );
  expect(tableSource).toContain('locale === "ko" ? "처리 결과" : "Outcome"');
  expect(tableSource).toMatch(
    /LiveRequestRouting[\s\S]*formatLiveRequestCostUsd[\s\S]*PolicyBadges[\s\S]*formatResponseTimeSeconds[\s\S]*statusTone/
  );
  expect(styles).toMatch(
    /\.dashboard-live-col-time,\s*\.dashboard-live-col-cost,\s*\.dashboard-live-col-latency,\s*\.dashboard-live-col-action \{\s*width: 8%;\s*\}/
  );
  expect(styles).toMatch(
    /\.dashboard-live-col-user,\s*\.dashboard-live-col-policy,\s*\.dashboard-live-col-status \{\s*width: 12%;\s*\}/
  );
  expect(styles).toMatch(
    /\.dashboard-live-col-project,\s*\.dashboard-live-col-model \{\s*width: 16%;\s*\}/
  );
  expect(styles).not.toContain("width: calc(100% / 9);");
});

test("live request status header and cell contents are center aligned", async () => {
  const styles = await readFile(dashboardStylesSourceUrl, "utf8");
  const focusStyles = styles.slice(
    styles.indexOf("/* Live Requests focus workspace and request detail presentation */")
  );

  expect(focusStyles).toMatch(
    /\.dashboard-live-requests-table th,\s*\.dashboard-live-requests-table td \{[^}]*text-align: left;/
  );
  expect(focusStyles).toMatch(
    /\.dashboard-live-provider-model \{[^}]*justify-content: flex-start;/
  );
  expect(styles).toMatch(
    /\.dashboard-live-requests-table th:nth-child\(8\),\s*\.dashboard-live-requests-table td:nth-child\(8\) \{[^}]*text-align: center;/
  );
});

test("tenant chat live requests preserve provider identity for provider icons", async () => {
  const source = await readFile(tenantChatLiveRequestsSourceUrl, "utf8");

  expect(source).toContain("const providerId = invocation.providerId?.trim() || null");
  expect(source).toContain("resolveProviderDisplay(");
  expect(source).toContain("providerFamily: providerDisplay?.family ?? null");
  expect(source).toContain("providerName: providerDisplay?.name ?? null");
  expect(source).toContain("latencyMs: invocation.latencyMs");
  expect(source).toContain("ttftMs: invocation.ttftMs");
  expect(source).toContain("costUsd: invocation.confirmedCostMicroUsd / 1_000_000");
});

test("provider usage keeps the existing cost breakdown wired to the redesigned donut", async () => {
  const [overviewSource, providerUsageSource, styles] = await Promise.all([
    readFile(overviewSourceUrl, "utf8"),
    readFile(providerUsageSourceUrl, "utf8"),
    readFile(dashboardStylesSourceUrl, "utf8")
  ]);

  expect(overviewSource).toContain("overview.costByModel.map");
  expect(overviewSource).toContain("costMicroUsd: row.costMicroUsd");
  expect(providerUsageSource).toContain("value: row.costMicroUsd");
  expect(providerUsageSource).toContain("formatMicroUsdSummary(totalCostMicroUsd)");
  expect(providerUsageSource).toContain("maximumFractionDigits: 3");
  expect(providerUsageSource).not.toContain("row.requestCount");
  expect(providerUsageSource).not.toContain("<em>{formatMicroUsd(row.costMicroUsd)}</em>");
  expect(styles).toMatch(
    /\.dashboard-provider-usage-body \{[^}]*grid-template-columns: minmax\(0, 1fr\);[^}]*grid-template-rows: minmax\(180px, 0\.9fr\) auto;/
  );
});

test("dashboard keeps cost range controls and stacked mobile panels inside the layout flow", async () => {
  const [costSource, styles] = await Promise.all([
    readFile(costSourceUrl, "utf8"),
    readFile(dashboardStylesSourceUrl, "utf8")
  ]);
  const normalizedSource = costSource.replace(/\r\n/g, "\n");
  const titleEnd = normalizedSource.indexOf('</div>\n        <div className="dashboard-cost-over-time-header-side">');
  const metricsStart = normalizedSource.indexOf('className="dashboard-cost-over-time-metrics"');

  expect(titleEnd).toBeGreaterThan(0);
  expect(metricsStart).toBeGreaterThan(titleEnd);
  expect(styles).toMatch(
    /\.dashboard-cost-over-time-header \{[^}]*grid-template-areas:\s*"title side"\s*"metrics metrics";/
  );
  expect(styles).toMatch(
    /\.dashboard-secondary-grid \{[^}]*grid-template-columns: 1fr;[^}]*height: auto;[^}]*max-height: none;[^}]*overflow: visible;/
  );
  expect(styles).toMatch(
    /html\[data-theme="dark"\] \.dashboard-cost-over-time-metrics > div\[data-kind="total"\] strong,[\s\S]*?color: var\(--foreground\);/
  );
});

test("dashboard keeps its compact default scale and enlarges operational labels only in expanded mode", async () => {
  const styles = await readFile(dashboardStylesSourceUrl, "utf8");
  const readabilityStyles = styles.slice(
    styles.indexOf("/* Dashboard concept scale: compact, high-signal cards aligned with the operational mockup. */")
  );

  expect(readabilityStyles).toMatch(
    /\.dashboard-overview-content \.dashboard-kpi-label \{[^}]*font-size: calc\(16px \+ var\(--global-font-lift\)\);/
  );
  expect(readabilityStyles).toMatch(
    /html\[data-presentation-mode="true"\] \.dashboard-overview-content \.dashboard-kpi-label \{[^}]*font-size: calc\(26px \+ var\(--global-font-lift\)\);/
  );
  expect(readabilityStyles).toMatch(
    /html\[data-presentation-mode="true"\] \.dashboard-overview-content \.dashboard-cost-range-tabs a \{[^}]*min-width: 68px;[^}]*min-height: 38px;[^}]*font-size: calc\(16px \+ var\(--global-font-lift\)\);/
  );
  expect(readabilityStyles).toMatch(
    /html\[data-presentation-mode="true"\] \.dashboard-overview-content \.dashboard-provider-usage-header select \{[^}]*width: fit-content;[^}]*min-width: 116px;[^}]*min-height: 38px;[^}]*font-size: calc\(15px \+ var\(--global-font-lift\)\);/
  );
  expect(readabilityStyles).toMatch(
    /html\[data-presentation-mode="true"\] \.dashboard-overview-content \.dashboard-cost-over-time-metrics span \{[^}]*font-size: calc\(24px \+ var\(--global-font-lift\)\);/
  );
  expect(readabilityStyles).toMatch(
    /html\[data-presentation-mode="true"\] \.dashboard-overview-content \.dashboard-provider-usage-provider-icon \{[^}]*width: 38px;[^}]*height: 38px;/
  );
  expect(readabilityStyles).toMatch(
    /html\[data-presentation-mode="true"\] \.dashboard-overview-content \.dashboard-provider-usage-row strong,[\s\S]*?font-size: calc\(22px \+ var\(--global-font-lift\)\);/
  );
  expect(readabilityStyles).toMatch(
    /html\[data-presentation-mode="true"\] \.dashboard-overview-content \.dashboard-live-requests-table td,[\s\S]*?font-size: calc\(19px \+ var\(--global-font-lift\)\);/
  );
  expect(readabilityStyles).toMatch(
    /html\[data-presentation-mode="true"\] \.dashboard-overview-content \.dashboard-live-provider-icon \{[^}]*width: 36px;[^}]*height: 36px;/
  );
  expect(readabilityStyles).toMatch(
    /html\[data-presentation-mode="true"\] \.dashboard-overview-content \.dashboard-live-provider-model strong \{[^}]*font-size: calc\(20px \+ var\(--global-font-lift\)\);/
  );
  expect(readabilityStyles).toMatch(
    /@media \(min-width: 1101px\) and \(max-width: 1280px\) \{\s*html\[data-presentation-mode="true"\] \.dashboard-overview-content \.dashboard-kpi-grid \{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/
  );
  expect(readabilityStyles).toMatch(
    /html\[data-presentation-mode="true"\] \.dashboard-overview-content \.dashboard-cost-over-time-header \{\s*grid-template-areas:\s*"title"\s*"side"\s*"metrics";/
  );
});

test("dashboard charts merge changed data without replaying unchanged series", async () => {
  const source = await readFile(chartSourceUrl, "utf8");

  expect(source).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
  expect(source).toContain("animationDurationUpdate: reducedMotion ? 0 : 280");
  expect(source).toContain('animationEasingUpdate: "cubicOut"');
  expect(source).toContain("appliedOptionKeyRef.current === renderedOptionKey");
  expect(source).toContain("notMerge: false");
  expect(source).not.toContain('replaceMerge: ["series"]');
  expect(source).toContain('id: `dashboard-line-${index}`');
  expect(source).toContain('id: "dashboard-pie-usage"');
  expect(source).toContain('id: "dashboard-cost-spend"');
  expect(source).toContain('id: "dashboard-cost-average"');
  expect(source).toContain('id: "dashboard-cost-density"');
  expect(source).toContain("const visibleCostBucketCount = 60");
  expect(source).toContain("const costWindowThreshold = 64");
  expect(source).toContain('barWidth: "62%"');
  expect(source).toContain('type: "slider"');
  expect(source).toContain("showDataShadow: false");
  expect(source).toContain("components.DataZoomComponent");
});
