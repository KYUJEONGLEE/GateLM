import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const overviewSourceUrl = new URL("./dashboard-overview.tsx", import.meta.url);
const chartSourceUrl = new URL("./dashboard-echarts.tsx", import.meta.url);
const costSourceUrl = new URL("./cost-over-time-card.tsx", import.meta.url);
const liveRequestViewSourceUrl = new URL("./live-requests-view.tsx", import.meta.url);
const liveRequestsSourceUrl = new URL("./live-requests-card.tsx", import.meta.url);
const providerUsageSourceUrl = new URL("./provider-model-usage-card.tsx", import.meta.url);
const tenantChatLiveRequestsSourceUrl = new URL(
  "../../../lib/dashboard/tenant-chat-live-requests.ts",
  import.meta.url
);

test("dashboard replaces all cards from one visibility-aware snapshot poll", async () => {
  const source = await readFile(overviewSourceUrl, "utf8");

  expect(source).toContain("/api/dashboard/snapshot?${snapshotQueryString}");
  expect(source).toContain("DASHBOARD_SNAPSHOT_POLL_INTERVAL_MS");
  expect(source).toContain('document.visibilityState !== "visible"');
  expect(source).toContain('document.addEventListener("visibilitychange"');
  expect(source).toContain("controller?.abort()");
  expect(source).toContain("setSnapshot(payload.data)");
  expect(source.match(/pollingEnabled=\{false\}/g)).toHaveLength(2);
});

test("snapshot-managed cards render their incoming payload without an effect-delayed copy", async () => {
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
  expect(source).toContain("value: formatMicroUsd(overview.totalCostMicroUsd)");
  expect(source).toContain("value: formatLatency(overview.averageLatencyMs)");
  expect(source).toContain("snapshot.monthToDateCostMicroUsd");
});

test("overview removes the redundant data freshness timestamp from the main header", async () => {
  const source = await readFile(overviewSourceUrl, "utf8");

  expect(source).not.toContain("dashboard-data-freshness");
  expect(source).not.toContain("dataAsOf");
  expect(source).not.toContain("formatDashboardDataAsOf");
});

test("live requests show the executed model, end-to-end latency, and readable cost only", async () => {
  const source = await readFile(liveRequestViewSourceUrl, "utf8");

  expect(source).toContain("formatResponseTimeSeconds(row.latencyMs)");
  expect(source).toContain("formatLiveRequestCostUsd(row.costUsd)");
  expect(source).toContain('className="dashboard-live-col-cost"');
  expect(source.match(/colSpan=\{9\}/g)).toHaveLength(2);
  expect(source).not.toContain("row.ttftMs");
  expect(source).not.toContain("row.category");
  expect(source).not.toContain("row.difficulty");
  expect(source).not.toContain("row.routingReason");
});

test("tenant chat live requests preserve provider identity for provider icons", async () => {
  const source = await readFile(tenantChatLiveRequestsSourceUrl, "utf8");

  expect(source).toContain("const providerId = invocation.providerId?.trim() || null");
  expect(source).toContain("resolveProviderDisplay(");
  expect(source).toContain("providerFamily: providerDisplay?.family ?? null");
  expect(source).toContain("providerName: providerDisplay?.name ?? null");
  expect(source).toContain("latencyMs: invocation.latencyMs");
  expect(source).toContain("costUsd: invocation.confirmedCostMicroUsd / 1_000_000");
});

test("provider usage keeps the existing cost breakdown wired to the redesigned donut", async () => {
  const [overviewSource, providerUsageSource] = await Promise.all([
    readFile(overviewSourceUrl, "utf8"),
    readFile(providerUsageSourceUrl, "utf8")
  ]);

  expect(overviewSource).toContain("overview.costByModel.map");
  expect(overviewSource).toContain("costMicroUsd: row.costMicroUsd");
  expect(providerUsageSource).toContain("value: row.costMicroUsd");
  expect(providerUsageSource).toContain("formatMicroUsdSummary(totalCostMicroUsd)");
  expect(providerUsageSource).not.toContain("row.requestCount");
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
