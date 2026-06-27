import Link from "next/link";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import {
  formatDateTime,
  formatInteger,
  formatLatency,
  nullableText
} from "@/lib/formatting/formatters";

type RequestLogTableProps = {
  records: InvocationLogRecord[];
  tenantId: string;
  timezone: string;
};

export function RequestLogTable({ records, tenantId, timezone }: RequestLogTableProps) {
  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">request log</p>
          <h2>Invocation history</h2>
          <p>
            The list is backed by the v1 invocation log fixture. It shows only
            sanitized previews and request metadata.
          </p>
        </div>
      </section>

      <section className="console-panel">
        <div className="table-wrap">
          <table className="data-table request-table">
            <thead>
              <tr>
                <th>Request</th>
                <th>Status</th>
                <th>Model</th>
                <th>Safety</th>
                <th>Cache</th>
                <th>Latency</th>
                <th>Tokens</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.requestId}>
                  <td>
                    <Link
                      className="request-link"
                      href={`/tenants/${tenantId}/request-logs/${record.requestId}`}
                    >
                      {record.requestId}
                    </Link>
                    <span>{nullableText(record.redactedPromptPreview, "No preview stored")}</span>
                  </td>
                  <td>
                    <StatusBadge status={record.status} />
                  </td>
                  <td>{nullableText(record.selectedModel, record.requestedModel ?? "not routed")}</td>
                  <td>{record.maskingAction}</td>
                  <td>
                    {record.cacheType}:{record.cacheStatus}
                  </td>
                  <td>{formatLatency(record.latencyMs)}</td>
                  <td>{formatInteger(record.totalTokens)}</td>
                  <td>{formatDateTime(record.createdAt, timezone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export function StatusBadge({ status }: { status: InvocationLogRecord["status"] }) {
  return (
    <span className="status-badge" data-status={status}>
      {status}
    </span>
  );
}
