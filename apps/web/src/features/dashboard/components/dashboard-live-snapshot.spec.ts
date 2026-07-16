import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const overviewSourceUrl = new URL("./dashboard-overview.tsx", import.meta.url);
const chartSourceUrl = new URL("./dashboard-echarts.tsx", import.meta.url);
const costSourceUrl = new URL("./cost-over-time-card.tsx", import.meta.url);
const liveRequestsSourceUrl = new URL("./live-requests-card.tsx", import.meta.url);

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
