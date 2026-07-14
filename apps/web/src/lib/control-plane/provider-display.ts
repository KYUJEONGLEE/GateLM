import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";

export type ProviderDisplay = {
  family: string;
  name: string;
};

export type ProviderDisplayDirectory = Record<string, ProviderDisplay>;

export function buildProviderDisplayDirectory(
  providers: ProviderConnectionRecord[]
): ProviderDisplayDirectory {
  return providers.reduce<ProviderDisplayDirectory>((directory, provider) => {
    const providerId = provider.id.trim();
    if (!providerId) {
      return directory;
    }

    const display = {
      family: getProviderConnectionFamily(provider),
      name: provider.displayName.trim() || provider.provider.trim() || "Provider"
    };
    directory[providerId] = display;
    directory[providerId.toLocaleLowerCase()] = display;
    return directory;
  }, {});
}

export function resolveProviderDisplay(
  directory: ProviderDisplayDirectory,
  providerId: string | null | undefined
): ProviderDisplay | null {
  const normalizedProviderId = providerId?.trim();
  if (!normalizedProviderId) {
    return null;
  }

  return (
    directory[normalizedProviderId] ??
    directory[normalizedProviderId.toLocaleLowerCase()] ??
    null
  );
}

export function getProviderConnectionFamily(provider: ProviderConnectionRecord) {
  const configuredFamily = getProviderConfigString(
    provider.providerConfig,
    "providerFamily",
    ""
  );

  if (configuredFamily) {
    return configuredFamily;
  }

  return getProviderFamilyFromKey(provider.provider, provider.baseUrl);
}

export function getProviderFamilyFromKey(providerKey: string, baseUrl = "") {
  const normalizedProvider = providerKey.toLowerCase();
  const normalizedBaseUrl = baseUrl.toLowerCase();

  if (
    normalizedProvider.includes("gemini") ||
    normalizedBaseUrl.includes("generativelanguage.googleapis.com")
  ) {
    return "gemini";
  }

  if (
    normalizedProvider.includes("claude") ||
    normalizedProvider.includes("anthropic") ||
    normalizedBaseUrl.includes("anthropic.com")
  ) {
    return "claude";
  }

  if (normalizedProvider === "mock") {
    return "mock";
  }

  if (normalizedProvider === "new-provider") {
    return "new-provider";
  }

  return "openai";
}

function getProviderConfigString(
  providerConfig: Record<string, unknown> | null,
  key: string,
  fallback: string
) {
  const value = providerConfig?.[key];

  return typeof value === "string" ? value : fallback;
}
