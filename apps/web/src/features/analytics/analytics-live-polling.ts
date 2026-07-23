import type { AnalyticsLiveUsage } from "@/features/analytics/analytics-live-usage-contract";

export type AnalyticsLivePollingState = {
  errorCount: number;
  stableSuccessCount: number;
  successCount: number;
};

export const initialAnalyticsLivePollingState: AnalyticsLivePollingState = {
  errorCount: 0,
  stableSuccessCount: 0,
  successCount: 0
};

export function nextAnalyticsLivePoll(
  state: AnalyticsLivePollingState,
  outcome: { changed?: boolean; status: "error" | "success" }
) {
  if (outcome.status === "error") {
    const errorCount = state.errorCount + 1;
    return {
      delayMs: Math.min(10_000, 2_000 * 2 ** Math.min(3, errorCount - 1)),
      state: {
        ...state,
        errorCount
      }
    };
  }

  const successCount = state.successCount + 1;
  const stableSuccessCount = outcome.changed ? 0 : state.stableSuccessCount + 1;
  const delayMs = successCount <= 5
    ? 2_000
    : outcome.changed || stableSuccessCount < 2
      ? 5_000
      : 10_000;

  return {
    delayMs,
    state: {
      errorCount: 0,
      stableSuccessCount,
      successCount
    }
  };
}

export function analyticsLiveUsageSignature(snapshot: AnalyticsLiveUsage) {
  return JSON.stringify({
    buckets: snapshot.buckets.map((bucket) => [
      bucket.periodStart,
      bucket.requestCount,
      bucket.processedRequestCount,
      bucket.rateLimitedRequestCount
    ]),
    projects: snapshot.projects.map((project) => [
      project.projectId,
      project.requestCount,
      project.processedRequestCount,
      project.rateLimitedRequestCount,
      project.currentIncomingRps
    ]),
    summary: snapshot.summary
  });
}
