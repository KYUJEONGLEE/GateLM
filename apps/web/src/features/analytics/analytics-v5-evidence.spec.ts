import { expect, test } from "@playwright/test";
import { buildAnalyticsV5Evidence } from "./analytics-v5-evidence";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";

test("builds v5 presentation evidence from sanitized Gateway logs", () => {
  const base = {
    applicationId: "app_base",
    costMicroUsd: 0,
    createdAt: "2026-07-12T00:00:00.000Z",
    latencyMs: 0,
    projectId: "project_base",
    requestedModel: "auto",
    routingReason: null,
    selectedModel: "model_base"
  } as InvocationLogRecord;
  const records = [
    {
      ...base,
      applicationId: "app_support",
      costMicroUsd: 3200,
      createdAt: "2026-07-12T00:05:00.000Z",
      latencyMs: 100,
      projectId: "project_support",
      routingReason: "category_reasoning_high_quality",
      selectedModel: "gpt-4o"
    },
    {
      ...base,
      applicationId: "app_support",
      costMicroUsd: 800,
      createdAt: "2026-07-12T00:20:00.000Z",
      latencyMs: 200,
      projectId: "project_support",
      routingReason: "short_prompt_low_cost",
      selectedModel: "gpt-4o-mini"
    },
    {
      ...base,
      applicationId: "app_internal",
      costMicroUsd: 900,
      createdAt: "2026-07-12T00:40:00.000Z",
      latencyMs: 500,
      projectId: "project_internal",
      routingReason: "budget_downgraded_from_high_quality",
      selectedModel: "gpt-4o-mini"
    }
  ];

  const evidence = buildAnalyticsV5Evidence(records, {
    from: "2026-07-12T00:00:00.000Z",
    range: "1h",
    to: "2026-07-12T01:00:00.000Z"
  });

  expect(evidence.recordCount).toBe(3);
  expect(evidence.highQualityRequests).toBe(1);
  expect(evidence.highQualityRate).toBeCloseTo(1 / 3);
  expect(evidence.latency).toEqual({ p50Ms: 200, p95Ms: 500, p99Ms: 500 });
  expect(evidence.projectUsage[0]).toEqual({
    costMicroUsd: 4000,
    projectId: "project_support",
    requestCount: 2
  });
  expect(evidence.modelTraffic.series.find((series) => series.id === "gpt-4o-mini")?.total).toBe(2);
});
