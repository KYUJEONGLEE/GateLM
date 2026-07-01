import { RotateCcw } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { DashboardOverview, InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { formatDisplayIdentifier } from "@/lib/formatting/display-identifiers";
import {
  formatInteger,
  formatLatency,
  formatPercent,
  formatUsd
} from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type DashboardOverviewProps = {
  activeTab?: DashboardTab;
  detailPanel?: ReactNode;
  locale: Locale;
  overview: DashboardOverview;
  recentRecords?: InvocationLogRecord[];
  suppressContentMotion?: boolean;
};

type DashboardTab = "overview" | "requests" | "cache" | "routing" | "safety" | "limits";
type DashboardVisibleTab = Exclude<DashboardTab, "overview">;

const dashboardTabs: DashboardVisibleTab[] = ["requests", "cache", "routing", "safety", "limits"];
const statusOrder = ["success", "blocked", "rate_limited", "failed", "cancelled"];
const trendLabels = ["T-14m", "T-12m", "T-10m", "T-8m", "T-6m", "T-4m", "T-2m", "Now"];
const chartColors = ["#3b82f6", "#ef4444", "#10a37f", "#f59e0b", "#8b5cf6"];

const dashboardText: Record<
  Locale,
  {
    actionRequestLogs: string;
    backToOverview: string;
    costByModel: string;
    metrics: {
      averageLatency: string;
      averageP95Latency: string;
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
      requests: string;
      requestTrend: string;
      successful: string;
      traffic: string;
    };
    database: string;
    maskingActions: string;
    routingByModel: string;
    statusDistribution: string;
    tabs: Record<DashboardTab, string>;
    title: string;
  }
> = {
  en: {
    actionRequestLogs: "Open request logs",
    backToOverview: "Back to overview",
    costByModel: "Cost by model",
    database: "Database",
    charts: {
      cache: "Cache",
      cacheHits: "Cache hits",
      cacheRequests: "Cache requests",
      cacheShare: "Cache share",
      modelShare: "Model request share",
      requests: "Requests",
      requestTrend: "Request trend",
      successful: "Successful",
      traffic: "Requests"
    },
    metrics: {
      averageLatency: "Average latency",
      averageP95Latency: "Average/P95 latency",
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
    maskingActions: "Masking actions",
    routingByModel: "Routing by model",
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
    backToOverview: "Overview로 돌아가기",
    costByModel: "모델별 비용",
    database: "Database",
    charts: {
      cache: "Cache",
      cacheHits: "캐시 적중",
      cacheRequests: "캐시 요청",
      cacheShare: "캐시 비중",
      modelShare: "모델 요청 비중",
      requests: "Requests",
      requestTrend: "요청 추이",
      successful: "전송 성공",
      traffic: "Requests"
    },
    metrics: {
      averageLatency: "평균 지연",
      averageP95Latency: "평균/P95 지연",
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
    maskingActions: "마스킹 동작",
    routingByModel: "모델별 라우팅",
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
  activeTab = "overview",
  detailPanel,
  locale,
  overview,
  recentRecords = [],
  suppressContentMotion = false
}: DashboardOverviewProps) {
  const text = dashboardText[locale];
  const requestTrend = buildTrendSeries(
    overview.totalRequests,
    overview.successfulRequests,
    [0.48, 0.62, 0.81, 0.77, 0.92, 0.71, 0.84, 1],
    [0.42, 0.55, 0.72, 0.88, 0.75, 0.67, 0.79, 0.87]
  );
  const cacheTrend = buildTrendSeries(
    overview.cacheEligibleRequests,
    overview.cacheHitRequests,
    [0.36, 0.42, 0.51, 0.49, 0.67, 0.72, 0.86, 1],
    [0.12, 0.18, 0.23, 0.28, 0.35, 0.42, 0.58, 0.64]
  );
  const modelShareRows = getTopModelShareRows(overview);
  const cacheShareRows = getCacheShareRows(overview);

  return (
    <main className="console-content" data-motion={suppressContentMotion ? "none" : undefined}>
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">dashboard</p>
          <h2>{text.title}</h2>
        </div>
        <Link
          className="primary-link"
          href={`/tenants/${overview.filters.tenantId}/request-logs`}
        >
          {text.actionRequestLogs}
        </Link>
      </section>

      <DashboardTabs activeTab={activeTab} overview={overview} text={text} />

      {activeTab === "overview" ? (
        <>
      <section className="dashboard-chart-grid" aria-label="Dashboard overview charts">
        <Link
          className="console-panel dashboard-chart-panel dashboard-chart-link"
          href={`/tenants/${overview.filters.tenantId}/dashboard?tab=requests`}
        >
          <div className="panel-heading dashboard-chart-heading">
            <h3>{text.charts.requestTrend}</h3>
            <div className="dashboard-chart-legend">
              <span data-color="blue">{text.charts.traffic}</span>
              <span data-color="red">{text.charts.successful}</span>
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
        </Link>

        <Link
          className="console-panel dashboard-chart-panel dashboard-chart-link"
          href={`/tenants/${overview.filters.tenantId}/dashboard?tab=routing`}
        >
          <div className="panel-heading dashboard-chart-heading">
            <h3>{text.charts.modelShare}</h3>
          </div>
          <PieShareChart rows={modelShareRows} />
        </Link>
      </section>

      <section className="metric-grid" aria-label="Dashboard overview metrics">
        <MetricCard label={text.metrics.totalRequests} value={formatInteger(overview.totalRequests)} />
        <MetricCard
          label={text.database}
          tone={overview.dataFreshness.source ? "success" : "danger"}
          value={overview.dataFreshness.source ? "connected" : "unavailable"}
        />
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
          recentRecords={recentRecords}
          requestTrend={requestTrend}
          text={text}
        />
      )}
      {detailPanel}
    </main>
  );
}

function DashboardTabs({
  activeTab,
  overview,
  text
}: {
  activeTab: DashboardTab;
  overview: DashboardOverview;
  text: DashboardCopy;
}) {
  const baseHref = `/tenants/${overview.filters.tenantId}/dashboard`;
  const overviewHref = activeTab === "overview" ? `${baseHref}?motion=none` : baseHref;

  return (
    <nav className="dashboard-tab-row" aria-label="Dashboard sections">
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
          const href = isActive ? baseHref : `${baseHref}?tab=${tab}`;

          return (
            <Link aria-current={isActive ? "page" : undefined} data-active={isActive} href={href} key={tab}>
              {text.tabs[tab]}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function DashboardTabPanel({
  activeTab,
  cacheShareRows,
  cacheTrend,
  modelShareRows,
  overview,
  recentRecords,
  requestTrend,
  text
}: {
  activeTab: Exclude<DashboardTab, "overview">;
  cacheShareRows: Array<{ color: string; label: string; value: number }>;
  cacheTrend: { primary: number[]; secondary: number[] };
  modelShareRows: Array<{ color: string; label: string; value: number }>;
  overview: DashboardOverview;
  recentRecords: InvocationLogRecord[];
  requestTrend: { primary: number[]; secondary: number[] };
  text: DashboardCopy;
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
            <RequestTrendRangeToggle />
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
              <PieShareChart rows={modelShareRows} />
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
              <div className="dashboard-chart-legend">
                <span data-color="blue">{text.charts.cacheRequests}</span>
                <span data-color="red">{text.charts.cacheHits}</span>
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
            <PieShareChart rows={cacheShareRows} />
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
    const redactedCount = sumRecordMatches(overview.maskingActionCounts, ["redact"]);
    const maskingBlockedCount = sumRecordMatches(overview.maskingActionCounts, ["block"]);

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
              {Object.entries(overview.maskingActionCounts).map(([action, count]) => (
                <div className="compact-row" key={action}>
                  <span>{action}</span>
                  <strong>{formatInteger(count)}</strong>
                </div>
              ))}
              {Object.keys(overview.maskingActionCounts).length === 0 ? <EmptyRow /> : null}
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
        <FocusStat label="Max range" value={`${overview.queryBudget?.maxRangeHours ?? 24}h`} />
        <FocusStat label="Budget" value="Reserved" />
      </div>

      <section className="dashboard-grid">
        <article className="console-panel">
          <div className="panel-heading">
            <h3>Rate limit</h3>
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
            <h3>Budget</h3>
          </div>
          <div className="compact-list">
            <div className="compact-row">
              <span>scope</span>
              <strong>
                {overview.filters.budgetScopeType}:{overview.filters.budgetScopeId}
              </strong>
            </div>
            <div className="compact-row">
              <span>amount</span>
              <strong>reserved</strong>
            </div>
            <div className="compact-row">
              <span>remaining</span>
              <strong>reserved</strong>
            </div>
          </div>
        </article>
      </section>
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
              {record.status} / {record.cacheStatus} / {record.selectedModel ?? record.requestedModel ?? "not routed"}
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
          <div className="compact-row" key={`${row.selectedProvider}-${row.selectedModel}`}>
            <span>{row.selectedProvider}/{row.selectedModel}</span>
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
        <h3>{text.routingByModel}</h3>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Model</th>
              <th>Reason</th>
              <th>Requests</th>
            </tr>
          </thead>
          <tbody>
            {overview.routingCountByModel.map((row) => (
              <tr key={`${row.selectedProvider}-${row.selectedModel}-${row.routingReason}`}>
                <td>{row.selectedProvider}</td>
                <td>{row.selectedModel}</td>
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
              <tr key={`${row.selectedProvider}-${row.selectedModel}`}>
                <td>{row.selectedProvider}</td>
                <td>{row.selectedModel}</td>
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

function RequestTrendRangeToggle() {
  return (
    <div className="dashboard-range-toggle" aria-label="Request trend range">
      {["15m", "1h", "1d", "1w"].map((range) => (
        <button data-active={range === "15m"} key={range} type="button">
          {range}
        </button>
      ))}
    </div>
  );
}

function formatLatencyPair(averageLatencyMs: number, p95LatencyMs: number) {
  return `${formatInteger(averageLatencyMs)} / ${formatInteger(p95LatencyMs)} ms`;
}

function MetricCard({
  label,
  tone = "neutral",
  value
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  value: string;
}) {
  return (
    <article className="metric-card" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
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
  const width = 720;
  const height = 260;
  const points = [...primaryValues, ...secondaryValues];
  const maxValue = Math.max(...points, 1);
  const primaryPath = toPolylinePoints(primaryValues, maxValue, width, height);
  const secondaryPath = toPolylinePoints(secondaryValues, maxValue, width, height);
  const gridLines = [0, 1, 2, 3].map((index) => {
    const y = 24 + index * ((height - 56) / 3);

    return y;
  });

  return (
    <div className="dashboard-line-chart" role="img" aria-label={`${primaryLabel} and ${secondaryLabel}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        {gridLines.map((y) => (
          <line className="dashboard-chart-gridline" key={y} x1="34" x2={width - 24} y1={y} y2={y} />
        ))}
        <polyline fill="none" points={primaryPath} stroke={primaryColor} strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
        <polyline fill="none" points={secondaryPath} stroke={secondaryColor} strokeLinecap="round" strokeLinejoin="round" strokeWidth="5" />
        {primaryValues.map((value, index) => {
          const [x, y] = toPoint(value, index, primaryValues.length, maxValue, width, height);

          return <circle fill={primaryColor} key={`primary-${labels[index]}`} r="4.5" cx={x} cy={y} />;
        })}
        {secondaryValues.map((value, index) => {
          const [x, y] = toPoint(value, index, secondaryValues.length, maxValue, width, height);

          return <circle fill={secondaryColor} key={`secondary-${labels[index]}`} r="4.5" cx={x} cy={y} />;
        })}
        {labels.map((label, index) => {
          const [x] = toPoint(0, index, labels.length, maxValue, width, height);

          return (
            <text className="dashboard-chart-label" key={label} textAnchor="middle" x={x} y={height - 8}>
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function PieShareChart({
  rows
}: {
  rows: Array<{
    color: string;
    label: string;
    value: number;
  }>;
}) {
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const gradient = toConicGradient(rows, total);

  return (
    <div className="dashboard-pie-layout">
      <div className="dashboard-pie" style={{ background: gradient }}>
        <div>
          <strong>{formatInteger(total)}</strong>
          <span>requests</span>
        </div>
      </div>
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
  secondaryShape: number[]
) {
  const primaryBase = Math.max(1, Math.round(primaryTotal / Math.max(primaryShape.length * 2, 1)));
  const secondaryBase = Math.max(1, Math.round(secondaryTotal / Math.max(secondaryShape.length * 2, 1)));
  const primary = primaryShape.map((ratio, index) =>
    Math.max(0, Math.round(primaryBase * ratio + index * Math.max(1, primaryBase * 0.08)))
  );
  const secondary = secondaryShape.map((ratio, index) =>
    Math.max(0, Math.min(primary[index] ?? 0, Math.round(secondaryBase * ratio + index * Math.max(1, secondaryBase * 0.06))))
  );

  return { primary, secondary };
}

function toPolylinePoints(values: number[], maxValue: number, width: number, height: number) {
  return values
    .map((value, index) => {
      const [x, y] = toPoint(value, index, values.length, maxValue, width, height);

      return `${x},${y}`;
    })
    .join(" ");
}

function toPoint(value: number, index: number, length: number, maxValue: number, width: number, height: number) {
  const xPadding = 42;
  const yPadding = 34;
  const x = xPadding + index * ((width - xPadding * 2) / Math.max(length - 1, 1));
  const y = height - yPadding - (value / maxValue) * (height - yPadding * 2);

  return [Number(x.toFixed(2)), Number(y.toFixed(2))] as const;
}

function getTopModelShareRows(overview: DashboardOverview) {
  const sourceRows = overview.routingCountByModel.length
    ? overview.routingCountByModel
    : (overview.breakdowns?.byProviderModel ?? []).map((row) => ({
        requestCount: row.requestCount,
        routingReason: "selected",
        selectedModel: row.selectedModel,
        selectedProvider: row.selectedProvider
      }));
  const sortedRows = [...sourceRows].sort((left, right) => right.requestCount - left.requestCount);
  const topRows = sortedRows.slice(0, 3).map((row, index) => ({
    color: chartColors[index] ?? chartColors[0],
    label: compactModelLabel(row.selectedModel),
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

function toConicGradient(rows: Array<{ color: string; value: number }>, total: number) {
  if (total <= 0) {
    return "conic-gradient(#3b82f6 0deg 360deg)";
  }

  let cursor = 0;
  const stops = rows.map((row) => {
    const start = cursor;
    const degrees = (row.value / total) * 360;
    cursor += degrees;

    return `${row.color} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
  });

  return `conic-gradient(${stops.join(", ")})`;
}

function sumRecordMatches(record: Record<string, number>, needles: string[]) {
  return Object.entries(record).reduce((sum, [key, value]) => {
    const normalizedKey = key.toLowerCase();

    return needles.some((needle) => normalizedKey.includes(needle)) ? sum + value : sum;
  }, 0);
}

function compactModelLabel(model: string) {
  return model.replace(/^mock-/, "").replace(/^openai-/, "");
}
