import { NextResponse } from "next/server";
import {
  getCurrentConsoleAuth,
  isProjectScopedForTenant,
  isTenantAdminForTenant,
  resolveProjectIdForConsoleAuth
} from "@/lib/auth/current-console-auth";
import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import {
  createDashboardAiInsights,
  normalizeAiInsightsRequest
} from "@/lib/dashboard/ai-insights-service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const insightRequest = normalizeAiInsightsRequest(body);

  if (!insightRequest) {
    return NextResponse.json(
      { error: "Invalid AI insights request" },
      { status: 400 }
    );
  }

  const tenantId = insightRequest.tenantId?.trim() || getControlPlaneTenantId();
  const requestedProjectId = insightRequest.projectId?.trim() || undefined;
  const [auth, projectsModel] = await Promise.all([
    getCurrentConsoleAuth(request.headers.get("cookie")),
    getProjectsModel(tenantId)
  ]);
  const hasTenantAdminAccess = isTenantAdminForTenant(auth, tenantId);
  const hasProjectScopedAccess = isProjectScopedForTenant(auth, tenantId);

  if (!auth.isAuthenticated || (!hasTenantAdminAccess && !hasProjectScopedAccess)) {
    return NextResponse.json({ error: "AI insights access denied" }, { status: 403 });
  }

  if (hasProjectScopedAccess && !requestedProjectId) {
    return NextResponse.json({ error: "AI insights project access denied" }, { status: 403 });
  }

  const effectiveProjectId = resolveProjectIdForConsoleAuth({
    auth,
    projects: projectsModel.projects,
    requestedProjectId,
    routeTenantId: tenantId
  });

  if (effectiveProjectId === null) {
    return NextResponse.json({ error: "AI insights project access denied" }, { status: 403 });
  }

  const insight = await createDashboardAiInsights({
    ...insightRequest,
    projectId: effectiveProjectId ?? requestedProjectId ?? null,
    tenantId
  });

  return NextResponse.json(insight);
}
