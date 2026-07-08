import { notFound } from "next/navigation";
import {
  getCurrentConsoleAuth,
  getVisibleProjectsForConsoleAuth,
  isProjectScopedForTenant,
  resolveConsoleTenantIdForAuth,
  resolveProjectIdForConsoleAuth
} from "@/lib/auth/current-console-auth";
import {
  type DashboardRange,
  type DashboardFilterState,
  DashboardOverviewView
} from "@/features/dashboard/components/dashboard-overview";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getLiveCostOverTime } from "@/lib/gateway/live-cost-report";
import {
  getDashboardLiveRange,
  getLiveDashboardOverview,
  type LiveDashboardOverviewFilters
} from "@/lib/gateway/live-dashboard-overview";
import { getLiveOverviewRequests } from "@/lib/gateway/live-overview-requests";
import { getLiveGatewayRequestLogs } from "@/lib/gateway/live-request-logs";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type DashboardPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
  searchParams?: Promise<{
    budgetScopeId?: string;
    budgetScopeType?: string;
    motion?: string;
    projectId?: string;
    requestId?: string;
    range?: string;
    resolvedBy?: string;
    tab?: string;
    view?: string;
  }>;
};

export default async function DashboardPage({ params, searchParams }: DashboardPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const { dashboardFilters, liveFilters } = buildDashboardFilters(resolvedSearchParams);
  const liveRange = getDashboardLiveRange(dashboardFilters.range);
  const monthToDateRange = getMonthToDateRange();
  const suppressContentMotion = resolvedSearchParams?.motion === "none";
  const [locale, auth] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  const projectsModel = await getProjectsModel(effectiveTenantId);
  const projectScoped = isProjectScopedForTenant(auth, effectiveTenantId);
  const effectiveProjectId = resolveProjectIdForConsoleAuth({
    auth,
    projects: projectsModel.projects,
    requestedProjectId: liveFilters.projectId,
    routeTenantId: effectiveTenantId
  });

  if (effectiveProjectId === null) {
    notFound();
  }

  const scopedLiveFilters = {
    ...liveFilters,
    projectId: effectiveProjectId ?? liveFilters.projectId
  };
  const scopedDashboardFilters = {
    ...dashboardFilters,
    projectId: effectiveProjectId ?? dashboardFilters.projectId
  };
  const visibleProjects = getVisibleProjectsForConsoleAuth(projectsModel.projects, auth, effectiveTenantId);
  const [overview, monthToDateOverview, costOverTime, liveRequests, recentRecords] = await Promise.all([
    getLiveDashboardOverview(effectiveTenantId, scopedLiveFilters),
    getLiveDashboardOverview(effectiveTenantId, {
      ...scopedLiveFilters,
      from: monthToDateRange.from,
      to: monthToDateRange.to
    }),
    getLiveCostOverTime(effectiveTenantId, scopedLiveFilters),
    getLiveOverviewRequests(effectiveTenantId, scopedLiveFilters),
    getLiveGatewayRequestLogs({
      from: liveRange.from,
      limit: 100,
      projectId: scopedLiveFilters.projectId,
      tenantId: effectiveTenantId,
      to: liveRange.to
    })
  ]);

  if (!overview) {
    return (
      <main className="console-content">
        <section className="dashboard-hero">
          <div>
            <p className="console-kicker">Gateway connection</p>
            <h2>Dashboard unavailable</h2>
            <p>Live Gateway metrics are not available right now.</p>
          </div>
        </section>
      </main>
    );
  }

  if (effectiveTenantId !== overview.filters.tenantId) {
    notFound();
  }

  return (
    <DashboardOverviewView
      locale={locale}
      costOverTime={costOverTime}
      filters={scopedDashboardFilters}
      liveRequests={liveRequests}
      monthToDateOverview={monthToDateOverview}
      overview={overview}
      projects={visibleProjects.filter((project) => project.status !== "ARCHIVED")}
      recentRecords={recentRecords ?? []}
      allowAllProjects={!projectScoped}
      suppressContentMotion={suppressContentMotion}
    />
  );
}

function buildDashboardFilters(searchParams: Awaited<DashboardPageProps["searchParams"]>): {
  dashboardFilters: DashboardFilterState;
  liveFilters: LiveDashboardOverviewFilters;
} {
  const budgetScopeId = normalizeOptionalText(searchParams?.budgetScopeId);
  const budgetScopeType = normalizeBudgetScopeTypeFilter(searchParams?.budgetScopeType);
  const projectId = normalizeOptionalText(searchParams?.projectId);
  const range = normalizeDashboardRange(searchParams?.range);
  const resolvedBy = normalizeOptionalText(searchParams?.resolvedBy);

  return {
    dashboardFilters: {
      budgetScopeId,
      budgetScopeType,
      projectId,
      range,
      resolvedBy
    },
    liveFilters: {
      budgetScopeId: budgetScopeId || undefined,
      budgetScopeType: budgetScopeType || undefined,
      projectId: projectId || undefined,
      range,
      resolvedBy: resolvedBy || undefined
    }
  };
}

function normalizeDashboardRange(value: string | undefined): DashboardRange {
  if (value === "1h" || value === "1d" || value === "1w") {
    return value;
  }

  return "15m";
}

function normalizeBudgetScopeTypeFilter(value: string | undefined): DashboardFilterState["budgetScopeType"] {
  if (value === "application" || value === "project" || value === "team") {
    return value;
  }

  return "";
}

function normalizeOptionalText(value: string | undefined) {
  return value?.trim() ?? "";
}

function getMonthToDateRange() {
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));

  return {
    from: from.toISOString(),
    to: to.toISOString()
  };
}
