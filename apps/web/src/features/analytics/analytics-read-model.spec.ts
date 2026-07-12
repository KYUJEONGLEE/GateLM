import { expect, test } from "@playwright/test";
import { buildAnalyticsReadModel } from "./analytics-read-model";
import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";

test("builds an executive analytics model from canonical Gateway evidence", () => {
  const overview = {
    blockedRequests: 2,
    breakdowns: {
      byApplication: [
        { applicationId: "app-support", estimatedCostMicroUsd: 5000, requestCount: 12 },
        { applicationId: "app-ops", estimatedCostMicroUsd: 3000, requestCount: 8 }
      ],
      byBudgetScope: [],
      byCacheOutcome: [
        { outcome: "hit", requestCount: 3 },
        { outcome: "miss", requestCount: 12 },
        { outcome: "bypass", requestCount: 5 }
      ],
      byFallbackOutcome: [{ outcome: "success", requestCount: 1 }],
      byProviderModel: [
        {
          p95ProviderLatencyMs: 410,
          requestCount: 12,
          selectedModel: "provider-id:gpt-4o-mini",
          selectedProvider: "openai-main"
        },
        {
          p95ProviderLatencyMs: 520,
          requestCount: 8,
          selectedModel: "gemini-2.5-flash",
          selectedProvider: "gemini-main"
        }
      ],
      bySafetyOutcome: [
        { outcome: "redacted", requestCount: 4 },
        { outcome: "blocked", requestCount: 2 }
      ],
      byTerminalStatus: [
        { outcome: "success", requestCount: 15 },
        { outcome: "blocked", requestCount: 2 },
        { outcome: "rate_limited", requestCount: 2 },
        { outcome: "failed", requestCount: 1 }
      ]
    },
    cacheEligibleRequests: 15,
    cacheHitRate: 0.2,
    cacheHitRequests: 3,
    completionTokens: 600,
    costByModel: [
      {
        costMicroUsd: 5000,
        costUsd: "0.005000",
        requestCount: 12,
        selectedModel: "provider-id:gpt-4o-mini",
        selectedProvider: "openai-main",
        totalTokens: 1000
      },
      {
        costMicroUsd: 3000,
        costUsd: "0.003000",
        requestCount: 8,
        selectedModel: "gemini-2.5-flash",
        selectedProvider: "gemini-main",
        totalTokens: 600
      }
    ],
    costByProject: [
      {
        completionTokens: 600,
        costMicroUsd: 8000,
        costUsd: "0.008000",
        projectId: "project-1",
        promptTokens: 1000,
        requestCount: 20,
        totalTokens: 1600
      }
    ],
    dataFreshness: {
      generatedAt: "2026-07-12T00:00:00.000Z",
      lastLogCreatedAt: "2026-07-12T00:00:00.000Z",
      recordCount: 20,
      source: "gateway-postgresql"
    },
    exactCacheHitRate: 0.2,
    failedRequests: 1,
    fallbackSuccessCount: 1,
    maskingActionCounts: { blocked: 2, redacted: 4 },
    performance: {
      p95GatewayInternalLatencyMs: 90,
      p95ProviderLatencyMs: 520,
      p99GatewayInternalLatencyMs: 130,
      p99ProviderLatencyMs: 710,
      systemErrorRate: 0.05
    },
    promptTokens: 1000,
    queryBudget: {
      guidance: null,
      maxBreakdownItems: 50,
      maxRangeHours: 168,
      status: "ok"
    },
    range: {
      from: "2026-07-11T00:00:00.000Z",
      grain: "hour",
      timezone: "UTC",
      to: "2026-07-12T00:00:00.000Z"
    },
    rateLimitedRequests: 2,
    routingCountByModel: [],
    savedCostMicroUsd: 2000,
    statusCounts: {},
    successfulRequests: 15,
    totalCostMicroUsd: 8000,
    totalRequests: 20,
    totalTokens: 1600
  } as unknown as DashboardOverview;

  const model = buildAnalyticsReadModel(overview);

  expect(model.impact).toMatchObject({
    avoidedProviderCallRate: 0.35,
    avoidedProviderCalls: 7,
    protectedRequestRate: 0.3,
    protectedRequests: 6,
    savedCostMicroUsd: 2000,
    spendAvoidanceRate: 0.2
  });
  expect(Object.fromEntries(model.impact.requestDisposition.map((row) => [row.id, row.value]))).toEqual({
    cache: 3,
    guardrail: 4,
    provider: 13
  });
  expect(model.usage).toMatchObject({
    activeModels: 2,
    projectMix: [{ id: "project-1", label: "project-1", value: 20 }],
    tokensPerRequest: 80,
    totalRequests: 20,
    totalTokens: 1600
  });
  expect(model.cost).toMatchObject({
    avoidedSpendRate: 0.2,
    costPerRequestMicroUsd: 400,
    totalCostMicroUsd: 8000
  });
  expect(model.reliability).toMatchObject({
    fallbackSuccesses: 1,
    gatewayP95LatencyMs: 90,
    providerP95LatencyMs: 520,
    successRate: 0.75,
    systemErrorRate: 0.05
  });
});

test("keeps unavailable analytics explicit without synthetic values", () => {
  expect(buildAnalyticsReadModel(undefined)).toMatchObject({
    dataAsOf: null,
    dataState: "unavailable",
    impact: {
      avoidedProviderCalls: 0,
      protectedRequests: 0,
      savedCostMicroUsd: 0
    },
    source: "gateway-dashboard-overview",
    totalRequests: 0
  });
});
