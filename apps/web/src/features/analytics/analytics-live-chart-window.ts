import type { AnalyticsLiveUsageBucket } from "@/features/analytics/analytics-live-usage-contract";

const minimumVisibleDurationMs = 5 * 60 * 1000;
const minimumVisibleBucketCount = 12;
const activityPaddingBucketCount = 2;

export function analyticsLiveChartStartIndex(buckets: AnalyticsLiveUsageBucket[]) {
  if (buckets.length < 2) {
    return 0;
  }

  const firstActivityIndex = buckets.findIndex(hasActivity);
  if (firstActivityIndex < 0) {
    return 0;
  }

  const intervalMs = findBucketIntervalMs(buckets);
  if (intervalMs === undefined) {
    return 0;
  }

  const firstActivityAt = Date.parse(buckets[firstActivityIndex].periodStart);
  const latestBucketEnd = Date.parse(buckets.at(-1)?.periodEnd ?? "");
  if (!Number.isFinite(firstActivityAt) || !Number.isFinite(latestBucketEnd)) {
    return 0;
  }

  const visibleDurationMs = Math.max(
    minimumVisibleDurationMs,
    intervalMs * minimumVisibleBucketCount
  );
  const activityStartWithPadding = firstActivityAt - intervalMs * activityPaddingBucketCount;
  const targetStartAt = Math.min(
    activityStartWithPadding,
    latestBucketEnd - visibleDurationMs
  );
  const startIndex = buckets.findIndex(
    (bucket) => Date.parse(bucket.periodStart) >= targetStartAt
  );

  return Math.max(0, startIndex);
}

export function latestAnalyticsRateLimitStartIndex(
  buckets: AnalyticsLiveUsageBucket[],
  fallbackStartedAt: string | null
) {
  for (let index = buckets.length - 1; index >= 0; index -= 1) {
    if (!hasRateLimit(buckets[index])) {
      continue;
    }
    if (index === 0 || !hasRateLimit(buckets[index - 1])) {
      return index;
    }
  }

  return fallbackStartedAt
    ? buckets.findIndex((bucket) => bucket.periodStart === fallbackStartedAt)
    : -1;
}

function hasActivity(bucket: AnalyticsLiveUsageBucket) {
  return (
    bucket.requestCount > 0 ||
    bucket.incomingRps > 0 ||
    bucket.processedRps > 0 ||
    bucket.rateLimitedRps > 0
  );
}

function hasRateLimit(bucket: AnalyticsLiveUsageBucket) {
  return bucket.rateLimitedRequestCount > 0 || bucket.rateLimitedRps > 0;
}

function findBucketIntervalMs(buckets: AnalyticsLiveUsageBucket[]) {
  for (let index = 1; index < buckets.length; index += 1) {
    const previous = Date.parse(buckets[index - 1].periodStart);
    const current = Date.parse(buckets[index].periodStart);
    const interval = current - previous;
    if (Number.isFinite(interval) && interval > 0) {
      return interval;
    }
  }
  return undefined;
}
