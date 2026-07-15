import { expect, test } from "@playwright/test";
import {
  buildProviderDisplayDirectory,
  getProviderFamilyFromKey,
  resolveProviderDisplay
} from "./provider-display";
import type { ProviderConnectionRecord } from "./provider-connections-types";

test("resolves a provider attempt id to the configured name and logo family", () => {
  const directory = buildProviderDisplayDirectory([
    providerConnection({
      displayName: "OpenAI Production",
      id: "provider-openai",
      provider: "openai"
    })
  ]);

  expect(resolveProviderDisplay(directory, "provider-openai")).toEqual({
    family: "openai",
    name: "OpenAI Production"
  });
});

test("uses an explicit provider family for OpenAI-compatible connections", () => {
  const directory = buildProviderDisplayDirectory([
    providerConnection({
      displayName: "Internal Claude Proxy",
      id: "provider-proxy",
      provider: "custom-openai-compatible",
      providerConfig: { providerFamily: "claude" }
    })
  ]);

  expect(resolveProviderDisplay(directory, "provider-proxy")).toEqual({
    family: "claude",
    name: "Internal Claude Proxy"
  });
  expect(resolveProviderDisplay(directory, "missing-provider")).toBeNull();
});

test("recognizes OpenAI-compatible provider families by key and base URL", () => {
  expect(getProviderFamilyFromKey("groq-main")).toBe("groq");
  expect(
    getProviderFamilyFromKey("custom-provider", "https://api.cerebras.ai/v1")
  ).toBe("cerebras");
  expect(
    getProviderFamilyFromKey("custom-provider", "https://api.mistral.ai/v1")
  ).toBe("mistral");
});

function providerConnection(
  values: Pick<ProviderConnectionRecord, "displayName" | "id" | "provider"> &
    Partial<ProviderConnectionRecord>
): ProviderConnectionRecord {
  return {
    baseUrl: "https://provider.example.com/v1",
    createdAt: "2026-07-14T00:00:00.000Z",
    credentialPreview: { last4: null, prefix: null },
    projectId: null,
    providerConfig: null,
    resolver: "openai_compatible",
    status: "ACTIVE",
    tenantId: "tenant-test",
    timeoutMs: 30000,
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...values
  };
}
