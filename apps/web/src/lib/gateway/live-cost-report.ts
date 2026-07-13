import "server-only";

import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import type { CostOverTimeSummary } from "@/lib/gateway/cost-over-time-types";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";
import { getDashboardLiveRange, type LiveDashboardRange } from "@/lib/gateway/live-dashboard-overview";

export type LiveCostOverTimeFilters = {
  budgetScopeId?: string;
  budgetScopeType?: string;
  from?: string;
  projectId?: string;
  range?: LiveDashboardRange;
  resolvedBy?: string;
  to?: string;
};

export type ProjectMonthlyCost = {
  costMicroUsd: number;
  projectId: string;
  requestCount: number;
  totalTokens: number;
};

export type ProjectMonthlyCostReport = {
  generatedAt: string | null;
  loadError: string | null;
  projectCosts: ProjectMonthlyCost[];
  source: "gateway" | "preview" | "unavailable";
};

type LiveCostReportResponse = {
  data?: {
    breakdowns?: {
      byProject?: ProjectMonthlyCostResponseRow[];
    };
    buckets?: Array<{
      costMicroUsd?: number | string;
      costUsd?: string;
      periodStart?: string;
      requestCount?: number | string;
    }>;
    bucketInterval?: string;
    expectedBucketCount?: number;
    generatedAt?: string;
    period?: string;
  };
};

type ProjectMonthlyCostResponseRow = {
  costMicroUsd?: number | string;
  projectId?: string;
  requestCount?: number | string;
  totalTokens?: number | string;
};

export async function getLiveCostOverTime(
  tenantId: string,
  filters: LiveCostOverTimeFilters = {}
): Promise<CostOverTimeSummary | undefined> {
  const config = getLiveGatewayConfig();
  const liveRange =
    filters.from && filters.to
      ? { from: filters.from, to: filters.to }
      : getDashboardLiveRange(filters.range);
  const period = costReportPeriodForRange(filters.range);
  const query = new URLSearchParams({
    from: liveRange.from,
    period,
    tenantId: toGatewayTenantId(tenantId),
    to: liveRange.to
  });
  appendOptionalQuery(query, "budgetScopeId", filters.budgetScopeId);
  appendOptionalQuery(query, "budgetScopeType", filters.budgetScopeType);
  appendOptionalQuery(query, "projectId", filters.projectId);
  appendOptionalQuery(query, "resolvedBy", filters.resolvedBy);

  const response = await fetch(`${config.baseUrl}/api/reports/costs?${query.toString()}`, {
    headers: {
      "X-GateLM-Request-Id": `request_web_cost_over_time_${Date.now()}`
    },
    cache: "no-store"
  }).catch(() => undefined);

  if (!response?.ok) {
    return undefined;
  }

  const payload = (await response.json().catch(() => ({}))) as LiveCostReportResponse;

  return toCostOverTimeSummary(payload.data, period);
}

export async function getLiveMonthlyProjectCostReport(
  tenantId: string
): Promise<ProjectMonthlyCostReport> {
  const config = getLiveGatewayConfig();
  const { from, to } = getCurrentUtcMonthRange();
  const query = new URLSearchParams({
    from,
    period: "month",
    tenantId: toGatewayTenantId(tenantId),
    to
  });

  const response = await fetch(`${config.baseUrl}/api/reports/costs?${query.toString()}`, {
    cache: "no-store",
    headers: {
      "X-GateLM-Request-Id": `request_web_project_costs_${Date.now()}`
    }
  }).catch(() => undefined);

  if (!response?.ok) {
    return unavailableCostReport("Gateway cost report unavailable.");
  }

  const payload = (await response.json().catch(() => ({}))) as LiveCostReportResponse;
  const rows = payload.data?.breakdowns?.byProject;

  if (!Array.isArray(rows)) {
    return unavailableCostReport("Gateway cost report did not include project breakdowns.");
  }

  return {
    generatedAt: typeof payload.data?.generatedAt === "string" ? payload.data.generatedAt : null,
    loadError: null,
    projectCosts: rows
      .map(toProjectMonthlyCost)
      .filter((row): row is ProjectMonthlyCost => row !== null),
    source: "gateway"
  };
}

function costReportPeriodForRange(range: LiveDashboardRange | undefined): "hour" | "day" {
  return range === "1w" ? "day" : "hour";
}

function appendOptionalQuery(query: URLSearchParams, key: string, value: string | undefined) {
  const normalized = value?.trim();
  if (normalized) {
    query.set(key, normalized);
  }
}

function unavailableCostReport(loadError: string): ProjectMonthlyCostReport {
  return {
    generatedAt: null,
    loadError,
    projectCosts: [],
    source: "unavailable"
  };
}

function toProjectMonthlyCost(row: ProjectMonthlyCostResponseRow): ProjectMonthlyCost | null {
  if (!row || typeof row !== "object" || typeof row.projectId !== "string") {
    return null;
  }

  const projectId = row.projectId.trim();

  if (!projectId) {
    return null;
  }

  return {
    costMicroUsd: normalizeNonNegativeNumber(row.costMicroUsd),
    projectId,
    requestCount: normalizeNonNegativeNumber(row.requestCount),
    totalTokens: normalizeNonNegativeNumber(row.totalTokens)
  };
}

function getCurrentUtcMonthRange() {
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

  return {
    from: from.toISOString(),
    to: to.toISOString()
  };
}

function toGatewayTenantId(tenantId: string) {
  return isUuid(tenantId) ? tenantId : getControlPlaneTenantId();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toCostOverTimeSummary(
  data: LiveCostReportResponse["data"],
  period: "hour" | "day"
): CostOverTimeSummary | undefined {
  if (!data?.buckets) {
    return undefined;
  }

  const bucketInterval = normalizeCostBucketInterval(data.bucketInterval, period);
  const points = data.buckets
    .filter((bucket) => bucket.periodStart)
    .map((bucket) => {
      const bucketStart = bucket.periodStart ?? "";
      const spendUsd = microUsdToUsd(normalizeNonNegativeNumber(bucket.costMicroUsd));

      return {
        bucket: bucketStart,
        label: formatCostBucketLabel(bucketStart, bucketInterval),
        spendUsd
      };
    });
  const totalSpendUsd = points.reduce((sum, point) => sum + point.spendUsd, 0);

  return {
    averageSpendUsd: points.length > 0 ? totalSpendUsd / points.length : 0,
    bucketInterval,
    expectedBucketCount: normalizePositiveInteger(data.expectedBucketCount),
    generatedAt: data.generatedAt ?? new Date().toISOString(),
    period,
    points
  };
}

function microUsdToUsd(value: number) {
  return value / 1_000_000;
}

function formatCostBucketLabel(value: string, bucketInterval: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  if (bucketInterval === "7s") {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
      timeZone: "Asia/Seoul"
    }).format(date);
  }

  if (bucketInterval !== "1d") {
    return new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hourCycle: "h23",
      hour12: false,
      minute: "2-digit",
      timeZone: "Asia/Seoul"
    }).format(date);
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "Asia/Seoul"
  }).format(date);
}

function normalizeCostBucketInterval(value: string | undefined, period: "hour" | "day") {
  if (value === "7s" || value === "1m" || value === "5m" || value === "1h" || value === "1d") {
    return value;
  }

  return period === "day" ? "1d" : "1h";
}

function normalizeNonNegativeNumber(value: number | string | undefined) {
  const parsed = typeof value === "string" ? Number(value) : value;

  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, parsed);
}

function normalizePositiveInteger(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined;
}
