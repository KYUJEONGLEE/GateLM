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
  AnalyticsCostAttributionChart,
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
import {
  resolveProviderDisplay,
  type ProviderDisplayDirectory
} from "@/lib/control-plane/provider-display";
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
  providerDirectory: ProviderDisplayDirectory;
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
          {
            label: text.active,
            value: locale === "ko"
              ? `${formatInteger(model.usage.activeModels)}건`
              : formatInteger(model.usage.activeModels)
          }
        ]}
      />

      <div className="analytics-v3-workspace">
        <AnalysisSurface className="analytics-v3-main-canvas" title={text.trend}>
          <ChartOrEmpty
            hasData={model.usage.requestVolume.some((point) => point.requests > 0)}
            locale={locale}
          >
            <AnalyticsRequestVolumeChart ariaLabel={text.trend} points={model.usage.requestVolume} />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-driver-rail" title={text.model}>
          <ChartOrEmpty hasData={hasRows(model.usage.requestsByModel)} locale={locale} compact>
            <AnalyticsRankedBarChart ariaLabel={text.model} orientation="vertical" rows={model.usage.requestsByModel} />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <div className="analytics-v3-employee-workspace">
        <AnalysisSurface title={text.employeeTokens}>
          <ChartOrEmpty hasData={hasRows(employeeTokenRows)} locale={locale}>
            <AnalyticsEmployeeTokenBarChart
              ariaLabel={text.employeeTokens}
              rows={employeeTokenRows}
            />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface title={text.employeeSources}>
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
        byModel: "비용 기여 모델",
        byModelSub: "실제 Provider 비용이 높은 모델",
        byProject: "비용 사용처",
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
        byModel: "Cost contributors",
        byModelSub: "Models contributing the most Provider spend",
        byProject: "Where spend occurred",
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
  const attributionChartRows = attributionRows.map((row) => ({
    id: row.id,
    label: row.kind === "project"
      ? projectNameById.get(row.projectId) ?? formatDisplayIdentifier(row.label)
      : row.label,
    value: row.value
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
        <AnalysisSurface className="analytics-v3-main-canvas" title={text.trend}>
          <ChartOrEmpty
            hasData={Boolean(costTrend?.points.some((point) => point.spendUsd > 0))}
            locale={locale}
          >
            <AnalyticsCostTrendChart ariaLabel={text.trend} points={costTrend?.points ?? []} />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-driver-rail" title={text.byModel}>
          <ChartOrEmpty hasData={hasRows(model.cost.costByModel)} locale={locale} compact>
            <AnalyticsRankedBarChart
              ariaLabel={text.byModel}
              kind="micro-usd"
              microUsdMaximumFractionDigits={2}
              orientation="vertical"
              rows={model.cost.costByModel}
              valueLabelFontSize={12}
            />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <div className="analytics-v3-employee-workspace">
        <AnalysisSurface title={text.employeeCost}>
          <ChartOrEmpty hasData={hasRows(employeeCostRows)} locale={locale}>
            <AnalyticsRankedBarChart
              ariaLabel={text.employeeCost}
              kind="micro-usd"
              maxRows={10}
              microUsdMaximumFractionDigits={2}
              orientation="vertical"
              rows={employeeCostRows}
              valueLabelFontSize={12}
            />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-cost-attribution" title={text.byProject}>
          <ChartOrEmpty hasData={hasRows(attributionChartRows)} locale={locale}>
            <AnalyticsCostAttributionChart
              ariaLabel={text.byProject}
              rows={attributionChartRows}
              totalLabel={locale === "ko" ? "총 비용" : "Total spend"}
            />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>
    </PanelShell>
  );
}

export function AnalyticsPerformancePanel({
  locale,
  model,
  performance,
  projectNameById,
  providerDirectory,
  range,
  tenantId
}: PerformancePanelProps) {
  const text = locale === "ko"
    ? {
        error: "오류율",
        latency: "응답 지연 추이",
        percentile: "지연 시간 백분위 선택",
        p95: "전체 p95 지연",
        provider: "모델별 전체 응답 지연",
        slow: "최장 지연 요청",
        slowSub: "선택 기간에서 지연 시간이 가장 긴 요청 4개",
        throughput: "분당 처리량",
        title: "성능",
        viewLogs: "전체 로그"
      }
    : {
        error: "Error rate",
        latency: "Response latency trend",
        percentile: "Select latency percentile",
        p95: "Overall p95 latency",
        provider: "End-to-end latency by model",
        slow: "Longest latency requests",
        slowSub: "Four requests with the highest latency in the selected range",
        throughput: "Throughput per minute",
        title: "Performance",
        viewLogs: "View all logs"
      };
  const surfaceSummaries = performance?.surfaceSummaries ?? [];
  const latencyPoints = performance?.latencyDistribution ?? [];
  const latencySurfaces = surfaceSummaries.map((summary) => ({
    label: analyticsSurfaceLabel(summary.surface, locale),
    surface: summary.surface
  }));
  const modelLatencyRows = (performance?.providerModelPerformance ?? [])
    .filter((row) => row.p95LatencyMs !== null)
    .map((row) => ({
      id: `${row.surface}:${row.provider}:${row.model}`,
      label: `${providerDisplayLabel(providerDirectory, row.provider)} · ${formatModelDisplayName(row.model)}`,
      value: row.p95LatencyMs ?? 0
    }));
  const providerRows = modelLatencyRows.length > 0
    ? modelLatencyRows
    : (performance?.p95LatencyByProvider ?? [])
        .filter((row) => row.p95LatencyMs !== null)
        .map((row) => ({
          id: `${row.surface}:${row.provider}`,
          label: providerDisplayLabel(providerDirectory, row.provider),
          value: row.p95LatencyMs ?? 0
        }));
  const availableSurfaceP95 = surfaceSummaries
    .flatMap((row) => row.p95LatencyMs == null ? [] : [row.p95LatencyMs]);
  const overallP95 = performance?.summary.p95LatencyMs
    ?? (availableSurfaceP95.length > 0 ? Math.max(...availableSurfaceP95) : null);

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
          value: formatMs(overallP95)
        }}
        metrics={[
          { label: text.throughput, value: formatThroughput(performance?.summary.throughputPerMinute ?? null) },
          { label: text.error, value: formatNullablePercent(performance?.summary.errorRate) }
        ]}
      />

      <div className="analytics-v3-workspace">
        <AnalysisSurface className="analytics-v3-main-canvas" title={text.latency}>
          <ChartOrEmpty hasData={latencyPoints.some(hasLatencyPoint)} locale={locale}>
            <AnalyticsLatencyTrendChart
              ariaLabel={text.latency}
              percentileLabel={text.percentile}
              points={latencyPoints}
              surfaces={latencySurfaces}
            />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-driver-rail" title={text.provider}>
          <ChartOrEmpty hasData={hasRows(providerRows)} locale={locale} compact>
            <AnalyticsRankedBarChart ariaLabel={text.provider} kind="milliseconds" orientation="vertical" rows={providerRows} />
          </ChartOrEmpty>
        </AnalysisSurface>
      </div>

      <EvidenceTable
        action={<Link href={`/tenants/${tenantId}/request-logs?range=${range}`}>{text.viewLogs}</Link>}
        columns={locale === "ko"
          ? ["요청", "사용 경로", "모델", "귀속", "지연", "상태"]
          : ["Request", "Usage path", "Model", "Attribution", "Latency", "State"]}
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
        <AnalysisSurface className="analytics-v3-main-canvas" title={text.outcome}>
          <ChartOrEmpty hasData={hasRows(terminalOutcomes)} locale={locale}>
            <AnalyticsCompositionChart ariaLabel={text.outcome} rows={terminalOutcomes} />
          </ChartOrEmpty>
        </AnalysisSurface>
        <AnalysisSurface className="analytics-v3-driver-rail" title={text.continuity}>
          <ChartOrEmpty hasData={hasRows(continuityPaths)} locale={locale} compact>
            <AnalyticsRankedBarChart ariaLabel={text.continuity} orientation="vertical" rows={continuityPaths} />
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
        employeeSources: "사용 경로별 보호 처리",
        detectedTypes: "탐지 유형별 요청",
        detectedTypesEmpty: "최근 보호 요청에 유형별 탐지 근거가 없습니다",
        detectedTypesSub: "최근 보호 요청 Detail에서 확인한 유형별 요청 수",
        masked: "마스킹 요청",
        protected: "보호 처리 요청",
        totalRequests: "전체 요청",
        treatment: "보안 처리 요약",
        treatmentRate: "보호 처리율",
        treatmentSub: "선택 기간의 마스킹과 차단 처리량",
        unobserved: "처리 없음/미관측",
        title: "보안"
      }
    : {
        blocked: "Blocked requests",
        employeeProtection: "Protection by employee",
        employeeProtectionSub: "Observed masked and blocked requests",
        employeeSources: "Protection by usage surface",
        detectedTypes: "Requests by detected type",
        detectedTypesEmpty: "No detector-type evidence is available for recent protected requests",
        detectedTypesSub: "Requests by type observed in recent protected request details",
        masked: "Masked requests",
        protected: "Protected requests",
        totalRequests: "Total requests",
        treatment: "Security summary",
        treatmentRate: "Protection rate",
        treatmentSub: "Masked and blocked requests in the selected range",
        unobserved: "NO ACTION / UNOBSERVED",
        title: "Security"
      };
  const maskedRequests = evidence?.maskedRequestCount ?? valueById(model.impact.outcomes, "pii_masked");
  const blockedRequests = evidence?.blockedRequestCount ?? valueById(model.impact.outcomes, "blocked");
  const protectedRequests = maskedRequests + blockedRequests;
  const securitySources = evidence?.sources ?? [];
  const totalRequests = securitySources.length > 0
    ? securitySources.reduce(
        (total, source) => total + source.totalRequestCount,
        0
      )
    : model.totalRequests;
  const formatRequestCount = (value: number) => locale === "ko"
    ? `${formatInteger(value)}건`
    : formatInteger(value);
  const detectedTypeRows = (evidence?.detectedTypeRows ?? []).map((row) => ({
    ...row,
    label: safetyDetectorLabel(row.label, locale)
  }));
  const employeeRows = selectEmployeeRows(employeeSecurity?.data ?? [], selectedEmployeeId);
  const selectedEmployeeLabel = selectedEmployeeId && employeeRows[0]
    ? employeeLabel(employeeRows[0])
    : "";
  const employeeProtectionTitle = selectedEmployeeLabel
    ? locale === "ko"
      ? `${selectedEmployeeLabel} 보호 처리`
      : `Protection for ${selectedEmployeeLabel}`
    : text.employeeProtection;
  const employeeSourcesTitle = selectedEmployeeLabel
    ? locale === "ko"
      ? `${selectedEmployeeLabel} 사용 경로별 보호 처리`
      : `Protection surfaces for ${selectedEmployeeLabel}`
    : text.employeeSources;
  const employeeSourceRows = [
    {
      id: "project_application",
      label: locale === "ko" ? "프로젝트/Application" : "Project/Application",
      primary: employeeRows.reduce(
        (sum, row) => sum + row.sources.projectApplication.maskedRequestCount,
        0
      ),
      secondary: employeeRows.reduce(
        (sum, row) => sum + row.sources.projectApplication.blockedRequestCount,
        0
      )
    },
    {
      id: "tenant_chat",
      label: "Tenant Chat",
      primary: employeeRows.reduce(
        (sum, row) => sum + row.sources.tenantChat.maskedRequestCount,
        0
      ),
      secondary: employeeRows.reduce(
        (sum, row) => sum + row.sources.tenantChat.blockedRequestCount,
        0
      )
    }
  ];

  return (
    <PanelShell locale={locale} model={model} title={text.title}>
      <ExecutiveBand
        accent="security"
        icon={Shield}
        lead={{
          label: text.protected,
          meta: `${formatRequestCount(totalRequests)} ${text.totalRequests}`,
          value: formatRequestCount(protectedRequests)
        }}
        metrics={[
          { label: text.masked, value: formatRequestCount(maskedRequests) },
          { label: text.blocked, value: formatRequestCount(blockedRequests) }
        ]}
      />

      <div className="analytics-v3-workspace analytics-v3-security-workspace">
        <AnalysisSurface
          className="analytics-v3-main-canvas"
          metric={`${formatInteger(totalRequests)} ${text.totalRequests}`}
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
          title={text.treatment}
        >
          <div className="analytics-v3-security-summary">
            <article>
              <span>{text.treatmentRate}</span>
              <strong>{formatPercent(safeRatio(protectedRequests, totalRequests))}</strong>
            </article>
            <article>
              <span>{text.masked}</span>
              <strong>{formatRequestCount(maskedRequests)}</strong>
            </article>
            <article>
              <span>{text.blocked}</span>
              <strong>{formatRequestCount(blockedRequests)}</strong>
            </article>
          </div>
        </AnalysisSurface>
      </div>

      <div className="analytics-v3-employee-workspace">
        <AnalysisSurface title={employeeProtectionTitle}>
          <ChartOrEmpty
            hasData={employeeRows.some((row) => row.total.protectedRequestCount > 0)}
            locale={locale}
          >
            <AnalyticsEmployeeStackedChart
              ariaLabel={employeeProtectionTitle}
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
        <AnalysisSurface title={employeeSourcesTitle}>
          <ChartOrEmpty
            hasData={employeeSourceRows.some((row) => row.primary > 0 || row.secondary > 0)}
            locale={locale}
          >
            <AnalyticsEmployeeStackedChart
              ariaLabel={employeeSourcesTitle}
              primaryLabel={text.masked}
              rows={employeeSourceRows}
              secondaryLabel={text.blocked}
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
        miss: "캐시 미적중",
        outcome: "캐시 성과",
        saved: "절감 비용",
        totalRequests: "전체 요청",
        title: "캐시"
      }
    : {
        eligible: "Cache eligible",
        bypass: "Cache OFF/BYPASS",
        hit: "Cache hits",
        hitRate: "Cache hit rate",
        miss: "Cache misses",
        outcome: "Cache performance",
        saved: "Recorded savings",
        totalRequests: "Total requests",
        title: "Cache"
      };
  const totalRequests = model.cache.eligibleRequests + model.cache.bypassRequests;
  const missRequests = Math.max(0, model.cache.eligibleRequests - model.cache.hitRequests);
  const hitRate = Math.min(1, Math.max(0, model.cache.hitRate));
  const cacheOutcomeRows = [
    { id: "hit", label: text.hit, value: model.cache.hitRequests },
    { id: "miss", label: text.miss, value: missRequests },
    { id: "bypass", label: text.bypass, value: model.cache.bypassRequests }
  ];

  return (
    <PanelShell locale={locale} model={model} title={text.title}>
      <ExecutiveBand
        accent="cache"
        icon={Database}
        lead={{
          label: text.hitRate,
        value: formatPercent(model.cache.hitRate)
        }}
        metrics={[
          {
            label: text.hit,
            value: locale === "ko"
              ? `${formatInteger(model.cache.hitRequests)}건`
              : formatInteger(model.cache.hitRequests)
          },
          {
            label: text.saved,
            value: model.cache.savedCostMicroUsd === null
              ? "—"
              : formatMicroUsd(model.cache.savedCostMicroUsd)
          }
        ]}
      />

      <section className="analytics-v3-cache-insight">
        <div className="analytics-v3-section-heading">
          <div>
            <h3>{text.outcome}</h3>
          </div>
          <strong>{formatInteger(totalRequests)} {text.totalRequests}</strong>
        </div>
        <div className="analytics-v3-cache-insight-body">
          <div
            aria-label={`${text.hitRate} ${formatPercent(hitRate)}`}
            className="analytics-v3-cache-ring"
            role="img"
            style={{ "--analytics-cache-angle": `${hitRate * 360}deg` } as CSSProperties}
          >
            <div>
              <span>{text.hitRate}</span>
              <strong>{formatPercent(hitRate)}</strong>
            </div>
          </div>
          <div className="analytics-v3-cache-outcomes">
            {cacheOutcomeRows.map((row) => (
              <article data-kind={row.id} key={row.id}>
                <span>{row.label}</span>
                <strong>
                  {locale === "ko" ? `${formatInteger(row.value)}건` : formatInteger(row.value)}
                </strong>
              </article>
            ))}
          </div>
        </div>
      </section>
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
  subtitle?: string;
  title: string;
}) {
  return (
    <section className={`analytics-v3-analysis-surface ${className}`.trim()}>
      <div className="analytics-v3-section-heading">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
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
  subtitle?: string;
  title: string;
  total: number;
}) {
  const visibleRows = rows.filter((row) => row.value > 0);

  return (
    <section className="analytics-v3-decision-path">
      <div className="analytics-v3-section-heading">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
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
  subtitle?: string;
  title: string;
}) {
  return (
    <section className="analytics-v3-evidence-table">
      <div className="analytics-v3-section-heading">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
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

function providerDisplayLabel(
  directory: ProviderDisplayDirectory,
  providerId: string
) {
  return resolveProviderDisplay(directory, providerId)?.name
    ?? formatDisplayIdentifier(providerId);
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
