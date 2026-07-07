import Link from "next/link";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import {
  formatBudgetScopeDisplayName,
  formatDisplayIdentifier
} from "@/lib/formatting/display-identifiers";
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
    capturedPrompt: string;
    none: string;
    noPreview: string;
    promptCapture: string;
    truncated: string;
    yes: string;
    no: string;
  }
> = {
  en: {
    back: "Back to request logs",
    close: "Close",
    detailTitle: "Request detail",
    emptyPreview: "No preview stored",
    capturedPrompt: "Captured prompt",
    none: "none",
    noPreview: "No preview stored",
    promptCapture: "Prompt capture",
    truncated: "Truncated",
    no: "no",
    yes: "yes"
  },
  ko: {
    back: "요청 로그로 돌아가기",
    close: "닫기",
    detailTitle: "요청 상세",
    emptyPreview: "저장된 preview 없음",
    capturedPrompt: "캡처된 프롬프트",
    none: "없음",
    noPreview: "저장된 preview 없음",
    promptCapture: "프롬프트 캡처",
    truncated: "잘림 여부",
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
  const runtimeSnapshot = record.metadata?.runtime?.runtimeSnapshot;

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
          [
            "Policy allowed types",
            record.safetySummary?.policyAllowedTypes?.join(", ") || text.none
          ],
          [
            "Mandatory protected types",
            record.safetySummary?.mandatoryProtectedTypes?.join(", ") || text.none
          ],
          ["Prompt preview", nullableText(record.redactedPromptPreview, text.emptyPreview)]
        ]}
      />

      {record.promptCapture?.enabled && record.promptCapture.capturedPrompt ? (
        <section className="detail-section">
          <h3>{text.promptCapture}</h3>
          <dl>
            <div>
              <dt>{text.capturedPrompt}</dt>
              <dd className="detail-preformatted">{record.promptCapture.capturedPrompt}</dd>
            </div>
            <div>
              <dt>{text.truncated}</dt>
              <dd>{record.promptCapture.truncated ? text.yes : text.no}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <DetailSection
        title="Project policy"
        rows={[
          ["Project ID", record.projectId],
          ["Budget attribution", formatBudgetScopeDisplayName(record.budgetScope)],
          ["Resolved by", record.budgetScope.resolvedBy]
        ]}
      />

      <DetailSection
        title="Advanced / Runtime boundary"
        rows={[
          ["Application ID", record.applicationId],
          ["Budget scope type", record.budgetScope.budgetScopeType],
          ["Budget scope ID", record.budgetScope.budgetScopeId],
          ["Runtime state", runtimeSnapshot?.runtimeState ?? text.none],
          ["Runtime snapshot", runtimeSnapshot?.runtimeSnapshotId ?? text.none],
          [
            "Snapshot version",
            runtimeSnapshot ? String(runtimeSnapshot.runtimeSnapshotVersion) : text.none
          ],
          ["Gateway instance", runtimeSnapshot?.gatewayInstanceId ?? text.none]
        ]}
      />

      <DetailSection
        title="Gateway outcome"
        rows={[
          ["Terminal status", record.terminalStatus ?? record.status],
          ["Auth", domainOutcomes?.auth?.outcome ?? text.none],
          ["Runtime", domainOutcomes?.runtime?.outcome ?? text.none],
          ["Rate limit", domainOutcomes?.rateLimit?.outcome ?? text.none],
          ["Budget", domainOutcomes?.budget?.outcome ?? text.none],
          ["Safety", domainOutcomes?.safety?.outcome ?? text.none],
          ["Routing", domainOutcomes?.routing?.outcome ?? text.none],
          ["Cache", domainOutcomes?.cache?.outcome ?? text.none],
          ["Provider", domainOutcomes?.provider?.outcome ?? text.none],
          ["Fallback", domainOutcomes?.fallback?.outcome ?? text.none],
          ["Streaming", domainOutcomes?.streaming?.outcome ?? text.none],
          ["Logging", domainOutcomes?.logging?.outcome ?? text.none]
        ]}
      />

      <DetailSection
        title="Routing and cache"
        rows={[
          ["Selected provider", nullableText(record.selectedProvider)],
          ["Selected model", nullableText(record.selectedModel)],
          ["Provider called", record.providerCalled ? text.yes : text.no],
          ["Routing reason", nullableText(record.routingReason, text.none)],
          ["Cache", `${record.cacheType}:${record.cacheStatus}`],
          ["Cache decision", nullableText(record.cacheDecisionReason, text.none)],
          [
            "Cache hit request",
            nullableText(
              record.cacheHitRequestId ? formatDisplayIdentifier(record.cacheHitRequestId) : null
            )
          ],
          ["Prompt category", nullableText(record.promptCategory, text.none)]
        ]}
      />

      <DetailSection
        title="Usage and latency"
        rows={[
          ["Total tokens", formatInteger(record.totalTokens)],
          ["Estimated cost", formatMicroUsd(record.costMicroUsd)],
          ["Saved cost", formatMicroUsd(record.savedCostMicroUsd)],
          ["Total latency", formatLatency(record.latencySummary?.totalLatencyMs ?? record.latencyMs)],
          [
            "Gateway latency",
            formatLatency(record.latencySummary?.gatewayInternalLatencyMs ?? record.latencyMs)
          ],
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

function formatMicroUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
    style: "currency"
  }).format(value / 1_000_000);
}
