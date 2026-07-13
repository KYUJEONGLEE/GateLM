import { expect, test } from "@playwright/test";
import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import {
  getOnboardingRuntimeSelectionError,
  getSelectableOnboardingRuntimeModels,
  getSelectedOnboardingRuntimeModel,
  ONBOARDING_RUNTIME_PROVIDER_REQUIRED
} from "./onboarding-runtime-readiness";

const tenantId = "tenant-runtime-ready";

test("does not expose fallback models without a registered Provider Connection", () => {
  expect(getSelectableOnboardingRuntimeModels([], tenantId)).toEqual([]);
});

test("exposes only active tenant-level Provider models", () => {
  const activeProvider = providerConnection({
    id: "provider-openai",
    provider: "openai",
    providerConfig: { models: ["gpt-4o-mini", "gpt-4o-mini", "gpt-4o"] }
  });
  const disabledProvider = providerConnection({
    id: "provider-disabled",
    provider: "gemini",
    providerConfig: { models: ["gemini-flash"] },
    status: "DISABLED"
  });
  const projectProvider = providerConnection({
    id: "provider-project",
    projectId: "project-1",
    provider: "mock",
    providerConfig: { models: ["mock-fast"] }
  });

  const options = getSelectableOnboardingRuntimeModels(
    [activeProvider, disabledProvider, projectProvider],
    tenantId
  );

  expect(options.map((option) => option.value)).toEqual([
    "provider-openai:gpt-4o-mini",
    "provider-openai:gpt-4o"
  ]);
  expect(
    getSelectedOnboardingRuntimeModel(options, "provider-openai:gpt-4o", tenantId)
  ).toMatchObject({ providerConnectionId: "provider-openai" });
});

test("rejects onboarding activation without a Provider attachment and model", () => {
  expect(
    getOnboardingRuntimeSelectionError({
      providerConnectionIds: [],
      selectedModelKey: "provider-openai:gpt-4o-mini"
    })
  ).toBe(ONBOARDING_RUNTIME_PROVIDER_REQUIRED);
  expect(
    getOnboardingRuntimeSelectionError({
      providerConnectionIds: ["provider-openai"],
      selectedModelKey: ""
    })
  ).toBe(ONBOARDING_RUNTIME_PROVIDER_REQUIRED);
  expect(
    getOnboardingRuntimeSelectionError({
      providerConnectionIds: ["provider-openai"],
      selectedModelKey: "provider-openai:gpt-4o-mini"
    })
  ).toBeNull();
  expect(getOnboardingRuntimeSelectionError({})).toBeNull();
});

function providerConnection(
  overrides: Partial<ProviderConnectionRecord> & Pick<ProviderConnectionRecord, "id" | "provider">
): ProviderConnectionRecord {
  const { id, provider, ...rest } = overrides;

  return {
    baseUrl: "https://provider.example.test/v1",
    createdAt: "2026-07-11T00:00:00.000Z",
    credentialPreview: { last4: "demo", prefix: "test" },
    displayName: provider,
    id,
    projectId: null,
    provider,
    providerConfig: { models: [] },
    resolver: "environment",
    status: "ACTIVE",
    tenantId,
    timeoutMs: 30_000,
    updatedAt: "2026-07-11T00:00:00.000Z",
    ...rest
  };
}
