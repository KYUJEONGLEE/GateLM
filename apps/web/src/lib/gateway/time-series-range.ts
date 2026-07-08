export type LiveTimeSeriesRange = "5m" | "15m" | "1h" | "1d" | "1w";

const rangeMs: Record<LiveTimeSeriesRange, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000
};

const bucketMs: Record<LiveTimeSeriesRange, number> = {
  "5m": 7 * 1000,
  "15m": 60 * 1000,
  "1h": 5 * 60 * 1000,
  "1d": 60 * 60 * 1000,
  "1w": 24 * 60 * 60 * 1000
};

export function getAlignedLiveTimeRange(range: LiveTimeSeriesRange = "15m") {
  const to = ceilToInterval(new Date(), bucketMs[range]);
  const from = new Date(to.getTime() - liveRangeToMs(range));

  return {
    from: from.toISOString(),
    to: to.toISOString()
  };
}

export function liveRangeToMs(range: LiveTimeSeriesRange) {
  return rangeMs[range];
}

function ceilToInterval(value: Date, intervalMs: number) {
  return new Date(Math.ceil(value.getTime() / intervalMs) * intervalMs);
}
