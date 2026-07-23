import { expect, test } from "@playwright/test";
import type { AnalyticsLiveUsageBucket } from "@/features/analytics/analytics-live-usage-contract";
import {
  analyticsLiveChartStartIndex,
  latestAnalyticsRateLimitStartIndex
} from "@/features/analytics/analytics-live-chart-window";

test("최근 활동이 짧으면 최소 5분의 요청 추이를 표시한다", () => {
  const buckets = makeBuckets({ count: 181, intervalSeconds: 5, activityStartIndex: 157 });

  expect(analyticsLiveChartStartIndex(buckets)).toBe(121);
});

test("오래 이어진 활동은 시작 지점 앞의 여유 구간부터 표시한다", () => {
  const buckets = makeBuckets({ count: 181, intervalSeconds: 5, activityStartIndex: 60 });

  expect(analyticsLiveChartStartIndex(buckets)).toBe(58);
});

test("활동이 없으면 선택 기간 전체를 유지한다", () => {
  const buckets = makeBuckets({ count: 181, intervalSeconds: 5 });

  expect(analyticsLiveChartStartIndex(buckets)).toBe(0);
});

test("긴 bucket 간격에서는 최소 12개 bucket을 표시한다", () => {
  const buckets = makeBuckets({ count: 337, intervalSeconds: 1_800, activityStartIndex: 335 });

  expect(analyticsLiveChartStartIndex(buckets)).toBe(325);
});

test("가장 최근에 다시 시작된 요청 제한 구간을 표시한다", () => {
  const buckets = withRateLimits(
    makeBuckets({ count: 10, intervalSeconds: 5 }),
    [2, 3, 7, 8]
  );

  expect(latestAnalyticsRateLimitStartIndex(buckets, null)).toBe(7);
});

test("요청 제한이 연속되는 동안 시작 위치를 유지한다", () => {
  const buckets = makeBuckets({ count: 10, intervalSeconds: 5 });
  const firstSnapshot = withRateLimits(buckets, [5, 6, 7]);
  const nextSnapshot = withRateLimits(buckets, [5, 6, 7, 8]);

  expect(latestAnalyticsRateLimitStartIndex(firstSnapshot, null)).toBe(5);
  expect(latestAnalyticsRateLimitStartIndex(nextSnapshot, null)).toBe(5);
});

test("bucket에 제한 증거가 없으면 API의 안전한 시작점을 사용한다", () => {
  const buckets = makeBuckets({ count: 10, intervalSeconds: 5 });

  expect(
    latestAnalyticsRateLimitStartIndex(buckets, buckets[4].periodStart)
  ).toBe(4);
});

function makeBuckets({
  activityStartIndex,
  count,
  intervalSeconds
}: {
  activityStartIndex?: number;
  count: number;
  intervalSeconds: number;
}): AnalyticsLiveUsageBucket[] {
  const startAt = Date.parse("2026-07-23T12:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const hasActivity = activityStartIndex !== undefined && index >= activityStartIndex;
    const periodStart = new Date(startAt + index * intervalSeconds * 1000).toISOString();
    const periodEnd = new Date(startAt + (index + 1) * intervalSeconds * 1000).toISOString();
    return {
      incomingRps: hasActivity ? 8 : 0,
      periodEnd,
      periodStart,
      processedRequestCount: hasActivity ? 30 : 0,
      processedRps: hasActivity ? 6 : 0,
      rateLimitedRequestCount: hasActivity ? 10 : 0,
      rateLimitedRps: hasActivity ? 2 : 0,
      requestCount: hasActivity ? 40 : 0
    };
  });
}

function withRateLimits(
  buckets: AnalyticsLiveUsageBucket[],
  limitedIndexes: number[]
) {
  const limited = new Set(limitedIndexes);
  return buckets.map((bucket, index) => limited.has(index)
    ? {
        ...bucket,
        incomingRps: 8,
        rateLimitedRequestCount: 10,
        rateLimitedRps: 2,
        requestCount: 40
      }
    : bucket);
}
