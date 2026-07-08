import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentConsoleAuthForCookieHeader,
  resolveProjectIdForConsoleAuth
} from "@/lib/auth/current-console-auth";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getLiveCostOverTime } from "@/lib/gateway/live-cost-report";
import type { LiveDashboardRange } from "@/lib/gateway/live-dashboard-overview";

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

  const summary = await getLiveCostOverTime(tenantId, {
    budgetScopeId: optionalQueryValue(query, "budgetScopeId"),
    budgetScopeType: optionalQueryValue(query, "budgetScopeType"),
    projectId: effectiveProjectId ?? requestedProjectId,
    range: normalizeRange(query.get("range")),
    resolvedBy: optionalQueryValue(query, "resolvedBy")
  });

  if (!summary) {
    return NextResponse.json(
      { error: "Failed to load cost data" },
      { status: 502 }
    );
  }

  return NextResponse.json({ data: summary });
}

function optionalQueryValue(query: URLSearchParams, key: string) {
  const value = query.get(key)?.trim();
  return value ? value : undefined;
}

function normalizeRange(value: string | null): LiveDashboardRange {
  if (value === "1h" || value === "1d" || value === "1w") {
    return value;
  }

  return "15m";
}
