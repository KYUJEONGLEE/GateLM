import Link from "next/link";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import {
  formatDateTime,
  formatInteger,
  formatLatency,
  nullableText
} from "@/lib/formatting/formatters";
import { StatusBadge } from "@/features/request-logs/components/request-log-table";

type RequestLogDetailProps = {
  record: InvocationLogRecord;
  tenantId: string;
  timezone: string;
};

export function RequestLogDetail({ record, tenantId, timezone }: RequestLogDetailProps) {
  const runtimeSnapshot = record.metadata.runtime.runtimeSnapshot;

  return (
    <main className="console-content">
      <section className="detail-header">
        <div>
          <Link className="back-link" href={`/tenants/${tenantId}/request-logs`}>
            Back to request logs
          </Link>
          <h2>{record.requestId}</h2>
          <p>
            Detail view uses sanitized metadata only. Raw prompt, raw response,
            plaintext credentials, and authorization headers are not displayed.
          </p>
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
            ["Tenant", record.tenantId],
            ["Project", record.projectId],
            ["Application", record.applicationId],
            ["API key ID", record.apiKeyId],
            ["App token ID", record.appTokenId],
            ["End user", nullableText(record.endUserId)],
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
            ["Cache hit request", nullableText(record.cacheHitRequestId)]
          ]}
        />

        <DetailPanel
          title="Safety"
          rows={[
            ["Masking action", record.maskingAction],
            ["Detected count", String(record.maskingDetectedCount)],
            ["Detected types", record.maskingDetectedTypes?.join(", ") || "none"],
            ["Prompt preview", nullableText(record.redactedPromptPreview, "No preview stored")],
            ["Prompt hash", record.promptHash]
          ]}
        />

        <DetailPanel
          title="Governance"
          rows={[
            ["Rate limit allowed", record.rateLimitDecision.allowed ? "yes" : "no"],
            ["Scope", `${record.rateLimitDecision.scope}:${record.rateLimitDecision.scopeId}`],
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
            ["Error code", nullableText(record.errorCode, "none")],
            ["Error stage", nullableText(record.errorStage, "none")],
            ["Message", nullableText(record.errorMessage, "none")]
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
            ["Cache key hash", nullableText(record.cacheKeyHash, "none")]
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
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
