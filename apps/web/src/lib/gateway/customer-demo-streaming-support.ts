import type { RuntimePolicyConfig } from "@/lib/control-plane/runtime-policy-types";

export function runtimePolicySupportsApplicationChatStreaming(config: RuntimePolicyConfig) {
  const routingProviders = new Set(
    [
      config.routingPolicy.lowCostProvider,
      config.routingPolicy.defaultProvider,
      config.routingPolicy.fallbackProvider,
      config.routingPolicy.highQualityProvider ?? ""
    ]
      .map((provider) => provider.trim())
      .filter(Boolean)
  );

  for (const provider of routingProviders) {
    const providerConfig = config.providers?.find((item) => item.provider === provider);

    if (isAnthropicProvider(provider, providerConfig)) {
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
