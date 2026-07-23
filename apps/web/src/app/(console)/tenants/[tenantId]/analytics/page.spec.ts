import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);
const panelsSourceUrl = new URL(
  "../../../../../features/analytics/components/analytics-panels.tsx",
  import.meta.url
);
const chartsSourceUrl = new URL(
  "../../../../../features/analytics/components/analytics-charts.tsx",
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
  expect(pageSource.match(/className="analytics-v3-select-caret"/g)).toHaveLength(3);
  expect(pageSource).not.toContain("SlidersHorizontal");
  expect(pageSource).not.toContain('type="submit"');
  expect(filterSelectSource).toContain("startTransition(() =>");
  expect(filterSelectSource).toContain("router.replace(");
  expect(filterSelectSource).toContain("new Map<string, ReactNode>()");
  expect(filterSelectSource).toMatch(
    /useEffect\(\(\) => \{\s+rememberPanel\(panelCache\.current, navigation\.cacheKey, children\);/
  );
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

test("cost, cache, and security load Tenant Chat while usage remains project-only", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain(
    '(activeTab === "cost" || activeTab === "cache" || activeTab === "security")'
  );
  expect(pageSource).not.toContain(
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
  expect(pageSource).not.toContain('provider: activeTab === "performance"');
  expect(pageSource).not.toContain('model: activeTab === "performance"');
  expect(pageSource).toContain("performance={performance}");
  expect(pageSource).toContain("providerDirectory={providerDirectory}");
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

test("performance overlays both surfaces and defaults the percentile selector to p95", async () => {
  const [panelsSource, chartsSource] = await Promise.all([
    readFile(panelsSourceUrl, "utf8"),
    readFile(chartsSourceUrl, "utf8")
  ]);

  expect(panelsSource).toContain("points={latencyPoints}");
  expect(panelsSource).toContain("surfaces={latencySurfaces}");
  expect(panelsSource).not.toContain("analytics-v3-surface-latency-summary");
  expect(panelsSource).not.toContain("point.surface === summary.surface");
  expect(chartsSource).toContain('useState<LatencyPercentile>("p95")');
  expect(chartsSource).toContain("aria-pressed={percentile === value}");
  expect(chartsSource).toContain("latencySurfaceColors[surface]");
});

test("usage appends the Korean count unit to active models", async () => {
  const panelsSource = await readFile(panelsSourceUrl, "utf8");

  expect(panelsSource).toContain('`${formatInteger(model.usage.activeModels)}건`');
});

test("cache keeps the Korean count unit while omitting metric descriptions", async () => {
  const panelsSource = await readFile(panelsSourceUrl, "utf8");

  expect(panelsSource).toContain('`${formatInteger(model.cache.hitRequests)}건`');
  expect(panelsSource).not.toContain('`${formatInteger(model.cache.eligibleRequests)}건 ${text.eligible}`');
});

test("performance shows the overall p95 and compares model and Provider labels without a surface prefix", async () => {
  const panelsSource = await readFile(panelsSourceUrl, "utf8");

  expect(panelsSource).toContain("value: formatMs(overallP95)");
  expect(panelsSource).toContain("row.p95LatencyMs == null ? [] : [row.p95LatencyMs]");
  expect(panelsSource).toContain('return value === null ? "—"');
  expect(panelsSource).toContain("performance?.providerModelPerformance ?? []");
  expect(panelsSource).toContain("performance?.p95LatencyByProvider ?? []");
  expect(panelsSource).toContain("formatModelDisplayName(row.model)");
  expect(panelsSource).toContain("providerDisplayLabel(providerDirectory, row.provider)");
  expect(panelsSource).not.toContain("headlineSurfaceSummaries");
});

test("Korean analytics copy removes the page subtitle and uses vertical ranked charts", async () => {
  const [pageSource, panelsSource] = await Promise.all([
    readFile(pageSourceUrl, "utf8"),
    readFile(panelsSourceUrl, "utf8")
  ]);

  expect(pageSource).toContain('title: "분석"');
  expect(pageSource).toContain('subtitle: ""');
  expect(panelsSource).toContain('orientation="vertical"');
  expect(panelsSource).not.toContain('orientation="horizontal"');
  expect(panelsSource).toContain('provider: "모델별 전체 응답 지연"');
});

test("analytics groups seven detail views into four primary categories", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain('type AnalyticsPrimaryTab = "impact" | "usage" | "performance" | "security"');
  expect(pageSource).toContain('const costPolicyTabs: AnalyticsTab[] = ["impact", "cost", "cache"]');
  expect(pageSource).toContain('const operationsTabs: AnalyticsTab[] = ["performance", "reliability"]');
  expect(pageSource).toContain('impact: "비용·정책 효과"');
  expect(pageSource).toContain('performance: "운영 성능"');
  expect(pageSource).toContain('const activePrimaryTab = primaryTabFor(activeTab)');
  expect(pageSource).toContain('tab === "cost" || tab === "cache"');
  expect(pageSource).toContain('tab === "reliability"');
  expect(pageSource).toContain('className="analytics-v3-subtabs"');
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

test("all analytics tabs share employee, range, and project filters in that order", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const employeeFilterIndex = pageSource.indexOf("<span>{text.employee}</span>");
  const rangeFilterIndex = pageSource.indexOf("<span>{text.range}</span>");
  const projectFilterIndex = pageSource.indexOf("<span>{text.project}</span>");

  expect(employeeFilterIndex).toBeGreaterThan(-1);
  expect(rangeFilterIndex).toBeGreaterThan(employeeFilterIndex);
  expect(projectFilterIndex).toBeGreaterThan(rangeFilterIndex);
  expect(pageSource).not.toContain("showEmployeeFilter");
  expect(pageSource).not.toContain("showProviderModelFilters");
  expect(pageSource).not.toContain("<span>{text.provider}</span>");
  expect(pageSource).not.toContain("<span>{text.model}</span>");
  expect(pageSource).not.toContain("analytics-v3-filter-row-secondary");
});

test("analytics preserves an unavailable selected project in the filter", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain("filters.projectId && !projects.some((project) => project.id === filters.projectId)");
  expect(pageSource).toContain("<option disabled value={filters.projectId}>{text.projectUnavailable}</option>");
  expect(pageSource).toContain('projectUnavailable: "선택한 프로젝트를 사용할 수 없음"');
});

test("usage omits employee reads and hides the employee selector", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain('activeTab !== "security" && activeTab !== "usage"');
  expect(pageSource).toContain('const needsEmployeeSecurity = !projectScoped && activeTab === "security"');
  expect(pageSource).toContain("getAllEmployeeUsage({");
  expect(pageSource).toContain("getEmployeeSecurity({");
  expect(pageSource).toContain('name="employeeId"');
  expect(pageSource).toContain('activeTab !== "usage" ? <label');
  expect(pageSource).toContain('appendQuery(query, "employeeId", filters.employeeId)');
  expect(pageSource).not.toContain("departmentId");
});

test("usage defaults to 15 minutes without overriding an explicit range", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain("buildFilters(resolvedSearchParams, activeTab)");
  expect(pageSource).toContain(
    'normalizeRange(searchParams?.range, activeTab === "usage" ? "15m" : "1w")'
  );
  expect(pageSource).toContain(
    'tab === "usage" && activeTab !== "usage" ? "15m" : filters.range'
  );
  expect(pageSource).toMatch(/\? value\s+: fallback;/);
});
