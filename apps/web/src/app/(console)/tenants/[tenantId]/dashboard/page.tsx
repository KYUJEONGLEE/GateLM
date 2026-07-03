import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import {
  type DashboardFilterState,
  DashboardOverviewView
} from "@/features/dashboard/components/dashboard-overview";
import { RequestLogDetailAside } from "@/features/request-logs/components/request-log-detail";
import {
  getLiveDashboardOverview,
  type LiveDashboardOverviewFilters
} from "@/lib/gateway/live-dashboard-overview";
import { getLiveGatewayRequestDetail } from "@/lib/gateway/live-request-detail";
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
    resolvedBy?: string;
    tab?: string;
    view?: string;
  }>;
};

export default async function DashboardPage({ params, searchParams }: DashboardPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const requestedTab = resolvedSearchParams?.tab ?? (resolvedSearchParams?.view === "cache" ? "cache" : undefined);
  const selectedRequestId = resolvedSearchParams?.requestId;
  const { dashboardFilters, liveFilters } = buildDashboardFilters(resolvedSearchParams);
  const activeTab =
    requestedTab === "requests" ||
    requestedTab === "traffic"
      ? "requests"
      : requestedTab === "cache" ||
          requestedTab === "routing" ||
          requestedTab === "safety" ||
          requestedTab === "limits"
        ? requestedTab
        : "overview";
  const suppressContentMotion = activeTab === "overview" && resolvedSearchParams?.motion === "none";
  const [locale, overview, recentRecords, rateLimitedRecords, selectedDetail] = await Promise.all([
    getRequestLocale(),
    getLiveDashboardOverview(tenantId, liveFilters),
    getLiveGatewayRequestLogs(),
    getLiveGatewayRequestLogs({ limit: 5, status: "rate_limited" }),
    selectedRequestId ? getLiveGatewayRequestDetail(selectedRequestId) : Promise.resolve(null)
  ]);
  const scopedSelectedDetail =
    selectedDetail ?? recentRecords?.find((record) => record.requestId === selectedRequestId);

  if (!overview) {
    return (
      <ConsoleShell activeSection="dashboard" locale={locale} tenantId={tenantId}>
        <main className="console-content">
          <section className="dashboard-hero">
            <div>
              <p className="console-kicker">Gateway connection</p>
              <h2>Dashboard unavailable</h2>
              <p>Live Gateway metrics are not available right now.</p>
            </div>
          </section>
        </main>
      </ConsoleShell>
    );
  }

  if (tenantId !== overview.filters.tenantId) {
    notFound();
  }

  return (
    <ConsoleShell activeSection="dashboard" locale={locale} tenantId={tenantId}>
      <DashboardOverviewView
        activeTab={activeTab}
        detailPanel={
          scopedSelectedDetail ? (
            <RequestLogDetailAside
              locale={locale}
              record={scopedSelectedDetail}
              tenantId={tenantId}
              timezone="UTC"
            />
          ) : undefined
        }
        locale={locale}
        filters={dashboardFilters}
        overview={overview}
        rateLimitedRecords={rateLimitedRecords ?? []}
        recentRecords={recentRecords?.slice(0, 5) ?? []}
        suppressContentMotion={suppressContentMotion}
      />
    </ConsoleShell>
  );
}

function buildDashboardFilters(searchParams: Awaited<DashboardPageProps["searchParams"]>): {
  dashboardFilters: DashboardFilterState;
  liveFilters: LiveDashboardOverviewFilters;
} {
  const budgetScopeId = normalizeOptionalText(searchParams?.budgetScopeId);
  const budgetScopeType = normalizeBudgetScopeTypeFilter(searchParams?.budgetScopeType);
  const projectId = normalizeOptionalText(searchParams?.projectId);
  const resolvedBy = normalizeOptionalText(searchParams?.resolvedBy);

  return {
    dashboardFilters: {
      budgetScopeId,
      budgetScopeType,
      projectId,
      resolvedBy
    },
    liveFilters: {
      budgetScopeId: budgetScopeId || undefined,
      budgetScopeType: budgetScopeType || undefined,
      projectId: projectId || undefined,
      resolvedBy: resolvedBy || undefined
    }
  };
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
