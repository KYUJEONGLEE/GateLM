import Link from "next/link";
import {
  Activity,
  BarChart3,
  Clock3,
  Database,
  Download,
  Gauge,
  LineChart,
  Sparkles,
  ShieldCheck
} from "lucide-react";
import {
  AnalyticsLatencyDistributionLineChart,
  AnalyticsProviderLatencyBarChart
} from "@/features/analytics/components/analytics-performance-charts";
import {
  AnalyticsCachePanel,
  AnalyticsCostPanel,
  AnalyticsReliabilityPanel,
  AnalyticsUsagePanel
} from "@/features/analytics/components/analytics-domain-panels";
import { PolicyImpactPanel } from "@/features/analytics/components/policy-impact-panel";
import { buildAnalyticsOverviewReadModel } from "@/features/analytics/analytics-overview-read-model";
import { buildPolicyImpactReadModel } from "@/features/analytics/policy-impact-read-model";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import { formatDateTime, formatInteger, formatPercent } from "@/lib/formatting/formatters";
import {
  getAnalyticsPerformanceRange,
  getLiveAnalyticsPerformance,
  type LiveAnalyticsPerformance,
  type LiveAnalyticsRange
} from "@/lib/gateway/live-analytics-performance";
import { getLiveDashboardOverview } from "@/lib/gateway/live-dashboard-overview";
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

type AnalyticsTab = "impact" | "usage" | "cost" | "performance" | "reliability" | "cache";

type AnalyticsFilterState = {
  model: string;
  projectId: string;
  provider: string;
  range: LiveAnalyticsRange;
};

type AnalyticsPageText = {
  allModels: string;
  allProjects: string;
  allProviders: string;
  analyticsSectionsAria: string;
  apply: string;
  export: string;
  failedPerformanceBody: string;
  failedPerformanceTitle: string;
  filterModel: string;
  filterProject: string;
  filterProvider: string;
  filterTimeRange: string;
  freshnessRange: string;
  latencyDistributionAria: string;
  latencyDistributionEmpty: string;
  latencyDistributionSubtitle: string;
  latencyDistributionTitle: string;
  performanceIntro: string;
  performanceSummaryAria: string;
  providerLatencyAria: string;
  providerLatencyEmpty: string;
  providerLatencySubtitle: string;
  providerLatencyTitle: string;
  providerModelEmpty: string;
  providerModelSubtitle: string;
  providerModelTitle: string;
  rangeLabels: Record<LiveAnalyticsRange, string>;
  requestTable: {
    latency: string;
    model: string;
    project: string;
    requestId: string;
    status: string;
    time: string;
  };
  slowRequestsEmpty: string;
  slowestRequestsSubtitle: string;
  slowestRequestsTitle: string;
  subtitle: string;
  summaryAvgLatency: string;
  summaryErrorRate: string;
  summaryP95Latency: string;
  summaryP99Latency: string;
  summaryThroughput: string;
  tabLabels: Record<AnalyticsTab, string>;
  tableHeaders: {
    avgLatency: string;
    cacheHitRate: string;
    costPerReq: string;
    errorRate: string;
    model: string;
    p95Latency: string;
    provider: string;
    requests: string;
    totalCost: string;
  };
  title: string;
  viewAllLogs: string;
};

const analyticsPageText: Record<Locale, AnalyticsPageText> = {
  en: {
    allModels: "All Models",
    allProjects: "All Projects",
    allProviders: "All Providers",
    analyticsSectionsAria: "Analytics sections",
    apply: "Apply",
    export: "Export",
    failedPerformanceBody: "Failed to load data from the Gateway analytics API.",
    failedPerformanceTitle: "Failed to load performance analytics",
    filterModel: "Model",
    filterProject: "Project",
    filterProvider: "Provider",
    filterTimeRange: "Time range",
    freshnessRange: "Range",
    latencyDistributionAria: "Latency distribution",
    latencyDistributionEmpty: "No latency distribution data yet",
    latencyDistributionSubtitle: "p50, p95, and p99 latency changes over time.",
    latencyDistributionTitle: "Latency Distribution",
    performanceIntro: "Analyze model and provider performance from real Gateway request logs.",
    performanceSummaryAria: "Performance summary",
    providerLatencyAria: "p95 latency by provider",
    providerLatencyEmpty: "No provider latency data yet",
    providerLatencySubtitle: "Compare provider-level tail latency.",
    providerLatencyTitle: "p95 Latency by Provider",
    providerModelEmpty: "No provider/model performance data for selected filters",
    providerModelSubtitle: "Compare request volume, latency, error rate, and cost efficiency by provider and model.",
    providerModelTitle: "Provider / Model Performance",
    rangeLabels: {
      "15m": "Last 15 minutes",
      "1h": "Last 1 hour",
      "1d": "Last 24 hours",
      "1w": "Last 7 days"
    },
    requestTable: {
      latency: "Latency",
      model: "Model",
      project: "Project",
      requestId: "Request ID",
      status: "Status",
      time: "Time"
    },
    slowRequestsEmpty: "No slow requests for selected filters",
    slowestRequestsSubtitle: "Recent requests with the highest latency.",
    slowestRequestsTitle: "Slowest Requests",
    subtitle: "Make better decisions with data-driven insights.",
    summaryAvgLatency: "Avg Latency",
    summaryErrorRate: "Error Rate",
    summaryP95Latency: "p95 Latency",
    summaryP99Latency: "p99 Latency",
    summaryThroughput: "Throughput",
    tabLabels: {
      cache: "Cache",
      cost: "Cost",
      impact: "Policy Impact",
      performance: "Performance",
      reliability: "Reliability",
      usage: "Usage"
    },
    tableHeaders: {
      avgLatency: "Avg Latency",
      cacheHitRate: "Cache Hit Rate",
      costPerReq: "Cost / Req",
      errorRate: "Error Rate",
      model: "Model",
      p95Latency: "p95 Latency",
      provider: "Provider",
      requests: "Requests",
      totalCost: "Total Cost"
    },
    title: "Analytics",
    viewAllLogs: "View all logs"
  },
  ko: {
    allModels: "전체 모델",
    allProjects: "전체 프로젝트",
    allProviders: "전체 Provider",
    analyticsSectionsAria: "분석 섹션",
    apply: "적용",
    export: "내보내기",
    failedPerformanceBody: "Gateway analytics API에서 데이터를 가져오지 못했습니다.",
    failedPerformanceTitle: "성능 분석을 불러오지 못했습니다",
    filterModel: "모델",
    filterProject: "프로젝트",
    filterProvider: "Provider",
    filterTimeRange: "시간 범위",
    freshnessRange: "조회 범위",
    latencyDistributionAria: "지연 시간 분포",
    latencyDistributionEmpty: "아직 지연 시간 분포 데이터가 없습니다",
    latencyDistributionSubtitle: "시간별 p50, p95, p99 지연 시간 변화입니다.",
    latencyDistributionTitle: "지연 시간 분포",
    performanceIntro: "모델과 제공자별 성능 지표를 실제 Gateway request log 기준으로 분석합니다.",
    performanceSummaryAria: "성능 요약",
    providerLatencyAria: "Provider별 p95 지연 시간",
    providerLatencyEmpty: "아직 Provider 지연 시간 데이터가 없습니다",
    providerLatencySubtitle: "Provider별 tail latency를 비교합니다.",
    providerLatencyTitle: "Provider별 p95 지연 시간",
    providerModelEmpty: "선택한 필터에 해당하는 Provider/모델 성능 데이터가 없습니다",
    providerModelSubtitle: "제공자와 모델별 요청 수, 지연 시간, 오류율, 비용 효율을 비교합니다.",
    providerModelTitle: "Provider / 모델 성능",
    rangeLabels: {
      "15m": "최근 15분",
      "1h": "최근 1시간",
      "1d": "최근 24시간",
      "1w": "최근 7일"
    },
    requestTable: {
      latency: "지연 시간",
      model: "모델",
      project: "프로젝트",
      requestId: "Request ID",
      status: "상태",
      time: "시간"
    },
    slowRequestsEmpty: "선택한 필터에 해당하는 느린 요청이 없습니다",
    slowestRequestsSubtitle: "지연 시간이 가장 긴 최근 요청입니다.",
    slowestRequestsTitle: "느린 요청",
    subtitle: "데이터 기반 인사이트로 더 나은 의사결정을 하세요.",
    summaryAvgLatency: "평균 지연 시간",
    summaryErrorRate: "오류율",
    summaryP95Latency: "p95 지연 시간",
    summaryP99Latency: "p99 지연 시간",
    summaryThroughput: "처리량",
    tabLabels: {
      cache: "캐시",
      cost: "비용",
      impact: "정책 효과",
      performance: "성능",
      reliability: "안정성",
      usage: "사용량"
    },
    tableHeaders: {
      avgLatency: "평균 지연 시간",
      cacheHitRate: "캐시 적중률",
      costPerReq: "요청당 비용",
      errorRate: "오류율",
      model: "모델",
      p95Latency: "p95 지연 시간",
      provider: "Provider",
      requests: "요청 수",
      totalCost: "총 비용"
    },
    title: "Analytics",
    viewAllLogs: "전체 로그 보기"
  }
};

const analyticsTabConfigs: Array<{
  icon: typeof BarChart3;
  id: AnalyticsTab;
}> = [
  { icon: Sparkles, id: "impact" },
  { icon: BarChart3, id: "usage" },
  { icon: Database, id: "cost" },
  { icon: LineChart, id: "performance" },
  { icon: ShieldCheck, id: "reliability" },
  { icon: Database, id: "cache" }
];

const analyticsRangeValues: LiveAnalyticsRange[] = ["15m", "1h", "1d", "1w"];

export default async function AnalyticsPage({ params, searchParams }: AnalyticsPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const activeTab = normalizeAnalyticsTab(resolvedSearchParams?.tab);
  const filters = buildAnalyticsFilters(resolvedSearchParams);
  const liveRange = getAnalyticsPerformanceRange(filters.range);
  const shouldLoadPerformance = activeTab === "performance";
  const shouldLoadOverview = activeTab !== "performance";

  const [locale, projectsModel, performance, dashboardOverview] = await Promise.all([
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
      : Promise.resolve(undefined),
    shouldLoadOverview
      ? getLiveDashboardOverview(tenantId, {
          projectId: filters.projectId || undefined,
          range: filters.range
        })
      : Promise.resolve(undefined)
  ]);

  const activeProjects = projectsModel.projects.filter((project) => project.status !== "ARCHIVED");
  const providerOptions = buildProviderOptions(performance, filters.provider);
  const modelOptions = buildModelOptions(performance, filters.model);
  const text = analyticsPageText[locale];
  const analyticsTabs = getAnalyticsTabs(text);
  const analyticsRangeOptions = getAnalyticsRangeOptions(text);
  const showProviderModelFilters = activeTab === "performance";
  const overviewReadModel = buildAnalyticsOverviewReadModel(dashboardOverview);

  return (
    <main className="console-content analytics-page">
      <header className="analytics-header">
        <h1>{text.title}</h1>
      </header>

      <form action={`/tenants/${tenantId}/analytics`} className="analytics-filter-bar">
        <input name="tab" type="hidden" value={activeTab} />
        <label>
          <span>{text.filterTimeRange}</span>
          <select defaultValue={filters.range} name="range">
            {analyticsRangeOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{text.filterProject}</span>
          <select defaultValue={filters.projectId} name="projectId">
            <option value="">{text.allProjects}</option>
            {activeProjects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        {showProviderModelFilters ? (
          <>
            <label>
              <span>{text.filterProvider}</span>
              <select defaultValue={filters.provider} name="provider">
                <option value="">{text.allProviders}</option>
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{text.filterModel}</span>
              <select defaultValue={filters.model} name="model">
                <option value="">{text.allModels}</option>
                {modelOptions.map((model) => (
                  <option key={model} value={model}>
                    {formatModelDisplayName(model)}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
        <button className="analytics-apply-button" type="submit">
          {text.apply}
        </button>
        <button className="analytics-export-button" type="button">
          <Download aria-hidden="true" size={16} />
          {text.export}
        </button>
      </form>

      <nav aria-label={text.analyticsSectionsAria} className="analytics-tabs">
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

      {activeTab === "impact" ? (
        <PolicyImpactPanel
          locale={locale}
          model={buildPolicyImpactReadModel(dashboardOverview)}
        />
      ) : activeTab === "usage" ? (
        <AnalyticsUsagePanel locale={locale} model={overviewReadModel} />
      ) : activeTab === "cost" ? (
        <AnalyticsCostPanel
          locale={locale}
          model={overviewReadModel}
          projects={activeProjects}
        />
      ) : activeTab === "performance" ? (
        <PerformancePanel
          filters={filters}
          locale={locale}
          performance={performance}
          projects={activeProjects}
          rangeLabel={rangeLabel(filters.range, text)}
          text={text}
          tenantId={tenantId}
        />
      ) : activeTab === "reliability" ? (
        <AnalyticsReliabilityPanel locale={locale} model={overviewReadModel} />
      ) : (
        <AnalyticsCachePanel locale={locale} model={overviewReadModel} />
      )}

      <footer className="analytics-freshness">
        <span>{text.freshnessRange}</span>
        <strong>
          {formatDateTime(liveRange.from)} - {formatDateTime(liveRange.to)}
        </strong>
      </footer>
    </main>
  );
}

function PerformancePanel({
  filters,
  locale,
  performance,
  projects,
  rangeLabel,
  text,
  tenantId
}: {
  filters: AnalyticsFilterState;
  locale: Locale;
  performance: LiveAnalyticsPerformance | undefined;
  projects: ProjectRecord[];
  rangeLabel: string;
  text: AnalyticsPageText;
  tenantId: string;
}) {
  if (!performance) {
    return (
      <section className="analytics-tab-panel">
        <article className="analytics-state-card">
          <strong>{text.failedPerformanceTitle}</strong>
          <p>{text.failedPerformanceBody}</p>
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
        <p>{text.performanceIntro}</p>
      </div>

      <section className="analytics-kpi-grid" aria-label={text.performanceSummaryAria}>
        <AnalyticsKpiCard
          detail={`${text.summaryThroughput} ${formatThroughput(performance.summary.throughputPerMinute)}`}
          icon={Clock3}
          label={text.summaryAvgLatency}
          tone="violet"
          value={formatMs(performance.summary.avgLatencyMs)}
        />
        <AnalyticsKpiCard
          detail={`${text.summaryP99Latency} ${formatMs(performance.summary.p99LatencyMs)}`}
          icon={Gauge}
          label={text.summaryP95Latency}
          tone="blue"
          value={formatMs(performance.summary.p95LatencyMs)}
        />
        <AnalyticsKpiCard
          detail={`${formatInteger(performance.summary.totalRequests)} ${text.tableHeaders.requests}`}
          icon={ShieldCheck}
          label={text.summaryErrorRate}
          tone="red"
          value={formatRate(performance.summary.errorRate)}
        />
      </section>

      <article className="analytics-card analytics-provider-model-card">
        <div className="analytics-card-header">
          <div>
            <h2>{text.providerModelTitle}</h2>
            <p>{text.providerModelSubtitle}</p>
          </div>
          <span>{rangeLabel}</span>
        </div>
        {hasProviderRows ? (
          <div className="analytics-table-wrap">
            <table className="analytics-table">
              <thead>
                <tr>
                  <th>{text.tableHeaders.provider} / {text.tableHeaders.model}</th>
                  <th>{text.tableHeaders.requests}</th>
                  <th>{text.tableHeaders.avgLatency} / {text.tableHeaders.p95Latency}</th>
                  <th>{text.tableHeaders.errorRate}</th>
                  <th>{text.tableHeaders.totalCost}</th>
                  <th>{text.tableHeaders.cacheHitRate}</th>
                </tr>
              </thead>
              <tbody>
                {performance.providerModelPerformance.slice(0, 4).map((row) => (
                  <tr key={`${row.provider}:${row.model}`}>
                    <td>
                      <span className="analytics-provider-model-cell">
                        <strong>{row.provider}</strong>
                        <small>{formatModelDisplayName(row.model)}</small>
                      </span>
                    </td>
                    <td>{formatInteger(row.requests)}</td>
                    <td>{formatMs(row.avgLatencyMs)} / {formatMs(row.p95LatencyMs)}</td>
                    <td>{formatRate(row.errorRate)}</td>
                    <td>{formatUsdString(row.totalCostUsd)}</td>
                    <td>{formatRate(row.cacheHitRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <AnalyticsEmptyState text={text.providerModelEmpty} />
        )}
      </article>

      <section className="analytics-lower-grid">
        <article className="analytics-card">
          <div className="analytics-card-header">
            <div>
              <h2>{text.providerLatencyTitle}</h2>
              <p>{text.providerLatencySubtitle}</p>
            </div>
          </div>
          {hasProviderLatency ? (
            <AnalyticsProviderLatencyBarChart
              ariaLabel={text.providerLatencyAria}
              rows={performance.p95LatencyByProvider
                .filter((row) => row.p95LatencyMs !== null)
                .map((row) => ({
                  label: row.provider,
                  value: row.p95LatencyMs ?? 0
                }))}
            />
          ) : (
            <AnalyticsEmptyState text={text.providerLatencyEmpty} />
          )}
        </article>

        <article className="analytics-card">
          <div className="analytics-card-header">
            <div>
              <h2>{text.latencyDistributionTitle}</h2>
              <p>{text.latencyDistributionSubtitle}</p>
            </div>
          </div>
          {hasLatencyDistribution ? (
            <AnalyticsLatencyDistributionLineChart
              ariaLabel={text.latencyDistributionAria}
              points={performance.latencyDistribution.map((point) => ({
                label: point.label,
                p50: point.p50LatencyMs,
                p95: point.p95LatencyMs,
                p99: point.p99LatencyMs
              }))}
            />
          ) : (
            <AnalyticsEmptyState text={text.latencyDistributionEmpty} />
          )}
        </article>

        <article className="analytics-card analytics-slowest-card">
          <div className="analytics-card-header">
            <div>
              <h2>{text.slowestRequestsTitle}</h2>
              <p>{text.slowestRequestsSubtitle}</p>
            </div>
            <Link href={`/tenants/${tenantId}/request-logs?range=${filters.range}`}>{text.viewAllLogs}</Link>
          </div>
          {performance.slowestRequests.length > 0 ? (
            <div className="analytics-table-wrap">
              <table className="analytics-table analytics-slowest-table">
                <thead>
                  <tr>
                    <th>{text.requestTable.time}</th>
                    <th>{text.requestTable.requestId}</th>
                    <th>{text.requestTable.model}</th>
                    <th>{text.requestTable.project}</th>
                    <th>{text.requestTable.latency}</th>
                    <th>{text.requestTable.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.slowestRequests.slice(0, 4).map((row) => (
                    <tr key={row.requestId}>
                      <td>{formatShortTime(row.timestamp, locale)}</td>
                      <td>
                        <Link href={`/tenants/${tenantId}/request-logs?requestId=${encodeURIComponent(row.requestId)}`}>
                          {shortRequestId(row.requestId)}
                        </Link>
                      </td>
                      <td>{formatModelDisplayName(row.model)}</td>
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
            <AnalyticsEmptyState text={text.slowRequestsEmpty} />
          )}
        </article>
      </section>
    </section>
  );
}

function AnalyticsKpiCard({
  detail,
  icon: Icon,
  label,
  tone,
  value
}: {
  detail?: string;
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
      {detail ? <small>{detail}</small> : null}
    </article>
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
  if (
    value === "impact" ||
    value === "usage" ||
    value === "cost" ||
    value === "performance" ||
    value === "reliability" ||
    value === "cache"
  ) {
    return value;
  }

  return "impact";
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

function getAnalyticsTabs(text: AnalyticsPageText) {
  return analyticsTabConfigs.map((tab) => ({
    ...tab,
    label: text.tabLabels[tab.id]
  }));
}

function getAnalyticsRangeOptions(text: AnalyticsPageText) {
  return analyticsRangeValues.map((value) => ({
    label: text.rangeLabels[value],
    value
  }));
}

function rangeLabel(range: LiveAnalyticsRange, text: AnalyticsPageText) {
  return text.rangeLabels[range] ?? text.rangeLabels["1w"];
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
