import "server-only";

import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import {
  getGatewayObservabilityHeaders,
  getLiveGatewayConfig
} from "@/lib/gateway/live-gateway-config";
import { getAlignedLiveTimeRange } from "@/lib/gateway/time-series-range";

export type LiveAnalyticsRange = "15m" | "1h" | "1d" | "1w";
export type AnalyticsSurface = "project_application" | "tenant_chat";

export type LiveAnalyticsPerformanceFilters = {
  from?: string;
  includeTenantChat?: boolean;
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
  systemErrorRequests: number;
  totalRequests: number;
};

export type AnalyticsSurfaceSummary = AnalyticsPerformanceSummary & {
  lastEventAt: string | null;
  surface: AnalyticsSurface;
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
  surface: AnalyticsSurface;
  totalCostMicroUsd: number;
  totalCostUsd: string;
};

export type AnalyticsProviderLatency = {
  p95LatencyMs: number | null;
  provider: string;
  requests: number;
  surface: AnalyticsSurface;
};

export type AnalyticsLatencyDistributionPoint = {
  bucket: string;
  label: string;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  p99LatencyMs: number | null;
  requests: number;
  surface: AnalyticsSurface;
};

export type AnalyticsSlowRequest = {
  latencyMs: number;
  model: string;
  projectId: string | null;
  provider: string;
  requestId: string;
  status: string;
  statusCode: number | null;
  surface: AnalyticsSurface;
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
    includeTenantChat: boolean;
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
  surfaceSummaries: AnalyticsSurfaceSummary[];
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
  if (filters.includeTenantChat) {
    query.set("includeTenantChat", "true");
  }

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
  const summary = normalizeAnalyticsPerformanceSummary(data.summary);
  const surfaceSummaries = data.surfaceSummaries?.length
    ? data.surfaceSummaries.map((item) => ({
        ...normalizeAnalyticsPerformanceSummary(item),
        lastEventAt: item.lastEventAt ?? null,
        surface: normalizeSurface(item.surface)
      }))
    : [{
        ...summary,
        lastEventAt: data.dataFreshness?.lastLogCreatedAt ?? null,
        surface: "project_application" as const
      }];
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
      includeTenantChat: data.filters?.includeTenantChat === true,
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
      requests: normalizeNumber(point.requests),
      surface: normalizeSurface(point.surface)
    })),
    p95LatencyByProvider: (data.p95LatencyByProvider ?? []).map((row) => ({
      p95LatencyMs: normalizeNullableNumber(row.p95LatencyMs),
      provider: row.provider,
      requests: normalizeNumber(row.requests),
      surface: normalizeSurface(row.surface)
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
      surface: normalizeSurface(row.surface),
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
      projectId: row.projectId ?? null,
      provider: row.provider,
      requestId: row.requestId,
      status: row.status,
      statusCode: normalizeNullableNumber(row.statusCode),
      surface: normalizeSurface(row.surface),
      timestamp: row.timestamp
    })),
    summary,
    surfaceSummaries
  };
}

function normalizeAnalyticsPerformanceSummary(
  summary: Partial<AnalyticsPerformanceSummary> | undefined
): AnalyticsPerformanceSummary {
  return {
    avgLatencyMs: normalizeNullableNumber(summary?.avgLatencyMs),
    errorRate: normalizeNullableNumber(summary?.errorRate),
    p95LatencyMs: normalizeNullableNumber(summary?.p95LatencyMs),
    p99LatencyMs: normalizeNullableNumber(summary?.p99LatencyMs),
    systemErrorRequests: normalizeNumber(summary?.systemErrorRequests),
    throughputPerMinute: normalizeNullableNumber(summary?.throughputPerMinute),
    totalRequests: normalizeNumber(summary?.totalRequests)
  };
}

function normalizeSurface(value: string | undefined): AnalyticsSurface {
  return value === "tenant_chat" ? "tenant_chat" : "project_application";
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
