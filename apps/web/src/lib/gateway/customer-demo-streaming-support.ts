import type { RuntimePolicyConfig } from "@/lib/control-plane/runtime-policy-types";

export function runtimePolicySupportsApplicationChatStreaming(config: RuntimePolicyConfig) {
  const activeModelRefs = new Set(
    Object.values(config.routingPolicy.routes).flatMap((categoryRoutes) =>
      Object.values(categoryRoutes).flatMap((cell) => cell.modelRefs)
    )
  );
  const routingProviders = config.providers.filter((provider) =>
    provider.models.some((modelId) =>
      activeModelRefs.has(
        provider.provider === "mock" && modelId === "mock-balanced"
          ? "mock-balanced"
          : `${provider.providerId}:${modelId}`
      )
    )
  );

  for (const provider of routingProviders) {
    if (isAnthropicProvider(provider.provider, provider)) {
      return false;
    }
  }

  return true;
}

function isAnthropicProvider(
  provider: string,
  providerConfig: RuntimePolicyConfig["providers"][number] | undefined
) {
  const providerKey = provider.toLowerCase();
  const baseUrl = normalizeProviderMatchText(providerConfig?.baseUrl);
  const displayName = normalizeProviderMatchText(providerConfig?.displayName);

  return (
    providerKey.includes("anthropic") ||
    providerKey.includes("claude") ||
    baseUrl.includes("anthropic.com") ||
    displayName.includes("anthropic") ||
    displayName.includes("claude")
  );
}

function normalizeProviderMatchText(value: string | undefined) {
  return (value ?? "").split(/[?#]/, 1)[0].toLowerCase();
}
