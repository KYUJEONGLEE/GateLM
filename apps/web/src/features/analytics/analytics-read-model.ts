import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";

export type AnalyticsDataState = "live" | "partial" | "stale" | "unavailable";

export type AnalyticsValueRow = {
  id: string;
  label: string;
  value: number;
};

export type AnalyticsReadModel = {
  cache: {
    bypassRequests: number;
    eligibleRequests: number;
    hitRate: number;
    hitRequests: number;
    outcomes: AnalyticsValueRow[];
    savedCostMicroUsd: number;
  };
  cost: {
    avoidedSpendRate: number;
    costByModel: AnalyticsValueRow[];
    costByProject: AnalyticsValueRow[];
    costPerRequestMicroUsd: number;
    savedCostMicroUsd: number;
    totalCostMicroUsd: number;
  };
  dataAsOf: string | null;
  dataState: AnalyticsDataState;
  impact: {
    avoidedProviderCallRate: number;
    avoidedProviderCalls: number;
    modelMix: AnalyticsValueRow[];
    outcomes: AnalyticsValueRow[];
    protectedRequestRate: number;
    protectedRequests: number;
    requestDisposition: AnalyticsValueRow[];
    routingTiers: AnalyticsValueRow[];
    savedCostMicroUsd: number;
    spendAvoidanceRate: number;
  };
  reliability: {
    continuityPaths: AnalyticsValueRow[];
    fallbackSuccesses: number;
    successRate: number;
    systemErrorRate: number;
    terminalOutcomes: AnalyticsValueRow[];
  };
  source: string;
  totalRequests: number;
  usage: {
    activeModels: number;
    projectMix: AnalyticsValueRow[];
    requestsByModel: AnalyticsValueRow[];
    tokenMix: AnalyticsValueRow[];
    tokensPerRequest: number;
    totalRequests: number;
    totalTokens: number;
  };
};

export function buildAnalyticsReadModel(
  overview: DashboardOverview | undefined
): AnalyticsReadModel {
  if (!overview) {
    return emptyAnalyticsReadModel();
  }

  const modelMix = aggregateModelRows(
    overview.breakdowns?.byProviderModel?.length
      ? overview.breakdowns.byProviderModel.map((row) => ({
          model: row.selectedModel,
          provider: row.selectedProvider,
          value: row.requestCount
        }))
      : overview.routingCountByModel.map((row) => ({
          model: row.selectedModel,
          provider: row.selectedProvider,
          value: row.requestCount
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
  const redactedRequests = Math.max(
    recordValue(overview.maskingActionCounts, ["redacted", "masked"]),
    outcomeValue(overview.breakdowns?.bySafetyOutcome, ["redacted", "masked"])
  );
  const blockedRequests = Math.max(
    overview.blockedRequests,
    recordValue(overview.maskingActionCounts, ["blocked"]),
    outcomeValue(overview.breakdowns?.bySafetyOutcome, ["blocked"])
  );
  const rateLimitedRequests = Math.max(0, overview.rateLimitedRequests);
  const fallbackSuccesses = Math.max(
    overview.fallbackSuccessCount ?? 0,
    outcomeValue(overview.breakdowns?.byFallbackOutcome, ["success", "fallback_success"])
  );
  const avoidedProviderCalls = cacheHitRequests + blockedRequests + rateLimitedRequests;
  const protectedRequests = redactedRequests + blockedRequests;
  const providerPathRequests = Math.max(0, overview.totalRequests - avoidedProviderCalls);
  const addressableSpend = overview.totalCostMicroUsd + overview.savedCostMicroUsd;

  return {
    cache: {
      bypassRequests: cacheBypassRequests,
      eligibleRequests: overview.cacheEligibleRequests,
      hitRate: overview.exactCacheHitRate ?? overview.cacheHitRate,
      hitRequests: cacheHitRequests,
      outcomes: [
        { id: "hit", label: "CACHE HIT", value: cacheHitRequests },
        { id: "miss", label: "CACHE MISS", value: cacheMissRequests },
        { id: "bypass", label: "BYPASS", value: cacheBypassRequests }
      ],
      savedCostMicroUsd: overview.savedCostMicroUsd
    },
    cost: {
      avoidedSpendRate: safeRatio(overview.savedCostMicroUsd, addressableSpend),
      costByModel: aggregateModelRows(
        overview.costByModel.map((row) => ({
          model: row.selectedModel,
          provider: row.selectedProvider,
          value: row.costMicroUsd
        }))
      ),
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
    impact: {
      avoidedProviderCallRate: safeRatio(avoidedProviderCalls, overview.totalRequests),
      avoidedProviderCalls,
      modelMix,
      outcomes: [
        { id: "cache_hit", label: "CACHE HIT", value: cacheHitRequests },
        { id: "pii_masked", label: "PII MASKED", value: redactedRequests },
        { id: "blocked", label: "BLOCKED", value: blockedRequests },
        { id: "rate_limited", label: "RATE LIMITED", value: rateLimitedRequests },
        { id: "fallback", label: "FALLBACK", value: fallbackSuccesses }
      ],
      protectedRequestRate: safeRatio(protectedRequests, overview.totalRequests),
      protectedRequests,
      requestDisposition: [
        { id: "provider", label: "PROVIDER PATH", value: providerPathRequests },
        { id: "cache", label: "CACHE SERVED", value: cacheHitRequests },
        { id: "guardrail", label: "STOPPED BEFORE PROVIDER", value: blockedRequests + rateLimitedRequests }
      ],
      routingTiers: routingTierRows(overview),
      savedCostMicroUsd: overview.savedCostMicroUsd,
      spendAvoidanceRate: safeRatio(overview.savedCostMicroUsd, addressableSpend)
    },
    reliability: {
      continuityPaths: [
        {
          id: "direct_success",
          label: "DIRECT SUCCESS",
          value: Math.max(0, overview.successfulRequests - fallbackSuccesses)
        },
        { id: "fallback_success", label: "FALLBACK RECOVERED", value: fallbackSuccesses },
        { id: "failed", label: "FAILED", value: overview.failedRequests },
        { id: "cancelled", label: "CANCELLED", value: overview.cancelledRequests ?? 0 }
      ],
      fallbackSuccesses,
      successRate: safeRatio(overview.successfulRequests, overview.totalRequests),
      systemErrorRate:
        overview.performance?.systemErrorRate ??
        safeRatio(overview.failedRequests, overview.totalRequests),
      terminalOutcomes: terminalOutcomeRows(overview)
    },
    source: overview.dataFreshness.source || "gateway-dashboard-overview",
    totalRequests: overview.totalRequests,
    usage: {
      activeModels: modelMix.filter((row) => row.value > 0).length,
      projectMix: (overview.costByProject ?? [])
        .filter((row) => row.requestCount > 0)
        .map((row) => ({
          id: row.projectId,
          label: row.projectId,
          value: row.requestCount
        }))
        .sort((left, right) => right.value - left.value),
      requestsByModel: modelMix,
      tokenMix: [
        { id: "prompt", label: "PROMPT", value: overview.promptTokens },
        { id: "completion", label: "COMPLETION", value: overview.completionTokens }
      ],
      tokensPerRequest:
        overview.totalRequests > 0 ? overview.totalTokens / overview.totalRequests : 0,
      totalRequests: overview.totalRequests,
      totalTokens: overview.totalTokens
    }
  };
}

function emptyAnalyticsReadModel(): AnalyticsReadModel {
  return {
    cache: {
      bypassRequests: 0,
      eligibleRequests: 0,
      hitRate: 0,
      hitRequests: 0,
      outcomes: [
        { id: "hit", label: "CACHE HIT", value: 0 },
        { id: "miss", label: "CACHE MISS", value: 0 },
        { id: "bypass", label: "BYPASS", value: 0 }
      ],
      savedCostMicroUsd: 0
    },
    cost: {
      avoidedSpendRate: 0,
      costByModel: [],
      costByProject: [],
      costPerRequestMicroUsd: 0,
      savedCostMicroUsd: 0,
      totalCostMicroUsd: 0
    },
    dataAsOf: null,
    dataState: "unavailable",
    impact: {
      avoidedProviderCallRate: 0,
      avoidedProviderCalls: 0,
      modelMix: [],
      outcomes: [
        { id: "cache_hit", label: "CACHE HIT", value: 0 },
        { id: "pii_masked", label: "PII MASKED", value: 0 },
        { id: "blocked", label: "BLOCKED", value: 0 },
        { id: "rate_limited", label: "RATE LIMITED", value: 0 },
        { id: "fallback", label: "FALLBACK", value: 0 }
      ],
      protectedRequestRate: 0,
      protectedRequests: 0,
      requestDisposition: [
        { id: "provider", label: "PROVIDER PATH", value: 0 },
        { id: "cache", label: "CACHE SERVED", value: 0 },
        { id: "guardrail", label: "STOPPED BEFORE PROVIDER", value: 0 }
      ],
      routingTiers: [],
      savedCostMicroUsd: 0,
      spendAvoidanceRate: 0
    },
    reliability: {
      continuityPaths: [],
      fallbackSuccesses: 0,
      successRate: 0,
      systemErrorRate: 0,
      terminalOutcomes: []
    },
    source: "gateway-dashboard-overview",
    totalRequests: 0,
    usage: {
      activeModels: 0,
      projectMix: [],
      requestsByModel: [],
      tokenMix: [
        { id: "prompt", label: "PROMPT", value: 0 },
        { id: "completion", label: "COMPLETION", value: 0 }
      ],
      tokensPerRequest: 0,
      totalRequests: 0,
      totalTokens: 0
    }
  };
}

function aggregateModelRows(
  rows: Array<{ model: string; provider: string; value: number }>
): AnalyticsValueRow[] {
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

function routingTierRows(overview: DashboardOverview): AnalyticsValueRow[] {
  const totals = new Map([
    ["high_quality", 0],
    ["balanced", 0],
    ["low_cost", 0],
    ["other", 0]
  ]);

  overview.routingCountByModel.forEach((row) => {
    const tier = classifyRoutingTier(row.routingReason);
    totals.set(tier, (totals.get(tier) ?? 0) + Math.max(0, row.requestCount));
  });

  const labels: Record<string, string> = {
    balanced: "BALANCED",
    high_quality: "HIGH QUALITY",
    low_cost: "LOW COST",
    other: "OTHER"
  };

  return ["high_quality", "balanced", "low_cost", "other"]
    .map((id) => ({ id, label: labels[id] ?? id.toUpperCase(), value: totals.get(id) ?? 0 }))
    .filter((row) => row.value > 0);
}

function classifyRoutingTier(routingReason: string) {
  const reason = routingReason.trim().toLowerCase();

  if (reason.includes("low_cost") || reason.includes("downgraded_from_high_quality")) {
    return "low_cost";
  }
  if (reason.includes("high_quality")) {
    return "high_quality";
  }
  if (reason.includes("balanced") || reason.includes("default")) {
    return "balanced";
  }
  return "other";
}

function terminalOutcomeRows(overview: DashboardOverview): AnalyticsValueRow[] {
  const rows = overview.breakdowns?.byTerminalStatus?.length
    ? overview.breakdowns.byTerminalStatus.map((row) => ({
        id: row.outcome,
        label: normalizeOutcome(row.outcome).replaceAll("_", " ").toUpperCase(),
        value: row.requestCount
      }))
    : Object.entries(overview.statusCounts).map(([outcome, requestCount]) => ({
        id: outcome,
        label: normalizeOutcome(outcome).replaceAll("_", " ").toUpperCase(),
        value: requestCount
      }));

  return rows
    .filter((row) => row.value > 0)
    .sort((left, right) => right.value - left.value);
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

function recordValue(counts: Record<string, number>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeOutcome));
  return Object.entries(counts).reduce((sum, [key, value]) => {
    return normalizedAliases.has(normalizeOutcome(key)) ? sum + Math.max(0, value) : sum;
  }, 0);
}

function normalizeOutcome(value: string) {
  return value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function normalizeDataState(
  status: NonNullable<DashboardOverview["queryBudget"]>["status"] | undefined
): AnalyticsDataState {
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
