import type { TenantChatAdminRuntimeSetup } from "@/lib/control-plane/tenant-chat-runtime-types";

export function selectTenantChatProviderId(
  setup: TenantChatAdminRuntimeSetup | null,
  requestedProviderId?: string
) {
  if (
    requestedProviderId &&
    setup?.providers.some(
      (provider) => provider.providerConnectionId === requestedProviderId
    )
  ) {
    return requestedProviderId;
  }
  return (
    setup?.activeSnapshot?.providerConnectionId ??
    setup?.providers[0]?.providerConnectionId ??
    ""
  );
}

export function selectTenantChatModelKey(
  setup: TenantChatAdminRuntimeSetup | null,
  providerId: string
) {
  const provider = setup?.providers.find(
    (candidate) => candidate.providerConnectionId === providerId
  );
  if (!provider) {
    return "";
  }
  if (
    setup?.activeSnapshot?.providerConnectionId === providerId &&
    provider.models.some(
      (model) => model.modelKey === setup.activeSnapshot?.modelKey
    )
  ) {
    return setup.activeSnapshot.modelKey;
  }
  return (
    provider.models.find((model) => model.activationStatus === "available")
      ?.modelKey ?? ""
  );
}

export function getTenantChatSetupStep(input: {
  hasAvailableModel: boolean;
  hasProvider: boolean;
  readiness: TenantChatAdminRuntimeSetup["readiness"];
}) {
  if (!input.hasProvider) {
    return 1;
  }
  if (!input.hasAvailableModel) {
    return 2;
  }
  return input.readiness === "ready" ? 3 : 2;
}
