import "server-only";

import {
  buildAnalyticsV5Evidence,
  type AnalyticsV5ModelBucket,
  type AnalyticsV5Evidence,
  type AnalyticsV5PolicyImpactEvidence
} from "@/features/analytics/analytics-v5-evidence";
import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import { type LiveAnalyticsRange } from "@/lib/gateway/live-analytics-performance";
import { getDashboardLiveRange } from "@/lib/gateway/live-dashboard-overview";
import {
  getGatewayObservabilityHeaders,
  getLiveGatewayConfig
} from "@/lib/gateway/live-gateway-config";

type LiveAnalyticsPolicyImpactResponse = {
  data?: {
    dataFreshness?: {
      generatedAt?: string;
      lastLogCreatedAt?: string | null;
    };
    metricCoverage?: Array<{
      knownRequestCount?: number | string;
      metric?: string;
      status?: string;
      surface?: string;
      unknownRequestCount?: number | string;
    }>;
    modelBuckets?: Array<{
      model?: string;
      periodStart?: string;
      provider?: string;
      requestCount?: number | string;
      surface?: string;
    }>;
    policyOutcomes?: Array<{
      outcome?: string;
      requestCount?: number | string;
      surface?: string;
    }>;
    routingRoles?: Array<{
      requestCount?: number | string;
      role?: string;
      scheme?: string;
      surface?: string;
    }>;
    totals?: {
      avoidedProviderCallRequests?: number | string;
      costMicroUsd?: number | string;
      highPerformanceEligibleRequests?: number | string;
      highPerformanceRequests?: number | string;
      knownSavedCostMicroUsd?: number | string;
      protectedRequests?: number | string;
      requestCount?: number | string;
      savedCostMicroUsd?: number | string | null;
    };
    usageSources?: Array<{
      costMicroUsd?: number | string;
      projectId?: string | null;
      requestCount?: number | string;
      surface?: string;
    }>;
  };
};

export async function getLiveAnalyticsV5Evidence(
  tenantId: string,
  filters: { projectId?: string; range: LiveAnalyticsRange }
): Promise<AnalyticsV5Evidence | undefined> {
  const config = getLiveGatewayConfig();
  const range = getDashboardLiveRange(filters.range);
  const query = new URLSearchParams({
    from: range.from,
    period: filters.range === "1w" ? "day" : "hour",
    tenantId: toGatewayTenantId(tenantId),
    to: range.to
  });
  appendOptionalQuery(query, "projectId", filters.projectId);

  const response = await fetch(`${config.baseUrl}/api/analytics/policy-impact?${query.toString()}`, {
    headers: getGatewayObservabilityHeaders(`request_web_analytics_policy_impact_${Date.now()}`),
    cache: "no-store"
  }).catch(() => undefined);

  if (!response?.ok) {
    return undefined;
  }

  const payload = (await response.json().catch(() => ({}))) as LiveAnalyticsPolicyImpactResponse;
  if (!Array.isArray(payload.data?.modelBuckets)) {
    return undefined;
  }

  const records = payload.data.modelBuckets
    .map(toModelBucket)
    .filter((row): row is AnalyticsV5ModelBucket => row !== null);

  const policyImpact = toPolicyImpactEvidence(payload.data, records);
  if (!policyImpact) {
    return undefined;
  }

  return buildAnalyticsV5Evidence(records, {
    from: range.from,
    range: filters.range,
    to: range.to
  }, policyImpact);
}

function toModelBucket(
  row: NonNullable<NonNullable<LiveAnalyticsPolicyImpactResponse["data"]>["modelBuckets"]>[number]
): AnalyticsV5ModelBucket | null {
  const model = row.model?.trim() ?? "";
  const periodStart = row.periodStart?.trim() ?? "";
  const provider = row.provider?.trim() ?? "";
  const requestCount = normalizeNonNegativeNumber(row.requestCount);
  const surface = normalizeSurface(row.surface);

  if (!model || !provider || !periodStart || !surface || !Number.isFinite(Date.parse(periodStart)) || requestCount <= 0) {
    return null;
  }

  return { model, periodStart, provider, requestCount, surface };
}

function toPolicyImpactEvidence(
  data: NonNullable<LiveAnalyticsPolicyImpactResponse["data"]>,
  records: AnalyticsV5ModelBucket[]
): AnalyticsV5PolicyImpactEvidence | null {
  if (!data.totals || !Array.isArray(data.policyOutcomes) ||
      !Array.isArray(data.routingRoles) || !Array.isArray(data.usageSources) ||
      !Array.isArray(data.metricCoverage)) {
    return null;
  }
  const coverage = data.metricCoverage.flatMap((row) => {
    const surface = normalizeSurface(row.surface);
    const status = normalizeCoverageStatus(row.status);
    const metric = row.metric?.trim() ?? "";
    return surface && status && metric ? [{
      knownRequestCount: normalizeNonNegativeNumber(row.knownRequestCount),
      metric,
      status,
      surface,
      unknownRequestCount: normalizeNonNegativeNumber(row.unknownRequestCount)
    }] : [];
  });
  const policyOutcomes = data.policyOutcomes.flatMap((row) => {
    const surface = normalizeSurface(row.surface);
    const outcome = row.outcome?.trim() ?? "";
    const requestCount = normalizeNonNegativeNumber(row.requestCount);
    return surface && outcome && requestCount > 0 ? [{ outcome, requestCount, surface }] : [];
  });
  const routingRoles = data.routingRoles.flatMap((row) => {
    const surface = normalizeSurface(row.surface);
    const scheme = normalizeRoutingScheme(row.scheme);
    const role = row.role?.trim() ?? "";
    const requestCount = normalizeNonNegativeNumber(row.requestCount);
    return surface && scheme && role && requestCount > 0 ? [{ requestCount, role, scheme, surface }] : [];
  });
  const usageSources = data.usageSources.flatMap((row) => {
    const surface = normalizeSurface(row.surface);
    const requestCount = normalizeNonNegativeNumber(row.requestCount);
    return surface && requestCount > 0 ? [{
      costMicroUsd: normalizeNonNegativeNumber(row.costMicroUsd),
      projectId: row.projectId?.trim() || null,
      requestCount,
      surface
    }] : [];
  });
  const totals = data.totals;
  const savedCostMicroUsd = totals.savedCostMicroUsd === null || totals.savedCostMicroUsd === undefined
    ? null
    : normalizeNonNegativeNumber(totals.savedCostMicroUsd);
  const lastLogCreatedAt = data.dataFreshness?.lastLogCreatedAt?.trim() || null;
  const generatedAt = data.dataFreshness?.generatedAt?.trim() || null;
  const hasPartialCoverage = coverage.some((row) => row.status !== "complete");

  return {
    avoidedProviderCallRequests: normalizeNonNegativeNumber(totals.avoidedProviderCallRequests),
    coverage,
    dataAsOf: lastLogCreatedAt ?? generatedAt,
    dataState: hasPartialCoverage ? "partial" : "live",
    highPerformanceEligibleRequests: normalizeNonNegativeNumber(totals.highPerformanceEligibleRequests),
    highPerformanceRequests: normalizeNonNegativeNumber(totals.highPerformanceRequests),
    knownSavedCostMicroUsd: normalizeNonNegativeNumber(totals.knownSavedCostMicroUsd),
    modelMix: records.map((row) => ({
      model: row.model,
      provider: row.provider,
      requestCount: row.requestCount,
      surface: row.surface ?? "project_application"
    })),
    policyOutcomes,
    protectedRequests: normalizeNonNegativeNumber(totals.protectedRequests),
    routingRoles,
    savedCostMicroUsd,
    totalCostMicroUsd: normalizeNonNegativeNumber(totals.costMicroUsd),
    totalRequests: normalizeNonNegativeNumber(totals.requestCount),
    usageSources
  };
}

function normalizeSurface(value: string | undefined): "project_application" | "tenant_chat" | null {
  return value === "project_application" || value === "tenant_chat" ? value : null;
}

function normalizeCoverageStatus(value: string | undefined): "complete" | "partial" | "unavailable" | null {
  return value === "complete" || value === "partial" || value === "unavailable" ? value : null;
}

function normalizeRoutingScheme(value: string | undefined): "difficulty" | "route_tier" | null {
  return value === "difficulty" || value === "route_tier" ? value : null;
}

function normalizeNonNegativeNumber(value: number | string | undefined) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
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
