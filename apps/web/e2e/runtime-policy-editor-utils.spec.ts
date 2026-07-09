import { expect, test } from "@playwright/test";

import type { ProviderConnectionRecord } from "../src/lib/control-plane/provider-connections-types";
import type {
  RuntimePolicyConfig,
  RuntimePolicyDraftValues,
  RuntimePolicyModelConfig
} from "../src/lib/control-plane/runtime-policy-types";
import {
  getRoutingProviderOptions,
  getSelectedRoutingProviderConnections,
  getSelectedRoutingProviderNames,
  getWritableRuntimePolicyDraftValues,
  groupRoutingModelsByProvider,
  hasRoutingModelSelection,
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
  const modelOptionsByProvider = groupRoutingModelsByProvider(
    [createRuntimeModel("ignored-provider", "ignored-model")],
    [
      createProviderConnection({
        models: ["fast-model", "backup-model"],
        provider: "active-provider"
      }),
      createProviderConnection({
        models: ["disabled-model"],
        provider: "disabled-provider",
        status: "DISABLED"
      })
    ]
  );

  expect(modelOptionsByProvider.get("active-provider")?.map((model) => model.model)).toEqual([
    "fast-model",
    "backup-model"
  ]);
  expect(modelOptionsByProvider.get("disabled-provider")?.[0]).toMatchObject({
    model: "disabled-model",
    status: "disabled"
  });
  expect(modelOptionsByProvider.has("ignored-provider")).toBe(false);
});

test("writable draft values normalize missing routes to the first active provider model", () => {
  const draftValues = getWritableRuntimePolicyDraftValues(createRuntimePolicyConfig(), [
    createProviderConnection({
      displayName: "Active provider",
      id: "provider-connection-active",
      models: ["fast-model", "backup-model"],
      provider: "active-provider"
    }),
    createProviderConnection({
      id: "provider-connection-disabled",
      models: ["disabled-model"],
      provider: "disabled-provider",
      status: "DISABLED"
    })
  ]);

  expect(draftValues).toMatchObject({
    routingDefaultModel: "fast-model",
    routingDefaultProvider: "active-provider",
    routingFallbackModel: "fast-model",
    routingFallbackProvider: "active-provider",
    routingHighQualityModel: "fast-model",
    routingHighQualityProvider: "active-provider",
    routingLowCostModel: "fast-model",
    routingLowCostProvider: "active-provider"
  });
});

test("selected routing provider connections are deduplicated and require configured models", () => {
  const draftValues = createDraftValues({
    routingDefaultProvider: "active-provider",
    routingFallbackProvider: "empty-provider",
    routingLowCostProvider: "active-provider"
  });
  const providerConnections = [
    createProviderConnection({
      id: "provider-connection-active",
      models: ["fast-model"],
      provider: "active-provider"
    }),
    createProviderConnection({
      id: "provider-connection-empty",
      models: [],
      provider: "empty-provider"
    })
  ];

  expect(getSelectedRoutingProviderNames(draftValues)).toEqual([
    "active-provider",
    "empty-provider"
  ]);
  expect(
    getSelectedRoutingProviderConnections(draftValues, providerConnections).map(
      (providerConnection) => providerConnection.id
    )
  ).toEqual(["provider-connection-active"]);
});

test("routing candidate checks require an active selected model", () => {
  const modelOptionsByProvider = groupRoutingModelsByProvider([], [
    createProviderConnection({
      models: ["fast-model"],
      provider: "active-provider"
    }),
    createProviderConnection({
      models: ["disabled-model"],
      provider: "disabled-provider",
      status: "DISABLED"
    })
  ]);

  expect(hasRoutingModelSelection("active-provider", "fast-model", modelOptionsByProvider)).toBe(
    true
  );
  expect(
    hasRoutingModelSelection("disabled-provider", "disabled-model", modelOptionsByProvider)
  ).toBe(false);
  expect(hasRoutingModelSelection("active-provider", "missing-model", modelOptionsByProvider)).toBe(
    false
  );
});

test("routing provider options use display names and provider families from connections", () => {
  const providerOptions = getRoutingProviderOptions(
    [
      createProviderConnection({
        displayName: "Gemini production",
        models: ["gemini-model"],
        provider: "gemini-provider",
        providerConfig: {
          models: ["gemini-model"],
          providerFamily: "gemini"
        }
      }),
      createProviderConnection({
        displayName: "Empty provider",
        models: [],
        provider: "empty-provider"
      })
    ],
    [],
    []
  );

  expect(providerOptions).toEqual([
    {
      displayName: "Gemini production",
      family: "gemini",
      provider: "gemini-provider",
      providerId: "provider-connection-gemini-provider"
    }
  ]);
});

test("mandatory safety detector classification stays fixed", () => {
  expect(isMandatorySafetyDetector("api_key")).toBe(true);
  expect(isMandatorySafetyDetector("authorization_header")).toBe(true);
  expect(isMandatorySafetyDetector("email")).toBe(false);
});

function createRuntimePolicyConfig(): RuntimePolicyConfig {
  return {
    applicationId: "application-test",
    budgetPolicy: {
      enabled: true,
      enforcementMode: "warn",
      warningThresholdPercent: 80
    },
    cachePolicy: {
      enabled: true,
      ttlSeconds: 300,
      type: "exact"
    },
    configHash: "sha256:test-runtime-policy",
    configVersion: "runtime-config-test",
    effectiveAt: "2026-07-09T00:00:00.000Z",
    generatedAt: "2026-07-09T00:00:00.000Z",
    models: [createRuntimeModel("stale-provider", "stale-model")],
    pricingRules: [],
    promptCapturePolicy: {
      enabled: false,
      maxChars: 8000,
      mode: "disabled"
    },
    providers: [],
    publishState: "draft",
    publishedAt: "",
    rateLimit: {
      algorithm: "token_bucket",
      enabled: true,
      limit: 1000,
      scope: "application",
      windowSeconds: 10
    },
    responseCapturePolicy: {
      enabled: false,
      maxChars: 8000,
      mode: "disabled"
    },
    routingPolicy: {
      defaultModel: "stale-model",
      defaultProvider: "stale-provider",
      fallbackModel: "disabled-model",
      fallbackProvider: "disabled-provider",
      highQualityModel: "stale-model",
      highQualityProvider: "stale-provider",
      lowCostModel: "fast-model",
      lowCostProvider: "active-provider",
      routingPolicyHash: "sha256:test-routing-policy",
      shortPromptMaxChars: 2000
    },
    safetyPolicy: {
      detectors: [],
      mode: "rule_based",
      securityPolicyHash: "sha256:test-security-policy"
    },
    tenantId: "tenant-test"
  };
}

function createDraftValues(
  overrides: Partial<RuntimePolicyDraftValues> = {}
): RuntimePolicyDraftValues {
  return {
    budgetEnabled: true,
    budgetEnforcementMode: "warn",
    budgetWarningThresholdPercent: 80,
    cacheEnabled: true,
    cacheTtlSeconds: 300,
    configVersion: "runtime-config-test",
    detectors: [],
    models: [],
    pricingRules: [],
    promptCaptureEnabled: false,
    promptCaptureMaxChars: 8000,
    rateLimitEnabled: true,
    rateLimitLimit: 1000,
    rateLimitRefillTokensPerSecond: 100,
    rateLimitWindowSeconds: 10,
    responseCaptureEnabled: false,
    responseCaptureMaxChars: 8000,
    routingDefaultModel: "fast-model",
    routingDefaultProvider: "active-provider",
    routingFallbackModel: "fast-model",
    routingFallbackProvider: "active-provider",
    routingHighQualityModel: "fast-model",
    routingHighQualityProvider: "active-provider",
    routingLowCostModel: "fast-model",
    routingLowCostProvider: "active-provider",
    routingShortPromptMaxChars: 2000,
    ...overrides
  };
}

function createProviderConnection({
  displayName,
  id,
  models,
  provider,
  providerConfig,
  status = "ACTIVE"
}: {
  displayName?: string;
  id?: string;
  models: string[];
  provider: string;
  providerConfig?: Record<string, unknown>;
  status?: ProviderConnectionRecord["status"];
}): ProviderConnectionRecord {
  return {
    baseUrl: "",
    createdAt: "2026-07-09T00:00:00.000Z",
    credentialPreview: {
      last4: null,
      prefix: null
    },
    displayName: displayName ?? provider,
    id: id ?? `provider-connection-${provider}`,
    projectId: "project-test",
    provider,
    providerConfig: providerConfig ?? { models },
    resolver: "control_plane_secret_store",
    status,
    tenantId: "tenant-test",
    timeoutMs: 30000,
    updatedAt: "2026-07-09T00:00:00.000Z"
  };
}

function createRuntimeModel(
  provider: string,
  model: string,
  status: RuntimePolicyModelConfig["status"] = "active"
): RuntimePolicyModelConfig {
  return {
    contextWindowTokens: 128000,
    displayName: model,
    model,
    provider,
    status,
    supportsJsonMode: true,
    supportsStreaming: true
  };
}
