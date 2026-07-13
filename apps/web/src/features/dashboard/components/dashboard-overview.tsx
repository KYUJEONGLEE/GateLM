import {
  Activity,
  CheckCircle2,
  DollarSign,
  RotateCcw
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { CostOverTimeCard } from "@/features/dashboard/components/cost-over-time-card";
import { DashboardAutoRefresh } from "@/features/dashboard/components/dashboard-auto-refresh";
import {
  DashboardLineEChart,
  DashboardPieEChart
} from "@/features/dashboard/components/dashboard-echarts";
import { DashboardFilterForm } from "@/features/dashboard/components/dashboard-filter-form";
import { DashboardRangePreferenceSync } from "@/features/dashboard/components/dashboard-range-preference-sync";
import { LiveRequestsCard } from "@/features/dashboard/components/live-requests-card";
import {
  ProviderModelUsageCard,
  type ProviderModelUsageProvider,
  type ProviderModelUsageRow
} from "@/features/dashboard/components/provider-model-usage-card";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { CostOverTimeSummary } from "@/lib/gateway/cost-over-time-types";
import type { LiveDashboardOverview as DashboardOverview } from "@/lib/gateway/live-dashboard-overview";
import type { LiveInvocationLogRecord as InvocationLogRecord } from "@/lib/gateway/live-observability-contract";
import type { LiveRequestsPayload } from "@/lib/gateway/live-requests-types";
import {
  formatBudgetScopeDisplayName,
  formatBudgetScopeTypeDisplayName,
  formatDisplayIdentifier,
  formatModelDisplayName
} from "@/lib/formatting/display-identifiers";
import {
  formatInteger,
  formatLatency,
  formatPercent,
  formatUsd
} from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type DashboardOverviewProps = {
  activeTab?: DashboardTab;
  allowAllProjects?: boolean;
  costOverTime?: CostOverTimeSummary;
  detailPanel?: ReactNode;
  filters: DashboardFilterState;
  liveRequests?: LiveRequestsPayload;
  locale: Locale;
  monthToDateOverview?: DashboardOverview;
  monthToDateSpendValue?: ReactNode;
  overview: DashboardOverview;
  projects?: ProjectRecord[];
  rateLimitedRecords?: InvocationLogRecord[];
  recentRecords?: InvocationLogRecord[];
  suppressContentMotion?: boolean;
};

type DashboardTab = "overview" | "requests" | "cache" | "routing" | "safety" | "limits";
type DashboardVisibleTab = Exclude<DashboardTab, "overview">;
export type DashboardRange = "5m" | "15m" | "1h" | "1d" | "1w";
export type DashboardFilterState = {
  budgetScopeId: string;
  budgetScopeType: "" | "application" | "project" | "team";
  projectId: string;
  range: DashboardRange;
  resolvedBy: string;
  surface: "all" | "project_application" | "tenant_chat";
};

const dashboardTabs: DashboardVisibleTab[] = ["requests", "cache", "routing", "safety", "limits"];
const dashboardRanges: DashboardRange[] = ["5m", "15m", "1h", "1d", "1w"];
const statusOrder = ["success", "blocked", "rate_limited", "failed", "cancelled"];
const chartColors = ["#3b82f6", "#ef4444", "#10a37f", "#f59e0b", "#8b5cf6"];

const dashboardText: Record<
  Locale,
  {
    actionRequestLogs: string;
    backToOverview: string;
    costByModel: string;
    dashboardFilters: string;
    dataAsOf: string;
    keyMetrics: string;
    kpi: {
      monthCost: string;
      monthCostDetail: string;
      successRate: string;
      successful: string;
      totalRequests: string;
    };
    overviewWorkspace: string;
    refreshDashboard: string;
    metrics: {
      averageLatency: string;
      averageP95Latency: string;
      budgetLedgerCost: string;
      budgetScope: string;
      blocked: string;
      cacheHitRate: string;
      cancelled: string;
      failed: string;
      fallbackSuccess: string;
      p95Latency: string;
      rateLimited: string;
      records: string;
      savedCost: string;
      systemErrorRate: string;
      successful: string;
      totalCost: string;
      totalRequests: string;
      totalTokens: string;
    };
    charts: {
      cache: string;
      cacheHits: string;
      cacheRequests: string;
      cacheShare: string;
      modelShare: string;
      projectBudgetAttribution: string;
      requests: string;
      requestTrend: string;
      successful: string;
      traffic: string;
    };
    filter: {
      apply: string;
      budgetScopeId: string;
      budgetScopeType: string;
      projectId: string;
      reset: string;
      resolvedBy: string;
    };
    maskingActions: string;
    budgetScopeBreakdown: string;
    queryBudget: string;
    rateLimitEvidence: string;
    routingSummary: string;
    statusDistribution: string;
    tabs: Record<DashboardTab, string>;
    title: string;
  }
> = {
  en: {
    actionRequestLogs: "Open request logs",
    backToOverview: "Back to overview",
    costByModel: "Cost by model",
    dashboardFilters: "Dashboard filters",
    dataAsOf: "Data as of",
    filter: {
      apply: "Apply",
      budgetScopeId: "Policy ID",
      budgetScopeType: "Policy boundary",
      projectId: "Project",
      reset: "Reset",
      resolvedBy: "Resolved by"
    },
    charts: {
      cache: "Cache",
      cacheHits: "Cache hits",
      cacheRequests: "Cache requests",
      cacheShare: "Cache share",
      modelShare: "Model request share",
      projectBudgetAttribution: "Project budget attribution",
      requests: "Requests",
      requestTrend: "Request trend",
      successful: "Successful",
      traffic: "Requests"
    },
    metrics: {
      averageLatency: "Average latency",
      averageP95Latency: "Average/P95 latency",
      budgetLedgerCost: "Budget ledger cost",
      budgetScope: "Project budget",
      blocked: "Blocked",
      cacheHitRate: "Cache hit rate",
      cancelled: "Cancelled",
      failed: "Failed",
      fallbackSuccess: "Fallback success",
      p95Latency: "P95 latency",
      rateLimited: "Rate limited",
      records: "Records",
      savedCost: "Saved cost",
      systemErrorRate: "System error rate",
      successful: "Successful",
      totalCost: "Total cost",
      totalRequests: "Total requests",
      totalTokens: "Total tokens"
    },
    keyMetrics: "Dashboard key metrics",
    kpi: {
      monthCost: "Month-to-date cost",
      monthCostDetail: "Live accumulated cost for this month",
      successRate: "Success rate",
      successful: "successful",
      totalRequests: "Total requests"
    },
    overviewWorkspace: "Dashboard overview workspace",
    refreshDashboard: "Refresh dashboard",
    maskingActions: "Masking actions",
    budgetScopeBreakdown: "Project policy/budget breakdown",
    queryBudget: "Query budget",
    rateLimitEvidence: "Rate limit evidence",
    routingSummary: "Routing by category and difficulty",
    statusDistribution: "Status distribution",
    tabs: {
      overview: "Overview",
      requests: "Requests",
      cache: "Cache",
      routing: "Routing",
      safety: "Safety",
      limits: "Limits"
    },
    title: "Overview"
  },
  ko: {
    actionRequestLogs: "요청 로그 열기",
    backToOverview: "개요로 돌아가기",
    costByModel: "모델별 비용",
    dashboardFilters: "대시보드 필터",
    dataAsOf: "데이터 기준 시각",
    filter: {
      apply: "적용",
      budgetScopeId: "Policy ID",
      budgetScopeType: "Policy boundary",
      projectId: "Project",
      reset: "초기화",
      resolvedBy: "Resolved by"
    },
    charts: {
      cache: "Cache",
      cacheHits: "캐시 적중",
      cacheRequests: "캐시 요청",
      cacheShare: "캐시 비중",
      modelShare: "모델 요청 비중",
      projectBudgetAttribution: "Project 예산 귀속",
      requests: "Requests",
      requestTrend: "요청 추이",
      successful: "전송 성공",
      traffic: "Requests"
    },
    metrics: {
      averageLatency: "평균 지연",
      averageP95Latency: "평균/P95 지연",
      budgetLedgerCost: "Budget ledger 비용",
      budgetScope: "Project budget",
      blocked: "차단",
      cacheHitRate: "캐시 적중률",
      cancelled: "취소",
      failed: "실패",
      fallbackSuccess: "Fallback 성공",
      p95Latency: "P95 지연",
      rateLimited: "Rate limit",
      records: "레코드",
      savedCost: "절감 비용",
      systemErrorRate: "시스템 오류율",
      successful: "성공",
      totalCost: "총 비용",
      totalRequests: "총 요청",
      totalTokens: "총 토큰"
    },
    keyMetrics: "대시보드 핵심 지표",
    kpi: {
      monthCost: "이번 달 누적 비용",
      monthCostDetail: "이번 달 실시간 누적 비용",
      successRate: "성공률",
      successful: "성공",
      totalRequests: "총 요청"
    },
    overviewWorkspace: "대시보드 개요 영역",
    refreshDashboard: "대시보드 새로고침",
    maskingActions: "마스킹 동작",
    budgetScopeBreakdown: "Project 정책/예산 집계",
    queryBudget: "Query budget",
    rateLimitEvidence: "Rate limit 증거",
    routingSummary: "카테고리·난이도별 라우팅",
    statusDistribution: "상태 분포",
    tabs: {
      overview: "Overview",
      requests: "Requests",
      cache: "Cache",
      routing: "Routing",
      safety: "Safety",
      limits: "Limits"
    },
    title: "Overview"
  }
};

type DashboardCopy = (typeof dashboardText)[Locale];

export function DashboardOverviewView({
  allowAllProjects = true,
  costOverTime,
  detailPanel,
  filters,
  liveRequests,
  locale,
  monthToDateOverview,
  monthToDateSpendValue,
  overview,
  projects = [],
  suppressContentMotion = false
}: DashboardOverviewProps) {
  const text = dashboardText[locale];
  const monthToDate = monthToDateOverview ?? overview;
  const successRate = ratio(overview.successfulRequests, overview.totalRequests);
  const dataAsOf = formatDashboardDataAsOf(
    overview.dataFreshness.lastLogCreatedAt ||
      overview.dataFreshness.generatedAt ||
      overview.range.to,
    locale
  );
  const kpiCards = [
    {
      detail: `${formatInteger(overview.totalRequests)} ${locale === "ko" ? "건" : "requests"} · ${rangeLabel(filters.range, locale)}`,
      icon: <Activity aria-hidden="true" size={22} strokeWidth={2.2} />,
      label: text.kpi.totalRequests,
      tone: "blue",
      value: formatInteger(overview.totalRequests)
    },
    {
      detail: `${formatInteger(overview.successfulRequests)} ${text.kpi.successful} · ${text.metrics.averageLatency} ${formatLatency(Math.round(overview.averageLatencyMs))} · p95 ${formatLatency(Math.round(overview.p95LatencyMs))}`,
      icon: <CheckCircle2 aria-hidden="true" size={22} strokeWidth={2.2} />,
      label: text.kpi.successRate,
      tone: "green",
      value: formatPercent(successRate)
    },
    {
      detail: text.kpi.monthCostDetail,
      icon: <DollarSign aria-hidden="true" size={22} strokeWidth={2.2} />,
      label: text.kpi.monthCost,
      tone: "orange",
      value: monthToDateSpendValue ?? formatMicroUsd(monthToDate.totalCostMicroUsd)
    }
  ];

  return (
    <main
      className="console-content dashboard-overview-content"
      data-motion={suppressContentMotion ? "none" : undefined}
    >
      <DashboardRangePreferenceSync range={filters.range} />
      <DashboardAutoRefresh />
      <section className="dashboard-main-header">
        <div>
          <h1>{text.title}</h1>
        </div>
        <Link
          aria-label={text.refreshDashboard}
          className="dashboard-refresh-link"
          href={dashboardHref(overview.filters.tenantId, filters, undefined, { motion: "none" })}
        >
          <RotateCcw aria-hidden="true" size={18} strokeWidth={2.3} />
        </Link>
      </section>

      <section className="dashboard-summary-bar" aria-label={text.dashboardFilters}>
        <DashboardFilterForm
          actionPath={`/tenants/${overview.filters.tenantId}/dashboard`}
          allowAllProjects={allowAllProjects}
          allowTenantChat={allowAllProjects}
          applyLabel={text.filter.apply}
          filters={filters}
          locale={locale}
          projects={projects}
          rangeOptions={dashboardRanges.map((range) => ({
            label: rangeLabel(range, locale),
            value: range
          }))}
        />
        {overview.queryBudget?.status === "partial" && overview.queryBudget.guidance ? (
          <div className="dashboard-source-warning" role="status">
            {overview.queryBudget.guidance}
          </div>
        ) : null}
        <div className="dashboard-data-freshness">
          <span>{text.dataAsOf}</span>
          <strong>{dataAsOf}</strong>
        </div>
      </section>

      <section className="dashboard-overview-workspace" aria-label={text.overviewWorkspace}>
        <div className="dashboard-main-panel">
          <div className="dashboard-kpi-grid" aria-label={text.keyMetrics}>
            {kpiCards.map((card) => (
              <article className="dashboard-kpi-card" data-tone={card.tone} key={card.label}>
                <div className="dashboard-kpi-card-header">
                  <span className="dashboard-kpi-icon">{card.icon}</span>
                  <span className="dashboard-kpi-label">{card.label}</span>
                </div>
                <strong>{card.value}</strong>
                <p>{card.detail}</p>
              </article>
            ))}
          </div>
          <div className="dashboard-secondary-grid">
            <CostOverTimeCard
              filters={{
                ...filters,
                tenantId: overview.filters.tenantId
              }}
              initialSummary={costOverTime}
              locale={locale}
              rangeLabel={rangeLabel(filters.range, locale)}
            />
            <ProviderModelUsageCard locale={locale} rows={buildProviderModelUsageRows(overview)} />
          </div>
          <LiveRequestsCard
            filters={{
              ...filters,
              tenantId: overview.filters.tenantId
            }}
            initialPayload={liveRequests}
            locale={locale}
          />
        </div>
      </section>

      {detailPanel}
    </main>
  );
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function formatDashboardDataAsOf(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Seoul"
  }).format(date);
}

function rangeLabel(range: DashboardRange, locale: Locale) {
  if (range === "5m") {
    return locale === "ko" ? "최근 5분" : "Last 5 minutes";
  }

  if (range === "15m") {
    return locale === "ko" ? "최근 15분" : "Last 15 minutes";
  }

  if (range === "1h") {
    return locale === "ko" ? "최근 1시간" : "Last hour";
  }

  if (range === "1d") {
    return locale === "ko" ? "최근 24시간" : "Last 24 hours";
  }

  return locale === "ko" ? "최근 7일" : "Last 7 days";
}

function formatMicroUsd(value: number) {
  const dollars = value / 1_000_000;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: dollars > 0 && dollars < 1 ? 6 : 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(dollars);
}

function buildProviderModelUsageRows(overview: DashboardOverview): ProviderModelUsageRow[] {
  const rows = overview.breakdowns?.byProviderModel?.length
    ? overview.breakdowns.byProviderModel.map((row) => ({
        model: row.model,
        provider: row.provider,
        requestCount: row.requestCount
      }))
    : overview.costByModel.length
      ? overview.costByModel.map((row) => ({
          model: row.model,
          provider: row.provider,
          requestCount: row.requestCount
        }))
      : [];
  const rowMap = new Map<string, ProviderModelUsageRow>();

  for (const row of rows) {
    const provider = normalizeProviderUsageProvider(row.provider);
    const model = formatModelDisplayName(row.model, "Unknown");
    const key = `${provider}:${model}`;
    const existing = rowMap.get(key);

    rowMap.set(key, {
      model,
      provider,
      providerLabel: providerUsageLabel(provider, row.provider),
      requestCount: Math.max(row.requestCount, 0) + (existing?.requestCount ?? 0)
    });
  }

  return Array.from(rowMap.values()).sort((first, second) => second.requestCount - first.requestCount);
}

function normalizeProviderUsageProvider(value: string): ProviderModelUsageProvider {
  const provider = value.toLowerCase();

  if (provider.includes("openai")) {
    return "openai";
  }

  if (provider.includes("anthropic") || provider.includes("claude")) {
    return "anthropic";
  }

  if (provider.includes("google") || provider.includes("gemini")) {
    return "google";
  }

  if (provider.includes("mock")) {
    return "mock";
  }

  return "unknown";
}

function providerUsageLabel(provider: ProviderModelUsageProvider, fallback: string) {
  if (provider === "openai") {
    return "OpenAI";
  }

  if (provider === "anthropic") {
    return "Anthropic";
  }

  if (provider === "google") {
    return "Google";
  }

  if (provider === "mock") {
    return "Mock";
  }

  return formatDisplayIdentifier(fallback || "Unknown");
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function DashboardOverviewLegacyView({
  activeTab = "overview",
  detailPanel,
  filters,
  locale,
  overview,
  rateLimitedRecords = [],
  recentRecords = [],
  suppressContentMotion = false
}: DashboardOverviewProps) {
  const text = dashboardText[locale];
  const trendLabels = buildTrendLabels(filters.range);
  const requestTrend = buildTrendSeries(
    overview.totalRequests,
    overview.successfulRequests,
    [0.48, 0.62, 0.81, 0.77, 0.92, 0.71, 0.84, 1],
    [0.42, 0.55, 0.72, 0.88, 0.75, 0.67, 0.79, 0.87],
    trendLabels.length
  );
  const cacheTrend = buildTrendSeries(
    overview.cacheEligibleRequests,
    overview.cacheHitRequests,
    [0.36, 0.42, 0.51, 0.49, 0.67, 0.72, 0.86, 1],
    [0.12, 0.18, 0.23, 0.28, 0.35, 0.42, 0.58, 0.64],
    trendLabels.length
  );
  const modelShareRows = getTopModelShareRows(overview);
  const cacheShareRows = getCacheShareRows(overview);
  const budgetScopeShareRows = getBudgetScopeShareRows(overview);

  return (
    <main className="console-content" data-motion={suppressContentMotion ? "none" : undefined}>
      <section className="dashboard-hero">
        <div>
          <h2>{text.title}</h2>
        </div>
      </section>

      <DashboardTabs
        activeTab={activeTab}
        filters={filters}
        overview={overview}
        text={text}
      />

      {activeTab === "overview" ? (
        <>
      <section className="dashboard-chart-grid" aria-label="Dashboard overview charts">
        <article className="console-panel dashboard-chart-panel">
          <div className="panel-heading dashboard-chart-heading">
            <div className="dashboard-chart-title-row">
              <Link
                className="dashboard-chart-title-link"
                href={dashboardHref(overview.filters.tenantId, filters, "requests")}
              >
                <h3>{text.charts.requestTrend}</h3>
              </Link>
              <strong>{formatInteger(overview.totalRequests)}</strong>
            </div>
            <div className="dashboard-chart-actions">
              <div className="dashboard-chart-legend">
                <span data-color="blue">{text.charts.traffic}</span>
                <span data-color="red">{text.charts.successful}</span>
              </div>
            </div>
          </div>
          <LineTrendChart
            labels={trendLabels}
            primaryColor="#3b82f6"
            primaryLabel={text.charts.traffic}
            primaryValues={requestTrend.primary}
            secondaryColor="#ef4444"
            secondaryLabel={text.charts.successful}
            secondaryValues={requestTrend.secondary}
          />
        </article>

        <Link
          className="console-panel dashboard-chart-panel dashboard-chart-link"
          href={dashboardHref(overview.filters.tenantId, filters, "routing")}
        >
          <div className="panel-heading dashboard-chart-heading">
            <h3>{text.charts.modelShare}</h3>
          </div>
          <PieShareChart ariaLabel={text.charts.modelShare} rows={modelShareRows} />
        </Link>

        <article className="console-panel dashboard-chart-panel">
          <div className="panel-heading dashboard-chart-heading">
            <h3>{text.charts.projectBudgetAttribution}</h3>
          </div>
          <PieShareChart
            ariaLabel={text.charts.projectBudgetAttribution}
            rows={budgetScopeShareRows}
          />
        </article>
      </section>

      <section className="dashboard-grid">
        <article className="console-panel">
          <div className="panel-heading">
            <h3>{text.statusDistribution}</h3>
          </div>
          <StatusBars overview={overview} />
        </article>
      </section>
        </>
      ) : (
        <DashboardTabPanel
          activeTab={activeTab}
          cacheShareRows={cacheShareRows}
          cacheTrend={cacheTrend}
          modelShareRows={modelShareRows}
          overview={overview}
          rateLimitedRecords={rateLimitedRecords}
          recentRecords={recentRecords}
          requestTrend={requestTrend}
          text={text}
          trendLabels={trendLabels}
        />
      )}
      {detailPanel}
    </main>
  );
}

function DashboardTabs({
  activeTab,
  filters,
  overview,
  text
}: {
  activeTab: DashboardTab;
  filters: DashboardFilterState;
  overview: DashboardOverview;
  text: DashboardCopy;
}) {
  const baseHref = dashboardHref(overview.filters.tenantId, filters);
  const overviewHref =
    activeTab === "overview"
      ? dashboardHref(overview.filters.tenantId, filters, undefined, { motion: "none" })
      : baseHref;

  return (
    <section className="dashboard-tab-row" aria-label="Dashboard sections">
      <a
        aria-label={text.backToOverview}
        className="dashboard-overview-return"
        href={overviewHref}
        title={text.backToOverview}
      >
        <RotateCcw aria-hidden="true" size={16} strokeWidth={2.4} />
      </a>
      <div className="dashboard-tab-list">
        {dashboardTabs.map((tab) => {
          const isActive = activeTab === tab;
          const href = isActive ? baseHref : dashboardHref(overview.filters.tenantId, filters, tab);

          return (
            <Link aria-current={isActive ? "page" : undefined} data-active={isActive} href={href} key={tab}>
              {text.tabs[tab]}
            </Link>
          );
        })}
      </div>
      <div className="dashboard-filter-cluster">
        <RequestTrendRangeToggle
          activeTab={activeTab}
          filters={filters}
          tenantId={overview.filters.tenantId}
        />
        <DashboardFilterBar
          activeTab={activeTab}
          filters={filters}
          overview={overview}
          text={text}
        />
      </div>
      <Link
        className="primary-link dashboard-request-log-link"
        href={`/tenants/${overview.filters.tenantId}/request-logs`}
      >
        {text.actionRequestLogs}
      </Link>
    </section>
  );
}

function DashboardFilterBar({
  activeTab,
  filters,
  overview,
  text
}: {
  activeTab: DashboardTab;
  filters: DashboardFilterState;
  overview: DashboardOverview;
  text: DashboardCopy;
}) {
  return (
    <form
      action={`/tenants/${overview.filters.tenantId}/dashboard`}
      className="dashboard-filter-bar"
    >
      {activeTab !== "overview" ? <input name="tab" type="hidden" value={activeTab} /> : null}
      <input name="range" type="hidden" value={filters.range} />
      <input name="surface" type="hidden" value={filters.surface} />
      <label className="request-log-filter-control">
        <input
          aria-label={text.filter.projectId}
          defaultValue={filters.projectId}
          name="projectId"
          placeholder="Project"
        />
      </label>
      <label className="request-log-filter-control">
        <select
          aria-label={text.filter.budgetScopeType}
          defaultValue={filters.budgetScopeType}
          name="budgetScopeType"
        >
          <option value="">All</option>
          <option value="application">{formatBudgetScopeTypeDisplayName("application")}</option>
          <option value="project">{formatBudgetScopeTypeDisplayName("project")}</option>
          <option value="team">{formatBudgetScopeTypeDisplayName("team")}</option>
        </select>
      </label>
      <label className="request-log-filter-control">
        <input
          aria-label={text.filter.budgetScopeId}
          defaultValue={filters.budgetScopeId}
          name="budgetScopeId"
          placeholder="ID"
        />
      </label>
      <label className="request-log-filter-control">
        <input
          aria-label={text.filter.resolvedBy}
          defaultValue={filters.resolvedBy}
          name="resolvedBy"
          placeholder="Resolved by"
        />
      </label>
      <div className="dashboard-filter-actions">
        <button className="secondary-button" type="submit">
          {text.filter.apply}
        </button>
        <Link className="secondary-link" href={`/tenants/${overview.filters.tenantId}/dashboard`}>
          {text.filter.reset}
        </Link>
      </div>
    </form>
  );
}

function dashboardHref(
  tenantId: string,
  filters: DashboardFilterState,
  tab?: DashboardVisibleTab,
  extra?: { motion?: string; requestId?: string }
) {
  const query = new URLSearchParams();
  if (tab) {
    query.set("tab", tab);
  }
  appendDashboardQuery(query, "projectId", filters.projectId);
  appendDashboardQuery(query, "budgetScopeType", filters.budgetScopeType);
  appendDashboardQuery(query, "budgetScopeId", filters.budgetScopeId);
  appendDashboardQuery(query, "resolvedBy", filters.resolvedBy);
  appendDashboardQuery(query, "range", filters.range);
  appendDashboardQuery(query, "surface", filters.surface);
  appendDashboardQuery(query, "motion", extra?.motion ?? "");
  appendDashboardQuery(query, "requestId", extra?.requestId ?? "");

  const serialized = query.toString();
  return `/tenants/${tenantId}/dashboard${serialized ? `?${serialized}` : ""}`;
}

function appendDashboardQuery(query: URLSearchParams, key: string, value: string) {
  if (value) {
    query.set(key, value);
  }
}

function DashboardTabPanel({
  activeTab,
  cacheShareRows,
  cacheTrend,
  modelShareRows,
  overview,
  rateLimitedRecords,
  recentRecords,
  requestTrend,
  text,
  trendLabels
}: {
  activeTab: Exclude<DashboardTab, "overview">;
  cacheShareRows: Array<{ color: string; label: string; value: number }>;
  cacheTrend: { primary: number[]; secondary: number[] };
  modelShareRows: Array<{ color: string; label: string; value: number }>;
  overview: DashboardOverview;
  rateLimitedRecords: InvocationLogRecord[];
  recentRecords: InvocationLogRecord[];
  requestTrend: { primary: number[]; secondary: number[] };
  text: DashboardCopy;
  trendLabels: string[];
}) {
  if (activeTab === "requests") {
    return (
      <section className="dashboard-tab-panel" aria-label={text.tabs.requests}>
        <div className="dashboard-chart-grid">
          <article className="console-panel dashboard-chart-panel dashboard-request-trend-panel">
            <div className="panel-heading dashboard-chart-heading">
              <h3>{text.charts.requestTrend}</h3>
              <div className="dashboard-chart-actions">
                <div className="dashboard-chart-legend">
                  <span data-color="blue">{text.charts.traffic}</span>
                  <span data-color="red">{text.charts.successful}</span>
                </div>
              </div>
            </div>
            <LineTrendChart
              labels={trendLabels}
              primaryColor="#3b82f6"
              primaryLabel={text.charts.traffic}
              primaryValues={requestTrend.primary}
              secondaryColor="#ef4444"
              secondaryLabel={text.charts.successful}
              secondaryValues={requestTrend.secondary}
            />
          </article>

          <article className="console-panel dashboard-chart-panel">
            <div className="panel-heading">
              <h3>Recent logs</h3>
              <Link className="secondary-link" href={`/tenants/${overview.filters.tenantId}/request-logs`}>
                {text.actionRequestLogs}
              </Link>
            </div>
            <RecentRequestList records={recentRecords} tenantId={overview.filters.tenantId} />
          </article>
        </div>

        <div className="dashboard-focus-stats">
          <FocusStat label={text.metrics.totalRequests} value={formatInteger(overview.totalRequests)} />
          <FocusStat label={text.metrics.successful} value={formatInteger(overview.successfulRequests)} />
          <FocusStat label={text.metrics.failed} value={formatInteger(overview.failedRequests)} />
          <FocusStat
            label={text.metrics.averageP95Latency}
            value={formatLatencyPair(overview.averageLatencyMs, overview.p95LatencyMs)}
          />
        </div>
      </section>
    );
  }

  if (activeTab === "routing") {
    return (
      <section className="dashboard-tab-panel" aria-label={text.tabs.routing}>
        <div className="dashboard-routing-layout">
          <div className="dashboard-focus-stats dashboard-routing-metrics">
            <FocusStat label={text.metrics.totalTokens} value={formatInteger(overview.totalTokens)} />
            <FocusStat label={text.metrics.totalCost} value={formatUsd(overview.totalCostUsd)} />
          </div>

          <div className="dashboard-chart-grid dashboard-routing-chart-grid">
            <article className="console-panel dashboard-chart-panel">
              <div className="panel-heading dashboard-chart-heading">
                <h3>{text.charts.modelShare}</h3>
              </div>
              <PieShareChart ariaLabel={text.charts.modelShare} rows={modelShareRows} />
            </article>

            <FallbackPanel overview={overview} text={text} />
          </div>
        </div>

        <RoutingTable overview={overview} text={text} />
        <ProviderP95Panel overview={overview} />
        <CostByModelTable overview={overview} text={text} />
      </section>
    );
  }

  if (activeTab === "cache") {
    return (
      <section className="dashboard-tab-panel" aria-label={text.tabs.cache}>
        <div className="dashboard-chart-grid">
          <article className="console-panel dashboard-chart-panel">
            <div className="panel-heading dashboard-chart-heading">
              <h3>{text.charts.cacheRequests}</h3>
              <div className="dashboard-chart-actions">
                <div className="dashboard-chart-legend">
                  <span data-color="blue">{text.charts.cacheRequests}</span>
                  <span data-color="red">{text.charts.cacheHits}</span>
                </div>
              </div>
            </div>
            <LineTrendChart
              labels={trendLabels}
              primaryColor="#3b82f6"
              primaryLabel={text.charts.cacheRequests}
              primaryValues={cacheTrend.primary}
              secondaryColor="#ef4444"
              secondaryLabel={text.charts.cacheHits}
              secondaryValues={cacheTrend.secondary}
            />
          </article>

          <article className="console-panel dashboard-chart-panel">
            <div className="panel-heading dashboard-chart-heading">
              <h3>{text.charts.cacheShare}</h3>
            </div>
            <PieShareChart ariaLabel={text.charts.cacheShare} rows={cacheShareRows} />
          </article>
        </div>

        <div className="dashboard-focus-stats">
          <FocusStat label={text.metrics.cacheHitRate} value={formatPercent(overview.exactCacheHitRate ?? overview.cacheHitRate)} />
          <FocusStat label={text.charts.cacheRequests} value={formatInteger(overview.cacheEligibleRequests)} />
          <FocusStat label={text.charts.cacheHits} value={formatInteger(overview.cacheHitRequests)} />
          <FocusStat label={text.metrics.savedCost} value={formatUsd(overview.savedCostUsd)} />
        </div>

        <OutcomePanel rows={overview.breakdowns?.byCacheOutcome ?? []} title={text.charts.cacheShare} />
      </section>
    );
  }

  if (activeTab === "safety") {
    const maskingActionCounts = overview.maskingActionCounts ?? {};
    const redactedCount = sumRecordMatches(maskingActionCounts, ["redact"]);
    const maskingBlockedCount = sumRecordMatches(maskingActionCounts, ["block"]);

    return (
      <section className="dashboard-tab-panel" aria-label={text.tabs.safety}>
        <div className="dashboard-focus-stats">
          <FocusStat label="Redaction" value={formatInteger(redactedCount)} />
          <FocusStat label={text.metrics.blocked} value={formatInteger(overview.blockedRequests)} />
          <FocusStat label="Masking block" value={formatInteger(maskingBlockedCount)} />
          <FocusStat label={text.metrics.systemErrorRate} value={formatPercent(overview.performance?.systemErrorRate ?? 0)} />
        </div>

        <section className="dashboard-grid">
          <OutcomePanel rows={overview.breakdowns?.bySafetyOutcome ?? []} title="Detector type summary" />
          <article className="console-panel">
            <div className="panel-heading">
              <h3>{text.maskingActions}</h3>
            </div>
            <div className="compact-list">
              {Object.entries(maskingActionCounts).map(([action, count]) => (
                <div className="compact-row" key={action}>
                  <span>{action}</span>
                  <strong>{formatInteger(count)}</strong>
                </div>
              ))}
              {Object.keys(maskingActionCounts).length === 0 ? <EmptyRow /> : null}
            </div>
          </article>
        </section>
      </section>
    );
  }

  return (
    <section className="dashboard-tab-panel" aria-label={text.tabs.limits}>
      <div className="dashboard-focus-stats">
        <FocusStat label={text.metrics.rateLimited} value={formatInteger(overview.rateLimitedRequests)} />
        <FocusStat label="Limit status" value={overview.queryBudget?.status ?? "ok"} />
        <FocusStat label={text.metrics.budgetScope} value={formatBudgetScopeDisplayName(overview.filters)} />
        <FocusStat label={text.metrics.budgetLedgerCost} value={formatUsd(microUsdToUsdString(sumBudgetScopeCostMicroUsd(overview)))} />
      </div>

      <section className="dashboard-grid">
        <article className="console-panel">
          <div className="panel-heading">
            <h3>Rate limit</h3>
            <Link
              className="secondary-link"
              href={`/tenants/${overview.filters.tenantId}/request-logs?status=rate_limited`}
            >
              logs
            </Link>
          </div>
          <div className="compact-list">
            <div className="compact-row">
              <span>{text.metrics.rateLimited}</span>
              <strong>{formatInteger(overview.rateLimitedRequests)}</strong>
            </div>
            <div className="compact-row">
              <span>status.rate_limited</span>
              <strong>{formatInteger(overview.statusCounts.rate_limited ?? 0)}</strong>
            </div>
            <div className="compact-row">
              <span>query budget</span>
              <strong>{overview.queryBudget?.status ?? "ok"}</strong>
            </div>
          </div>
        </article>

        <article className="console-panel">
          <div className="panel-heading">
            <h3>{text.queryBudget}</h3>
          </div>
          <div className="compact-list">
            <div className="compact-row">
              <span>status</span>
              <strong>{overview.queryBudget?.status ?? "ok"}</strong>
            </div>
            <div className="compact-row">
              <span>max range</span>
              <strong>{overview.queryBudget?.maxRangeHours ?? 24}h</strong>
            </div>
            <div className="compact-row">
              <span>max breakdowns</span>
              <strong>{formatInteger(overview.queryBudget?.maxBreakdownItems ?? 50)}</strong>
            </div>
            {overview.queryBudget?.guidance ? (
              <div className="compact-row">
                <span>guidance</span>
                <strong>{overview.queryBudget.guidance}</strong>
              </div>
            ) : null}
          </div>
        </article>
      </section>

      <RateLimitEvidencePanel
        overview={overview}
        records={rateLimitedRecords}
        text={text}
      />
      <BudgetScopeBreakdownTable overview={overview} text={text} />
    </section>
  );
}

function StatusBars({ overview }: { overview: DashboardOverview }) {
  const maxStatusCount = Math.max(...Object.values(overview.statusCounts), 1);

  return (
    <div className="bar-list">
      {statusOrder.map((status) => {
        const count = overview.statusCounts[status] ?? 0;
        const percent = (count / maxStatusCount) * 100;

        return (
          <div className="bar-row" key={status}>
            <span>{status}</span>
            <div className="bar-track" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${percent}%` }} />
            </div>
            <strong>{count}</strong>
          </div>
        );
      })}
    </div>
  );
}

function RecentRequestList({
  records,
  tenantId
}: {
  records: InvocationLogRecord[];
  tenantId: string;
}) {
  if (records.length === 0) {
    return (
      <div className="compact-list">
        <EmptyRow />
      </div>
    );
  }

  return (
    <div className="compact-list dashboard-recent-requests">
      {records.map((record) => (
        <div className="compact-row" key={record.requestId}>
          <span>
            <Link
              href={`/tenants/${tenantId}/dashboard?tab=requests&requestId=${encodeURIComponent(record.requestId)}`}
              scroll={false}
            >
              {formatDisplayIdentifier(record.requestId)}
            </Link>
            <small>
              {record.status} / {record.cacheStatus} /{" "}
              {formatModelDisplayName(record.requestedModel)} / {record.category} / {record.difficulty} / {record.modelRef ?? "-"}
            </small>
          </span>
          <strong>{formatLatency(record.latencyMs)}</strong>
        </div>
      ))}
    </div>
  );
}

function FallbackPanel({ overview, text }: { overview: DashboardOverview; text: DashboardCopy }) {
  return (
    <article className="console-panel dashboard-chart-panel">
      <div className="panel-heading">
        <h3>Fallback</h3>
      </div>
      <div className="compact-list">
        <div className="compact-row">
          <span>{text.metrics.fallbackSuccess}</span>
          <strong>{formatInteger(overview.fallbackSuccessCount ?? 0)}</strong>
        </div>
        {(overview.breakdowns?.byFallbackOutcome ?? []).map((row) => (
          <div className="compact-row" key={row.outcome}>
            <span>{row.outcome}</span>
            <strong>{formatInteger(row.requestCount)}</strong>
          </div>
        ))}
      </div>
    </article>
  );
}

function ProviderP95Panel({ overview }: { overview: DashboardOverview }) {
  const rows = overview.breakdowns?.byProviderModel ?? [];

  return (
    <article className="console-panel wide-panel">
      <div className="panel-heading">
        <h3>Provider p95</h3>
      </div>
      <div className="compact-list">
        {rows.map((row) => (
          <div className="compact-row" key={`${row.provider}-${row.model}`}>
            <span>{row.provider}/{formatModelDisplayName(row.model)}</span>
            <strong>{formatLatency(row.p95ProviderLatencyMs)}</strong>
          </div>
        ))}
        {rows.length === 0 ? <EmptyRow /> : null}
      </div>
    </article>
  );
}

function OutcomePanel({
  rows,
  title
}: {
  rows: Array<{ outcome: string; requestCount: number }>;
  title: string;
}) {
  return (
    <article className="console-panel">
      <div className="panel-heading">
        <h3>{title}</h3>
      </div>
      <div className="compact-list">
        {rows.map((row) => (
          <div className="compact-row" key={row.outcome}>
            <span>{row.outcome}</span>
            <strong>{formatInteger(row.requestCount)}</strong>
          </div>
        ))}
        {rows.length === 0 ? <EmptyRow /> : null}
      </div>
    </article>
  );
}

function RoutingTable({ overview, text }: { overview: DashboardOverview; text: DashboardCopy }) {
  return (
    <article className="console-panel wide-panel">
      <div className="panel-heading">
        <h3>{text.routingSummary}</h3>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Difficulty</th>
              <th>Reason</th>
              <th>Requests</th>
            </tr>
          </thead>
          <tbody>
            {overview.routingSummaries.map((row) => (
              <tr key={`${row.category}-${row.difficulty}-${row.routingReason}`}>
                <td>{row.category}</td>
                <td>{row.difficulty}</td>
                <td>{row.routingReason}</td>
                <td>{formatInteger(row.requestCount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function CostByModelTable({ overview, text }: { overview: DashboardOverview; text: DashboardCopy }) {
  return (
    <article className="console-panel wide-panel">
      <div className="panel-heading">
        <h3>{text.costByModel}</h3>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Model</th>
              <th>Requests</th>
              <th>Tokens</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            {overview.costByModel.map((row) => (
              <tr key={`${row.provider}-${row.model}`}>
                <td>{row.provider}</td>
                <td>{formatModelDisplayName(row.model)}</td>
                <td>{formatInteger(row.requestCount)}</td>
                <td>{formatInteger(row.totalTokens)}</td>
                <td>{formatUsd(row.costUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function RateLimitEvidencePanel({
  overview,
  records,
  text
}: {
  overview: DashboardOverview;
  records: InvocationLogRecord[];
  text: DashboardCopy;
}) {
  return (
    <article className="console-panel wide-panel">
      <div className="panel-heading">
        <h3>{text.rateLimitEvidence}</h3>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Request</th>
              <th>Scope</th>
              <th>Outcome</th>
              <th>HTTP</th>
              <th>Provider cost</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.requestId}>
                <td>
                  <Link
                    href={`/tenants/${overview.filters.tenantId}/dashboard?tab=limits&requestId=${encodeURIComponent(record.requestId)}`}
                    scroll={false}
                  >
                    {formatDisplayIdentifier(record.requestId)}
                  </Link>
                </td>
                <td>
                  {formatBudgetScopeDisplayName({
                    budgetScopeId: record.rateLimitDecision.scopeId,
                    budgetScopeType: record.rateLimitDecision.scope,
                    resolvedBy: record.budgetScope.resolvedBy
                  })}
                </td>
                <td>{record.domainOutcomes?.rateLimit?.outcome ?? record.status}</td>
                <td>{record.httpStatus}</td>
                <td>{record.providerLatencyMs === null ? "not called" : "called"}</td>
              </tr>
            ))}
            {records.length === 0 ? (
              <tr>
                <td colSpan={5}>none</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function BudgetScopeBreakdownTable({ overview, text }: { overview: DashboardOverview; text: DashboardCopy }) {
  const rows = overview.breakdowns?.byBudgetScope ?? [];

  return (
    <article className="console-panel wide-panel">
      <div className="panel-heading">
        <h3>{text.budgetScopeBreakdown}</h3>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Project policy/budget</th>
              <th>Resolved by</th>
              <th>Requests</th>
              <th>Ledger cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.budgetScopeType}-${row.budgetScopeId}-${row.resolvedBy}`}>
                <td>{formatBudgetScopeDisplayName(row)}</td>
                <td>{row.resolvedBy}</td>
                <td>{formatInteger(row.requestCount)}</td>
                <td>{formatUsd(microUsdToUsdString(row.estimatedCostMicroUsd))}</td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4}>none</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </article>
  );
}

function EmptyRow() {
  return (
    <div className="compact-row">
      <span>none</span>
      <strong>0</strong>
    </div>
  );
}

function FocusStat({ label, value }: { label: string; value: string }) {
  return (
    <article className="dashboard-focus-stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function RequestTrendRangeToggle({
  activeTab,
  filters,
  tenantId
}: {
  activeTab: DashboardTab;
  filters: DashboardFilterState;
  tenantId: string;
}) {
  return (
    <div className="dashboard-range-toggle" aria-label="Request trend range">
      {dashboardRanges.map((range) => (
        <Link
          data-active={range === filters.range}
          href={dashboardHref(
            tenantId,
            {
              ...filters,
              range
            },
            activeTab === "overview" ? undefined : activeTab
          )}
          key={range}
          scroll={false}
        >
          {range}
        </Link>
      ))}
    </div>
  );
}

function formatLatencyPair(averageLatencyMs: number, p95LatencyMs: number) {
  return `${formatInteger(averageLatencyMs)} / ${formatInteger(p95LatencyMs)} ms`;
}

function sumBudgetScopeCostMicroUsd(overview: DashboardOverview) {
  return (overview.breakdowns?.byBudgetScope ?? []).reduce(
    (total, row) => total + row.estimatedCostMicroUsd,
    0
  );
}

function microUsdToUsdString(value: number) {
  return (value / 1_000_000).toFixed(6);
}

function LineTrendChart({
  labels,
  primaryColor,
  primaryLabel,
  primaryValues,
  secondaryColor,
  secondaryLabel,
  secondaryValues
}: {
  labels: string[];
  primaryColor: string;
  primaryLabel: string;
  primaryValues: number[];
  secondaryColor: string;
  secondaryLabel: string;
  secondaryValues: number[];
}) {
  return (
    <DashboardLineEChart
      ariaLabel={`${primaryLabel} and ${secondaryLabel}`}
      labels={labels}
      series={[
        {
          color: primaryColor,
          data: primaryValues,
          name: primaryLabel
        },
        {
          color: secondaryColor,
          data: secondaryValues,
          name: secondaryLabel
        }
      ]}
    />
  );
}

function PieShareChart({
  ariaLabel,
  rows
}: {
  ariaLabel: string;
  rows: Array<{
    color: string;
    label: string;
    value: number;
  }>;
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);

  return (
    <div className="dashboard-pie-layout">
      <DashboardPieEChart ariaLabel={ariaLabel} rows={rows} />
      <div className="dashboard-pie-list">
        {rows.map((row) => {
          const percent = total > 0 ? row.value / total : 0;

          return (
            <div className="dashboard-pie-row" key={row.label}>
              <span style={{ background: row.color }} />
              <strong>{row.label}</strong>
              <em>{formatPercent(percent)}</em>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function buildTrendSeries(
  primaryTotal: number,
  secondaryTotal: number,
  primaryShape: number[],
  secondaryShape: number[],
  pointCount: number
) {
  const primaryShapeExpanded = expandShape(primaryShape, pointCount);
  const secondaryShapeExpanded = expandShape(secondaryShape, pointCount);
  const primaryShapeTotal = primaryShapeExpanded.reduce((sum, ratio) => sum + ratio, 0) || 1;
  const secondaryShapeTotal = secondaryShapeExpanded.reduce((sum, ratio) => sum + ratio, 0) || 1;
  const primary = distributeTotal(primaryTotal, primaryShapeExpanded, primaryShapeTotal);
  const secondary = distributeTotal(secondaryTotal, secondaryShapeExpanded, secondaryShapeTotal).map(
    (value, index) => Math.min(value, primary[index] ?? value)
  );

  return { primary, secondary };
}

function buildTrendLabels(range: DashboardRange) {
  if (range === "5m") {
    return ["-5m", "-4m", "-3m", "-2m", "-1m", "now"];
  }

  if (range === "15m") {
    return ["-14m", "-12m", "-10m", "-8m", "-6m", "-4m", "-2m", "now"];
  }

  if (range === "1h") {
    return ["-60m", "-50m", "-40m", "-30m", "-20m", "-10m", "now"];
  }

  if (range === "1d") {
    return ["-24h", "-20h", "-16h", "-12h", "-8h", "-4h", "now"];
  }

  return ["-7d", "-6d", "-5d", "-4d", "-3d", "-2d", "-1d", "now"];
}

function expandShape(shape: number[], pointCount: number) {
  return Array.from({ length: pointCount }, (_, index) => {
    const cursor = (index / Math.max(pointCount - 1, 1)) * Math.max(shape.length - 1, 0);
    const leftIndex = Math.floor(cursor);
    const rightIndex = Math.min(leftIndex + 1, shape.length - 1);
    const ratio = cursor - leftIndex;
    const left = shape[leftIndex] ?? 0;
    const right = shape[rightIndex] ?? left;

    return left + (right - left) * ratio;
  });
}

function distributeTotal(total: number, shape: number[], shapeTotal: number) {
  if (total <= 0) {
    return shape.map(() => 0);
  }

  let remaining = total;
  const values = shape.map((ratio, index) => {
    if (index === shape.length - 1) {
      return remaining;
    }

    const value = Math.min(remaining, Math.max(0, Math.round((total * ratio) / shapeTotal)));
    remaining -= value;
    return value;
  });

  return values.map((value) => Math.max(0, value));
}

function getTopModelShareRows(overview: DashboardOverview) {
  const sourceRows = overview.costByModel.length
    ? overview.costByModel
    : (overview.breakdowns?.byProviderModel ?? []).map((row) => ({
        model: row.model,
        requestCount: row.requestCount,
        provider: row.provider
      }));
  const sortedRows = [...sourceRows].sort((left, right) => right.requestCount - left.requestCount);
  const topRows = sortedRows.slice(0, 3).map((row, index) => ({
    color: chartColors[index] ?? chartColors[0],
    label: compactModelLabel(row.model),
    value: row.requestCount
  }));
  const otherCount = sortedRows.slice(3).reduce((sum, row) => sum + row.requestCount, 0);

  if (otherCount > 0) {
    topRows.push({
      color: chartColors[3],
      label: "other",
      value: otherCount
    });
  }

  return topRows.length
    ? topRows
    : [
        {
          color: chartColors[0],
          label: "none",
          value: 1
        }
      ];
}

function getCacheShareRows(overview: DashboardOverview) {
  const sourceRows = overview.breakdowns?.byCacheOutcome?.length
    ? overview.breakdowns.byCacheOutcome
    : [
        { outcome: "hit", requestCount: overview.cacheHitRequests },
        {
          outcome: "miss",
          requestCount: Math.max(overview.cacheEligibleRequests - overview.cacheHitRequests, 0)
        }
      ];

  const rows = sourceRows
    .filter((row) => row.requestCount > 0)
    .slice(0, 5)
    .map((row, index) => ({
      color: chartColors[index] ?? chartColors[0],
      label: row.outcome,
      value: row.requestCount
    }));

  return rows.length
    ? rows
    : [
        {
          color: chartColors[0],
          label: "none",
          value: 1
        }
      ];
}

function getBudgetScopeShareRows(overview: DashboardOverview) {
  const sourceRows = overview.breakdowns?.byBudgetScope?.length
    ? overview.breakdowns.byBudgetScope
    : [
        {
          budgetScopeId: overview.filters.budgetScopeId,
          budgetScopeType: overview.filters.budgetScopeType,
          estimatedCostMicroUsd: overview.totalCostMicroUsd,
          requestCount: overview.totalRequests,
          resolvedBy: overview.filters.resolvedBy
        }
      ];
  const sortedRows = [...sourceRows]
    .filter((row) => row.estimatedCostMicroUsd > 0)
    .sort((left, right) => right.estimatedCostMicroUsd - left.estimatedCostMicroUsd);
  const topRows = sortedRows.slice(0, 4).map((row, index) => ({
    color: chartColors[index] ?? chartColors[0],
    label: formatBudgetScopeDisplayName(row),
    value: row.estimatedCostMicroUsd
  }));
  const otherValue = sortedRows
    .slice(4)
    .reduce((sum, row) => sum + row.estimatedCostMicroUsd, 0);

  if (otherValue > 0) {
    topRows.push({
      color: chartColors[4] ?? chartColors[0],
      label: "other",
      value: otherValue
    });
  }

  return topRows.length
    ? topRows
    : [
        {
          color: chartColors[0],
          label: "none",
          value: 1
        }
      ];
}

function sumRecordMatches(record: Record<string, number> | null | undefined, needles: string[]) {
  if (!record) {
    return 0;
  }

  return Object.entries(record).reduce((sum, [key, value]) => {
    const normalizedKey = key.toLowerCase();

    return needles.some((needle) => normalizedKey.includes(needle)) ? sum + value : sum;
  }, 0);
}

function compactModelLabel(model: string) {
  return formatModelDisplayName(model).replace(/^mock-/, "").replace(/^openai-/, "");
}
