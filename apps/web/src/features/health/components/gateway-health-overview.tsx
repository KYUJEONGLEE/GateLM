"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  GatewayDependencyStatus,
  GatewayHealthEndpoint,
  GatewayHealthModel
} from "@/lib/gateway/health-types";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type GatewayHealthOverviewProps = {
  locale: Locale;
  model: GatewayHealthModel;
};

const healthText: Record<
  Locale,
  {
    analytics: string;
    checkedAt: string;
    controlPlane: string;
    dependencies: string;
    dependency: string;
    endpoint: string;
    failingDependencies: string;
    gatewayUnavailable: string;
    health: string;
    httpStatus: string;
    message: string;
    noDependencies: string;
    ready: string;
    refresh: string;
    required: string;
    service: string;
    source: string;
    status: string;
    time: string;
    title: string;
  }
> = {
  en: {
    analytics: "analytics",
    checkedAt: "Checked at",
    controlPlane: "Control Plane",
    dependencies: "Dependencies",
    dependency: "Dependency",
    endpoint: "Endpoint",
    failingDependencies: "Failing dependencies",
    gatewayUnavailable: "Gateway unavailable",
    health: "Alive",
    httpStatus: "HTTP status",
    message: "Message",
    noDependencies: "No readiness dependencies returned.",
    ready: "Ready",
    refresh: "Refresh",
    required: "Required",
    service: "Service",
    source: "Source",
    status: "Status",
    time: "Gateway time",
    title: "Health"
  },
  ko: {
    analytics: "분석",
    checkedAt: "확인 시각",
    controlPlane: "Control Plane",
    dependencies: "Dependencies",
    dependency: "Dependency",
    endpoint: "Endpoint",
    failingDependencies: "Failing dependencies",
    gatewayUnavailable: "Gateway unavailable",
    health: "Alive",
    httpStatus: "HTTP status",
    message: "Message",
    noDependencies: "readiness dependency가 없습니다.",
    ready: "Ready",
    refresh: "새로고침",
    required: "Required",
    service: "Service",
    source: "출처",
    status: "상태",
    time: "Gateway time",
    title: "Health"
  }
};

export function GatewayHealthOverview({ locale, model }: GatewayHealthOverviewProps) {
  const router = useRouter();
  const text = healthText[locale];

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.analytics}</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      {model.healthz.loadError ? (
        <p className="policy-alert" data-status="error">
          /healthz: {model.healthz.loadError}
        </p>
      ) : null}
      {model.readyz.loadError ? (
        <p className="policy-alert" data-status="error">
          /readyz: {model.readyz.loadError}
        </p>
      ) : null}
      {model.controlPlane.healthz.loadError ? (
        <p className="policy-alert" data-status="error">
          {text.controlPlane} /healthz: {model.controlPlane.healthz.loadError}
        </p>
      ) : null}
      {model.controlPlane.readyz.loadError ? (
        <p className="policy-alert" data-status="error">
          {text.controlPlane} /readyz: {model.controlPlane.readyz.loadError}
        </p>
      ) : null}

      <section className="metric-grid">
        <article className="metric-card" data-tone={model.summary.isAlive ? "success" : "danger"}>
          <span>Gateway {text.health}</span>
          <strong>{model.summary.isAlive ? "ok" : "error"}</strong>
        </article>
        <article className="metric-card" data-tone={model.summary.isReady ? "success" : "danger"}>
          <span>Gateway {text.ready}</span>
          <strong>{model.summary.isReady ? "ready" : "not_ready"}</strong>
        </article>
        <article
          className="metric-card"
          data-tone={model.summary.isControlPlaneAlive ? "success" : "danger"}
        >
          <span>{text.controlPlane} {text.health}</span>
          <strong>{model.summary.isControlPlaneAlive ? "ok" : "error"}</strong>
        </article>
        <article
          className="metric-card"
          data-tone={model.summary.isControlPlaneReady ? "success" : "danger"}
        >
          <span>{text.controlPlane} {text.ready}</span>
          <strong>{model.summary.isControlPlaneReady ? "ready" : "not_ready"}</strong>
        </article>
        <article className="metric-card">
          <span>{text.dependencies}</span>
          <strong>{model.summary.requiredDependencyCount}/{model.summary.dependencyCount}</strong>
        </article>
        <article
          className="metric-card"
          data-tone={model.summary.failingDependencyCount > 0 ? "danger" : "success"}
        >
          <span>{text.failingDependencies}</span>
          <strong>{model.summary.failingDependencyCount}</strong>
        </article>
      </section>

      <section className="console-panel">
        <div className="health-toolbar">
          <div className="panel-heading">
            <h3>{text.endpoint}</h3>
            <p>{text.checkedAt}: {formatDateTime(model.checkedAt)}</p>
          </div>
          <Button onClick={() => router.refresh()} type="button">
            <RefreshCw aria-hidden="true" />
            {text.refresh}
          </Button>
        </div>
        <div className="dashboard-grid">
          <EndpointPanel endpoint="Gateway /healthz" model={model.healthz} text={text} />
          <EndpointPanel endpoint="Gateway /readyz" model={model.readyz} text={text} />
          <EndpointPanel
            endpoint={`${text.controlPlane} /healthz`}
            model={model.controlPlane.healthz}
            text={text}
          />
          <EndpointPanel
            endpoint={`${text.controlPlane} /readyz`}
            model={model.controlPlane.readyz}
            text={text}
          />
        </div>
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{text.dependencies}</h3>
        </div>
        {model.readyz.dependencies.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table health-dependency-table">
              <thead>
                <tr>
                  <th>{text.dependency}</th>
                  <th>{text.status}</th>
                  <th>{text.required}</th>
                  <th>{text.message}</th>
                </tr>
              </thead>
              <tbody>
                {model.readyz.dependencies.map((dependency) => (
                  <DependencyRow dependency={dependency} key={dependency.name} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">{text.noDependencies}</p>
        )}
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{text.controlPlane} {text.dependencies}</h3>
          <p>{model.controlPlane.baseUrl}</p>
        </div>
        {model.controlPlane.readyz.dependencies.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table health-dependency-table">
              <thead>
                <tr>
                  <th>{text.dependency}</th>
                  <th>{text.status}</th>
                  <th>{text.required}</th>
                  <th>{text.message}</th>
                </tr>
              </thead>
              <tbody>
                {model.controlPlane.readyz.dependencies.map((dependency) => (
                  <DependencyRow dependency={dependency} key={dependency.name} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">{text.noDependencies}</p>
        )}
      </section>
    </main>
  );
}

function EndpointPanel({
  endpoint,
  model,
  text
}: {
  endpoint: string;
  model: GatewayHealthEndpoint;
  text: (typeof healthText)[Locale];
}) {
  return (
    <article className="health-endpoint-panel">
      <div className="panel-heading">
        <h3>{endpoint}</h3>
      </div>
      <dl className="policy-summary-list">
        {[
          [text.status, model.status],
          [text.httpStatus, nullableText(model.httpStatus?.toString() ?? null)],
          [text.service, nullableText(model.service)],
          [text.time, model.time ? formatDateTime(model.time) : "-"]
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function DependencyRow({
  dependency
}: {
  dependency: GatewayDependencyStatus;
}) {
  return (
    <tr>
      <td>
        <strong className="provider-name">{dependency.name}</strong>
      </td>
      <td>
        <Badge
          className="project-status-badge"
          data-status={dependency.status === "ok" ? "ACTIVE" : "DISABLED"}
          variant="outline"
        >
          {dependency.status}
        </Badge>
      </td>
      <td>{dependency.required === null ? "-" : String(dependency.required)}</td>
      <td>{nullableText(dependency.message)}</td>
    </tr>
  );
}
