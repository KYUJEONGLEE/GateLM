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
    const setup = readTenantChatAdminRuntimeSetup(payload);
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

function readTenantChatAdminRuntimeSetup(
  payload: unknown
): TenantChatAdminRuntimeSetup | null {
  if (isTenantChatAdminRuntimeSetup(payload)) {
    return payload;
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const data = (payload as Record<string, unknown>).data;
    if (isTenantChatAdminRuntimeSetup(data)) {
      return data;
    }
  }
  return null;
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
    typeof record.modelRef === "string" &&
    typeof record.modelKey === "string" &&
    record.activationStatus === "available" &&
    (record.pricingStatus === "available" ||
      record.pricingStatus === "unavailable") &&
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
    typeof record.cacheEnabled === "boolean" &&
    (record.routingMode === "auto" || record.routingMode === "manual") &&
    typeof record.manualModelRef === "string" &&
    isRoutingMatrix(record.routes) &&
    isCachePolicy(record.cachePolicy) &&
    isSafetyPolicy(record.safetyPolicy) &&
    isQuotaPolicy(record.quota) &&
    (record.pricingStatus === "current" ||
      record.pricingStatus === "update_available" ||
      record.pricingStatus === "unavailable")
  );
}

function isQuotaPolicy(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(record.defaultMonthlyTokenLimit) &&
    Number(record.defaultMonthlyTokenLimit) >= 0 &&
    typeof record.timezone === "string" &&
    typeof record.warningPercent === "number" &&
    typeof record.economyPercent === "number" &&
    typeof record.hardStopPercent === "number"
  );
}

function isCachePolicy(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.enabled === "boolean" &&
    Number.isSafeInteger(record.ttlSeconds) &&
    Number(record.ttlSeconds) > 0 &&
    Number.isSafeInteger(record.maxEntriesPerUser) &&
    Number(record.maxEntriesPerUser) > 0
  );
}

const safetyDetectorTypes = new Set([
  "email",
  "phone_number",
  "postal_address",
  "person_name",
  "organization_name",
  "resident_registration_number",
  "api_key",
  "authorization_header",
  "jwt",
  "private_key"
]);

function isSafetyPolicy(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const detectorSet = (value as Record<string, unknown>).detectorSet;
  if (!Array.isArray(detectorSet) || detectorSet.length < 1 || detectorSet.length > 10) {
    return false;
  }
  const detectorTypes = new Set<string>();
  return detectorSet.every((detector) => {
    if (!detector || typeof detector !== "object" || Array.isArray(detector)) {
      return false;
    }
    const record = detector as Record<string, unknown>;
    if (
      typeof record.detectorType !== "string" ||
      !safetyDetectorTypes.has(record.detectorType) ||
      detectorTypes.has(record.detectorType) ||
      (record.action !== "allow" && record.action !== "redact" && record.action !== "block")
    ) {
      return false;
    }
    detectorTypes.add(record.detectorType);
    return true;
  });
}

const routingCategories = [
  "general",
  "code",
  "translation",
  "summarization",
  "reasoning"
] as const;

function isRoutingMatrix(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const routes = value as Record<string, unknown>;
  return routingCategories.every((category) => {
    const difficulty = routes[category];
    if (!difficulty || typeof difficulty !== "object" || Array.isArray(difficulty)) {
      return false;
    }
    const cells = difficulty as Record<string, unknown>;
    return ["simple", "complex"].every((key) => {
      const cell = cells[key];
      if (!cell || typeof cell !== "object" || Array.isArray(cell)) {
        return false;
      }
      const modelRefs = (cell as Record<string, unknown>).modelRefs;
      return (
        Array.isArray(modelRefs) &&
        modelRefs.length >= 1 &&
        modelRefs.length <= 4 &&
        modelRefs.every((modelRef) => typeof modelRef === "string")
      );
    });
  });
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
