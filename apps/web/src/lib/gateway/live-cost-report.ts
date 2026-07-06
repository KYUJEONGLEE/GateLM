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

type LiveCostReportResponse = {
  data?: {
    buckets?: Array<{
      costMicroUsd?: number;
      costUsd?: string;
      periodStart?: string;
      requestCount?: number;
    }>;
    generatedAt?: string;
    period?: string;
  };
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
  const gatewayTenantId = toGatewayTenantId(tenantId);
  const query = new URLSearchParams({
    from: liveRange.from,
    period,
    tenantId: gatewayTenantId,
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

function costReportPeriodForRange(range: LiveDashboardRange | undefined): "hour" | "day" {
  return range === "1w" ? "day" : "hour";
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

function toCostOverTimeSummary(
  data: LiveCostReportResponse["data"],
  period: "hour" | "day"
): CostOverTimeSummary | undefined {
  if (!data?.buckets) {
    return undefined;
  }

  const points = data.buckets
    .filter((bucket) => bucket.periodStart)
    .map((bucket) => {
      const bucketStart = bucket.periodStart ?? "";
      const spendUsd = microUsdToUsd(bucket.costMicroUsd ?? 0);

      return {
        bucket: bucketStart,
        label: formatCostBucketLabel(bucketStart, period),
        spendUsd
      };
    });
  const totalSpendUsd = points.reduce((sum, point) => sum + point.spendUsd, 0);

  return {
    averageSpendUsd: points.length > 0 ? totalSpendUsd / points.length : 0,
    generatedAt: data.generatedAt ?? new Date().toISOString(),
    period,
    points
  };
}

function microUsdToUsd(value: number) {
  return value / 1_000_000;
}

function formatCostBucketLabel(value: string, period: "hour" | "day") {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  if (period === "hour") {
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
