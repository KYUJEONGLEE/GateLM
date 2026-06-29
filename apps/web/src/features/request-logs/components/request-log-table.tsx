import Link from "next/link";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { formatDisplayIdentifier } from "@/lib/formatting/display-identifiers";
import {
  formatDateTime,
  formatInteger,
  formatLatency,
  nullableText
} from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type RequestLogTableProps = {
  locale: Locale;
  records: InvocationLogRecord[];
  sourceState: "ready" | "unavailable";
  tenantId: string;
  timezone: string;
};

const requestLogText: Record<
  Locale,
  {
    emptyPreview: string;
    kicker: string;
    title: string;
  }
> = {
  en: {
    emptyPreview: "No preview stored",
    kicker: "analytics",
    title: "Request logs"
  },
  ko: {
    emptyPreview: "저장된 preview 없음",
    kicker: "분석",
    title: "요청 로그"
  }
};

export function RequestLogTable({
  locale,
  records,
  sourceState,
  tenantId,
  timezone
}: RequestLogTableProps) {
  const text = requestLogText[locale];

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.kicker}</p>
          <h2>{text.title}</h2>
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
              {sourceState === "unavailable" ? (
                <tr>
                  <td colSpan={8}>Live Gateway request logs are not available right now.</td>
                </tr>
              ) : null}
              {sourceState === "ready" && records.length === 0 ? (
                <tr>
                  <td colSpan={8}>No Gateway request logs found for the current range.</td>
                </tr>
              ) : null}
              {records.map((record) => (
                <tr key={record.requestId}>
                  <td>
                    <Link
                      className="request-link"
                      href={`/tenants/${tenantId}/request-logs/${record.requestId}`}
                    >
                      {formatDisplayIdentifier(record.requestId)}
                    </Link>
                    <span>{nullableText(record.redactedPromptPreview, text.emptyPreview)}</span>
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
