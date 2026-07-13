import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentConsoleAuthForCookieHeader,
  isProjectScopedForTenant,
  resolveProjectIdForConsoleAuth
} from "@/lib/auth/current-console-auth";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getTenantChatCostSeries } from "@/lib/control-plane/tenant-chat-observability-client";
import {
  type DashboardSurface,
  mergeCostOverTime,
  toTenantChatCostOverTime
} from "@/lib/dashboard/unified-dashboard";
import { getLiveCostOverTime } from "@/lib/gateway/live-cost-report";
import {
  getDashboardLiveRange,
  type LiveDashboardRange
} from "@/lib/gateway/live-dashboard-overview";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const tenantId = query.get("tenantId")?.trim();

  if (!tenantId) {
    return NextResponse.json(
      { error: "tenantId is required" },
      { status: 400 }
    );
  }

  const requestedProjectId = optionalQueryValue(query, "projectId");
  const [auth, projectsModel] = await Promise.all([
    getCurrentConsoleAuthForCookieHeader(request.headers.get("cookie")),
    getProjectsModel(tenantId)
  ]);
  const effectiveProjectId = resolveProjectIdForConsoleAuth({
    auth,
    projects: projectsModel.projects,
    requestedProjectId,
    routeTenantId: tenantId
  });

  if (effectiveProjectId === null) {
    return NextResponse.json({ error: "Project access denied" }, { status: 403 });
  }

  const range = normalizeRange(query.get("range"));
  const projectScoped = isProjectScopedForTenant(auth, tenantId);
  const requestedSurface = normalizeSurface(query.get("surface"));
  const hasProjectFilters = Boolean(
    effectiveProjectId ||
    requestedProjectId ||
    optionalQueryValue(query, "budgetScopeId") ||
    optionalQueryValue(query, "budgetScopeType") ||
    optionalQueryValue(query, "resolvedBy")
  );
  const surface: DashboardSurface =
    projectScoped || hasProjectFilters
      ? "project_application"
      : requestedSurface;
  const liveRange = getDashboardLiveRange(range);

  const [projectApplicationSummary, tenantChatSeries] = await Promise.all([
    surface === "tenant_chat"
      ? Promise.resolve(undefined)
      : getLiveCostOverTime(tenantId, {
          budgetScopeId: optionalQueryValue(query, "budgetScopeId"),
          budgetScopeType: optionalQueryValue(query, "budgetScopeType"),
          projectId: effectiveProjectId ?? requestedProjectId,
          range,
          resolvedBy: optionalQueryValue(query, "resolvedBy")
        }),
    surface === "project_application"
      ? Promise.resolve(undefined)
      : getTenantChatCostSeries(
          tenantId,
          liveRange.from,
          liveRange.to,
          costBucketForRange(range)
        )
  ]);
  const tenantChatSummary = tenantChatSeries
    ? toTenantChatCostOverTime(tenantChatSeries)
    : undefined;
  const summary =
    surface === "project_application"
      ? projectApplicationSummary
      : surface === "tenant_chat"
        ? tenantChatSummary
        : projectApplicationSummary && tenantChatSummary
          ? mergeCostOverTime(projectApplicationSummary, tenantChatSummary)
          : projectApplicationSummary ?? tenantChatSummary;

  if (!summary) {
    return NextResponse.json(
      { error: "Failed to load cost data" },
      { status: 502 }
    );
  }

  return NextResponse.json({ data: summary });
}

function normalizeSurface(value: string | null): DashboardSurface {
  if (value === "project_application" || value === "tenant_chat") {
    return value;
  }
  return "all";
}

function costBucketForRange(range: LiveDashboardRange) {
  if (range === "5m") return "7s" as const;
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
