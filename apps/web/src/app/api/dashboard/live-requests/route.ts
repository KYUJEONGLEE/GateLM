import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentConsoleAuth,
  resolveProjectIdForConsoleAuth
} from "@/lib/auth/current-console-auth";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getLiveOverviewRequests } from "@/lib/gateway/live-overview-requests";
import type { LiveDashboardRange } from "@/lib/gateway/live-dashboard-overview";
import type { LiveRequestStatusFilter } from "@/lib/gateway/live-requests-types";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const tenantId = query.get("tenantId")?.trim();

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  const requestedProjectId = optionalQueryValue(query, "projectId");
  const [auth, projectsModel] = await Promise.all([
    getCurrentConsoleAuth(request.headers.get("cookie")),
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

  const payload = await getLiveOverviewRequests(tenantId, {
    budgetScopeId: optionalQueryValue(query, "budgetScopeId"),
    budgetScopeType: optionalQueryValue(query, "budgetScopeType"),
    model: optionalQueryValue(query, "model"),
    projectId: effectiveProjectId ?? requestedProjectId,
    range: normalizeRange(query.get("range")),
    resolvedBy: optionalQueryValue(query, "resolvedBy"),
    status: normalizeStatus(query.get("status"))
  });

  if (!payload) {
    return NextResponse.json({ error: "Failed to load live requests" }, { status: 502 });
  }

  return NextResponse.json({ data: payload });
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
