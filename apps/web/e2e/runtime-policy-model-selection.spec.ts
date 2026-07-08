import { expect, test } from "@playwright/test";

import {
  applyInitialRuntimePolicyModelSelection,
  applyPrimaryRuntimePolicyRouteSelection
} from "../src/lib/control-plane/runtime-policy-model-selection";
import type {
  RuntimePolicyDraftValues,
  RuntimePolicyModelConfig
} from "../src/lib/control-plane/runtime-policy-types";

test("initial model selection applies the selected model to all routing tiers", () => {
  const draftValues = createDraftValues();
  const selectedModel: RuntimePolicyModelConfig = {
    contextWindowTokens: 128000,
    displayName: "Balanced Two",
    model: "balanced-v2",
    provider: "provider-two",
    status: "active",
    supportsJsonMode: true,
    supportsStreaming: true
  };

  const nextValues = applyInitialRuntimePolicyModelSelection(draftValues, selectedModel, {
    warningThresholdPercent: 75
  });

  expect(nextValues).toMatchObject({
    budgetWarningThresholdPercent: 75,
    routingDefaultModel: "balanced-v2",
    routingDefaultProvider: "provider-two",
    routingFallbackModel: "balanced-v2",
    routingFallbackProvider: "provider-two",
    routingLowCostModel: "balanced-v2",
    routingLowCostProvider: "provider-two"
  });
  expect(draftValues).toMatchObject({
    budgetWarningThresholdPercent: 80,
    routingFallbackModel: "fallback-v1",
    routingFallbackProvider: "provider-fallback",
    routingLowCostModel: "cheap-v1",
    routingLowCostProvider: "provider-cheap"
  });
});

test("primary route selection updates every auto routing tier", () => {
  const draftValues = createDraftValues();

  const nextValues = applyPrimaryRuntimePolicyRouteSelection(draftValues, {
    model: "balanced-v2",
    provider: "provider-two"
  });

  expect(nextValues).toMatchObject({
    budgetWarningThresholdPercent: 80,
    routingDefaultModel: "balanced-v2",
    routingDefaultProvider: "provider-two",
    routingFallbackModel: "balanced-v2",
    routingFallbackProvider: "provider-two",
    routingLowCostModel: "balanced-v2",
    routingLowCostProvider: "provider-two"
  });
  expect(draftValues.routingLowCostModel).toBe("cheap-v1");
});

function createDraftValues(): RuntimePolicyDraftValues {
  return {
    budgetEnabled: true,
    budgetEnforcementMode: "warn",
    budgetWarningThresholdPercent: 80,
    cacheEnabled: true,
    cacheTtlSeconds: 300,
    configVersion: "runtime_config_test",
    detectors: [],
    models: [
      {
        contextWindowTokens: 8192,
        displayName: "Cheap One",
        model: "cheap-v1",
        provider: "provider-cheap",
        status: "active",
        supportsJsonMode: false,
        supportsStreaming: false
      },
      {
        contextWindowTokens: 128000,
        displayName: "Balanced Two",
        model: "balanced-v2",
        provider: "provider-two",
        status: "active",
        supportsJsonMode: true,
        supportsStreaming: true
      }
    ],
    pricingRules: [],
    promptCaptureEnabled: false,
    promptCaptureMaxChars: 8000,
    rateLimitEnabled: true,
    rateLimitLimit: 1000,
    rateLimitRefillTokensPerSecond: 100,
    rateLimitWindowSeconds: 10,
    responseCaptureEnabled: false,
    responseCaptureMaxChars: 8000,
    routingDefaultModel: "default-v1",
    routingDefaultProvider: "provider-default",
    routingFallbackModel: "fallback-v1",
    routingFallbackProvider: "provider-fallback",
    routingLowCostModel: "cheap-v1",
    routingLowCostProvider: "provider-cheap",
    routingShortPromptMaxChars: 2000
  };
}
