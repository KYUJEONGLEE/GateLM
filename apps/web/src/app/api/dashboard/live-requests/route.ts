import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentConsoleAuthForCookieHeader,
  isProjectScopedForTenant,
  resolveProjectIdForConsoleAuth
} from "@/lib/auth/current-console-auth";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import {
  getTenantChatLiveRequests,
  mergeLiveRequestPayloads
} from "@/lib/dashboard/tenant-chat-live-requests";
import type { DashboardSurface } from "@/lib/dashboard/unified-dashboard";
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

  const projects = projectsModel.projects;
  const range = normalizeRange(query.get("range"));
  const status = normalizeStatus(query.get("status"));
  const model = optionalQueryValue(query, "model");
  const hasProjectFilters = Boolean(
    effectiveProjectId ||
    requestedProjectId ||
    optionalQueryValue(query, "budgetScopeId") ||
    optionalQueryValue(query, "budgetScopeType") ||
    optionalQueryValue(query, "resolvedBy")
  );
  const surface: DashboardSurface =
    isProjectScopedForTenant(auth, tenantId) || hasProjectFilters
      ? "project_application"
      : normalizeSurface(query.get("surface"));
  const [projectApplicationPayload, tenantChatPayload] = await Promise.all([
    surface === "tenant_chat"
      ? Promise.resolve(undefined)
      : getLiveOverviewRequests(
          tenantId,
          {
            budgetScopeId: optionalQueryValue(query, "budgetScopeId"),
            budgetScopeType: optionalQueryValue(query, "budgetScopeType"),
            model,
            projectId: effectiveProjectId ?? requestedProjectId,
            range,
            resolvedBy: optionalQueryValue(query, "resolvedBy"),
            status
          },
          {
            projectIds: projects.map((project) => project.id).filter(Boolean),
            projectNameSource: projectsModel.source,
            projects
          }
        ),
    surface === "project_application"
      ? Promise.resolve(undefined)
      : getTenantChatLiveRequests(tenantId, { model, range, status })
  ]);
  const payload =
    surface === "project_application"
      ? projectApplicationPayload
      : surface === "tenant_chat"
        ? tenantChatPayload
        : projectApplicationPayload && tenantChatPayload
          ? mergeLiveRequestPayloads(projectApplicationPayload, tenantChatPayload)
          : projectApplicationPayload ?? tenantChatPayload;

  if (!payload) {
    return NextResponse.json({ error: "Failed to load live requests" }, { status: 502 });
  }

  return NextResponse.json({ data: payload });
}

function normalizeSurface(value: string | null): DashboardSurface {
  if (value === "project_application" || value === "tenant_chat") {
    return value;
  }
  return "all";
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
