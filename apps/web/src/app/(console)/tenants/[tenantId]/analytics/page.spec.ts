import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);
const panelsSourceUrl = new URL(
  "../../../../../features/analytics/components/analytics-panels.tsx",
  import.meta.url
);
const filterSelectSourceUrl = new URL(
  "../../../../../features/analytics/components/analytics-filter-select.tsx",
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

test("analytics filters update only the panel with transition state and client caching", async () => {
  const [pageSource, filterSelectSource] = await Promise.all([
    readFile(pageSourceUrl, "utf8"),
    readFile(filterSelectSourceUrl, "utf8")
  ]);

  expect(pageSource).toContain("<AnalyticsFilterSelect");
  expect(pageSource).toContain("<AnalyticsFilterFrame");
  expect(pageSource).toContain("<AnalyticsPanelTransition>");
  expect(pageSource).toContain('className="analytics-v3-select-caret"');
  expect(pageSource).not.toContain("SlidersHorizontal");
  expect(pageSource).not.toContain('type="submit"');
  expect(filterSelectSource).toContain("startTransition(() =>");
  expect(filterSelectSource).toContain("router.replace(");
  expect(filterSelectSource).toContain("new Map<string, ReactNode>()");
  expect(filterSelectSource).toContain("maxCachedPanels = 8");
  expect(filterSelectSource).toContain("visiblePanel");
  expect(filterSelectSource).not.toContain("requestSubmit()");
});

test("all analytics tabs share one project-aware Tenant Chat scope", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain("resolveAnalyticsSurfaceScope({");
  expect(pageSource).toContain('const shouldIncludeTenantChat = analyticsSurfaceScope === "all"');
  expect(pageSource).toContain("projectId: filters.projectId");
  expect(pageSource).toContain("projectScoped");
});

test("usage, cost, cache, and security load Tenant Chat only for the shared all-projects scope", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain(
    '(activeTab === "usage" || activeTab === "cost" || activeTab === "cache" || activeTab === "security")'
  );
  expect(pageSource).toContain("shouldLoadTenantChatDashboard");
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
  expect(pageSource).toContain(
    'includeTenantChat: activeTab === "performance" && shouldIncludeTenantChat'
  );
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
  expect(pageSource).toContain("surface: analyticsSurfaceScope");
  expect(pageSource).toContain("reliability={reliability}");
  expect(pageSource).not.toContain("getLiveGatewayRequestLogs({");
});

test("performance places provider filters before the shared range and project filters", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const providerFilterIndex = pageSource.indexOf("<span>{text.provider}</span>");
  const rangeFilterIndex = pageSource.indexOf("<span>{text.range}</span>");
  const projectFilterIndex = pageSource.indexOf("<span>{text.project}</span>");

  expect(providerFilterIndex).toBeGreaterThan(-1);
  expect(rangeFilterIndex).toBeGreaterThan(providerFilterIndex);
  expect(projectFilterIndex).toBeGreaterThan(rangeFilterIndex);
  expect(pageSource).not.toContain("analytics-v3-filter-row-secondary");
});

test("analytics preserves an unavailable selected project in the filter", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain("filters.projectId && !projects.some((project) => project.id === filters.projectId)");
  expect(pageSource).toContain("<option disabled value={filters.projectId}>{text.projectUnavailable}</option>");
  expect(pageSource).toContain('projectUnavailable: "선택한 프로젝트를 사용할 수 없음"');
});

test("usage cost and security load tenant-scoped employee evidence", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain('activeTab === "usage" || activeTab === "cost"');
  expect(pageSource).toContain('activeTab === "security"');
  expect(pageSource).toContain("getAllEmployeeUsage({");
  expect(pageSource).toContain("getEmployeeSecurity({");
  expect(pageSource).toContain('name="employeeId"');
  expect(pageSource).toContain('appendQuery(query, "employeeId", filters.employeeId)');
  expect(pageSource).not.toContain("departmentId");
});
