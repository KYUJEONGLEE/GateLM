import { expect, test } from "@playwright/test";
import { buildAnalyticsV5Evidence } from "./analytics-v5-evidence";

test("builds v5 presentation evidence from sanitized Gateway logs", () => {
  const base = {
    applicationId: "app_base",
    costMicroUsd: 0,
    createdAt: "2026-07-12T00:00:00.000Z",
    latencyMs: 0,
    modelRef: "model_base",
    requestedModel: "auto",
    routingReason: null
  };
  const records = [
    {
      ...base,
      applicationId: "app_support",
      costMicroUsd: 3200,
      createdAt: "2026-07-12T00:05:00.000Z",
      latencyMs: 100,
      modelRef: "45b00743-22a8-4bbd-8458-c2feef8134d7:gpt-4o",
      routingReason: "category_difficulty_matrix"
    },
    {
      ...base,
      applicationId: "app_support",
      costMicroUsd: 800,
      createdAt: "2026-07-12T00:20:00.000Z",
      latencyMs: 200,
      modelRef: "45b00743-22a8-4bbd-8458-c2feef8134d7:gpt-4o-mini",
      routingReason: "category_difficulty_matrix"
    },
    {
      ...base,
      applicationId: "app_internal",
      costMicroUsd: 900,
      createdAt: "2026-07-12T00:40:00.000Z",
      latencyMs: 500,
      modelRef: "85a773b1-a477-4647-933e-f563cf30298c:gpt-4o-mini",
      routingReason: "category_difficulty_matrix"
    }
  ];

  const evidence = buildAnalyticsV5Evidence(records, {
    from: "2026-07-12T00:00:00.000Z",
    range: "1h",
    to: "2026-07-12T01:00:00.000Z"
  });

  expect(evidence.modelTraffic.series.find((series) => series.id === "gpt-4o-mini")?.total).toBe(2);
  expect(evidence.modelTraffic.series.map((series) => series.label)).toEqual([
    "gpt-4o-mini",
    "gpt-4o"
  ]);
});
