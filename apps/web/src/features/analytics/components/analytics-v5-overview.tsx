import type { ReactNode } from "react";
import type { AnalyticsV5Evidence } from "@/features/analytics/analytics-v5-evidence";
import type { AnalyticsReadModel } from "@/features/analytics/analytics-read-model";
import {
  AnalyticsV5ModelShareChart,
  AnalyticsV5ModelTrafficChart,
  AnalyticsV5ProjectUsageChart,
  AnalyticsV5RoutingDifficultyChart
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
        complex: "고성능 요청",
        cost: "전체 AI 비용",
        empty: "선택한 기간에 표시할 데이터가 없습니다",
        modelShare: "모델 트래픽 비중",
        modelTrend: "모델별 요청 흐름",
        routing: "난이도별 라우팅",
        requests: "전체 요청",
        saved: "절감",
        title: "정책 효과"
      }
    : {
        projects: "Usage by source",
        complex: "High-performance requests",
        cost: "Total AI spend",
        empty: "No data for the selected range",
        modelShare: "Model traffic share",
        modelTrend: "Requests by model",
        routing: "Routing policy result",
        requests: "Total requests",
        saved: "saved",
        title: "Policy impact"
      };
  const modelRows = model.impact.modelMix.slice(0, 5);
  const projectCostById = new Map(model.cost.costByProject.map((row) => [row.id, row.value]));
  const projectRows = model.usage.projectMix.slice(0, 5).map((row) => ({
    costMicroUsd: projectCostById.get(row.id) ?? 0,
    id: row.id,
    label: row.id === "surface:tenant_chat"
      ? "Tenant Chat"
      : projectNameById.get(row.id) ?? formatDisplayIdentifier(row.id),
    requestCount: row.value
  }));
  const routingDifficultyRows = model.impact.routingDifficulties;
  const routedRequests = model.impact.highPerformanceEligibleRequests;
  const highPerformanceRequests = model.impact.highPerformanceRequests;

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
            <em>{model.impact.savedCostComplete
              ? `${formatPercent(model.impact.spendAvoidanceRate)} ${text.saved}`
              : `— ${text.saved}`}</em>
          </div>
        </article>
        <article className="analytics-v5-metric">
          <span>{text.requests}</span>
          <strong>{formatInteger(model.totalRequests)}</strong>
        </article>
        <article className="analytics-v5-metric analytics-v5-response-metric">
          <span>{text.complex}</span>
          <div>
            <strong>{formatPercent(safeRatio(highPerformanceRequests, routedRequests))}</strong>
            <em>{formatRequestCount(highPerformanceRequests, locale)}</em>
          </div>
        </article>
      </section>

      <div className="analytics-v5-primary-grid">
        <AnalyticsV5Surface title={text.modelTrend}>
          {evidence?.modelTraffic?.series?.some((series) => series.total > 0) ? (
            <AnalyticsV5ModelTrafficChart
              ariaLabel={text.modelTrend}
              evidence={evidence}
              locale={locale}
              range={range}
            />
          ) : <AnalyticsV5Empty label={text.empty} />}
        </AnalyticsV5Surface>
        <AnalyticsV5Surface title={text.modelShare}>
          {modelRows.some((row) => row.value > 0) ? (
            <AnalyticsV5ModelShareChart ariaLabel={text.modelShare} rows={modelRows} />
          ) : <AnalyticsV5Empty label={text.empty} />}
        </AnalyticsV5Surface>
      </div>

      <div className="analytics-v5-secondary-grid">
        <AnalyticsV5Surface title={text.routing}>
          {routingDifficultyRows.length ? (
            <AnalyticsV5RoutingDifficultyChart
              ariaLabel={text.routing}
              locale={locale}
              rows={routingDifficultyRows}
            />
          ) : <AnalyticsV5Empty label={text.empty} />}
        </AnalyticsV5Surface>

        <AnalyticsV5Surface title={text.projects}>
          {projectRows.length ? (
            <AnalyticsV5ProjectUsageChart
              ariaLabel={text.projects}
              locale={locale}
              rows={projectRows}
            />
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
  subtitle?: string;
  title: string;
}) {
  return (
    <section className="analytics-v5-surface">
      <header>
        <h3>{title}</h3>
        {subtitle ? <p>{subtitle}</p> : null}
      </header>
      {children}
    </section>
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

function formatRequestCount(value: number, locale: Locale) {
  const formattedValue = formatInteger(value);
  return locale === "ko" ? `${formattedValue}건` : `${formattedValue} requests`;
}
