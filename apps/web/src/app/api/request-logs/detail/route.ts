import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentConsoleAuthForCookieHeader,
  getVisibleProjectsForConsoleAuth,
  resolveProjectIdForConsoleAuth
} from "@/lib/auth/current-console-auth";
import { hasConsoleTenantAccess } from "@/lib/auth/console-tenant-access";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getLiveGatewayRequestDetail } from "@/lib/gateway/live-request-detail";
import { getLiveGatewayRequestLogs } from "@/lib/gateway/live-request-logs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const tenantId = optionalQueryValue(query, "tenantId");
  const requestId = optionalQueryValue(query, "requestId");

  if (!tenantId || !requestId) {
    return NextResponse.json({ error: "tenantId and requestId are required" }, { status: 400 });
  }

  const requestedProjectId = optionalQueryValue(query, "projectId");
  const auth = await getCurrentConsoleAuthForCookieHeader(request.headers.get("cookie"));

  if (!auth.isAuthenticated) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasConsoleTenantAccess(auth, tenantId)) {
    return NextResponse.json({ error: "Tenant access denied" }, { status: 403 });
  }

  const projectsModel = await getProjectsModel(tenantId);
  const effectiveProjectId = resolveProjectIdForConsoleAuth({
    auth,
    projects: projectsModel.projects,
    requestedProjectId,
    routeTenantId: tenantId
  });

  if (effectiveProjectId === null) {
    return NextResponse.json({ error: "Project access denied" }, { status: 403 });
  }

  const scopedProjectIds = getVisibleProjectsForConsoleAuth(projectsModel.projects, auth, tenantId)
    .map((project) => project.id)
    .filter(Boolean);
  const projectId = effectiveProjectId ?? (await findProjectIdForRequest({
    projectIds: scopedProjectIds,
    requestId,
    tenantId
  }));

  if (!projectId) {
    return NextResponse.json({ error: "Request log was not found" }, { status: 404 });
  }

  const detail = await getLiveGatewayRequestDetail(requestId, {
    projectId,
    tenantId
  });

  if (!detail) {
    return NextResponse.json({ error: "Request log was not found" }, { status: 404 });
  }

  const projectName = projectsModel.projects.find((project) => project.id === detail.projectId)?.name ?? null;

  return NextResponse.json({
    data: {
      ...detail,
      projectName
    }
  });
}

function optionalQueryValue(query: URLSearchParams, key: string) {
  const value = query.get(key)?.trim();
  return value ? value : undefined;
}

async function findProjectIdForRequest({
  projectIds,
  requestId,
  tenantId
}: {
  projectIds: string[];
  requestId: string;
  tenantId: string;
}) {
  const records = await getLiveGatewayRequestLogs({
    limit: 1,
    projectIds,
    requestId,
    tenantId
  });

  return records?.[0]?.projectId;
}
