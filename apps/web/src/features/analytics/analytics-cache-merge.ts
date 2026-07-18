import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";

export type AnalyticsCacheSourceId = "project_application" | "tenant_chat";

export type AnalyticsCacheSourceRow = {
  eligibleRequests: number;
  hitRate: number;
  hitRequests: number;
  id: AnalyticsCacheSourceId;
  label: "Project/Application" | "Tenant Chat";
  savedCostMicroUsd: number | null;
  totalRequests: number;
};

export type AnalyticsCacheEvidence = {
  bypassRequests: number;
  eligibleRequests: number;
  hitRate: number;
  hitRequests: number;
  missRequests: number;
  savedCostMicroUsd: number | null;
  sources: AnalyticsCacheSourceRow[];
  totalRequests: number;
};

type CacheOverview = Pick<
  DashboardOverview,
  | "cacheEligibleRequests"
  | "cacheHitRequests"
  | "savedCostMicroUsd"
  | "totalRequests"
>;

export function buildAnalyticsCacheEvidence(input: {
  projectApplicationOverview?: CacheOverview;
  tenantChatOverview?: CacheOverview;
}): AnalyticsCacheEvidence | undefined {
  const sources: AnalyticsCacheSourceRow[] = [];

  if (input.projectApplicationOverview) {
    sources.push(toCacheSource(
      "project_application",
      "Project/Application",
      input.projectApplicationOverview,
      Math.max(0, input.projectApplicationOverview.savedCostMicroUsd)
    ));
  }

  if (input.tenantChatOverview) {
    sources.push(toCacheSource(
      "tenant_chat",
      "Tenant Chat",
      input.tenantChatOverview,
      null
    ));
  }

  if (sources.length === 0) {
    return undefined;
  }

  const totals = sources.reduce(
    (result, source) => ({
      bypassRequests:
        result.bypassRequests + Math.max(0, source.totalRequests - source.eligibleRequests),
      eligibleRequests: result.eligibleRequests + source.eligibleRequests,
      hitRequests: result.hitRequests + source.hitRequests,
      totalRequests: result.totalRequests + source.totalRequests
    }),
    { bypassRequests: 0, eligibleRequests: 0, hitRequests: 0, totalRequests: 0 }
  );

  return {
    ...totals,
    hitRate: safeRate(totals.hitRequests, totals.eligibleRequests),
    missRequests: Math.max(0, totals.eligibleRequests - totals.hitRequests),
    savedCostMicroUsd:
      sources.find((source) => source.id === "project_application")?.savedCostMicroUsd ?? null,
    sources
  };
}

function toCacheSource(
  id: AnalyticsCacheSourceId,
  label: AnalyticsCacheSourceRow["label"],
  overview: CacheOverview,
  savedCostMicroUsd: number | null
): AnalyticsCacheSourceRow {
  const rawHitRequests = Math.max(0, overview.cacheHitRequests);
  const eligibleRequests = Math.max(rawHitRequests, overview.cacheEligibleRequests);
  const totalRequests = Math.max(eligibleRequests, overview.totalRequests);

  return {
    eligibleRequests,
    hitRate: safeRate(rawHitRequests, eligibleRequests),
    hitRequests: rawHitRequests,
    id,
    label,
    savedCostMicroUsd,
    totalRequests
  };
}

function safeRate(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}
