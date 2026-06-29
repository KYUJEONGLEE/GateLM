import Link from "next/link";
import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import {
  formatDateTime,
  formatInteger,
  formatLatency,
  formatPercent,
  formatUsd
} from "@/lib/formatting/formatters";

type DashboardOverviewProps = {
  overview: DashboardOverview;
};

const statusOrder = ["success", "blocked", "rate_limited", "failed", "cancelled"];

export function DashboardOverviewView({ overview }: DashboardOverviewProps) {
  const maxStatusCount = Math.max(...Object.values(overview.statusCounts), 1);

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">v1.0.0 baseline</p>
          <h2>Overview</h2>
          <p>
            Request metrics are rendered from the Gateway overview path. Costs
            and savings are displayed from backend fields, not recalculated in UI.
          </p>
        </div>
        <Link
          className="primary-link"
          href={`/tenants/${overview.filters.tenantId}/request-logs`}
        >
          Open request logs
        </Link>
      </section>

      <section className="metric-grid" aria-label="Dashboard overview metrics">
        <MetricCard label="Total requests" value={formatInteger(overview.totalRequests)} />
        <MetricCard label="Successful" value={formatInteger(overview.successfulRequests)} />
        <MetricCard label="Failed" value={formatInteger(overview.failedRequests)} tone="danger" />
        <MetricCard label="Blocked" value={formatInteger(overview.blockedRequests)} tone="warning" />
        <MetricCard
          label="Rate limited"
          value={formatInteger(overview.rateLimitedRequests)}
          tone="warning"
        />
        <MetricCard label="Cache hit rate" value={formatPercent(overview.cacheHitRate)} />
        <MetricCard label="Total tokens" value={formatInteger(overview.totalTokens)} />
        <MetricCard label="Total cost" value={formatUsd(overview.totalCostUsd)} />
        <MetricCard label="Saved cost" value={formatUsd(overview.savedCostUsd)} tone="success" />
        <MetricCard label="Average latency" value={formatLatency(overview.averageLatencyMs)} />
        <MetricCard label="P95 latency" value={formatLatency(overview.p95LatencyMs)} />
        <MetricCard label="Records" value={formatInteger(overview.dataFreshness.recordCount)} />
      </section>

      <section className="dashboard-grid">
        <article className="console-panel">
          <div className="panel-heading">
            <h3>Status distribution</h3>
            <p>Blocked and rate-limited requests are policy outcomes, not product failures.</p>
          </div>
          <div className="bar-list">
            {statusOrder.map((status) => {
              const count = overview.statusCounts[status] ?? 0;
              const percent = (count / maxStatusCount) * 100;

              return (
                <div className="bar-row" key={status}>
                  <span>{status}</span>
                  <div className="bar-track" aria-hidden="true">
                    <span className="bar-fill" style={{ width: `${percent}%` }} />
                  </div>
                  <strong>{count}</strong>
                </div>
              );
            })}
          </div>
        </article>

        <article className="console-panel">
          <div className="panel-heading">
            <h3>Masking actions</h3>
            <p>Only redacted previews and detector metadata are visible.</p>
          </div>
          <div className="compact-list">
            {Object.entries(overview.maskingActionCounts).map(([action, count]) => (
              <div className="compact-row" key={action}>
                <span>{action}</span>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="console-panel wide-panel">
          <div className="panel-heading">
            <h3>Routing by model</h3>
            <p>Provider and model remain strings so future adapters do not require UI rewrites.</p>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Reason</th>
                  <th>Requests</th>
                </tr>
              </thead>
              <tbody>
                {overview.routingCountByModel.map((row) => (
                  <tr key={`${row.selectedProvider}-${row.selectedModel}-${row.routingReason}`}>
                    <td>{row.selectedProvider}</td>
                    <td>{row.selectedModel}</td>
                    <td>{row.routingReason}</td>
                    <td>{row.requestCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>

        <article className="console-panel wide-panel">
          <div className="panel-heading">
            <h3>Cost by model</h3>
            <p>Canonical cost is backend-provided micro USD with display USD alongside it.</p>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Model</th>
                  <th>Requests</th>
                  <th>Tokens</th>
                  <th>Cost</th>
                </tr>
              </thead>
              <tbody>
                {overview.costByModel.map((row) => (
                  <tr key={`${row.selectedProvider}-${row.selectedModel}`}>
                    <td>{row.selectedProvider}</td>
                    <td>{row.selectedModel}</td>
                    <td>{row.requestCount}</td>
                    <td>{formatInteger(row.totalTokens)}</td>
                    <td>{formatUsd(row.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>Data freshness</h3>
          <p>
            {overview.dataFreshness.source} generated at{" "}
            {formatDateTime(overview.dataFreshness.generatedAt, overview.range.timezone)}
          </p>
        </div>
      </section>
    </main>
  );
}

function MetricCard({
  label,
  tone = "neutral",
  value
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
  value: string;
}) {
  return (
    <article className="metric-card" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}
