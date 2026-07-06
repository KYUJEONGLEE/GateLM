import "server-only";

import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";

export type ProjectMonthlyCost = {
  costMicroUsd: number;
  projectId: string;
  requestCount: number;
};

export type ProjectMonthlyCostReport = {
  generatedAt: string | null;
  loadError: string | null;
  projectCosts: ProjectMonthlyCost[];
  source: "gateway" | "unavailable";
};

type LiveCostReportResponse = {
  data?: {
    breakdowns?: {
      byProject?: ProjectMonthlyCostResponseRow[];
    };
    generatedAt?: string;
  };
};

type ProjectMonthlyCostResponseRow = {
  costMicroUsd?: number | string;
  projectId?: string;
  requestCount?: number | string;
};

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
    requestCount: normalizeNonNegativeNumber(row.requestCount)
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
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}

function normalizeNonNegativeNumber(value: number | string | undefined) {
  const parsed = typeof value === "string" ? Number(value) : value;

  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, parsed);
}
