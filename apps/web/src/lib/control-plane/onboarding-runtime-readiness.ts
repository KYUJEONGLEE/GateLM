import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";

export const ONBOARDING_RUNTIME_PROVIDER_REQUIRED =
  "Connect an active Provider and select one of its configured models before activating the project.";

export type OnboardingRuntimeModelOption = {
  label: string;
  providerConnectionId: string;
  providerTenantId: string;
  value: string;
};

export function getSelectableOnboardingRuntimeModels(
  providerConnections: ProviderConnectionRecord[],
  controlPlaneTenantId: string
): OnboardingRuntimeModelOption[] {
  return providerConnections
    .filter(
      (providerConnection) =>
        providerConnection.projectId === null &&
        providerConnection.status === "ACTIVE" &&
        providerConnection.tenantId === controlPlaneTenantId
    )
    .flatMap((providerConnection) =>
      getProviderConfigModels(providerConnection.providerConfig).map((model) => ({
        label: `${model} (${providerConnection.provider})`,
        providerConnectionId: providerConnection.id,
        providerTenantId: providerConnection.tenantId,
        value: `${providerConnection.id}:${model}`
      }))
    );
}

export function getSelectedOnboardingRuntimeModel(
  options: OnboardingRuntimeModelOption[],
  value: string,
  projectTenantId: string
) {
  return (
    options.find(
      (option) => option.value === value && option.providerTenantId === projectTenantId
    ) ?? null
  );
}

export function getOnboardingRuntimeSelectionError(values: {
  providerConnectionIds?: string[];
  selectedModelKey?: string;
}) {
  if (values.providerConnectionIds === undefined) {
    return null;
  }

  const providerConnectionIds = values.providerConnectionIds
    .map((providerConnectionId) => providerConnectionId.trim())
    .filter(Boolean);
  const selectedModelKey = values.selectedModelKey?.trim() ?? "";

  if (providerConnectionIds.length === 0 || !isRuntimeModelKey(selectedModelKey)) {
    return ONBOARDING_RUNTIME_PROVIDER_REQUIRED;
  }

  return null;
}

function getProviderConfigModels(providerConfig: Record<string, unknown> | null) {
  const models = providerConfig?.models;

  return Array.isArray(models)
    ? Array.from(
        new Set(
          models
            .map((model) => (typeof model === "string" ? model.trim() : ""))
            .filter(Boolean)
        )
      )
    : [];
}

function isRuntimeModelKey(value: string) {
  const separatorIndex = value.indexOf(":");
  return (
    separatorIndex > 0 &&
    Boolean(value.slice(0, separatorIndex).trim()) &&
    Boolean(value.slice(separatorIndex + 1).trim())
  );
}
