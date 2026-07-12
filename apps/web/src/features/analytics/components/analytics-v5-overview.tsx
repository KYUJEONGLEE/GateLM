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
  LiveAnalyticsRange
} from "@/lib/gateway/live-analytics-performance";
import type { Locale } from "@/lib/i18n/locale";

type AnalyticsV5OverviewProps = {
  evidence: AnalyticsV5Evidence | undefined;
  locale: Locale;
  model: AnalyticsReadModel;
  projectNameById: Map<string, string>;
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
  evidence,
  locale,
  model,
  projectNameById,
  range
}: AnalyticsV5OverviewProps) {
  const text = locale === "ko"
    ? {
        projects: "프로젝트별 사용량",
        projectsSub: "프로젝트에 귀속된 요청과 비용",
        balanced: "균형",
        cost: "전체 AI 비용",
        costSub: "선택 기간의 실제 Provider 비용",
        empty: "선택한 기간에 표시할 데이터가 없습니다",
        highQuality: "고품질",
        lowCost: "저비용 라우팅",
        lowCostSub: "정책이 선택한 모델 등급 비교",
        modelShare: "모델 트래픽 비중",
        modelShareSub: "실제 선택 모델 기준",
        modelTrend: "모델별 요청 흐름",
        modelTrendSub: "라우팅 정책 적용 후 시간대별 요청 추이",
        routing: "모델 등급별 라우팅",
        routingSub: "고품질·균형·저비용 경로의 실제 요청 비중",
        policyEvents: "정책 결과",
        requests: "전체 요청",
        requestsSub: "Gateway가 기록한 전체 트래픽",
        saved: "절감",
        title: "정책 효과"
      }
    : {
        projects: "Usage by project",
        projectsSub: "Requests and cost attributed to projects",
        balanced: "Balanced",
        cost: "Total AI spend",
        costSub: "Observed Provider spend for the selected range",
        empty: "No data for the selected range",
        highQuality: "High quality",
        lowCost: "Low-cost routing",
        lowCostSub: "Compare model tiers selected by policy",
        modelShare: "Model traffic share",
        modelShareSub: "Based on models actually selected",
        modelTrend: "Requests by model",
        modelTrendSub: "Traffic over time after routing policy",
        routing: "Routing by model tier",
        routingSub: "Observed high-quality, balanced, and low-cost routing share",
        policyEvents: "Policy outcomes",
        requests: "Total requests",
        requestsSub: "All traffic recorded by the Gateway",
        saved: "saved",
        title: "Policy impact"
      };
  const modelRows = model.impact.modelMix.slice(0, 5);
  const projectCostById = new Map(model.cost.costByProject.map((row) => [row.id, row.value]));
  const projectRows = model.usage.projectMix.slice(0, 5).map((row) => ({
    costMicroUsd: projectCostById.get(row.id) ?? 0,
    projectId: row.id,
    requestCount: row.value
  }));
  const maxProjectRequests = Math.max(...projectRows.map((row) => row.requestCount), 1);
  const policyRows = model.impact.outcomes.filter((row) => row.value > 0);
  const routingTierRows = model.impact.routingTiers;
  const routedRequests = routingTierRows.reduce((sum, row) => sum + row.value, 0);
  const lowCostRequests = valueById(routingTierRows, "low_cost");

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
          <span>{text.lowCost}</span>
          <div>
            <strong>{formatPercent(safeRatio(lowCostRequests, routedRequests))}</strong>
            <em>{formatInteger(lowCostRequests)}</em>
          </div>
          <small>{text.lowCostSub}</small>
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
        <AnalyticsV5Surface subtitle={text.routingSub} title={text.routing}>
          {routingTierRows.length ? (
            <div className="analytics-v5-routing-tier-list">
              {routingTierRows.map((row) => (
                <RoutingTierRow key={row.id} row={row} total={routedRequests} />
              ))}
            </div>
          ) : <AnalyticsV5Empty label={text.empty} />}
        </AnalyticsV5Surface>

        <AnalyticsV5Surface subtitle={text.projectsSub} title={text.projects}>
          {projectRows.length ? (
            <ol className="analytics-v5-project-list">
              {projectRows.map((row, index) => (
                <li key={row.projectId}>
                  <strong>{projectNameById.get(row.projectId) ?? formatDisplayIdentifier(row.projectId)}</strong>
                  <div><i style={{ "--analytics-v5-share": `${Math.max(4, (row.requestCount / maxProjectRequests) * 100)}%` } as CSSProperties} /></div>
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

function RoutingTierRow({ row, total }: { row: AnalyticsValueRow; total: number }) {
  const share = safeRatio(row.value, total);

  return (
    <div className="analytics-v5-routing-tier-row" data-tier={row.id}>
      <div>
        <span>{row.label}</span>
        <strong>{formatInteger(row.value)}<small>{formatPercent(share)}</small></strong>
      </div>
      <i><b style={{ "--analytics-v5-share": `${Math.max(3, share * 100)}%` } as CSSProperties} /></i>
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

function safeRatio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function valueById(rows: AnalyticsValueRow[], id: string) {
  return rows.find((row) => row.id === id)?.value ?? 0;
}
