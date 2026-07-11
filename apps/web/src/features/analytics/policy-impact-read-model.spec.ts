import { expect, test } from "@playwright/test";
import { buildPolicyImpactReadModel } from "./policy-impact-read-model";
import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";

test("builds policy impact metrics from canonical dashboard evidence", () => {
  const overview = {
    totalRequests: 20,
    cacheHitRequests: 3,
    blockedRequests: 2,
    rateLimitedRequests: 4,
    fallbackSuccessCount: 1,
    savedCostMicroUsd: 12500,
    maskingActionCounts: {
      blocked: 2,
      redacted: 5
    },
    dataFreshness: {
      generatedAt: "2026-07-12T00:00:00.000Z",
      lastLogCreatedAt: "2026-07-12T00:00:00.000Z",
      recordCount: 20,
      source: "gateway-postgresql"
    },
    range: {
      from: "2026-07-11T00:00:00.000Z",
      grain: "hour",
      timezone: "UTC",
      to: "2026-07-12T00:00:00.000Z"
    },
    queryBudget: {
      guidance: null,
      maxBreakdownItems: 50,
      maxRangeHours: 168,
      status: "ok"
    },
    routingCountByModel: [],
    breakdowns: {
    byApplication: [],
    byBudgetScope: [],
    byCacheOutcome: [
      { outcome: "hit", requestCount: 3 },
      { outcome: "miss", requestCount: 17 }
    ],
    byFallbackOutcome: [
      { outcome: "success", requestCount: 1 },
      { outcome: "not_needed", requestCount: 19 }
    ],
    byProviderModel: [
      {
        p95ProviderLatencyMs: 300,
        requestCount: 8,
        selectedModel: "provider-id:gpt-4o-mini",
        selectedProvider: "openai-main"
      },
      {
        p95ProviderLatencyMs: 320,
        requestCount: 2,
        selectedModel: "provider-id:gpt-4o-mini",
        selectedProvider: "openai-main"
      },
      {
        p95ProviderLatencyMs: 420,
        requestCount: 6,
        selectedModel: "gemini-2.5-flash",
        selectedProvider: "gemini-main"
      }
    ],
    bySafetyOutcome: [
      { outcome: "redacted", requestCount: 5 },
      { outcome: "blocked", requestCount: 2 }
    ],
      byTerminalStatus: []
    }
  } as DashboardOverview;

  const model = buildPolicyImpactReadModel(overview);

  expect(model.metrics).toEqual({
    avoidedProviderCalls: 9,
    protectedRequests: 7,
    savedCostMicroUsd: 12500
  });
  expect(Object.fromEntries(model.outcomes.map((row) => [row.id, row.requestCount]))).toEqual({
    blocked: 2,
    cache_hit: 3,
    fallback: 1,
    pii_masked: 5,
    rate_limited: 4
  });
  expect(model.modelShare).toEqual([
    {
      model: "gpt-4o-mini",
      provider: "openai-main",
      requestCount: 10
    },
    {
      model: "gemini-2.5-flash",
      provider: "gemini-main",
      requestCount: 6
    }
  ]);
});

test("returns an explicit unavailable model instead of inventing analytics data", () => {
  expect(buildPolicyImpactReadModel(undefined)).toMatchObject({
    dataAsOf: null,
    dataState: "unavailable",
    metrics: {
      avoidedProviderCalls: 0,
      protectedRequests: 0,
      savedCostMicroUsd: 0
    },
    modelShare: [],
    totalRequests: 0
  });
});
