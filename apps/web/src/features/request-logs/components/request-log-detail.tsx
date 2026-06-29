import Link from "next/link";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import {
  formatDisplayIdentifier,
  formatTenantDisplayName
} from "@/lib/formatting/display-identifiers";
import {
  formatDateTime,
  formatInteger,
  formatLatency,
  nullableText
} from "@/lib/formatting/formatters";
import { StatusBadge } from "@/features/request-logs/components/request-log-table";
import type { Locale } from "@/lib/i18n/locale";

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
    emptyPreview: string;
    none: string;
    noPreview: string;
    yes: string;
    no: string;
  }
> = {
  en: {
    back: "Back to request logs",
    emptyPreview: "No preview stored",
    none: "none",
    noPreview: "No preview stored",
    no: "no",
    yes: "yes"
  },
  ko: {
    back: "요청 로그로 돌아가기",
    emptyPreview: "저장된 preview 없음",
    none: "없음",
    noPreview: "저장된 preview 없음",
    no: "아니오",
    yes: "예"
  }
};

export function RequestLogDetail({ locale, record, tenantId, timezone }: RequestLogDetailProps) {
  const text = requestDetailText[locale];
  const runtimeSnapshot = record.metadata.runtime.runtimeSnapshot;

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

      <section className="detail-grid">
        <DetailPanel
          title="Request context"
          rows={[
            ["Trace ID", record.traceId],
            ["Endpoint", `${record.method} ${record.endpoint}`],
            ["Source", record.source],
            ["Created", formatDateTime(record.createdAt, timezone)],
            ["Completed", formatDateTime(record.completedAt, timezone)],
            ["HTTP status", String(record.httpStatus)]
          ]}
        />

        <DetailPanel
          title="Identity"
          rows={[
            ["Tenant", formatTenantDisplayName(record.tenantId)],
            ["Project", record.projectId],
            ["Application", formatDisplayIdentifier(record.applicationId)],
            ["API key ID", record.apiKeyId],
            ["App token ID", record.appTokenId],
            ["End user", nullableText(record.endUserId ? formatDisplayIdentifier(record.endUserId) : null)],
            ["Feature", nullableText(record.featureId)]
          ]}
        />

        <DetailPanel
          title="Routing and cache"
          rows={[
            ["Requested model", nullableText(record.requestedModel)],
            ["Selected provider", nullableText(record.selectedProvider)],
            ["Selected model", nullableText(record.selectedModel)],
            ["Routing reason", nullableText(record.routingReason)],
            ["Cache", `${record.cacheType}:${record.cacheStatus}`],
            [
              "Cache hit request",
              nullableText(
                record.cacheHitRequestId ? formatDisplayIdentifier(record.cacheHitRequestId) : null
              )
            ]
          ]}
        />

        <DetailPanel
          title="Safety"
          rows={[
            ["Masking action", record.maskingAction],
            ["Detected count", String(record.maskingDetectedCount)],
            ["Detected types", record.maskingDetectedTypes?.join(", ") || text.none],
            ["Prompt preview", nullableText(record.redactedPromptPreview, text.emptyPreview)],
            ["Prompt hash", record.promptHash]
          ]}
        />

        <DetailPanel
          title="Governance"
          rows={[
            ["Rate limit allowed", record.rateLimitDecision.allowed ? text.yes : text.no],
            [
              "Scope",
              `${record.rateLimitDecision.scope}:${formatDisplayIdentifier(record.rateLimitDecision.scopeId)}`
            ],
            ["Limit", String(record.rateLimitDecision.limit)],
            ["Remaining", String(record.rateLimitDecision.remaining)],
            ["Reason", record.rateLimitDecision.reason],
            ["Retry after", `${record.rateLimitDecision.retryAfterSeconds}s`]
          ]}
        />

        <DetailPanel
          title="Usage and latency"
          rows={[
            ["Prompt tokens", formatInteger(record.promptTokens)],
            ["Completion tokens", formatInteger(record.completionTokens)],
            ["Total tokens", formatInteger(record.totalTokens)],
            ["Cost micro USD", formatInteger(record.costMicroUsd)],
            ["Saved cost micro USD", formatInteger(record.savedCostMicroUsd)],
            ["Latency", formatLatency(record.latencyMs)],
            ["Provider latency", formatLatency(record.providerLatencyMs)]
          ]}
        />

        <DetailPanel
          title="Error"
          rows={[
            ["Error code", nullableText(record.errorCode, text.none)],
            ["Error stage", nullableText(record.errorStage, text.none)],
            ["Message", nullableText(record.errorMessage, text.none)]
          ]}
        />

        <DetailPanel
          title="RuntimeSnapshot provenance"
          rows={[
            ["Snapshot ID", runtimeSnapshot.runtimeSnapshotId],
            ["Snapshot version", String(runtimeSnapshot.runtimeSnapshotVersion)],
            ["Runtime state", runtimeSnapshot.runtimeState],
            ["Content hash", runtimeSnapshot.contentHash],
            ["Published", formatDateTime(runtimeSnapshot.publishedAt, timezone)],
            ["Published by", runtimeSnapshot.publishedBy],
            ["Gateway instance", runtimeSnapshot.gatewayInstanceId],
            ["Legacy config hash", runtimeSnapshot.legacyHashes.configHash],
            ["Legacy security policy hash", runtimeSnapshot.legacyHashes.securityPolicyHash],
            ["Legacy routing policy hash", runtimeSnapshot.legacyHashes.routingPolicyHash],
            ["Request body hash", record.requestBodyHash],
            ["Cache key hash", nullableText(record.cacheKeyHash, text.none)]
          ]}
        />
      </section>
    </main>
  );
}

function DetailPanel({ rows, title }: { rows: Array<[string, string]>; title: string }) {
  return (
    <article className="console-panel detail-panel">
      <h3>{title}</h3>
      <dl>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{formatDisplayIdentifier(value)}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
