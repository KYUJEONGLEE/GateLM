import "server-only";

import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";

type LiveDashboardOverviewResponse = {
  data?: {
    dataFreshness?: {
      generatedAt?: string;
      lastLogCreatedAt?: string | null;
      recordCount?: number;
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
      from: data.range?.from ?? fallbackFrom,
      to: data.range?.to ?? fallbackTo,
      timezone: "UTC",
      grain: "live"
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
    cacheHitRequests: totals.cacheHitRequests ?? 0,
    cacheEligibleRequests: totals.cacheEligibleRequests ?? 0,
    cacheHitRate: totals.cacheHitRate ?? 0,
    totalTokens: totals.totalTokens ?? 0,
    promptTokens: totals.promptTokens ?? 0,
    completionTokens: totals.completionTokens ?? 0,
    totalCostMicroUsd: totals.totalCostMicroUsd ?? 0,
    totalCostUsd: totals.totalCostUsd ?? formatMicroUsd(totals.totalCostMicroUsd ?? 0),
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
      source: freshness.source ?? "gateway-postgresql",
      recordCount: freshness.recordCount ?? 0,
      lastLogCreatedAt: freshness.lastLogCreatedAt ?? freshness.generatedAt ?? fallbackTo,
      generatedAt: freshness.generatedAt ?? fallbackTo
    },
    notes: ["Live Gateway overview. Raw prompt, raw response, and credentials are not exposed."]
  };
}

function formatMicroUsd(value: number) {
  return (value / 1_000_000).toFixed(6);
}
