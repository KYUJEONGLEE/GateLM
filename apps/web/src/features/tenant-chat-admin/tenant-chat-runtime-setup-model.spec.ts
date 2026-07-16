import { readFile } from "node:fs/promises";
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
      cacheEnabled: true,
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

test("degraded routing selections render unavailable options instead of an available model", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const source = await readFile(componentSourceUrl, "utf8");

  expect(source.match(/<UnavailableModelOption/g)).toHaveLength(1);
  expect(source).toContain("function TenantRoutingModelSelect");
  expect(source).toContain('value={routes[category.id][difficulty.id].modelRefs[0] ?? ""}');
  expect(source).toContain('<UnavailableModelOption locale={locale} models={models} value={value} />');
  expect(source).toContain('return <option disabled value={value}>{copy[locale].modelUnavailable}</option>');
  expect(source).toContain('modelUnavailable: "Selected model unavailable"');
  expect(source).toContain('modelUnavailable: "선택된 모델 사용 불가"');
});

test("Chat App routing reuses the original routing policy presentation", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const source = await readFile(componentSourceUrl, "utf8");

  expect(source).toContain('className="console-content management-line-content tenant-management-content"');
  expect(source).toContain('className="tenant-routing-enable-card"');
  expect(source).toContain('className="tenant-routing-switch"');
  expect(source).toContain('className="tenant-routing-model-card"');
  expect(source).toContain('className="tenant-routing-table"');
  expect(source).toContain('className="tenant-routing-model-choice-copy"');
  expect(source).toContain("MessageSquareMore");
  expect(source).toContain("BrainCircuit");
  expect(source).toContain("ProviderFamilyIcon");
});

test("Chat App cache policy reuses the shared existing policy card", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const cachePanelSourceUrl = new URL("../policies/components/runtime-policy-panels/cache-panel.tsx", import.meta.url);
  const sharedCardSourceUrl = new URL("../policies/components/exact-cache-toggle-card.tsx", import.meta.url);
  const [componentSource, cachePanelSource, sharedCardSource] = await Promise.all([
    readFile(componentSourceUrl, "utf8"),
    readFile(cachePanelSourceUrl, "utf8"),
    readFile(sharedCardSourceUrl, "utf8")
  ]);

  expect(componentSource).toContain("<ExactCacheToggleCard");
  expect(cachePanelSource).toContain("<ExactCacheToggleCard");
  expect(sharedCardSource).toContain("DatabaseZap");
  expect(sharedCardSource).toContain('className="policy-cache-card"');
  expect(sharedCardSource).toContain('className="policy-cache-card-summary"');
  expect(sharedCardSource).toContain('className="policy-cache-card-icon"');
});

test("Chat App publishes routing and cache policy in one request", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const source = await readFile(componentSourceUrl, "utf8");

  expect(source).toContain("JSON.stringify({ cacheEnabled, manualModelRef, routes, routingMode })");
  expect(source).toContain('publish: "Publish Chat App policy"');
  expect(source).toContain('publish: "채팅 앱 정책 발행"');
});

test("Chat App routing publish recovers from a Control Plane network failure", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const source = (await readFile(componentSourceUrl, "utf8")).replaceAll("\r\n", "\n");

  expect(source).toContain('setFeedback({ error: true, message: "Control Plane unavailable." });');
  expect(source).toContain("} finally {\n      setPending(false);");
});
