import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import {
  normalizeDashboardRoutingSummaries,
  normalizeModelCostRows,
  normalizeProviderAttempt,
  normalizeRequestDetailRouting,
  normalizeRequestRouting
} from "./live-observability-contract";

test("request routing exposes classification and the requested model without an execution target", () => {
  const routing = normalizeRequestRouting({
    requestedModel: "auto",
    category: "code",
    difficulty: "complex",
    modelRef: "catalog:code-complex",
    routingReason: "category_difficulty_matrix",
    selectedProvider: "must-not-survive",
    selectedModel: "must-not-survive",
    provider: "must-not-survive",
    model: "must-not-survive"
  });

  expect(routing).toEqual({
    requestedModel: "auto",
    category: "code",
    difficulty: "complex",
    modelRef: "catalog:code-complex",
    routingReason: "category_difficulty_matrix"
  });
  expect(JSON.stringify(routing)).not.toContain("must-not-survive");
});

test("provider attempt is the only request-detail execution-target boundary", () => {
  const attempt = normalizeProviderAttempt({
    providerId: "provider-openai",
    modelId: "gpt-4.1-mini",
    outcome: "succeeded",
    latencyMs: 148,
    sanitizedErrorCode: null,
    rawErrorBody: "must-not-survive"
  });

  expect(attempt).toEqual({
    providerId: "provider-openai",
    modelId: "gpt-4.1-mini",
    outcome: "succeeded",
    latencyMs: 148,
    sanitizedErrorCode: null
  });
  expect(JSON.stringify(attempt)).not.toContain("rawErrorBody");
});

test("request detail reads classification from its nested routing evidence", () => {
  const routing = normalizeRequestDetailRouting("auto", {
    category: "reasoning",
    difficulty: "complex",
    modelRef: "catalog:reasoning-complex",
    routingReason: "category_difficulty_matrix"
  });

  expect(routing).toEqual({
    requestedModel: "auto",
    category: "reasoning",
    difficulty: "complex",
    modelRef: "catalog:reasoning-complex",
    routingReason: "category_difficulty_matrix"
  });
});

test("dashboard routing summaries and model costs remain separate contracts", () => {
  const routingSummaries = normalizeDashboardRoutingSummaries([
    {
      category: "translation",
      difficulty: "simple",
      routingReason: "category_difficulty_matrix",
      requestCount: 7,
      provider: "must-not-survive",
      model: "must-not-survive"
    }
  ]);
  const modelCosts = normalizeModelCostRows([
    {
      provider: "openai",
      model: "gpt-4.1-mini",
      requestCount: 7,
      totalTokens: 420,
      costMicroUsd: 1900,
      costUsd: "0.001900"
    }
  ]);

  expect(routingSummaries).toEqual([
    {
      category: "translation",
      difficulty: "simple",
      routingReason: "category_difficulty_matrix",
      requestCount: 7
    }
  ]);
  expect(modelCosts).toEqual([
    {
      provider: "openai",
      model: "gpt-4.1-mini",
      requestCount: 7,
      totalTokens: 420,
      costMicroUsd: 1900,
      costUsd: "0.001900"
    }
  ]);
});

test("customer demo proxy does not forward retired selected-target headers", async () => {
  const source = await readFile(
    new URL("../../app/api/customer-demo/chat/route.ts", import.meta.url),
    "utf8"
  );

  expect(source).not.toContain("X-GateLM-Routed-Provider");
  expect(source).not.toContain("X-GateLM-Routed-Model");
});
