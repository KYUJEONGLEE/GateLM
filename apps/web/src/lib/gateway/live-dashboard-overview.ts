import "server-only";

import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";
import { getAlignedLiveTimeRange } from "@/lib/gateway/time-series-range";

type LiveDashboardOverviewResponse = {
  data?: {
    breakdowns?: {
      byApplication?: Array<{
        applicationId?: string;
        estimatedCostMicroUsd?: number;
        requestCount?: number;
      }>;
      byProject?: Array<{
        completionTokens?: number;
        costMicroUsd?: number;
        costUsd?: string;
        projectId?: string;
        promptTokens?: number;
        requestCount?: number;
        totalTokens?: number;
      }>;
      byBudgetScope?: Array<{
        budgetScopeId?: string;
        budgetScopeType?: string;
        costMicroUsd?: number;
        estimatedCostMicroUsd?: number;
        requestCount?: number;
        resolvedBy?: string;
      }>;
      byCacheOutcome?: Array<{ outcome?: string; requestCount?: number }>;
      byFallbackOutcome?: Array<{ outcome?: string; requestCount?: number }>;
      byProviderModel?: Array<{
        p95ProviderLatencyMs?: number;
        requestCount?: number;
        selectedModel?: string;
        selectedProvider?: string;
      }>;
      bySafetyOutcome?: Array<{ outcome?: string; requestCount?: number }>;
      byTerminalStatus?: Array<{ outcome?: string; requestCount?: number }>;
    };
    dataFreshness?: {
      generatedAt?: string;
      lastLogCreatedAt?: string | null;
      recordCount?: number;
      source?: string;
    };
    freshness?: {
      isStale?: boolean;
      lastAggregatedAt?: string;
      lastIngestedAt?: string;
      source?: string;
    };
    filters?: {
      budgetScopeId?: string | null;
      budgetScopeType?: string | null;
      projectId?: string | null;
      resolvedBy?: string | null;
      tenantId?: string;
    };
    range?: {
      from?: string;
      to?: string;
    };
    performance?: {
      p95GatewayInternalLatencyMs?: number | null;
      p95ProviderLatencyMs?: number | null;
      p99GatewayInternalLatencyMs?: number | null;
      p99ProviderLatencyMs?: number | null;
      systemErrorRate?: number;
    };
    queryBudget?: {
      guidance?: string | null;
      maxBreakdownItems?: number;
      maxRangeHours?: number;
      status?: "ok" | "too_broad" | "partial" | "stale" | "unavailable";
    };
    timeRange?: {
      from?: string;
      granularity?: string;
      to?: string;
    };
    totals?: {
      averageLatencyMs?: number | null;
      averageResponseTimeMs?: number | null;
      blockedRequests?: number;
      blockedCount?: number;
      cacheEligibleRequests?: number;
      cacheHitRate?: number | null;
      cacheHitRequests?: number;
      cancelledRequests?: number;
      cancelledCount?: number;
      completionTokens?: number;
      costByModel?: Array<{
        costMicroUsd?: number;
        costUsd?: string;
        requestCount?: number;
        selectedModel?: string;
        selectedProvider?: string;
        totalTokens?: number;
      }>;
      costByProject?: Array<{
        completionTokens?: number;
        costMicroUsd?: number;
        costUsd?: string;
        projectId?: string;
        promptTokens?: number;
        requestCount?: number;
        totalTokens?: number;
      }>;
      failedRequests?: number;
      failedCount?: number;
      exactCacheHitRate?: number | null;
      fallbackSuccessCount?: number;
      estimatedCostMicroUsd?: number;
      maskingActionCounts?: Record<string, number>;
      p95LatencyMs?: number | null;
      promptTokens?: number;
      rateLimitedRequests?: number;
      rateLimitedCount?: number;
      requestCount?: number;
      routingCountByModel?: Array<{
        requestCount?: number;
        routingReason?: string;
        selectedModel?: string;
        selectedProvider?: string;
      }>;
      savedCostMicroUsd?: number;
      savedCostUsd?: string;
      statusCounts?: Record<string, number>;
      successfulRequests?: number;
      successCount?: number;
      totalCostMicroUsd?: number;
      totalCostUsd?: string;
      totalRequests?: number;
      totalTokens?: number;
    };
  };
};

export type LiveDashboardRange = "15m" | "1h" | "1d" | "1w";

export type LiveDashboardOverviewFilters = {
  budgetScopeId?: string;
  budgetScopeType?: string;
  from?: string;
  projectId?: string;
  range?: LiveDashboardRange;
  resolvedBy?: string;
  to?: string;
};

export async function getLiveDashboardOverview(
  tenantId: string,
  filters: LiveDashboardOverviewFilters = {}
): Promise<DashboardOverview | undefined> {
  const config = getLiveGatewayConfig();
  const liveRange =
    filters.from && filters.to
      ? { from: filters.from, to: filters.to }
      : getDashboardLiveRange(filters.range);
  const { from, to } = liveRange;
  const gatewayTenantId = toGatewayTenantId(tenantId);
  const query = new URLSearchParams({
    from,
    tenantId: gatewayTenantId,
    to
  });
  appendOptionalQuery(query, "budgetScopeId", filters.budgetScopeId);
  appendOptionalQuery(query, "budgetScopeType", filters.budgetScopeType);
  appendOptionalQuery(query, "projectId", filters.projectId);
  appendOptionalQuery(query, "resolvedBy", filters.resolvedBy);

  const response = await fetch(`${config.baseUrl}/api/dashboard/overview?${query.toString()}`, {
    headers: {
      "X-GateLM-Request-Id": `request_web_dashboard_${Date.now()}`
    },
    cache: "no-store"
  }).catch(() => undefined);

  if (!response?.ok) {
    return undefined;
  }

  const payload = (await response.json().catch(() => ({}))) as LiveDashboardOverviewResponse;

  if (!payload.data?.totals) {
    return undefined;
  }

  return toDashboardOverview(payload.data, tenantId, from, to);
}

function appendOptionalQuery(query: URLSearchParams, key: string, value: string | undefined) {
  const normalized = value?.trim();
  if (normalized) {
    query.set(key, normalized);
  }
}

function toGatewayTenantId(tenantId: string) {
  return isUuid(tenantId) ? tenantId : getControlPlaneTenantId();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function getDashboardLiveRange(range: LiveDashboardRange = "15m") {
  return getAlignedLiveTimeRange(range);
}

function toDashboardOverview(
  data: NonNullable<LiveDashboardOverviewResponse["data"]>,
  tenantId: string,
  fallbackFrom: string,
  fallbackTo: string
): DashboardOverview {
  const totals = data.totals ?? {};
  const freshness = data.dataFreshness ?? {};
  const v2Freshness = data.freshness;
  const performance = data.performance;
  const applicationId = "live_gateway_application";
  const totalRequests = totals.totalRequests ?? totals.requestCount ?? 0;
  const successfulRequests = totals.successfulRequests ?? totals.successCount ?? 0;
  const failedRequests = totals.failedRequests ?? totals.failedCount ?? 0;
  const blockedRequests = totals.blockedRequests ?? totals.blockedCount ?? 0;
  const rateLimitedRequests = totals.rateLimitedRequests ?? totals.rateLimitedCount ?? 0;
  const cancelledRequests = totals.cancelledRequests ?? totals.cancelledCount ?? 0;
  const totalCostMicroUsd = totals.totalCostMicroUsd ?? totals.estimatedCostMicroUsd ?? 0;
  const statusCounts =
    totals.statusCounts ??
    statusCountsFromTerminalBreakdown(data.breakdowns?.byTerminalStatus);

  return {
    fixtureName: "live-dashboard-overview",
    fixtureVersion: "gateway-live",
    owner: "product-experience-demo",
    producer: "gateway-data-plane-governance",
    consumers: ["product-experience-demo"],
    sourceOfTruth: [
      "docs/v1.0.0/contracts.md",
      "GET /api/dashboard/overview"
    ],
    range: {
      from: data.timeRange?.from ?? data.range?.from ?? fallbackFrom,
      to: data.timeRange?.to ?? data.range?.to ?? fallbackTo,
      timezone: "UTC",
      grain: data.timeRange?.granularity ?? "live"
    },
    filters: {
      tenantId,
      projectId: data.filters?.projectId ?? "live_gateway_project",
      applicationId,
      budgetScopeType: data.filters?.budgetScopeType ?? "application",
      budgetScopeId: data.filters?.budgetScopeId ?? applicationId,
      resolvedBy: data.filters?.resolvedBy ?? "default_application",
      provider: null,
      model: null
    },
    totalRequests,
    successfulRequests,
    failedRequests,
    blockedRequests,
    rateLimitedRequests,
    cancelledRequests,
    cacheHitRequests: totals.cacheHitRequests ?? 0,
    cacheEligibleRequests: totals.cacheEligibleRequests ?? 0,
    cacheHitRate: totals.cacheHitRate ?? 0,
    exactCacheHitRate: totals.exactCacheHitRate ?? totals.cacheHitRate ?? 0,
    fallbackSuccessCount: totals.fallbackSuccessCount ?? 0,
    totalTokens: totals.totalTokens ?? 0,
    promptTokens: totals.promptTokens ?? 0,
    completionTokens: totals.completionTokens ?? 0,
    totalCostMicroUsd,
    totalCostUsd: totals.totalCostUsd ?? formatMicroUsd(totalCostMicroUsd),
    savedCostMicroUsd: totals.savedCostMicroUsd ?? 0,
    savedCostUsd: totals.savedCostUsd ?? formatMicroUsd(totals.savedCostMicroUsd ?? 0),
    averageLatencyMs: totals.averageLatencyMs ?? totals.averageResponseTimeMs ?? 0,
    p95LatencyMs: totals.p95LatencyMs ?? 0,
    maskingActionCounts: totals.maskingActionCounts ?? {},
    routingCountByModel: (totals.routingCountByModel ?? []).map((row) => ({
      selectedProvider: row.selectedProvider ?? "not-routed",
      selectedModel: row.selectedModel ?? "not-routed",
      routingReason: row.routingReason ?? "not-set",
      requestCount: row.requestCount ?? 0
    })),
    statusCounts,
    costByModel: (totals.costByModel ?? []).map((row) => ({
      selectedProvider: row.selectedProvider ?? "not-routed",
      selectedModel: row.selectedModel ?? "not-routed",
      requestCount: row.requestCount ?? 0,
      totalTokens: row.totalTokens ?? 0,
      costMicroUsd: row.costMicroUsd ?? 0,
      costUsd: row.costUsd ?? formatMicroUsd(row.costMicroUsd ?? 0)
    })),
    costByProject: normalizeProjectCostRows(totals.costByProject ?? data.breakdowns?.byProject),
    requestIds: [],
    dataFreshness: {
      source: v2Freshness?.source ?? freshness.source ?? "gateway-postgresql",
      recordCount: freshness.recordCount ?? 0,
      lastLogCreatedAt: v2Freshness?.lastIngestedAt ?? freshness.lastLogCreatedAt ?? freshness.generatedAt ?? fallbackTo,
      generatedAt: freshness.generatedAt ?? v2Freshness?.lastAggregatedAt ?? fallbackTo
    },
    queryBudget: {
      status: data.queryBudget?.status ?? "ok",
      maxRangeHours: data.queryBudget?.maxRangeHours ?? 24,
      maxBreakdownItems: data.queryBudget?.maxBreakdownItems ?? 50,
      guidance: data.queryBudget?.guidance ?? null
    },
    performance: {
      p95GatewayInternalLatencyMs: performance?.p95GatewayInternalLatencyMs ?? totals.p95LatencyMs ?? 0,
      p99GatewayInternalLatencyMs: performance?.p99GatewayInternalLatencyMs ?? performance?.p95GatewayInternalLatencyMs ?? totals.p95LatencyMs ?? 0,
      p95ProviderLatencyMs: performance?.p95ProviderLatencyMs ?? 0,
      p99ProviderLatencyMs: performance?.p99ProviderLatencyMs ?? performance?.p95ProviderLatencyMs ?? 0,
      systemErrorRate: performance?.systemErrorRate ?? safeRate(totals.failedRequests ?? 0, totals.totalRequests ?? 0)
    },
    breakdowns: {
      byApplication: normalizeApplicationRows(data.breakdowns?.byApplication),
      byBudgetScope: normalizeBudgetScopeRows(data.breakdowns?.byBudgetScope),
      byProviderModel: normalizeProviderModelRows(data.breakdowns?.byProviderModel),
      bySafetyOutcome: normalizeOutcomeRows(data.breakdowns?.bySafetyOutcome),
      byCacheOutcome: normalizeOutcomeRows(data.breakdowns?.byCacheOutcome),
      byFallbackOutcome: normalizeOutcomeRows(data.breakdowns?.byFallbackOutcome),
      byTerminalStatus: normalizeOutcomeRows(data.breakdowns?.byTerminalStatus)
    },
    notes: ["Live Gateway overview. Raw prompt, raw response, and credentials are not exposed."]
  };
}

function normalizeOutcomeRows(rows: Array<{ outcome?: string; requestCount?: number }> | undefined) {
  return (rows ?? []).map((row) => ({
    outcome: row.outcome ?? "unknown",
    requestCount: row.requestCount ?? 0
  }));
}

function normalizeApplicationRows(
  rows:
    | Array<{
        applicationId?: string;
        estimatedCostMicroUsd?: number;
        requestCount?: number;
      }>
    | undefined
) {
  return (rows ?? []).map((row) => ({
    applicationId: row.applicationId ?? "unknown_application",
    requestCount: row.requestCount ?? 0,
    estimatedCostMicroUsd: row.estimatedCostMicroUsd ?? 0
  }));
}

function normalizeProjectCostRows(
  rows:
    | Array<{
        completionTokens?: number;
        costMicroUsd?: number;
        costUsd?: string;
        projectId?: string;
        promptTokens?: number;
        requestCount?: number;
        totalTokens?: number;
      }>
    | undefined
) {
  return (rows ?? []).map((row) => {
    const costMicroUsd = row.costMicroUsd ?? 0;

    return {
      projectId: row.projectId ?? "unknown_project",
      requestCount: row.requestCount ?? 0,
      promptTokens: row.promptTokens ?? 0,
      completionTokens: row.completionTokens ?? 0,
      totalTokens: row.totalTokens ?? 0,
      costMicroUsd,
      costUsd: row.costUsd ?? formatMicroUsd(costMicroUsd)
    };
  });
}

function normalizeBudgetScopeRows(
  rows:
    | Array<{
        budgetScopeId?: string;
        budgetScopeType?: string;
        costMicroUsd?: number;
        estimatedCostMicroUsd?: number;
        requestCount?: number;
        resolvedBy?: string;
      }>
    | undefined
) {
  return (rows ?? []).map((row) => ({
    budgetScopeType: row.budgetScopeType ?? "application",
    budgetScopeId: row.budgetScopeId ?? "unknown_budget_scope",
    resolvedBy: row.resolvedBy ?? "default_application",
    requestCount: row.requestCount ?? 0,
    estimatedCostMicroUsd: row.estimatedCostMicroUsd ?? row.costMicroUsd ?? 0
  }));
}

function normalizeProviderModelRows(
  rows:
    | Array<{
        p95ProviderLatencyMs?: number;
        requestCount?: number;
        selectedModel?: string;
        selectedProvider?: string;
      }>
    | undefined
) {
  return (rows ?? []).map((row) => ({
    selectedProvider: row.selectedProvider ?? "not-routed",
    selectedModel: row.selectedModel ?? "not-routed",
    requestCount: row.requestCount ?? 0,
    p95ProviderLatencyMs: row.p95ProviderLatencyMs ?? 0
  }));
}

function statusCountsFromTerminalBreakdown(
  rows: Array<{ outcome?: string; requestCount?: number }> | undefined
) {
  return Object.fromEntries(
    (rows ?? []).map((row) => [row.outcome ?? "unknown", row.requestCount ?? 0])
  );
}

function safeRate(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function formatMicroUsd(value: number) {
  return (value / 1_000_000).toFixed(6);
}
