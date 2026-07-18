import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);
const panelsSourceUrl = new URL(
  "../../../../../features/analytics/components/analytics-panels.tsx",
  import.meta.url
);

test("analytics fails closed before loading tenant observability data", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const accessGuardIndex = pageSource.indexOf("hasConsoleTenantAccess(auth, effectiveTenantId)");
  const overviewReadIndex = pageSource.indexOf("getLiveDashboardOverview(effectiveTenantId");
  const tenantChatReadIndex = pageSource.indexOf("getTenantChatDashboard(");

  expect(accessGuardIndex).toBeGreaterThan(-1);
  expect(overviewReadIndex).toBeGreaterThan(accessGuardIndex);
  expect(tenantChatReadIndex).toBeGreaterThan(accessGuardIndex);
  expect(pageSource).not.toContain("getLiveDashboardOverview(tenantId");
});

test("analytics forces project admins onto an assigned project", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain("resolveProjectIdForConsoleAuth({");
  expect(pageSource).toContain("projectId: effectiveProjectId ?? requestedFilters.projectId");
  expect(pageSource).toContain("getVisibleProjectsForConsoleAuth(");
  expect(pageSource).toContain("projectScoped ? null");
});

test("usage, cost, cache, and security include Tenant Chat only at tenant scope", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain(
    '(activeTab === "usage" || activeTab === "cost" || activeTab === "cache" || activeTab === "security")'
  );
  expect(pageSource).toContain("!projectScoped &&");
  expect(pageSource).toContain("!filters.projectId");
  expect(pageSource).toContain("getTenantChatDashboard(");
  expect(pageSource).toContain("shouldLoadTenantChatSeries");
  expect(pageSource).toContain("getTenantChatCostSeries(");
  expect(pageSource).toContain("toTenantChatDashboardOverview(");
  expect(pageSource).toContain("toTenantChatCostOverTime(");
  expect(pageSource).toContain("selectDashboardSurfaceOverview(");
  expect(pageSource).toContain("buildAnalyticsCacheEvidence({");
  expect(pageSource).toContain("mergeAnalyticsSecurityEvidence({");
  expect(pageSource).toContain("mergeCostOverTime(");
  expect(pageSource).toContain('shouldIncludeTenantChat ? "all" : "project_application"');
  expect(pageSource).toContain("tenantChatDashboard.usage.confirmedCostMicroUsd");
});

test("performance delegates tenant-level surface union to the Gateway contract", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain('const needsPerformance = activeTab === "usage" || activeTab === "performance"');
  expect(pageSource).toContain("getLiveAnalyticsPerformance(effectiveTenantId");
  expect(pageSource).toContain('includeTenantChat: activeTab === "performance" && !projectScoped');
  expect(pageSource).toContain("projectId: filters.projectId || undefined");
  expect(pageSource).toContain('provider: activeTab === "performance" ? filters.provider || undefined : undefined');
  expect(pageSource).toContain('model: activeTab === "performance" ? filters.model || undefined : undefined');
  expect(pageSource).toContain("performance={performance}");
});

test("performance keeps an unavailable error rate distinct from zero percent", async () => {
  const panelsSource = await readFile(panelsSourceUrl, "utf8");

  expect(panelsSource).toContain("formatNullablePercent(performance?.summary.errorRate)");
  expect(panelsSource).not.toContain("formatPercent(performance?.summary.errorRate ?? 0)");
});

test("performance keeps both requested surfaces visible when one has no requests", async () => {
  const panelsSource = await readFile(panelsSourceUrl, "utf8");

  expect(panelsSource).toContain("const surfaceSummaries = performance?.surfaceSummaries ?? []");
  expect(panelsSource).not.toContain("surfaceSummaries ?? []).filter((row) => row.totalRequests > 0)");
});

test("policy impact delegates Project/Application and Tenant Chat union to the Gateway contract", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain('const needsV5Evidence = activeTab === "impact"');
  expect(pageSource).toContain("getLiveAnalyticsV5Evidence(effectiveTenantId");
  expect(pageSource).toContain("projectId: filters.projectId || undefined");
  expect(pageSource).toContain('policyImpact: activeTab === "impact" ? v5Evidence?.policyImpact : undefined');
});

test("reliability uses the unified tenant aggregate instead of reconstructing from capped logs", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain("getLiveAnalyticsReliability(effectiveTenantId");
  expect(pageSource).toContain("incidentLimit: 4");
  expect(pageSource).toContain("reliability={reliability}");
  expect(pageSource).not.toContain("getLiveGatewayRequestLogs({");
});
