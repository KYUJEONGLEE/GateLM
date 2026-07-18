import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import type { TenantChatCostSeries } from "@/lib/control-plane/tenant-chat-observability-client";
import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import type { AnalyticsLatencyDistributionPoint } from "@/lib/gateway/live-analytics-performance";

import {
  buildAnalyticsUsageEvidence,
  mergeAnalyticsRequestVolume,
  TENANT_CHAT_USAGE_SOURCE_ID,
  tenantChatBucketForAnalyticsRange
} from "./analytics-usage-merge";

const analyticsUsageMergeSourceUrl = new URL("./analytics-usage-merge.ts", import.meta.url);

test("adds Tenant Chat requests to aligned Project/Application volume buckets", () => {
  const projectPoints: AnalyticsLatencyDistributionPoint[] = [
    {
      bucket: "2026-07-18T00:00:00Z",
      label: "00:00",
      p50LatencyMs: 10,
      p95LatencyMs: 20,
      p99LatencyMs: 30,
      requests: 12,
      surface: "project_application"
    },
    {
      bucket: "2026-07-18T00:05:00Z",
      label: "00:05",
      p50LatencyMs: null,
      p95LatencyMs: null,
      p99LatencyMs: null,
      requests: 8,
      surface: "project_application"
    }
  ];

  const points = mergeAnalyticsRequestVolume({
    locale: "en",
    projectPoints,
    range: "1h",
    tenantPoints: [
      {
        confirmedCostMicroUsd: 100,
        periodStart: "2026-07-18T00:00:00.000Z",
        requestCount: 3,
        totalTokens: 30
      },
      {
        confirmedCostMicroUsd: 200,
        periodStart: "2026-07-18T00:10:00Z",
        requestCount: 4,
        totalTokens: 40
      }
    ]
  });

  expect(points).toEqual([
    { bucket: "2026-07-18T00:00:00.000Z", label: "00:00", requests: 15 },
    { bucket: "2026-07-18T00:05:00.000Z", label: "00:05", requests: 8 },
    { bucket: "2026-07-18T00:10:00.000Z", label: "12:10 AM", requests: 4 }
  ]);
});

test("builds project and Tenant Chat source rows without inventing a project id", () => {
  const evidence = buildAnalyticsUsageEvidence({
    locale: "ko",
    projectApplicationOverview: usageOverview(80, [
      projectRow("project-a", 50),
      projectRow("project-b", 30)
    ]),
    range: "1d",
    tenantChatOverview: usageOverview(20),
    tenantChatSeries: tenantSeries()
  });

  expect(evidence.sourceMix).toEqual([
    { id: "project-a", label: "project-a", value: 50 },
    { id: "project-b", label: "project-b", value: 30 },
    { id: TENANT_CHAT_USAGE_SOURCE_ID, label: "Tenant Chat", value: 20 }
  ]);
  expect(evidence.sourceMix.reduce((sum, row) => sum + row.value, 0)).toBe(100);
});

test("uses the same Tenant Chat bucket widths as the analytics ranges", () => {
  expect(tenantChatBucketForAnalyticsRange("15m")).toBe("1m");
  expect(tenantChatBucketForAnalyticsRange("1h")).toBe("5m");
  expect(tenantChatBucketForAnalyticsRange("1d")).toBe("1h");
  expect(tenantChatBucketForAnalyticsRange("1w")).toBe("1d");
});

test("reuses bounded locale and range formatters", async () => {
  const source = await readFile(analyticsUsageMergeSourceUrl, "utf8");

  expect(source).toContain(
    "const analyticsBucketLabelFormatters = new Map<string, Intl.DateTimeFormat>()"
  );
  expect(source).toContain("analyticsBucketLabelFormatters.get(key)");
  expect(source).toContain("analyticsBucketLabelFormatters.set(key, formatter)");
  expect(source.match(/new Intl\.DateTimeFormat/g)).toHaveLength(1);
});

function usageOverview(
  totalRequests: number,
  costByProject: NonNullable<DashboardOverview["costByProject"]> = []
) {
  return { costByProject, totalRequests };
}

function projectRow(projectId: string, requestCount: number) {
  return {
    completionTokens: 0,
    costMicroUsd: 0,
    costUsd: "0.000000",
    projectId,
    promptTokens: 0,
    requestCount,
    totalTokens: 0
  };
}

function tenantSeries(): TenantChatCostSeries {
  return {
    bucket: "1h",
    from: "2026-07-18T00:00:00Z",
    generatedAt: "2026-07-18T01:00:00Z",
    points: [],
    surface: "tenant_chat",
    to: "2026-07-18T01:00:00Z"
  };
}
