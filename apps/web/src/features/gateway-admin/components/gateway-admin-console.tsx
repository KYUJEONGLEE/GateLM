import {
  Activity,
  AlertTriangle,
  Bell,
  Building2,
  Clock3,
  Database,
  DollarSign,
  Gauge,
  LayoutDashboard,
  ListTree,
  Plug,
  Server,
  ShieldCheck
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import {
  type GatewayAdminModel,
  type GatewayAdminRange,
  type GatewayAdminSection,
  gatewayAdminSections
} from "@/lib/gateway-admin/gateway-admin-model";
import { formatDisplayIdentifier, formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import {
  DEFAULT_DISPLAY_TIMEZONE,
  formatDateTime,
  formatInteger,
  formatLatency,
  formatPercent,
  formatUsd
} from "@/lib/formatting/formatters";
import styles from "./gateway-admin-console.module.css";

type GatewayAdminConsoleProps = {
  model: GatewayAdminModel;
  section: GatewayAdminSection;
};

const sectionMeta: Record<
  GatewayAdminSection,
  {
    icon: typeof LayoutDashboard;
    label: string;
  }
> = {
  alerts: { icon: Bell, label: "Alerts" },
  "audit-logs": { icon: ShieldCheck, label: "Audit logs" },
  cache: { icon: Database, label: "Cache" },
  cost: { icon: DollarSign, label: "Cost" },
  errors: { icon: AlertTriangle, label: "Errors" },
  overview: { icon: LayoutDashboard, label: "Overview" },
  providers: { icon: Plug, label: "Providers" },
  tenants: { icon: Building2, label: "Tenants" },
  traffic: { icon: Activity, label: "Traffic" }
};

const rangeLabels: Record<GatewayAdminRange, string> = {
  "15m": "15m",
  "1d": "1d",
  "1h": "1h",
  "1w": "1w"
};

export function GatewayAdminConsole({ model, section }: GatewayAdminConsoleProps) {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar} aria-label="Gateway admin navigation">
        <Link className={styles.brand} href="/admin/gateway/overview">
          <span className={styles.brandMark}>G</span>
          <strong>Gateway Admin</strong>
        </Link>
        <nav className={styles.nav}>
          {gatewayAdminSections.map((item) => {
            const meta = sectionMeta[item];
            const Icon = meta.icon;

            return (
              <Link
                aria-current={section === item ? "page" : undefined}
                data-active={section === item}
                href={gatewayAdminHref(item, model.filters)}
                key={item}
              >
                <Icon aria-hidden="true" size={16} strokeWidth={2.2} />
                <span>{meta.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className={styles.main}>
        <GatewayAdminHeader model={model} section={section} />
        {section === "overview" ? <GatewayAdminOverview model={model} /> : null}
        {section === "traffic" ? <GatewayAdminTraffic model={model} /> : null}
        {section === "providers" ? <GatewayAdminProviders model={model} /> : null}
        {section === "tenants" ? <GatewayAdminTenants model={model} /> : null}
        {section === "errors" ? (
          <GatewayAdminPlaceholder
            model={model}
            title="Errors"
            rows={model.recentErrors}
            description="Error classification is currently derived from safe request log fields."
          />
        ) : null}
        {section === "cost" ? (
          <GatewayAdminPlaceholder
            model={model}
            title="Cost"
            description="Estimated cost is available from request usage logs and budget aggregation."
          />
        ) : null}
        {section === "cache" ? (
          <GatewayAdminPlaceholder
            model={model}
            title="Cache"
            description="Cache effectiveness is available from cache status and saved-cost fields."
          />
        ) : null}
        {section === "alerts" ? (
          <GatewayAdminPlaceholder
            model={model}
            title="Alerts"
            description="Notification delivery is not connected here; event storage can be wired later."
          />
        ) : null}
        {section === "audit-logs" ? (
          <GatewayAdminPlaceholder
            model={model}
            title="Audit logs"
            description="Operator audit logs should be separated from tenant audit logs in a later PR."
          />
        ) : null}
      </main>
    </div>
  );
}

function GatewayAdminHeader({
  model,
  section
}: {
  model: GatewayAdminModel;
  section: GatewayAdminSection;
}) {
  const meta = sectionMeta[section];

  return (
    <header className={styles.header}>
      <div>
        <p className="console-kicker">GateLM operations</p>
        <h1>{meta.label}</h1>
      </div>
      <div className={styles.headerActions}>
        <RangeNav activeRange={model.filters.range} section={section} />
        <span className={styles.readOnlyBadge}>Read-only</span>
      </div>
    </header>
  );
}

function GatewayAdminOverview({ model }: { model: GatewayAdminModel }) {
  const overview = model.overview;
  const successRate = overview ? safeRate(overview.successfulRequests, overview.totalRequests) : 0;

  return (
    <div className={styles.stack}>
      <WarningStrip warnings={model.dataWarnings} />
      <section className={styles.metricGrid} aria-label="Gateway overview metrics">
        <MetricCard
          icon={<Server aria-hidden="true" size={18} />}
          label="Gateway status"
          value={model.health.summary.isReady ? "Ready" : "Attention"}
          detail={`${model.health.summary.failingDependencyCount}/${model.health.summary.dependencyCount} dependencies failing`}
          status={model.health.summary.isReady ? "healthy" : "degraded"}
        />
        <MetricCard
          icon={<Activity aria-hidden="true" size={18} />}
          label="Requests"
          value={formatInteger(overview?.totalRequests ?? model.records.length)}
          detail={`${formatPercent(successRate)} success rate`}
        />
        <MetricCard
          icon={<Clock3 aria-hidden="true" size={18} />}
          label="Latency"
          value={formatLatency(overview?.p95LatencyMs ?? null)}
          detail={`Average ${formatLatency(overview?.averageLatencyMs ?? null)}`}
        />
        <MetricCard
          icon={<DollarSign aria-hidden="true" size={18} />}
          label="Estimated cost"
          value={formatMicroUsd(overview?.totalCostMicroUsd ?? sumRecordCost(model.records))}
          detail={`${formatInteger(overview?.totalTokens ?? sumRecordTokens(model.records))} tokens`}
        />
      </section>

      <section className={styles.grid}>
        <article className="console-panel">
          <div className="panel-heading">
            <h2>Provider health</h2>
            <Link className="secondary-link" href={gatewayAdminHref("providers", model.filters)}>
              Open
            </Link>
          </div>
          <ProviderHealthList model={model} />
        </article>

        <article className="console-panel">
          <div className="panel-heading">
            <h2>Recent incidents</h2>
            <Link className="secondary-link" href={gatewayAdminHref("errors", model.filters)}>
              Open
            </Link>
          </div>
          <RecentIncidentList records={model.recentErrors} />
        </article>
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h2>Tenant usage</h2>
          <Link className="secondary-link" href={gatewayAdminHref("tenants", model.filters)}>
            Open
          </Link>
        </div>
        <TenantTable model={model} />
      </section>
    </div>
  );
}

function GatewayAdminTraffic({ model }: { model: GatewayAdminModel }) {
  return (
    <div className={styles.stack}>
      <TrafficFilterBar model={model} />
      <section className={styles.metricGrid} aria-label="Traffic metrics">
        <MetricCard label="Visible logs" value={formatInteger(model.records.length)} />
        <MetricCard label="Problem logs" value={formatInteger(model.recentErrors.length)} />
        <MetricCard label="Tokens" value={formatInteger(sumRecordTokens(model.records))} />
        <MetricCard label="Estimated cost" value={formatMicroUsd(sumRecordCost(model.records))} />
      </section>
      <section className="console-panel">
        <div className="panel-heading">
          <h2>Safe request log</h2>
          <small>No raw prompt, response, headers, or credentials.</small>
        </div>
        <RequestLogTable records={model.records} />
      </section>
    </div>
  );
}

function GatewayAdminProviders({ model }: { model: GatewayAdminModel }) {
  return (
    <div className={styles.stack}>
      <section className={styles.metricGrid} aria-label="Provider metrics">
        <MetricCard label="Providers" value={formatInteger(model.providerRows.length)} />
        <MetricCard
          label="Healthy"
          value={formatInteger(model.providerRows.filter((row) => row.health === "healthy").length)}
        />
        <MetricCard
          label="Degraded or down"
          value={formatInteger(
            model.providerRows.filter((row) => row.health === "degraded" || row.health === "down").length
          )}
        />
        <MetricCard
          label="Registered models"
          value={formatInteger(model.providerRows.reduce((total, row) => total + row.modelCount, 0))}
        />
      </section>
      <section className="console-panel">
        <div className="panel-heading">
          <h2>Derived provider health</h2>
          <small>Computed from recent safe traffic, not from active provider probing.</small>
        </div>
        <div className="table-wrap">
          <table className={`data-table ${styles.table}`}>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Health</th>
                <th>Connection</th>
                <th>Requests</th>
                <th>Error rate</th>
                <th>Latency</th>
                <th>Models</th>
              </tr>
            </thead>
            <tbody>
              {model.providerRows.map((row) => (
                <tr key={row.provider}>
                  <td>{row.provider}</td>
                  <td>
                    <StatusBadge status={row.health}>{row.health}</StatusBadge>
                  </td>
                  <td>{row.connectionStatus}</td>
                  <td>{formatInteger(row.requestCount)}</td>
                  <td>{formatPercent(row.errorRate)}</td>
                  <td>{formatLatency(row.averageLatencyMs)}</td>
                  <td>{row.models.length ? row.models.map((modelName) => formatModelDisplayName(modelName)).join(", ") : "none"}</td>
                </tr>
              ))}
              {model.providerRows.length === 0 ? <EmptyTableRow colSpan={7} /> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function GatewayAdminTenants({ model }: { model: GatewayAdminModel }) {
  return (
    <div className={styles.stack}>
      <section className="console-panel">
        <div className="panel-heading">
          <h2>Tenants</h2>
          <small>Current MVP reads the configured live tenant scope.</small>
        </div>
        <TenantTable model={model} />
      </section>
      <section className="console-panel">
        <div className="panel-heading">
          <h2>Projects under tenant</h2>
        </div>
        <div className="table-wrap">
          <table className={`data-table ${styles.table}`}>
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>Budget</th>
                <th>Requests</th>
                <th>Tokens</th>
                <th>Cost</th>
                <th>Cache hit</th>
              </tr>
            </thead>
            <tbody>
              {model.projectUsageRows.map((row) => (
                <tr key={row.projectId}>
                  <td>
                    <strong>{row.projectName}</strong>
                    <small>{formatDisplayIdentifier(row.projectId)}</small>
                  </td>
                  <td>{row.status}</td>
                  <td>{formatUsd(row.budgetUsd.toFixed(2))}</td>
                  <td>{formatInteger(row.requestCount)}</td>
                  <td>{formatInteger(row.totalTokens)}</td>
                  <td>{formatMicroUsd(row.costMicroUsd)}</td>
                  <td>{formatPercent(row.cacheHitRate)}</td>
                </tr>
              ))}
              {model.projectUsageRows.length === 0 ? <EmptyTableRow colSpan={7} /> : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function GatewayAdminPlaceholder({
  description,
  model,
  rows,
  title
}: {
  description: string;
  model: GatewayAdminModel;
  rows?: InvocationLogRecord[];
  title: string;
}) {
  return (
    <div className={styles.stack}>
      <section className={`console-panel ${styles.placeholder}`}>
        <div>
          <p className="console-kicker">Read-only MVP</p>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
      </section>
      {rows ? (
        <section className="console-panel">
          <div className="panel-heading">
            <h2>Recent safe records</h2>
          </div>
          <RequestLogTable records={rows} />
        </section>
      ) : (
        <section className={styles.grid}>
          <MetricCard label="Requests" value={formatInteger(model.records.length)} />
          <MetricCard label="Estimated cost" value={formatMicroUsd(sumRecordCost(model.records))} />
          <MetricCard label="Cache hits" value={formatInteger(model.records.filter((record) => record.cacheStatus === "hit").length)} />
        </section>
      )}
    </div>
  );
}

function RangeNav({
  activeRange,
  section
}: {
  activeRange: GatewayAdminRange;
  section: GatewayAdminSection;
}) {
  const ranges: GatewayAdminRange[] = ["15m", "1h", "1d", "1w"];

  return (
    <nav className={styles.rangeNav} aria-label="Gateway admin range">
      {ranges.map((range) => (
        <Link data-active={activeRange === range} href={gatewayAdminHref(section, { range })} key={range}>
          {rangeLabels[range]}
        </Link>
      ))}
    </nav>
  );
}

function WarningStrip({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) {
    return null;
  }

  return (
    <section className={styles.warningStrip}>
      {warnings.map((warning, index) => (
        <span key={`${warning}-${index}`}>{warning}</span>
      ))}
    </section>
  );
}

function MetricCard({
  detail,
  icon,
  label,
  status,
  value
}: {
  detail?: string;
  icon?: ReactNode;
  label: string;
  status?: string;
  value: string;
}) {
  return (
    <article className={styles.metric} data-status={status}>
      <div>
        {icon}
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </article>
  );
}

function ProviderHealthList({ model }: { model: GatewayAdminModel }) {
  if (model.providerRows.length === 0) {
    return <EmptyState label="No provider traffic yet." />;
  }

  return (
    <div className="compact-list">
      {model.providerRows.slice(0, 6).map((row) => (
        <div className="compact-row" key={row.provider}>
          <span>
            {row.provider}
            <small>{formatInteger(row.requestCount)} requests</small>
          </span>
          <StatusBadge status={row.health}>{row.health}</StatusBadge>
        </div>
      ))}
    </div>
  );
}

function RecentIncidentList({ records }: { records: InvocationLogRecord[] }) {
  if (records.length === 0) {
    return <EmptyState label="No recent blocked, rate-limited, or failed requests." />;
  }

  return (
    <div className="compact-list">
      {records.map((record) => (
        <div className="compact-row" key={record.requestId}>
          <span>
            {formatDisplayIdentifier(record.requestId)}
            <small>
              {formatDateTime(record.createdAt)} / {record.selectedProvider ?? "not-routed"}
            </small>
          </span>
          <StatusBadge status={record.status}>{record.status}</StatusBadge>
        </div>
      ))}
    </div>
  );
}

function TenantTable({ model }: { model: GatewayAdminModel }) {
  return (
    <div className="table-wrap">
      <table className={`data-table ${styles.table}`}>
        <thead>
          <tr>
            <th>Tenant</th>
            <th>Projects</th>
            <th>Requests</th>
            <th>Error rate</th>
            <th>Tokens</th>
            <th>Estimated cost</th>
            <th>Budget</th>
          </tr>
        </thead>
        <tbody>
          {model.tenantRows.map((row) => (
            <tr key={row.tenantId}>
              <td>
                <strong>{formatDisplayIdentifier(row.tenantId)}</strong>
                <small>{row.activeProjectCount} active projects</small>
              </td>
              <td>{formatInteger(row.projectCount)}</td>
              <td>{formatInteger(row.requestCount)}</td>
              <td>{formatPercent(row.errorRate)}</td>
              <td>{formatInteger(row.totalTokens)}</td>
              <td>{formatMicroUsd(row.costMicroUsd)}</td>
              <td>{formatUsd(row.budgetUsd.toFixed(2))}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrafficFilterBar({ model }: { model: GatewayAdminModel }) {
  const providers = unique(model.providerRows.map((row) => row.provider));
  const models = unique(model.records.flatMap((record) => [record.selectedModel, record.requestedModel]).filter(Boolean));

  return (
    <form action="/admin/gateway/traffic" className={styles.filterBar}>
      <input name="range" type="hidden" value={model.filters.range} />
      <label>
        <span>Provider</span>
        <select defaultValue={model.filters.provider ?? ""} name="provider">
          <option value="">All</option>
          {providers.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Model</span>
        <select defaultValue={model.filters.model ?? ""} name="model">
          <option value="">All</option>
          {models.map((modelName) => (
            <option key={modelName} value={modelName}>
              {formatModelDisplayName(modelName)}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Status</span>
        <select defaultValue={model.filters.status ?? ""} name="status">
          <option value="">All</option>
          <option value="success">success</option>
          <option value="blocked">blocked</option>
          <option value="rate_limited">rate_limited</option>
          <option value="failed">failed</option>
          <option value="cancelled">cancelled</option>
        </select>
      </label>
      <button className="secondary-button" type="submit">
        Apply
      </button>
    </form>
  );
}

function RequestLogTable({ records }: { records: InvocationLogRecord[] }) {
  return (
    <div className="table-wrap">
      <table className={`data-table ${styles.table}`}>
        <thead>
          <tr>
            <th>Request</th>
            <th>Created</th>
            <th>Project</th>
            <th>Provider / Model</th>
            <th>Status</th>
            <th>Latency</th>
            <th>Tokens</th>
            <th>Cost</th>
            <th>Cache</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.requestId}>
              <td>{formatDisplayIdentifier(record.requestId)}</td>
              <td>{formatDateTime(record.createdAt, DEFAULT_DISPLAY_TIMEZONE)}</td>
              <td>{formatDisplayIdentifier(record.projectId)}</td>
              <td>
                <strong>{record.selectedProvider ?? "not-routed"}</strong>
                <small>{formatModelDisplayName(record.selectedModel ?? record.requestedModel ?? "not-selected")}</small>
              </td>
              <td>
                <StatusBadge status={record.status}>{record.status}</StatusBadge>
              </td>
              <td>{formatLatency(record.latencyMs)}</td>
              <td>{formatInteger(record.totalTokens)}</td>
              <td>{formatMicroUsd(record.costMicroUsd)}</td>
              <td>{record.cacheStatus}</td>
            </tr>
          ))}
          {records.length === 0 ? <EmptyTableRow colSpan={9} /> : null}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({
  children,
  status
}: {
  children: ReactNode;
  status: string;
}) {
  return (
    <span className={styles.status} data-status={status}>
      {children}
    </span>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className={styles.empty}>{label}</p>;
}

function EmptyTableRow({ colSpan }: { colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan}>No safe records available.</td>
    </tr>
  );
}

function gatewayAdminHref(
  section: GatewayAdminSection,
  filters: Partial<{
    model?: string;
    projectId?: string;
    provider?: string;
    range?: GatewayAdminRange;
    status?: string;
  }>
) {
  const query = new URLSearchParams();
  appendQuery(query, "range", filters.range);
  appendQuery(query, "provider", filters.provider);
  appendQuery(query, "model", filters.model);
  appendQuery(query, "projectId", filters.projectId);
  appendQuery(query, "status", filters.status);
  const serialized = query.toString();

  return `/admin/gateway/${section}${serialized ? `?${serialized}` : ""}`;
}

function appendQuery(query: URLSearchParams, key: string, value: string | undefined) {
  if (value) {
    query.set(key, value);
  }
}

function formatMicroUsd(value: number) {
  return formatUsd((value / 1_000_000).toFixed(6));
}

function safeRate(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function sumRecordTokens(records: InvocationLogRecord[]) {
  return records.reduce((total, record) => total + record.totalTokens, 0);
}

function sumRecordCost(records: InvocationLogRecord[]) {
  return records.reduce((total, record) => total + record.costMicroUsd, 0);
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0))
  ).sort((left, right) => left.localeCompare(right));
}







