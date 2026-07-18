import {
  formatDisplayIdentifier,
  formatModelDisplayName
} from "@/lib/formatting/display-identifiers";
import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import type {
  AnalyticsCacheEvidence,
  AnalyticsCacheSourceRow
} from "@/features/analytics/analytics-cache-merge";
import type {
  AnalyticsRequestVolumePoint,
  AnalyticsUsageEvidence
} from "@/features/analytics/analytics-usage-merge";
import type { AnalyticsV5PolicyImpactEvidence } from "@/features/analytics/analytics-v5-evidence";

export type AnalyticsDataState = "live" | "partial" | "stale" | "unavailable";

export type AnalyticsValueRow = {
  id: string;
  label: string;
  value: number;
};

export type AnalyticsCostAttributionRow =
  | {
      id: string;
      kind: "project";
      label: string;
      projectId: string;
      value: number;
    }
  | {
      id: "surface:tenant_chat";
      kind: "surface";
      label: "Tenant Chat";
      surface: "tenant_chat";
      value: number;
    };

export type AnalyticsReadModelOptions = {
  cacheEvidence?: AnalyticsCacheEvidence;
  policyImpact?: AnalyticsV5PolicyImpactEvidence;
  tenantChatCostMicroUsd?: number;
};

export type AnalyticsReadModel = {
  cache: {
    bypassRequests: number;
    eligibleRequests: number;
    hitRate: number;
    hitRequests: number;
    outcomes: AnalyticsValueRow[];
    savedCostMicroUsd: number | null;
    sources: AnalyticsCacheSourceRow[];
  };
  cost: {
    avoidedSpendRate: number;
    costAttributions: AnalyticsCostAttributionRow[];
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
    highPerformanceEligibleRequests: number;
    highPerformanceRequests: number;
    modelMix: AnalyticsValueRow[];
    outcomes: AnalyticsValueRow[];
    protectedRequestRate: number;
    protectedRequests: number;
    requestDisposition: AnalyticsValueRow[];
    routingDifficulties: AnalyticsValueRow[];
    savedCostComplete: boolean;
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
    requestVolume: AnalyticsRequestVolumePoint[];
    requestsByModel: AnalyticsValueRow[];
    sourceMix: AnalyticsValueRow[];
    tokenMix: AnalyticsValueRow[];
    tokensPerRequest: number;
    totalRequests: number;
    totalTokens: number;
  };
};

export function buildAnalyticsReadModel(
  overview: DashboardOverview | undefined,
  usageEvidence?: AnalyticsUsageEvidence,
  options: AnalyticsReadModelOptions = {}
): AnalyticsReadModel {
  if (!overview) {
    const empty = emptyAnalyticsReadModel();
    return options.policyImpact
      ? applyPolicyImpactEvidence(empty, options.policyImpact)
      : empty;
  }

  const modelMix = aggregateModelRows(
    overview.breakdowns?.byProviderModel?.length
      ? overview.breakdowns.byProviderModel.map((row) => ({
          model: row.model,
          provider: row.provider,
          value: row.requestCount
        }))
      : (overview.costByModel ?? []).map((row) => ({
          model: row.model,
          provider: row.provider,
          value: row.requestCount
        }))
  );
  const projectMix = (overview.costByProject ?? [])
    .filter((row) => row.requestCount > 0)
    .map((row) => ({
      id: row.projectId,
      label: row.projectId,
      value: row.requestCount
    }))
    .sort((left, right) => right.value - left.value);
  const costByProject = (overview.costByProject ?? [])
    .filter((row) => row.costMicroUsd > 0)
    .map((row) => ({
      id: row.projectId,
      label: row.projectId,
      value: row.costMicroUsd
    }))
    .sort((left, right) => right.value - left.value);
  const costAttributions: AnalyticsCostAttributionRow[] = [
    ...costByProject.map((row) => ({
      ...row,
      kind: "project" as const,
      projectId: row.id
    })),
    ...(options.tenantChatCostMicroUsd !== undefined
      ? [{
          id: "surface:tenant_chat" as const,
          kind: "surface" as const,
          label: "Tenant Chat" as const,
          surface: "tenant_chat" as const,
          value: Math.max(0, options.tenantChatCostMicroUsd)
        }]
      : [])
  ];
  const cacheEvidence = options.cacheEvidence;
  const cacheHitRequests = cacheEvidence?.hitRequests ?? Math.max(
    overview.cacheHitRequests,
    outcomeValue(overview.breakdowns?.byCacheOutcome, ["hit", "cache_hit", "exact_hit"])
  );
  const cacheMissRequests = cacheEvidence?.missRequests ?? Math.max(
    0,
    outcomeValue(overview.breakdowns?.byCacheOutcome, ["miss", "cache_miss", "exact_miss"]) ||
      overview.cacheEligibleRequests - cacheHitRequests
  );
  const cacheBypassRequests = cacheEvidence?.bypassRequests ?? Math.max(
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

  const readModel: AnalyticsReadModel = {
    cache: {
      bypassRequests: cacheBypassRequests,
      eligibleRequests: cacheEvidence?.eligibleRequests ?? overview.cacheEligibleRequests,
      hitRate:
        cacheEvidence?.hitRate ?? overview.exactCacheHitRate ?? overview.cacheHitRate,
      hitRequests: cacheHitRequests,
      outcomes: [
        { id: "hit", label: "CACHE HIT", value: cacheHitRequests },
        { id: "miss", label: "CACHE MISS / ERROR", value: cacheMissRequests },
        { id: "bypass", label: "CACHE OFF / BYPASS", value: cacheBypassRequests }
      ],
      savedCostMicroUsd: cacheEvidence
        ? cacheEvidence.savedCostMicroUsd
        : overview.savedCostMicroUsd,
      sources: cacheEvidence?.sources ?? []
    },
    cost: {
      avoidedSpendRate: safeRatio(overview.savedCostMicroUsd, addressableSpend),
      costAttributions,
      costByModel: aggregateModelRows(
        (overview.costByModel ?? []).map((row) => ({
          model: row.model,
          provider: row.provider,
          value: row.costMicroUsd
        }))
      ),
      costByProject,
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
      highPerformanceEligibleRequests: routingDifficultyRows(overview).reduce((sum, row) => sum + row.value, 0),
      highPerformanceRequests: routingDifficultyRows(overview).find((row) => row.id === "complex")?.value ?? 0,
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
      routingDifficulties: routingDifficultyRows(overview),
      savedCostComplete: true,
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
      projectMix,
      requestVolume: usageEvidence?.requestVolume ?? [],
      requestsByModel: modelMix,
      sourceMix: usageEvidence?.sourceMix ?? projectMix,
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
  return options.policyImpact
    ? applyPolicyImpactEvidence(readModel, options.policyImpact)
    : readModel;
}

function applyPolicyImpactEvidence(
  readModel: AnalyticsReadModel,
  evidence: AnalyticsV5PolicyImpactEvidence
): AnalyticsReadModel {
  const modelMix = aggregateModelRows(evidence.modelMix.map((row) => ({
    model: row.model,
    provider: row.provider,
    value: row.requestCount
  })));
  const policyOutcomes = aggregatePolicyOutcomeRows(evidence);
  const cacheHits = valueById(policyOutcomes, "cache_hit");
  const stoppedBeforeProvider = Math.max(0, evidence.avoidedProviderCallRequests - cacheHits);
  const savedCostMicroUsd = evidence.savedCostMicroUsd ?? evidence.knownSavedCostMicroUsd;
  const addressableSpend = evidence.totalCostMicroUsd + savedCostMicroUsd;
  const sourceMix = evidence.usageSources.map((row) => ({
    id: row.surface === "tenant_chat" ? "surface:tenant_chat" : row.projectId ?? "project:unknown",
    label: row.surface === "tenant_chat" ? "Tenant Chat" : row.projectId ?? "Unknown project",
    value: row.requestCount
  })).sort((left, right) => right.value - left.value);
  const routingDifficultyTotals = new Map([
    ["simple", 0],
    ["complex", 0]
  ]);
  evidence.routingRoles.forEach((row) => {
    if (row.scheme !== "difficulty" || (row.role !== "simple" && row.role !== "complex")) {
      return;
    }
    routingDifficultyTotals.set(
      row.role,
      (routingDifficultyTotals.get(row.role) ?? 0) + Math.max(0, row.requestCount)
    );
  });
  const routingDifficulties = ["simple", "complex"]
    .map((id) => ({ id, label: id.toUpperCase(), value: routingDifficultyTotals.get(id) ?? 0 }))
    .filter((row) => row.value > 0);

  return {
    ...readModel,
    cost: {
      ...readModel.cost,
      avoidedSpendRate: evidence.savedCostMicroUsd === null ? 0 : safeRatio(savedCostMicroUsd, addressableSpend),
      savedCostMicroUsd,
      totalCostMicroUsd: evidence.totalCostMicroUsd
    },
    dataAsOf: evidence.dataAsOf,
    dataState: evidence.dataState,
    impact: {
      avoidedProviderCallRate: safeRatio(evidence.avoidedProviderCallRequests, evidence.totalRequests),
      avoidedProviderCalls: evidence.avoidedProviderCallRequests,
      highPerformanceEligibleRequests: evidence.highPerformanceEligibleRequests,
      highPerformanceRequests: evidence.highPerformanceRequests,
      modelMix,
      outcomes: policyOutcomes,
      protectedRequestRate: safeRatio(evidence.protectedRequests, evidence.totalRequests),
      protectedRequests: evidence.protectedRequests,
      requestDisposition: [
        {
          id: "provider",
          label: "PROVIDER PATH",
          value: Math.max(0, evidence.totalRequests - evidence.avoidedProviderCallRequests)
        },
        { id: "cache", label: "CACHE SERVED", value: cacheHits },
        { id: "guardrail", label: "STOPPED BEFORE PROVIDER", value: stoppedBeforeProvider }
      ],
      routingDifficulties,
      savedCostComplete: evidence.savedCostMicroUsd !== null,
      savedCostMicroUsd,
      spendAvoidanceRate: evidence.savedCostMicroUsd === null ? 0 : safeRatio(savedCostMicroUsd, addressableSpend)
    },
    source: "gateway-policy-impact",
    totalRequests: evidence.totalRequests,
    usage: {
      ...readModel.usage,
      activeModels: modelMix.length,
      projectMix: sourceMix,
      requestsByModel: modelMix,
      sourceMix,
      totalRequests: evidence.totalRequests
    }
  };
}

function aggregatePolicyOutcomeRows(evidence: AnalyticsV5PolicyImpactEvidence): AnalyticsValueRow[] {
  const labels: Record<string, string> = {
    budget_blocked: "BUDGET BLOCKED",
    cache_hit: "CACHE HIT",
    concurrency_limited: "CONCURRENCY LIMITED",
    fallback_success: "FALLBACK",
    pii_masked: "PII MASKED",
    policy_ack_required: "POLICY ACK REQUIRED",
    quota_blocked: "QUOTA BLOCKED",
    rate_limited: "RATE LIMITED",
    safety_blocked: "SAFETY BLOCKED"
  };
  const ids: Record<string, string> = {
    fallback_success: "fallback",
    safety_blocked: "blocked"
  };
  const totals = new Map<string, AnalyticsValueRow>();
  evidence.policyOutcomes.forEach((row) => {
    const id = ids[row.outcome] ?? row.outcome;
    const current = totals.get(id);
    totals.set(id, {
      id,
      label: labels[row.outcome] ?? row.outcome.replaceAll("_", " ").toUpperCase(),
      value: (current?.value ?? 0) + row.requestCount
    });
  });
  return [...totals.values()].sort((left, right) => right.value - left.value);
}

function valueById(rows: AnalyticsValueRow[], id: string) {
  return rows.find((row) => row.id === id)?.value ?? 0;
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
        { id: "miss", label: "CACHE MISS / ERROR", value: 0 },
        { id: "bypass", label: "CACHE OFF / BYPASS", value: 0 }
      ],
      savedCostMicroUsd: null,
      sources: []
    },
    cost: {
      avoidedSpendRate: 0,
      costAttributions: [],
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
      highPerformanceEligibleRequests: 0,
      highPerformanceRequests: 0,
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
      routingDifficulties: [],
      savedCostComplete: true,
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
      requestVolume: [],
      requestsByModel: [],
      sourceMix: [],
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
  const totals = new Map<string, { label: string; provider: string; value: number }>();

  rows.forEach((row) => {
    if (row.value <= 0) {
      return;
    }

    const id = JSON.stringify([row.provider, row.model]);
    const current = totals.get(id);
    totals.set(id, {
      label: formatModelDisplayName(row.model),
      provider: row.provider,
      value: (current?.value ?? 0) + row.value
    });
  });

  const labelCounts = new Map<string, number>();
  totals.forEach((row) => {
    labelCounts.set(row.label, (labelCounts.get(row.label) ?? 0) + 1);
  });

  return [...totals.entries()]
    .map(([id, row]) => ({
      id,
      label: (labelCounts.get(row.label) ?? 0) > 1
        ? `${row.label} · ${formatDisplayIdentifier(row.provider) || "Provider"}`
        : row.label,
      value: row.value
    }))
    .sort((left, right) => right.value - left.value);
}

function routingDifficultyRows(overview: DashboardOverview): AnalyticsValueRow[] {
  const totals = new Map([
    ["simple", 0],
    ["complex", 0]
  ]);

  overview.routingSummaries.forEach((row) => {
    totals.set(row.difficulty, (totals.get(row.difficulty) ?? 0) + Math.max(0, row.requestCount));
  });

  const labels: Record<string, string> = {
    simple: "SIMPLE",
    complex: "COMPLEX"
  };

  return ["simple", "complex"]
    .map((id) => ({ id, label: labels[id] ?? id.toUpperCase(), value: totals.get(id) ?? 0 }))
    .filter((row) => row.value > 0);
}

function terminalOutcomeRows(overview: DashboardOverview): AnalyticsValueRow[] {
  const rows = overview.breakdowns?.byTerminalStatus?.length
    ? overview.breakdowns.byTerminalStatus.map((row) => ({
        id: row.outcome,
        label: normalizeOutcome(row.outcome).replaceAll("_", " ").toUpperCase(),
        value: row.requestCount
      }))
    : Object.entries(overview.statusCounts ?? {}).map(([outcome, requestCount]) => ({
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
