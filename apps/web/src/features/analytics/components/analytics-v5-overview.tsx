import type { CSSProperties, ReactNode } from "react";
import type { AnalyticsV5Evidence } from "@/features/analytics/analytics-v5-evidence";
import type { AnalyticsReadModel, AnalyticsValueRow } from "@/features/analytics/analytics-read-model";
import {
  AnalyticsV5ModelShareChart,
  AnalyticsV5ModelTrafficChart
} from "@/features/analytics/components/analytics-v5-charts";
import { formatDisplayIdentifier } from "@/lib/formatting/display-identifiers";
import { formatDateTime, formatInteger, formatPercent } from "@/lib/formatting/formatters";
import type {
  LiveAnalyticsPerformance,
  LiveAnalyticsRange
} from "@/lib/gateway/live-analytics-performance";
import type { Locale } from "@/lib/i18n/locale";

type AnalyticsV5OverviewProps = {
  applicationNameById: Map<string, string>;
  evidence: AnalyticsV5Evidence | undefined;
  locale: Locale;
  model: AnalyticsReadModel;
  performance: LiveAnalyticsPerformance | undefined;
  range: LiveAnalyticsRange;
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

export function AnalyticsV5Overview({
  applicationNameById,
  evidence,
  locale,
  model,
  performance,
  range
}: AnalyticsV5OverviewProps) {
  const text = locale === "ko"
    ? {
        applications: "앱별 사용량",
        applicationsSub: "등록된 애플리케이션의 요청과 비용",
        average: "평균 응답",
        cost: "전체 AI 비용",
        costSub: "선택 기간의 실제 Provider 비용",
        empty: "선택한 기간에 표시할 데이터가 없습니다",
        error: "오류율",
        fallback: "Fallback 복구",
        modelShare: "모델 트래픽 비중",
        modelShareSub: "실제 선택 모델 기준",
        modelTrend: "모델별 요청 흐름",
        modelTrendSub: "라우팅 정책 적용 후 시간대별 요청 추이",
        performance: "응답 성능",
        performanceSub: "선택 기간의 응답 시간 분포",
        policyEvents: "정책 결과",
        requests: "전체 요청",
        requestsSub: "Gateway가 기록한 전체 트래픽",
        saved: "절감",
        success: "성공률",
        title: "정책 효과"
      }
    : {
        applications: "Usage by application",
        applicationsSub: "Requests and cost from registered applications",
        average: "Average response",
        cost: "Total AI spend",
        costSub: "Observed Provider spend for the selected range",
        empty: "No data for the selected range",
        error: "Error rate",
        fallback: "Fallback recoveries",
        modelShare: "Model traffic share",
        modelShareSub: "Based on models actually selected",
        modelTrend: "Requests by model",
        modelTrendSub: "Traffic over time after routing policy",
        performance: "Response performance",
        performanceSub: "Response-time distribution for the selected range",
        policyEvents: "Policy outcomes",
        requests: "Total requests",
        requestsSub: "All traffic recorded by the Gateway",
        saved: "saved",
        success: "success",
        title: "Policy impact"
      };
  const averageLatency = performance?.summary.avgLatencyMs;
  const errorRate = performance?.summary.errorRate ?? model.reliability.systemErrorRate;
  const modelRows = model.impact.modelMix.slice(0, 5);
  const latency = evidence?.latency ?? { p50Ms: 0, p95Ms: 0, p99Ms: 0 };
  const applicationRows = evidence?.applicationUsage ?? [];
  const maxApplicationRequests = Math.max(...applicationRows.map((row) => row.requestCount), 1);
  const maxLatency = Math.max(latency.p99Ms, latency.p95Ms, latency.p50Ms, 1);
  const policyRows = model.impact.outcomes.filter((row) => row.value > 0);

  return (
    <section className="analytics-v5-overview">
      <header className="analytics-v5-panel-heading">
        <h2>{text.title}</h2>
        <div className="analytics-v5-data-state" data-state={model.dataState}>
          <i />
          <strong>{stateText[locale][model.dataState]}</strong>
          <span>{formatDateTime(model.dataAsOf)}</span>
        </div>
      </header>

      <section className="analytics-v5-metric-grid">
        <article className="analytics-v5-metric analytics-v5-metric-primary">
          <span>{text.cost}</span>
          <div>
            <strong>{formatMicroUsd(model.cost.totalCostMicroUsd)}</strong>
            <em>{formatPercent(model.impact.spendAvoidanceRate)} {text.saved}</em>
          </div>
          <small>{text.costSub}</small>
        </article>
        <article className="analytics-v5-metric">
          <span>{text.requests}</span>
          <strong>{formatInteger(model.totalRequests)}</strong>
          <small>{text.requestsSub}</small>
        </article>
        <article className="analytics-v5-metric analytics-v5-response-metric">
          <span>{text.average} · {text.success}</span>
          <div>
            <strong>
              {averageLatency === null || averageLatency === undefined
                ? "—"
                : formatInteger(Math.round(averageLatency))}
              {averageLatency === null || averageLatency === undefined ? null : <small>ms</small>}
            </strong>
            <em>{formatPercent(model.reliability.successRate)}</em>
          </div>
          <small>{text.error} {formatPercent(errorRate)} · {text.fallback} {formatInteger(model.reliability.fallbackSuccesses)}</small>
        </article>
      </section>

      <section aria-label={text.policyEvents} className="analytics-v5-policy-strip">
        <strong>{text.policyEvents}</strong>
        {policyRows.length ? policyRows.map((row) => (
          <PolicyOutcome key={row.id} row={row} />
        )) : <span className="analytics-v5-policy-empty">{text.empty}</span>}
      </section>

      <div className="analytics-v5-primary-grid">
        <AnalyticsV5Surface subtitle={text.modelTrendSub} title={text.modelTrend}>
          {evidence?.modelTraffic.series.some((series) => series.total > 0) ? (
            <AnalyticsV5ModelTrafficChart
              ariaLabel={text.modelTrend}
              evidence={evidence}
              locale={locale}
              range={range}
            />
          ) : <AnalyticsV5Empty label={text.empty} />}
        </AnalyticsV5Surface>
        <AnalyticsV5Surface subtitle={text.modelShareSub} title={text.modelShare}>
          {modelRows.some((row) => row.value > 0) ? (
            <AnalyticsV5ModelShareChart ariaLabel={text.modelShare} rows={modelRows} />
          ) : <AnalyticsV5Empty label={text.empty} />}
        </AnalyticsV5Surface>
      </div>

      <div className="analytics-v5-secondary-grid">
        <AnalyticsV5Surface subtitle={text.performanceSub} title={text.performance}>
          {evidence?.recordCount ? (
            <div className="analytics-v5-latency-list">
              <LatencyRow label="p50" max={maxLatency} value={latency.p50Ms} />
              <LatencyRow label="p95" max={maxLatency} tone="warning" value={latency.p95Ms} />
              <LatencyRow label="p99" max={maxLatency} tone="danger" value={latency.p99Ms} />
              <div className="analytics-v5-error-rate">
                <span>{text.error}</span>
                <strong>{formatPercent(errorRate)}</strong>
              </div>
            </div>
          ) : <AnalyticsV5Empty label={text.empty} />}
        </AnalyticsV5Surface>

        <AnalyticsV5Surface subtitle={text.applicationsSub} title={text.applications}>
          {applicationRows.length ? (
            <ol className="analytics-v5-application-list">
              {applicationRows.map((row, index) => (
                <li key={row.applicationId}>
                  <strong>{applicationNameById.get(row.applicationId) ?? formatDisplayIdentifier(row.applicationId)}</strong>
                  <div><i style={{ "--analytics-v5-share": `${Math.max(4, (row.requestCount / maxApplicationRequests) * 100)}%` } as CSSProperties} /></div>
                  <span>{formatInteger(row.requestCount)} · {formatMicroUsd(row.costMicroUsd)}</span>
                  <em>{index + 1}</em>
                </li>
              ))}
            </ol>
          ) : <AnalyticsV5Empty label={text.empty} />}
        </AnalyticsV5Surface>
      </div>
    </section>
  );
}

function AnalyticsV5Surface({
  children,
  subtitle,
  title
}: {
  children: ReactNode;
  subtitle: string;
  title: string;
}) {
  return (
    <section className="analytics-v5-surface">
      <header>
        <h3>{title}</h3>
        <p>{subtitle}</p>
      </header>
      {children}
    </section>
  );
}

function LatencyRow({
  label,
  max,
  tone = "normal",
  value
}: {
  label: string;
  max: number;
  tone?: "danger" | "normal" | "warning";
  value: number;
}) {
  return (
    <div className="analytics-v5-latency-row" data-tone={tone}>
      <div><span>{label}</span><strong>{formatInteger(Math.round(value))}<small>ms</small></strong></div>
      <i><b style={{ "--analytics-v5-share": `${Math.max(3, (value / max) * 100)}%` } as CSSProperties} /></i>
    </div>
  );
}

function PolicyOutcome({ row }: { row: AnalyticsValueRow }) {
  return (
    <span className="analytics-v5-policy-outcome" data-kind={row.id}>
      {row.label}
      <b>{formatInteger(row.value)}</b>
    </span>
  );
}

function AnalyticsV5Empty({ label }: { label: string }) {
  return <div className="analytics-v5-empty">{label}</div>;
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
