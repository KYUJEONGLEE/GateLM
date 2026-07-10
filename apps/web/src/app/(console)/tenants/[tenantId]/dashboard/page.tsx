import { Suspense } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  DASHBOARD_RANGE_PREFERENCE_COOKIE,
  DEFAULT_DASHBOARD_RANGE,
  normalizeDashboardRangePreference
} from "@/features/dashboard/dashboard-range-preference";
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
  getLiveDashboardOverview,
  type LiveDashboardOverviewFilters
} from "@/lib/gateway/live-dashboard-overview";
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
  const cookieStore = await cookies();
  const preferredRange = normalizeDashboardRangePreference(
    cookieStore.get(DASHBOARD_RANGE_PREFERENCE_COOKIE)?.value
  );
  const { dashboardFilters, liveFilters } = buildDashboardFilters(
    resolvedSearchParams,
    preferredRange
  );
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
  const overview = await getLiveDashboardOverview(effectiveTenantId, scopedLiveFilters);

  if (!overview) {
    return (
      <main className="console-content">
        <section className="dashboard-hero">
          <div>
            <h2>Dashboard unavailable</h2>
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
      filters={scopedDashboardFilters}
      monthToDateSpendValue={
        <Suspense fallback={formatDashboardMicroUsd(overview.totalCostMicroUsd)}>
          <MonthToDateSpendValue
            fallbackMicroUsd={overview.totalCostMicroUsd}
            filters={scopedLiveFilters}
            tenantId={effectiveTenantId}
          />
        </Suspense>
      }
      overview={overview}
      projects={visibleProjects.filter((project) => project.status !== "ARCHIVED")}
      allowAllProjects={!projectScoped}
      suppressContentMotion={suppressContentMotion}
    />
  );
}

async function MonthToDateSpendValue({
  fallbackMicroUsd,
  filters,
  tenantId
}: {
  fallbackMicroUsd: number;
  filters: LiveDashboardOverviewFilters;
  tenantId: string;
}) {
  const monthToDateRange = getMonthToDateRange();
  const summary = await getLiveCostOverTime(tenantId, {
    ...filters,
    from: monthToDateRange.from,
    to: monthToDateRange.to
  });
  const totalSpendUsd = summary?.points?.reduce((sum, point) => sum + point.spendUsd, 0);

  return <>{formatDashboardMicroUsd(totalSpendUsd === undefined ? fallbackMicroUsd : totalSpendUsd * 1_000_000)}</>;
}

function buildDashboardFilters(
  searchParams: Awaited<DashboardPageProps["searchParams"]>,
  preferredRange?: DashboardRange
): {
  dashboardFilters: DashboardFilterState;
  liveFilters: LiveDashboardOverviewFilters;
} {
  const budgetScopeId = normalizeOptionalText(searchParams?.budgetScopeId);
  const budgetScopeType = normalizeBudgetScopeTypeFilter(searchParams?.budgetScopeType);
  const projectId = normalizeOptionalText(searchParams?.projectId);
  const range = normalizeDashboardRange(searchParams?.range, preferredRange);
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

function normalizeDashboardRange(
  value: string | undefined,
  fallbackRange: DashboardRange = DEFAULT_DASHBOARD_RANGE
): DashboardRange {
  return normalizeDashboardRangePreference(value) ?? fallbackRange;
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

function formatDashboardMicroUsd(value: number) {
  const dollars = value / 1_000_000;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: dollars > 0 && dollars < 1 ? 6 : 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(Number.isFinite(dollars) ? dollars : 0);
}
