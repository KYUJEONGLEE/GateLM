import { expect, test } from "@playwright/test";

import type { ProviderConnectionRecord } from "../src/lib/control-plane/provider-connections-types";
import type {
  RuntimePolicyConfig,
  RuntimePolicyModelConfig
} from "../src/lib/control-plane/runtime-policy-types";
import {
  createRuntimePolicyRoleRoutes,
  getRuntimePolicyModelRoles
} from "../src/lib/control-plane/runtime-policy-types";
import {
  createMockBootstrapRoutingPolicy,
  getRoutingModelRef,
  getRoutingModelOptions,
  getRoutingProviderOptions,
  getSelectedRoutingProviderConnections,
  getWritableRuntimePolicyDraftValues,
  groupRoutingModelsByProvider,
  hasResolvableRoutingMatrix,
  isMandatorySafetyDetector,
  parseBoundedInteger
} from "../src/features/policies/components/runtime-policy-editor-utils";

test("bounded integer parsing clamps values and falls back to minimum", () => {
  expect(parseBoundedInteger("42", 1, 100)).toBe(42);
  expect(parseBoundedInteger("-5", 1, 100)).toBe(1);
  expect(parseBoundedInteger("900", 1, 100)).toBe(100);
  expect(parseBoundedInteger("not-a-number", 1, 100)).toBe(1);
});

test("routing models are grouped from provider connection configured models", () => {
  const modelOptions = groupRoutingModelsByProvider([], [
    createProviderConnection("provider-a", "active-provider", ["fast", "backup"]),
    createProviderConnection("provider-b", "disabled-provider", ["disabled"], "DISABLED")
  ]);

  expect(modelOptions.get("active-provider")?.map((model) => model.model)).toEqual([
    "fast",
    "backup"
  ]);
  expect(modelOptions.get("disabled-provider")?.[0]?.status).toBe("disabled");
});

test("writable drafts preserve the complete saved matrix without tier normalization", () => {
  const config = createRuntimePolicyConfig();
  const draft = getWritableRuntimePolicyDraftValues(config);

  expect(draft.routingPolicy).toEqual({
    bootstrapState: "mock_bootstrap",
    mode: "auto",
    routes: config.routingPolicy.routes
  });
});

test("selected provider connections are derived from opaque modelRefs", () => {
  const first = createProviderConnection("provider-a", "openai", ["gpt-a"]);
  const second = createProviderConnection("provider-b", "anthropic", ["claude-b"]);
  const draft = getWritableRuntimePolicyDraftValues(createRuntimePolicyConfig());
  draft.routingPolicy.routes.general.simple.modelRefs = [
    getRoutingModelRef(first, "gpt-a"),
    getRoutingModelRef(second, "claude-b")
  ];

  expect(
    getSelectedRoutingProviderConnections(draft, [first, second]).map(
      (connection) => connection.id
    )
  ).toEqual(["provider-a", "provider-b"]);
});

test("mock is resolvable without a tenant provider and unknown refs are not", () => {
  const policy = createMockBootstrapRoutingPolicy();
  expect(hasResolvableRoutingMatrix(policy, [])).toBe(true);

  policy.routes.reasoning.complex.modelRefs = ["missing:model"];
  expect(hasResolvableRoutingMatrix(policy, [])).toBe(false);
});

test("fallback cannot duplicate either primary role", () => {
  const routes = createRuntimePolicyRoleRoutes({
    complexModelRef: "provider-a:model-a",
    fallbackModelRef: "provider-a:model-a",
    simpleModelRef: "provider-a:model-a"
  });

  expect(routes.general.simple.modelRefs).toEqual(["provider-a:model-a"]);
  expect(getRuntimePolicyModelRoles(routes)?.fallbackModelRef).toBeNull();
});

test("routing provider options use display names and provider families", () => {
  const options = getRoutingProviderOptions(
    [createProviderConnection("provider-gemini", "gemini-provider", ["gemini-model"])],
    [],
    []
  );

  expect(options[0]).toMatchObject({
    provider: "gemini-provider",
    providerId: "provider-gemini"
  });
});

test("all active tenant provider models are available as routing candidates", () => {
  const openai = createProviderConnection("provider-openai", "openai-main", ["gpt-4o-mini"]);
  const gemini = createProviderConnection("provider-gemini", "gemini-main", [
    "gemini-2.5-flash"
  ]);
  const disabled = createProviderConnection(
    "provider-disabled",
    "anthropic-main",
    ["claude-sonnet-4"],
    "DISABLED"
  );
  const projectScoped = {
    ...createProviderConnection("provider-project", "project-only", ["project-model"]),
    projectId: "project-test"
  };

  expect(getRoutingModelOptions([openai, gemini, disabled, projectScoped])).toEqual([
    {
      family: "openai",
      label: "openai-main / gpt-4o-mini",
      modelName: "gpt-4o-mini",
      modelRef: "provider-openai:gpt-4o-mini",
      providerConnectionId: "provider-openai",
      providerDisplayName: "openai-main",
      providerName: "openai-main"
    },
    {
      family: "gemini",
      label: "gemini-main / gemini-2.5-flash",
      modelName: "gemini-2.5-flash",
      modelRef: "provider-gemini:gemini-2.5-flash",
      providerConnectionId: "provider-gemini",
      providerDisplayName: "gemini-main",
      providerName: "gemini-main"
    }
  ]);
});

test("mandatory safety detector classification stays fixed", () => {
  expect(isMandatorySafetyDetector("api_key")).toBe(true);
  expect(isMandatorySafetyDetector("authorization_header")).toBe(true);
  expect(isMandatorySafetyDetector("email")).toBe(false);
});

function createRuntimePolicyConfig(): RuntimePolicyConfig {
  const routingPolicy = createMockBootstrapRoutingPolicy();

  return {
    applicationId: "application-test",
    budgetPolicy: {
      enabled: true,
      enforcementMode: "warn",
      warningThresholdPercent: 80
    },
    cachePolicy: { enabled: true, ttlSeconds: 300, type: "exact" },
    configHash: "sha256:test",
    configVersion: "runtime-config-test",
    effectiveAt: "2026-07-13T00:00:00.000Z",
    generatedAt: "2026-07-13T00:00:00.000Z",
    models: [] as RuntimePolicyModelConfig[],
    pricingRules: [],
    providers: [],
    publishState: "draft",
    publishedAt: "",
    rateLimit: {
      algorithm: "fixed_window",
      enabled: true,
      limit: 1000,
      scope: "application",
      windowSeconds: 10
    },
    routingPolicy: {
      ...routingPolicy,
      routingPolicyHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      schemaVersion: "gatelm.routing-policy.v2"
    },
    schemaVersion: "gatelm.active-runtime-config.v2",
    tenantId: "tenant-test"
  };
}

function createProviderConnection(
  id: string,
  provider: string,
  models: string[],
  status: ProviderConnectionRecord["status"] = "ACTIVE"
): ProviderConnectionRecord {
  return {
    baseUrl: provider.includes("gemini")
      ? "https://generativelanguage.googleapis.com"
      : "https://provider.invalid",
    createdAt: "2026-07-13T00:00:00.000Z",
    credentialPreview: { last4: null, prefix: null },
    displayName: provider,
    id,
    projectId: null,
    provider,
    providerConfig: { models },
    resolver: "none",
    status,
    tenantId: "tenant-test",
    timeoutMs: 30000,
    updatedAt: "2026-07-13T00:00:00.000Z"
  };
}
