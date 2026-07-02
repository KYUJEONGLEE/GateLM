import Link from "next/link";
import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";
import {
  formatInteger,
  formatLatency,
  formatPercent,
  formatUsd
} from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type DashboardOverviewProps = {
  locale: Locale;
  overview: DashboardOverview;
};

const statusOrder = ["success", "blocked", "rate_limited", "failed", "cancelled"];

const dashboardText: Record<
  Locale,
  {
    actionRequestLogs: string;
    costByModel: string;
    metrics: {
      averageLatency: string;
      blocked: string;
      cacheHitRate: string;
      cancelled: string;
      failed: string;
      fallbackSuccess: string;
      p95Latency: string;
      p95ProviderLatency: string;
      rateLimited: string;
      records: string;
      savedCost: string;
      systemErrorRate: string;
      successful: string;
      totalCost: string;
      totalRequests: string;
      totalTokens: string;
    };
    maskingActions: string;
    operationalEvidence: string;
    outcomeEvidence: string;
    routingByModel: string;
    statusDistribution: string;
    title: string;
  }
> = {
  en: {
    actionRequestLogs: "Open request logs",
    costByModel: "Cost by model",
    metrics: {
      averageLatency: "Average latency",
      blocked: "Blocked",
      cacheHitRate: "Cache hit rate",
      cancelled: "Cancelled",
      failed: "Failed",
      fallbackSuccess: "Fallback success",
      p95Latency: "P95 latency",
      p95ProviderLatency: "P95 provider latency",
      rateLimited: "Rate limited",
      records: "Records",
      savedCost: "Saved cost",
      systemErrorRate: "System error rate",
      successful: "Successful",
      totalCost: "Total cost",
      totalRequests: "Total requests",
      totalTokens: "Total tokens"
    },
    maskingActions: "Masking actions",
    operationalEvidence: "Operational evidence",
    outcomeEvidence: "Outcome evidence",
    routingByModel: "Routing by model",
    statusDistribution: "Status distribution",
    title: "Overview"
  },
  ko: {
    actionRequestLogs: "요청 로그 열기",
    costByModel: "모델별 비용",
    metrics: {
      averageLatency: "평균 지연",
      blocked: "차단",
      cacheHitRate: "캐시 적중률",
      cancelled: "취소",
      failed: "실패",
      fallbackSuccess: "Fallback 성공",
      p95Latency: "P95 지연",
      p95ProviderLatency: "Provider P95 지연",
      rateLimited: "Rate limit",
      records: "레코드",
      savedCost: "절감 비용",
      systemErrorRate: "시스템 오류율",
      successful: "성공",
      totalCost: "총 비용",
      totalRequests: "총 요청",
      totalTokens: "총 토큰"
    },
    maskingActions: "마스킹 동작",
    operationalEvidence: "운영 증거",
    outcomeEvidence: "Outcome 증거",
    routingByModel: "모델별 라우팅",
    statusDistribution: "상태 분포",
    title: "Overview"
  }
};

export function DashboardOverviewView({ locale, overview }: DashboardOverviewProps) {
  const maxStatusCount = Math.max(...Object.values(overview.statusCounts), 1);
  const text = dashboardText[locale];

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">dashboard</p>
          <h2>{text.title}</h2>
        </div>
        <Link
          className="primary-link"
          href={`/tenants/${overview.filters.tenantId}/request-logs`}
        >
          {text.actionRequestLogs}
        </Link>
      </section>

      <section className="metric-grid" aria-label="Dashboard overview metrics">
        <MetricCard label={text.metrics.totalRequests} value={formatInteger(overview.totalRequests)} />
        <MetricCard label={text.metrics.successful} value={formatInteger(overview.successfulRequests)} />
        <MetricCard label={text.metrics.failed} value={formatInteger(overview.failedRequests)} tone="danger" />
        <MetricCard label={text.metrics.blocked} value={formatInteger(overview.blockedRequests)} tone="warning" />
        <MetricCard
          label={text.metrics.rateLimited}
          value={formatInteger(overview.rateLimitedRequests)}
          tone="warning"
        />
        <MetricCard label={text.metrics.cancelled} value={formatInteger(overview.cancelledRequests ?? 0)} />
        <MetricCard label={text.metrics.cacheHitRate} value={formatPercent(overview.cacheHitRate)} />
        <MetricCard label={text.metrics.fallbackSuccess} value={formatInteger(overview.fallbackSuccessCount ?? 0)} />
        <MetricCard label={text.metrics.totalTokens} value={formatInteger(overview.totalTokens)} />
        <MetricCard label={text.metrics.totalCost} value={formatUsd(overview.totalCostUsd)} />
        <MetricCard label={text.metrics.savedCost} value={formatUsd(overview.savedCostUsd)} tone="success" />
        <MetricCard label={text.metrics.averageLatency} value={formatLatency(overview.averageLatencyMs)} />
        <MetricCard label={text.metrics.p95Latency} value={formatLatency(overview.p95LatencyMs)} />
        <MetricCard label={text.metrics.p95ProviderLatency} value={formatLatency(overview.performance?.p95ProviderLatencyMs ?? 0)} />
        <MetricCard label={text.metrics.systemErrorRate} value={formatPercent(overview.performance?.systemErrorRate ?? 0)} tone="danger" />
        <MetricCard label={text.metrics.records} value={formatInteger(overview.dataFreshness.recordCount)} />
      </section>

      <section className="dashboard-grid">
        <article className="console-panel">
          <div className="panel-heading">
            <h3>{text.operationalEvidence}</h3>
          </div>
          <div className="compact-list">
            <div className="compact-row">
              <span>freshness source</span>
              <strong>{overview.dataFreshness.source}</strong>
            </div>
            <div className="compact-row">
              <span>query budget</span>
              <strong>{overview.queryBudget?.status ?? "ok"}</strong>
            </div>
            <div className="compact-row">
              <span>max range</span>
              <strong>{overview.queryBudget?.maxRangeHours ?? 24}h</strong>
            </div>
            <div className="compact-row">
              <span>gateway/provider p95</span>
              <strong>
                {formatLatency(overview.performance?.p95GatewayInternalLatencyMs ?? overview.p95LatencyMs)} / {formatLatency(overview.performance?.p95ProviderLatencyMs ?? 0)}
              </strong>
            </div>
            <div className="compact-row">
              <span>budget scope</span>
              <strong>
                {overview.filters.budgetScopeType}:{overview.filters.budgetScopeId}
              </strong>
            </div>
            <div className="compact-row">
              <span>resolved by</span>
              <strong>{overview.filters.resolvedBy}</strong>
            </div>
          </div>
        </article>

        <article className="console-panel">
          <div className="panel-heading">
            <h3>{text.statusDistribution}</h3>
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
            <h3>{text.maskingActions}</h3>
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

        <article className="console-panel">
          <div className="panel-heading">
            <h3>{text.outcomeEvidence}</h3>
          </div>
          <div className="compact-list">
            {(overview.breakdowns?.bySafetyOutcome ?? []).map((row) => (
              <div className="compact-row" key={`safety-${row.outcome}`}>
                <span>safety.{row.outcome}</span>
                <strong>{row.requestCount}</strong>
              </div>
            ))}
            {(overview.breakdowns?.byCacheOutcome ?? []).map((row) => (
              <div className="compact-row" key={`cache-${row.outcome}`}>
                <span>cache.{row.outcome}</span>
                <strong>{row.requestCount}</strong>
              </div>
            ))}
            {(overview.breakdowns?.byFallbackOutcome ?? []).map((row) => (
              <div className="compact-row" key={`fallback-${row.outcome}`}>
                <span>fallback.{row.outcome}</span>
                <strong>{row.requestCount}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="console-panel">
          <div className="panel-heading">
            <h3>Budget scopes</h3>
          </div>
          <div className="compact-list">
            {(overview.breakdowns?.byBudgetScope ?? []).map((row) => (
              <div className="compact-row" key={`${row.budgetScopeType}-${row.budgetScopeId}`}>
                <span>{row.budgetScopeType}:{row.budgetScopeId}</span>
                <strong>{row.requestCount}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="console-panel">
          <div className="panel-heading">
            <h3>Provider p95</h3>
          </div>
          <div className="compact-list">
            {(overview.breakdowns?.byProviderModel ?? []).map((row) => (
              <div className="compact-row" key={`${row.selectedProvider}-${row.selectedModel}`}>
                <span>{row.selectedProvider}/{row.selectedModel}</span>
                <strong>{formatLatency(row.p95ProviderLatencyMs)}</strong>
              </div>
            ))}
          </div>
        </article>

        <article className="console-panel wide-panel">
          <div className="panel-heading">
            <h3>{text.routingByModel}</h3>
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
            <h3>{text.costByModel}</h3>
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
