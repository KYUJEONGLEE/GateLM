import Link from "next/link";
import {
  Activity,
  BarChart3,
  Clock3,
  Database,
  Download,
  Gauge,
  LineChart,
  ShieldCheck,
  Zap
} from "lucide-react";
import { ConsoleShell } from "@/components/layout/console-shell";
import {
  AnalyticsLatencyDistributionLineChart,
  AnalyticsProviderLatencyBarChart
} from "@/features/analytics/components/analytics-performance-charts";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import { formatDateTime, formatInteger, formatPercent } from "@/lib/formatting/formatters";
import {
  getAnalyticsPerformanceRange,
  getLiveAnalyticsPerformance,
  type LiveAnalyticsPerformance,
  type LiveAnalyticsRange
} from "@/lib/gateway/live-analytics-performance";
import type { Locale } from "@/lib/i18n/locale";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type AnalyticsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
  searchParams?: Promise<{
    model?: string;
    projectId?: string;
    provider?: string;
    range?: string;
    tab?: string;
  }>;
};

type AnalyticsTab = "usage" | "cost" | "performance" | "reliability" | "cache";

type AnalyticsFilterState = {
  model: string;
  projectId: string;
  provider: string;
  range: LiveAnalyticsRange;
};

const analyticsTabs: Array<{
  icon: typeof BarChart3;
  id: AnalyticsTab;
  label: string;
}> = [
  { icon: BarChart3, id: "usage", label: "Usage" },
  { icon: Database, id: "cost", label: "Cost" },
  { icon: LineChart, id: "performance", label: "Performance" },
  { icon: ShieldCheck, id: "reliability", label: "Reliability" },
  { icon: Database, id: "cache", label: "Cache" }
];

const analyticsRangeOptions: Array<{ label: string; value: LiveAnalyticsRange }> = [
  { label: "Last 15 minutes", value: "15m" },
  { label: "Last 1 hour", value: "1h" },
  { label: "Last 24 hours", value: "1d" },
  { label: "Last 7 days", value: "1w" }
];

export default async function AnalyticsPage({ params, searchParams }: AnalyticsPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const activeTab = normalizeAnalyticsTab(resolvedSearchParams?.tab);
  const filters = buildAnalyticsFilters(resolvedSearchParams);
  const liveRange = getAnalyticsPerformanceRange(filters.range);
  const shouldLoadPerformance = activeTab === "performance";

  const [locale, projectsModel, performance] = await Promise.all([
    getRequestLocale(),
    getProjectsModel(tenantId),
    shouldLoadPerformance
      ? getLiveAnalyticsPerformance(tenantId, {
          ...filters,
          projectId: filters.projectId || undefined,
          provider: filters.provider || undefined,
          model: filters.model || undefined,
          range: filters.range
        })
      : Promise.resolve(undefined)
  ]);

  const activeProjects = projectsModel.projects.filter((project) => project.status !== "ARCHIVED");
  const providerOptions = buildProviderOptions(performance, filters.provider);
  const modelOptions = buildModelOptions(performance, filters.model);

  return (
    <ConsoleShell
      activeMonitoringItem="analytics"
      activeSection="monitoring"
      locale={locale}
      tenantId={tenantId}
    >
      <main className="console-content analytics-page">
        <header className="analytics-header">
          <div>
            <h1>Analytics</h1>
            <p>데이터 기반 인사이트로 더 나은 의사결정을 하세요.</p>
          </div>
          <button className="analytics-export-button" type="button">
            <Download aria-hidden="true" size={16} />
            Export
          </button>
        </header>

        <form action={`/tenants/${tenantId}/analytics`} className="analytics-filter-bar">
          <input name="tab" type="hidden" value={activeTab} />
          <label>
            <span>Time range</span>
            <select defaultValue={filters.range} name="range">
              {analyticsRangeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Project</span>
            <select defaultValue={filters.projectId} name="projectId">
              <option value="">All Projects</option>
              {activeProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Provider</span>
            <select defaultValue={filters.provider} name="provider">
              <option value="">All Providers</option>
              {providerOptions.map((provider) => (
                <option key={provider} value={provider}>
                  {provider}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Model</span>
            <select defaultValue={filters.model} name="model">
              <option value="">All Models</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
            </select>
          </label>
          <button className="analytics-apply-button" type="submit">
            Apply
          </button>
        </form>

        <nav aria-label="Analytics sections" className="analytics-tabs">
          {analyticsTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link
                className="analytics-tab"
                data-active={tab.id === activeTab}
                href={analyticsTabHref(tenantId, tab.id, filters)}
                key={tab.id}
              >
                <Icon aria-hidden="true" size={17} />
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {activeTab === "performance" ? (
          <PerformancePanel
            filters={filters}
            locale={locale}
            performance={performance}
            projects={activeProjects}
            rangeLabel={rangeLabel(filters.range)}
            tenantId={tenantId}
          />
        ) : (
          <AnalyticsPlaceholder activeTab={activeTab} />
        )}

        <footer className="analytics-freshness">
          <span>Range</span>
          <strong>
            {formatDateTime(liveRange.from)} - {formatDateTime(liveRange.to)}
          </strong>
        </footer>
      </main>
    </ConsoleShell>
  );
}

function PerformancePanel({
  filters,
  locale,
  performance,
  projects,
  rangeLabel,
  tenantId
}: {
  filters: AnalyticsFilterState;
  locale: Locale;
  performance: LiveAnalyticsPerformance | undefined;
  projects: ProjectRecord[];
  rangeLabel: string;
  tenantId: string;
}) {
  if (!performance) {
    return (
      <section className="analytics-tab-panel">
        <article className="analytics-state-card">
          <strong>Failed to load performance analytics</strong>
          <p>Gateway analytics API에서 데이터를 가져오지 못했습니다.</p>
        </article>
      </section>
    );
  }

  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
  const hasProviderRows = performance.providerModelPerformance.length > 0;
  const hasProviderLatency = performance.p95LatencyByProvider.some((row) => row.p95LatencyMs !== null);
  const hasLatencyDistribution = performance.latencyDistribution.some(
    (point) => point.p50LatencyMs !== null || point.p95LatencyMs !== null || point.p99LatencyMs !== null
  );

  return (
    <section className="analytics-tab-panel">
      <div className="analytics-tab-copy">
        <p>모델과 제공자별 성능 지표를 실제 Gateway request log 기준으로 분석합니다.</p>
      </div>

      <section className="analytics-kpi-grid" aria-label="Performance summary">
        <AnalyticsKpiCard
          icon={Clock3}
          label="평균 지연 시간"
          tone="violet"
          value={formatMs(performance.summary.avgLatencyMs)}
        />
        <AnalyticsKpiCard
          icon={Gauge}
          label="p95 지연 시간"
          tone="blue"
          value={formatMs(performance.summary.p95LatencyMs)}
        />
        <AnalyticsKpiCard
          icon={Zap}
          label="p99 지연 시간"
          tone="green"
          value={formatMs(performance.summary.p99LatencyMs)}
        />
        <AnalyticsKpiCard
          icon={Activity}
          label="처리량"
          tone="orange"
          value={formatThroughput(performance.summary.throughputPerMinute)}
        />
        <AnalyticsKpiCard
          icon={ShieldCheck}
          label="오류율"
          tone="red"
          value={formatRate(performance.summary.errorRate)}
        />
      </section>

      <article className="analytics-card analytics-provider-model-card">
        <div className="analytics-card-header">
          <div>
            <h2>Provider / Model Performance</h2>
            <p>제공자와 모델별 요청 수, 지연 시간, 오류율, 비용 효율을 비교합니다.</p>
          </div>
          <span>{rangeLabel}</span>
        </div>
        {hasProviderRows ? (
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Requests</th>
                  <th>Avg Latency</th>
                  <th>p95 Latency</th>
                  <th>Error Rate</th>
                  <th>Cost / Req</th>
                  <th>Total Cost</th>
                  <th>Cache Hit Rate</th>
                </tr>
              </thead>
              <tbody>
                {performance.providerModelPerformance.map((row) => (
                  <tr key={`${row.provider}:${row.model}`}>
                    <td>{row.provider}</td>
                    <td>{row.model}</td>
                    <td>{formatInteger(row.requests)}</td>
                    <td>{formatMs(row.avgLatencyMs)}</td>
                    <td>{formatMs(row.p95LatencyMs)}</td>
                    <td>{formatRate(row.errorRate)}</td>
                    <td>{formatUsdNumber(row.costPerRequestUsd)}</td>
                    <td>{formatUsdString(row.totalCostUsd)}</td>
                    <td>{formatRate(row.cacheHitRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <AnalyticsEmptyState text="No provider/model performance data for selected filters" />
        )}
      </article>

      <section className="analytics-lower-grid">
        <article className="analytics-card">
          <div className="analytics-card-header">
            <div>
              <h2>p95 Latency by Provider</h2>
              <p>제공자별 tail latency를 비교합니다.</p>
            </div>
          </div>
          {hasProviderLatency ? (
            <AnalyticsProviderLatencyBarChart
              ariaLabel="p95 latency by provider"
              rows={performance.p95LatencyByProvider
                .filter((row) => row.p95LatencyMs !== null)
                .map((row) => ({
                  label: row.provider,
                  value: row.p95LatencyMs ?? 0
                }))}
            />
          ) : (
            <AnalyticsEmptyState text="No provider latency data yet" />
          )}
        </article>

        <article className="analytics-card">
          <div className="analytics-card-header">
            <div>
              <h2>Latency Distribution</h2>
              <p>시간별 p50, p95, p99 지연 시간 변화입니다.</p>
            </div>
          </div>
          {hasLatencyDistribution ? (
            <AnalyticsLatencyDistributionLineChart
              ariaLabel="latency distribution"
              points={performance.latencyDistribution.map((point) => ({
                label: point.label,
                p50: point.p50LatencyMs,
                p95: point.p95LatencyMs,
                p99: point.p99LatencyMs
              }))}
            />
          ) : (
            <AnalyticsEmptyState text="No latency distribution data yet" />
          )}
        </article>

        <article className="analytics-card analytics-slowest-card">
          <div className="analytics-card-header">
            <div>
              <h2>Slowest Requests</h2>
              <p>지연 시간이 가장 긴 최근 요청입니다.</p>
            </div>
            <Link href={`/tenants/${tenantId}/request-logs?range=${filters.range}`}>View all logs</Link>
          </div>
          {performance.slowestRequests.length > 0 ? (
            <div className="analytics-table-wrap">
              <table className="analytics-table analytics-slowest-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Request ID</th>
                    <th>Model</th>
                    <th>Project</th>
                    <th>Latency</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.slowestRequests.map((row) => (
                    <tr key={row.requestId}>
                      <td>{formatShortTime(row.timestamp, locale)}</td>
                      <td>
                        <Link href={`/tenants/${tenantId}/request-logs?requestId=${encodeURIComponent(row.requestId)}`}>
                          {shortRequestId(row.requestId)}
                        </Link>
                      </td>
                      <td>{row.model}</td>
                      <td>{projectNameById.get(row.projectId) ?? row.projectId}</td>
                      <td>{formatMs(row.latencyMs)}</td>
                      <td>
                        <span className="analytics-status-badge" data-status={statusTone(row.status, row.statusCode)}>
                          {row.statusCode || row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <AnalyticsEmptyState text="No slow requests for selected filters" />
          )}
        </article>
      </section>
    </section>
  );
}

function AnalyticsKpiCard({
  icon: Icon,
  label,
  tone,
  value
}: {
  icon: typeof Activity;
  label: string;
  tone: string;
  value: string;
}) {
  return (
    <article className="analytics-kpi-card" data-tone={tone}>
      <div className="analytics-kpi-title">
        <span>
          <Icon aria-hidden="true" size={18} />
        </span>
        <p>{label}</p>
      </div>
      <strong>{value}</strong>
    </article>
  );
}

function AnalyticsPlaceholder({ activeTab }: { activeTab: AnalyticsTab }) {
  return (
    <section className="analytics-tab-panel">
      <article className="analytics-state-card">
        <strong>{tabLabel(activeTab)} analytics is not implemented yet</strong>
        <p>이번 작업 범위는 Performance 탭입니다. 이 탭에는 mock 차트를 넣지 않았습니다.</p>
      </article>
    </section>
  );
}

function AnalyticsEmptyState({ text }: { text: string }) {
  return (
    <div className="analytics-empty-state">
      <span>{text}</span>
    </div>
  );
}

function buildAnalyticsFilters(
  searchParams: Awaited<AnalyticsPageProps["searchParams"]>
): AnalyticsFilterState {
  return {
    model: normalizeOptionalText(searchParams?.model),
    projectId: normalizeOptionalText(searchParams?.projectId),
    provider: normalizeOptionalText(searchParams?.provider),
    range: normalizeAnalyticsRange(searchParams?.range)
  };
}

function normalizeAnalyticsRange(value: string | undefined): LiveAnalyticsRange {
  if (value === "15m" || value === "1h" || value === "1d" || value === "1w") {
    return value;
  }

  return "1w";
}

function normalizeAnalyticsTab(value: string | undefined): AnalyticsTab {
  if (value === "usage" || value === "cost" || value === "reliability" || value === "cache") {
    return value;
  }

  return "performance";
}

function normalizeOptionalText(value: string | undefined) {
  return value?.trim() ?? "";
}

function buildProviderOptions(performance: LiveAnalyticsPerformance | undefined, selectedProvider: string) {
  const options = new Set<string>();
  if (selectedProvider) {
    options.add(selectedProvider);
  }
  performance?.providerModelPerformance.forEach((row) => {
    if (row.provider) {
      options.add(row.provider);
    }
  });
  return [...options].sort((a, b) => a.localeCompare(b));
}

function buildModelOptions(performance: LiveAnalyticsPerformance | undefined, selectedModel: string) {
  const options = new Set<string>();
  if (selectedModel) {
    options.add(selectedModel);
  }
  performance?.providerModelPerformance.forEach((row) => {
    if (row.model) {
      options.add(row.model);
    }
  });
  return [...options].sort((a, b) => a.localeCompare(b));
}

function analyticsTabHref(tenantId: string, tab: AnalyticsTab, filters: AnalyticsFilterState) {
  const query = new URLSearchParams();
  query.set("tab", tab);
  query.set("range", filters.range);
  appendOptionalQuery(query, "projectId", filters.projectId);
  appendOptionalQuery(query, "provider", filters.provider);
  appendOptionalQuery(query, "model", filters.model);
  return `/tenants/${tenantId}/analytics?${query.toString()}`;
}

function appendOptionalQuery(query: URLSearchParams, key: string, value: string) {
  if (value) {
    query.set(key, value);
  }
}

function tabLabel(tab: AnalyticsTab) {
  return analyticsTabs.find((item) => item.id === tab)?.label ?? "Analytics";
}

function rangeLabel(range: LiveAnalyticsRange) {
  return analyticsRangeOptions.find((option) => option.value === range)?.label ?? "Last 7 days";
}

function formatMs(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "0 ms";
  }

  return `${formatInteger(Math.round(value))} ms`;
}

function formatThroughput(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "0/min";
  }

  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: value >= 10 ? 1 : 2 }).format(value)}/min`;
}

function formatRate(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "0%";
  }

  return formatPercent(value);
}

function formatUsdString(value: string) {
  const parsed = Number(value);
  return formatUsdNumber(Number.isFinite(parsed) ? parsed : 0);
}

function formatUsdNumber(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "$0.00";
  }

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: value >= 1 ? 2 : 4,
    minimumFractionDigits: value >= 1 ? 2 : 4,
    style: "currency"
  }).format(value);
}

function formatShortTime(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Seoul"
  }).format(date);
}

function shortRequestId(value: string) {
  if (value.length <= 22) {
    return value;
  }

  return `${value.slice(0, 14)}...${value.slice(-6)}`;
}

function statusTone(status: string, statusCode: number) {
  if (statusCode >= 500 || status === "failed") {
    return "error";
  }
  if (statusCode >= 400) {
    return "warning";
  }
  return "success";
}
