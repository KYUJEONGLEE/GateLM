import {
  Activity,
  Coins,
  Database,
  Gauge,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles
} from "lucide-react";
import { IntentPrefetchLink } from "@/components/navigation/intent-prefetch-link";
import {
  AnalyticsCachePanel,
  AnalyticsCostPanel,
  AnalyticsPerformancePanel,
  AnalyticsReliabilityPanel,
  AnalyticsUsagePanel
} from "@/features/analytics/components/analytics-panels";
import { AnalyticsV5Overview } from "@/features/analytics/components/analytics-v5-overview";
import { buildAnalyticsReadModel } from "@/features/analytics/analytics-read-model";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import { getLiveCostOverTime } from "@/lib/gateway/live-cost-report";
import {
  getAnalyticsPerformanceRange,
  getLiveAnalyticsPerformance,
  type LiveAnalyticsPerformance,
  type LiveAnalyticsRange
} from "@/lib/gateway/live-analytics-performance";
import { getLiveAnalyticsV5Evidence } from "@/lib/gateway/live-analytics-v5";
import { getLiveDashboardOverview } from "@/lib/gateway/live-dashboard-overview";
import { getLiveGatewayRequestLogs } from "@/lib/gateway/live-request-logs";
import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import type { Locale } from "@/lib/i18n/locale";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type AnalyticsPageProps = {
  params: Promise<{ tenantId: string }>;
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

const tabConfig: Array<{ icon: typeof Activity; id: AnalyticsTab }> = [
  { icon: Sparkles, id: "impact" },
  { icon: Activity, id: "usage" },
  { icon: Coins, id: "cost" },
  { icon: Gauge, id: "performance" },
  { icon: ShieldCheck, id: "reliability" },
  { icon: Database, id: "cache" }
];

const rangeValues: LiveAnalyticsRange[] = ["15m", "1h", "1d", "1w"];

const pageText = {
  en: {
    allModels: "All models",
    allProjects: "All projects",
    allProviders: "All Providers",
    apply: "Apply",
    filterAria: "Analytics filters",
    model: "Model",
    project: "Project",
    provider: "Provider",
    range: "Time range",
    rangeLabels: { "15m": "15 minutes", "1h": "1 hour", "1d": "24 hours", "1w": "7 days" },
    subtitle: "Cost, policy, and operational performance",
    tabs: {
      cache: "Cache",
      cost: "Cost",
      impact: "Policy impact",
      performance: "Performance",
      reliability: "Reliability",
      usage: "Usage"
    },
    title: "Analytics"
  },
  ko: {
    allModels: "전체 모델",
    allProjects: "전체 프로젝트",
    allProviders: "전체 Provider",
    apply: "적용",
    filterAria: "분석 필터",
    model: "모델",
    project: "프로젝트",
    provider: "Provider",
    range: "시간 범위",
    rangeLabels: { "15m": "15분", "1h": "1시간", "1d": "24시간", "1w": "7일" },
    subtitle: "비용, 정책, 운영 성능 분석",
    tabs: {
      cache: "캐시",
      cost: "비용",
      impact: "정책 효과",
      performance: "성능",
      reliability: "안정성",
      usage: "사용량"
    },
    title: "Analytics"
  }
} satisfies Record<Locale, unknown>;

export default async function AnalyticsPage({ params, searchParams }: AnalyticsPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const activeTab = normalizeTab(resolvedSearchParams?.tab);
  const filters = buildFilters(resolvedSearchParams);
  const needsPerformance = activeTab === "usage" || activeTab === "performance";
  const needsCostTrend = activeTab === "cost";
  const needsV5Evidence = activeTab === "impact";
  const needsReliabilityEvidence = activeTab === "reliability";
  const reliabilityRange = getAnalyticsPerformanceRange(filters.range);

  const [locale, projectsModel, overview, performance, costTrend, v5Evidence, reliabilityRecords] = await Promise.all([
    getRequestLocale(),
    getProjectsModel(tenantId),
    getLiveDashboardOverview(tenantId, {
      projectId: filters.projectId || undefined,
      range: filters.range
    }),
    needsPerformance
      ? getLiveAnalyticsPerformance(tenantId, {
          model: activeTab === "performance" ? filters.model || undefined : undefined,
          projectId: filters.projectId || undefined,
          provider: activeTab === "performance" ? filters.provider || undefined : undefined,
          range: filters.range
        })
      : Promise.resolve(undefined),
    needsCostTrend
      ? getLiveCostOverTime(tenantId, {
          projectId: filters.projectId || undefined,
          range: filters.range
        })
      : Promise.resolve(undefined),
    needsV5Evidence
      ? getLiveAnalyticsV5Evidence(tenantId, {
          projectId: filters.projectId || undefined,
          range: filters.range
        })
      : Promise.resolve(undefined),
    needsReliabilityEvidence
      ? getLiveGatewayRequestLogs({
          from: reliabilityRange.from,
          limit: 100,
          projectId: filters.projectId || undefined,
          tenantId,
          to: reliabilityRange.to
        })
      : Promise.resolve(undefined)
  ]);

  const text = pageText[locale];
  const projects = projectsModel.projects.filter((project) => project.status !== "ARCHIVED");
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
  const model = buildAnalyticsReadModel(overview);
  const providerOptions = buildProviderOptions(overview, performance, filters.provider);
  const modelOptions = buildModelOptions(overview, performance, filters.model);
  const showProviderModelFilters = activeTab === "performance";

  return (
    <main className="console-content analytics-v3-page analytics-v4-page analytics-v5-page">
      <header className="analytics-v3-command-header">
        <div className="analytics-v3-title-block">
          <h1>{text.title}</h1>
          <p>{text.subtitle}</p>
        </div>

        <form
          action={`/tenants/${tenantId}/analytics`}
          aria-label={text.filterAria}
          className="analytics-v3-filter-bar"
        >
          <input name="tab" type="hidden" value={activeTab} />
          <label>
            <span>{text.range}</span>
            <select defaultValue={filters.range} name="range">
              {rangeValues.map((range) => (
                <option key={range} value={range}>{text.rangeLabels[range]}</option>
              ))}
            </select>
          </label>
          <label className="analytics-v3-project-filter">
            <span>{text.project}</span>
            <select defaultValue={filters.projectId} name="projectId">
              <option value="">{text.allProjects}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          {showProviderModelFilters ? (
            <>
              <label>
                <span>{text.provider}</span>
                <select defaultValue={filters.provider} name="provider">
                  <option value="">{text.allProviders}</option>
                  {providerOptions.map((provider) => (
                    <option key={provider} value={provider}>{provider}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>{text.model}</span>
                <select defaultValue={filters.model} name="model">
                  <option value="">{text.allModels}</option>
                  {modelOptions.map((modelName) => (
                    <option key={modelName} value={modelName}>{formatModelDisplayName(modelName)}</option>
                  ))}
                </select>
              </label>
            </>
          ) : null}
          <button aria-label={text.apply} title={text.apply} type="submit">
            <SlidersHorizontal aria-hidden="true" size={19} />
            <span>{text.apply}</span>
          </button>
        </form>
      </header>

      <nav aria-label="Analytics sections" className="analytics-v3-tabs">
        {tabConfig.map((tab) => {
          const Icon = tab.icon;
          return (
            <IntentPrefetchLink
              aria-current={tab.id === activeTab ? "page" : undefined}
              className="analytics-v3-tab"
              data-active={tab.id === activeTab}
              href={tabHref(tenantId, tab.id, filters)}
              key={tab.id}
            >
              <Icon aria-hidden="true" size={18} />
              {text.tabs[tab.id]}
            </IntentPrefetchLink>
          );
        })}
      </nav>

      {activeTab === "impact" ? (
        <AnalyticsV5Overview
          evidence={v5Evidence}
          locale={locale}
          model={model}
          projectNameById={projectNameById}
          range={filters.range}
        />
      ) : activeTab === "usage" ? (
        <AnalyticsUsagePanel
          locale={locale}
          model={model}
          performance={performance}
          projectNameById={projectNameById}
        />
      ) : activeTab === "cost" ? (
        <AnalyticsCostPanel
          costTrend={costTrend}
          locale={locale}
          model={model}
          projectNameById={projectNameById}
        />
      ) : activeTab === "performance" ? (
        <AnalyticsPerformancePanel
          locale={locale}
          model={model}
          performance={performance}
          projectNameById={projectNameById}
          range={filters.range}
          tenantId={tenantId}
        />
      ) : activeTab === "reliability" ? (
        <AnalyticsReliabilityPanel
          locale={locale}
          model={model}
          projectNameById={projectNameById}
          records={reliabilityRecords}
          range={filters.range}
          tenantId={tenantId}
        />
      ) : (
        <AnalyticsCachePanel locale={locale} model={model} />
      )}
    </main>
  );
}

function buildFilters(
  searchParams: Awaited<AnalyticsPageProps["searchParams"]>
): AnalyticsFilterState {
  return {
    model: normalizeText(searchParams?.model),
    projectId: normalizeText(searchParams?.projectId),
    provider: normalizeText(searchParams?.provider),
    range: normalizeRange(searchParams?.range)
  };
}

function normalizeRange(value: string | undefined): LiveAnalyticsRange {
  return value === "15m" || value === "1h" || value === "1d" || value === "1w"
    ? value
    : "1w";
}

function normalizeTab(value: string | undefined): AnalyticsTab {
  return value === "usage" ||
    value === "cost" ||
    value === "performance" ||
    value === "reliability" ||
    value === "cache"
    ? value
    : "impact";
}

function normalizeText(value: string | undefined) {
  return value?.trim() ?? "";
}

function buildProviderOptions(
  overview: DashboardOverview | undefined,
  performance: LiveAnalyticsPerformance | undefined,
  selectedProvider: string
) {
  return uniqueSorted([
    selectedProvider,
    ...(overview?.breakdowns?.byProviderModel?.map((row) => row.selectedProvider) ?? []),
    ...(performance?.providerModelPerformance.map((row) => row.provider) ?? [])
  ]);
}

function buildModelOptions(
  overview: DashboardOverview | undefined,
  performance: LiveAnalyticsPerformance | undefined,
  selectedModel: string
) {
  return uniqueSorted([
    selectedModel,
    ...(overview?.breakdowns?.byProviderModel?.map((row) => row.selectedModel) ?? []),
    ...(performance?.providerModelPerformance.map((row) => row.model) ?? [])
  ]);
}

function uniqueSorted(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function tabHref(
  tenantId: string,
  tab: AnalyticsTab,
  filters: AnalyticsFilterState
) {
  const query = new URLSearchParams({ range: filters.range, tab });
  appendQuery(query, "projectId", filters.projectId);
  if (tab === "performance") {
    appendQuery(query, "provider", filters.provider);
    appendQuery(query, "model", filters.model);
  }
  return `/tenants/${tenantId}/analytics?${query.toString()}`;
}

function appendQuery(query: URLSearchParams, key: string, value: string) {
  if (value) {
    query.set(key, value);
  }
}
