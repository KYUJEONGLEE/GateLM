import { expect, test } from "@playwright/test";
import { buildAnalyticsOverviewReadModel } from "./analytics-overview-read-model";
import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";

test("builds detailed analytics domains from one dashboard overview contract", () => {
  const overview = {
    blockedRequests: 1,
    breakdowns: {
      byApplication: [],
      byBudgetScope: [],
      byCacheOutcome: [
        { outcome: "hit", requestCount: 3 },
        { outcome: "miss", requestCount: 5 },
        { outcome: "bypass", requestCount: 2 }
      ],
      byFallbackOutcome: [{ outcome: "success", requestCount: 2 }],
      byProviderModel: [
        {
          p95ProviderLatencyMs: 450,
          requestCount: 6,
          selectedModel: "provider-id:gpt-4o-mini",
          selectedProvider: "openai-main"
        },
        {
          p95ProviderLatencyMs: 620,
          requestCount: 4,
          selectedModel: "gemini-2.5-flash",
          selectedProvider: "gemini-main"
        }
      ],
      bySafetyOutcome: [],
      byTerminalStatus: [
        { outcome: "success", requestCount: 7 },
        { outcome: "blocked", requestCount: 1 },
        { outcome: "rate_limited", requestCount: 1 },
        { outcome: "failed", requestCount: 1 }
      ]
    },
    cacheEligibleRequests: 8,
    cacheHitRate: 0.375,
    cacheHitRequests: 3,
    completionTokens: 50,
    costByModel: [
      {
        costMicroUsd: 3000,
        costUsd: "0.003000",
        requestCount: 6,
        selectedModel: "provider-id:gpt-4o-mini",
        selectedProvider: "openai-main",
        totalTokens: 100
      },
      {
        costMicroUsd: 2000,
        costUsd: "0.002000",
        requestCount: 4,
        selectedModel: "gemini-2.5-flash",
        selectedProvider: "gemini-main",
        totalTokens: 50
      }
    ],
    costByProject: [
      {
        completionTokens: 50,
        costMicroUsd: 5000,
        costUsd: "0.005000",
        projectId: "project-1",
        promptTokens: 100,
        requestCount: 10,
        totalTokens: 150
      }
    ],
    dataFreshness: {
      generatedAt: "2026-07-12T00:00:00.000Z",
      lastLogCreatedAt: "2026-07-12T00:00:00.000Z",
      recordCount: 10,
      source: "gateway-postgresql"
    },
    exactCacheHitRate: 0.375,
    failedRequests: 1,
    fallbackSuccessCount: 2,
    performance: {
      p95GatewayInternalLatencyMs: 80,
      p95ProviderLatencyMs: 620,
      p99GatewayInternalLatencyMs: 110,
      p99ProviderLatencyMs: 800,
      systemErrorRate: 0.1
    },
    promptTokens: 100,
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
    rateLimitedRequests: 1,
    routingCountByModel: [],
    savedCostMicroUsd: 1000,
    statusCounts: {},
    successfulRequests: 7,
    totalCostMicroUsd: 5000,
    totalRequests: 10,
    totalTokens: 150
  } as unknown as DashboardOverview;

  const model = buildAnalyticsOverviewReadModel(overview);

  expect(model.usage).toMatchObject({
    activeModels: 2,
    totalRequests: 10,
    totalTokens: 150
  });
  expect(model.cost.costPerRequestMicroUsd).toBe(500);
  expect(model.reliability).toMatchObject({
    fallbackSuccesses: 2,
    successRate: 0.7,
    systemErrorRate: 0.1
  });
  expect(Object.fromEntries(model.cache.outcomes.map((row) => [row.id, row.value]))).toEqual({
    bypass: 2,
    hit: 3,
    miss: 5
  });
});

test("keeps unavailable detailed analytics explicit", () => {
  expect(buildAnalyticsOverviewReadModel(undefined)).toMatchObject({
    dataAsOf: null,
    dataState: "unavailable",
    usage: {
      activeModels: 0,
      totalRequests: 0,
      totalTokens: 0
    }
  });
});
