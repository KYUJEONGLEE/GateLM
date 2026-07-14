import { NextResponse } from "next/server";

import {
  activateTenantChatAdminRuntime,
  getTenantChatAdminRuntimeSetup
} from "@/lib/control-plane/tenant-chat-runtime-client";
import {
  getCurrentConsoleAuthForCookieHeader,
  isTenantAdminForTenant,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export async function GET(request: Request) {
  const authorized = await authorizeRequest(request);
  if (authorized instanceof NextResponse) {
    return authorized;
  }

  const result = await getTenantChatAdminRuntimeSetup(
    authorized.controlPlaneTenantId,
    authorized.requestOptions
  );
  return toResponse(result);
}

export async function PUT(request: Request) {
  const authorized = await authorizeRequest(request);
  if (authorized instanceof NextResponse) {
    return authorized;
  }
  const payload = (await request.json().catch(() => null)) as unknown;
  if (!isActivationPayload(payload)) {
    return NextResponse.json(
      { error: "Invalid Tenant Chat runtime activation payload." },
      { status: 400 }
    );
  }

  const result = await activateTenantChatAdminRuntime(
    authorized.controlPlaneTenantId,
    payload,
    authorized.requestOptions
  );
  return toResponse(result);
}

async function authorizeRequest(request: Request) {
  const routeTenantId = new URL(request.url).searchParams.get("tenantId")?.trim();
  if (!routeTenantId || routeTenantId.length > 200) {
    return NextResponse.json({ error: "tenantId is required." }, { status: 400 });
  }
  const cookieHeader = request.headers.get("cookie");
  const auth = await getCurrentConsoleAuthForCookieHeader(cookieHeader);
  if (!auth.isAuthenticated) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  if (!isTenantAdminForTenant(auth, routeTenantId)) {
    return NextResponse.json(
      { error: "Tenant administrator access required." },
      { status: 403 }
    );
  }

  return {
    controlPlaneTenantId: resolveConsoleTenantIdForAuth(auth, routeTenantId),
    requestOptions: { cookieHeader }
  };
}

function isActivationPayload(
  value: unknown
): value is { modelKey: string; providerConnectionId: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 2 &&
    typeof record.providerConnectionId === "string" &&
    UUID_PATTERN.test(record.providerConnectionId) &&
    typeof record.modelKey === "string" &&
    MODEL_KEY_PATTERN.test(record.modelKey)
  );
}

function toResponse(
  result: Awaited<ReturnType<typeof getTenantChatAdminRuntimeSetup>>
) {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status > 0 ? result.status : 502 }
    );
  }
  return NextResponse.json(result.data, { status: result.status });
}
