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
    if (!isTenantChatAdminRuntimeSetup(payload)) {
      return {
        error: "Control Plane response did not include a valid Tenant Chat runtime setup.",
        ok: false,
        status: response.status
      };
    }

    return { data: payload, ok: true, status: response.status };
  } catch {
    return { error: "Control Plane unavailable.", ok: false, status: 0 };
  }
}

function isTenantChatAdminRuntimeSetup(value: unknown): value is TenantChatAdminRuntimeSetup {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    (record.readiness === "needs_provider" ||
      record.readiness === "needs_model" ||
      record.readiness === "needs_activation" ||
      record.readiness === "ready" ||
      record.readiness === "degraded") &&
    Array.isArray(record.providers) &&
    record.providers.every(isProviderCandidate) &&
    (record.activeSnapshot === null || isActiveSnapshot(record.activeSnapshot))
  );
}

function isProviderCandidate(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.providerConnectionId === "string" &&
    typeof record.providerKey === "string" &&
    typeof record.providerFamily === "string" &&
    typeof record.displayName === "string" &&
    Array.isArray(record.models) &&
    record.models.every(isModelCandidate)
  );
}

function isModelCandidate(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.modelKey === "string" &&
    (record.activationStatus === "available" ||
      record.activationStatus === "pricing_unavailable") &&
    (record.pricing === null || isPricing(record.pricing))
  );
}

function isPricing(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(record.inputMicroUsdPerMillionTokens) &&
    Number.isSafeInteger(record.outputMicroUsdPerMillionTokens) &&
    (record.cacheReadInputMicroUsdPerMillionTokens === undefined ||
      Number.isSafeInteger(record.cacheReadInputMicroUsdPerMillionTokens))
  );
}

function isActiveSnapshot(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.snapshotId === "string" &&
    typeof record.digest === "string" &&
    typeof record.providerConnectionId === "string" &&
    typeof record.modelKey === "string" &&
    typeof record.publishedAt === "string" &&
    Number.isSafeInteger(record.version) &&
    Number.isSafeInteger(record.policyVersion) &&
    Number.isSafeInteger(record.pricingVersion) &&
    (record.pricingStatus === "current" ||
      record.pricingStatus === "update_available" ||
      record.pricingStatus === "unavailable")
  );
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
