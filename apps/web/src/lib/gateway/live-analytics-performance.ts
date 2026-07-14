import "server-only";

import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import {
  getGatewayObservabilityHeaders,
  getLiveGatewayConfig
} from "@/lib/gateway/live-gateway-config";
import { getAlignedLiveTimeRange } from "@/lib/gateway/time-series-range";

export type LiveAnalyticsRange = "15m" | "1h" | "1d" | "1w";

export type LiveAnalyticsPerformanceFilters = {
  from?: string;
  model?: string;
  projectId?: string;
  provider?: string;
  range?: LiveAnalyticsRange;
  to?: string;
};

export type AnalyticsPerformanceSummary = {
  avgLatencyMs: number | null;
  errorRate: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  throughputPerMinute: number | null;
  totalRequests: number;
};

export type AnalyticsProviderModelPerformance = {
  avgLatencyMs: number | null;
  cacheHitRate: number | null;
  costPerRequestUsd: number | null;
  errorRate: number | null;
  model: string;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  provider: string;
  requests: number;
  totalCostMicroUsd: number;
  totalCostUsd: string;
};

export type AnalyticsProviderLatency = {
  p95LatencyMs: number | null;
  provider: string;
  requests: number;
};

export type AnalyticsLatencyDistributionPoint = {
  bucket: string;
  label: string;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  requests: number;
};

export type AnalyticsSlowRequest = {
  latencyMs: number;
  model: string;
  projectId: string;
  provider: string;
  requestId: string;
  status: string;
  statusCode: number;
  timestamp: string;
};

export type LiveAnalyticsPerformance = {
  bucketInterval?: string;
  dataFreshness: {
    generatedAt: string;
    lastLogCreatedAt: string | null;
    recordCount: number;
    source: string;
  };
  expectedBucketCount?: number;
  filters: {
    model: string | null;
    projectId: string | null;
    provider: string | null;
    tenantId: string;
  };
  latencyDistribution: AnalyticsLatencyDistributionPoint[];
  p95LatencyByProvider: AnalyticsProviderLatency[];
  providerModelPerformance: AnalyticsProviderModelPerformance[];
  range: {
    from: string;
    to: string;
  };
  slowestRequests: AnalyticsSlowRequest[];
  summary: AnalyticsPerformanceSummary;
};

type GatewayAnalyticsPerformanceResponse = {
  data?: Partial<LiveAnalyticsPerformance>;
};

export async function getLiveAnalyticsPerformance(
  tenantId: string,
  filters: LiveAnalyticsPerformanceFilters = {}
): Promise<LiveAnalyticsPerformance | undefined> {
  const config = getLiveGatewayConfig();
  const liveRange =
    filters.from && filters.to
      ? { from: filters.from, to: filters.to }
      : getAnalyticsPerformanceRange(filters.range);
  const query = new URLSearchParams({
    from: liveRange.from,
    tenantId: toGatewayTenantId(tenantId),
    to: liveRange.to
  });

  appendOptionalQuery(query, "projectId", filters.projectId);
  appendOptionalQuery(query, "provider", filters.provider);
  appendOptionalQuery(query, "model", filters.model);

  const response = await fetch(`${config.baseUrl}/api/analytics/performance?${query.toString()}`, {
    headers: getGatewayObservabilityHeaders(`request_web_analytics_${Date.now()}`),
    cache: "no-store"
  }).catch(() => undefined);

  if (!response?.ok) {
    return undefined;
  }

  const payload = (await response.json().catch(() => ({}))) as GatewayAnalyticsPerformanceResponse;
  if (!payload.data?.summary) {
    return undefined;
  }

  return normalizeAnalyticsPerformance(payload.data, tenantId, liveRange);
}

export function getAnalyticsPerformanceRange(range: LiveAnalyticsRange = "1w") {
  return getAlignedLiveTimeRange(range);
}

function normalizeAnalyticsPerformance(
  data: Partial<LiveAnalyticsPerformance>,
  routeTenantId: string,
  fallbackRange: { from: string; to: string }
): LiveAnalyticsPerformance {
  return {
    bucketInterval: typeof data.bucketInterval === "string" ? data.bucketInterval : undefined,
    dataFreshness: {
      generatedAt: data.dataFreshness?.generatedAt ?? new Date().toISOString(),
      lastLogCreatedAt: data.dataFreshness?.lastLogCreatedAt ?? null,
      recordCount: data.dataFreshness?.recordCount ?? data.summary?.totalRequests ?? 0,
      source: data.dataFreshness?.source ?? "gateway"
    },
    expectedBucketCount: normalizePositiveInteger(data.expectedBucketCount),
    filters: {
      model: data.filters?.model ?? null,
      projectId: data.filters?.projectId ?? null,
      provider: data.filters?.provider ?? null,
      tenantId: routeTenantId
    },
    latencyDistribution: (data.latencyDistribution ?? []).map((point) => ({
      bucket: point.bucket,
      label: point.label,
      p50LatencyMs: normalizeNullableNumber(point.p50LatencyMs),
      p95LatencyMs: normalizeNullableNumber(point.p95LatencyMs),
      p99LatencyMs: normalizeNullableNumber(point.p99LatencyMs),
      requests: normalizeNumber(point.requests)
    })),
    p95LatencyByProvider: (data.p95LatencyByProvider ?? []).map((row) => ({
      p95LatencyMs: normalizeNullableNumber(row.p95LatencyMs),
      provider: row.provider,
      requests: normalizeNumber(row.requests)
    })),
    providerModelPerformance: (data.providerModelPerformance ?? []).map((row) => ({
      avgLatencyMs: normalizeNullableNumber(row.avgLatencyMs),
      cacheHitRate: normalizeNullableNumber(row.cacheHitRate),
      costPerRequestUsd: normalizeNullableNumber(row.costPerRequestUsd),
      errorRate: normalizeNullableNumber(row.errorRate),
      model: row.model,
      p95LatencyMs: normalizeNullableNumber(row.p95LatencyMs),
      p99LatencyMs: normalizeNullableNumber(row.p99LatencyMs),
      provider: row.provider,
      requests: normalizeNumber(row.requests),
      totalCostMicroUsd: normalizeNumber(row.totalCostMicroUsd),
      totalCostUsd: row.totalCostUsd || formatMicroUsd(row.totalCostMicroUsd)
    })),
    range: {
      from: data.range?.from ?? fallbackRange.from,
      to: data.range?.to ?? fallbackRange.to
    },
    slowestRequests: (data.slowestRequests ?? []).map((row) => ({
      latencyMs: normalizeNumber(row.latencyMs),
      model: row.model,
      projectId: row.projectId,
      provider: row.provider,
      requestId: row.requestId,
      status: row.status,
      statusCode: normalizeNumber(row.statusCode),
      timestamp: row.timestamp
    })),
    summary: {
      avgLatencyMs: normalizeNullableNumber(data.summary?.avgLatencyMs),
      errorRate: normalizeNullableNumber(data.summary?.errorRate),
      p95LatencyMs: normalizeNullableNumber(data.summary?.p95LatencyMs),
      p99LatencyMs: normalizeNullableNumber(data.summary?.p99LatencyMs),
      throughputPerMinute: normalizeNullableNumber(data.summary?.throughputPerMinute),
      totalRequests: normalizeNumber(data.summary?.totalRequests)
    }
  };
}

function appendOptionalQuery(query: URLSearchParams, key: string, value: string | undefined) {
  const normalized = value?.trim();
  if (normalized) {
    query.set(key, normalized);
  }
}

function formatMicroUsd(value: number | null | undefined) {
  return ((value ?? 0) / 1_000_000).toFixed(6);
}

function normalizeNullableNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizePositiveInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}

function toGatewayTenantId(tenantId: string) {
  return isUuid(tenantId) ? tenantId : getControlPlaneTenantId();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
