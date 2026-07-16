import { expect, test } from "@playwright/test";

import {
  getCostDisplayBucket,
  resampleCostOverTimeForDisplay,
  type CostOverTimeRange
} from "@/features/dashboard/cost-over-time-display";
import type { CostOverTimeSummary } from "@/lib/gateway/cost-over-time-types";

test("uses a readable display interval for every dashboard range", () => {
  const expected: Record<CostOverTimeRange, ReturnType<typeof getCostDisplayBucket>> = {
    "5m": { expectedBucketCount: 20, interval: "15s", intervalMs: 15_000 },
    "15m": { expectedBucketCount: 15, interval: "1m", intervalMs: 60_000 },
    "1h": { expectedBucketCount: 12, interval: "5m", intervalMs: 300_000 },
    "1d": { expectedBucketCount: 24, interval: "1h", intervalMs: 3_600_000 },
    "1w": { expectedBucketCount: 7, interval: "1d", intervalMs: 86_400_000 }
  };

  for (const [range, bucket] of Object.entries(expected)) {
    expect(getCostDisplayBucket(range as CostOverTimeRange)).toEqual(bucket);
  }
});

test("groups 300 one-second costs into 20 fifteen-second bars without changing the total", () => {
  const summary = costSummary(
    Array.from({ length: 300 }, (_, index) => ({
      bucket: new Date(Date.parse("2026-07-16T00:00:00.000Z") + index * 1000).toISOString(),
      label: `raw-${index}`,
      spendUsd: 0.001
    })),
    "1s"
  );

  const displayed = resampleCostOverTimeForDisplay(summary, "5m");

  expect(displayed.bucketInterval).toBe("15s");
  expect(displayed.expectedBucketCount).toBe(20);
  expect(displayed.points).toHaveLength(20);
  expect(displayed.points[0]?.spendUsd).toBeCloseTo(0.015, 12);
  expect(displayed.averageSpendUsd).toBeCloseTo(0.015, 12);
  expect(total(displayed)).toBeCloseTo(total(summary), 12);
});

test("keeps a stable five-minute average when range edges create partial bars", () => {
  const summary = costSummary(
    Array.from({ length: 300 }, (_, index) => ({
      bucket: new Date(Date.parse("2026-07-16T00:00:03.000Z") + index * 1000).toISOString(),
      label: `raw-${index}`,
      spendUsd: 0.001
    })),
    "1s"
  );

  const displayed = resampleCostOverTimeForDisplay(summary, "5m");

  expect(displayed.points).toHaveLength(21);
  expect(displayed.averageSpendUsd).toBeCloseTo(0.015, 12);
  expect(total(displayed)).toBeCloseTo(total(summary), 12);
});

test("preserves all cost when the shared seven-second range alignment crosses fifteen-second edges", () => {
  const summary = costSummary(
    Array.from({ length: 43 }, (_, index) => ({
      bucket: new Date(Date.parse("2026-07-16T00:00:07.000Z") + index * 7_000).toISOString(),
      label: `raw-${index}`,
      spendUsd: 0.001
    })),
    "7s"
  );

  const displayed = resampleCostOverTimeForDisplay(summary, "5m");

  expect(displayed.bucketInterval).toBe("15s");
  expect(displayed.expectedBucketCount).toBe(20);
  expect(displayed.points).toHaveLength(21);
  expect(displayed.averageSpendUsd).toBeCloseTo(total(summary) / 20, 12);
  expect(total(displayed)).toBeCloseTo(total(summary), 12);
});

test("keeps updating the same fifteen-second bar until the next boundary", () => {
  const firstSnapshot = resampleCostOverTimeForDisplay(
    costSummary([
      point("2026-07-16T00:00:00.000Z", 0.001),
      point("2026-07-16T00:00:01.000Z", 0.002)
    ]),
    "5m"
  );
  const nextSecond = resampleCostOverTimeForDisplay(
    costSummary([
      point("2026-07-16T00:00:00.000Z", 0.001),
      point("2026-07-16T00:00:01.000Z", 0.002),
      point("2026-07-16T00:00:02.000Z", 0.003)
    ]),
    "5m"
  );
  const nextBoundary = resampleCostOverTimeForDisplay(
    costSummary([
      point("2026-07-16T00:00:00.000Z", 0.001),
      point("2026-07-16T00:00:01.000Z", 0.002),
      point("2026-07-16T00:00:02.000Z", 0.003),
      point("2026-07-16T00:00:15.000Z", 0.004)
    ]),
    "5m"
  );

  expect(firstSnapshot.points).toHaveLength(1);
  expect(nextSecond.points).toHaveLength(1);
  expect(nextSecond.points[0]?.bucket).toBe(firstSnapshot.points[0]?.bucket);
  expect(nextSecond.points[0]?.spendUsd).toBeCloseTo(0.006, 12);
  expect(nextBoundary.points).toHaveLength(2);
  expect(nextBoundary.points[1]?.bucket).toBe("2026-07-16T00:00:15.000Z");
});

test("keeps existing range buckets unchanged in count and total", () => {
  const cases: Array<{
    bucketInterval: string;
    count: number;
    range: Exclude<CostOverTimeRange, "5m">;
    stepMs: number;
  }> = [
    { bucketInterval: "1m", count: 15, range: "15m", stepMs: 60_000 },
    { bucketInterval: "5m", count: 12, range: "1h", stepMs: 300_000 },
    { bucketInterval: "1h", count: 24, range: "1d", stepMs: 3_600_000 },
    { bucketInterval: "1d", count: 7, range: "1w", stepMs: 86_400_000 }
  ];

  for (const { bucketInterval, count, range, stepMs } of cases) {
    const summary = costSummary(
      Array.from({ length: count }, (_, index) =>
        point(
          new Date(Date.parse("2026-07-15T00:00:00.000Z") + index * stepMs).toISOString(),
          index + 1
        )
      ),
      bucketInterval
    );
    const displayed = resampleCostOverTimeForDisplay(summary, range);

    expect(displayed.bucketInterval).toBe(bucketInterval);
    expect(displayed.points).toHaveLength(count);
    expect(total(displayed)).toBe(total(summary));
  }
});

test("does not invent finer bars or discard costs when source timestamps are unsafe", () => {
  const coarser = costSummary([point("2026-07-16T00:00:00.000Z", 1)], "1m");
  const invalid = costSummary([{ bucket: "not-a-date", label: "unknown", spendUsd: 2 }]);

  expect(resampleCostOverTimeForDisplay(coarser, "5m")).toBe(coarser);
  expect(resampleCostOverTimeForDisplay(invalid, "5m")).toBe(invalid);
});

function costSummary(
  points: CostOverTimeSummary["points"],
  bucketInterval = "1s"
): CostOverTimeSummary {
  return {
    averageSpendUsd: points.length > 0 ? totalPoints(points) / points.length : 0,
    bucketInterval,
    generatedAt: "2026-07-16T00:05:00.000Z",
    period: "hour",
    points
  };
}

function point(bucket: string, spendUsd: number) {
  return { bucket, label: bucket, spendUsd };
}

function total(summary: CostOverTimeSummary) {
  return totalPoints(summary.points);
}

function totalPoints(points: CostOverTimeSummary["points"]) {
  return points.reduce((sum, point) => sum + point.spendUsd, 0);
}
