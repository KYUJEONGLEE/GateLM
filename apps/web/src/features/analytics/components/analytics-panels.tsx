import Link from "next/link";
import {
  Activity,
  Coins,
  Database,
  Gauge,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  AnalyticsCompositionChart,
  AnalyticsCostTrendChart,
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

type ExecutiveMetric = {
  label: string;
  meta?: string;
  value: string;
};

type EvidenceRow = {
  cells: ReactNode[];
  key: string;
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

export function AnalyticsImpactPanel({
  costTrend,
  locale,
  model
}: AnalyticsPanelProps & { costTrend: CostOverTimeSummary | undefined }) {
  const text = locale === "ko"
    ? {
        avoided: "Provider 호출 방지",
        decision: "Gateway 처리 경로",
        decisionSub: "요청이 Provider 호출 전 어디에서 처리되었는지 보여줍니다",
        evidence: "정책 적용 후 모델 트래픽",
        evidenceSub: "실제 라우팅된 모델별 요청 비중",
        policyActions: "정책 동작",
        policyActionsSub: "선택 기간에 Gateway가 수행한 정책 처리",
        protected: "보호된 요청",
        saved: "절감 비용",
        savedMeta: "잠재 비용 대비",
        spend: "실제 Provider 비용",
        spendSub: "선택 기간의 실제 비용 흐름",
        title: "정책 효과"
      }
    : {
        avoided: "Provider calls avoided",
        decision: "Gateway decision path",
        decisionSub: "Where requests were handled before a Provider call",
        evidence: "Model traffic after policy",
        evidenceSub: "Actual routed request share by model",
        policyActions: "Policy actions",
        policyActionsSub: "Gateway actions during the selected range",
        protected: "Protected requests",
        saved: "Recorded savings",
        savedMeta: "of addressable spend",
        spend: "Actual Provider spend",
        spendSub: "Observed Provider cost over the selected range",
        title: "Policy impact"
      };
  const modelRows = model.impact.modelMix.slice(0, 4);

  return (
    <PanelShell locale={locale} model={model} title={text.title}>
      <ExecutiveBand
        accent="impact"
        icon={Sparkles}
        lead={{
          label: text.saved,
          meta: `${formatPercent(model.impact.spendAvoidanceRate)} ${text.savedMeta}`,
          value: formatMicroUsd(model.impact.savedCostMicroUsd)
        }}
        metrics={[
          {
            label: text.avoided,
            meta: formatPercent(model.impact.avoidedProviderCallRate),
            value: formatInteger(model.impact.avoidedProviderCalls)
          },
          {
            label: text.protected,
            meta: formatPercent(model.impact.protectedRequestRate),
            value: formatInteger(model.impact.protectedRequests)
          }
        ]}
      />

      <div className="analytics-v3-workspace">
        <AnalysisSurface
          className="analytics-v3-main-canvas"
          metric={formatMicroUsd(model.cost.totalCostMicroUsd)}
          subtitle={text.spendSub}
          title={text.spend}
        >
          <ChartOrEmpty
            hasData={Boolean(costTrend?.points.some((point) => point.spendUsd > 0))}
            locale={locale}
          >
            <AnalyticsCostTrendChart ariaLabel={text.spend} points={costTrend?.points ?? []} />
          </ChartOrEmpty>
        </AnalysisSurface>

        <AnalysisSurface
          className="analytics-v3-driver-rail"
          subtitle={text.policyActionsSub}
          title={text.policyActions}
        >
          <RankedDriverList locale={locale} rows={model.impact.outcomes} />
        </AnalysisSurface>
      </div>

      <DecisionPath
        locale={locale}
        rows={model.impact.requestDisposition}
        subtitle={text.decisionSub}
        title={text.decision}
        total={model.totalRequests}
      />

      <EvidenceTable
        columns={locale === "ko" ? ["모델", "요청", "트래픽 비중", "상태"] : ["Model", "Requests", "Traffic share", "State"]}
        emptyLocale={locale}
        rows={modelRows.map((row) => ({
          cells: [
            <strong key="model">{row.label}</strong>,
            formatInteger(row.value),
            formatPercent(safeRatio(row.value, model.totalRequests)),
            <EvidenceState key="state" label={locale === "ko" ? "라우팅됨" : "Routed"} tone="success" />
          ],
          key: row.id
        }))}
        subtitle={text.evidenceSub}
        title={text.evidence}
      />
    </PanelShell>
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
        model: "모델 트래픽",
        modelSub: "실제 라우팅된 모델별 요청량",
        requests: "전체 요청",
        tokens: "사용 토큰",
        tokensPerRequest: "요청당 토큰",
        tokenMix: "토큰 구성",
        tokenMixSub: "입력과 출력 토큰의 실제 비중",
        trend: "요청 추이",
        trendSub: "선택 기간의 Gateway 요청량",
        title: "사용량"
      }
    : {
        active: "Active models",
        applications: "Requests by application",
        applicationsSub: "Applications generating the most traffic",
        model: "Model traffic",
        modelSub: "Actual routed requests by model",
        requests: "Total requests",
        tokens: "Tokens used",
        tokensPerRequest: "tokens per request",
        tokenMix: "Token composition",
        tokenMixSub: "Observed prompt and completion token share",
        trend: "Request volume",
        trendSub: "Gateway requests over the selected range",
        title: "Usage"
      };
  const applicationRows = model.usage.applicationMix.slice(0, 4);
  const tokenCompositionTotal = model.usage.tokenMix.reduce((sum, row) => sum + row.value, 0);

  return (
    <PanelShell locale={locale} model={model} title={text.title}>
      <ExecutiveBand
        accent="usage"
        icon={Activity}
        lead={{ label: text.requests, value: formatInteger(model.usage.totalRequests) }}
        metrics={[
          {
            label: text.tokens,
            meta: `${formatDecimal(model.usage.tokensPerRequest)} ${text.tokensPerRequest}`,
            value: formatCompact(model.usage.totalTokens)
          },
          { label: text.active, value: formatInteger(model.usage.activeModels) }
        ]}
      />

      <div className="analytics-v3-workspace">
        <AnalysisSurface className="analytics-v3-main-canvas" subtitle={text.trendSub} title={text.trend}>
          <ChartOrEmpty
            hasData={Boolean(performance?.latencyDistribution.some((point) => point.requests > 0))}
            locale={locale}
          >
            <AnalyticsRequestVolumeChart ariaLabel={text.trend} points={performance?.latencyDistribution ?? []} />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-driver-rail" subtitle={text.modelSub} title={text.model}>
          <ChartOrEmpty hasData={hasRows(model.usage.requestsByModel)} locale={locale} compact>
            <AnalyticsRankedBarChart ariaLabel={text.model} rows={model.usage.requestsByModel} />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <DecisionPath
        locale={locale}
        rows={model.usage.tokenMix}
        subtitle={text.tokenMixSub}
        title={text.tokenMix}
        total={tokenCompositionTotal}
      />

      <EvidenceTable
        columns={locale === "ko" ? ["애플리케이션", "요청", "전체 비중", "상태"] : ["Application", "Requests", "Share", "State"]}
        emptyLocale={locale}
        rows={applicationRows.map((row) => ({
          cells: [
            <strong key="application">{formatDisplayIdentifier(row.label)}</strong>,
            formatInteger(row.value),
            formatPercent(safeRatio(row.value, model.usage.totalRequests)),
            <EvidenceState key="state" label={locale === "ko" ? "활성" : "Active"} tone="success" />
          ],
          key: row.id
        }))}
        subtitle={text.applicationsSub}
        title={text.applications}
      />
    </PanelShell>
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
        avoided: "잠재 비용 대비",
        byModel: "비용 기여 모델",
        byModelSub: "실제 Provider 비용이 높은 모델",
        byProject: "프로젝트 비용 근거",
        byProjectSub: "비용이 귀속된 프로젝트 상위 4개",
        costPerRequest: "요청당 비용",
        saved: "절감 비용",
        spend: "총 사용 비용",
        title: "비용",
        trend: "비용 추이",
        trendSub: "선택 기간의 실제 Provider 비용"
      }
    : {
        avoided: "of addressable spend",
        byModel: "Cost contributors",
        byModelSub: "Models contributing the most Provider spend",
        byProject: "Project cost evidence",
        byProjectSub: "Top four projects with attributed spend",
        costPerRequest: "Cost per request",
        saved: "Recorded savings",
        spend: "Total spend",
        title: "Cost",
        trend: "Spend trend",
        trendSub: "Actual Provider spend over the selected range"
      };
  const projectRows = model.cost.costByProject.slice(0, 4);

  return (
    <PanelShell locale={locale} model={model} title={text.title}>
      <ExecutiveBand
        accent="cost"
        icon={Coins}
        lead={{ label: text.spend, value: formatMicroUsd(model.cost.totalCostMicroUsd) }}
        metrics={[
          {
            label: text.saved,
            meta: `${formatPercent(model.cost.avoidedSpendRate)} ${text.avoided}`,
            value: formatMicroUsd(model.cost.savedCostMicroUsd)
          },
          { label: text.costPerRequest, value: formatMicroUsd(model.cost.costPerRequestMicroUsd) }
        ]}
      />

      <div className="analytics-v3-workspace">
        <AnalysisSurface className="analytics-v3-main-canvas" subtitle={text.trendSub} title={text.trend}>
          <ChartOrEmpty
            hasData={Boolean(costTrend?.points.some((point) => point.spendUsd > 0))}
            locale={locale}
          >
            <AnalyticsCostTrendChart ariaLabel={text.trend} points={costTrend?.points ?? []} />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-driver-rail" subtitle={text.byModelSub} title={text.byModel}>
          <ChartOrEmpty hasData={hasRows(model.cost.costByModel)} locale={locale} compact>
            <AnalyticsRankedBarChart ariaLabel={text.byModel} kind="micro-usd" rows={model.cost.costByModel} />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <EvidenceTable
        columns={locale === "ko" ? ["프로젝트", "비용", "전체 비용 비중", "상태"] : ["Project", "Spend", "Cost share", "State"]}
        emptyLocale={locale}
        rows={projectRows.map((row) => ({
          cells: [
            <strong key="project">{projectNameById.get(row.id) ?? formatDisplayIdentifier(row.label)}</strong>,
            formatMicroUsd(row.value),
            formatPercent(safeRatio(row.value, model.cost.totalCostMicroUsd)),
            <EvidenceState key="state" label={locale === "ko" ? "집계됨" : "Attributed"} tone="neutral" />
          ],
          key: row.id
        }))}
        subtitle={text.byProjectSub}
        title={text.byProject}
      />
    </PanelShell>
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
        error: "오류율",
        latency: "지연 시간 추이",
        latencySub: "p50, p95, p99 응답 시간",
        p95: "p95 지연",
        provider: "Provider tail latency",
        providerSub: "Provider별 p95 지연 비교",
        slow: "느린 요청 근거",
        slowSub: "지연 시간이 가장 긴 최근 요청 4개",
        throughput: "분당 처리량",
        title: "성능",
        viewLogs: "전체 로그"
      }
    : {
        error: "Error rate",
        latency: "Latency trend",
        latencySub: "p50, p95, and p99 response time",
        p95: "p95 latency",
        provider: "Provider tail latency",
        providerSub: "Compare p95 latency by Provider",
        slow: "Slow request evidence",
        slowSub: "Four recent requests with the highest latency",
        throughput: "Throughput per minute",
        title: "Performance",
        viewLogs: "View all logs"
      };
  const providerRows = (performance?.p95LatencyByProvider ?? [])
    .filter((row) => row.p95LatencyMs !== null)
    .map((row) => ({ id: row.provider, label: row.provider, value: row.p95LatencyMs ?? 0 }));

  return (
    <PanelShell locale={locale} model={model} title={text.title}>
      <ExecutiveBand
        accent="performance"
        icon={Gauge}
        lead={{ label: text.p95, value: formatMs(performance?.summary.p95LatencyMs ?? null) }}
        metrics={[
          { label: text.throughput, value: formatThroughput(performance?.summary.throughputPerMinute ?? null) },
          { label: text.error, value: formatPercent(performance?.summary.errorRate ?? 0) }
        ]}
      />

      <div className="analytics-v3-workspace">
        <AnalysisSurface className="analytics-v3-main-canvas" subtitle={text.latencySub} title={text.latency}>
          <ChartOrEmpty hasData={Boolean(performance?.latencyDistribution.some(hasLatencyPoint))} locale={locale}>
            <AnalyticsLatencyTrendChart ariaLabel={text.latency} points={performance?.latencyDistribution ?? []} />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-driver-rail" subtitle={text.providerSub} title={text.provider}>
          <ChartOrEmpty hasData={hasRows(providerRows)} locale={locale} compact>
            <AnalyticsRankedBarChart ariaLabel={text.provider} kind="milliseconds" rows={providerRows} />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <EvidenceTable
        action={<Link href={`/tenants/${tenantId}/request-logs?range=${range}`}>{text.viewLogs}</Link>}
        columns={locale === "ko" ? ["요청", "모델", "프로젝트", "지연", "상태"] : ["Request", "Model", "Project", "Latency", "State"]}
        emptyLocale={locale}
        rows={(performance?.slowestRequests ?? []).slice(0, 4).map((row) => ({
          cells: [
            <Link href={`/tenants/${tenantId}/request-logs?requestId=${encodeURIComponent(row.requestId)}`} key="request">
              {shortRequestId(row.requestId)}
            </Link>,
            formatModelDisplayName(row.model),
            projectNameById.get(row.projectId) ?? formatDisplayIdentifier(row.projectId),
            formatMs(row.latencyMs),
            <StatusBadge code={row.statusCode} key="status" status={row.status} />
          ],
          key: row.requestId
        }))}
        subtitle={text.slowSub}
        title={text.slow}
      />
    </PanelShell>
  );
}

export function AnalyticsReliabilityPanel({
  locale,
  model,
  performance,
  projectNameById,
  range,
  tenantId
}: PerformancePanelProps) {
  const text = locale === "ko"
    ? {
        error: "시스템 오류율",
        fallback: "Fallback 복구",
        latency: "응답 안정성",
        latencySub: "시간대별 p50, p95, p99 변동",
        outcome: "최종 요청 상태",
        outcomeSub: "모든 요청의 terminal status 분포",
        provider: "Provider 지연",
        providerSub: "Provider별 p95 지연 시간",
        slow: "안정성 조사 대상",
        slowSub: "느리거나 실패 가능성이 높은 최근 요청",
        success: "성공률",
        title: "안정성",
        viewLogs: "전체 로그"
      }
    : {
        error: "System error rate",
        fallback: "Fallback recoveries",
        latency: "Response stability",
        latencySub: "p50, p95, and p99 movement over time",
        outcome: "Terminal outcomes",
        outcomeSub: "Terminal status distribution across all requests",
        provider: "Provider latency",
        providerSub: "p95 latency by Provider",
        slow: "Reliability investigations",
        slowSub: "Recent requests most likely to need investigation",
        success: "Success rate",
        title: "Reliability",
        viewLogs: "View all logs"
      };

  return (
    <PanelShell locale={locale} model={model} title={text.title}>
      <ExecutiveBand
        accent="reliability"
        icon={ShieldCheck}
        lead={{ label: text.success, value: formatPercent(model.reliability.successRate) }}
        metrics={[
          { label: text.error, value: formatPercent(model.reliability.systemErrorRate) },
          { label: text.fallback, value: formatInteger(model.reliability.fallbackSuccesses) }
        ]}
      />

      <div className="analytics-v3-workspace">
        <AnalysisSurface className="analytics-v3-main-canvas" subtitle={text.latencySub} title={text.latency}>
          <ChartOrEmpty hasData={Boolean(performance?.latencyDistribution.some(hasLatencyPoint))} locale={locale}>
            <AnalyticsLatencyTrendChart ariaLabel={text.latency} points={performance?.latencyDistribution ?? []} />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-driver-rail" subtitle={text.providerSub} title={text.provider}>
          <ChartOrEmpty hasData={hasRows(model.reliability.providerLatency)} locale={locale} compact>
            <AnalyticsRankedBarChart ariaLabel={text.provider} kind="milliseconds" rows={model.reliability.providerLatency} />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <CompositionSection
        locale={locale}
        rows={model.reliability.terminalOutcomes}
        subtitle={text.outcomeSub}
        title={text.outcome}
      />

      <EvidenceTable
        action={<Link href={`/tenants/${tenantId}/request-logs?range=${range}`}>{text.viewLogs}</Link>}
        columns={locale === "ko" ? ["요청", "모델", "프로젝트", "지연", "상태"] : ["Request", "Model", "Project", "Latency", "State"]}
        emptyLocale={locale}
        rows={(performance?.slowestRequests ?? []).slice(0, 4).map((row) => ({
          cells: [
            <Link href={`/tenants/${tenantId}/request-logs?requestId=${encodeURIComponent(row.requestId)}`} key="request">
              {shortRequestId(row.requestId)}
            </Link>,
            formatModelDisplayName(row.model),
            projectNameById.get(row.projectId) ?? formatDisplayIdentifier(row.projectId),
            formatMs(row.latencyMs),
            <StatusBadge code={row.statusCode} key="status" status={row.status} />
          ],
          key: row.requestId
        }))}
        subtitle={text.slowSub}
        title={text.slow}
      />
    </PanelShell>
  );
}

export function AnalyticsCachePanel({ locale, model }: AnalyticsPanelProps) {
  const text = locale === "ko"
    ? {
        eligible: "캐시 대상 요청",
        hit: "캐시 적중",
        hitRate: "캐시 적중률",
        outcome: "캐시 처리 경로",
        outcomeSub: "Hit, Miss, Bypass가 Provider 호출에 미친 결과",
        evidence: "캐시 운영 근거",
        evidenceSub: "각 캐시 결과가 다음 처리 단계에 미친 영향",
        saved: "절감 비용",
        throughput: "캐시 효율",
        throughputSub: "대상 요청과 실제 적중 수 비교",
        title: "캐시"
      }
    : {
        eligible: "Cache eligible",
        hit: "Cache hits",
        hitRate: "Cache hit rate",
        outcome: "Cache decision path",
        outcomeSub: "How hit, miss, and bypass affected Provider calls",
        evidence: "Cache operating evidence",
        evidenceSub: "How each cache outcome changed the next processing step",
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
    <PanelShell locale={locale} model={model} title={text.title}>
      <ExecutiveBand
        accent="cache"
        icon={Database}
        lead={{ label: text.hitRate, value: formatPercent(model.cache.hitRate) }}
        metrics={[
          {
            label: text.hit,
            meta: `${formatInteger(model.cache.eligibleRequests)} ${text.eligible}`,
            value: formatInteger(model.cache.hitRequests)
          },
          { label: text.saved, value: formatMicroUsd(model.cache.savedCostMicroUsd) }
        ]}
      />

      <div className="analytics-v3-workspace analytics-v3-cache-workspace">
        <AnalysisSurface className="analytics-v3-main-canvas" subtitle={text.outcomeSub} title={text.outcome}>
          <ChartOrEmpty hasData={hasRows(model.cache.outcomes)} locale={locale}>
            <AnalyticsCompositionChart ariaLabel={text.outcome} rows={model.cache.outcomes} />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-driver-rail" subtitle={text.throughputSub} title={text.throughput}>
          <ChartOrEmpty hasData={hasRows(efficiencyRows)} locale={locale} compact>
            <AnalyticsRankedBarChart ariaLabel={text.throughput} rows={efficiencyRows} />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <EvidenceTable
        columns={locale === "ko" ? ["결과", "요청", "전체 비중", "다음 처리"] : ["Outcome", "Requests", "Share", "Next step"]}
        emptyLocale={locale}
        rows={model.cache.outcomes.filter((row) => row.value > 0).map((row) => ({
          cells: [
            <strong key="outcome">{row.label}</strong>,
            formatInteger(row.value),
            formatPercent(safeRatio(row.value, model.totalRequests)),
            <EvidenceState
              key="state"
              label={row.id === "hit"
                ? locale === "ko" ? "캐시 응답" : "Cache served"
                : locale === "ko" ? "파이프라인 계속" : "Pipeline continued"}
              tone={row.id === "hit" ? "success" : "neutral"}
            />
          ],
          key: row.id
        }))}
        subtitle={text.evidenceSub}
        title={text.evidence}
      />
    </PanelShell>
  );
}

function PanelShell({
  children,
  locale,
  model,
  title
}: AnalyticsPanelProps & { children: ReactNode; title: string }) {
  return (
    <section className="analytics-v3-panel">
      <header className="analytics-v3-panel-topline">
        <h2>{title}</h2>
        <div className="analytics-v3-data-state" data-state={model.dataState}>
          <i />
          <strong>{stateText[locale][model.dataState]}</strong>
          <span>{formatDateTime(model.dataAsOf)}</span>
        </div>
      </header>
      {children}
    </section>
  );
}

function ExecutiveBand({
  accent,
  icon: Icon,
  lead,
  metrics
}: {
  accent: string;
  icon: typeof Activity;
  lead: ExecutiveMetric;
  metrics: [ExecutiveMetric, ExecutiveMetric];
}) {
  return (
    <section className="analytics-v3-executive-band" data-accent={accent}>
      <article className="analytics-v3-executive-lead">
        <div>
          <Icon aria-hidden="true" size={24} />
          <span>{lead.label}</span>
        </div>
        <strong>{lead.value}</strong>
        {lead.meta ? <small>{lead.meta}</small> : null}
      </article>
      {metrics.map((metric) => (
        <article className="analytics-v3-executive-metric" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          {metric.meta ? <small>{metric.meta}</small> : null}
        </article>
      ))}
    </section>
  );
}

function AnalysisSurface({
  children,
  className = "",
  metric,
  subtitle,
  title
}: {
  children: ReactNode;
  className?: string;
  metric?: string;
  subtitle: string;
  title: string;
}) {
  return (
    <section className={`analytics-v3-analysis-surface ${className}`.trim()}>
      <div className="analytics-v3-section-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        {metric ? <strong>{metric}</strong> : null}
      </div>
      {children}
    </section>
  );
}

function RankedDriverList({ locale, rows }: { locale: Locale; rows: AnalyticsValueRow[] }) {
  const visibleRows = rows.filter((row) => row.value > 0).slice(0, 5);
  const max = Math.max(...visibleRows.map((row) => row.value), 1);
  const total = visibleRows.reduce((sum, row) => sum + row.value, 0);

  if (!visibleRows.length) {
    return <AnalyticsEmpty locale={locale} compact />;
  }

  return (
    <ol className="analytics-v3-driver-list">
      {visibleRows.map((row, index) => (
        <li key={row.id}>
          <span>{index + 1}</span>
          <div>
            <strong>{row.label}</strong>
            <i style={{ "--analytics-share": `${Math.max(4, (row.value / max) * 100)}%` } as CSSProperties} />
          </div>
          <em>
            {formatInteger(row.value)}
            <small>{formatPercent(safeRatio(row.value, total))}</small>
          </em>
        </li>
      ))}
    </ol>
  );
}

function DecisionPath({
  locale,
  rows,
  subtitle,
  title,
  total
}: {
  locale: Locale;
  rows: AnalyticsValueRow[];
  subtitle: string;
  title: string;
  total: number;
}) {
  const visibleRows = rows.filter((row) => row.value > 0);

  return (
    <section className="analytics-v3-decision-path">
      <div className="analytics-v3-section-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <strong>{formatInteger(total)}</strong>
      </div>
      {visibleRows.length ? (
        <div className="analytics-v3-path-grid">
          {visibleRows.map((row) => (
            <article data-kind={row.id} key={row.id}>
              <div>
                <span>{row.label}</span>
                <strong>{formatInteger(row.value)}</strong>
              </div>
              <div className="analytics-v3-path-track">
                <i style={{ "--analytics-share": `${Math.max(2, safeRatio(row.value, total) * 100)}%` } as CSSProperties} />
              </div>
              <small>{formatPercent(safeRatio(row.value, total))}</small>
            </article>
          ))}
        </div>
      ) : (
        <AnalyticsEmpty compact locale={locale} />
      )}
    </section>
  );
}

function CompositionSection({
  locale,
  rows,
  subtitle,
  title
}: {
  locale: Locale;
  rows: AnalyticsValueRow[];
  subtitle: string;
  title: string;
}) {
  return (
    <section className="analytics-v3-composition-section">
      <div className="analytics-v3-section-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
      </div>
      <ChartOrEmpty hasData={hasRows(rows)} locale={locale} compact>
        <AnalyticsCompositionChart ariaLabel={title} rows={rows} />
      </ChartOrEmpty>
      <div className="analytics-v3-composition-legend">
        {rows.filter((row) => row.value > 0).slice(0, 5).map((row) => (
          <span data-kind={row.id} key={row.id}>
            <i />
            {row.label}
            <strong>{formatInteger(row.value)}</strong>
          </span>
        ))}
      </div>
    </section>
  );
}

function EvidenceTable({
  action,
  columns,
  emptyLocale,
  rows,
  subtitle,
  title
}: {
  action?: ReactNode;
  columns: string[];
  emptyLocale: Locale;
  rows: EvidenceRow[];
  subtitle: string;
  title: string;
}) {
  return (
    <section className="analytics-v3-evidence-table">
      <div className="analytics-v3-section-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        {action ? <div className="analytics-v3-table-action">{action}</div> : null}
      </div>
      {rows.length ? (
        <div className="analytics-v3-table-wrap">
          <table>
            <thead>
              <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
            </thead>
            <tbody>
              {rows.slice(0, 4).map((row) => (
                <tr key={row.key}>
                  {row.cells.map((cell, index) => <td key={`${row.key}-${columns[index] ?? index}`}>{cell}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <AnalyticsEmpty locale={emptyLocale} />
      )}
    </section>
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
    <div className="analytics-v3-empty" data-compact={compact}>
      {locale === "ko" ? "선택한 범위에 표시할 데이터가 없습니다" : "No data for the selected range"}
    </div>
  );
}

function EvidenceState({ label, tone }: { label: string; tone: "neutral" | "success" }) {
  return <span className="analytics-v3-evidence-state" data-tone={tone}>{label}</span>;
}

function StatusBadge({ code, status }: { code: number; status: string }) {
  const tone = code >= 500 || status === "failed" ? "error" : code >= 400 ? "warning" : "success";
  return <span className="analytics-v3-status" data-tone={tone}>{code || status}</span>;
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

function safeRatio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}
