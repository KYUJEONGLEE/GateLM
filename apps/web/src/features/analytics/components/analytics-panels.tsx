import Link from "next/link";
import {
  Activity,
  Coins,
  Database,
  Gauge,
  ShieldCheck
} from "lucide-react";
import type { ReactNode } from "react";
import {
  AnalyticsCostTrendChart,
  AnalyticsDispositionChart,
  AnalyticsDonutChart,
  AnalyticsLatencyTrendChart,
  AnalyticsRankedBarChart,
  AnalyticsRequestVolumeChart
} from "@/features/analytics/components/analytics-charts";
import type { AnalyticsReadModel, AnalyticsValueRow } from "@/features/analytics/analytics-read-model";
import { formatDisplayIdentifier, formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import { formatDateTime, formatInteger, formatPercent } from "@/lib/formatting/formatters";
import type { CostOverTimeSummary } from "@/lib/gateway/cost-over-time-types";
import type { LiveAnalyticsPerformance } from "@/lib/gateway/live-analytics-performance";
import type { Locale } from "@/lib/i18n/locale";

type AnalyticsPanelProps = {
  locale: Locale;
  model: AnalyticsReadModel;
};

type PerformancePanelProps = AnalyticsPanelProps & {
  performance: LiveAnalyticsPerformance | undefined;
  projectNameById: Map<string, string>;
  range: string;
  tenantId: string;
};

const stateText: Record<Locale, Record<AnalyticsReadModel["dataState"], string>> = {
  en: {
    live: "Live data",
    partial: "Partial data",
    stale: "Stale data",
    unavailable: "Data unavailable"
  },
  ko: {
    live: "실시간 데이터",
    partial: "일부 데이터",
    stale: "지연된 데이터",
    unavailable: "데이터 없음"
  }
};

export function AnalyticsImpactPanel({ locale, model }: AnalyticsPanelProps) {
  const text = locale === "ko"
    ? {
        avoided: "Provider 호출 방지",
        decision: "Gateway 처리 경로",
        decisionSub: "전체 요청이 실제로 처리된 위치",
        modelMix: "모델 트래픽",
        modelMixSub: "정책 적용 후 요청 분포",
        outcome: "정책 동작",
        outcomeSub: "Gateway가 실행한 정책별 요청 수",
        protected: "보호된 요청",
        saved: "기록된 절감 비용",
        savedRate: "잠재 비용 대비 절감",
        title: "정책 효과"
      }
    : {
        avoided: "Provider calls avoided",
        decision: "Gateway decision path",
        decisionSub: "Where every request was handled",
        modelMix: "Model traffic",
        modelMixSub: "Request mix after routing policy",
        outcome: "Policy actions",
        outcomeSub: "Requests acted on by Gateway policy",
        protected: "Protected requests",
        saved: "Recorded savings",
        savedRate: "Saved from addressable spend",
        title: "Policy impact"
      };

  return (
    <section className="analytics-v2-panel" data-panel="impact">
      <PanelTopline locale={locale} model={model} title={text.title} />

      <div className="analytics-v2-impact-grid">
        <article className="analytics-v2-impact-hero">
          <div className="analytics-v2-impact-hero-label">
            <Coins aria-hidden="true" size={22} />
            <span>{text.saved}</span>
          </div>
          <strong>{formatMicroUsd(model.impact.savedCostMicroUsd)}</strong>
          <p>
            <b>{formatPercent(model.impact.spendAvoidanceRate)}</b>
            {text.savedRate}
          </p>
          <div className="analytics-v2-impact-support">
            <SupportMetric
              label={text.avoided}
              value={formatInteger(model.impact.avoidedProviderCalls)}
              meta={formatPercent(model.impact.avoidedProviderCallRate)}
            />
            <SupportMetric
              label={text.protected}
              value={formatInteger(model.impact.protectedRequests)}
              meta={formatPercent(model.impact.protectedRequestRate)}
            />
          </div>
        </article>

        <AnalyticsSurface className="analytics-v2-impact-outcomes" subtitle={text.outcomeSub} title={text.outcome}>
          <ChartOrEmpty hasData={hasRows(model.impact.outcomes)} locale={locale}>
            <AnalyticsRankedBarChart
              ariaLabel={text.outcome}
              className="analytics-v2-policy-chart"
              maxRows={5}
              rows={model.impact.outcomes}
            />
          </ChartOrEmpty>
        </AnalyticsSurface>

        <AnalyticsSurface className="analytics-v2-impact-models" subtitle={text.modelMixSub} title={text.modelMix}>
          <ChartOrEmpty hasData={hasRows(model.impact.modelMix)} locale={locale}>
            <AnalyticsRankedBarChart
              ariaLabel={text.modelMix}
              className="analytics-v2-model-mix-chart"
              maxRows={4}
              rows={model.impact.modelMix}
            />
          </ChartOrEmpty>
        </AnalyticsSurface>
      </div>

      <article className="analytics-v2-decision-strip">
        <div className="analytics-v2-surface-heading">
          <div>
            <h3>{text.decision}</h3>
            <p>{text.decisionSub}</p>
          </div>
          <strong>{formatInteger(model.totalRequests)}</strong>
        </div>
        <ChartOrEmpty hasData={hasRows(model.impact.requestDisposition)} locale={locale} compact>
          <AnalyticsDispositionChart ariaLabel={text.decision} rows={model.impact.requestDisposition} />
        </ChartOrEmpty>
        <div className="analytics-v2-decision-legend">
          {model.impact.requestDisposition.map((row) => (
            <span data-kind={row.id} key={row.id}>
              <i />
              {row.label}
              <strong>{formatInteger(row.value)}</strong>
            </span>
          ))}
        </div>
      </article>
    </section>
  );
}

export function AnalyticsUsagePanel({
  locale,
  model,
  performance
}: AnalyticsPanelProps & { performance: LiveAnalyticsPerformance | undefined }) {
  const text = locale === "ko"
    ? {
        active: "사용 모델",
        applications: "애플리케이션별 요청",
        applicationsSub: "요청량 상위 애플리케이션",
        model: "모델별 사용량",
        modelSub: "라우팅된 모델의 요청 분포",
        requests: "전체 요청",
        tokens: "사용 토큰",
        tokensPerRequest: "요청당 토큰",
        tokenMix: "토큰 구성",
        tokenMixSub: "입력과 출력 토큰 비중",
        trend: "요청 추이",
        trendSub: "선택 기간의 Gateway 요청량",
        title: "사용량"
      }
    : {
        active: "Active models",
        applications: "Requests by application",
        applicationsSub: "Applications with the most traffic",
        model: "Usage by model",
        modelSub: "Request distribution across routed models",
        requests: "Total requests",
        tokens: "Tokens used",
        tokensPerRequest: "Tokens per request",
        tokenMix: "Token composition",
        tokenMixSub: "Input and output token share",
        trend: "Request volume",
        trendSub: "Gateway requests over the selected range",
        title: "Usage"
      };

  return (
    <section className="analytics-v2-panel" data-panel="usage">
      <PanelTopline locale={locale} model={model} title={text.title} />
      <MetricRail
        icon={Activity}
        primary={{ label: text.requests, value: formatInteger(model.usage.totalRequests) }}
        secondary={[
          { label: text.tokens, meta: `${formatDecimal(model.usage.tokensPerRequest)} ${text.tokensPerRequest}`, value: formatCompact(model.usage.totalTokens) },
          { label: text.active, value: formatInteger(model.usage.activeModels) }
        ]}
      />
      <div className="analytics-v2-primary-grid">
        <AnalyticsSurface className="analytics-v2-wide-surface" subtitle={text.trendSub} title={text.trend}>
          <ChartOrEmpty hasData={Boolean(performance?.latencyDistribution.some((point) => point.requests > 0))} locale={locale}>
            <AnalyticsRequestVolumeChart ariaLabel={text.trend} points={performance?.latencyDistribution ?? []} />
          </ChartOrEmpty>
        </AnalyticsSurface>
        <AnalyticsSurface subtitle={text.modelSub} title={text.model}>
          <ChartOrEmpty hasData={hasRows(model.usage.requestsByModel)} locale={locale}>
            <AnalyticsRankedBarChart ariaLabel={text.model} rows={model.usage.requestsByModel} />
          </ChartOrEmpty>
        </AnalyticsSurface>
      </div>
      <div className="analytics-v2-secondary-grid">
        <AnalyticsSurface subtitle={text.tokenMixSub} title={text.tokenMix}>
          <ChartOrEmpty hasData={hasRows(model.usage.tokenMix)} locale={locale}>
            <AnalyticsDonutChart ariaLabel={text.tokenMix} kind="tokens" rows={model.usage.tokenMix} />
          </ChartOrEmpty>
        </AnalyticsSurface>
        <AnalyticsSurface subtitle={text.applicationsSub} title={text.applications}>
          <ChartOrEmpty hasData={hasRows(model.usage.applicationMix)} locale={locale}>
            <AnalyticsRankedBarChart
              ariaLabel={text.applications}
              rows={model.usage.applicationMix.map((row) => ({
                ...row,
                label: formatDisplayIdentifier(row.label)
              }))}
            />
          </ChartOrEmpty>
        </AnalyticsSurface>
      </div>
    </section>
  );
}

export function AnalyticsCostPanel({
  costTrend,
  locale,
  model,
  projectNameById
}: AnalyticsPanelProps & {
  costTrend: CostOverTimeSummary | undefined;
  projectNameById: Map<string, string>;
}) {
  const text = locale === "ko"
    ? {
        avoided: "잠재 비용 절감률",
        byModel: "모델별 비용",
        byModelSub: "비용 기여도가 높은 모델",
        byProject: "프로젝트별 비용",
        byProjectSub: "비용이 귀속된 프로젝트",
        costPerRequest: "요청당 비용",
        saved: "절감 비용",
        spend: "총 사용 비용",
        title: "비용",
        trend: "비용 추이",
        trendSub: "선택 기간의 실제 Provider 비용"
      }
    : {
        avoided: "Potential spend avoided",
        byModel: "Cost by model",
        byModelSub: "Models contributing the most spend",
        byProject: "Cost by project",
        byProjectSub: "Spend attributed to projects",
        costPerRequest: "Cost per request",
        saved: "Recorded savings",
        spend: "Total spend",
        title: "Cost",
        trend: "Spend trend",
        trendSub: "Actual Provider spend over the selected range"
      };
  const projectRows = model.cost.costByProject.map((row) => ({
    ...row,
    label: projectNameById.get(row.id) ?? formatDisplayIdentifier(row.label)
  }));

  return (
    <section className="analytics-v2-panel" data-panel="cost">
      <PanelTopline locale={locale} model={model} title={text.title} />
      <MetricRail
        icon={Coins}
        primary={{ label: text.spend, value: formatMicroUsd(model.cost.totalCostMicroUsd) }}
        secondary={[
          { label: text.saved, meta: `${formatPercent(model.cost.avoidedSpendRate)} ${text.avoided}`, value: formatMicroUsd(model.cost.savedCostMicroUsd) },
          { label: text.costPerRequest, value: formatMicroUsd(model.cost.costPerRequestMicroUsd) }
        ]}
      />
      <div className="analytics-v2-primary-grid">
        <AnalyticsSurface className="analytics-v2-wide-surface" subtitle={text.trendSub} title={text.trend}>
          <ChartOrEmpty hasData={Boolean(costTrend?.points.some((point) => point.spendUsd > 0))} locale={locale}>
            <AnalyticsCostTrendChart ariaLabel={text.trend} points={costTrend?.points ?? []} />
          </ChartOrEmpty>
        </AnalyticsSurface>
        <AnalyticsSurface subtitle={text.byModelSub} title={text.byModel}>
          <ChartOrEmpty hasData={hasRows(model.cost.costByModel)} locale={locale}>
            <AnalyticsRankedBarChart ariaLabel={text.byModel} kind="micro-usd" rows={model.cost.costByModel} />
          </ChartOrEmpty>
        </AnalyticsSurface>
      </div>
      <AnalyticsSurface className="analytics-v2-full-surface analytics-v2-project-cost" subtitle={text.byProjectSub} title={text.byProject}>
        <ChartOrEmpty hasData={hasRows(projectRows)} locale={locale}>
          <AnalyticsRankedBarChart ariaLabel={text.byProject} kind="micro-usd" rows={projectRows} />
        </ChartOrEmpty>
      </AnalyticsSurface>
    </section>
  );
}

export function AnalyticsPerformancePanel({
  locale,
  model,
  performance,
  projectNameById,
  range,
  tenantId
}: PerformancePanelProps) {
  const text = locale === "ko"
    ? {
        avg: "평균 지연",
        error: "오류율",
        latency: "지연 시간 분포",
        latencySub: "p50, p95, p99 응답 시간",
        p95: "p95 지연",
        provider: "Provider별 p95",
        providerSub: "Provider tail latency 비교",
        slow: "느린 요청",
        slowSub: "지연 시간이 가장 긴 최근 요청",
        throughput: "분당 처리량",
        title: "성능",
        viewLogs: "전체 로그"
      }
    : {
        avg: "Average latency",
        error: "Error rate",
        latency: "Latency distribution",
        latencySub: "p50, p95, and p99 response time",
        p95: "p95 latency",
        provider: "p95 by Provider",
        providerSub: "Compare Provider tail latency",
        slow: "Slow requests",
        slowSub: "Recent requests with the highest latency",
        throughput: "Throughput per minute",
        title: "Performance",
        viewLogs: "View all logs"
      };
  const providerRows = (performance?.p95LatencyByProvider ?? [])
    .filter((row) => row.p95LatencyMs !== null)
    .map((row) => ({ id: row.provider, label: row.provider, value: row.p95LatencyMs ?? 0 }));

  return (
    <section className="analytics-v2-panel" data-panel="performance">
      <PanelTopline locale={locale} model={model} title={text.title} />
      <MetricRail
        icon={Gauge}
        primary={{ label: text.p95, value: formatMs(performance?.summary.p95LatencyMs ?? null) }}
        secondary={[
          { label: text.avg, meta: `${text.throughput} ${formatThroughput(performance?.summary.throughputPerMinute ?? null)}`, value: formatMs(performance?.summary.avgLatencyMs ?? null) },
          { label: text.error, value: formatPercent(performance?.summary.errorRate ?? 0) }
        ]}
      />
      <div className="analytics-v2-primary-grid">
        <AnalyticsSurface className="analytics-v2-wide-surface" subtitle={text.latencySub} title={text.latency}>
          <ChartOrEmpty hasData={Boolean(performance?.latencyDistribution.some(hasLatencyPoint))} locale={locale}>
            <AnalyticsLatencyTrendChart ariaLabel={text.latency} points={performance?.latencyDistribution ?? []} />
          </ChartOrEmpty>
        </AnalyticsSurface>
        <AnalyticsSurface subtitle={text.providerSub} title={text.provider}>
          <ChartOrEmpty hasData={hasRows(providerRows)} locale={locale}>
            <AnalyticsRankedBarChart ariaLabel={text.provider} kind="milliseconds" rows={providerRows} />
          </ChartOrEmpty>
        </AnalyticsSurface>
      </div>
      <article className="analytics-v2-surface analytics-v2-request-table">
        <div className="analytics-v2-surface-heading">
          <div>
            <h3>{text.slow}</h3>
            <p>{text.slowSub}</p>
          </div>
          <Link href={`/tenants/${tenantId}/request-logs?range=${range}`}>{text.viewLogs}</Link>
        </div>
        {performance?.slowestRequests.length ? (
          <div className="analytics-v2-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Request</th>
                  <th>Model</th>
                  <th>Project</th>
                  <th>Latency</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {performance.slowestRequests.slice(0, 4).map((row) => (
                  <tr key={row.requestId}>
                    <td>
                      <Link href={`/tenants/${tenantId}/request-logs?requestId=${encodeURIComponent(row.requestId)}`}>
                        {shortRequestId(row.requestId)}
                      </Link>
                    </td>
                    <td>{formatModelDisplayName(row.model)}</td>
                    <td>{projectNameById.get(row.projectId) ?? formatDisplayIdentifier(row.projectId)}</td>
                    <td>{formatMs(row.latencyMs)}</td>
                    <td><StatusBadge code={row.statusCode} status={row.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <AnalyticsEmpty locale={locale} />
        )}
      </article>
    </section>
  );
}

export function AnalyticsReliabilityPanel({ locale, model }: AnalyticsPanelProps) {
  const text = locale === "ko"
    ? {
        fallback: "Fallback 복구",
        gateway: "Gateway p95",
        outcome: "최종 요청 상태",
        outcomeSub: "모든 요청의 terminal status 분포",
        provider: "Provider 지연",
        providerSub: "Provider별 p95 지연 시간",
        success: "성공률",
        systemError: "시스템 오류율",
        title: "안정성"
      }
    : {
        fallback: "Fallback recoveries",
        gateway: "Gateway p95",
        outcome: "Terminal outcomes",
        outcomeSub: "Terminal status distribution across requests",
        provider: "Provider latency",
        providerSub: "p95 latency by Provider",
        success: "Success rate",
        systemError: "System error rate",
        title: "Reliability"
      };

  return (
    <section className="analytics-v2-panel" data-panel="reliability">
      <PanelTopline locale={locale} model={model} title={text.title} />
      <MetricRail
        icon={ShieldCheck}
        primary={{ label: text.success, value: formatPercent(model.reliability.successRate) }}
        secondary={[
          { label: text.systemError, meta: `${text.gateway} ${formatMs(model.reliability.gatewayP95LatencyMs)}`, value: formatPercent(model.reliability.systemErrorRate) },
          { label: text.fallback, value: formatInteger(model.reliability.fallbackSuccesses) }
        ]}
      />
      <div className="analytics-v2-primary-grid analytics-v2-even-grid">
        <AnalyticsSurface subtitle={text.outcomeSub} title={text.outcome}>
          <ChartOrEmpty hasData={hasRows(model.reliability.terminalOutcomes)} locale={locale}>
            <AnalyticsDonutChart ariaLabel={text.outcome} rows={model.reliability.terminalOutcomes} />
          </ChartOrEmpty>
        </AnalyticsSurface>
        <AnalyticsSurface subtitle={text.providerSub} title={text.provider}>
          <ChartOrEmpty hasData={hasRows(model.reliability.providerLatency)} locale={locale}>
            <AnalyticsRankedBarChart ariaLabel={text.provider} kind="milliseconds" rows={model.reliability.providerLatency} />
          </ChartOrEmpty>
        </AnalyticsSurface>
      </div>
    </section>
  );
}

export function AnalyticsCachePanel({ locale, model }: AnalyticsPanelProps) {
  const text = locale === "ko"
    ? {
        eligible: "캐시 대상 요청",
        hit: "캐시 적중",
        hitRate: "캐시 적중률",
        outcome: "캐시 처리 결과",
        outcomeSub: "Hit, Miss, Bypass 분포",
        saved: "절감 비용",
        throughput: "캐시 효율",
        throughputSub: "대상 요청 중 실제 캐시 적중 비교",
        title: "캐시"
      }
    : {
        eligible: "Cache eligible",
        hit: "Cache hits",
        hitRate: "Cache hit rate",
        outcome: "Cache outcomes",
        outcomeSub: "Hit, miss, and bypass distribution",
        saved: "Recorded savings",
        throughput: "Cache efficiency",
        throughputSub: "Eligible requests compared with actual hits",
        title: "Cache"
      };
  const efficiencyRows: AnalyticsValueRow[] = [
    { id: "eligible", label: text.eligible, value: model.cache.eligibleRequests },
    { id: "hit", label: text.hit, value: model.cache.hitRequests }
  ];

  return (
    <section className="analytics-v2-panel" data-panel="cache">
      <PanelTopline locale={locale} model={model} title={text.title} />
      <MetricRail
        icon={Database}
        primary={{ label: text.hitRate, value: formatPercent(model.cache.hitRate) }}
        secondary={[
          { label: text.hit, meta: `${formatInteger(model.cache.eligibleRequests)} ${text.eligible}`, value: formatInteger(model.cache.hitRequests) },
          { label: text.saved, value: formatMicroUsd(model.cache.savedCostMicroUsd) }
        ]}
      />
      <div className="analytics-v2-primary-grid analytics-v2-even-grid">
        <AnalyticsSurface subtitle={text.outcomeSub} title={text.outcome}>
          <ChartOrEmpty hasData={hasRows(model.cache.outcomes)} locale={locale}>
            <AnalyticsDonutChart ariaLabel={text.outcome} rows={model.cache.outcomes} />
          </ChartOrEmpty>
        </AnalyticsSurface>
        <AnalyticsSurface subtitle={text.throughputSub} title={text.throughput}>
          <ChartOrEmpty hasData={hasRows(efficiencyRows)} locale={locale}>
            <AnalyticsRankedBarChart ariaLabel={text.throughput} rows={efficiencyRows} />
          </ChartOrEmpty>
        </AnalyticsSurface>
      </div>
    </section>
  );
}

function PanelTopline({ locale, model, title }: AnalyticsPanelProps & { title: string }) {
  return (
    <header className="analytics-v2-panel-topline">
      <h2>{title}</h2>
      <div className="analytics-v2-data-state" data-state={model.dataState}>
        <i />
        <strong>{stateText[locale][model.dataState]}</strong>
        <span>{formatDateTime(model.dataAsOf)}</span>
      </div>
    </header>
  );
}

function MetricRail({
  icon: Icon,
  primary,
  secondary
}: {
  icon: typeof Activity;
  primary: { label: string; value: string };
  secondary: Array<{ label: string; meta?: string; value: string }>;
}) {
  return (
    <section className="analytics-v2-metric-rail">
      <article className="analytics-v2-primary-metric">
        <div><Icon aria-hidden="true" size={22} /><span>{primary.label}</span></div>
        <strong>{primary.value}</strong>
      </article>
      {secondary.map((metric) => (
        <article className="analytics-v2-secondary-metric" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          {metric.meta ? <small>{metric.meta}</small> : null}
        </article>
      ))}
    </section>
  );
}

function SupportMetric({ label, meta, value }: { label: string; meta: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{meta}</small>
    </div>
  );
}

function AnalyticsSurface({
  children,
  className = "",
  subtitle,
  title
}: {
  children: ReactNode;
  className?: string;
  subtitle: string;
  title: string;
}) {
  return (
    <article className={`analytics-v2-surface ${className}`.trim()}>
      <div className="analytics-v2-surface-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      {children}
    </article>
  );
}

function ChartOrEmpty({
  children,
  compact = false,
  hasData,
  locale
}: {
  children: ReactNode;
  compact?: boolean;
  hasData: boolean;
  locale: Locale;
}) {
  return hasData ? children : <AnalyticsEmpty compact={compact} locale={locale} />;
}

function AnalyticsEmpty({ compact = false, locale }: { compact?: boolean; locale: Locale }) {
  return (
    <div className="analytics-v2-empty" data-compact={compact}>
      {locale === "ko" ? "선택한 범위에 표시할 데이터가 없습니다" : "No data for the selected range"}
    </div>
  );
}

function StatusBadge({ code, status }: { code: number; status: string }) {
  const tone = code >= 500 || status === "failed" ? "error" : code >= 400 ? "warning" : "success";
  return <span className="analytics-v2-status" data-tone={tone}>{code || status}</span>;
}

function hasRows(rows: AnalyticsValueRow[]) {
  return rows.some((row) => row.value > 0);
}

function hasLatencyPoint(point: LiveAnalyticsPerformance["latencyDistribution"][number]) {
  return point.p50LatencyMs !== null || point.p95LatencyMs !== null || point.p99LatencyMs !== null;
}

function formatMicroUsd(value: number) {
  const dollars = value / 1_000_000;
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: dollars > 0 && dollars < 1 ? 4 : 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(Number.isFinite(dollars) ? dollars : 0);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    notation: value >= 1000 ? "compact" : "standard"
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDecimal(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value);
}

function formatMs(value: number | null) {
  return `${formatInteger(Math.round(value ?? 0))} ms`;
}

function formatThroughput(value: number | null) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value ?? 0)}/min`;
}

function shortRequestId(value: string) {
  return value.length <= 20 ? value : `${value.slice(0, 12)}...${value.slice(-5)}`;
}
