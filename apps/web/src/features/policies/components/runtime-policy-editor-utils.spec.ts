import { expect, test } from "@playwright/test";

import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import type { RuntimePolicyDraftValues } from "@/lib/control-plane/runtime-policy-types";

import {
  formatPolicyNumberInputValue,
  getRoutingModelOptions,
  groupRoutingModelOptionsByProvider,
  mergeDraftValuesWithProviderConnections,
  parseOptionalBoundedInteger
} from "./runtime-policy-editor-utils";

test("formats missing policy number values as an empty input", () => {
  expect(formatPolicyNumberInputValue(undefined)).toBe("");
  expect(formatPolicyNumberInputValue(null)).toBe("");
  expect(formatPolicyNumberInputValue(Number.NaN)).toBe("");
  expect(formatPolicyNumberInputValue(12)).toBe("12");
});

test("allows a policy number field to be cleared while editing", () => {
  expect(parseOptionalBoundedInteger("", 1, 100000)).toBeNull();
  expect(parseOptionalBoundedInteger("   ", 1, 100000)).toBeNull();
  expect(parseOptionalBoundedInteger("12", 1, 100000)).toBe(12);
  expect(parseOptionalBoundedInteger("0", 1, 100000)).toBe(1);
});

test("keeps duplicate provider families separate by Provider Connection", () => {
  const modelOptions = getRoutingModelOptions([
    providerConnection({
      displayName: "OpenAI Production",
      id: "provider-openai-production",
      providerConfig: { models: ["gpt-5", "gpt-5-mini"] }
    }),
    providerConnection({
      displayName: "OpenAI Backup",
      id: "provider-openai-backup",
      providerConfig: { models: ["gpt-4.1-mini"] }
    })
  ]);
  const providers = groupRoutingModelOptionsByProvider(modelOptions);

  expect(providers).toHaveLength(2);
  expect(providers.map((provider) => provider.providerConnectionId)).toEqual([
    "provider-openai-production",
    "provider-openai-backup"
  ]);
  expect(providers[0]?.displayName).toBe("OpenAI Production");
  expect(providers[0]?.models.map((model) => model.modelName)).toEqual([
    "gpt-5",
    "gpt-5-mini"
  ]);
  expect(providers[1]?.models[0]?.modelRef).toBe(
    "provider-openai-backup:gpt-4.1-mini"
  );
});

test("publishing a mock bootstrap prunes unbound provider models and keeps mock pricing", () => {
  const values = {
    models: [
      {
        contextWindowTokens: 128000,
        displayName: "Unbound Claude",
        model: "claude-unbound",
        provider: "claude-unbound",
        status: "active",
        supportsJsonMode: true,
        supportsStreaming: true
      }
    ],
    pricingRules: [
      {
        completionTokenMicroUsd: 30,
        model: "claude-unbound",
        pricingVersion: "test",
        promptTokenMicroUsd: 10,
        provider: "claude-unbound"
      }
    ]
  } as RuntimePolicyDraftValues;

  const merged = mergeDraftValuesWithProviderConnections(values, []);

  expect(merged.models).toEqual([
    expect.objectContaining({
      model: "mock-balanced",
      provider: "mock",
      status: "active"
    })
  ]);
  expect(merged.pricingRules).toEqual([
    expect.objectContaining({
      completionTokenMicroUsd: 0,
      model: "mock-balanced",
      promptTokenMicroUsd: 0,
      provider: "mock"
    })
  ]);
});

function providerConnection(
  values: Pick<ProviderConnectionRecord, "displayName" | "id"> &
    Partial<ProviderConnectionRecord>
): ProviderConnectionRecord {
  return {
    baseUrl: "https://api.openai.com/v1",
    createdAt: "2026-07-16T00:00:00.000Z",
    credentialPreview: { last4: null, prefix: null },
    projectId: null,
    provider: "openai",
    providerConfig: null,
    resolver: "openai_compatible",
    status: "ACTIVE",
    tenantId: "tenant-test",
    timeoutMs: 30000,
    updatedAt: "2026-07-16T00:00:00.000Z",
    ...values
  };
}
