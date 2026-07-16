import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

import type { TenantChatAdminRuntimeSetup } from "@/lib/control-plane/tenant-chat-runtime-types";
import {
  applyTenantChatSharedFallbackModelRef,
  getTenantChatFallbackExcludedModelRefs,
  getTenantChatSetupStep,
  selectTenantChatSharedFallbackModelRef,
  selectTenantChatModelKey,
  selectTenantChatProviderId,
  updateTenantChatPrimaryModelRef
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

test("degraded routing selections render unavailable options instead of an available model", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const source = await readFile(componentSourceUrl, "utf8");

  expect(source.match(/<UnavailableModelOption/g)).toHaveLength(1);
  expect(source).toContain("function TenantRoutingProviderModelSelect");
  expect(source).toContain('value={routes[category.id][difficulty.id].modelRefs[0] ?? ""}');
  expect(source).toContain('<UnavailableModelOption locale={locale} models={selectedModels} value={value ?? ""} />');
  expect(source).toContain('return <option disabled value={value}>{copy[locale].modelUnavailable}</option>');
  expect(source).toContain('modelUnavailable: "Selected model unavailable"');
  expect(source).toContain('modelUnavailable: "선택된 모델 사용 불가"');
});

test("Chat App routing selects Provider first and limits models to that Provider", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const stylesUrl = new URL("../../app/globals.css", import.meta.url);
  const source = await readFile(componentSourceUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");

  expect(source).toContain('className="tenant-routing-provider-control"');
  expect(source).toContain('className="tenant-routing-model-control"');
  expect(source).toContain("provider.providerConnectionId === event.target.value");
  expect(source).toContain('onChange(nextProvider?.models[0]?.modelRef ?? "")');
  expect(source).toContain("selectedModels.map((model)");
  expect(source).toContain("{model.modelKey}");
  expect(source).toContain("const showProviderIcon = Boolean(selectedProvider || value);");
  expect(source).toContain("{showProviderIcon ? (");
  expect(styles).toMatch(/\.tenant-routing-provider-control,\r?\n\.tenant-routing-model-control \{[\s\S]*?min-height: 70px;/);
  expect(styles).toMatch(/\.tenant-routing-provider-control select,\r?\n\.tenant-routing-model-control select \{[\s\S]*?min-height: 68px;[\s\S]*?font-size: 21px;/);
  expect(styles).toMatch(/\.tenant-routing-table-head \{[\s\S]*?font-size: 21px;/);
  expect(styles).toMatch(/\.tenant-routing-category \{[\s\S]*?font-size: 21px;/);
  expect(styles).toMatch(/\.tenant-routing-route::before \{[\s\S]*?font-size: 21px;/);
});

test("Chat App routing projects one shared fallback into every routing cell", () => {
  const routes = setupWithRoutes().activeSnapshot!.routes;
  const withFallback = applyTenantChatSharedFallbackModelRef(routes, "tc_tiered");

  expect(selectTenantChatSharedFallbackModelRef(withFallback)).toBe("tc_tiered");
  expect(withFallback.general.simple.modelRefs).toEqual(["tc_gemini_flash", "tc_tiered"]);
  expect(withFallback.reasoning.complex.modelRefs).toEqual(["tc_gemini_flash", "tc_tiered"]);
  expect(selectTenantChatSharedFallbackModelRef(
    updateTenantChatPrimaryModelRef(withFallback, "reasoning", "complex", "tc_tiered")
  )).toBeNull();
  expect(
    applyTenantChatSharedFallbackModelRef(withFallback, "").general.simple.modelRefs
  ).toEqual(["tc_gemini_flash"]);
});

test("Chat App routing rejects malformed shared fallback profiles without throwing", () => {
  const withFallback = applyTenantChatSharedFallbackModelRef(
    setupWithRoutes().activeSnapshot!.routes,
    "tc_tiered"
  );
  const malformed = {
    ...withFallback,
    reasoning: {
      ...withFallback.reasoning,
      complex: undefined
    }
  } as unknown as typeof withFallback;

  expect(selectTenantChatSharedFallbackModelRef(malformed)).toBeNull();
});

test("Chat App routing excludes automatic and fixed primary models from fallback", () => {
  const routes = setupWithRoutes().activeSnapshot!.routes;
  const excluded = getTenantChatFallbackExcludedModelRefs(routes, "tc_tiered");

  expect([...excluded]).toEqual(["tc_gemini_flash", "tc_tiered"]);
  expect(
    applyTenantChatSharedFallbackModelRef(routes, "tc_tiered", "tc_tiered")
  ).toBe(routes);
});

test("Chat App routing keeps existing fallback candidates when a primary changes", () => {
  const routes = applyTenantChatSharedFallbackModelRef(
    setupWithRoutes().activeSnapshot!.routes,
    "tc_tiered"
  );
  const updated = updateTenantChatPrimaryModelRef(
    routes,
    "general",
    "simple",
    "tc_other_primary"
  );

  expect(updated.general.simple.modelRefs).toEqual([
    "tc_other_primary",
    "tc_tiered"
  ]);
});

test("Chat App routing reuses the original routing policy presentation", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const stylesUrl = new URL("../../app/globals.css", import.meta.url);
  const source = await readFile(componentSourceUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");

  expect(source).toContain('className="console-content management-line-content tenant-management-content tenant-chat-app-content"');
  expect(styles).toMatch(/\.tenant-chat-app-content \{[\s\S]*?width: 100%;[\s\S]*?max-width: none;[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  expect(source).toContain('className="tenant-routing-switch"');
  expect(source).toContain('className="tenant-routing-model-card"');
  expect(source).toContain('className="tenant-routing-table"');
  expect(source).toContain('"tenant-routing-model-selectors"');
  expect(source).toContain('"tenant-routing-standalone-controls"');
  expect(source).toContain("MessageSquareMore");
  expect(source).toContain("BrainCircuit");
  expect(source).toContain("ProviderFamilyIcon");
});

test("Chat App routing presents general and high-performance difficulty labels in Korean", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const stylesUrl = new URL("../../app/globals.css", import.meta.url);
  const source = await readFile(componentSourceUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");

  expect(source).toContain("function RoutingCriteriaPopover");
  expect(source).toContain("criteria={routingDifficultyCriteria[locale]}");
  expect(source).toContain("criteria={category.criteria[locale]}");
  expect(source).toContain('{ id: "simple", en: "Simple", ko: "일반" }');
  expect(source).toContain('{ id: "complex", en: "Complex", ko: "고성능" }');
  expect(source).toContain("요청 길이만으로는 고성능으로 분류되지 않습니다. 작업 수, 제약, 범위, 의존 단계와 카테고리별 신호를 함께 판단합니다.");
  expect(source).toContain('categoryCriteria: "일반·고성능 안내"');
  expect(source).toContain('routingCriteria: "라우팅 일반·고성능 안내"');
  expect(source).toContain('simpleExample: "함수 하나의 문법 오류를 수정해줘"');
  expect(source).toContain('complexExample: "법률 용어와 표 형식을 유지해 존댓말로 번역해줘"');
  expect(source).toContain('className="tenant-routing-info-button"');
  expect(source).toContain("<PopoverPrimitive.Trigger");
  expect(source).toContain('data-difficulty="simple"');
  expect(source).toContain('data-difficulty="complex"');
  expect(styles).toContain(".tenant-routing-criteria-popover {");
  expect(styles).toContain('.tenant-routing-criteria-section[data-difficulty="simple"]');
  expect(styles).toContain('.tenant-routing-criteria-section[data-difficulty="complex"]');
  expect(styles).toContain("grid-template-columns: auto 16px");
  expect(styles).toContain(".tenant-routing-info-button:focus-visible");
  expect(source).not.toContain("tenant-routing-criteria-title");
});

test("Chat App routing switches one policy card between automatic and fixed modes", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const stylesUrl = new URL("../../app/globals.css", import.meta.url);
  const source = await readFile(componentSourceUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");

  expect(source).toContain('fixedLabel: "Fixed"');
  expect(source).toContain('fixedLabel: "고정"');
  expect(source).toContain('data-routing-mode={routingMode}');
  expect(source).toContain('className="tenant-routing-heading-mode"');
  expect(source).not.toContain('<span>{text.modeTitle}</span>');
  expect(source).toContain('aria-label={text.modeTitle}');
  expect(source).toContain('data-active={routingMode === "manual" ? "true" : undefined}');
  expect(source).toContain('data-active={routingMode === "auto" ? "true" : undefined}');
  expect(source).toContain('className="tenant-routing-mode-content" key={routingMode}');
  expect(source).toContain('className="tenant-routing-fixed-panel"');
  expect(source).toContain('<p>{text.manualDescription}</p>');
  expect(source).toMatch(/\)\}\r?\n {16}<section className="tenant-routing-fallback-card"/);
  expect(source).toContain('className="tenant-routing-fallback-title-row"');
  expect(source).toMatch(/<h3 id="tenant-routing-fallback-title">\{text\.fallbackTitle\}<\/h3>\r?\n\s+<span className="tenant-routing-fallback-kicker">/);
  expect(source).toContain('routingMode === "manual" ? text.fixedFallbackDescription : text.fallbackDescription');
  expect(styles).toContain('@keyframes tenant-routing-mode-enter');
  expect(styles).toMatch(/\.tenant-routing-switch-control \{[^}]*gap: 15px;[^}]*min-width: 222px;[^}]*font-size: 21px;/);
  expect(styles).toMatch(/\.tenant-routing-mode-label \{[^}]*min-width: 48px;/);
  expect(styles).toMatch(/\.tenant-routing-switch\[data-slot="switch"\] \{[^}]*width: 72px;[^}]*height: 42px;/);
  expect(styles).toMatch(/\.tenant-routing-switch \[data-slot="switch-thumb"\] \{[^}]*top: 3px;[^}]*left: 3px;[^}]*width: 33px;[^}]*height: 33px;/);
  expect(styles).toMatch(/\.tenant-routing-switch:is\(\[data-checked\], \[aria-checked="true"\]\)[\s\S]*?left: 33px;/);
  expect(styles).toContain('.tenant-routing-fixed-panel {');
  expect(styles).toContain('width: min(620px, 100%);');
  expect(styles).toContain('.tenant-routing-fallback-title-row {');
  expect(styles).toContain('.tenant-routing-fallback-title-row .tenant-routing-fallback-kicker {');
  expect(styles).toMatch(/\.tenant-routing-fallback-card \{[^}]*align-items: center;/);
  expect(styles).toMatch(/\.tenant-routing-fallback-heading \{[^}]*align-content: center;[^}]*align-self: center;/);
  expect(styles).toMatch(/\.tenant-routing-fallback-heading h3 \{[^}]*font-size: 28px;/);
  expect(styles).toMatch(/\.tenant-routing-fallback-heading p \{[^}]*font-size: 18px;/);
  expect(styles).toMatch(/\.tenant-routing-fallback-title-row \.tenant-routing-fallback-kicker \{[^}]*font-size: 16px;/);
  expect(styles).toMatch(/\.tenant-management-content #tenant-routing-model-title \{[^}]*font-size: 35px;/);
  expect(styles).toMatch(/\.tenant-routing-model-heading-copy > p \{[^}]*margin-top: 20px;/);
  expect(styles).toMatch(/\.tenant-routing-model-heading-copy \.tenant-routing-title-with-help \{[^}]*grid-template-columns: auto 20px;[^}]*gap: 8px;/);
  expect(styles).toMatch(/\.tenant-routing-model-heading-copy \.tenant-routing-info-button \{[^}]*width: 20px;[^}]*height: 20px;/);
  expect(styles).toMatch(/\.tenant-routing-model-heading-copy \.tenant-routing-info-button svg \{[^}]*width: 20px;[^}]*height: 20px;/);
  expect(styles).toMatch(/\.tenant-routing-category \.tenant-routing-info-button \{[^}]*width: 18px;[^}]*height: 18px;/);
  expect(styles).toMatch(/\.tenant-routing-category \.tenant-routing-info-button svg \{[^}]*width: 15px;[^}]*height: 15px;/);
  expect(styles).toMatch(/\.tenant-routing-actions \{[^}]*gap: 21px;/);
  expect(styles).toMatch(/\.tenant-routing-actions button \{[^}]*min-width: 207px;[^}]*min-height: 69px;[^}]*padding-inline: 33px;[^}]*font-size: 24px;/);
  expect(styles).toMatch(/\.tenant-routing-save-button \{[^}]*gap: 12px;/);
  expect(styles).toMatch(/\.tenant-routing-save-button svg \{[^}]*width: 27px;[^}]*height: 27px;/);
  expect(source).not.toContain('tenant-routing-enable-card');
  expect(styles).not.toContain('.tenant-routing-enable-card');
});

test("Chat App hides runtime badges and the unavailable-pricing warning", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const stylesUrl = new URL("../../app/globals.css", import.meta.url);
  const source = await readFile(componentSourceUrl, "utf8");
  const styles = await readFile(stylesUrl, "utf8");

  expect(source).not.toContain("<ReadinessBadge");
  expect(source).not.toContain("Snapshot v");
  expect(source).not.toContain("const selectedModelRefs = new Set(");
  expect(source).not.toContain("hasSelectedModelWithoutPricing");
  expect(source).not.toContain("tenant-routing-mock-warning");
  expect(source).not.toContain("비용은 임시로 0원 처리되며");
  expect(styles).not.toContain(".tenant-routing-mock-warning");
});

test("Chat App routing publish recovers from a Control Plane network failure", async () => {
  const componentSourceUrl = new URL("./components/chat-app-routing-setup.tsx", import.meta.url);
  const source = await readFile(componentSourceUrl, "utf8");

  expect(source).toContain('setFeedback({ error: true, message: "Control Plane unavailable." });');
  expect(source).toMatch(/\} finally \{\r?\n {6}setPending\(false\);/);
});

function setupWithRoutes(): TenantChatAdminRuntimeSetup {
  return {
    ...setup,
    activeSnapshot: {
      digest: "sha256:fallback-fixture",
      modelKey: "models/gemini-2.5-flash",
      policyVersion: 1,
      pricingStatus: "current",
      pricingVersion: 1,
      providerConnectionId: "11111111-1111-4111-8111-111111111111",
      publishedAt: "2026-07-16T00:00:00Z",
      snapshotId: "snapshot-fallback-fixture",
      version: 1,
      manualModelRef: "tc_gemini_flash",
      routingMode: "auto",
      routes: {
        general: { simple: { modelRefs: ["tc_gemini_flash"] }, complex: { modelRefs: ["tc_gemini_flash"] } },
        code: { simple: { modelRefs: ["tc_gemini_flash"] }, complex: { modelRefs: ["tc_gemini_flash"] } },
        translation: { simple: { modelRefs: ["tc_gemini_flash"] }, complex: { modelRefs: ["tc_gemini_flash"] } },
        summarization: { simple: { modelRefs: ["tc_gemini_flash"] }, complex: { modelRefs: ["tc_gemini_flash"] } },
        reasoning: { simple: { modelRefs: ["tc_gemini_flash"] }, complex: { modelRefs: ["tc_gemini_flash"] } }
      }
    }
  };
}
