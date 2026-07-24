import { NextRequest, NextResponse } from "next/server";
import {
  getCurrentConsoleAuthForCookieHeader,
  resolveProjectIdForConsoleAuth
} from "@/lib/auth/current-console-auth";
import { hasConsoleTenantAccess } from "@/lib/auth/console-tenant-access";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getLiveAnalyticsUsage } from "@/lib/gateway/live-analytics-usage";
import type { LiveAnalyticsRange } from "@/lib/gateway/live-analytics-performance";

const noStoreHeaders = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const tenantId = query.get("tenantId")?.trim();
  if (!tenantId) {
    return jsonError("tenantId is required", 400);
  }

  const auth = await getCurrentConsoleAuthForCookieHeader(request.headers.get("cookie"));
  if (!auth.isAuthenticated) {
    return jsonError("Unauthorized", 401);
  }
  if (!hasConsoleTenantAccess(auth, tenantId)) {
    return jsonError("Tenant access denied", 403);
  }

  const range = normalizeRange(query.get("range"));
  if (!range) {
    return jsonError("range must be 15m, 1h, 1d, or 1w", 400);
  }
  const requestedProjectId = optionalQueryValue(query, "projectId");
  const projectsModel = await getProjectsModel(tenantId);
  if (projectsModel.source !== "control-plane") {
    return jsonError("Project scope is unavailable", 503);
  }
  if (
    requestedProjectId &&
    !projectsModel.projects.some((project) => project.id === requestedProjectId)
  ) {
    return jsonError("Project access denied", 403);
  }
  const effectiveProjectId = resolveProjectIdForConsoleAuth({
    auth,
    projects: projectsModel.projects,
    requestedProjectId,
    routeTenantId: tenantId
  });
  if (effectiveProjectId === null) {
    return jsonError("Project access denied", 403);
  }

  const result = await getLiveAnalyticsUsage(tenantId, {
    projectId: effectiveProjectId ?? requestedProjectId,
    range,
    signal: request.signal
  });
  if (result.status === "unavailable") {
    return jsonError("Live usage is unavailable", 503);
  }
  if (result.status === "error") {
    return jsonError("Failed to load live usage", 502);
  }

  return NextResponse.json({ data: result.data }, { headers: noStoreHeaders });
}

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { headers: noStoreHeaders, status });
}

function optionalQueryValue(query: URLSearchParams, key: string) {
  const value = query.get(key)?.trim();
  return value || undefined;
}

function normalizeRange(value: string | null): LiveAnalyticsRange | undefined {
  return value === "15m" || value === "1h" || value === "1d" || value === "1w"
    ? value
    : undefined;
}
