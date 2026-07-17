import { NextResponse } from "next/server";

import {
  getCurrentConsoleAuthForCookieHeader,
  isTenantAdminForTenant,
  resolveConsoleTenantIdForAuth,
} from "@/lib/auth/current-console-auth";
import {
  getTenantRagKnowledgeBaseSettings,
  updateTenantRagKnowledgeBaseSettings,
} from "@/lib/control-plane/rag-knowledge-base-client";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorized = await authorizeRequest(request);
  if (authorized instanceof NextResponse) return authorized;
  return toResponse(
    await getTenantRagKnowledgeBaseSettings(
      authorized.controlPlaneTenantId,
      authorized.requestOptions,
    ),
  );
}

export async function PATCH(request: Request) {
  const authorized = await authorizeRequest(request);
  if (authorized instanceof NextResponse) return authorized;

  const body = await request.json().catch(() => null);
  if (!isExactUpdateBody(body)) {
    return NextResponse.json(
      { error: "A boolean enabled value is required." },
      { status: 400 },
    );
  }
  return toResponse(
    await updateTenantRagKnowledgeBaseSettings(
      authorized.controlPlaneTenantId,
      body.enabled,
      authorized.requestOptions,
    ),
  );
}

async function authorizeRequest(request: Request) {
  const routeTenantId = new URL(request.url).searchParams
    .get("tenantId")
    ?.trim();
  if (!routeTenantId || routeTenantId.length > 200) {
    return NextResponse.json(
      { error: "tenantId is required." },
      { status: 400 },
    );
  }
  const cookieHeader = request.headers.get("cookie");
  const auth = await getCurrentConsoleAuthForCookieHeader(cookieHeader);
  if (!auth.isAuthenticated) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }
  if (!isTenantAdminForTenant(auth, routeTenantId)) {
    return NextResponse.json(
      { error: "Tenant administrator access required." },
      { status: 403 },
    );
  }
  return {
    controlPlaneTenantId: resolveConsoleTenantIdForAuth(auth, routeTenantId),
    requestOptions: { cookieHeader },
  };
}

function isExactUpdateBody(value: unknown): value is { enabled: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 1 && typeof record.enabled === "boolean"
  );
}

function toResponse(
  result:
    | {
        data: {
          tenantEnabled: boolean;
          globalEnabled: boolean;
          effectiveEnabled: boolean;
        };
        ok: true;
        status: number;
      }
    | { error: string; ok: false; status: number },
) {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status > 0 ? result.status : 502 },
    );
  }
  return NextResponse.json(result.data, { status: result.status });
}
