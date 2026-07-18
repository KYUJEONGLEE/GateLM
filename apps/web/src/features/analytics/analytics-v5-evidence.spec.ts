import { expect, test } from "@playwright/test";
import { buildAnalyticsV5Evidence } from "./analytics-v5-evidence";

test("builds v5 presentation evidence from uncapped executed-model buckets", () => {
  const records = [
    {
      model: "gpt-4o",
      periodStart: "2026-07-12T00:05:00.000Z",
      provider: "openai",
      requestCount: 1200
    },
    {
      model: "gpt-4o-mini",
      periodStart: "2026-07-12T00:20:00.000Z",
      provider: "openai",
      requestCount: 800
    },
    {
      model: "gpt-4o-mini",
      periodStart: "2026-07-12T00:40:00.000Z",
      provider: "azure-openai",
      requestCount: 900
    }
  ];

  const evidence = buildAnalyticsV5Evidence(records, {
    from: "2026-07-12T00:00:00.000Z",
    range: "1h",
    to: "2026-07-12T01:00:00.000Z"
  });

  expect(evidence.modelTraffic.series.find((series) => series.id === "gpt-4o-mini")?.total).toBe(1700);
  expect(evidence.modelTraffic.series.map((series) => series.label)).toEqual([
    "gpt-4o-mini",
    "gpt-4o"
  ]);
  expect(evidence.modelTraffic.series.find((series) => series.id === "gpt-4o")?.total).toBe(1200);
});
