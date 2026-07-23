import {
  Activity,
  Gauge,
  Shield,
  Sparkles
} from "lucide-react";
import { notFound } from "next/navigation";
import { IntentPrefetchLink } from "@/components/navigation/intent-prefetch-link";
import {
  AnalyticsCachePanel,
  AnalyticsCostPanel,
  AnalyticsPerformancePanel,
  AnalyticsReliabilityPanel,
  AnalyticsSecurityPanel
} from "@/features/analytics/components/analytics-panels";
import { AnalyticsLiveUsagePanel } from "@/features/analytics/components/analytics-live-usage-panel";
import {
  AnalyticsFilterFrame,
  AnalyticsFilterSelect,
  AnalyticsPanelTransition
} from "@/features/analytics/components/analytics-filter-select";
import { AnalyticsV5Overview } from "@/features/analytics/components/analytics-v5-overview";
import { buildAnalyticsCacheEvidence } from "@/features/analytics/analytics-cache-merge";
import { buildAnalyticsReadModel } from "@/features/analytics/analytics-read-model";
import { mergeAnalyticsSecurityEvidence } from "@/features/analytics/analytics-security-evidence";
import { resolveAnalyticsSurfaceScope } from "@/features/analytics/analytics-surface-scope";
import {
  buildAnalyticsUsageEvidence,
  tenantChatBucketForAnalyticsRange
} from "@/features/analytics/analytics-usage-merge";
import {
  getCurrentConsoleAuth,
  getVisibleProjectsForConsoleAuth,
  isProjectScopedForTenant,
  resolveConsoleTenantIdForAuth,
  resolveProjectIdForConsoleAuth
} from "@/lib/auth/current-console-auth";
import { hasConsoleTenantAccess } from "@/lib/auth/console-tenant-access";
import { getEmployeeSecurity } from "@/lib/control-plane/employee-security-client";
import { getAllEmployeeUsage } from "@/lib/control-plane/employee-usage-client";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { resolveControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import { listTenantProviderConnections } from "@/lib/control-plane/provider-connections-client";
import { buildProviderDisplayDirectory } from "@/lib/control-plane/provider-display";
import {
  getTenantChatCostSeries,
  getTenantChatDashboard
} from "@/lib/control-plane/tenant-chat-observability-client";
import {
  mergeCostOverTime,
  selectDashboardSurfaceOverview,
  toTenantChatCostOverTime,
  toTenantChatDashboardOverview
} from "@/lib/dashboard/unified-dashboard";
import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import { getLiveCostOverTime } from "@/lib/gateway/live-cost-report";
import { getLiveAnalyticsSecurityEvidence } from "@/lib/gateway/live-analytics-security";
import {
  getAnalyticsPerformanceRange,
  getLiveAnalyticsPerformance,
  type LiveAnalyticsRange
} from "@/lib/gateway/live-analytics-performance";
import { getLiveAnalyticsReliability } from "@/lib/gateway/live-analytics-reliability";
import { getLiveAnalyticsV5Evidence } from "@/lib/gateway/live-analytics-v5";
import {
  getLiveDashboardOverview
} from "@/lib/gateway/live-dashboard-overview";
import type { Locale } from "@/lib/i18n/locale";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type AnalyticsPageProps = {
  params: Promise<{ tenantId: string }>;
  searchParams?: Promise<{
    employeeId?: string;
    projectId?: string;
    range?: string;
    tab?: string;
  }>;
};

type AnalyticsTab = "impact" | "usage" | "cost" | "performance" | "reliability" | "security" | "cache";
type AnalyticsPrimaryTab = "impact" | "usage" | "performance" | "security";

type AnalyticsFilterState = {
  employeeId: string;
  projectId: string;
  range: LiveAnalyticsRange;
};

const primaryTabConfig: Array<{ icon: typeof Activity; id: AnalyticsPrimaryTab }> = [
  { icon: Sparkles, id: "impact" },
  { icon: Activity, id: "usage" },
  { icon: Gauge, id: "performance" },
  { icon: Shield, id: "security" }
];

const costPolicyTabs: AnalyticsTab[] = ["impact", "cost", "cache"];
const operationsTabs: AnalyticsTab[] = ["performance", "reliability"];

const rangeValues: LiveAnalyticsRange[] = ["15m", "1h", "1d", "1w"];

const pageText = {
  en: {
    allEmployees: "All employees",
    allProjects: "All projects",
    filterAria: "Analytics filters",
    employee: "Employee",
    project: "Project",
    projectUnavailable: "Selected project unavailable",
    primaryNavAria: "Analytics categories",
    range: "Time range",
    rangeLabels: { "15m": "15 minutes", "1h": "1 hour", "1d": "24 hours", "1w": "7 days" },
    secondaryNavAria: "Analytics details",
    subtitle: "Cost, policy, and operational performance",
    primaryTabs: {
      impact: "Cost & policy",
      performance: "Operations",
      security: "Security",
      usage: "Usage"
    },
    tabs: {
      cache: "Cache",
      cost: "Cost",
      impact: "Policy impact",
      performance: "Performance",
      reliability: "Reliability",
      security: "Security",
      usage: "Usage"
    },
    title: "Analytics",
    updating: "Updating analytics..."
  },
  ko: {
    allEmployees: "전체 직원",
    allProjects: "전체 프로젝트",
    filterAria: "분석 필터",
    employee: "직원",
    project: "프로젝트",
    projectUnavailable: "선택한 프로젝트를 사용할 수 없음",
    primaryNavAria: "분석 주요 카테고리",
    range: "시간 범위",
    rangeLabels: { "15m": "15분", "1h": "1시간", "1d": "24시간", "1w": "7일" },
    secondaryNavAria: "분석 세부 항목",
    subtitle: "",
    primaryTabs: {
      impact: "비용·정책 효과",
      performance: "운영 성능",
      security: "보안",
      usage: "사용량"
    },
    tabs: {
      cache: "캐시",
      cost: "비용",
      impact: "정책 효과",
      performance: "성능",
      reliability: "안정성",
      security: "보안",
      usage: "사용량"
    },
    title: "분석",
    updating: "분석 데이터 업데이트 중..."
  }
} satisfies Record<Locale, unknown>;

export default async function AnalyticsPage({ params, searchParams }: AnalyticsPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const activeTab = normalizeTab(resolvedSearchParams?.tab);
  const requestedFilters = buildFilters(resolvedSearchParams, activeTab);
  const [locale, auth] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);

  if (!hasConsoleTenantAccess(auth, effectiveTenantId)) {
    notFound();
  }

  const projectsModel = await getProjectsModel(effectiveTenantId);
  const effectiveProjectId = resolveProjectIdForConsoleAuth({
    auth,
    projects: projectsModel.projects,
    requestedProjectId: requestedFilters.projectId,
    routeTenantId: effectiveTenantId
  });

  if (effectiveProjectId === null) {
    notFound();
  }

  const filters = {
    ...requestedFilters,
    projectId: effectiveProjectId ?? requestedFilters.projectId
  };
  const projectScoped = isProjectScopedForTenant(auth, effectiveTenantId);
  const analyticsSurfaceScope = resolveAnalyticsSurfaceScope({
    projectId: filters.projectId,
    projectScoped
  });
  const shouldIncludeTenantChat = analyticsSurfaceScope === "all";
  const shouldLoadTenantChatDashboard =
    shouldIncludeTenantChat &&
    (activeTab === "cost" || activeTab === "cache" || activeTab === "security");
  const shouldLoadTenantChatSeries =
    shouldLoadTenantChatDashboard && activeTab === "cost";
  const needsPerformance = activeTab === "usage" || activeTab === "performance";
  const needsCostTrend = activeTab === "cost";
  const needsV5Evidence = activeTab === "impact";
  const needsReliabilityEvidence = activeTab === "reliability";
  const needsSecurityEvidence = activeTab === "security";
  const needsEmployeeUsage =
    !projectScoped && activeTab !== "security" && activeTab !== "usage";
  const needsEmployeeSecurity = !projectScoped && activeTab === "security";
  const reliabilityRange = getAnalyticsPerformanceRange(filters.range);

  const [
    projectApplicationOverview,
    tenantChatDashboard,
    tenantChatSeries,
    performance,
    projectApplicationCostTrend,
    v5Evidence,
    reliability,
    projectApplicationSecurityEvidence,
    employeeUsageResult,
    employeeSecurityResult,
    providerConnectionsResult
  ] = await Promise.all([
    getLiveDashboardOverview(effectiveTenantId, {
      projectId: filters.projectId || undefined,
      range: filters.range
    }),
    shouldLoadTenantChatDashboard
      ? getTenantChatDashboard(
          effectiveTenantId,
          reliabilityRange.from,
          reliabilityRange.to
        )
      : Promise.resolve(undefined),
    shouldLoadTenantChatSeries
      ? getTenantChatCostSeries(
          effectiveTenantId,
          reliabilityRange.from,
          reliabilityRange.to,
          tenantChatBucketForAnalyticsRange(filters.range)
        )
      : Promise.resolve(undefined),
    needsPerformance
      ? getLiveAnalyticsPerformance(effectiveTenantId, {
          includeTenantChat: activeTab === "performance" && shouldIncludeTenantChat,
          projectId: filters.projectId || undefined,
          range: filters.range
        })
      : Promise.resolve(undefined),
    needsCostTrend
      ? getLiveCostOverTime(effectiveTenantId, {
          projectId: filters.projectId || undefined,
          range: filters.range
        })
      : Promise.resolve(undefined),
    needsV5Evidence
      ? getLiveAnalyticsV5Evidence(effectiveTenantId, {
          projectId: filters.projectId || undefined,
          range: filters.range
        })
      : Promise.resolve(undefined),
    needsReliabilityEvidence
      ? getLiveAnalyticsReliability(effectiveTenantId, {
          incidentLimit: 4,
          projectId: filters.projectId || undefined,
          range: filters.range,
          surface: analyticsSurfaceScope
        })
      : Promise.resolve(undefined),
    needsSecurityEvidence
      ? getLiveAnalyticsSecurityEvidence({
          from: reliabilityRange.from,
          projectId: filters.projectId || undefined,
          tenantId: effectiveTenantId,
          to: reliabilityRange.to
        })
      : Promise.resolve(undefined),
    needsEmployeeUsage
      ? getAllEmployeeUsage({
          from: reliabilityRange.from,
          metric: activeTab === "cost" ? "cost" : "tokens",
          order: "desc",
          tenantId: effectiveTenantId,
          to: reliabilityRange.to
        })
      : Promise.resolve(undefined),
    needsEmployeeSecurity
      ? getEmployeeSecurity({
          from: reliabilityRange.from,
          tenantId: effectiveTenantId,
          to: reliabilityRange.to
        })
      : Promise.resolve(undefined),
    activeTab === "performance"
      ? listTenantProviderConnections(resolveControlPlaneTenantId(effectiveTenantId))
      : Promise.resolve(undefined)
  ]);

  const tenantChatOverview = tenantChatDashboard
    ? toTenantChatDashboardOverview(effectiveTenantId, tenantChatDashboard)
    : undefined;
  const tenantChatCostTrend = tenantChatSeries
    ? toTenantChatCostOverTime(tenantChatSeries)
    : undefined;
  const costTrend = projectApplicationCostTrend && tenantChatCostTrend
    ? mergeCostOverTime(projectApplicationCostTrend, tenantChatCostTrend)
    : projectApplicationCostTrend ?? tenantChatCostTrend;
  const selectedOverview =
    activeTab === "usage"
      ? projectApplicationOverview
      : activeTab === "cost" || activeTab === "cache" || activeTab === "security"
    ? selectDashboardSurfaceOverview(
        shouldIncludeTenantChat ? "all" : "project_application",
        projectApplicationOverview,
        tenantChatOverview,
        { tenantChatNotConfigured: tenantChatDashboard === null }
      )
    : projectApplicationOverview;
  const overview = activeTab === "usage" &&
    (!performance || !projectApplicationOverview)
    ? markAnalyticsUsagePartial(selectedOverview)
    : activeTab === "cost" && costSeriesIsPartial({
        projectApplicationAvailable: Boolean(projectApplicationOverview),
        projectApplicationSeriesAvailable: Boolean(projectApplicationCostTrend),
        tenantChatAvailable: Boolean(tenantChatOverview),
        tenantChatSeriesAvailable: Boolean(tenantChatCostTrend)
      })
      ? markAnalyticsCostPartial(selectedOverview)
    : selectedOverview;
  const usageEvidence = activeTab === "usage"
    ? buildAnalyticsUsageEvidence({
        locale,
        projectApplicationOverview,
        projectRequestVolume: projectApplicationOverview
          ? performance?.latencyDistribution
          : undefined,
        range: filters.range,
        tenantChatOverview: undefined,
        tenantChatSeries: undefined
      })
    : undefined;
  const cacheEvidence = activeTab === "cache"
    ? buildAnalyticsCacheEvidence({
        projectApplicationOverview,
        tenantChatOverview: shouldIncludeTenantChat ? tenantChatOverview : undefined
      })
    : undefined;
  const securityEvidence = activeTab === "security"
    ? mergeAnalyticsSecurityEvidence({
        projectApplicationEvidence: projectApplicationSecurityEvidence,
        projectApplicationOverview,
        tenantChatDashboard: shouldIncludeTenantChat ? tenantChatDashboard : undefined
      })
    : undefined;
  const text = pageText[locale];
  const visibleProjects = getVisibleProjectsForConsoleAuth(
    projectsModel.projects,
    auth,
    effectiveTenantId
  );
  const projects = visibleProjects.filter((project) => project.status !== "ARCHIVED");
  const projectNameById = new Map(
    visibleProjects.map((project) => [project.id, project.name])
  );
  const model = buildAnalyticsReadModel(
    activeTab === "impact" && !v5Evidence ? undefined : overview,
    usageEvidence,
    {
    cacheEvidence,
    policyImpact: activeTab === "impact" ? v5Evidence?.policyImpact : undefined,
    tenantChatCostMicroUsd:
      activeTab === "cost" && tenantChatDashboard
        ? tenantChatDashboard.usage.confirmedCostMicroUsd
        : undefined
    }
  );
  const employeeUsage = employeeUsageResult?.ok ? employeeUsageResult.data : undefined;
  const employeeSecurity = employeeSecurityResult?.ok ? employeeSecurityResult.data : undefined;
  const providerDirectory = buildProviderDisplayDirectory(
    providerConnectionsResult?.ok ? providerConnectionsResult.data : []
  );
  const employeeOptions = activeTab === "security"
    ? employeeSecurity?.data ?? []
    : employeeUsage?.data ?? [];
  const selectedEmployeeId = employeeOptions.some(
    (employee) => employee.employeeId === filters.employeeId
  )
    ? filters.employeeId
    : "";
  const activePrimaryTab = primaryTabFor(activeTab);
  const secondaryTabs = costPolicyTabs.includes(activeTab)
    ? costPolicyTabs
    : operationsTabs.includes(activeTab)
      ? operationsTabs
      : [];

  return (
    <main className="console-content analytics-v3-page analytics-v4-page analytics-v5-page">
      <AnalyticsFilterFrame
        filterState={{
          employeeId: selectedEmployeeId,
          projectId: filters.projectId,
          range: filters.range,
          tab: activeTab
        }}
        loadingLabel={text.updating}
      >
      <header className="analytics-v3-command-header">
        <div className="analytics-v3-title-block">
          <h1>{text.title}</h1>
          {text.subtitle ? <p>{text.subtitle}</p> : null}
        </div>

        <div
          aria-label={text.filterAria}
          className="analytics-v3-filter-bar"
          role="group"
        >
          {activeTab !== "usage" ? <label className="analytics-v3-employee-filter">
            <span>{text.employee}</span>
            <AnalyticsFilterSelect defaultValue={selectedEmployeeId} name="employeeId">
              <option value="">{text.allEmployees}</option>
              {employeeOptions.map((employee) => (
                <option key={employee.employeeId} value={employee.employeeId}>
                  {employee.name?.trim() || employee.email}
                </option>
              ))}
            </AnalyticsFilterSelect>
            <i aria-hidden="true" className="analytics-v3-select-caret" />
          </label> : null}
          <label>
            <span>{text.range}</span>
            <AnalyticsFilterSelect defaultValue={filters.range} name="range">
              {rangeValues.map((range) => (
                <option key={range} value={range}>{text.rangeLabels[range]}</option>
              ))}
            </AnalyticsFilterSelect>
            <i aria-hidden="true" className="analytics-v3-select-caret" />
          </label>
          <label className="analytics-v3-project-filter">
            <span>{text.project}</span>
            <AnalyticsFilterSelect defaultValue={filters.projectId} name="projectId">
              {projectScoped ? null : <option value="">{text.allProjects}</option>}
              {filters.projectId && !projects.some((project) => project.id === filters.projectId) ? (
                <option disabled value={filters.projectId}>{text.projectUnavailable}</option>
              ) : null}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </AnalyticsFilterSelect>
            <i aria-hidden="true" className="analytics-v3-select-caret" />
          </label>
        </div>
      </header>

      <nav aria-label={text.primaryNavAria} className="analytics-v3-tabs">
        {primaryTabConfig.map((tab) => {
          const Icon = tab.icon;
          return (
            <IntentPrefetchLink
              aria-current={tab.id === activePrimaryTab ? "page" : undefined}
              className="analytics-v3-tab"
              data-active={tab.id === activePrimaryTab}
              href={tabHref(effectiveTenantId, tab.id, filters, activeTab)}
              key={tab.id}
            >
              <Icon aria-hidden="true" size={18} />
              {text.primaryTabs[tab.id]}
            </IntentPrefetchLink>
          );
        })}
      </nav>

      {secondaryTabs.length > 0 ? (
        <nav aria-label={text.secondaryNavAria} className="analytics-v3-subtabs">
          {secondaryTabs.map((tab) => (
            <IntentPrefetchLink
              aria-current={tab === activeTab ? "page" : undefined}
              className="analytics-v3-subtab"
              data-active={tab === activeTab}
              href={tabHref(effectiveTenantId, tab, filters, activeTab)}
              key={tab}
            >
              {text.tabs[tab]}
            </IntentPrefetchLink>
          ))}
        </nav>
      ) : null}

      <AnalyticsPanelTransition>
      {activeTab === "impact" ? (
        <AnalyticsV5Overview
          locale={locale}
          model={model}
        />
      ) : activeTab === "usage" ? (
        <AnalyticsLiveUsagePanel
          fallback={{
            dataAsOf: model.dataAsOf,
            dataState: model.dataState,
            rateLimitedRequestCount:
              projectApplicationOverview?.rateLimitedRequests ?? 0,
            requestCount: model.usage.totalRequests,
            requestVolume: model.usage.requestVolume,
            sourceMix: model.usage.sourceMix.map((row) => ({
              id: row.id,
              value: row.value
            }))
          }}
          locale={locale}
          projectId={filters.projectId}
          projects={projects}
          range={filters.range}
          tenantId={effectiveTenantId}
        />
      ) : activeTab === "cost" ? (
        <AnalyticsCostPanel
          costTrend={costTrend}
          employeeUsage={employeeUsage}
          locale={locale}
          model={model}
          projectNameById={projectNameById}
          selectedEmployeeId={selectedEmployeeId}
        />
      ) : activeTab === "performance" ? (
        <AnalyticsPerformancePanel
          locale={locale}
          model={model}
          performance={performance}
          projectNameById={projectNameById}
          providerDirectory={providerDirectory}
          range={filters.range}
          tenantId={effectiveTenantId}
        />
      ) : activeTab === "reliability" ? (
        <AnalyticsReliabilityPanel
          locale={locale}
          model={model}
          projectNameById={projectNameById}
          reliability={reliability}
          range={filters.range}
          tenantId={effectiveTenantId}
        />
      ) : activeTab === "security" ? (
        <AnalyticsSecurityPanel
          employeeSecurity={employeeSecurity}
          evidence={securityEvidence}
          locale={locale}
          model={model}
          selectedEmployeeId={selectedEmployeeId}
        />
      ) : (
        <AnalyticsCachePanel locale={locale} model={model} />
      )}
      </AnalyticsPanelTransition>
      </AnalyticsFilterFrame>
    </main>
  );
}

function buildFilters(
  searchParams: Awaited<AnalyticsPageProps["searchParams"]>,
  activeTab: AnalyticsTab
): AnalyticsFilterState {
  return {
    employeeId: normalizeText(searchParams?.employeeId),
    projectId: normalizeText(searchParams?.projectId),
    range: normalizeRange(searchParams?.range, activeTab === "usage" ? "15m" : "1w")
  };
}

function normalizeRange(
  value: string | undefined,
  fallback: LiveAnalyticsRange
): LiveAnalyticsRange {
  return value === "15m" || value === "1h" || value === "1d" || value === "1w"
    ? value
    : fallback;
}

function normalizeTab(value: string | undefined): AnalyticsTab {
  return value === "usage" ||
    value === "cost" ||
    value === "performance" ||
    value === "reliability" ||
    value === "security" ||
    value === "cache"
    ? value
    : "impact";
}

function primaryTabFor(tab: AnalyticsTab): AnalyticsPrimaryTab {
  if (tab === "cost" || tab === "cache") {
    return "impact";
  }

  if (tab === "reliability") {
    return "performance";
  }

  return tab;
}

function normalizeText(value: string | undefined) {
  return value?.trim() ?? "";
}

function tabHref(
  tenantId: string,
  tab: AnalyticsTab,
  filters: AnalyticsFilterState,
  activeTab: AnalyticsTab
) {
  const range = tab === "usage" && activeTab !== "usage" ? "15m" : filters.range;
  const query = new URLSearchParams({ range, tab });
  appendQuery(query, "projectId", filters.projectId);
  appendQuery(query, "employeeId", filters.employeeId);
  return `/tenants/${tenantId}/analytics?${query.toString()}`;
}

function appendQuery(query: URLSearchParams, key: string, value: string) {
  if (value) {
    query.set(key, value);
  }
}

function costSeriesIsPartial(input: {
  projectApplicationAvailable: boolean;
  projectApplicationSeriesAvailable: boolean;
  tenantChatAvailable: boolean;
  tenantChatSeriesAvailable: boolean;
}) {
  return (
    (input.projectApplicationAvailable && !input.projectApplicationSeriesAvailable) ||
    (input.tenantChatAvailable && !input.tenantChatSeriesAvailable)
  );
}

function markAnalyticsUsagePartial(
  overview: DashboardOverview | undefined
): DashboardOverview | undefined {
  if (!overview) {
    return undefined;
  }

  const current = overview.queryBudget;
  if (current?.status === "unavailable" || current?.status === "too_broad") {
    return overview;
  }

  const guidance = [current?.guidance, "One or more usage time series are unavailable."]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");

  return {
    ...overview,
    queryBudget: {
      guidance,
      maxBreakdownItems: current?.maxBreakdownItems ?? 50,
      maxRangeHours: current?.maxRangeHours ?? 24,
      status: "partial"
    }
  };
}

function markAnalyticsCostPartial(
  overview: DashboardOverview | undefined
): DashboardOverview | undefined {
  if (!overview) {
    return undefined;
  }

  const current = overview.queryBudget;
  if (current?.status === "unavailable" || current?.status === "too_broad") {
    return overview;
  }

  const guidance = [current?.guidance, "One or more cost time series are unavailable."]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");

  return {
    ...overview,
    queryBudget: {
      guidance,
      maxBreakdownItems: current?.maxBreakdownItems ?? 50,
      maxRangeHours: current?.maxRangeHours ?? 24,
      status: "partial"
    }
  };
}
