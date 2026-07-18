import Link from "next/link";
import {
  Activity,
  ArrowUpRight,
  Ban,
  Coins,
  Database,
  Gauge,
  Route,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TimerOff,
  Zap
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import {
  AnalyticsCompositionChart,
  AnalyticsCostTrendChart,
  AnalyticsEmployeeStackedChart,
  AnalyticsEmployeeTokenBarChart,
  AnalyticsLatencyTrendChart,
  AnalyticsRankedBarChart,
  AnalyticsRequestVolumeChart
} from "@/features/analytics/components/analytics-charts";
import type { AnalyticsReadModel, AnalyticsValueRow } from "@/features/analytics/analytics-read-model";
import type { AnalyticsSecurityEvidence } from "@/features/analytics/analytics-security-evidence";
import { TENANT_CHAT_USAGE_SOURCE_ID } from "@/features/analytics/analytics-usage-merge";
import type { EmployeeSecurityResponse } from "@/lib/control-plane/employee-security-types";
import type { EmployeeUsageResponse } from "@/lib/control-plane/employee-usage-types";
import { formatDisplayIdentifier, formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import { formatDateTime, formatInteger, formatPercent } from "@/lib/formatting/formatters";
import type { CostOverTimeSummary } from "@/lib/gateway/cost-over-time-types";
import type { LiveAnalyticsPerformance } from "@/lib/gateway/live-analytics-performance";
import type {
  AnalyticsReliabilityIncident,
  LiveAnalyticsReliability
} from "@/lib/gateway/live-analytics-reliability";
import type { LiveRequestRow, LiveRequestsPayload } from "@/lib/gateway/live-requests-types";
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

type ReliabilityPanelProps = AnalyticsPanelProps & {
  projectNameById: Map<string, string>;
  reliability: LiveAnalyticsReliability | undefined;
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
  liveRequests,
  locale,
  model,
  tenantId
}: AnalyticsPanelProps & {
  liveRequests: LiveRequestsPayload | undefined;
  tenantId: string;
}) {
  const text = locale === "ko"
    ? {
        briefing: "Gateway 운영 결과",
        decision: "Gateway 처리 경로",
        decisionSub: "요청이 Provider 호출 전 어디에서 처리되었는지 보여줍니다",
        evidence: "최근 처리 근거",
        evidenceEmpty: "선택한 범위에 최근 요청이 없습니다",
        evidenceSub: "최근 요청에서 확인된 실제 Gateway 결과",
        modelTraffic: "모델 라우팅 결과",
        modelTrafficSub: "선택 기간에 실제로 선택된 모델별 요청량",
        outcomes: "정책 결과",
        outcomesSub: "Gateway가 요청마다 수행한 핵심 처리",
        requests: "전체 요청",
        saved: "절감 비용",
        success: "최종 성공률",
        title: "운영 결과"
      }
    : {
        briefing: "Gateway operating results",
        decision: "Gateway decision path",
        decisionSub: "Where requests were handled before a Provider call",
        evidence: "Recent evidence",
        evidenceEmpty: "No recent requests in the selected range",
        evidenceSub: "Observed Gateway outcomes from recent requests",
        modelTraffic: "Model routing result",
        modelTrafficSub: "Requests by the models actually selected in this range",
        outcomes: "Policy outcomes",
        outcomesSub: "The key actions performed by the Gateway",
        requests: "Total requests",
        saved: "Recorded savings",
        success: "Final success rate",
        title: "Operating results"
      };
  const routedRequests = valueById(model.impact.requestDisposition, "provider");
  const outcomeMetrics = [
    { detail: locale === "ko" ? "Provider 선택" : "Provider selected", icon: Route, id: "routed", label: "ROUTED", value: routedRequests },
    { detail: locale === "ko" ? "호출 재사용" : "Response reused", icon: Zap, id: "cache_hit", label: "CACHE HIT", value: valueById(model.impact.outcomes, "cache_hit") },
    { detail: locale === "ko" ? "민감정보 보호" : "Sensitive data protected", icon: ShieldCheck, id: "pii_masked", label: "PII MASKED", value: valueById(model.impact.outcomes, "pii_masked") },
    { detail: locale === "ko" ? "호출 전 제한" : "Stopped before Provider", icon: TimerOff, id: "rate_limited", label: "RATE LIMITED", value: valueById(model.impact.outcomes, "rate_limited") },
    { detail: locale === "ko" ? "대체 경로 복구" : "Recovered on alternate route", icon: ShieldAlert, id: "fallback", label: "FALLBACK", value: valueById(model.impact.outcomes, "fallback") },
    { detail: locale === "ko" ? "정책으로 차단" : "Stopped by policy", icon: Ban, id: "blocked", label: "BLOCKED", value: valueById(model.impact.outcomes, "blocked") }
  ];
  const recentRows = liveRequests?.rows.slice(0, 4) ?? [];

  return (
    <PanelShell locale={locale} model={model} title={text.title}>
      <section className="analytics-v4-briefing-band">
        <div className="analytics-v4-briefing-label">
          <Sparkles aria-hidden="true" size={24} />
          <span>{text.briefing}</span>
        </div>
        <div className="analytics-v4-headline-metrics">
          <article>
            <span>{text.requests}</span>
            <strong>{formatInteger(model.totalRequests)}</strong>
          </article>
          <article>
            <span>{text.saved}</span>
            <strong>{formatMicroUsd(model.impact.savedCostMicroUsd)}</strong>
          </article>
          <article>
            <span>{text.success}</span>
            <strong>{formatPercent(model.reliability.successRate)}</strong>
          </article>
        </div>
      </section>

      <section className="analytics-v4-outcome-section">
        <div className="analytics-v4-section-heading">
          <h3>{text.outcomes}</h3>
          <p>{text.outcomesSub}</p>
        </div>
        <div className="analytics-v4-outcome-grid">
          {outcomeMetrics.map((outcome) => {
            const Icon = outcome.icon;
            return (
              <article data-kind={outcome.id} key={outcome.id}>
                <div>
                  <Icon aria-hidden="true" size={24} />
                  <strong>{outcome.label}</strong>
                </div>
                <span>{formatInteger(outcome.value)}</span>
                <small>{outcome.detail}</small>
              </article>
            );
          })}
        </div>
      </section>

      <div className="analytics-v4-results-grid">
        <AnalysisSurface
          className="analytics-v4-model-result"
          subtitle={text.modelTrafficSub}
          title={text.modelTraffic}
        >
          <ChartOrEmpty hasData={hasRows(model.impact.modelMix)} locale={locale}>
            <AnalyticsRankedBarChart
              ariaLabel={text.modelTraffic}
              presentation
              rows={model.impact.modelMix}
            />
          </ChartOrEmpty>
        </AnalysisSurface>

        <section className="analytics-v4-live-evidence">
          <div className="analytics-v4-section-heading">
            <h3>{text.evidence}</h3>
            <p>{text.evidenceSub}</p>
          </div>
          {recentRows.length ? (
            <ol>
              {recentRows.map((row) => {
                const outcome = liveRequestOutcome(row);
                return (
                  <li key={row.requestId}>
                    <Link href={`/tenants/${tenantId}/request-logs?requestId=${encodeURIComponent(row.requestId)}`}>
                      <div>
                        <time>{formatEvidenceTime(row.timestamp, locale)}</time>
                        <strong data-kind={outcome.kind}>{outcome.label}</strong>
                      </div>
                      <p>
                        <span>{formatModelDisplayName(row.modelRef ?? row.requestedModel)}</span>
                        <em>{formatInteger(row.latencyMs)} ms</em>
                      </p>
                      <ArrowUpRight aria-hidden="true" size={22} />
                    </Link>
                  </li>
                );
              })}
            </ol>
          ) : (
            <div className="analytics-v4-evidence-empty">{text.evidenceEmpty}</div>
          )}
        </section>
      </div>

      <DecisionPath
        locale={locale}
        rows={model.impact.requestDisposition}
        subtitle={text.decisionSub}
        title={text.decision}
        total={model.totalRequests}
      />
    </PanelShell>
  );
}

export function AnalyticsUsagePanel({
  employeeUsage,
  locale,
  model,
  projectNameById,
  selectedEmployeeId
}: AnalyticsPanelProps & {
  employeeUsage: EmployeeUsageResponse | undefined;
  projectNameById: Map<string, string>;
  selectedEmployeeId: string;
}) {
  const text = locale === "ko"
    ? {
        active: "사용 모델",
        sources: "사용 경로별 요청",
        sourcesSub: "프로젝트와 Tenant Chat의 전체 요청 비중",
        employeeSources: "직원별 사용 경로",
        employeeSourcesSub: "Tenant 전체의 Project/Application과 Tenant Chat 토큰 구성",
        employeeTokens: "직원별 토큰",
        employeeTokensSub: "Tenant 전체의 실제 확정 토큰 사용량",
        model: "모델 트래픽",
        modelSub: "실제 라우팅된 모델별 요청량",
        requests: "전체 요청",
        tokens: "사용 토큰",
        tokensPerRequest: "요청당 토큰",
        tokenMix: "토큰 구성",
        tokenMixSub: "입력과 출력 토큰의 실제 비중",
        trend: "요청 추이",
        trendSub: "선택 기간의 Project/Application 및 Tenant Chat 요청량",
        title: "사용량"
      }
    : {
        active: "Active models",
        sources: "Requests by source",
        sourcesSub: "Share of all requests from projects and Tenant Chat",
        employeeSources: "Usage source by employee",
        employeeSourcesSub: "Tenant-wide Project/Application and Tenant Chat token composition",
        employeeTokens: "Tokens by employee",
        employeeTokensSub: "Tenant-wide observed confirmed token usage",
        model: "Model traffic",
        modelSub: "Actual routed requests by model",
        requests: "Total requests",
        tokens: "Tokens used",
        tokensPerRequest: "tokens per request",
        tokenMix: "Token composition",
        tokenMixSub: "Observed prompt and completion token share",
        trend: "Request volume",
        trendSub: "Project/Application and Tenant Chat requests over the selected range",
        title: "Usage"
      };
  const sourceRows = model.usage.sourceMix;
  const tokenCompositionTotal = model.usage.tokenMix.reduce((sum, row) => sum + row.value, 0);
  const employeeRows = selectEmployeeRows(employeeUsage?.data ?? [], selectedEmployeeId);
  const employeeTokenRows = employeeRows.map((row) => ({
    id: row.employeeId,
    label: employeeLabel(row),
    value: row.total.totalTokens
  }));

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
            hasData={model.usage.requestVolume.some((point) => point.requests > 0)}
            locale={locale}
          >
            <AnalyticsRequestVolumeChart ariaLabel={text.trend} points={model.usage.requestVolume} />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-driver-rail" subtitle={text.modelSub} title={text.model}>
          <ChartOrEmpty hasData={hasRows(model.usage.requestsByModel)} locale={locale} compact>
            <AnalyticsRankedBarChart ariaLabel={text.model} rows={model.usage.requestsByModel} />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <div className="analytics-v3-employee-workspace">
        <AnalysisSurface subtitle={text.employeeTokensSub} title={text.employeeTokens}>
          <ChartOrEmpty hasData={hasRows(employeeTokenRows)} locale={locale}>
            <AnalyticsEmployeeTokenBarChart
              ariaLabel={text.employeeTokens}
              rows={employeeTokenRows}
            />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface subtitle={text.employeeSourcesSub} title={text.employeeSources}>
          <ChartOrEmpty hasData={employeeRows.some((row) => row.total.totalTokens > 0)} locale={locale}>
            <AnalyticsEmployeeStackedChart
              ariaLabel={text.employeeSources}
              kind="tokens"
              primaryLabel="Project/Application"
              rows={employeeRows.map((row) => ({
                id: row.employeeId,
                label: employeeLabel(row),
                primary: row.sources.projectApplication.totalTokens,
                secondary: row.sources.tenantChat.totalTokens
              }))}
              secondaryLabel="Tenant Chat"
            />
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
        columns={locale === "ko" ? ["사용 경로", "요청", "전체 비중", "상태"] : ["Source", "Requests", "Share", "State"]}
        emptyLocale={locale}
        rows={sourceRows.map((row) => ({
          cells: [
            <strong key="source">
              {row.id === TENANT_CHAT_USAGE_SOURCE_ID
                ? row.label
                : projectNameById.get(row.id) ?? formatDisplayIdentifier(row.label)}
            </strong>,
            formatInteger(row.value),
            formatPercent(safeRatio(row.value, model.usage.totalRequests)),
            <EvidenceState key="state" label={locale === "ko" ? "집계됨" : "Included"} tone="success" />
          ],
          key: row.id
        }))}
        subtitle={text.sourcesSub}
        title={text.sources}
      />
    </PanelShell>
  );
}

export function AnalyticsCostPanel({
  costTrend,
  employeeUsage,
  locale,
  model,
  projectNameById,
  selectedEmployeeId
}: AnalyticsPanelProps & {
  costTrend: CostOverTimeSummary | undefined;
  employeeUsage: EmployeeUsageResponse | undefined;
  projectNameById: Map<string, string>;
  selectedEmployeeId: string;
}) {
  const text = locale === "ko"
    ? {
        avoided: "잠재 비용 대비",
        employeeCost: "직원별 사용 비용",
        employeeCostSub: "Tenant 전체의 실제 확정 비용 기준",
        employeeSources: "직원별 비용 경로",
        employeeSourcesSub: "Tenant 전체의 Project/Application과 Tenant Chat 비용 구성",
        byModel: "비용 기여 모델",
        byModelSub: "실제 Provider 비용이 높은 모델",
        byProject: "비용 귀속 근거",
        byProjectSub: "상위 4개 프로젝트와 Tenant Chat 비용",
        costPerRequest: "요청당 비용",
        saved: "절감 비용",
        spend: "총 사용 비용",
        title: "비용",
        trend: "비용 추이",
        trendSub: "선택 기간의 실제 Provider 비용"
      }
    : {
        avoided: "of addressable spend",
        employeeCost: "Spend by employee",
        employeeCostSub: "Tenant-wide observed confirmed spend",
        employeeSources: "Cost source by employee",
        employeeSourcesSub: "Tenant-wide Project/Application and Tenant Chat cost composition",
        byModel: "Cost contributors",
        byModelSub: "Models contributing the most Provider spend",
        byProject: "Cost attribution evidence",
        byProjectSub: "Top four projects plus Tenant Chat spend",
        costPerRequest: "Cost per request",
        saved: "Recorded savings",
        spend: "Total spend",
        title: "Cost",
        trend: "Spend trend",
        trendSub: "Actual Provider spend over the selected range"
      };
  const attributionRows = [
    ...model.cost.costAttributions
      .filter((row) => row.kind === "project")
      .slice(0, 4),
    ...model.cost.costAttributions.filter((row) => row.kind === "surface")
  ];
  const employeeRows = selectEmployeeRows(employeeUsage?.data ?? [], selectedEmployeeId);
  const employeeCostRows = employeeRows.map((row) => ({
    id: row.employeeId,
    label: employeeLabel(row),
    value: row.total.costMicroUsd
  }));

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

      <div className="analytics-v3-employee-workspace">
        <AnalysisSurface subtitle={text.employeeCostSub} title={text.employeeCost}>
          <ChartOrEmpty hasData={hasRows(employeeCostRows)} locale={locale}>
            <AnalyticsRankedBarChart
              ariaLabel={text.employeeCost}
              kind="micro-usd"
              maxRows={10}
              rows={employeeCostRows}
            />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface subtitle={text.employeeSourcesSub} title={text.employeeSources}>
          <ChartOrEmpty hasData={employeeRows.some((row) => row.total.costMicroUsd > 0)} locale={locale}>
            <AnalyticsEmployeeStackedChart
              ariaLabel={text.employeeSources}
              kind="micro-usd"
              primaryLabel="Project/Application"
              rows={employeeRows.map((row) => ({
                id: row.employeeId,
                label: employeeLabel(row),
                primary: row.sources.projectApplication.costMicroUsd,
                secondary: row.sources.tenantChat.costMicroUsd
              }))}
              secondaryLabel="Tenant Chat"
            />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <EvidenceTable
        columns={locale === "ko" ? ["귀속 대상", "비용", "전체 비용 비중", "유형"] : ["Attribution", "Spend", "Cost share", "Type"]}
        emptyLocale={locale}
        rows={attributionRows.map((row) => ({
          cells: [
            <strong key="attribution">
              {row.kind === "project"
                ? projectNameById.get(row.projectId) ?? formatDisplayIdentifier(row.label)
                : row.label}
            </strong>,
            formatMicroUsd(row.value),
            formatPercent(safeRatio(row.value, model.cost.totalCostMicroUsd)),
            <EvidenceState
              key="type"
              label={row.kind === "project"
                ? locale === "ko" ? "프로젝트" : "Project"
                : "Tenant Chat"}
              tone="neutral"
            />
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
        latency: "Surface별 지연 시간 추이",
        latencySub: "Project/Application과 Tenant Chat의 p50, p95, p99 응답 시간",
        p95: "Surface별 p95 지연",
        provider: "Provider별 전체 응답 지연",
        providerSub: "Surface와 Provider별 end-to-end p95 비교",
        slow: "느린 요청 근거",
        slowSub: "선택 기간에서 지연 시간이 가장 긴 요청 4개",
        throughput: "분당 처리량",
        title: "성능",
        viewLogs: "전체 로그"
      }
    : {
        error: "Error rate",
        latency: "Latency trend by surface",
        latencySub: "p50, p95, and p99 response time for Project/Application and Tenant Chat",
        p95: "p95 latency by surface",
        provider: "End-to-end latency by Provider",
        providerSub: "Compare end-to-end p95 by surface and Provider",
        slow: "Slow request evidence",
        slowSub: "Four requests with the highest latency in the selected range",
        throughput: "Throughput per minute",
        title: "Performance",
        viewLogs: "View all logs"
      };
  const surfaceSummaries = performance?.surfaceSummaries ?? [];
  const headlineSurfaceSummaries = surfaceSummaries.filter((row) => row.p95LatencyMs !== null);
  const providerRows = (performance?.p95LatencyByProvider ?? [])
    .filter((row) => row.p95LatencyMs !== null)
    .map((row) => ({
      id: `${row.surface}:${row.provider}`,
      label: `${analyticsSurfaceLabel(row.surface, locale)} · ${row.provider}`,
      value: row.p95LatencyMs ?? 0
    }));

  return (
    <PanelShell
      dataAsOf={performance?.dataFreshness.lastLogCreatedAt ?? undefined}
      dataState={performance ? "live" : "unavailable"}
      locale={locale}
      model={model}
      title={text.title}
    >
      <ExecutiveBand
        accent="performance"
        icon={Gauge}
        lead={{
          label: text.p95,
          value: headlineSurfaceSummaries.length
            ? headlineSurfaceSummaries
                .map((row) => `${analyticsSurfaceShortLabel(row.surface, locale)} ${formatMs(row.p95LatencyMs)}`)
                .join(" · ")
            : "—"
        }}
        metrics={[
          { label: text.throughput, value: formatThroughput(performance?.summary.throughputPerMinute ?? null) },
          { label: text.error, value: formatNullablePercent(performance?.summary.errorRate) }
        ]}
      />

      <div className="analytics-v3-workspace">
        <AnalysisSurface className="analytics-v3-main-canvas" subtitle={text.latencySub} title={text.latency}>
          <ChartOrEmpty hasData={surfaceSummaries.length > 0} locale={locale}>
            <div className="analytics-v3-surface-latency-grid">
              {surfaceSummaries.map((summary) => {
                const points = (performance?.latencyDistribution ?? []).filter(
                  (point) => point.surface === summary.surface
                );
                return (
                  <section className="analytics-v3-surface-latency" key={summary.surface}>
                    <header>
                      <strong>{analyticsSurfaceLabel(summary.surface, locale)}</strong>
                      <span>p95 {formatMs(summary.p95LatencyMs)}</span>
                    </header>
                    <ChartOrEmpty hasData={points.some(hasLatencyPoint)} locale={locale} compact>
                      <AnalyticsLatencyTrendChart
                        ariaLabel={`${text.latency} · ${analyticsSurfaceLabel(summary.surface, locale)}`}
                        points={points}
                      />
                    </ChartOrEmpty>
                  </section>
                );
              })}
            </div>
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
        columns={locale === "ko"
          ? ["요청", "Surface", "모델", "귀속", "지연", "상태"]
          : ["Request", "Surface", "Model", "Attribution", "Latency", "State"]}
        emptyLocale={locale}
        rows={(performance?.slowestRequests ?? []).slice(0, 4).map((row) => ({
          cells: [
            <Link href={`/tenants/${tenantId}/request-logs?requestId=${encodeURIComponent(row.requestId)}`} key="request">
              {shortRequestId(row.requestId)}
            </Link>,
            analyticsSurfaceLabel(row.surface, locale),
            formatModelDisplayName(row.model),
            row.projectId
              ? projectNameById.get(row.projectId) ?? formatDisplayIdentifier(row.projectId)
              : analyticsSurfaceLabel(row.surface, locale),
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
  projectNameById,
  reliability,
  range,
  tenantId
}: ReliabilityPanelProps) {
  const text = locale === "ko"
    ? {
        continuity: "서비스 연속성",
        continuitySub: "Fallback 없는 성공, 복구, 실패, 취소와 정책 제외 경로",
        error: "시스템 오류율",
        fallback: "Fallback 복구율",
        incident: "최근 안정성 근거",
        incidentSub: "Fallback 복구·실패·취소가 발생한 최근 요청",
        outcome: "최종 요청 상태",
        outcomeSub: "모든 요청의 terminal status 분포",
        success: "성공률",
        title: "안정성",
        viewLogs: "전체 로그"
      }
    : {
        continuity: "Service continuity",
        continuitySub: "Success without fallback, recovery, failure, cancellation, and policy-excluded paths",
        error: "System error rate",
        fallback: "Fallback recovery rate",
        incident: "Recent reliability evidence",
        incidentSub: "Recent requests with fallback recovery, failure, or cancellation",
        outcome: "Terminal outcomes",
        outcomeSub: "Terminal status distribution across all requests",
        success: "Success rate",
        title: "Reliability",
        viewLogs: "View all logs"
      };
  const terminalOutcomes: AnalyticsValueRow[] = (reliability?.terminalOutcomes ?? []).map((row) => ({
    id: row.outcome,
    label: row.outcome.replaceAll("_", " ").toUpperCase(),
    value: row.requestCount
  }));
  const continuityPaths: AnalyticsValueRow[] = reliability ? [
    {
      id: "success_without_fallback",
      label: "SUCCESS WITHOUT FALLBACK",
      value: reliability.continuity.successWithoutFallbackCount
    },
    {
      id: "fallback_recovered",
      label: "FALLBACK RECOVERED",
      value: reliability.continuity.fallbackRecoveredCount
    },
    { id: "failed", label: "FAILED", value: reliability.continuity.failedCount },
    { id: "cancelled", label: "CANCELLED", value: reliability.continuity.cancelledCount },
    {
      id: "excluded_policy",
      label: "POLICY EXCLUDED",
      value: reliability.continuity.excludedPolicyCount
    },
    { id: "unknown", label: "UNKNOWN", value: reliability.continuity.unknownCount }
  ] : [];
  const reliabilityRecords = reliability?.recentIncidents ?? [];

  return (
    <PanelShell
      dataAsOf={reliabilityDataAsOf(reliability)}
      dataState={reliabilityDataState(reliability)}
      locale={locale}
      model={model}
      title={text.title}
    >
      <ExecutiveBand
        accent="reliability"
        icon={ShieldCheck}
        lead={{ label: text.success, value: formatNullablePercent(reliability?.rates.successRate) }}
        metrics={[
          { label: text.error, value: formatNullablePercent(reliability?.rates.systemErrorRate) },
          { label: text.fallback, value: formatNullablePercent(reliability?.rates.fallbackRecoveryRate) }
        ]}
      />

      <div className="analytics-v3-workspace">
        <AnalysisSurface className="analytics-v3-main-canvas" subtitle={text.outcomeSub} title={text.outcome}>
          <ChartOrEmpty hasData={hasRows(terminalOutcomes)} locale={locale}>
            <AnalyticsCompositionChart ariaLabel={text.outcome} rows={terminalOutcomes} />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-driver-rail" subtitle={text.continuitySub} title={text.continuity}>
          <ChartOrEmpty hasData={hasRows(continuityPaths)} locale={locale} compact>
            <AnalyticsRankedBarChart ariaLabel={text.continuity} rows={continuityPaths} />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <EvidenceTable
        action={<Link href={`/tenants/${tenantId}/request-logs?range=${range}`}>{text.viewLogs}</Link>}
        columns={locale === "ko" ? ["요청", "프로젝트", "모델", "연속성 결과", "상태"] : ["Request", "Project", "Model", "Continuity", "Status"]}
        emptyLocale={locale}
        rows={reliabilityRecords.map((row) => ({
          cells: [
            <Link href={`/tenants/${tenantId}/request-logs?requestId=${encodeURIComponent(row.requestId)}`} key="request">
              {shortRequestId(row.requestId)}
            </Link>,
            row.surface === "tenant_chat"
              ? "Tenant Chat"
              : projectNameById.get(row.projectId ?? "") ?? formatDisplayIdentifier(row.projectId ?? ""),
            formatModelDisplayName(row.model),
            <ReliabilityBadge incident={row} key="continuity" />,
            <StatusBadge code={row.httpStatus} key="status" status={row.canonicalStatus} />
          ],
          key: row.requestId
        }))}
        subtitle={text.incidentSub}
        title={text.incident}
      />
    </PanelShell>
  );
}

export function AnalyticsSecurityPanel({
  employeeSecurity,
  evidence,
  locale,
  model,
  selectedEmployeeId
}: AnalyticsPanelProps & {
  employeeSecurity: EmployeeSecurityResponse | undefined;
  evidence: AnalyticsSecurityEvidence | undefined;
  selectedEmployeeId: string;
}) {
  const text = locale === "ko"
    ? {
        blocked: "차단 요청",
        employeeProtection: "직원별 보호 처리",
        employeeProtectionSub: "실제 마스킹과 차단 요청 집계",
        employeeRequests: "직원별 전체 요청",
        employeeRequestsSub: "보안 처리 비율의 기준이 되는 실제 귀속 요청",
        detectedTypes: "탐지 유형별 요청",
        detectedTypesEmpty: "최근 보호 요청에 유형별 탐지 근거가 없습니다",
        detectedTypesSub: "최근 보호 요청 Detail에서 확인한 유형별 요청 수",
        masked: "마스킹 요청",
        protected: "보호 처리 요청",
        complete: "Tenant Chat projection 전체 집계",
        mixed: "Project/Application 최근 Detail {sampled}건 + Tenant Chat projection 집계",
        partial: "Tenant Chat projection 부분 집계",
        sampled: "최근 Detail {sampled}/{total}건 기반",
        source: "사용 경로별 보안 근거",
        sourceSub: "전체 프로젝트 범위에는 Tenant Chat을 별도 사용 경로로 포함합니다",
        totalRequests: "전체 요청",
        unavailable: "탐지 유형 근거를 사용할 수 없음",
        treatment: "보안 처리 결과",
        treatmentSub: "선택 기간의 마스킹과 차단 처리량",
        unobserved: "처리 없음/미관측",
        title: "보안"
      }
    : {
        blocked: "Blocked requests",
        employeeProtection: "Protection by employee",
        employeeProtectionSub: "Observed masked and blocked requests",
        employeeRequests: "All requests by employee",
        employeeRequestsSub: "Observed attributed requests used as the security-rate denominator",
        detectedTypes: "Requests by detected type",
        detectedTypesEmpty: "No detector-type evidence is available for recent protected requests",
        detectedTypesSub: "Requests by type observed in recent protected request details",
        masked: "Masked requests",
        protected: "Protected requests",
        complete: "Complete Tenant Chat projection aggregate",
        mixed: "{sampled} recent Project/Application details plus the Tenant Chat projection aggregate",
        partial: "Partial Tenant Chat projection aggregate",
        sampled: "Based on {sampled}/{total} recent details",
        source: "Security evidence by usage surface",
        sourceSub: "The all-projects scope includes Tenant Chat as a separate usage surface",
        totalRequests: "Total requests",
        unavailable: "Detector-type evidence is unavailable",
        treatment: "Security outcomes",
        treatmentSub: "Masked and blocked requests in the selected range",
        unobserved: "NO ACTION / UNOBSERVED",
        title: "Security"
      };
  const maskedRequests = evidence?.maskedRequestCount ?? valueById(model.impact.outcomes, "pii_masked");
  const blockedRequests = evidence?.blockedRequestCount ?? valueById(model.impact.outcomes, "blocked");
  const protectedRequests = maskedRequests + blockedRequests;
  const totalRequests = evidence?.sources?.reduce(
    (total, source) => total + source.totalRequestCount,
    0
  ) ?? model.totalRequests;
  const treatmentRows: AnalyticsValueRow[] = [
    { id: "pii_masked", label: locale === "ko" ? "마스킹" : "MASKED", value: maskedRequests },
    { id: "blocked", label: locale === "ko" ? "차단" : "BLOCKED", value: blockedRequests },
    {
      id: "unobserved",
      label: text.unobserved,
      value: Math.max(0, totalRequests - protectedRequests)
    }
  ];
  const detectedTypeRows = (evidence?.detectedTypeRows ?? []).map((row) => ({
    ...row,
    label: safetyDetectorLabel(row.label, locale)
  }));
  const evidenceSubtitle = evidence
    ? evidence.detectorEvidenceMode === "complete"
      ? text.complete
      : evidence.detectorEvidenceMode === "mixed"
        ? text.mixed.replace("{sampled}", formatInteger(evidence.sampledDetailCount))
        : evidence.detectorEvidenceMode === "partial"
          ? text.partial
          : evidence.detectorEvidenceMode === "unavailable"
            ? text.unavailable
            : text.sampled
                .replace("{sampled}", formatInteger(evidence.sampledDetailCount))
                .replace("{total}", formatInteger(evidence.protectedRequestCount))
    : text.detectedTypesEmpty;
  const employeeRows = selectEmployeeRows(employeeSecurity?.data ?? [], selectedEmployeeId);
  const employeeRequestRows = employeeRows.map((row) => ({
    id: row.employeeId,
    label: employeeLabel(row),
    value: row.total.requestCount
  }));

  return (
    <PanelShell locale={locale} model={model} title={text.title}>
      <ExecutiveBand
        accent="security"
        icon={Shield}
        lead={{
          label: text.protected,
          meta: `${formatInteger(totalRequests)} ${text.totalRequests}`,
          value: formatInteger(protectedRequests)
        }}
        metrics={[
          { label: text.masked, value: formatInteger(maskedRequests) },
          { label: text.blocked, value: formatInteger(blockedRequests) }
        ]}
      />

      <div className="analytics-v3-workspace analytics-v3-security-workspace">
        <AnalysisSurface
          className="analytics-v3-main-canvas"
          metric={`${formatInteger(totalRequests)} ${text.totalRequests}`}
          subtitle={`${text.detectedTypesSub} · ${evidenceSubtitle}`}
          title={text.detectedTypes}
        >
          <ChartOrEmpty hasData={hasRows(detectedTypeRows)} locale={locale}>
            <AnalyticsRankedBarChart
              ariaLabel={text.detectedTypes}
              maxRows={8}
              presentation
              rows={detectedTypeRows}
            />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface
          className="analytics-v3-driver-rail"
          subtitle={text.treatmentSub}
          title={text.treatment}
        >
          <ChartOrEmpty compact hasData={hasRows(treatmentRows)} locale={locale}>
            <AnalyticsCompositionChart ariaLabel={text.treatment} rows={treatmentRows} />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <EvidenceTable
        columns={locale === "ko"
          ? ["사용 경로", "전체 요청", "보호 처리", "마스킹", "차단", "탐지 근거"]
          : ["Usage surface", "Total requests", "Protected", "Masked", "Blocked", "Detector evidence"]}
        emptyLocale={locale}
        rows={(evidence?.sources ?? []).map((source) => ({
          cells: [
            <strong key="surface">{analyticsSurfaceLabel(source.id, locale)}</strong>,
            formatInteger(source.totalRequestCount),
            formatInteger(source.protectedRequestCount),
            formatInteger(source.maskedRequestCount),
            formatInteger(source.blockedRequestCount),
            securityEvidenceModeLabel(source.detectorEvidenceMode, locale)
          ],
          key: source.id
        }))}
        subtitle={text.sourceSub}
        title={text.source}
      />

      <div className="analytics-v3-employee-workspace">
        <AnalysisSurface subtitle={text.employeeProtectionSub} title={text.employeeProtection}>
          <ChartOrEmpty
            hasData={employeeRows.some((row) => row.total.protectedRequestCount > 0)}
            locale={locale}
          >
            <AnalyticsEmployeeStackedChart
              ariaLabel={text.employeeProtection}
              primaryLabel={text.masked}
              rows={employeeRows.map((row) => ({
                id: row.employeeId,
                label: employeeLabel(row),
                primary: row.total.maskedRequestCount,
                secondary: row.total.blockedRequestCount
              }))}
              secondaryLabel={text.blocked}
            />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface subtitle={text.employeeRequestsSub} title={text.employeeRequests}>
          <ChartOrEmpty hasData={hasRows(employeeRequestRows)} locale={locale}>
            <AnalyticsRankedBarChart
              ariaLabel={text.employeeRequests}
              maxRows={10}
              rows={employeeRequestRows}
            />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>
    </PanelShell>
  );
}

export function AnalyticsCachePanel({ locale, model }: AnalyticsPanelProps) {
  const text = locale === "ko"
    ? {
        eligible: "캐시 대상 요청",
        bypass: "캐시 OFF/BYPASS",
        hit: "캐시 적중",
        hitRate: "캐시 적중률",
        outcome: "캐시 처리 경로",
        outcomeSub: "Project/Application과 Tenant Chat의 Exact Cache 결과",
        evidence: "캐시 운영 근거",
        evidenceSub: "사용 경로별 Exact Cache 적중과 대상 요청",
        saved: "절감 비용",
        savedScope: "Project/Application 기록",
        throughput: "캐시 효율",
        throughputSub: "두 사용 경로의 대상 요청과 실제 적중 수",
        totalRequests: "전체 요청",
        title: "캐시"
      }
    : {
        eligible: "Cache eligible",
        bypass: "Cache OFF/BYPASS",
        hit: "Cache hits",
        hitRate: "Cache hit rate",
        outcome: "Cache decision path",
        outcomeSub: "Exact Cache outcomes across Project/Application and Tenant Chat",
        evidence: "Cache operating evidence",
        evidenceSub: "Exact Cache hits and eligible requests by usage surface",
        saved: "Recorded savings",
        savedScope: "Project/Application records",
        throughput: "Cache efficiency",
        throughputSub: "Eligible requests and actual hits across both usage surfaces",
        totalRequests: "Total requests",
        title: "Cache"
      };
  const totalRequests = model.cache.eligibleRequests + model.cache.bypassRequests;
  const efficiencyRows: AnalyticsValueRow[] = [
    { id: "eligible", label: text.eligible, value: model.cache.eligibleRequests },
    { id: "hit", label: text.hit, value: model.cache.hitRequests },
    { id: "bypass", label: text.bypass, value: model.cache.bypassRequests }
  ];

  return (
    <PanelShell locale={locale} model={model} title={text.title}>
      <ExecutiveBand
        accent="cache"
        icon={Database}
        lead={{
          label: text.hitRate,
          meta: `${formatInteger(totalRequests)} ${text.totalRequests} · ${formatInteger(model.cache.bypassRequests)} ${text.bypass}`,
          value: formatPercent(model.cache.hitRate)
        }}
        metrics={[
          {
            label: text.hit,
            meta: `${formatInteger(model.cache.eligibleRequests)} ${text.eligible}`,
            value: formatInteger(model.cache.hitRequests)
          },
          {
            label: text.saved,
            meta: text.savedScope,
            value: model.cache.savedCostMicroUsd === null
              ? "—"
              : formatMicroUsd(model.cache.savedCostMicroUsd)
          }
        ]}
      />

      <div className="analytics-v3-workspace analytics-v3-cache-workspace">
        <AnalysisSurface
          className="analytics-v3-main-canvas"
          metric={`${formatInteger(totalRequests)} ${text.totalRequests}`}
          subtitle={text.outcomeSub}
          title={text.outcome}
        >
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
        columns={locale === "ko"
          ? ["사용 경로", "전체 요청", "적중", "대상 요청", "OFF/BYPASS", "적중률", "절감 비용"]
          : ["Usage surface", "Total requests", "Hits", "Eligible", "OFF/BYPASS", "Hit rate", "Savings"]}
        emptyLocale={locale}
        rows={model.cache.sources.map((row) => ({
          cells: [
            <strong key="surface">{row.label}</strong>,
            formatInteger(row.totalRequests),
            formatInteger(row.hitRequests),
            formatInteger(row.eligibleRequests),
            formatInteger(Math.max(0, row.totalRequests - row.eligibleRequests)),
            formatPercent(row.hitRate),
            row.savedCostMicroUsd === null ? "—" : formatMicroUsd(row.savedCostMicroUsd)
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
  dataAsOf,
  dataState,
  locale,
  model,
  title
}: AnalyticsPanelProps & {
  children: ReactNode;
  dataAsOf?: string | null;
  dataState?: AnalyticsReadModel["dataState"];
  title: string;
}) {
  const resolvedDataState = dataState ?? model.dataState;
  return (
    <section className="analytics-v3-panel">
      <header className="analytics-v3-panel-topline">
        <h2>{title}</h2>
        <div className="analytics-v3-data-state" data-state={resolvedDataState}>
          <i />
          <strong>{stateText[locale][resolvedDataState]}</strong>
          <span>{formatDateTime(dataAsOf === undefined ? model.dataAsOf : dataAsOf)}</span>
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

function StatusBadge({ code, status }: { code: number | null; status: string }) {
  const normalizedCode = code ?? 0;
  const tone = normalizedCode >= 500 || isSystemFailureStatus(status)
    ? "error"
    : normalizedCode >= 400 || status === "cancelled"
      ? "warning"
      : "success";
  return <span className="analytics-v3-status" data-tone={tone}>{code ?? status}</span>;
}

function ReliabilityBadge({ incident }: { incident: AnalyticsReliabilityIncident }) {
  if (incident.fallbackOutcome === "success" && incident.canonicalStatus === "success") {
    return <span className="analytics-v3-status" data-tone="success">FALLBACK RECOVERED</span>;
  }
  if (incident.fallbackOutcome === "failed") {
    return <span className="analytics-v3-status" data-tone="error">FALLBACK FAILED</span>;
  }
  if (incident.fallbackOutcome === "unknown") {
    return <span className="analytics-v3-status" data-tone="warning">FALLBACK UNKNOWN</span>;
  }
  if (incident.canonicalStatus === "cancelled") {
    return <span className="analytics-v3-status" data-tone="warning">CANCELLED</span>;
  }
  return <span className="analytics-v3-status" data-tone="error">FAILED</span>;
}

function reliabilityDataState(reliability: LiveAnalyticsReliability | undefined): AnalyticsReadModel["dataState"] {
  if (!reliability) return "unavailable";
  if (reliability.freshness.queryStatus === "partial") return "partial";
  if (reliability.freshness.queryStatus === "stale") return "stale";
  if (reliability.freshness.queryStatus === "unavailable") return "unavailable";
  return "live";
}

function reliabilityDataAsOf(reliability: LiveAnalyticsReliability | undefined) {
  if (!reliability) return null;
  const sourceEvents = reliability.freshness.sources
    .flatMap((source) => source.lastEventAt ? [source.lastEventAt] : [])
    .sort();
  return sourceEvents[0] ?? reliability.generatedAt;
}

function formatNullablePercent(value: number | null | undefined) {
  return value === null || value === undefined ? "—" : formatPercent(value);
}

function hasRows(rows: AnalyticsValueRow[]) {
  return rows.some((row) => row.value > 0);
}

function selectEmployeeRows<T extends { employeeId: string }>(
  rows: T[],
  selectedEmployeeId: string
) {
  return selectedEmployeeId
    ? rows.filter((row) => row.employeeId === selectedEmployeeId)
    : rows.slice(0, 10);
}

function employeeLabel(row: { email: string; name: string | null }) {
  return row.name?.trim() || row.email;
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
  return value === null ? "—" : `${formatInteger(Math.round(value))} ms`;
}

function formatThroughput(value: number | null) {
  return value === null
    ? "—"
    : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}/min`;
}

function analyticsSurfaceLabel(surface: string, locale: Locale) {
  if (surface === "tenant_chat") {
    return "Tenant Chat";
  }
  return locale === "ko" ? "프로젝트/Application" : "Project/Application";
}

function analyticsSurfaceShortLabel(surface: string, locale: Locale) {
  if (surface === "tenant_chat") {
    return "Chat";
  }
  return locale === "ko" ? "프로젝트" : "Project";
}

function isSystemFailureStatus(status: string) {
  return [
    "failed",
    "provider_failed",
    "provider_timeout",
    "runtime_unavailable",
    "no_eligible_route"
  ].includes(status);
}

function shortRequestId(value: string) {
  return value.length <= 20 ? value : `${value.slice(0, 12)}...${value.slice(-5)}`;
}

function safeRatio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function valueById(rows: AnalyticsValueRow[], id: string) {
  return rows.find((row) => row.id === id)?.value ?? 0;
}

const koreanSafetyDetectorLabels: Record<string, string> = {
  account_number: "계좌번호",
  api_key: "API 키",
  driver_license: "운전면허번호",
  email: "이메일",
  jwt: "JWT",
  passport_number: "여권번호",
  person_name: "이름",
  phone: "전화번호",
  phone_number: "전화번호",
  postal_address: "주소",
  private_key: "개인 키",
  private_url: "비공개 URL",
  resident_registration_number: "주민등록번호",
  secret: "민감 자격 증명"
};

function safetyDetectorLabel(value: string, locale: Locale) {
  if (locale === "ko") {
    return koreanSafetyDetectorLabels[value] ?? formatDisplayIdentifier(value);
  }

  return value
    .split("_")
    .filter(Boolean)
    .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join(" ");
}

function securityEvidenceModeLabel(
  mode: "complete" | "partial" | "sampled" | "unavailable",
  locale: Locale
) {
  const labels = locale === "ko"
    ? {
        complete: "전체 집계",
        partial: "부분 집계",
        sampled: "최근 Detail 표본",
        unavailable: "사용 불가"
      }
    : {
        complete: "Complete aggregate",
        partial: "Partial aggregate",
        sampled: "Recent detail sample",
        unavailable: "Unavailable"
      };
  return labels[mode];
}

function liveRequestOutcome(row: LiveRequestRow) {
  if (row.status === "rate_limited" || row.statusCode === 429) {
    return { kind: "rate_limited", label: "RATE LIMITED" };
  }

  if (row.status === "blocked" || row.safetyAction === "BLOCKED") {
    return { kind: "blocked", label: "BLOCKED" };
  }

  if (row.fallbackUsed) {
    return { kind: "fallback", label: "FALLBACK" };
  }

  if (row.safetyAction === "MASKED" || row.safetyAction === "REDACTED") {
    return { kind: "pii_masked", label: "PII MASKED" };
  }

  if (row.cacheStatus === "HIT") {
    return { kind: "cache_hit", label: "CACHE HIT" };
  }

  return { kind: "routed", label: "ROUTED" };
}

function formatEvidenceTime(value: string, locale: Locale) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(date);
}
