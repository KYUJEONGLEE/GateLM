import "server-only";

import {
  getControlPlaneBaseUrl,
  resolveControlPlaneTenantId
} from "@/lib/control-plane/control-plane-config";
import {
  buildControlPlaneHeaders,
  type ControlPlaneRequestOptions
} from "@/lib/control-plane/control-plane-request";
import type {
  TenantChatAdminRuntimeSetup,
  TenantChatRuntimeActivationValues
} from "@/lib/control-plane/tenant-chat-runtime-types";
import { tenantChatRuntimeSetupFromPayload } from "@/lib/control-plane/tenant-chat-runtime-payload";

export type TenantChatRuntimeResult =
  | { data: TenantChatAdminRuntimeSetup; ok: true; status: number }
  | { error: string; ok: false; status: number };

export async function getTenantChatAdminRuntimeSetup(
  routeTenantId: string,
  options?: ControlPlaneRequestOptions
): Promise<TenantChatRuntimeResult> {
  return requestTenantChatRuntime(routeTenantId, "GET", undefined, options);
}

export async function activateTenantChatAdminRuntime(
  routeTenantId: string,
  values: TenantChatRuntimeActivationValues,
  options?: ControlPlaneRequestOptions
): Promise<TenantChatRuntimeResult> {
  return requestTenantChatRuntime(routeTenantId, "PUT", values, options);
}

async function requestTenantChatRuntime(
  routeTenantId: string,
  method: "GET" | "PUT",
  values?: TenantChatRuntimeActivationValues,
  options?: ControlPlaneRequestOptions
): Promise<TenantChatRuntimeResult> {
  const tenantId = resolveControlPlaneTenantId(routeTenantId);

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/tenant-chat/runtime`,
      {
        ...(values ? { body: JSON.stringify(values) } : {}),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(
          options,
          values ? { "Content-Type": "application/json" } : undefined
        ),
        method
      }
    );
    const payload = (await response.json().catch(() => ({}))) as unknown;

    if (!response.ok) {
      return {
        error: readErrorMessage(payload, response.status),
        ok: false,
        status: response.status
      };
    }
    const setup = tenantChatRuntimeSetupFromPayload(payload);
    if (!setup) {
      return {
        error: "Control Plane response did not include a valid Tenant Chat runtime setup.",
        ok: false,
        status: response.status
      };
    }

    return { data: setup, ok: true, status: response.status };
  } catch {
    return { error: "Control Plane unavailable.", ok: false, status: 0 };
  }
}

function readErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const message = (payload as Record<string, unknown>).message;
    const error = (payload as Record<string, unknown>).error;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
    if (typeof error === "string" && error.trim()) {
      return error;
    }
  }
  return `Control Plane request failed (${status}).`;
}
