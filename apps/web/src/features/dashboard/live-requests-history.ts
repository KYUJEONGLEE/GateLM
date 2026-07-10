import type { LiveRequestRow } from "@/lib/gateway/live-requests-types";

export const LIVE_REQUESTS_HISTORY_LIMIT = 50;

const rangeDurationsMs: Record<string, number> = {
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000
};

type MergeLiveRequestHistoryOptions = {
  limit?: number;
  minimumTimestampMs?: number | null;
};

export function mergeLiveRequestHistory(
  currentRows: LiveRequestRow[],
  incomingRows: LiveRequestRow[],
  options: MergeLiveRequestHistoryOptions = {}
) {
  const limit = options.limit ?? LIVE_REQUESTS_HISTORY_LIMIT;
  const minimumTimestampMs = options.minimumTimestampMs ?? null;
  const rowsByRequestId = new Map<string, LiveRequestRow>();

  incomingRows.forEach((row) => rowsByRequestId.set(row.requestId, row));
  currentRows.forEach((row) => {
    if (!rowsByRequestId.has(row.requestId)) {
      rowsByRequestId.set(row.requestId, row);
    }
  });

  return Array.from(rowsByRequestId.values())
    .filter(
      (row) =>
        minimumTimestampMs === null ||
        timestampValue(row.timestamp) >= minimumTimestampMs
    )
    .sort((first, second) => timestampValue(second.timestamp) - timestampValue(first.timestamp))
    .slice(0, Math.max(0, limit));
}

export function liveRequestHistoryCutoff(range: string, nowMs = Date.now()) {
  const durationMs = rangeDurationsMs[range];
  return durationMs ? nowMs - durationMs : null;
}

export function countPendingLiveRequests(
  snapshotRows: LiveRequestRow[],
  currentRows: LiveRequestRow[]
) {
  const snapshotIds = new Set(snapshotRows.map((row) => row.requestId));
  return currentRows.reduce(
    (count, row) => count + (snapshotIds.has(row.requestId) ? 0 : 1),
    0
  );
}

function timestampValue(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}
