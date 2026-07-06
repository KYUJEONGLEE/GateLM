"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GatewayMetricsModel, MetricsFamily, MetricsSample } from "@/lib/gateway/metrics-types";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type MetricsOverviewProps = {
  locale: Locale;
  model: GatewayMetricsModel;
};

const metricsText: Record<
  Locale,
  {
    analytics: string;
    checkedAt: string;
    empty: string;
    family: string;
    forbiddenLabels: string;
    gatewayUnavailable: string;
    httpStatus: string;
    labels: string;
    metricFamilyCoverage: string;
    missing: string;
    present: string;
    refresh: string;
    samples: string;
    series: string;
    source: string;
    title: string;
    type: string;
    value: string;
  }
> = {
  en: {
    analytics: "analytics",
    checkedAt: "Checked at",
    empty: "No safe series for this metric family.",
    family: "Metric family",
    forbiddenLabels: "Forbidden labels",
    gatewayUnavailable: "Gateway unavailable",
    httpStatus: "HTTP status",
    labels: "Labels",
    metricFamilyCoverage: "Family coverage",
    missing: "Missing",
    present: "Present",
    refresh: "Refresh",
    samples: "Samples",
    series: "Series",
    source: "Source",
    title: "Metrics",
    type: "Type",
    value: "Value"
  },
  ko: {
    analytics: "분석",
    checkedAt: "확인 시각",
    empty: "이 metric family에 표시할 safe series가 없습니다.",
    family: "Metric family",
    forbiddenLabels: "금지 label",
    gatewayUnavailable: "Gateway unavailable",
    httpStatus: "HTTP status",
    labels: "Labels",
    metricFamilyCoverage: "Family coverage",
    missing: "누락",
    present: "존재",
    refresh: "새로고침",
    samples: "Samples",
    series: "Series",
    source: "출처",
    title: "Metrics",
    type: "Type",
    value: "Value"
  }
};

export function MetricsOverview({ locale, model }: MetricsOverviewProps) {
  const router = useRouter();
  const text = metricsText[locale];

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.analytics}</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      {model.loadError ? (
        <Alert variant="destructive">
          <AlertDescription>{text.gatewayUnavailable}: {model.loadError}</AlertDescription>
        </Alert>
      ) : null}

      {model.summary.forbiddenLabelNames.length > 0 ? (
        <Alert variant="destructive">
          <AlertDescription>{text.forbiddenLabels}: {model.summary.forbiddenLabelNames.join(", ")}</AlertDescription>
        </Alert>
      ) : null}

      <section className="metric-grid">
        <article className="metric-card">
          <span>{text.metricFamilyCoverage}</span>
          <strong>
            {model.summary.presentFamilyCount}/{model.families.length}
          </strong>
        </article>
        <article className="metric-card">
          <span>{text.series}</span>
          <strong>{model.summary.seriesCount}</strong>
        </article>
        <article className="metric-card">
          <span>{text.httpStatus}</span>
          <strong>{nullableText(model.meta.httpStatus?.toString() ?? null)}</strong>
        </article>
        <article className="metric-card">
          <span>{text.checkedAt}</span>
          <strong>{formatDateTime(model.checkedAt)}</strong>
        </article>
      </section>

      <section className="console-panel">
        <div className="metrics-toolbar">
          <div className="panel-heading">
            <h3>{text.family}</h3>
            <p>/metrics</p>
          </div>
          <Button onClick={() => router.refresh()} type="button">
            <RefreshCw aria-hidden="true" />
            {text.refresh}
          </Button>
        </div>

        <div className="table-wrap">
          <table className="data-table metrics-family-table">
            <thead>
              <tr>
                <th>{text.family}</th>
                <th>{text.type}</th>
                <th>{text.samples}</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {model.families.map((family) => (
                <tr key={family.name}>
                  <td>
                    <strong className="provider-name">{family.name}</strong>
                    {family.help ? <span className="project-muted">{family.help}</span> : null}
                  </td>
                  <td>{nullableText(family.type)}</td>
                  <td>{family.sampleCount}</td>
                  <td>
                    <Badge
                      className="project-status-badge"
                      data-status={family.status === "present" ? "ACTIVE" : "DISABLED"}
                      variant="outline"
                    >
                      {family.status === "present" ? text.present : text.missing}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="dashboard-grid">
        {model.families.map((family) => (
          <MetricFamilyPanel family={family} key={family.name} text={text} />
        ))}
      </section>
    </main>
  );
}

function MetricFamilyPanel({
  family,
  text
}: {
  family: MetricsFamily;
  text: (typeof metricsText)[Locale];
}) {
  return (
    <article className="console-panel metrics-family-panel">
      <div className="panel-heading">
        <h3>{family.name}</h3>
        <p>
          {family.type ?? "-"} / {family.sampleCount} {text.samples}
        </p>
      </div>
      {family.samples.length > 0 ? (
        <div className="metrics-sample-list">
          {family.samples.map((sample) => (
            <MetricSampleRow key={`${sample.metricName}:${JSON.stringify(sample.labels)}:${sample.value}`} sample={sample} text={text} />
          ))}
        </div>
      ) : (
        <p className="empty-state">{text.empty}</p>
      )}
    </article>
  );
}

function MetricSampleRow({
  sample,
  text
}: {
  sample: MetricsSample;
  text: (typeof metricsText)[Locale];
}) {
  const labels = Object.entries(sample.labels);

  return (
    <div className="metrics-sample-row">
      <div>
        <strong>{sample.metricName}</strong>
        <span>{text.value}: {sample.value}</span>
      </div>
      <div className="metrics-label-list" aria-label={text.labels}>
        {labels.length > 0 ? (
          labels.map(([name, value]) => (
            <Badge key={name} variant="secondary">
              {name}={value}
            </Badge>
          ))
        ) : (
          <span className="project-muted">-</span>
        )}
      </div>
    </div>
  );
}
