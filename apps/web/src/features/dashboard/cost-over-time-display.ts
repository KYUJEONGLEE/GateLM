import type {
  CostOverTimePoint,
  CostOverTimeSummary
} from "@/lib/gateway/cost-over-time-types";

export type CostOverTimeRange = "5m" | "15m" | "1h" | "1d" | "1w";

type CostDisplayBucket = {
  expectedBucketCount: number;
  interval: "15s" | "1m" | "5m" | "1h" | "1d";
  intervalMs: number;
};

const costDisplayBuckets: Record<CostOverTimeRange, CostDisplayBucket> = {
  "5m": {
    expectedBucketCount: 20,
    interval: "15s",
    intervalMs: 15 * 1000
  },
  "15m": {
    expectedBucketCount: 15,
    interval: "1m",
    intervalMs: 60 * 1000
  },
  "1h": {
    expectedBucketCount: 12,
    interval: "5m",
    intervalMs: 5 * 60 * 1000
  },
  "1d": {
    expectedBucketCount: 24,
    interval: "1h",
    intervalMs: 60 * 60 * 1000
  },
  "1w": {
    expectedBucketCount: 7,
    interval: "1d",
    intervalMs: 24 * 60 * 60 * 1000
  }
};

const sourceIntervalMs: Record<string, number> = {
  "1s": 1000,
  "5s": 5 * 1000,
  "7s": 7 * 1000,
  "15s": 15 * 1000,
  "1m": 60 * 1000,
  "5m": 5 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000
};

export function getCostDisplayBucket(range: CostOverTimeRange) {
  return costDisplayBuckets[range];
}

export function resampleCostOverTimeForDisplay(
  summary: CostOverTimeSummary,
  range: CostOverTimeRange
): CostOverTimeSummary {
  const displayBucket = getCostDisplayBucket(range);
  const rawIntervalMs = summary.bucketInterval
    ? sourceIntervalMs[summary.bucketInterval]
    : undefined;

  if (rawIntervalMs && rawIntervalMs > displayBucket.intervalMs) {
    return summary;
  }

  const parsedPoints = summary.points.map((point) => ({
    point,
    timestamp: Date.parse(point.bucket)
  }));

  if (parsedPoints.some(({ timestamp }) => !Number.isFinite(timestamp))) {
    return summary;
  }

  const pointsByBucket = new Map<number, CostOverTimePoint>();
  for (const { point, timestamp } of parsedPoints) {
    const bucketStart = Math.floor(timestamp / displayBucket.intervalMs) * displayBucket.intervalMs;
    const existing = pointsByBucket.get(bucketStart);

    pointsByBucket.set(bucketStart, {
      bucket: new Date(bucketStart).toISOString(),
      label: existing?.label ?? formatDisplayBucketLabel(bucketStart, displayBucket.interval),
      spendUsd: (existing?.spendUsd ?? 0) + point.spendUsd
    });
  }

  const points = [...pointsByBucket.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, point]) => point);
  const totalSpendUsd = points.reduce((sum, point) => sum + point.spendUsd, 0);
  const averageBucketCount = Math.min(
    points.length,
    displayBucket.expectedBucketCount
  );

  return {
    ...summary,
    averageSpendUsd: averageBucketCount > 0
      ? totalSpendUsd / averageBucketCount
      : 0,
    bucketInterval: displayBucket.interval,
    expectedBucketCount: displayBucket.expectedBucketCount,
    points
  };
}

function formatDisplayBucketLabel(
  timestamp: number,
  interval: CostDisplayBucket["interval"]
) {
  const date = new Date(timestamp);

  if (interval === "1d") {
    return new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone: "Asia/Seoul"
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    second: interval === "15s" ? "2-digit" : undefined,
    timeZone: "Asia/Seoul"
  }).format(date);
}
