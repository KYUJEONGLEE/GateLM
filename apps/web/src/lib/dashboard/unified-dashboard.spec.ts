import { expect, test } from "@playwright/test";

import type { TenantChatDashboard } from "@/lib/control-plane/tenant-chat-observability-client";

import {
  mergeDashboardOverviews,
  mergeCostOverTime,
  selectDashboardSurfaceOverview,
  toTenantChatDashboardOverview
} from "./unified-dashboard";

test("maps Tenant Chat aggregate to the shared dashboard model", () => {
  const dashboard = tenantChatDashboard();
  dashboard.security = {
    protectedRequests: 3,
    redactedRequests: 2,
    blockedRequests: 1,
    byDetectorType: [{ detectorType: "email", requestCount: 2 }],
    coverage: { state: "complete", observedFrom: dashboard.from }
  };
  const overview = toTenantChatDashboardOverview(tenantId, dashboard);

  expect(overview.surface).toBe("tenant_chat");
  expect(overview.totalRequests).toBe(10);
  expect(overview.totalCostMicroUsd).toBe(300);
  expect(overview.cacheEligibleRequests).toBe(8);
  expect(overview.p95LatencyMs).toBe(250);
  expect(overview.gatewayTtft).toBeUndefined();
  expect(overview.maskingActionCounts).toEqual({ redacted: 2, blocked: 1 });
});

test("maps a legacy Tenant Chat aggregate without security evidence", () => {
  const dashboard = tenantChatDashboard();
  dashboard.requests.safetyBlocked = 1;
  delete (dashboard as Partial<TenantChatDashboard>).security;

  const overview = toTenantChatDashboardOverview(tenantId, dashboard);

  expect(overview.blockedRequests).toBe(1);
  expect(overview.maskingActionCounts).toEqual({ redacted: 0, blocked: 1 });
  expect(overview.breakdowns?.bySafetyOutcome).toEqual([
    { outcome: "redacted", requestCount: 0 },
    { outcome: "blocked", requestCount: 1 }
  ]);
});

test("merges additive values while keeping latency provenance by surface", () => {
  const projectApplication = toTenantChatDashboardOverview(tenantId, tenantChatDashboard());
  projectApplication.surface = "project_application";
  projectApplication.totalRequests = 5;
  projectApplication.successfulRequests = 4;
  projectApplication.totalCostMicroUsd = 700;
  projectApplication.averageLatencyMs = 210;
  projectApplication.p95LatencyMs = 400;
  projectApplication.latencyBySurface = {
    projectApplicationAverageMs: 210,
    projectApplicationP95Ms: 400
  };
  projectApplication.gatewayTtft = {
    scope: "project_application",
    averageMs: 170,
    p50Ms: 120,
    p95Ms: 320,
    p99Ms: 640,
    eligibleStreamRequests: 5,
    observedRequests: 4,
    coverageRate: 0.8
  };
  const tenantChat = toTenantChatDashboardOverview(tenantId, tenantChatDashboard());

  const overview = mergeDashboardOverviews(projectApplication, tenantChat);

  expect(overview.surface).toBe("all");
  expect(overview.totalRequests).toBe(15);
  expect(overview.totalCostMicroUsd).toBe(1000);
  expect(overview.latencyBySurface).toEqual({
    projectApplicationAverageMs: 210,
    projectApplicationP95Ms: 400,
    tenantChatAverageMs: 120,
    tenantChatP95Ms: 250
  });
  expect(overview.averageLatencyMs).toBe(210);
  expect(overview.p95LatencyMs).toBe(400);
  expect(overview.gatewayTtft).toBe(projectApplication.gatewayTtft);
});

test("keeps the worst query budget and conservative freshness across surfaces", () => {
  const projectApplication = toTenantChatDashboardOverview(tenantId, tenantChatDashboard());
  projectApplication.surface = "project_application";
  projectApplication.queryBudget = {
    status: "unavailable",
    maxRangeHours: 24,
    maxBreakdownItems: 50,
    guidance: "Project/Application rollup is unavailable."
  };
  projectApplication.dataFreshness.generatedAt = "2026-07-12T13:01:00Z";
  projectApplication.dataFreshness.lastAggregatedAt = "2026-07-12T13:01:00Z";
  const tenantChat = toTenantChatDashboardOverview(tenantId, tenantChatDashboard());
  tenantChat.queryBudget = {
    status: "stale",
    maxRangeHours: 168,
    maxBreakdownItems: 100,
    guidance: "Tenant Chat projection is delayed."
  };
  tenantChat.dataFreshness.isStale = true;

  const overview = mergeDashboardOverviews(projectApplication, tenantChat);

  expect(overview.queryBudget).toEqual({
    status: "unavailable",
    maxRangeHours: 24,
    maxBreakdownItems: 50,
    guidance: "Project/Application rollup is unavailable. Tenant Chat projection is delayed."
  });
  expect(overview.dataFreshness.generatedAt).toBe("2026-07-12T13:00:00Z");
  expect(overview.dataFreshness.lastAggregatedAt).toBe("2026-07-12T13:00:00Z");
  expect(overview.dataFreshness.isStale).toBe(true);
});

test("preserves Tenant Chat stale freshness instead of flattening it to partial", () => {
  const dashboard = tenantChatDashboard();
  dashboard.freshness.state = "stale";

  const overview = toTenantChatDashboardOverview(tenantId, dashboard);

  expect(overview.queryBudget?.status).toBe("stale");
  expect(overview.dataFreshness.isStale).toBe(true);
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

test("treats an unconfigured Tenant Chat surface as an empty optional surface", () => {
  const projectApplication = toTenantChatDashboardOverview(tenantId, tenantChatDashboard());
  projectApplication.surface = "project_application";

  const overview = selectDashboardSurfaceOverview(
    "all",
    projectApplication,
    undefined,
    { tenantChatNotConfigured: true }
  );

  expect(overview?.surface).toBe("all");
  expect(overview?.queryBudget?.guidance).not.toBe(
    "Tenant Chat aggregate is unavailable."
  );
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
    ],
    security: {
      protectedRequests: 0,
      redactedRequests: 0,
      blockedRequests: 0,
      byDetectorType: [],
      coverage: { state: "complete", observedFrom: "2026-07-12T12:00:00Z" }
    }
  };
}
