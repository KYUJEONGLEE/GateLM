import { expect, test } from "@playwright/test";
import {
  analyticsLiveUsageSignature,
  initialAnalyticsLivePollingState,
  nextAnalyticsLivePoll
} from "@/features/analytics/analytics-live-polling";
import type { AnalyticsLiveUsage } from "@/features/analytics/analytics-live-usage-contract";

test("keeps changing live reads at two seconds", () => {
  let state = initialAnalyticsLivePollingState;
  for (let index = 0; index < 12; index += 1) {
    const next = nextAnalyticsLivePoll(state, { changed: true, status: "success" });
    expect(next.delayMs).toBe(2_000);
    state = next.state;
  }
});

test("keeps the first five successful reads at two seconds", () => {
  let state = initialAnalyticsLivePollingState;
  for (let index = 0; index < 5; index += 1) {
    const next = nextAnalyticsLivePoll(state, { changed: false, status: "success" });
    expect(next.delayMs).toBe(2_000);
    state = next.state;
  }

  const firstPostBootstrapStable = nextAnalyticsLivePoll(state, {
    changed: false,
    status: "success"
  });
  expect(firstPostBootstrapStable.delayMs).toBe(5_000);

  const secondPostBootstrapStable = nextAnalyticsLivePoll(firstPostBootstrapStable.state, {
    changed: false,
    status: "success"
  });
  expect(secondPostBootstrapStable.delayMs).toBe(10_000);
});

test("moves stable snapshots from five to ten seconds", () => {
  let state = {
    errorCount: 0,
    stableSuccessCount: 0,
    successCount: 6
  };
  const firstStable = nextAnalyticsLivePoll(state, { changed: false, status: "success" });
  expect(firstStable.delayMs).toBe(5_000);
  state = firstStable.state;

  const secondStable = nextAnalyticsLivePoll(state, { changed: false, status: "success" });
  expect(secondStable.delayMs).toBe(10_000);

  const changed = nextAnalyticsLivePoll(secondStable.state, {
    changed: true,
    status: "success"
  });
  expect(changed.delayMs).toBe(2_000);
  expect(changed.state.stableSuccessCount).toBe(0);
});

test("backs errors off without exceeding ten seconds", () => {
  let state = initialAnalyticsLivePollingState;
  const delays: number[] = [];
  for (let index = 0; index < 5; index += 1) {
    const next = nextAnalyticsLivePoll(state, { status: "error" });
    delays.push(next.delayMs);
    state = next.state;
  }
  expect(delays).toEqual([2_000, 4_000, 8_000, 10_000, 10_000]);
});

test("snapshot signatures ignore freshness-only changes", () => {
  const first = liveUsageFixture();
  const second = {
    ...first,
    dataFreshness: {
      ...first.dataFreshness,
      generatedAt: "2026-07-24T03:15:05.000Z"
    },
    to: "2026-07-24T03:15:05.000Z"
  };
  expect(analyticsLiveUsageSignature(second)).toBe(analyticsLiveUsageSignature(first));
});

function liveUsageFixture(): AnalyticsLiveUsage {
  return {
    bucketIntervalSeconds: 5,
    buckets: [],
    currentWindowSeconds: 5,
    dataFreshness: {
      generatedAt: "2026-07-24T03:15:00.000Z",
      lastLogCreatedAt: null,
      recordCount: 0,
      source: "clickhouse_project_application"
    },
    deltaWindowSeconds: 10,
    from: "2026-07-24T03:00:00.000Z",
    projectId: null,
    projects: [],
    range: "15m",
    rateLimitStartedAt: null,
    summary: {
      currentIncomingRps: 0,
      peakIncomingRps: 0,
      processedRequestCount: 0,
      rateLimitedRate: 0,
      rateLimitedRequestCount: 0,
      requestCount: 0
    },
    to: "2026-07-24T03:15:00.000Z"
  };
}
