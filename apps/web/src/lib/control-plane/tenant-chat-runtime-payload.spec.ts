import { expect, test } from "@playwright/test";

import { tenantChatRuntimeSetupFromPayload } from "./tenant-chat-runtime-payload";

const setup = {
  activeSnapshot: null,
  providers: [
    {
      displayName: "OpenAI",
      models: [
        {
          activationStatus: "available",
          modelKey: "gpt-5.4-nano",
          pricing: {
            inputMicroUsdPerMillionTokens: 100,
            outputMicroUsdPerMillionTokens: 200
          }
        }
      ],
      providerConnectionId: "00000000-0000-4000-8000-000000000601",
      providerFamily: "openai",
      providerKey: "openai"
    }
  ],
  readiness: "needs_activation"
} as const;

test("unwraps the Control Plane data envelope", () => {
  expect(tenantChatRuntimeSetupFromPayload({ data: setup })).toEqual(setup);
});

test("keeps bare setup compatibility and rejects malformed envelopes", () => {
  expect(tenantChatRuntimeSetupFromPayload(setup)).toEqual(setup);
  expect(
    tenantChatRuntimeSetupFromPayload({
      data: { ...setup, providers: [{ ...setup.providers[0], models: [{}] }] }
    })
  ).toBeNull();
  expect(tenantChatRuntimeSetupFromPayload({ data: null })).toBeNull();
});
