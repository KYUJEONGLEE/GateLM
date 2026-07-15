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
          activationStatus: "available",
          modelRef: "tc_tiered",
          modelKey: "tiered-model",
          pricingStatus: "unavailable",
          pricing: null
        },
        {
          activationStatus: "available",
          modelRef: "tc_gemini_flash",
          modelKey: "models/gemini-2.5-flash",
          pricingStatus: "available",
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

test("restores the requested Provider and keeps price-unavailable models selectable", () => {
  const providerId = selectTenantChatProviderId(
    setup,
    "11111111-1111-4111-8111-111111111111"
  );
  expect(providerId).toBe("11111111-1111-4111-8111-111111111111");
  expect(selectTenantChatModelKey(setup, providerId)).toBe("tiered-model");
});

test("price-unavailable models remain valid selections", () => {
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
  ).toBe("tiered-model");
  expect(
    getTenantChatSetupStep({
      hasAvailableModel: true,
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
      version: 5,
      manualModelRef: "tc_gemini_flash",
      routingMode: "auto",
      routes: {
        general: { simple: { modelRefs: ["tc_gemini_flash"] }, complex: { modelRefs: ["tc_gemini_flash"] } },
        code: { simple: { modelRefs: ["tc_gemini_flash"] }, complex: { modelRefs: ["tc_gemini_flash"] } },
        translation: { simple: { modelRefs: ["tc_gemini_flash"] }, complex: { modelRefs: ["tc_gemini_flash"] } },
        summarization: { simple: { modelRefs: ["tc_gemini_flash"] }, complex: { modelRefs: ["tc_gemini_flash"] } },
        reasoning: { simple: { modelRefs: ["tc_gemini_flash"] }, complex: { modelRefs: ["tc_gemini_flash"] } }
      }
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
