import { expect, test } from "@playwright/test";
import { buildAnalyticsReadModel } from "./analytics-read-model";
import type { LiveDashboardOverview } from "@/lib/gateway/live-dashboard-overview";

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
          model: "provider-id:gpt-4o-mini",
          provider: "openai-main"
        },
        {
          p95ProviderLatencyMs: 520,
          requestCount: 8,
          model: "gemini-2.5-flash",
          provider: "gemini-main"
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
        model: "provider-id:gpt-4o-mini",
        provider: "openai-main",
        totalTokens: 1000
      },
      {
        costMicroUsd: 3000,
        costUsd: "0.003000",
        requestCount: 8,
        model: "gemini-2.5-flash",
        provider: "gemini-main",
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
    routingSummaries: [
      {
        category: "general",
        difficulty: "simple",
        requestCount: 8,
        routingReason: "category_difficulty_matrix"
      },
      {
        category: "reasoning",
        difficulty: "complex",
        requestCount: 4,
        routingReason: "category_difficulty_matrix"
      },
      {
        category: "translation",
        difficulty: "simple",
        requestCount: 6,
        routingReason: "category_difficulty_matrix"
      },
      {
        category: "code",
        difficulty: "complex",
        requestCount: 2,
        routingReason: "category_difficulty_matrix"
      }
    ],
    savedCostMicroUsd: 2000,
    statusCounts: {},
    successfulRequests: 15,
    totalCostMicroUsd: 8000,
    totalRequests: 20,
    totalTokens: 1600
  } as unknown as LiveDashboardOverview;

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
  expect(Object.fromEntries(model.impact.routingDifficulties.map((row) => [row.id, row.value]))).toEqual({
    complex: 6,
    simple: 14
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
    continuityPaths: [
      { id: "direct_success", label: "DIRECT SUCCESS", value: 14 },
      { id: "fallback_success", label: "FALLBACK RECOVERED", value: 1 },
      { id: "failed", label: "FAILED", value: 1 },
      { id: "cancelled", label: "CANCELLED", value: 0 }
    ],
    fallbackSuccesses: 1,
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

test("tolerates partial legacy aggregate collections", () => {
  const overview = {
    blockedRequests: 0,
    cacheEligibleRequests: 0,
    cacheHitRate: 0,
    cacheHitRequests: 0,
    completionTokens: 0,
    dataFreshness: {
      generatedAt: "2026-07-12T00:00:00.000Z",
      lastLogCreatedAt: null,
      recordCount: 0,
      source: "gateway-postgresql"
    },
    exactCacheHitRate: 0,
    failedRequests: 0,
    fallbackSuccessCount: 0,
    maskingActionCounts: {},
    promptTokens: 0,
    range: {
      from: "2026-07-11T00:00:00.000Z",
      grain: "hour",
      timezone: "UTC",
      to: "2026-07-12T00:00:00.000Z"
    },
    rateLimitedRequests: 0,
    savedCostMicroUsd: 0,
    successfulRequests: 0,
    totalCostMicroUsd: 0,
    totalRequests: 0,
    totalTokens: 0,
    routingSummaries: []
  } as unknown as LiveDashboardOverview;

  const model = buildAnalyticsReadModel(overview);

  expect(model.impact.modelMix).toEqual([]);
  expect(model.impact.routingDifficulties).toEqual([]);
  expect(model.cost.costByModel).toEqual([]);
  expect(model.reliability.terminalOutcomes).toEqual([]);
});
