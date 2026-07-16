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
import type { TenantChatRuntimeActivationValues } from "@/lib/control-plane/tenant-chat-runtime-types";

const MODEL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const ROUTING_CATEGORIES = [
  "general",
  "code",
  "translation",
  "summarization",
  "reasoning"
] as const;

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
): value is TenantChatRuntimeActivationValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Object.keys(record).length === 4 &&
    typeof record.cacheEnabled === "boolean" &&
    (record.routingMode === "auto" || record.routingMode === "manual") &&
    typeof record.manualModelRef === "string" &&
    MODEL_KEY_PATTERN.test(record.manualModelRef) &&
    isRoutingMatrix(record.routes)
  );
}

function isRoutingMatrix(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const routes = value as Record<string, unknown>;
  return (
    Object.keys(routes).length === ROUTING_CATEGORIES.length &&
    ROUTING_CATEGORIES.every((category) => {
      const difficulty = routes[category];
      if (!difficulty || typeof difficulty !== "object" || Array.isArray(difficulty)) {
        return false;
      }
      const cells = difficulty as Record<string, unknown>;
      return (
        Object.keys(cells).length === 2 &&
        ["simple", "complex"].every((key) => {
          const cell = cells[key];
          if (!cell || typeof cell !== "object" || Array.isArray(cell)) {
            return false;
          }
          const cellRecord = cell as Record<string, unknown>;
          const modelRefs = cellRecord.modelRefs;
          return (
            Object.keys(cellRecord).length === 1 &&
            Array.isArray(modelRefs) &&
            modelRefs.length >= 1 &&
            modelRefs.length <= 4 &&
            new Set(modelRefs).size === modelRefs.length &&
            modelRefs.every(
              (modelRef) =>
                typeof modelRef === "string" && MODEL_KEY_PATTERN.test(modelRef)
            )
          );
        })
      );
    })
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
