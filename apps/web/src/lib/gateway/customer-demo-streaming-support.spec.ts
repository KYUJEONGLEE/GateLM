import { expect, test } from "@playwright/test";
import type { RuntimePolicyConfig } from "@/lib/control-plane/runtime-policy-types";
import { runtimePolicySupportsApplicationChatStreaming } from "./customer-demo-streaming-support";

test("disables application chat streaming for Anthropic pathful base URLs without query material", () => {
  expect(
    runtimePolicySupportsApplicationChatStreaming(
      runtimePolicyConfig({
        baseUrl: "https://api.anthropic.com/v1/messages?api_key=synthetic#fragment",
        displayName: "Claude"
      })
    )
  ).toBe(false);
});

test("keeps streaming enabled when Anthropic only appears in query or fragment material", () => {
  expect(
    runtimePolicySupportsApplicationChatStreaming(
      runtimePolicyConfig({
        baseUrl: "https://api.example.com/v1?target=anthropic.com#claude",
        displayName: "OpenAI Compatible"
      })
    )
  ).toBe(true);
});

test("handles missing optional provider metadata while checking provider names", () => {
  expect(
    runtimePolicySupportsApplicationChatStreaming(
      runtimePolicyConfig({
        baseUrl: undefined,
        displayName: undefined,
        provider: "anthropic-main"
      })
    )
  ).toBe(false);
});

function runtimePolicyConfig(
  providerOverrides: Partial<RuntimePolicyConfig["providers"][number]>
): RuntimePolicyConfig {
  const provider = providerOverrides.provider ?? "provider-main";

  return {
    applicationId: "00000000-0000-4000-8000-000000000300",
    cachePolicy: {
      enabled: true,
      ttlSeconds: 60,
      type: "exact"
    },
    configHash: "sha256:test",
    configVersion: "1",
    effectiveAt: "2026-07-09T00:00:00.000Z",
    generatedAt: "2026-07-09T00:00:00.000Z",
    models: [],
    pricingRules: [],
    providers: [
      {
        baseUrl: "https://api.example.com/v1",
        credentialPreview: null,
        displayName: "OpenAI Compatible",
        failureMode: "fail_open_to_fallback",
        models: [],
        provider,
        providerId: "provider-test",
        resolver: "environment",
        secretRef: null,
        status: "active",
        timeoutMs: 60_000,
        ...providerOverrides
      } as RuntimePolicyConfig["providers"][number]
    ],
    publishState: "published",
    publishedAt: "2026-07-09T00:00:00.000Z",
    rateLimit: {
      algorithm: "fixed_window",
      enabled: false,
      limit: 60,
      scope: "application",
      windowSeconds: 60
    },
    routingPolicy: {
      defaultModel: "model-main",
      defaultProvider: provider,
      fallbackModel: "model-main",
      fallbackProvider: provider,
      lowCostModel: "model-main",
      lowCostProvider: provider,
      routingPolicyHash: "sha256:routing",
      shortPromptMaxChars: 800
    },
    tenantId: "00000000-0000-4000-8000-000000000100"
  };
}
