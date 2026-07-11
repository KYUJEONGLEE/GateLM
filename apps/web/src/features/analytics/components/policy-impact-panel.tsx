import { DollarSign, ShieldCheck, Zap } from "lucide-react";
import {
  PolicyImpactModelShareChart,
  PolicyImpactOutcomeChart,
  type PolicyImpactChartRow
} from "@/features/analytics/components/policy-impact-charts";
import type {
  PolicyImpactOutcomeId,
  PolicyImpactReadModel
} from "@/features/analytics/policy-impact-read-model";
import { formatDateTime, formatInteger } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type PolicyImpactPanelText = {
  charts: {
    modelAria: string;
    modelEmpty: string;
    modelSubtitle: string;
    modelTitle: string;
    outcomeAria: string;
    outcomeEmpty: string;
    outcomeSubtitle: string;
    outcomeTitle: string;
  };
  dataState: Record<PolicyImpactReadModel["dataState"], string>;
  eyebrow: string;
  intro: string;
  metrics: {
    avoided: { detail: string; label: string };
    protected: { detail: string; label: string };
    saved: { detail: string; label: string };
  };
  source: string;
  title: string;
};

const textByLocale: Record<Locale, PolicyImpactPanelText> = {
  en: {
    charts: {
      modelAria: "Request share by routed model",
      modelEmpty: "Model routing evidence will appear after requests are processed.",
      modelSubtitle: "Current request distribution after routing policy is applied.",
      modelTitle: "Model Traffic Distribution",
      outcomeAria: "Policy outcome request counts",
      outcomeEmpty: "Policy outcomes will appear after requests are processed.",
      outcomeSubtitle: "Concrete actions recorded by Gateway request logs.",
      outcomeTitle: "Policy Outcomes"
    },
    dataState: {
      live: "LIVE EVIDENCE",
      partial: "PARTIAL DATA",
      stale: "STALE DATA",
      unavailable: "AWAITING DATA"
    },
    eyebrow: "POLICY IMPACT",
    intro: "See how routing, cache, safety, and limits changed real Gateway traffic.",
    metrics: {
      avoided: {
        detail: "Cache hits, blocked requests, and rate limits",
        label: "Provider calls avoided"
      },
      protected: {
        detail: "Masked or blocked before Provider calls",
        label: "Protected requests"
      },
      saved: {
        detail: "Saved cost recorded by cache evidence",
        label: "Cache cost saved"
      }
    },
    source: "Gateway evidence",
    title: "Policy effects at a glance"
  },
  ko: {
    charts: {
      modelAria: "라우팅된 모델별 요청 비중",
      modelEmpty: "요청이 처리되면 모델 라우팅 증거가 표시됩니다.",
      modelSubtitle: "라우팅 정책 적용 후 현재 요청 분포입니다.",
      modelTitle: "모델 트래픽 분포",
      outcomeAria: "정책 결과별 요청 수",
      outcomeEmpty: "요청이 처리되면 정책 결과가 표시됩니다.",
      outcomeSubtitle: "Gateway 요청 로그에 기록된 실제 정책 동작입니다.",
      outcomeTitle: "정책 결과"
    },
    dataState: {
      live: "LIVE EVIDENCE",
      partial: "PARTIAL DATA",
      stale: "STALE DATA",
      unavailable: "AWAITING DATA"
    },
    eyebrow: "POLICY IMPACT",
    intro: "라우팅, 캐시, 안전, 제한 정책이 실제 Gateway 트래픽에 만든 변화를 확인합니다.",
    metrics: {
      avoided: {
        detail: "캐시 적중, 차단, Rate Limit 합계",
        label: "Provider 호출 방지"
      },
      protected: {
        detail: "Provider 호출 전 마스킹 또는 차단",
        label: "민감정보 보호 요청"
      },
      saved: {
        detail: "캐시 증거에 기록된 실제 절감 비용",
        label: "캐시 절감 비용"
      }
    },
    source: "Gateway evidence",
    title: "정책 효과를 한눈에"
  }
};

const outcomePresentation: Record<
  PolicyImpactOutcomeId,
  { color: string; label: string }
> = {
  cache_hit: { color: "#10a37f", label: "CACHE HIT" },
  pii_masked: { color: "#3b82f6", label: "PII MASKED" },
  blocked: { color: "#ef4444", label: "BLOCKED" },
  rate_limited: { color: "#f59e0b", label: "RATE LIMITED" },
  fallback: { color: "#8b5cf6", label: "FALLBACK" }
};

const modelColors = ["#10a37f", "#3b82f6", "#f59e0b", "#8b5cf6"];

export function PolicyImpactPanel({
  locale,
  model
}: {
  locale: Locale;
  model: PolicyImpactReadModel;
}) {
  const text = textByLocale[locale];
  const outcomeRows = model.outcomes.map((row) => ({
    color: outcomePresentation[row.id].color,
    label: outcomePresentation[row.id].label,
    value: row.requestCount
  }));
  const modelRows = summarizeModelRows(model);
  const hasOutcomes = outcomeRows.some((row) => row.value > 0);
  const hasModelShare = modelRows.some((row) => row.value > 0);

  return (
    <section className="analytics-tab-panel analytics-impact-panel">
      <header className="analytics-impact-header">
        <div>
          <span>{text.eyebrow}</span>
          <h2>{text.title}</h2>
          <p>{text.intro}</p>
        </div>
        <div className="analytics-impact-source" data-state={model.dataState}>
          <strong>{text.dataState[model.dataState]}</strong>
          <span>{text.source} · {formatDateTime(model.dataAsOf)}</span>
        </div>
      </header>

      <section className="analytics-impact-kpi-grid" aria-label={text.title}>
        <ImpactMetric
          detail={text.metrics.avoided.detail}
          icon={Zap}
          label={text.metrics.avoided.label}
          tone="green"
          value={formatInteger(model.metrics.avoidedProviderCalls)}
        />
        <ImpactMetric
          detail={text.metrics.saved.detail}
          icon={DollarSign}
          label={text.metrics.saved.label}
          tone="blue"
          value={formatMicroUsd(model.metrics.savedCostMicroUsd)}
        />
        <ImpactMetric
          detail={text.metrics.protected.detail}
          icon={ShieldCheck}
          label={text.metrics.protected.label}
          tone="violet"
          value={formatInteger(model.metrics.protectedRequests)}
        />
      </section>

      <section className="analytics-impact-chart-grid">
        <article className="analytics-card analytics-impact-chart-card">
          <div className="analytics-card-header">
            <div>
              <h2>{text.charts.outcomeTitle}</h2>
              <p>{text.charts.outcomeSubtitle}</p>
            </div>
          </div>
          {hasOutcomes ? (
            <PolicyImpactOutcomeChart
              ariaLabel={text.charts.outcomeAria}
              rows={outcomeRows}
            />
          ) : (
            <ImpactEmptyState text={text.charts.outcomeEmpty} />
          )}
        </article>

        <article className="analytics-card analytics-impact-chart-card">
          <div className="analytics-card-header">
            <div>
              <h2>{text.charts.modelTitle}</h2>
              <p>{text.charts.modelSubtitle}</p>
            </div>
          </div>
          {hasModelShare ? (
            <PolicyImpactModelShareChart
              ariaLabel={text.charts.modelAria}
              rows={modelRows}
            />
          ) : (
            <ImpactEmptyState text={text.charts.modelEmpty} />
          )}
        </article>
      </section>
    </section>
  );
}

function ImpactMetric({
  detail,
  icon: Icon,
  label,
  tone,
  value
}: {
  detail: string;
  icon: typeof Zap;
  label: string;
  tone: "blue" | "green" | "violet";
  value: string;
}) {
  return (
    <article className="analytics-impact-kpi" data-tone={tone}>
      <div>
        <span>
          <Icon aria-hidden="true" size={26} strokeWidth={2.2} />
        </span>
        <p>{label}</p>
      </div>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function ImpactEmptyState({ text }: { text: string }) {
  return <div className="analytics-impact-empty">{text}</div>;
}

function summarizeModelRows(model: PolicyImpactReadModel): PolicyImpactChartRow[] {
  const sortedRows = [...model.modelShare].sort(
    (left, right) => right.requestCount - left.requestCount
  );
  const directRows = sortedRows.slice(0, 3).map((row, index) => ({
    color: modelColors[index] ?? modelColors[0],
    label: row.model,
    value: row.requestCount
  }));
  const otherRequests = sortedRows
    .slice(3)
    .reduce((sum, row) => sum + row.requestCount, 0);

  if (otherRequests > 0) {
    directRows.push({
      color: modelColors[3] ?? modelColors[0],
      label: "Other",
      value: otherRequests
    });
  }

  return directRows;
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
