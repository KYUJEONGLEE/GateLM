import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentConsoleAuthForCookieHeader,
  isProjectScopedForTenant,
  resolveProjectIdForConsoleAuth
} from "@/lib/auth/current-console-auth";
import { hasConsoleTenantAccess } from "@/lib/auth/console-tenant-access";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import {
  getTenantChatCostSeries,
  getTenantChatDashboard
} from "@/lib/control-plane/tenant-chat-observability-client";
import {
  type DashboardSurface,
  mergeCostOverTime,
  selectDashboardSurfaceOverview,
  toTenantChatCostOverTime,
  toTenantChatDashboardOverview
} from "@/lib/dashboard/unified-dashboard";
import {
  getTenantChatLiveRequests,
  mergeLiveRequestPayloads
} from "@/lib/dashboard/tenant-chat-live-requests";
import type { LiveDashboardSnapshot } from "@/lib/dashboard/live-dashboard-snapshot";
import { getLiveCostOverTime } from "@/lib/gateway/live-cost-report";
import {
  getDashboardLiveRange,
  getLiveDashboardOverview,
  type LiveDashboardOverviewFilters,
  type LiveDashboardRange
} from "@/lib/gateway/live-dashboard-overview";
import {
  getLiveOverviewRequests,
  getLiveRequestProviderDirectory
} from "@/lib/gateway/live-overview-requests";
import type { LiveRequestStatusFilter } from "@/lib/gateway/live-requests-types";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const tenantId = query.get("tenantId")?.trim();

  if (!tenantId) {
    return jsonError("tenantId is required", 400);
  }

  const requestedProjectId = optionalQueryValue(query, "projectId");
  const auth = await getCurrentConsoleAuthForCookieHeader(request.headers.get("cookie"));

  if (!auth.isAuthenticated) {
    return jsonError("Unauthorized", 401);
  }

  if (!hasConsoleTenantAccess(auth, tenantId)) {
    return jsonError("Tenant access denied", 403);
  }

  const projectsModel = await getProjectsModel(tenantId);
  const effectiveProjectId = resolveProjectIdForConsoleAuth({
    auth,
    projects: projectsModel.projects,
    requestedProjectId,
    routeTenantId: tenantId
  });

  if (effectiveProjectId === null) {
    return jsonError("Project access denied", 403);
  }

  const range = normalizeRange(query.get("range"));
  const liveStatus = normalizeStatus(query.get("status"));
  const liveModel = optionalQueryValue(query, "model");
  const projectFilters: LiveDashboardOverviewFilters = {
    budgetScopeId: optionalQueryValue(query, "budgetScopeId"),
    budgetScopeType: optionalQueryValue(query, "budgetScopeType"),
    projectId: effectiveProjectId ?? requestedProjectId,
    range,
    resolvedBy: optionalQueryValue(query, "resolvedBy")
  };
  const hasProjectFilters = Boolean(
    projectFilters.projectId ||
    projectFilters.budgetScopeId ||
    projectFilters.budgetScopeType ||
    projectFilters.resolvedBy
  );
  const surface: DashboardSurface =
    isProjectScopedForTenant(auth, tenantId) || hasProjectFilters
      ? "project_application"
      : normalizeSurface(query.get("surface"));
  const liveRange = getDashboardLiveRange(range);
  const monthToDateRange = getMonthToDateRange();
  const projects = projectsModel.projects;
  const providerDirectoryPromise = getLiveRequestProviderDirectory(tenantId);

  const [
    projectApplicationOverview,
    tenantChatDashboard,
    projectApplicationCost,
    tenantChatCostSeries,
    projectApplicationLiveRequests,
    tenantChatLiveRequests,
    projectApplicationMonthToDate,
    tenantChatMonthToDate
  ] = await Promise.all([
    surface === "tenant_chat"
      ? Promise.resolve(undefined)
      : getLiveDashboardOverview(tenantId, projectFilters),
    surface === "project_application"
      ? Promise.resolve(undefined)
      : getTenantChatDashboard(tenantId, liveRange.from, liveRange.to),
    surface === "tenant_chat"
      ? Promise.resolve(undefined)
      : getLiveCostOverTime(tenantId, projectFilters),
    surface === "project_application"
      ? Promise.resolve(undefined)
      : getTenantChatCostSeries(
          tenantId,
          liveRange.from,
          liveRange.to,
          costBucketForRange(range)
        ),
    surface === "tenant_chat"
      ? Promise.resolve(undefined)
      : providerDirectoryPromise.then((providerDirectory) =>
          getLiveOverviewRequests(
            tenantId,
            { ...projectFilters, model: liveModel, status: liveStatus },
            {
              projectIds: projects.map((project) => project.id).filter(Boolean),
              projectNameSource: projectsModel.source,
              projects,
              providerDirectory
            }
          )
        ),
    surface === "project_application"
      ? Promise.resolve(undefined)
      : providerDirectoryPromise.then((providerDirectory) =>
          getTenantChatLiveRequests(
            tenantId,
            {
              model: liveModel,
              range,
              status: liveStatus
            },
            { providerDirectory }
          )
        ),
    surface === "tenant_chat"
      ? Promise.resolve(undefined)
      : getLiveCostOverTime(tenantId, {
          ...projectFilters,
          from: monthToDateRange.from,
          range: "1w",
          to: monthToDateRange.to
        }),
    surface === "project_application"
      ? Promise.resolve(undefined)
      : getTenantChatDashboard(
          tenantId,
          monthToDateRange.from,
          monthToDateRange.to
        )
  ]);

  const tenantChatOverview = tenantChatDashboard
    ? toTenantChatDashboardOverview(tenantId, tenantChatDashboard)
    : undefined;
  const overview = selectDashboardSurfaceOverview(
    surface,
    projectApplicationOverview,
    tenantChatOverview,
    { tenantChatNotConfigured: tenantChatDashboard === null }
  );
  const tenantChatCost = tenantChatCostSeries
    ? toTenantChatCostOverTime(tenantChatCostSeries)
    : undefined;
  const costOverTime = selectSurfaceValue(
    surface,
    projectApplicationCost,
    tenantChatCost,
    mergeCostOverTime
  );
  const liveRequests = selectSurfaceValue(
    surface,
    projectApplicationLiveRequests,
    tenantChatLiveRequests,
    mergeLiveRequestPayloads
  );

  if (!overview || !costOverTime || !liveRequests) {
    return jsonError("Failed to load dashboard snapshot", 502);
  }

  const projectMonthCostMicroUsd =
    (projectApplicationMonthToDate?.points ?? []).reduce(
      (sum, point) => sum + point.spendUsd * 1_000_000,
      0
    );
  const tenantChatMonthCostMicroUsd =
    tenantChatMonthToDate?.usage?.confirmedCostMicroUsd ?? 0;
  const hasMonthToDateData =
    projectApplicationMonthToDate !== undefined ||
    (tenantChatMonthToDate !== undefined && tenantChatMonthToDate !== null);
  const snapshot: LiveDashboardSnapshot = {
    costOverTime,
    generatedAt: new Date().toISOString(),
    liveRequests,
    monthToDateCostMicroUsd: hasMonthToDateData
      ? projectMonthCostMicroUsd + tenantChatMonthCostMicroUsd
      : overview.totalCostMicroUsd,
    overview
  };

  return NextResponse.json({ data: snapshot }, { headers: noStoreHeaders });
}

function selectSurfaceValue<T>(
  surface: DashboardSurface,
  projectApplication: T | undefined,
  tenantChat: T | undefined,
  merge: (left: T, right: T) => T
) {
  if (surface === "project_application") return projectApplication;
  if (surface === "tenant_chat") return tenantChat;
  if (projectApplication && tenantChat) return merge(projectApplication, tenantChat);
  return projectApplication ?? tenantChat;
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { headers: noStoreHeaders, status });
}

function normalizeSurface(value: string | null): DashboardSurface {
  if (value === "project_application" || value === "tenant_chat") {
    return value;
  }
  return "all";
}

function costBucketForRange(range: LiveDashboardRange) {
  if (range === "5m") return "1s" as const;
  if (range === "15m") return "1m" as const;
  if (range === "1h") return "5m" as const;
  if (range === "1d") return "1h" as const;
  return "1d" as const;
}

function optionalQueryValue(query: URLSearchParams, key: string) {
  const value = query.get(key)?.trim();
  return value ? value : undefined;
}

function normalizeRange(value: string | null): LiveDashboardRange {
  if (value === "5m" || value === "15m" || value === "1h" || value === "1d" || value === "1w") {
    return value;
  }
  return "15m";
}

function normalizeStatus(value: string | null): LiveRequestStatusFilter {
  if (value === "success" || value === "failed" || value === "blocked" || value === "rate_limited") {
    return value;
  }
  return "";
}

function getMonthToDateRange() {
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  return { from: from.toISOString(), to: to.toISOString() };
}
