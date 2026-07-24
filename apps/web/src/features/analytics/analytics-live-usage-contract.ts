import type { LiveAnalyticsRange } from "@/lib/gateway/live-analytics-performance";

export type AnalyticsLiveUsageTrend = "down" | "stable" | "up";

export type AnalyticsLiveUsageSummary = {
  currentIncomingRps: number;
  peakIncomingRps: number;
  processedRequestCount: number;
  rateLimitedRate: number;
  rateLimitedRequestCount: number;
  requestCount: number;
};

export type AnalyticsLiveUsageBucket = {
  incomingRps: number;
  periodEnd: string;
  periodStart: string;
  processedRequestCount: number;
  processedRps: number;
  rateLimitedRequestCount: number;
  rateLimitedRps: number;
  requestCount: number;
};

export type AnalyticsLiveUsageProject = {
  currentIncomingRps: number;
  deltaPercent: number | null;
  processedRequestCount: number;
  projectId: string;
  rateLimitedRate: number;
  rateLimitedRequestCount: number;
  requestCount: number;
  trend: AnalyticsLiveUsageTrend;
};

export type AnalyticsLiveUsage = {
  bucketIntervalSeconds: number;
  buckets: AnalyticsLiveUsageBucket[];
  currentWindowSeconds: number;
  dataFreshness: {
    generatedAt: string;
    lastLogCreatedAt: string | null;
    recordCount: number;
    source: string;
  };
  deltaWindowSeconds: number;
  from: string;
  projectId: string | null;
  projects: AnalyticsLiveUsageProject[];
  range: LiveAnalyticsRange;
  rateLimitStartedAt: string | null;
  summary: AnalyticsLiveUsageSummary;
  to: string;
};

export function parseAnalyticsLiveUsage(value: unknown): AnalyticsLiveUsage | undefined {
  const data = asRecord(value);
  const summary = asRecord(data?.summary);
  const freshness = asRecord(data?.dataFreshness);
  const range = normalizeRange(data?.range);
  const from = normalizeDate(data?.from);
  const to = normalizeDate(data?.to);

  if (!data || !summary || !freshness || !range || !from || !to) {
    return undefined;
  }

  const buckets = Array.isArray(data.buckets)
    ? data.buckets.slice(0, 2017).map(normalizeBucket).filter(isDefined)
    : [];
  const projects = Array.isArray(data.projects)
    ? data.projects.slice(0, 10).map(normalizeProject).filter(isDefined)
    : [];

  return {
    bucketIntervalSeconds: positiveInteger(data.bucketIntervalSeconds, 5),
    buckets,
    currentWindowSeconds: positiveInteger(data.currentWindowSeconds, 5),
    dataFreshness: {
      generatedAt: normalizeDate(freshness.generatedAt) ?? to,
      lastLogCreatedAt: normalizeNullableDate(freshness.lastLogCreatedAt),
      recordCount: nonNegativeNumber(freshness.recordCount),
      source: normalizeText(freshness.source) ?? "gateway"
    },
    deltaWindowSeconds: positiveInteger(data.deltaWindowSeconds, 10),
    from,
    projectId: normalizeText(data.projectId),
    projects,
    range,
    rateLimitStartedAt: normalizeNullableDate(data.rateLimitStartedAt),
    summary: {
      currentIncomingRps: nonNegativeNumber(summary.currentIncomingRps),
      peakIncomingRps: nonNegativeNumber(summary.peakIncomingRps),
      processedRequestCount: nonNegativeNumber(summary.processedRequestCount),
      rateLimitedRate: boundedRatio(summary.rateLimitedRate),
      rateLimitedRequestCount: nonNegativeNumber(summary.rateLimitedRequestCount),
      requestCount: nonNegativeNumber(summary.requestCount)
    },
    to
  };
}

function normalizeBucket(value: unknown): AnalyticsLiveUsageBucket | undefined {
  const item = asRecord(value);
  const periodStart = normalizeDate(item?.periodStart);
  const periodEnd = normalizeDate(item?.periodEnd);
  if (!item || !periodStart || !periodEnd) {
    return undefined;
  }
  return {
    incomingRps: nonNegativeNumber(item.incomingRps),
    periodEnd,
    periodStart,
    processedRequestCount: nonNegativeNumber(item.processedRequestCount),
    processedRps: nonNegativeNumber(item.processedRps),
    rateLimitedRequestCount: nonNegativeNumber(item.rateLimitedRequestCount),
    rateLimitedRps: nonNegativeNumber(item.rateLimitedRps),
    requestCount: nonNegativeNumber(item.requestCount)
  };
}

function normalizeProject(value: unknown): AnalyticsLiveUsageProject | undefined {
  const item = asRecord(value);
  const projectId = normalizeText(item?.projectId);
  if (!item || !projectId) {
    return undefined;
  }
  return {
    currentIncomingRps: nonNegativeNumber(item.currentIncomingRps),
    deltaPercent: nullableFiniteNumber(item.deltaPercent),
    processedRequestCount: nonNegativeNumber(item.processedRequestCount),
    projectId,
    rateLimitedRate: boundedRatio(item.rateLimitedRate),
    rateLimitedRequestCount: nonNegativeNumber(item.rateLimitedRequestCount),
    requestCount: nonNegativeNumber(item.requestCount),
    trend: normalizeTrend(item.trend)
  };
}

function normalizeRange(value: unknown): LiveAnalyticsRange | undefined {
  return value === "15m" || value === "1h" || value === "1d" || value === "1w"
    ? value
    : undefined;
}

function normalizeTrend(value: unknown): AnalyticsLiveUsageTrend {
  return value === "up" || value === "down" ? value : "stable";
}

function boundedRatio(value: unknown) {
  return Math.min(1, Math.max(0, nonNegativeNumber(value)));
}

function positiveInteger(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : 0;
}

function nullableFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeDate(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    return undefined;
  }
  return new Date(value).toISOString();
}

function normalizeNullableDate(value: unknown) {
  return value === null || value === undefined ? null : normalizeDate(value) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}
