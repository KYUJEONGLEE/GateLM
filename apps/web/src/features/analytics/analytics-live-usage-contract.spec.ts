import { expect, test } from "@playwright/test";
import { parseAnalyticsLiveUsage } from "@/features/analytics/analytics-live-usage-contract";

test("normalizes the bounded live usage response", () => {
  const result = parseAnalyticsLiveUsage({
    bucketIntervalSeconds: 5,
    buckets: [{
      incomingRps: 2,
      periodEnd: "2026-07-24T03:00:05Z",
      periodStart: "2026-07-24T03:00:00Z",
      processedRequestCount: 7,
      processedRps: 1.4,
      rateLimitedRequestCount: 3,
      rateLimitedRps: 0.6,
      requestCount: 10
    }],
    currentWindowSeconds: 5,
    dataFreshness: {
      generatedAt: "2026-07-24T03:15:00Z",
      lastLogCreatedAt: "2026-07-24T03:14:59Z",
      recordCount: 10,
      source: "clickhouse_project_application"
    },
    deltaWindowSeconds: 10,
    from: "2026-07-24T03:00:00Z",
    projectId: null,
    projects: [{
      currentIncomingRps: 2,
      deltaPercent: 50,
      processedRequestCount: 7,
      projectId: "project-1",
      rateLimitedRate: 0.3,
      rateLimitedRequestCount: 3,
      requestCount: 10,
      trend: "up"
    }],
    range: "15m",
    rateLimitStartedAt: "2026-07-24T03:00:00Z",
    summary: {
      currentIncomingRps: 2,
      peakIncomingRps: 4,
      processedRequestCount: 7,
      rateLimitedRate: 0.3,
      rateLimitedRequestCount: 3,
      requestCount: 10
    },
    to: "2026-07-24T03:15:00Z"
  });

  expect(result?.range).toBe("15m");
  expect(result?.projects[0]?.trend).toBe("up");
  expect(result?.summary.rateLimitedRate).toBe(0.3);
  expect(result?.from).toBe("2026-07-24T03:00:00.000Z");
});

test("rejects missing range boundaries and clamps unsafe numeric values", () => {
  expect(parseAnalyticsLiveUsage({ range: "15m" })).toBeUndefined();
  const result = parseAnalyticsLiveUsage({
    buckets: [],
    dataFreshness: {
      generatedAt: "2026-07-24T03:15:00Z",
      recordCount: -10,
      source: ""
    },
    from: "2026-07-24T03:00:00Z",
    projects: [],
    range: "15m",
    summary: {
      currentIncomingRps: -2,
      rateLimitedRate: 4,
      requestCount: -1
    },
    to: "2026-07-24T03:15:00Z"
  });
  expect(result?.summary.currentIncomingRps).toBe(0);
  expect(result?.summary.rateLimitedRate).toBe(1);
  expect(result?.dataFreshness.recordCount).toBe(0);
});
