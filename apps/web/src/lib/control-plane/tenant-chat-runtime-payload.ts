import type { TenantChatAdminRuntimeSetup } from "@/lib/control-plane/tenant-chat-runtime-types";

export function tenantChatRuntimeSetupFromPayload(
  value: unknown
): TenantChatAdminRuntimeSetup | null {
  if (!isRecord(value)) {
    return null;
  }
  const candidate = isRecord(value.data) ? value.data : value;
  return isTenantChatAdminRuntimeSetup(candidate) ? candidate : null;
}

function isTenantChatAdminRuntimeSetup(
  value: unknown
): value is TenantChatAdminRuntimeSetup {
  if (!isRecord(value)) {
    return false;
  }
  return (
    (value.readiness === "needs_provider" ||
      value.readiness === "needs_model" ||
      value.readiness === "needs_activation" ||
      value.readiness === "ready" ||
      value.readiness === "degraded") &&
    Array.isArray(value.providers) &&
    value.providers.every(isProviderCandidate) &&
    (value.activeSnapshot === null || isActiveSnapshot(value.activeSnapshot))
  );
}

function isProviderCandidate(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.providerConnectionId === "string" &&
    typeof value.providerKey === "string" &&
    typeof value.providerFamily === "string" &&
    typeof value.displayName === "string" &&
    Array.isArray(value.models) &&
    value.models.every(isModelCandidate)
  );
}

function isModelCandidate(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.modelKey === "string" &&
    (value.activationStatus === "available" ||
      value.activationStatus === "pricing_unavailable") &&
    (value.pricing === null || isPricing(value.pricing))
  );
}

function isPricing(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  return (
    Number.isSafeInteger(value.inputMicroUsdPerMillionTokens) &&
    Number.isSafeInteger(value.outputMicroUsdPerMillionTokens) &&
    (value.cacheReadInputMicroUsdPerMillionTokens === undefined ||
      Number.isSafeInteger(value.cacheReadInputMicroUsdPerMillionTokens))
  );
}

function isActiveSnapshot(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.snapshotId === "string" &&
    typeof value.digest === "string" &&
    typeof value.providerConnectionId === "string" &&
    typeof value.modelKey === "string" &&
    typeof value.publishedAt === "string" &&
    Number.isSafeInteger(value.version) &&
    Number.isSafeInteger(value.policyVersion) &&
    Number.isSafeInteger(value.pricingVersion) &&
    (value.pricingStatus === "current" ||
      value.pricingStatus === "update_available" ||
      value.pricingStatus === "unavailable")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
