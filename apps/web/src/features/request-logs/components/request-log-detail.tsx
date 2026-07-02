import Link from "next/link";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { formatDisplayIdentifier } from "@/lib/formatting/display-identifiers";
import {
  formatDateTime,
  formatInteger,
  formatLatency,
  nullableText
} from "@/lib/formatting/formatters";
import { StatusBadge } from "@/features/request-logs/components/request-log-table";
import type { Locale } from "@/lib/i18n/locale";
import { RequestLogDetailDismissLink } from "./request-log-detail-dismiss-link";

type RequestLogDetailProps = {
  locale: Locale;
  record: InvocationLogRecord;
  tenantId: string;
  timezone: string;
};

const requestDetailText: Record<
  Locale,
  {
    back: string;
    close: string;
    detailTitle: string;
    emptyPreview: string;
    none: string;
    noPreview: string;
    yes: string;
    no: string;
  }
> = {
  en: {
    back: "Back to request logs",
    close: "Close",
    detailTitle: "Request detail",
    emptyPreview: "No preview stored",
    none: "none",
    noPreview: "No preview stored",
    no: "no",
    yes: "yes"
  },
  ko: {
    back: "요청 로그로 돌아가기",
    close: "닫기",
    detailTitle: "요청 상세",
    emptyPreview: "저장된 preview 없음",
    none: "없음",
    noPreview: "저장된 preview 없음",
    no: "아니오",
    yes: "예"
  }
};

export function RequestLogDetail({
  locale,
  record,
  tenantId,
  timezone
}: RequestLogDetailProps) {
  const text = requestDetailText[locale];

  return (
    <main className="console-content">
      <section className="detail-header">
        <div>
          <Link className="back-link" href={`/tenants/${tenantId}/request-logs`}>
            {text.back}
          </Link>
          <h2>{formatDisplayIdentifier(record.requestId)}</h2>
        </div>
        <StatusBadge status={record.status} />
      </section>

      <section className="detail-grid detail-stack-grid">
        <RequestLogDetailPanel locale={locale} record={record} timezone={timezone} />
      </section>
    </main>
  );
}

export function RequestLogDetailAside({
  locale,
  record,
  tenantId,
  timezone
}: RequestLogDetailProps) {
  const closeHref = `/tenants/${tenantId}/request-logs`;
  const text = requestDetailText[locale];

  return (
    <>
      <RequestLogDetailDismissLink
        ariaLabel={text.close}
        className="request-log-detail-backdrop"
        href={closeHref}
      />
      <aside aria-label="Request detail" className="request-log-detail-aside" role="dialog">
        <div className="request-log-detail-aside-header">
          <div>
            <span>{text.detailTitle}</span>
            <h3>{formatDisplayIdentifier(record.requestId)}</h3>
          </div>
          <StatusBadge status={record.status} />
          <RequestLogDetailDismissLink
            ariaLabel={text.close}
            className="request-log-detail-close"
            href={closeHref}
          >
            X
          </RequestLogDetailDismissLink>
        </div>
        <RequestLogDetailPanel locale={locale} record={record} timezone={timezone} />
      </aside>
    </>
  );
}

export function RequestLogDetailPanel({
  locale,
  record,
  timezone
}: Omit<RequestLogDetailProps, "tenantId">) {
  const text = requestDetailText[locale];
  const domainOutcomes = record.domainOutcomes;
  const hasErrorDetail = Boolean(record.errorCode || record.errorStage || record.errorMessage);

  return (
    <article className="console-panel detail-panel detail-panel-stack">
      <DetailSection
        title="Request context"
        rows={[
          ["Created", formatDateTime(record.createdAt, timezone)],
          ["Completed", formatDateTime(record.completedAt, timezone)],
          ["HTTP status", String(record.httpStatus)]
        ]}
      />

      <DetailSection
        title="Safety"
        rows={[
          [
            "Outcome",
            record.safetySummary?.outcome ?? domainOutcomes?.safety?.outcome ?? record.maskingAction
          ],
          ["Masking action", record.safetySummary?.maskingAction ?? record.maskingAction],
          [
            "Detected count",
            String(record.safetySummary?.detectedCount ?? record.maskingDetectedCount)
          ],
          [
            "Detected types",
            record.safetySummary?.detectorCategories?.join(", ") ||
              record.maskingDetectedTypes?.join(", ") ||
              text.none
          ],
          ["Prompt preview", nullableText(record.redactedPromptPreview, text.emptyPreview)]
        ]}
      />

      <DetailSection
        title="Identity"
        rows={[
          ["Project", formatProjectDisplayName(record.projectId)],
          ["Application", formatApplicationDisplayName(record.applicationId)]
        ]}
      />

      <DetailSection
        title="Gateway outcome"
        rows={[
          ["Terminal status", record.terminalStatus ?? record.status],
          ["Rate limit", domainOutcomes?.rateLimit?.outcome ?? text.none],
          ["Safety", domainOutcomes?.safety?.outcome ?? text.none],
          ["Routing", domainOutcomes?.routing?.outcome ?? text.none],
          ["Cache", domainOutcomes?.cache?.outcome ?? text.none],
          ["Provider", domainOutcomes?.provider?.outcome ?? text.none],
          ["Fallback", domainOutcomes?.fallback?.outcome ?? text.none]
        ]}
      />

      <DetailSection
        title="Routing and cache"
        rows={[
          ["Selected provider", nullableText(record.selectedProvider)],
          ["Selected model", nullableText(record.selectedModel)],
          ["Cache", `${record.cacheType}:${record.cacheStatus}`],
          [
            "Cache hit request",
            nullableText(
              record.cacheHitRequestId ? formatDisplayIdentifier(record.cacheHitRequestId) : null
            )
          ]
        ]}
      />

      <DetailSection
        title="Usage and latency"
        rows={[
          ["Total tokens", formatInteger(record.totalTokens)],
          ["Estimated cost", formatMicroUsd(record.costMicroUsd)],
          ["Saved cost", formatMicroUsd(record.savedCostMicroUsd)],
          ["Latency", formatLatency(record.latencyMs)],
          [
            "Provider latency",
            formatLatency(record.latencySummary?.providerLatencyMs ?? record.providerLatencyMs)
          ]
        ]}
      />

      {hasErrorDetail ? (
        <DetailSection
          title="Error"
          rows={[
            ["Error code", nullableText(record.errorCode, text.none)],
            ["Error stage", nullableText(record.errorStage, text.none)],
            ["Message", nullableText(record.errorMessage, text.none)]
          ]}
        />
      ) : null}
    </article>
  );
}

function DetailSection({ rows, title }: { rows: Array<[string, string]>; title: string }) {
  return (
    <section className="detail-section">
      <h3>{title}</h3>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatDisplayIdentifier(value)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function formatProjectDisplayName(projectId: string) {
  const normalized = formatDisplayIdentifier(projectId);

  if (
    projectId === "live_gateway_project" ||
    projectId === "00000000-0000-4000-8000-000000000200"
  ) {
    return "Default project";
  }

  if (normalized.includes("synthetic")) {
    return "Synthetic project";
  }

  if (normalized.includes("project_ai")) {
    return "AI project";
  }

  return identifierToDisplayName(normalized, "Project");
}

function formatApplicationDisplayName(applicationId: string) {
  const normalized = formatDisplayIdentifier(applicationId);

  if (applicationId === "live_gateway_application" || normalized === "app_customer") {
    return "Acme Support";
  }

  if (normalized.includes("employee_chat")) {
    return "Employee Chat";
  }

  return identifierToDisplayName(normalized, "Application");
}

function formatMicroUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
    style: "currency"
  }).format(value / 1_000_000);
}

function identifierToDisplayName(value: string, fallback: string) {
  const normalized = value
    .replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, "")
    .replace(/^(app|application|project)_/i, "")
    .replaceAll(/[_-]+/g, " ")
    .trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.replaceAll(/\b\w/g, (character) => character.toUpperCase());
}
