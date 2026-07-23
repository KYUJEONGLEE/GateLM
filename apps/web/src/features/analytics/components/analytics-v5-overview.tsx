import type { ReactNode } from "react";
import type { AnalyticsReadModel } from "@/features/analytics/analytics-read-model";
import {
  AnalyticsV5ModelShareChart,
  AnalyticsV5RoutingDifficultyChart
} from "@/features/analytics/components/analytics-v5-charts";
import { formatDateTime, formatPercent } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type AnalyticsV5OverviewProps = {
  locale: Locale;
  model: AnalyticsReadModel;
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
  locale,
  model
}: AnalyticsV5OverviewProps) {
  const text = locale === "ko"
    ? {
        actualCost: "정책 적용 비용",
        baselineCost: "절감 전 비용 기준",
        completeSavings: "확정 집계",
        empty: "선택한 기간에 표시할 데이터가 없습니다",
        knownBaseline: "확인된 절감분 기준",
        knownSavings: "확인된 절감 비용",
        modelShare: "모델 트래픽 비중",
        partialSavings: "부분 집계",
        routing: "난이도별 라우팅",
        title: "정책 효과"
      }
    : {
        actualCost: "Cost with policy",
        baselineCost: "Pre-savings cost baseline",
        completeSavings: "Complete",
        empty: "No data for the selected range",
        knownBaseline: "Based on recorded savings",
        knownSavings: "Recorded savings",
        modelShare: "Model traffic share",
        partialSavings: "Partial coverage",
        routing: "Routing policy result",
        title: "Policy impact"
      };
  const modelRows = model.impact.modelMix;
  const routingDifficultyRows = model.impact.routingDifficulties;
  const baselineCostMicroUsd = model.cost.totalCostMicroUsd + model.impact.savedCostMicroUsd;
  const baselinePrefix = model.impact.savedCostComplete ? "" : "≥ ";

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
        <article className="analytics-v5-metric">
          <span>{text.actualCost}</span>
          <strong>{formatMicroUsd(model.cost.totalCostMicroUsd)}</strong>
        </article>
        <article className="analytics-v5-metric">
          <span>{text.baselineCost}</span>
          <strong>{baselinePrefix}{formatMicroUsd(baselineCostMicroUsd)}</strong>
          <small>{text.knownBaseline}</small>
        </article>
        <article className="analytics-v5-metric analytics-v5-metric-primary">
          <span>{text.knownSavings}</span>
          <div>
            <strong>{formatMicroUsd(model.impact.savedCostMicroUsd)}</strong>
            <em>
              {model.impact.savedCostComplete
                ? `${formatPercent(model.impact.spendAvoidanceRate)} · ${text.completeSavings}`
                : text.partialSavings}
            </em>
          </div>
        </article>
      </section>

      <div className="analytics-v5-policy-grid">
        <AnalyticsV5Surface title={text.modelShare}>
          {modelRows.some((row) => row.value > 0) ? (
            <AnalyticsV5ModelShareChart
              ariaLabel={text.modelShare}
              locale={locale}
              rows={modelRows}
            />
          ) : <AnalyticsV5Empty label={text.empty} />}
        </AnalyticsV5Surface>
        <AnalyticsV5Surface title={text.routing}>
          {routingDifficultyRows.length ? (
            <AnalyticsV5RoutingDifficultyChart
              ariaLabel={text.routing}
              locale={locale}
              rows={routingDifficultyRows}
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
