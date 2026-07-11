import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";

export type AnalyticsOverviewDataState = "live" | "partial" | "stale" | "unavailable";

export type AnalyticsBreakdownRow = {
  id: string;
  label: string;
  value: number;
};

export type AnalyticsOverviewReadModel = {
  cache: {
    eligibleRequests: number;
    hitRate: number;
    hitRequests: number;
    outcomes: AnalyticsBreakdownRow[];
    savedCostMicroUsd: number;
    volume: AnalyticsBreakdownRow[];
  };
  cost: {
    costByModel: AnalyticsBreakdownRow[];
    costByProject: AnalyticsBreakdownRow[];
    costPerRequestMicroUsd: number;
    savedCostMicroUsd: number;
    totalCostMicroUsd: number;
  };
  dataAsOf: string | null;
  dataState: AnalyticsOverviewDataState;
  reliability: {
    fallbackSuccesses: number;
    providerLatency: AnalyticsBreakdownRow[];
    successRate: number;
    systemErrorRate: number;
    terminalOutcomes: AnalyticsBreakdownRow[];
  };
  source: string;
  usage: {
    activeModels: number;
    requestsByModel: AnalyticsBreakdownRow[];
    tokenMix: AnalyticsBreakdownRow[];
    totalRequests: number;
    totalTokens: number;
  };
};

export function buildAnalyticsOverviewReadModel(
  overview: DashboardOverview | undefined
): AnalyticsOverviewReadModel {
  if (!overview) {
    return emptyAnalyticsOverviewReadModel();
  }

  const requestsByModel = aggregateModelRows(
    overview.breakdowns?.byProviderModel?.length
      ? overview.breakdowns.byProviderModel.map((row) => ({
          id: `${row.selectedProvider}:${row.selectedModel}`,
          model: row.selectedModel,
          value: row.requestCount
        }))
      : overview.routingCountByModel.map((row) => ({
          id: `${row.selectedProvider}:${row.selectedModel}`,
          model: row.selectedModel,
          value: row.requestCount
        }))
  );
  const costByModel = aggregateModelRows(
    overview.costByModel.map((row) => ({
      id: `${row.selectedProvider}:${row.selectedModel}`,
      model: row.selectedModel,
      value: row.costMicroUsd
    }))
  );
  const cacheHitRequests = Math.max(
    overview.cacheHitRequests,
    outcomeValue(overview.breakdowns?.byCacheOutcome, ["hit", "cache_hit", "exact_hit"])
  );
  const cacheMissRequests = Math.max(
    0,
    outcomeValue(overview.breakdowns?.byCacheOutcome, ["miss", "cache_miss", "exact_miss"]) ||
      overview.cacheEligibleRequests - cacheHitRequests
  );
  const cacheBypassRequests = Math.max(
    0,
    outcomeValue(overview.breakdowns?.byCacheOutcome, ["bypass", "bypassed", "not_eligible"]) ||
      overview.totalRequests - overview.cacheEligibleRequests
  );

  return {
    cache: {
      eligibleRequests: overview.cacheEligibleRequests,
      hitRate: overview.exactCacheHitRate ?? overview.cacheHitRate,
      hitRequests: cacheHitRequests,
      outcomes: [
        { id: "hit", label: "CACHE HIT", value: cacheHitRequests },
        { id: "miss", label: "CACHE MISS", value: cacheMissRequests },
        { id: "bypass", label: "BYPASS", value: cacheBypassRequests }
      ],
      savedCostMicroUsd: overview.savedCostMicroUsd,
      volume: [
        { id: "eligible", label: "Eligible", value: overview.cacheEligibleRequests },
        { id: "hit", label: "Hit", value: cacheHitRequests }
      ]
    },
    cost: {
      costByModel,
      costByProject: (overview.costByProject ?? [])
        .filter((row) => row.costMicroUsd > 0)
        .map((row) => ({
          id: row.projectId,
          label: row.projectId,
          value: row.costMicroUsd
        }))
        .sort((left, right) => right.value - left.value),
      costPerRequestMicroUsd:
        overview.totalRequests > 0 ? overview.totalCostMicroUsd / overview.totalRequests : 0,
      savedCostMicroUsd: overview.savedCostMicroUsd,
      totalCostMicroUsd: overview.totalCostMicroUsd
    },
    dataAsOf:
      overview.dataFreshness.lastLogCreatedAt ||
      overview.dataFreshness.generatedAt ||
      overview.range.to ||
      null,
    dataState: normalizeDataState(overview.queryBudget?.status),
    reliability: {
      fallbackSuccesses: Math.max(
        overview.fallbackSuccessCount ?? 0,
        outcomeValue(overview.breakdowns?.byFallbackOutcome, ["success", "fallback_success"])
      ),
      providerLatency: aggregateProviderLatency(overview),
      successRate: safeRatio(overview.successfulRequests, overview.totalRequests),
      systemErrorRate:
        overview.performance?.systemErrorRate ??
        safeRatio(overview.failedRequests, overview.totalRequests),
      terminalOutcomes: terminalOutcomeRows(overview)
    },
    source: overview.dataFreshness.source || "gateway-dashboard-overview",
    usage: {
      activeModels: requestsByModel.filter((row) => row.value > 0).length,
      requestsByModel,
      tokenMix: [
        { id: "prompt", label: "Prompt tokens", value: overview.promptTokens },
        { id: "completion", label: "Completion tokens", value: overview.completionTokens }
      ],
      totalRequests: overview.totalRequests,
      totalTokens: overview.totalTokens
    }
  };
}

function emptyAnalyticsOverviewReadModel(): AnalyticsOverviewReadModel {
  return {
    cache: {
      eligibleRequests: 0,
      hitRate: 0,
      hitRequests: 0,
      outcomes: [
        { id: "hit", label: "CACHE HIT", value: 0 },
        { id: "miss", label: "CACHE MISS", value: 0 },
        { id: "bypass", label: "BYPASS", value: 0 }
      ],
      savedCostMicroUsd: 0,
      volume: [
        { id: "eligible", label: "Eligible", value: 0 },
        { id: "hit", label: "Hit", value: 0 }
      ]
    },
    cost: {
      costByModel: [],
      costByProject: [],
      costPerRequestMicroUsd: 0,
      savedCostMicroUsd: 0,
      totalCostMicroUsd: 0
    },
    dataAsOf: null,
    dataState: "unavailable",
    reliability: {
      fallbackSuccesses: 0,
      providerLatency: [],
      successRate: 0,
      systemErrorRate: 0,
      terminalOutcomes: []
    },
    source: "gateway-dashboard-overview",
    usage: {
      activeModels: 0,
      requestsByModel: [],
      tokenMix: [
        { id: "prompt", label: "Prompt tokens", value: 0 },
        { id: "completion", label: "Completion tokens", value: 0 }
      ],
      totalRequests: 0,
      totalTokens: 0
    }
  };
}

function aggregateModelRows(
  rows: Array<{ id: string; model: string; value: number }>
): AnalyticsBreakdownRow[] {
  const totals = new Map<string, number>();

  rows.forEach((row) => {
    if (row.value <= 0) {
      return;
    }

    const model = formatModelDisplayName(row.model);
    totals.set(model, (totals.get(model) ?? 0) + row.value);
  });

  return [...totals.entries()]
    .map(([label, value]) => ({ id: label, label, value }))
    .sort((left, right) => right.value - left.value);
}

function aggregateProviderLatency(overview: DashboardOverview): AnalyticsBreakdownRow[] {
  const providerLatency = new Map<string, number>();

  (overview.breakdowns?.byProviderModel ?? []).forEach((row) => {
    const current = providerLatency.get(row.selectedProvider) ?? 0;
    providerLatency.set(
      row.selectedProvider,
      Math.max(current, row.p95ProviderLatencyMs)
    );
  });

  return [...providerLatency.entries()]
    .filter(([, value]) => value > 0)
    .map(([label, value]) => ({ id: label, label, value }))
    .sort((left, right) => right.value - left.value);
}

function terminalOutcomeRows(overview: DashboardOverview) {
  const rows = overview.breakdowns?.byTerminalStatus?.length
    ? overview.breakdowns.byTerminalStatus.map((row) => ({
        id: row.outcome,
        label: terminalLabel(row.outcome),
        value: row.requestCount
      }))
    : Object.entries(overview.statusCounts).map(([outcome, requestCount]) => ({
        id: outcome,
        label: terminalLabel(outcome),
        value: requestCount
      }));

  return rows
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value);
}

function terminalLabel(value: string) {
  return normalizeOutcome(value).replaceAll("_", " ").toUpperCase();
}

function outcomeValue(
  rows: Array<{ outcome: string; requestCount: number }> | undefined,
  aliases: string[]
) {
  const normalizedAliases = new Set(aliases.map(normalizeOutcome));
  return (rows ?? []).reduce((sum, row) => {
    return normalizedAliases.has(normalizeOutcome(row.outcome))
      ? sum + Math.max(0, row.requestCount)
      : sum;
  }, 0);
}

function normalizeOutcome(value: string) {
  return value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function normalizeDataState(
  status: NonNullable<DashboardOverview["queryBudget"]>["status"] | undefined
): AnalyticsOverviewDataState {
  if (status === "partial" || status === "too_broad") {
    return "partial";
  }
  if (status === "stale") {
    return "stale";
  }
  if (status === "unavailable") {
    return "unavailable";
  }
  return "live";
}

function safeRatio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}
