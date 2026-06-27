import Link from "next/link";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
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
  tenantId: string;
  timezone: string;
};

const requestLogText: Record<
  Locale,
  {
    emptyPreview: string;
    heroCopy: string;
    kicker: string;
    title: string;
  }
> = {
  en: {
    emptyPreview: "No preview stored",
    heroCopy:
      "The list is backed by the v1 invocation log fixture. It shows only sanitized previews and request metadata.",
    kicker: "request log",
    title: "Invocation history"
  },
  ko: {
    emptyPreview: "저장된 preview 없음",
    heroCopy:
      "이 목록은 v1 invocation log fixture 기반입니다. 정제된 preview와 요청 metadata만 표시합니다.",
    kicker: "요청 로그",
    title: "호출 이력"
  }
};

export function RequestLogTable({ locale, records, tenantId, timezone }: RequestLogTableProps) {
  const text = requestLogText[locale];

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.kicker}</p>
          <h2>{text.title}</h2>
          <p>{text.heroCopy}</p>
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
