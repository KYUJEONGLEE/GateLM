import { notFound } from "next/navigation";
import { ConsoleShell } from "@/components/layout/console-shell";
import {
  type DashboardRange,
  type DashboardFilterState,
  DashboardOverviewView
} from "@/features/dashboard/components/dashboard-overview";
import { RequestLogDetailAside } from "@/features/request-logs/components/request-log-detail";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import {
  getDashboardLiveRange,
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
    range?: string;
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
  const liveRange = getDashboardLiveRange(dashboardFilters.range);
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
  const [locale, overview, recentRecords, rateLimitedRecords] = await Promise.all([
    getRequestLocale(),
    getLiveDashboardOverview(tenantId, liveFilters),
    getLiveGatewayRequestLogs({ from: liveRange.from, limit: 50, tenantId, to: liveRange.to }),
    getLiveGatewayRequestLogs({
      from: liveRange.from,
      limit: 5,
      status: "rate_limited",
      tenantId,
      to: liveRange.to
    })
  ]);
  const selectedRecord = selectedRequestId
    ? recentRecords?.find((record) => record.requestId === selectedRequestId)
    : undefined;
  const selectedDetail = selectedRequestId
    ? await getLiveGatewayRequestDetail(selectedRequestId, {
        projectId: selectedRecord?.projectId,
        tenantId
      })
    : null;
  const scopedSelectedDetail =
    selectedDetail ?? recentRecords?.find((record) => record.requestId === selectedRequestId);
  const displayScopedSelectedDetail = scopedSelectedDetail
    ? toDisplayModelRecord(scopedSelectedDetail)
    : undefined;

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
          displayScopedSelectedDetail ? (
            <RequestLogDetailAside
              locale={locale}
              record={displayScopedSelectedDetail}
              tenantId={tenantId}
              timezone="UTC"
            />
          ) : undefined
        }
        locale={locale}
        filters={dashboardFilters}
        overview={overview}
        rateLimitedRecords={(rateLimitedRecords ?? []).map(toDisplayModelRecord)}
        recentRecords={(recentRecords ?? []).slice(0, 5).map(toDisplayModelRecord)}
        suppressContentMotion={suppressContentMotion}
      />
    </ConsoleShell>
  );
}

function toDisplayModelRecord(record: InvocationLogRecord): InvocationLogRecord {
  return {
    ...record,
    requestedModel: record.requestedModel ? formatModelDisplayName(record.requestedModel) : record.requestedModel,
    selectedModel: record.selectedModel ? formatModelDisplayName(record.selectedModel) : record.selectedModel
  };
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
