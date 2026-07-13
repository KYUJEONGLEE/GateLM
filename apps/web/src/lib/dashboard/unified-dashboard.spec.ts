import { expect, test } from "@playwright/test";

import type { TenantChatDashboard } from "@/lib/control-plane/tenant-chat-observability-client";

import {
  mergeDashboardOverviews,
  mergeCostOverTime,
  toTenantChatDashboardOverview
} from "./unified-dashboard";

test("maps Tenant Chat aggregate to the shared dashboard model", () => {
  const overview = toTenantChatDashboardOverview(tenantId, tenantChatDashboard());

  expect(overview.surface).toBe("tenant_chat");
  expect(overview.totalRequests).toBe(10);
  expect(overview.totalCostMicroUsd).toBe(300);
  expect(overview.cacheEligibleRequests).toBe(8);
  expect(overview.p95LatencyMs).toBe(250);
});

test("merges additive values while keeping latency provenance by surface", () => {
  const projectApplication = toTenantChatDashboardOverview(tenantId, tenantChatDashboard());
  projectApplication.surface = "project_application";
  projectApplication.totalRequests = 5;
  projectApplication.successfulRequests = 4;
  projectApplication.totalCostMicroUsd = 700;
  projectApplication.p95LatencyMs = 400;
  const tenantChat = toTenantChatDashboardOverview(tenantId, tenantChatDashboard());

  const overview = mergeDashboardOverviews(projectApplication, tenantChat);

  expect(overview.surface).toBe("all");
  expect(overview.totalRequests).toBe(15);
  expect(overview.totalCostMicroUsd).toBe(1000);
  expect(overview.latencyBySurface).toEqual({
    projectApplicationP95Ms: 400,
    tenantChatP95Ms: 250
  });
});

test("merges aligned cost buckets without losing either surface", () => {
  const merged = mergeCostOverTime(
    {
      averageSpendUsd: 1,
      generatedAt: "2026-07-12T12:05:00Z",
      period: "hour",
      points: [{ bucket: "2026-07-12T12:00:00Z", label: "12:00", spendUsd: 1 }]
    },
    {
      averageSpendUsd: 0.5,
      generatedAt: "2026-07-12T12:05:01Z",
      period: "hour",
      points: [{ bucket: "2026-07-12T12:00:00Z", label: "12:00", spendUsd: 0.5 }]
    }
  );

  expect(merged.points).toEqual([
    { bucket: "2026-07-12T12:00:00Z", label: "12:00", spendUsd: 1.5 }
  ]);
});

const tenantId = "00000000-0000-4000-8000-000000000100";

function tenantChatDashboard(): TenantChatDashboard {
  return {
    surface: "tenant_chat",
    from: "2026-07-12T12:00:00Z",
    to: "2026-07-12T13:00:00Z",
    freshness: {
      projectedAt: "2026-07-12T13:00:00Z",
      lagSeconds: 0,
      state: "fresh"
    },
    requests: {
      total: 10,
      activeUsers: 2,
      succeeded: 8,
      failed: 1,
      cancelled: 0,
      cacheHits: 2,
      cacheMisses: 6,
      cacheOff: 2,
      cacheEligible: 8,
      cacheHitRate: 0.25,
      rateLimited: 1,
      concurrencyLimited: 0,
      safetyBlocked: 0,
      quotaBlocked: 0,
      budgetBlocked: 0,
      fallbackRequests: 1,
      fallbackSucceeded: 1,
      providerAttempts: 8,
      billableAttempts: 8
    },
    usage: {
      confirmedInputTokens: 100,
      confirmedOutputTokens: 50,
      confirmedTotalTokens: 150,
      confirmedCostMicroUsd: 300,
      unconfirmedIncidentCount: 0,
      unconfirmedExposureMicroUsd: 0
    },
    policyStates: {
      quota: { normal: 9, warning: 1, economy: 0, blocked: 0 },
      budget: { normal: 10, warning: 0, economy: 0, blocked: 0 }
    },
    latency: {
      averageMs: 120,
      p50Ms: 100,
      p95Ms: 250,
      p99Ms: 400,
      providerP95Ms: 200
    },
    breakdowns: [
      {
        providerId: "provider",
        modelKey: "model",
        routeTier: "standard",
        requestCount: 8,
        attemptCount: 8,
        billableAttemptCount: 8,
        fallbackSuccessCount: 1,
        confirmedCostMicroUsd: 300
      }
    ]
  };
}
