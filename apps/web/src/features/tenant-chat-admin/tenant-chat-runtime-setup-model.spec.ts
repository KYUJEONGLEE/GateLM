import { expect, test } from "@playwright/test";

import type { TenantChatAdminRuntimeSetup } from "@/lib/control-plane/tenant-chat-runtime-types";
import {
  getTenantChatSetupStep,
  selectTenantChatModelKey,
  selectTenantChatProviderId
} from "./tenant-chat-runtime-setup-model";

const setup: TenantChatAdminRuntimeSetup = {
  activeSnapshot: null,
  providers: [
    {
      displayName: "Long Korean Provider 이름",
      models: [
        {
          activationStatus: "pricing_unavailable",
          modelKey: "tiered-model",
          pricing: null
        },
        {
          activationStatus: "available",
          modelKey: "models/gemini-2.5-flash",
          pricing: {
            inputMicroUsdPerMillionTokens: 300_000,
            outputMicroUsdPerMillionTokens: 2_500_000
          }
        }
      ],
      providerConnectionId: "11111111-1111-4111-8111-111111111111",
      providerFamily: "gemini",
      providerKey: "gemini-main"
    },
    {
      displayName: "OpenAI",
      models: [],
      providerConnectionId: "22222222-2222-4222-8222-222222222222",
      providerFamily: "openai",
      providerKey: "openai-main"
    }
  ],
  readiness: "needs_activation"
};

test("restores the requested Provider after registration and selects the first priced model", () => {
  const providerId = selectTenantChatProviderId(
    setup,
    "11111111-1111-4111-8111-111111111111"
  );
  expect(providerId).toBe("11111111-1111-4111-8111-111111111111");
  expect(selectTenantChatModelKey(setup, providerId)).toBe(
    "models/gemini-2.5-flash"
  );
});

test("never auto-selects a pricing-unavailable model", () => {
  const unsupportedOnly = {
    ...setup,
    providers: [
      {
        ...setup.providers[0]!,
        models: [setup.providers[0]!.models[0]!]
      }
    ],
    readiness: "needs_model" as const
  };
  expect(
    selectTenantChatModelKey(
      unsupportedOnly,
      "11111111-1111-4111-8111-111111111111"
    )
  ).toBe("");
  expect(
    getTenantChatSetupStep({
      hasAvailableModel: false,
      hasProvider: true,
      readiness: unsupportedOnly.readiness
    })
  ).toBe(2);
});

test("active snapshot wins on reload", () => {
  const readySetup: TenantChatAdminRuntimeSetup = {
    ...setup,
    activeSnapshot: {
      digest: "sha256:fixture",
      modelKey: "models/gemini-2.5-flash",
      policyVersion: 4,
      pricingStatus: "current",
      pricingVersion: 3,
      providerConnectionId: "11111111-1111-4111-8111-111111111111",
      publishedAt: "2026-07-14T00:00:00Z",
      snapshotId: "snapshot-fixture",
      version: 5
    },
    readiness: "ready"
  };
  const providerId = selectTenantChatProviderId(readySetup);
  expect(selectTenantChatModelKey(readySetup, providerId)).toBe(
    "models/gemini-2.5-flash"
  );
  expect(
    getTenantChatSetupStep({
      hasAvailableModel: true,
      hasProvider: true,
      readiness: readySetup.readiness
    })
  ).toBe(3);
});
