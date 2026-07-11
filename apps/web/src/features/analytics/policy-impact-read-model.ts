import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";

export type PolicyImpactOutcomeId =
  | "cache_hit"
  | "pii_masked"
  | "blocked"
  | "rate_limited"
  | "fallback";

export type PolicyImpactDataState =
  | "live"
  | "partial"
  | "stale"
  | "unavailable";

export type PolicyImpactReadModel = {
  dataAsOf: string | null;
  dataState: PolicyImpactDataState;
  metrics: {
    avoidedProviderCalls: number;
    protectedRequests: number;
    savedCostMicroUsd: number;
  };
  modelShare: Array<{
    model: string;
    provider: string;
    requestCount: number;
  }>;
  outcomes: Array<{
    id: PolicyImpactOutcomeId;
    requestCount: number;
  }>;
  source: string;
  totalRequests: number;
};

const outcomeIds: PolicyImpactOutcomeId[] = [
  "cache_hit",
  "pii_masked",
  "blocked",
  "rate_limited",
  "fallback"
];

export function buildPolicyImpactReadModel(
  overview: DashboardOverview | undefined
): PolicyImpactReadModel {
  if (!overview) {
    return {
      dataAsOf: null,
      dataState: "unavailable",
      metrics: {
        avoidedProviderCalls: 0,
        protectedRequests: 0,
        savedCostMicroUsd: 0
      },
      modelShare: [],
      outcomes: outcomeIds.map((id) => ({ id, requestCount: 0 })),
      source: "gateway-dashboard-overview",
      totalRequests: 0
    };
  }

  const cacheHitRequests = Math.max(
    overview.cacheHitRequests,
    outcomeCount(overview.breakdowns?.byCacheOutcome, ["hit", "exact_hit", "cache_hit"])
  );
  const redactedRequests = Math.max(
    recordCount(overview.maskingActionCounts, ["redacted", "masked"]),
    outcomeCount(overview.breakdowns?.bySafetyOutcome, ["redacted", "masked"])
  );
  const blockedRequests = Math.max(
    overview.blockedRequests,
    recordCount(overview.maskingActionCounts, ["blocked"]),
    outcomeCount(overview.breakdowns?.bySafetyOutcome, ["blocked"])
  );
  const fallbackSuccesses = Math.max(
    overview.fallbackSuccessCount ?? 0,
    outcomeCount(overview.breakdowns?.byFallbackOutcome, ["success", "fallback_success"])
  );
  const rateLimitedRequests = overview.rateLimitedRequests;

  return {
    dataAsOf:
      overview.dataFreshness.lastLogCreatedAt ||
      overview.dataFreshness.generatedAt ||
      overview.range.to ||
      null,
    dataState: normalizeDataState(overview.queryBudget?.status),
    metrics: {
      avoidedProviderCalls: cacheHitRequests + blockedRequests + rateLimitedRequests,
      protectedRequests: redactedRequests + blockedRequests,
      savedCostMicroUsd: overview.savedCostMicroUsd
    },
    modelShare: buildModelShare(overview),
    outcomes: [
      { id: "cache_hit", requestCount: cacheHitRequests },
      { id: "pii_masked", requestCount: redactedRequests },
      { id: "blocked", requestCount: blockedRequests },
      { id: "rate_limited", requestCount: rateLimitedRequests },
      { id: "fallback", requestCount: fallbackSuccesses }
    ],
    source: overview.dataFreshness.source || "gateway-dashboard-overview",
    totalRequests: overview.totalRequests
  };
}

function buildModelShare(overview: DashboardOverview) {
  const sourceRows = overview.breakdowns?.byProviderModel?.length
    ? overview.breakdowns.byProviderModel.map((row) => ({
        model: row.selectedModel,
        provider: row.selectedProvider,
        requestCount: row.requestCount
      }))
    : overview.routingCountByModel.map((row) => ({
        model: row.selectedModel,
        provider: row.selectedProvider,
        requestCount: row.requestCount
      }));
  const aggregated = new Map<string, { model: string; provider: string; requestCount: number }>();

  sourceRows.forEach((row) => {
    if (row.requestCount <= 0) {
      return;
    }

    const model = formatModelDisplayName(row.model);
    const provider = row.provider || "not-routed";
    const key = `${provider}:${model}`;
    const current = aggregated.get(key);
    aggregated.set(key, {
      model,
      provider,
      requestCount: (current?.requestCount ?? 0) + row.requestCount
    });
  });

  return [...aggregated.values()].sort(
    (left, right) => right.requestCount - left.requestCount
  );
}

function outcomeCount(
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

function recordCount(counts: Record<string, number>, aliases: string[]) {
  const normalizedAliases = new Set(aliases.map(normalizeOutcome));
  return Object.entries(counts).reduce((sum, [key, value]) => {
    return normalizedAliases.has(normalizeOutcome(key)) ? sum + Math.max(0, value) : sum;
  }, 0);
}

function normalizeOutcome(value: string) {
  return value.trim().toLowerCase().replaceAll("-", "_").replaceAll(" ", "_");
}

function normalizeDataState(
  queryStatus: NonNullable<DashboardOverview["queryBudget"]>["status"] | undefined
): PolicyImpactDataState {
  if (queryStatus === "partial" || queryStatus === "too_broad") {
    return "partial";
  }
  if (queryStatus === "stale") {
    return "stale";
  }
  if (queryStatus === "unavailable") {
    return "unavailable";
  }

  return "live";
}
