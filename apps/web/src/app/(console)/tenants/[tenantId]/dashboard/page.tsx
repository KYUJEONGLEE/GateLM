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
import { getTenantChatDashboard } from "@/lib/control-plane/tenant-chat-observability-client";
import {
  type DashboardSurface,
  selectDashboardSurfaceOverview,
  toTenantChatDashboardOverview
} from "@/lib/dashboard/unified-dashboard";
import { getLiveCostOverTime } from "@/lib/gateway/live-cost-report";
import {
  getLiveDashboardOverview,
  getDashboardLiveRange,
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
    surface?: string;
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
  const projectScoped = isProjectScopedForTenant(auth, effectiveTenantId);
  const projectsPromise = getProjectsModel(effectiveTenantId);
  let projectsModel: Awaited<ReturnType<typeof getProjectsModel>>;
  let effectiveProjectId: string | null | undefined;
  let overviewPromise: ReturnType<typeof getLiveDashboardOverview>;

  if (projectScoped) {
    projectsModel = await projectsPromise;
    effectiveProjectId = resolveProjectIdForConsoleAuth({
      auth,
      projects: projectsModel.projects,
      requestedProjectId: liveFilters.projectId,
      routeTenantId: effectiveTenantId
    });

    if (effectiveProjectId === null) {
      notFound();
    }

    overviewPromise = getLiveDashboardOverview(effectiveTenantId, {
      ...liveFilters,
      projectId: effectiveProjectId ?? liveFilters.projectId
    });
  } else {
    effectiveProjectId = liveFilters.projectId;
    overviewPromise = getLiveDashboardOverview(effectiveTenantId, liveFilters);
    projectsModel = await projectsPromise;
  }

  const scopedLiveFilters = {
    ...liveFilters,
    projectId: effectiveProjectId ?? liveFilters.projectId
  };
  const scopedDashboardFilters = {
    ...dashboardFilters,
    projectId: effectiveProjectId ?? dashboardFilters.projectId,
    surface:
      projectScoped ||
      effectiveProjectId ||
      dashboardFilters.projectId ||
      dashboardFilters.budgetScopeType ||
      dashboardFilters.budgetScopeId ||
      dashboardFilters.resolvedBy
        ? "project_application" as const
        : dashboardFilters.surface
  };
  const visibleProjects = getVisibleProjectsForConsoleAuth(projectsModel.projects, auth, effectiveTenantId);
  const { from, to } = getDashboardLiveRange(scopedLiveFilters.range);
  const [projectApplicationOverview, tenantChatDashboard] = await Promise.all([
    scopedDashboardFilters.surface === "tenant_chat"
      ? Promise.resolve(undefined)
      : overviewPromise,
    scopedDashboardFilters.surface === "project_application"
      ? Promise.resolve(undefined)
      : getTenantChatDashboard(effectiveTenantId, from, to)
  ]);
  const tenantChatOverview = tenantChatDashboard
    ? toTenantChatDashboardOverview(effectiveTenantId, tenantChatDashboard)
    : undefined;
  const overview = selectDashboardSurfaceOverview(
    scopedDashboardFilters.surface,
    projectApplicationOverview,
    tenantChatOverview,
    { tenantChatNotConfigured: tenantChatDashboard === null }
  );

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
            surface={scopedDashboardFilters.surface}
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
  surface,
  tenantId
}: {
  fallbackMicroUsd: number;
  filters: LiveDashboardOverviewFilters;
  surface: DashboardSurface;
  tenantId: string;
}) {
  const monthToDateRange = getMonthToDateRange();
  const [summary, tenantChat] = await Promise.all([
    surface === "tenant_chat"
      ? Promise.resolve(undefined)
      : getLiveCostOverTime(tenantId, {
          ...filters,
          from: monthToDateRange.from,
          to: monthToDateRange.to
        }),
    surface === "project_application"
      ? Promise.resolve(undefined)
      : getTenantChatDashboard(tenantId, monthToDateRange.from, monthToDateRange.to)
  ]);
  const totalSpendUsd = summary?.points?.reduce((sum, point) => sum + point.spendUsd, 0);
  const totalMicroUsd =
    (totalSpendUsd === undefined ? 0 : totalSpendUsd * 1_000_000) +
    (tenantChat?.usage.confirmedCostMicroUsd ?? 0);
  const hasCurrentData = summary !== undefined || tenantChat !== undefined;

  return <>{formatDashboardMicroUsd(hasCurrentData ? totalMicroUsd : fallbackMicroUsd)}</>;
}

function buildDashboardFilters(
  searchParams: Awaited<DashboardPageProps["searchParams"]>,
  preferredRange?: DashboardRange
): {
  dashboardFilters: DashboardFilterState;
  liveFilters: LiveDashboardOverviewFilters;
} {
  const surface = normalizeDashboardSurface(searchParams?.surface);
  const tenantChatOnly = surface === "tenant_chat";
  const budgetScopeId = tenantChatOnly ? "" : normalizeOptionalText(searchParams?.budgetScopeId);
  const budgetScopeType = tenantChatOnly
    ? ""
    : normalizeBudgetScopeTypeFilter(searchParams?.budgetScopeType);
  const projectId = tenantChatOnly ? "" : normalizeOptionalText(searchParams?.projectId);
  const range = normalizeDashboardRange(searchParams?.range, preferredRange);
  const resolvedBy = tenantChatOnly ? "" : normalizeOptionalText(searchParams?.resolvedBy);

  return {
    dashboardFilters: {
      budgetScopeId,
      budgetScopeType,
      projectId,
      range,
      resolvedBy,
      surface
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

function normalizeDashboardSurface(value: string | undefined): DashboardSurface {
  if (value === "project_application" || value === "tenant_chat") {
    return value;
  }
  return "all";
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
