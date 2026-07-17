import { NextResponse } from "next/server";

import {
  deleteTenantRagDocument,
  getTenantRagDocuments,
} from "@/lib/control-plane/rag-documents-client";
import { getControlPlaneBaseUrl } from "@/lib/control-plane/control-plane-config";
import { buildControlPlaneHeaders } from "@/lib/control-plane/control-plane-request";
import {
  getCurrentConsoleAuthForCookieHeader,
  isTenantAdminForTenant,
  resolveConsoleTenantIdForAuth,
} from "@/lib/auth/current-console-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authorized = await authorizeRequest(request);
  if (authorized instanceof NextResponse) return authorized;

  const result = await getTenantRagDocuments(
    authorized.controlPlaneTenantId,
    authorized.requestOptions,
  );
  return toResponse(result);
}

export async function POST(request: Request) {
  const authorized = await authorizeRequest(request);
  if (authorized instanceof NextResponse) return authorized;

  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) {
    return NextResponse.json(
      { error: "A multipart document upload is required." },
      { status: 400 },
    );
  }

  try {
    const headers = await buildControlPlaneHeaders(authorized.requestOptions, {
      "Content-Type": contentType,
    });
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(authorized.controlPlaneTenantId)}/rag/documents`,
      {
        body: request.body,
        cache: "no-store",
        duplex: "half",
        headers,
        method: "POST",
      } as RequestInit,
    );
    return new NextResponse(response.body, {
      headers: response.headers.get("content-type")
        ? { "Content-Type": response.headers.get("content-type")! }
        : undefined,
      status: response.status,
    });
  } catch {
    return NextResponse.json(
      { error: "Control Plane unavailable." },
      { status: 502 },
    );
  }
}

export async function DELETE(request: Request) {
  const authorized = await authorizeRequest(request);
  if (authorized instanceof NextResponse) return authorized;

  const documentId = new URL(request.url).searchParams
    .get("documentId")
    ?.trim();
  if (!isUuid(documentId)) {
    return NextResponse.json(
      { error: "A valid documentId is required." },
      { status: 400 },
    );
  }
  const result = await deleteTenantRagDocument(
    authorized.controlPlaneTenantId,
    documentId,
    authorized.requestOptions,
  );
  return toResponse(result);
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

function toResponse<T>(
  result:
    | { data: T; ok: true; status: number }
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

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      ),
  );
}
