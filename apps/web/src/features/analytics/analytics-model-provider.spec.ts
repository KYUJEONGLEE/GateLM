import { expect, test } from "@playwright/test";

import { resolveAnalyticsModelProviderFamily } from "./analytics-model-provider";

test("resolves opaque analytics provider ids through the configured provider directory", () => {
  const providerDirectory = {
    "provider-cerebras-id": {
      family: "cerebras",
      name: "Cerebras Main"
    },
    "provider-claude-id": {
      family: "claude",
      name: "Claude Main"
    }
  };

  expect(resolveAnalyticsModelProviderFamily(
    JSON.stringify(["provider-claude-id", "claude-opus-4-6"]),
    "claude-opus-4-6",
    providerDirectory
  )).toBe("claude");
  expect(resolveAnalyticsModelProviderFamily(
    JSON.stringify(["provider-cerebras-id", "gpt-oss-120b"]),
    "gpt-oss-120b",
    providerDirectory
  )).toBe("cerebras");
});

test("falls back to the model family when the provider directory has no entry", () => {
  expect(resolveAnalyticsModelProviderFamily(
    JSON.stringify(["opaque-provider-id", "mistral-small-latest"]),
    "mistral-small-latest",
    {}
  )).toBe("mistral");
  expect(resolveAnalyticsModelProviderFamily(
    JSON.stringify(["opaque-provider-id", "gemini-2.5-pro"]),
    "gemini-2.5-pro",
    {}
  )).toBe("gemini");
  expect(resolveAnalyticsModelProviderFamily(
    JSON.stringify(["opaque-provider-id", "gpt-5.6-sol"]),
    "gpt-5.6-sol",
    {}
  )).toBe("openai");
});
