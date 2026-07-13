import type {
  TenantChatCostSeries,
  TenantChatDashboard
} from "@/lib/control-plane/tenant-chat-observability-client";
import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import type { CostOverTimeSummary } from "@/lib/gateway/cost-over-time-types";

export type DashboardSurface = "all" | "project_application" | "tenant_chat";

export function toTenantChatDashboardOverview(
  tenantId: string,
  dashboard: TenantChatDashboard
): DashboardOverview {
  const blockedRequests =
    dashboard.requests.concurrencyLimited +
    dashboard.requests.safetyBlocked +
    dashboard.requests.quotaBlocked +
    dashboard.requests.budgetBlocked;
  const statusCounts = {
    succeeded: dashboard.requests.succeeded,
    failed: dashboard.requests.failed,
    cancelled: dashboard.requests.cancelled,
    cache_hit: dashboard.requests.cacheHits,
    rate_limited: dashboard.requests.rateLimited,
    concurrency_limited: dashboard.requests.concurrencyLimited,
    safety_blocked: dashboard.requests.safetyBlocked,
    quota_blocked: dashboard.requests.quotaBlocked,
    budget_blocked: dashboard.requests.budgetBlocked
  };
  const costByModel = dashboard.breakdowns.map((row) => ({
    provider: row.providerId,
    model: row.modelKey,
    requestCount: row.requestCount,
    totalTokens: 0,
    costMicroUsd: row.confirmedCostMicroUsd,
    costUsd: formatMicroUsd(row.confirmedCostMicroUsd)
  }));
  const byProviderModel = dashboard.breakdowns.map((row) => ({
    provider: row.providerId,
    model: row.modelKey,
    requestCount: row.requestCount,
    p95ProviderLatencyMs: dashboard.latency.providerP95Ms
  }));

  return {
    surface: "tenant_chat",
    fixtureName: "tenant-chat-dashboard-overview",
    fixtureVersion: "tenant-chat/v1",
    owner: "tenant-chat-workstream",
    producer: "tenant-chat-outbox-projector",
    consumers: ["product-experience-demo"],
    sourceOfTruth: [
      "docs/tenant-chat/contracts.md",
      "docs/tenant-chat/schemas/dashboard-aggregate.schema.json"
    ],
    range: {
      from: dashboard.from,
      to: dashboard.to,
      timezone: "UTC",
      grain: "projection"
    },
    filters: {
      tenantId,
      projectId: "",
      applicationId: "",
      budgetScopeType: "tenant",
      budgetScopeId: tenantId,
      resolvedBy: "tenant_chat",
      provider: null,
      model: null
    },
    totalRequests: dashboard.requests.total,
    successfulRequests: dashboard.requests.succeeded,
    failedRequests: dashboard.requests.failed,
    blockedRequests,
    rateLimitedRequests: dashboard.requests.rateLimited,
    cancelledRequests: dashboard.requests.cancelled,
    cacheHitRequests: dashboard.requests.cacheHits,
    cacheEligibleRequests: dashboard.requests.cacheEligible,
    cacheHitRate: dashboard.requests.cacheHitRate,
    exactCacheHitRate: dashboard.requests.cacheHitRate,
    fallbackSuccessCount: dashboard.requests.fallbackSucceeded,
    totalTokens: dashboard.usage.confirmedTotalTokens,
    promptTokens: dashboard.usage.confirmedInputTokens,
    completionTokens: dashboard.usage.confirmedOutputTokens,
    totalCostMicroUsd: dashboard.usage.confirmedCostMicroUsd,
    totalCostUsd: formatMicroUsd(dashboard.usage.confirmedCostMicroUsd),
    savedCostMicroUsd: 0,
    savedCostUsd: formatMicroUsd(0),
    averageLatencyMs: dashboard.latency.averageMs,
    p95LatencyMs: dashboard.latency.p95Ms,
    latencyBySurface: { tenantChatP95Ms: dashboard.latency.p95Ms },
    maskingActionCounts: {},
    routingSummaries: [],
    statusCounts,
    costByModel,
    costByProject: [],
    requestIds: [],
    dataFreshness: {
      source: "tenant-chat-invocation-log",
      recordCount: dashboard.requests.total,
      lastLogCreatedAt: dashboard.freshness.projectedAt,
      generatedAt: dashboard.freshness.projectedAt
    },
    queryBudget: {
      status: dashboard.freshness.state === "fresh" ? "ok" : "partial",
      maxRangeHours: 24 * 7,
      maxBreakdownItems: 100,
      guidance:
        dashboard.freshness.state === "fresh"
          ? null
          : "Tenant Chat projection is delayed."
    },
    performance: {
      p95GatewayInternalLatencyMs: dashboard.latency.p95Ms,
      p99GatewayInternalLatencyMs: dashboard.latency.p99Ms,
      p95ProviderLatencyMs: dashboard.latency.providerP95Ms,
      p99ProviderLatencyMs: dashboard.latency.providerP95Ms,
      systemErrorRate: safeRate(dashboard.requests.failed, dashboard.requests.total)
    },
    breakdowns: {
      byApplication: [],
      byBudgetScope: [
        {
          budgetScopeType: "tenant",
          budgetScopeId: tenantId,
          resolvedBy: "tenant_chat",
          requestCount: dashboard.requests.total,
          estimatedCostMicroUsd: dashboard.usage.confirmedCostMicroUsd
        }
      ],
      byProviderModel,
      bySafetyOutcome: [
        { outcome: "blocked", requestCount: dashboard.requests.safetyBlocked }
      ],
      byCacheOutcome: [
        { outcome: "hit", requestCount: dashboard.requests.cacheHits },
        { outcome: "miss", requestCount: dashboard.requests.cacheMisses },
        { outcome: "off", requestCount: dashboard.requests.cacheOff }
      ],
      byFallbackOutcome: [
        { outcome: "succeeded", requestCount: dashboard.requests.fallbackSucceeded },
        {
          outcome: "failed",
          requestCount: Math.max(
            0,
            dashboard.requests.fallbackRequests - dashboard.requests.fallbackSucceeded
          )
        }
      ],
      byTerminalStatus: Object.entries(statusCounts).map(([outcome, requestCount]) => ({
        outcome,
        requestCount
      }))
    },
    notes: [
      "Tenant Chat content-free aggregate. Raw prompt, response, and credentials are not exposed."
    ]
  };
}

export function mergeDashboardOverviews(
  projectApplication: DashboardOverview,
  tenantChat: DashboardOverview
): DashboardOverview {
  const totalRequests = projectApplication.totalRequests + tenantChat.totalRequests;
  const cacheHitRequests = projectApplication.cacheHitRequests + tenantChat.cacheHitRequests;
  const cacheEligibleRequests =
    projectApplication.cacheEligibleRequests + tenantChat.cacheEligibleRequests;
  const totalCostMicroUsd =
    projectApplication.totalCostMicroUsd + tenantChat.totalCostMicroUsd;

  return {
    ...projectApplication,
    surface: "all",
    fixtureName: "unified-dashboard-overview",
    fixtureVersion: "surface-union-v1",
    producer: "web-dashboard-surface-composer",
    sourceOfTruth: [
      ...new Set([...projectApplication.sourceOfTruth, ...tenantChat.sourceOfTruth])
    ],
    totalRequests,
    successfulRequests:
      projectApplication.successfulRequests + tenantChat.successfulRequests,
    failedRequests: projectApplication.failedRequests + tenantChat.failedRequests,
    blockedRequests: projectApplication.blockedRequests + tenantChat.blockedRequests,
    rateLimitedRequests:
      projectApplication.rateLimitedRequests + tenantChat.rateLimitedRequests,
    cancelledRequests:
      (projectApplication.cancelledRequests ?? 0) + (tenantChat.cancelledRequests ?? 0),
    cacheHitRequests,
    cacheEligibleRequests,
    cacheHitRate: safeRate(cacheHitRequests, cacheEligibleRequests),
    exactCacheHitRate: safeRate(cacheHitRequests, cacheEligibleRequests),
    fallbackSuccessCount:
      (projectApplication.fallbackSuccessCount ?? 0) +
      (tenantChat.fallbackSuccessCount ?? 0),
    totalTokens: projectApplication.totalTokens + tenantChat.totalTokens,
    promptTokens: projectApplication.promptTokens + tenantChat.promptTokens,
    completionTokens:
      projectApplication.completionTokens + tenantChat.completionTokens,
    totalCostMicroUsd,
    totalCostUsd: formatMicroUsd(totalCostMicroUsd),
    averageLatencyMs: weightedAverage(
      projectApplication.averageLatencyMs,
      projectApplication.totalRequests,
      tenantChat.averageLatencyMs,
      tenantChat.totalRequests
    ),
    p95LatencyMs: tenantChat.p95LatencyMs,
    latencyBySurface: {
      projectApplicationP95Ms: projectApplication.p95LatencyMs,
      tenantChatP95Ms: tenantChat.p95LatencyMs
    },
    routingSummaries: mergeKeyedRows(
      projectApplication.routingSummaries,
      tenantChat.routingSummaries,
      (row) => `${row.category}\u0000${row.difficulty}\u0000${row.routingReason}`,
      "requestCount"
    ),
    statusCounts: mergeCountRecords(
      projectApplication.statusCounts,
      tenantChat.statusCounts
    ),
    costByModel: mergeCostByModel(
      projectApplication.costByModel,
      tenantChat.costByModel
    ),
    dataFreshness: {
      source: "gateway+tenant-chat-projector",
      recordCount:
        projectApplication.dataFreshness.recordCount +
        tenantChat.dataFreshness.recordCount,
      lastLogCreatedAt: earliestIso(
        projectApplication.dataFreshness.lastLogCreatedAt,
        tenantChat.dataFreshness.lastLogCreatedAt
      ),
      generatedAt: latestIso(
        projectApplication.dataFreshness.generatedAt,
        tenantChat.dataFreshness.generatedAt
      )
    },
    queryBudget:
      tenantChat.queryBudget?.status === "partial"
        ? tenantChat.queryBudget
        : projectApplication.queryBudget,
    breakdowns: {
      byApplication: projectApplication.breakdowns?.byApplication ?? [],
      byBudgetScope: [
        ...(projectApplication.breakdowns?.byBudgetScope ?? []),
        ...(tenantChat.breakdowns?.byBudgetScope ?? [])
      ],
      byProviderModel: mergeKeyedRows(
        projectApplication.breakdowns?.byProviderModel ?? [],
        tenantChat.breakdowns?.byProviderModel ?? [],
        (row) => `${row.provider}\u0000${row.model}`,
        "requestCount"
      ),
      bySafetyOutcome: mergeOutcomeRows(
        projectApplication.breakdowns?.bySafetyOutcome ?? [],
        tenantChat.breakdowns?.bySafetyOutcome ?? []
      ),
      byCacheOutcome: mergeOutcomeRows(
        projectApplication.breakdowns?.byCacheOutcome ?? [],
        tenantChat.breakdowns?.byCacheOutcome ?? []
      ),
      byFallbackOutcome: mergeOutcomeRows(
        projectApplication.breakdowns?.byFallbackOutcome ?? [],
        tenantChat.breakdowns?.byFallbackOutcome ?? []
      ),
      byTerminalStatus: mergeOutcomeRows(
        projectApplication.breakdowns?.byTerminalStatus ?? [],
        tenantChat.breakdowns?.byTerminalStatus ?? []
      )
    },
    notes: [...projectApplication.notes, ...tenantChat.notes]
  };
}

export function toTenantChatCostOverTime(
  series: TenantChatCostSeries
): CostOverTimeSummary {
  const points = series.points.map((point) => ({
    bucket: point.periodStart,
    label: formatBucketLabel(point.periodStart, series.bucket),
    spendUsd: point.confirmedCostMicroUsd / 1_000_000
  }));
  return {
    averageSpendUsd: average(points.map((point) => point.spendUsd)),
    bucketInterval: series.bucket,
    generatedAt: series.generatedAt,
    period: series.bucket === "1d" ? "day" : "hour",
    points
  };
}

export function mergeCostOverTime(
  projectApplication: CostOverTimeSummary,
  tenantChat: CostOverTimeSummary
): CostOverTimeSummary {
  const points = new Map(projectApplication.points.map((point) => [point.bucket, { ...point }]));
  for (const point of tenantChat.points) {
    const existing = points.get(point.bucket);
    points.set(point.bucket, {
      bucket: point.bucket,
      label: existing?.label ?? point.label,
      spendUsd: (existing?.spendUsd ?? 0) + point.spendUsd
    });
  }
  const sorted = [...points.values()].sort((left, right) =>
    left.bucket.localeCompare(right.bucket)
  );
  return {
    averageSpendUsd: average(sorted.map((point) => point.spendUsd)),
    bucketInterval: projectApplication.bucketInterval ?? tenantChat.bucketInterval,
    expectedBucketCount: Math.max(
      projectApplication.expectedBucketCount ?? 0,
      tenantChat.expectedBucketCount ?? 0
    ) || undefined,
    generatedAt: latestIso(projectApplication.generatedAt, tenantChat.generatedAt),
    period: projectApplication.period,
    points: sorted
  };
}

function mergeCountRecords(
  left: Record<string, number>,
  right: Record<string, number>
) {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    result[key] = (result[key] ?? 0) + value;
  }
  return result;
}

function mergeOutcomeRows(
  left: Array<{ outcome: string; requestCount: number }>,
  right: Array<{ outcome: string; requestCount: number }>
) {
  return Object.entries(
    [...left, ...right].reduce<Record<string, number>>((result, row) => {
      result[row.outcome] = (result[row.outcome] ?? 0) + row.requestCount;
      return result;
    }, {})
  ).map(([outcome, requestCount]) => ({ outcome, requestCount }));
}

function mergeCostByModel(
  left: DashboardOverview["costByModel"],
  right: DashboardOverview["costByModel"]
) {
  const rows = new Map<string, DashboardOverview["costByModel"][number]>();
  for (const row of [...left, ...right]) {
    const key = `${row.provider}\u0000${row.model}`;
    const existing = rows.get(key);
    const costMicroUsd = (existing?.costMicroUsd ?? 0) + row.costMicroUsd;
    rows.set(key, {
      provider: row.provider,
      model: row.model,
      requestCount: (existing?.requestCount ?? 0) + row.requestCount,
      totalTokens: (existing?.totalTokens ?? 0) + row.totalTokens,
      costMicroUsd,
      costUsd: formatMicroUsd(costMicroUsd)
    });
  }
  return [...rows.values()];
}

function mergeKeyedRows<T extends Record<K, number>, K extends keyof T>(
  left: T[],
  right: T[],
  keyOf: (row: T) => string,
  countKey: K
): T[] {
  const rows = new Map<string, T>();
  for (const row of [...left, ...right]) {
    const key = keyOf(row);
    const existing = rows.get(key);
    rows.set(key, {
      ...(existing ?? row),
      [countKey]: ((existing?.[countKey] as number | undefined) ?? 0) + row[countKey]
    });
  }
  return [...rows.values()];
}

function weightedAverage(left: number, leftCount: number, right: number, rightCount: number) {
  const total = leftCount + rightCount;
  return total > 0 ? (left * leftCount + right * rightCount) / total : 0;
}

function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function average(values: number[]) {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function latestIso(left: string, right: string) {
  return new Date(left).getTime() >= new Date(right).getTime() ? left : right;
}

function earliestIso(left: string, right: string) {
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

function formatMicroUsd(value: number) {
  return `$${(value / 1_000_000).toFixed(6)}`;
}

function formatBucketLabel(value: string, interval: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    day: interval === "1d" ? "numeric" : undefined,
    hour: interval === "1d" ? undefined : "2-digit",
    hour12: false,
    minute: interval === "1d" ? undefined : "2-digit",
    month: interval === "1d" ? "short" : undefined,
    second: interval === "7s" ? "2-digit" : undefined,
    timeZone: "Asia/Seoul"
  }).format(date);
}
