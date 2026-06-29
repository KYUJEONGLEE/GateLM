import "server-only";

import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";

type LiveDashboardOverviewResponse = {
  data?: {
    breakdowns?: {
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
      applicationId?: string | null;
      budgetScopeId?: string | null;
      budgetScopeType?: string | null;
      projectId?: string | null;
      resolvedBy?: string | null;
      tenantId?: string;
    };
    generatedAt?: string;
    performance?: {
      p95GatewayInternalLatencyMs?: number;
      p95ProviderLatencyMs?: number;
      p99GatewayInternalLatencyMs?: number;
      p99ProviderLatencyMs?: number;
      systemErrorRate?: number;
    };
    queryBudget?: {
      guidance?: string | null;
      maxBreakdownItems?: number;
      maxRangeHours?: number;
      status?: string;
    };
    range?: {
      from?: string;
      to?: string;
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
      failedCount?: number;
      fallbackSuccessCount?: number;
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
      terminalStatusCounts?: Record<string, number>;
      blockedCount?: number;
      cancelledCount?: number;
      estimatedCostMicroUsd?: number;
      exactCacheHitRate?: number;
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
  const freshness = data.freshness ?? {};
  const legacyFreshness = data.dataFreshness ?? {};
  const applicationId = data.filters?.applicationId ?? "live_gateway_application";
  const terminalStatusCounts = outcomeBreakdownToRecord(data.breakdowns?.byTerminalStatus);
  const safetyOutcomeCounts = outcomeBreakdownToRecord(data.breakdowns?.bySafetyOutcome);
  const providerBreakdown = data.breakdowns?.byProviderModel ?? [];
  const totalRequests = totals.requestCount ?? totals.totalRequests ?? 0;
  const successCount = totals.successCount ?? totals.successfulRequests ?? 0;
  const failedCount = totals.failedCount ?? totals.failedRequests ?? 0;
  const blockedCount = totals.blockedCount ?? totals.blockedRequests ?? 0;
  const rateLimitedCount = totals.rateLimitedCount ?? totals.rateLimitedRequests ?? 0;
  const estimatedCostMicroUsd = totals.estimatedCostMicroUsd ?? totals.totalCostMicroUsd ?? 0;
  const exactCacheHitRate = totals.exactCacheHitRate ?? totals.cacheHitRate ?? 0;

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
    successfulRequests: successCount,
    failedRequests: failedCount,
    blockedRequests: blockedCount,
    rateLimitedRequests: rateLimitedCount,
    cacheHitRequests: totals.cacheHitRequests ?? 0,
    cacheEligibleRequests: totals.cacheEligibleRequests ?? 0,
    cacheHitRate: exactCacheHitRate,
    totalTokens: totals.totalTokens ?? 0,
    promptTokens: totals.promptTokens ?? 0,
    completionTokens: totals.completionTokens ?? 0,
    totalCostMicroUsd: estimatedCostMicroUsd,
    totalCostUsd: totals.totalCostUsd ?? formatMicroUsd(estimatedCostMicroUsd),
    savedCostMicroUsd: totals.savedCostMicroUsd ?? 0,
    savedCostUsd: totals.savedCostUsd ?? formatMicroUsd(totals.savedCostMicroUsd ?? 0),
    averageLatencyMs: totals.averageLatencyMs ?? totals.averageResponseTimeMs ?? 0,
    p95LatencyMs: data.performance?.p95GatewayInternalLatencyMs ?? totals.p95LatencyMs ?? 0,
    maskingActionCounts: totals.maskingActionCounts ?? safetyToMaskingCounts(safetyOutcomeCounts),
    routingCountByModel: (totals.routingCountByModel ?? providerBreakdown).map((row) => ({
      selectedProvider: row.selectedProvider ?? "not-routed",
      selectedModel: row.selectedModel ?? "not-routed",
      routingReason: "provider_model_breakdown",
      requestCount: row.requestCount ?? 0
    })),
    statusCounts: totals.terminalStatusCounts ?? totals.statusCounts ?? terminalStatusCounts,
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
      source: freshness.source ?? legacyFreshness.source ?? "gateway-postgresql",
      recordCount: totalRequests,
      lastLogCreatedAt: freshness.lastIngestedAt ?? legacyFreshness.lastLogCreatedAt ?? data.generatedAt ?? fallbackTo,
      generatedAt: freshness.lastAggregatedAt ?? legacyFreshness.generatedAt ?? data.generatedAt ?? fallbackTo
    },
    notes: [
      `Live Gateway overview. systemErrorRate=${formatRate(data.performance?.systemErrorRate ?? 0)} excludes safety block, budget block, and rate_limited outcomes.`
    ]
  };
}

function formatMicroUsd(value: number) {
  return (value / 1_000_000).toFixed(6);
}

function outcomeBreakdownToRecord(rows: Array<{ outcome?: string; requestCount?: number }> | undefined) {
  return Object.fromEntries((rows ?? []).map((row) => [row.outcome ?? "unknown", row.requestCount ?? 0]));
}

function safetyToMaskingCounts(counts: Record<string, number>) {
  return {
    blocked: counts.blocked ?? 0,
    none: counts.passed ?? counts.not_checked ?? 0,
    redacted: counts.redacted ?? 0
  };
}

function formatRate(value: number) {
  return value.toFixed(4);
}
