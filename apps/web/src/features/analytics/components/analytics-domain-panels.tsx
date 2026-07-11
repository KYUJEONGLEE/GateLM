import {
  Activity,
  Coins,
  Database,
  Gauge,
  Layers3,
  ShieldCheck,
  Sparkles,
  Zap
} from "lucide-react";
import type { ReactNode } from "react";
import {
  AnalyticsDomainBarChart,
  AnalyticsDomainDonutChart,
  type AnalyticsChartValueKind,
  type AnalyticsDomainChartRow
} from "@/features/analytics/components/analytics-domain-charts";
import type { AnalyticsOverviewReadModel } from "@/features/analytics/analytics-overview-read-model";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import { formatDisplayIdentifier } from "@/lib/formatting/display-identifiers";
import { formatDateTime, formatInteger, formatPercent } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type DomainPanelProps = {
  locale: Locale;
  model: AnalyticsOverviewReadModel;
  projects?: ProjectRecord[];
};

const stateLabels: Record<Locale, Record<AnalyticsOverviewReadModel["dataState"], string>> = {
  en: {
    live: "LIVE EVIDENCE",
    partial: "PARTIAL DATA",
    stale: "STALE DATA",
    unavailable: "AWAITING DATA"
  },
  ko: {
    live: "LIVE EVIDENCE",
    partial: "PARTIAL DATA",
    stale: "STALE DATA",
    unavailable: "AWAITING DATA"
  }
};

export function AnalyticsUsagePanel({ locale, model }: DomainPanelProps) {
  const text = locale === "ko"
    ? {
        intro: "요청과 토큰이 어떤 모델에 분산되는지 확인합니다.",
        metrics: ["전체 요청", "전체 토큰", "사용 모델"],
        title: "사용량 분석",
        charts: [
          ["모델별 요청량", "라우팅된 모델별 요청 수", "모델별 요청량"],
          ["토큰 구성", "Prompt와 Completion 토큰 비중", "토큰 구성"]
        ]
      }
    : {
        intro: "See how requests and tokens are distributed across routed models.",
        metrics: ["Total requests", "Total tokens", "Active models"],
        title: "Usage analytics",
        charts: [
          ["Requests by model", "Request volume by routed model", "Requests by model"],
          ["Token mix", "Prompt and completion token share", "Token mix"]
        ]
      };

  return (
    <AnalyticsDomainPanelShell intro={text.intro} locale={locale} model={model} title={text.title}>
      <AnalyticsDomainMetricGrid
        metrics={[
          { icon: Activity, label: text.metrics[0], tone: "green", value: formatInteger(model.usage.totalRequests) },
          { icon: Layers3, label: text.metrics[1], tone: "blue", value: formatInteger(model.usage.totalTokens) },
          { icon: Sparkles, label: text.metrics[2], tone: "violet", value: formatInteger(model.usage.activeModels) }
        ]}
      />
      <AnalyticsDomainChartGrid>
        <DomainChartCard
          ariaLabel={text.charts[0][2]}
          emptyText={emptyText(locale)}
          rows={model.usage.requestsByModel}
          subtitle={text.charts[0][1]}
          title={text.charts[0][0]}
          type="bar"
          valueKind="count"
        />
        <DomainChartCard
          ariaLabel={text.charts[1][2]}
          emptyText={emptyText(locale)}
          rows={model.usage.tokenMix}
          subtitle={text.charts[1][1]}
          title={text.charts[1][0]}
          type="donut"
          valueKind="tokens"
        />
      </AnalyticsDomainChartGrid>
    </AnalyticsDomainPanelShell>
  );
}

export function AnalyticsCostPanel({ locale, model, projects = [] }: DomainPanelProps) {
  const text = locale === "ko"
    ? {
        intro: "실제 Gateway 비용과 캐시 절감 근거를 비교합니다.",
        metrics: ["총 비용", "절감 비용", "요청당 비용"],
        title: "비용 분석",
        charts: [
          ["모델별 비용", "Provider 비용이 발생한 상위 모델", "모델별 비용"],
          ["프로젝트별 비용", "프로젝트에 귀속된 비용", "프로젝트별 비용"]
        ]
      }
    : {
        intro: "Compare actual Gateway spend with recorded cache savings.",
        metrics: ["Total cost", "Saved cost", "Cost per request"],
        title: "Cost analytics",
        charts: [
          ["Cost by model", "Top models with Provider spend", "Cost by model"],
          ["Cost by project", "Spend attributed to projects", "Cost by project"]
        ]
      };
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));
  const projectRows = model.cost.costByProject.map((row) => ({
    ...row,
    label: projectNameById.get(row.id) ?? formatDisplayIdentifier(row.label)
  }));

  return (
    <AnalyticsDomainPanelShell intro={text.intro} locale={locale} model={model} title={text.title}>
      <AnalyticsDomainMetricGrid
        metrics={[
          { icon: Coins, label: text.metrics[0], tone: "green", value: formatMicroUsd(model.cost.totalCostMicroUsd) },
          { icon: Sparkles, label: text.metrics[1], tone: "blue", value: formatMicroUsd(model.cost.savedCostMicroUsd) },
          { icon: Gauge, label: text.metrics[2], tone: "violet", value: formatMicroUsd(model.cost.costPerRequestMicroUsd) }
        ]}
      />
      <AnalyticsDomainChartGrid>
        <DomainChartCard
          ariaLabel={text.charts[0][2]}
          emptyText={emptyText(locale)}
          rows={toUsdRows(model.cost.costByModel)}
          subtitle={text.charts[0][1]}
          title={text.charts[0][0]}
          type="bar"
          valueKind="usd"
        />
        <DomainChartCard
          ariaLabel={text.charts[1][2]}
          emptyText={emptyText(locale)}
          rows={toUsdRows(projectRows)}
          subtitle={text.charts[1][1]}
          title={text.charts[1][0]}
          type="bar"
          valueKind="usd"
        />
      </AnalyticsDomainChartGrid>
    </AnalyticsDomainPanelShell>
  );
}

export function AnalyticsReliabilityPanel({ locale, model }: DomainPanelProps) {
  const text = locale === "ko"
    ? {
        intro: "최종 상태와 Provider 지연을 분리해 운영 안정성을 확인합니다.",
        metrics: ["성공률", "시스템 오류율", "Fallback 복구"],
        title: "안정성 분석",
        charts: [
          ["최종 상태", "요청의 terminal status 분포", "최종 상태 분포"],
          ["Provider p95 지연", "Provider별 tail latency", "Provider p95 지연"]
        ]
      }
    : {
        intro: "Review terminal outcomes and Provider latency as separate reliability signals.",
        metrics: ["Success rate", "System error rate", "Fallback recovery"],
        title: "Reliability analytics",
        charts: [
          ["Terminal outcomes", "Terminal status distribution", "Terminal outcomes"],
          ["Provider p95 latency", "Tail latency by Provider", "Provider p95 latency"]
        ]
      };

  return (
    <AnalyticsDomainPanelShell intro={text.intro} locale={locale} model={model} title={text.title}>
      <AnalyticsDomainMetricGrid
        metrics={[
          { icon: ShieldCheck, label: text.metrics[0], tone: "green", value: formatPercent(model.reliability.successRate) },
          { icon: Gauge, label: text.metrics[1], tone: "blue", value: formatPercent(model.reliability.systemErrorRate) },
          { icon: Zap, label: text.metrics[2], tone: "violet", value: formatInteger(model.reliability.fallbackSuccesses) }
        ]}
      />
      <AnalyticsDomainChartGrid>
        <DomainChartCard
          ariaLabel={text.charts[0][2]}
          emptyText={emptyText(locale)}
          rows={model.reliability.terminalOutcomes}
          subtitle={text.charts[0][1]}
          title={text.charts[0][0]}
          type="donut"
          valueKind="count"
        />
        <DomainChartCard
          ariaLabel={text.charts[1][2]}
          emptyText={emptyText(locale)}
          rows={model.reliability.providerLatency}
          subtitle={text.charts[1][1]}
          title={text.charts[1][0]}
          type="bar"
          valueKind="milliseconds"
        />
      </AnalyticsDomainChartGrid>
    </AnalyticsDomainPanelShell>
  );
}

export function AnalyticsCachePanel({ locale, model }: DomainPanelProps) {
  const text = locale === "ko"
    ? {
        intro: "Exact Cache 적중, 대상 요청, 절감 비용을 실제 로그 기준으로 확인합니다.",
        metrics: ["캐시 적중률", "캐시 적중", "절감 비용"],
        title: "캐시 분석",
        charts: [
          ["캐시 결과", "Hit, Miss, Bypass 분포", "캐시 결과"],
          ["캐시 처리량", "대상 요청과 실제 적중 요청 비교", "캐시 처리량"]
        ]
      }
    : {
        intro: "Review Exact Cache hits, eligible requests, and recorded savings from real logs.",
        metrics: ["Cache hit rate", "Cache hits", "Saved cost"],
        title: "Cache analytics",
        charts: [
          ["Cache outcomes", "Hit, miss, and bypass distribution", "Cache outcomes"],
          ["Cache volume", "Eligible requests compared with actual hits", "Cache volume"]
        ]
      };

  return (
    <AnalyticsDomainPanelShell intro={text.intro} locale={locale} model={model} title={text.title}>
      <AnalyticsDomainMetricGrid
        metrics={[
          { icon: Database, label: text.metrics[0], tone: "green", value: formatPercent(model.cache.hitRate) },
          { icon: Activity, label: text.metrics[1], tone: "blue", value: formatInteger(model.cache.hitRequests) },
          { icon: Coins, label: text.metrics[2], tone: "violet", value: formatMicroUsd(model.cache.savedCostMicroUsd) }
        ]}
      />
      <AnalyticsDomainChartGrid>
        <DomainChartCard
          ariaLabel={text.charts[0][2]}
          emptyText={emptyText(locale)}
          rows={model.cache.outcomes}
          subtitle={text.charts[0][1]}
          title={text.charts[0][0]}
          type="donut"
          valueKind="count"
        />
        <DomainChartCard
          ariaLabel={text.charts[1][2]}
          emptyText={emptyText(locale)}
          rows={model.cache.volume}
          subtitle={text.charts[1][1]}
          title={text.charts[1][0]}
          type="bar"
          valueKind="count"
        />
      </AnalyticsDomainChartGrid>
    </AnalyticsDomainPanelShell>
  );
}

function AnalyticsDomainPanelShell({
  children,
  intro,
  locale,
  model,
  title
}: {
  children: ReactNode;
  intro: string;
  locale: Locale;
  model: AnalyticsOverviewReadModel;
  title: string;
}) {
  return (
    <section className="analytics-tab-panel analytics-domain-panel">
      <header className="analytics-domain-header">
        <div>
          <h2>{title}</h2>
          <p>{intro}</p>
        </div>
        <div className="analytics-domain-source" data-state={model.dataState}>
          <strong>{stateLabels[locale][model.dataState]}</strong>
          <span>{model.source} · {formatDateTime(model.dataAsOf)}</span>
        </div>
      </header>
      {children}
    </section>
  );
}

function AnalyticsDomainMetricGrid({
  metrics
}: {
  metrics: Array<{
    icon: typeof Activity;
    label: string;
    tone: "blue" | "green" | "violet";
    value: string;
  }>;
}) {
  return (
    <section className="analytics-domain-kpi-grid">
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <article className="analytics-domain-kpi" data-tone={metric.tone} key={metric.label}>
            <div>
              <span><Icon aria-hidden="true" size={25} strokeWidth={2.2} /></span>
              <p>{metric.label}</p>
            </div>
            <strong>{metric.value}</strong>
          </article>
        );
      })}
    </section>
  );
}

function AnalyticsDomainChartGrid({ children }: { children: ReactNode }) {
  return <section className="analytics-domain-chart-grid">{children}</section>;
}

function DomainChartCard({
  ariaLabel,
  emptyText,
  rows,
  subtitle,
  title,
  type,
  valueKind
}: {
  ariaLabel: string;
  emptyText: string;
  rows: AnalyticsDomainChartRow[];
  subtitle: string;
  title: string;
  type: "bar" | "donut";
  valueKind: AnalyticsChartValueKind;
}) {
  const hasData = rows.some((row) => row.value > 0);

  return (
    <article className="analytics-card analytics-domain-chart-card">
      <div className="analytics-card-header">
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      </div>
      {hasData ? (
        type === "bar" ? (
          <AnalyticsDomainBarChart ariaLabel={ariaLabel} rows={rows} valueKind={valueKind} />
        ) : (
          <AnalyticsDomainDonutChart ariaLabel={ariaLabel} rows={rows} valueKind={valueKind} />
        )
      ) : (
        <div className="analytics-domain-empty">{emptyText}</div>
      )}
    </article>
  );
}

function toUsdRows(rows: AnalyticsDomainChartRow[]) {
  return rows.map((row) => ({ ...row, value: row.value / 1_000_000 }));
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

function emptyText(locale: Locale) {
  return locale === "ko"
    ? "선택한 범위에 표시할 데이터가 없습니다."
    : "No data is available for the selected range.";
}
