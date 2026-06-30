import "server-only";

import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";

type LiveDashboardOverviewResponse = {
  data?: {
    breakdowns?: {
      byCacheOutcome?: Array<{ outcome?: string; requestCount?: number }>;
      byFallbackOutcome?: Array<{ outcome?: string; requestCount?: number }>;
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
      cacheEligibleRequests?: number;
      cacheHitRate?: number | null;
      cacheHitRequests?: number;
      cancelledRequests?: number;
      completionTokens?: number;
      costByModel?: Array<{
        costMicroUsd?: number;
        costUsd?: string;
        requestCount?: number;
        selectedModel?: string;
        selectedProvider?: string;
        totalTokens?: number;
      }>;
      failedRequests?: number;
      exactCacheHitRate?: number | null;
      fallbackSuccessCount?: number;
      maskingActionCounts?: Record<string, number>;
      p95LatencyMs?: number | null;
      promptTokens?: number;
      rateLimitedRequests?: number;
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
      totalCostMicroUsd?: number;
      totalCostUsd?: string;
      totalRequests?: number;
      totalTokens?: number;
    };
  };
};

const LIVE_RANGE_HOURS = 24;

export async function getLiveDashboardOverview(
  tenantId: string
): Promise<DashboardOverview | undefined> {
  const config = getLiveGatewayConfig();
  const { from, to } = getLiveRange();
  const query = new URLSearchParams({
    from,
    to
  });

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

function getLiveRange() {
  const to = new Date();
  const from = new Date(to.getTime() - LIVE_RANGE_HOURS * 60 * 60 * 1000);

  return {
    from: from.toISOString(),
    to: to.toISOString()
  };
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
    totalRequests: totals.totalRequests ?? 0,
    successfulRequests: totals.successfulRequests ?? 0,
    failedRequests: totals.failedRequests ?? 0,
    blockedRequests: totals.blockedRequests ?? 0,
    rateLimitedRequests: totals.rateLimitedRequests ?? 0,
    cancelledRequests: totals.cancelledRequests ?? 0,
    cacheHitRequests: totals.cacheHitRequests ?? 0,
    cacheEligibleRequests: totals.cacheEligibleRequests ?? 0,
    cacheHitRate: totals.cacheHitRate ?? 0,
    exactCacheHitRate: totals.exactCacheHitRate ?? totals.cacheHitRate ?? 0,
    fallbackSuccessCount: totals.fallbackSuccessCount ?? 0,
    totalTokens: totals.totalTokens ?? 0,
    promptTokens: totals.promptTokens ?? 0,
    completionTokens: totals.completionTokens ?? 0,
    totalCostMicroUsd: totals.totalCostMicroUsd ?? 0,
    totalCostUsd: totals.totalCostUsd ?? formatMicroUsd(totals.totalCostMicroUsd ?? 0),
    savedCostMicroUsd: totals.savedCostMicroUsd ?? 0,
    savedCostUsd: totals.savedCostUsd ?? formatMicroUsd(totals.savedCostMicroUsd ?? 0),
    averageLatencyMs: totals.averageLatencyMs ?? totals.averageResponseTimeMs ?? 0,
    p95LatencyMs: performance?.p95GatewayInternalLatencyMs ?? totals.p95LatencyMs ?? 0,
    maskingActionCounts: totals.maskingActionCounts ?? {},
    routingCountByModel: (totals.routingCountByModel ?? []).map((row) => ({
      selectedProvider: row.selectedProvider ?? "not-routed",
      selectedModel: row.selectedModel ?? "not-routed",
      routingReason: row.routingReason ?? "not-set",
      requestCount: row.requestCount ?? 0
    })),
    statusCounts: totals.statusCounts ?? {},
    costByModel: (totals.costByModel ?? []).map((row) => ({
      selectedProvider: row.selectedProvider ?? "not-routed",
      selectedModel: row.selectedModel ?? "not-routed",
      requestCount: row.requestCount ?? 0,
      totalTokens: row.totalTokens ?? 0,
      costMicroUsd: row.costMicroUsd ?? 0,
      costUsd: row.costUsd ?? formatMicroUsd(row.costMicroUsd ?? 0)
    })),
    requestIds: [],
    dataFreshness: {
      source: v2Freshness?.source ?? freshness.source ?? "gateway-postgresql",
      recordCount: freshness.recordCount ?? 0,
      lastLogCreatedAt: v2Freshness?.lastIngestedAt ?? freshness.lastLogCreatedAt ?? freshness.generatedAt ?? fallbackTo,
      generatedAt: freshness.generatedAt ?? v2Freshness?.lastAggregatedAt ?? fallbackTo
    },
    queryBudget: {
      status: data.queryBudget?.status ?? "ok",
      maxRangeHours: data.queryBudget?.maxRangeHours ?? LIVE_RANGE_HOURS,
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

function safeRate(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function formatMicroUsd(value: number) {
  return (value / 1_000_000).toFixed(6);
}
