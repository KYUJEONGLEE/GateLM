import {
  Boxes,
  BriefcaseBusiness,
  CalendarClock,
  ChevronDown,
  Coins,
  Database,
  KeyRound,
  PlugZap,
  Route,
  ShieldCheck,
  Timer
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import { GatewayPipeline } from "./gateway-pipeline";
import { RequestIdCopyButton } from "./request-id-copy-button";
import { RequestLogDetailDismissLink } from "./request-log-detail-dismiss-link";
import { StatusBadge } from "./request-log-status-badge";
import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";
import {
  formatBudgetScopeDisplayName,
  formatDisplayIdentifier,
  formatModelDisplayName
} from "@/lib/formatting/display-identifiers";
import {
  resolveProviderDisplay,
  type ProviderDisplayDirectory
} from "@/lib/control-plane/provider-display";
import {
  formatInteger,
  nullableText
} from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";
import { formatRequestLogTtft } from "../request-log-latency";
import {
  buildRequestLogSafetyDetail,
  maskingUnavailableLabel
} from "../request-log-safety-detail";

type RequestLogDetailProps = {
  locale: Locale;
  providerDirectory?: ProviderDisplayDirectory;
  record: LiveInvocationLogRecord;
  tenantId: string;
  timezone: string;
};

const requestDetailText: Record<
  Locale,
  {
    back: string;
    capturedPrompt: string;
    close: string;
    detailTitle: string;
    emptyPreview: string;
    no: string;
    none: string;
    promptCapture: string;
    truncated: string;
    yes: string;
  }
> = {
  en: {
    back: "Back to request logs",
    capturedPrompt: "Captured prompt",
    close: "Close",
    detailTitle: "Request detail",
    emptyPreview: "No preview stored",
    no: "no",
    none: "none",
    promptCapture: "Prompt capture",
    truncated: "Truncated",
    yes: "yes"
  },
  ko: {
    back: "요청 로그로 돌아가기",
    capturedPrompt: "캡처된 프롬프트",
    close: "닫기",
    detailTitle: "요청 상세",
    emptyPreview: "저장된 미리보기 없음",
    no: "아니오",
    none: "없음",
    promptCapture: "프롬프트 캡처",
    truncated: "잘림 여부",
    yes: "예"
  }
};

export function RequestLogDetail({
  locale,
  providerDirectory = {},
  record,
  tenantId,
  timezone
}: RequestLogDetailProps) {
  const text = requestDetailText[locale];

  return (
    <main className="console-content">
      <section className="detail-header">
        <div>
          <Link className="back-link" href={"/tenants/" + tenantId + "/request-logs"}>
            {text.back}
          </Link>
          <h2>{formatDisplayIdentifier(record.requestId)}</h2>
        </div>
        <StatusBadge label={requestStatusLabel(record, locale)} status={record.status} />
      </section>

      <section className="detail-grid detail-stack-grid">
        <RequestLogDetailPanel
          locale={locale}
          providerDirectory={providerDirectory}
          record={record}
          timezone={timezone}
        />
      </section>
    </main>
  );
}

export function RequestLogDetailAside({
  locale,
  providerDirectory = {},
  record,
  tenantId,
  timezone
}: RequestLogDetailProps) {
  const closeHref = "/tenants/" + tenantId + "/request-logs";
  const text = requestDetailText[locale];

  return (
    <>
      <RequestLogDetailDismissLink
        ariaLabel={text.close}
        className="request-log-detail-backdrop"
        href={closeHref}
      />
      <aside
        aria-label={text.detailTitle}
        className="request-log-detail-aside"
        role="dialog"
      >
        <div className="request-log-detail-aside-header">
          <div>
            <span>{text.detailTitle}</span>
            <h3>{formatDisplayIdentifier(record.requestId)}</h3>
          </div>
          <StatusBadge label={requestStatusLabel(record, locale)} status={record.status} />
          <RequestLogDetailDismissLink
            ariaLabel={text.close}
            className="request-log-detail-close"
            href={closeHref}
          >
            ×
          </RequestLogDetailDismissLink>
        </div>
        <RequestLogDetailPanel
          locale={locale}
          providerDirectory={providerDirectory}
          record={record}
          timezone={timezone}
        />
      </aside>
    </>
  );
}

export function RequestLogDetailPanel({
  locale,
  providerDirectory = {},
  record,
  timezone
}: Omit<RequestLogDetailProps, "tenantId">) {
  const text = requestDetailText[locale];
  const domainOutcomes = record.domainOutcomes;
  const runtimeSnapshot = record.metadata?.runtime?.runtimeSnapshot;
  const safetyDetail = buildRequestLogSafetyDetail(record);
  const maskingUnavailable = maskingUnavailableLabel(locale);
  const hasErrorDetail = Boolean(
    record.errorCode || record.errorStage || record.errorMessage
  );

  return (
    <article className="request-detail-workspace">
      <RequestSummary
        locale={locale}
        providerDirectory={providerDirectory}
        record={record}
        timezone={timezone}
      />
      <GatewayPipeline locale={locale} record={record} />

      <section
        aria-label={locale === "ko" ? "요청 세부 정보" : "Request detail sections"}
        className="request-detail-accordions"
      >
        <h3 className="request-detail-sections-title">
          {locale === "ko" ? "세부 정보" : "Details"}
        </h3>
        <DetailAccordion
          icon={<KeyRound aria-hidden="true" />}
          title={locale === "ko" ? "인증 및 컨텍스트" : "Authentication & Context"}
        >
          <DetailRows
            rows={[
              [detailLabel(locale, "Created", "요청 시각"), formatDetailDateTime(record.createdAt, timezone, locale)],
              [detailLabel(locale, "Completed", "완료 시각"), formatDetailDateTime(record.completedAt, timezone, locale)],
              [detailLabel(locale, "HTTP status", "HTTP 상태"), String(record.httpStatus)],
              [detailLabel(locale, "Project ID", "프로젝트 ID"), record.projectId],
              [detailLabel(locale, "Application ID", "애플리케이션 ID"), record.applicationId],
              [detailLabel(locale, "Auth outcome", "인증 결과"), localizedOutcome(domainOutcomes?.auth?.outcome, locale, text.none)],
              [detailLabel(locale, "Runtime outcome", "실행 환경 결과"), localizedOutcome(domainOutcomes?.runtime?.outcome, locale, text.none)],
              [detailLabel(locale, "Runtime state", "실행 환경 상태"), localizedOutcome(runtimeSnapshot?.runtimeState, locale, text.none)],
              [detailLabel(locale, "Runtime snapshot", "실행 스냅샷"), runtimeSnapshot?.runtimeSnapshotId ?? text.none],
              [
                detailLabel(locale, "Snapshot version", "스냅샷 버전"),
                runtimeSnapshot
                  ? String(runtimeSnapshot.runtimeSnapshotVersion)
                  : text.none
              ],
              [detailLabel(locale, "Gateway instance", "게이트웨이 인스턴스"), runtimeSnapshot?.gatewayInstanceId ?? text.none]
            ]}
          />
        </DetailAccordion>

        <DetailAccordion
          icon={<ShieldCheck aria-hidden="true" />}
          title={locale === "ko" ? "적용된 정책" : "Policies applied"}
        >
          <DetailRows
            rows={[
              [detailLabel(locale, "Budget attribution", "예산 귀속"), formatBudgetAttribution(record, locale)],
              [detailLabel(locale, "Budget scope type", "예산 범위 유형"), localizedCode(record.budgetScope.budgetScopeType, locale)],
              [detailLabel(locale, "Budget scope ID", "예산 범위 ID"), record.budgetScope.budgetScopeId],
              [detailLabel(locale, "Resolved by", "범위 결정 기준"), localizedCode(record.budgetScope.resolvedBy, locale)],
              [detailLabel(locale, "Rate limit", "요청 제한"), localizedOutcome(domainOutcomes?.rateLimit?.outcome, locale, text.none)],
              [detailLabel(locale, "Budget", "예산"), localizedOutcome(domainOutcomes?.budget?.outcome, locale, text.none)],
              [
                detailLabel(locale, "Safety", "안전 정책"),
                localizedOutcome(safetyDetail.outcome, locale, text.none)
              ],
              [
                detailLabel(locale, "Masking action", "마스킹 처리"),
                safetyDetail.maskingAction === null
                  ? maskingUnavailable
                  : localizedOutcome(safetyDetail.maskingAction, locale, text.none)
              ],
              [
                detailLabel(locale, "Detected count", "탐지 건수"),
                safetyDetail.detectedCount === null
                  ? maskingUnavailable
                  : String(safetyDetail.detectedCount)
              ],
              [
                detailLabel(locale, "Detected types", "탐지 유형"),
                safetyDetail.detectedTypes === null
                  ? maskingUnavailable
                  : localizedCodeList(safetyDetail.detectedTypes, locale, text.none)
              ],
              [
                detailLabel(locale, "Policy allowed types", "정책 허용 유형"),
                localizedCodeList(
                  record.safetySummary?.policyAllowedTypes,
                  locale,
                  text.none
                )
              ],
              [
                detailLabel(locale, "Mandatory protected types", "필수 보호 유형"),
                localizedCodeList(
                  record.safetySummary?.mandatoryProtectedTypes,
                  locale,
                  text.none
                )
              ],
              [
                detailLabel(locale, "Prompt preview", "프롬프트 미리보기"),
                nullableText(record.redactedPromptPreview, text.emptyPreview)
              ],
              ...(record.promptCapture?.enabled &&
              record.promptCapture.capturedPrompt
                ? ([
                    [
                      text.capturedPrompt,
                      <span className="detail-preformatted" key="captured-prompt">
                        {record.promptCapture.capturedPrompt}
                      </span>
                    ],
                    [
                      text.truncated,
                      record.promptCapture.truncated ? text.yes : text.no
                    ]
                  ] as DetailRow[])
                : [])
            ]}
          />
        </DetailAccordion>

        <DetailAccordion
          icon={<Route aria-hidden="true" />}
          title={locale === "ko" ? "라우팅 결정" : "Routing decision"}
        >
          <DetailRows
            rows={[
              [detailLabel(locale, "Outcome", "결과"), localizedOutcome(domainOutcomes?.routing?.outcome, locale, text.none)],
              [detailLabel(locale, "Requested model", "요청 모델"), nullableText(record.requestedModel, text.none)],
              [detailLabel(locale, "Model ref", "모델 참조"), nullableText(record.modelRef, text.none)],
              [detailLabel(locale, "Routing reason", "라우팅 근거"), localizedCode(record.routingReason, locale, text.none)],
              [detailLabel(locale, "Category", "카테고리"), localizedCode(record.category, locale, text.none)],
              [detailLabel(locale, "Difficulty", "난이도"), localizedCode(record.difficulty, locale, text.none)]
            ]}
          />
        </DetailAccordion>

        <DetailAccordion
          icon={<Database aria-hidden="true" />}
          title={locale === "ko" ? "캐시 결과" : "Cache result"}
        >
          <DetailRows
            rows={[
              [detailLabel(locale, "Outcome", "결과"), localizedOutcome(domainOutcomes?.cache?.outcome, locale, text.none)],
              [detailLabel(locale, "Cache", "캐시"), formatCacheResult(record, locale)],
              [
                detailLabel(locale, "Cache decision", "캐시 결정 근거"),
                localizedCode(record.cacheDecisionReason, locale, text.none)
              ],
              [
                detailLabel(locale, "Cache hit request", "캐시 적중 원본 요청"),
                nullableText(
                  record.cacheHitRequestId
                    ? formatDisplayIdentifier(record.cacheHitRequestId)
                    : null,
                  text.none
                )
              ],
              [detailLabel(locale, "Saved cost", "절감 비용"), formatMicroUsd(record.savedCostMicroUsd)]
            ]}
          />
        </DetailAccordion>

        <DetailAccordion
          icon={<PlugZap aria-hidden="true" />}
          title={locale === "ko" ? "프로바이더 호출" : "Provider call"}
        >
          <DetailRows
            rows={[
              [
                detailLabel(locale, "Provider called", "프로바이더 호출 여부"),
                record.providerCalled === undefined
                  ? text.none
                  : record.providerCalled ? text.yes : text.no
              ],
              [detailLabel(locale, "Provider outcome", "프로바이더 결과"), localizedOutcome(domainOutcomes?.provider?.outcome, locale, text.none)],
              [detailLabel(locale, "Provider ID", "프로바이더 ID"), nullableText(record.providerAttempt?.providerId, text.none)],
              [detailLabel(locale, "Model ID", "모델 ID"), nullableText(record.providerAttempt?.modelId, text.none)],
              [detailLabel(locale, "Attempt outcome", "시도 결과"), localizedOutcome(record.providerAttempt?.outcome, locale, text.none)],
              [detailLabel(locale, "Attempt latency", "시도 지연 시간"), formatDetailLatency(record.providerAttempt?.latencyMs ?? null, locale)],
              [detailLabel(locale, "Sanitized error code", "정제된 오류 코드"), nullableText(record.providerAttempt?.sanitizedErrorCode, text.none)],
              [detailLabel(locale, "Fallback outcome", "대체 경로 결과"), localizedOutcome(domainOutcomes?.fallback?.outcome, locale, text.none)],
              [detailLabel(locale, "Streaming", "스트리밍"), localizedOutcome(domainOutcomes?.streaming?.outcome, locale, text.none)],
              [detailLabel(locale, "Logging", "로그 기록"), localizedOutcome(domainOutcomes?.logging?.outcome, locale, text.none)],
              [detailLabel(locale, "Total tokens", "전체 토큰"), formatInteger(record.totalTokens)],
              [detailLabel(locale, "Estimated cost", "예상 비용"), formatMicroUsd(record.costMicroUsd)],
              [
                detailLabel(locale, "Total latency", "총 처리 시간"),
                formatDetailLatency(
                  record.latencySummary?.totalLatencyMs ?? record.latencyMs,
                  locale
                )
              ],
              [
                detailLabel(locale, "Time to first token (TTFT)", "첫 토큰 도착 시간(TTFT)"),
                formatRequestLogTtft(
                  record.latencySummary?.ttftMs ?? record.ttftMs
                )
              ],
              [
                detailLabel(locale, "Gateway latency", "게이트웨이 처리 시간"),
                record.latencySummary
                  ? formatDetailLatency(
                      record.latencySummary.gatewayInternalLatencyMs,
                      locale
                    )
                  : text.none
              ],
              [
                detailLabel(locale, "Provider latency", "프로바이더 처리 시간"),
                formatDetailLatency(
                  record.latencySummary?.providerLatencyMs ??
                    record.providerLatencyMs,
                  locale
                )
              ],
              ...(hasErrorDetail
                ? ([
                    [detailLabel(locale, "Error code", "오류 코드"), nullableText(record.errorCode, text.none)],
                    [detailLabel(locale, "Error stage", "오류 단계"), nullableText(record.errorStage, text.none)],
                    [
                      detailLabel(locale, "Sanitized message", "정제된 오류 메시지"),
                      nullableText(record.errorMessage, text.none)
                    ]
                  ] as DetailRow[])
                : [])
            ]}
          />
        </DetailAccordion>

        <DetailAccordion
          technical
          title={locale === "ko" ? "기술 정보 펼치기" : "Show technical information"}
        >
          <DetailRows
            rows={[
              [detailLabel(locale, "Request ID", "요청 ID"), record.requestId],
              [
                detailLabel(locale, "Terminal status", "최종 상태"),
                localizedOutcome(record.terminalStatus ?? record.status, locale, text.none)
              ],
              [
                detailLabel(locale, "Routing result", "라우팅 결과"),
                localizedOutcome(domainOutcomes?.routing?.outcome, locale, text.none)
              ],
              [detailLabel(locale, "Cache result", "캐시 결과"), formatCacheResult(record, locale)]
            ]}
          />
        </DetailAccordion>
      </section>
    </article>
  );
}

type DetailRow = [string, ReactNode];

function RequestSummary({
  locale,
  providerDirectory,
  record,
  timezone
}: {
  locale: Locale;
  providerDirectory: ProviderDisplayDirectory;
  record: LiveInvocationLogRecord;
  timezone: string;
}) {
  const model = record.providerAttempt?.modelId;
  const provider = resolveProviderDisplay(
    providerDirectory,
    record.providerAttempt?.providerId
  );
  const requestMode = record.requestedModel === "auto"
    ? "Auto routing"
    : formatModelDisplayName(record.requestedModel, "Manual routing");
  const providerLabel = provider?.name ?? (
    record.providerAttempt?.providerId
      ? formatDisplayIdentifier(record.providerAttempt.providerId)
      : null
  );
  const modelLabel = model
    ? formatModelDisplayName(model)
    : locale === "ko" ? "프로바이더 호출 없음" : "No provider call";

  return (
    <section
      aria-label={locale === "ko" ? "요청 요약" : "Request summary"}
      className="request-detail-summary"
    >
      <div className="request-detail-summary-id">
        <div>
          <span>{locale === "ko" ? "요청 ID" : "Request ID"}</span>
          <strong>{formatDisplayIdentifier(record.requestId)}</strong>
        </div>
        <RequestIdCopyButton locale={locale} requestId={record.requestId} />
      </div>
      <div
        className="request-detail-outcome"
        data-status-tone={requestSummaryTone(record)}
      >
        <span>{locale === "ko" ? "최종 결과" : "Final outcome"}</span>
        <strong>{requestStatusLabel(record, locale)}</strong>
      </div>
      <div
        aria-label={locale === "ko" ? "핵심 수치" : "Key metrics"}
        className="request-detail-key-metrics"
        role="group"
      >
        <SummaryMetric
          icon={<Timer aria-hidden="true" />}
          kind="key"
          label={locale === "ko" ? "총 처리 시간" : "Total processing"}
          value={formatDetailLatency(
            record.latencySummary?.totalLatencyMs ?? record.latencyMs,
            locale
          )}
        />
        <SummaryMetric
          icon={<Boxes aria-hidden="true" />}
          kind="key"
          label={locale === "ko" ? "사용 토큰" : "Tokens"}
          value={formatInteger(record.totalTokens)}
        />
        <SummaryMetric
          icon={<Coins aria-hidden="true" />}
          kind="key"
          label={locale === "ko" ? "예상 비용" : "Estimated cost"}
          value={formatMicroUsd(record.costMicroUsd)}
        />
      </div>
      <div
        aria-label={locale === "ko" ? "요청 컨텍스트" : "Request context"}
        className="request-detail-context-grid"
        role="group"
      >
        <SummaryMetric
          icon={<CalendarClock aria-hidden="true" />}
          label={locale === "ko" ? "요청 시각" : "Time"}
          value={formatSummaryTime(record.createdAt, timezone, locale)}
        />
        <SummaryMetric
          icon={<BriefcaseBusiness aria-hidden="true" />}
          label={locale === "ko" ? "프로젝트" : "Project"}
          value={record.projectName?.trim() || summaryIdentifier(record.projectId)}
        />
        <SummaryMetric
          icon={<Boxes aria-hidden="true" />}
          label={locale === "ko" ? "실행 모델" : "Executed model"}
          value={
            <span className="request-detail-summary-provider">
              {provider ? (
                <ProviderFamilyIcon
                  className="request-detail-provider-icon"
                  family={provider.family}
                  size={28}
                />
              ) : null}
              <span>
                <strong>{modelLabel}</strong>
                <small>
                  {providerLabel ? `${providerLabel} · ${requestMode}` : requestMode}
                </small>
              </span>
            </span>
          }
        />
      </div>
    </section>
  );
}

function SummaryMetric({
  icon,
  kind = "context",
  label,
  value
}: {
  icon: ReactNode;
  kind?: "context" | "key";
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="request-detail-summary-item" data-summary-kind={kind}>
      <span className="request-detail-summary-icon">{icon}</span>
      <span>
        <small>{label}</small>
        <span className="request-detail-summary-value">{value}</span>
      </span>
    </div>
  );
}

function DetailAccordion({
  children,
  icon,
  technical = false,
  title
}: {
  children: ReactNode;
  icon?: ReactNode;
  technical?: boolean;
  title: string;
}) {
  return (
    <details
      className="request-detail-accordion"
      data-technical={technical || undefined}
    >
      <summary>
        <span className="request-detail-accordion-title">
          {icon ? <span className="request-detail-accordion-icon">{icon}</span> : null}
          {title}
        </span>
        <ChevronDown aria-hidden="true" />
      </summary>
      <div className="request-detail-accordion-content">{children}</div>
    </details>
  );
}

function DetailRows({ rows }: { rows: DetailRow[] }) {
  return (
    <dl className="request-detail-rows">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{typeof value === "string" ? formatDisplayIdentifier(value) : value}</dd>
        </div>
      ))}
    </dl>
  );
}

function detailLabel(locale: Locale, english: string, korean: string) {
  return locale === "ko" ? korean : english;
}

function formatDetailDateTime(
  value: string | null | undefined,
  timezone: string,
  locale: Locale
) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: timezone
  }).format(date);
}

function formatSummaryTime(value: string, timezone: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  const languageTag = locale === "ko" ? "ko-KR" : "en-US";
  const time = new Intl.DateTimeFormat(languageTag, {
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
    timeZone: timezone
  }).format(date);
  const day = new Intl.DateTimeFormat(languageTag, {
    day: "numeric",
    month: "short",
    timeZone: timezone
  }).format(date);

  return (
    <span className="request-detail-summary-time">
      <strong>{time}</strong>
      <small>{day}</small>
    </span>
  );
}

function formatDetailLatency(value: number | null, locale: Locale) {
  return value === null
    ? locale === "ko" ? "호출 안 함" : "not called"
    : `${formatInteger(value)} ms`;
}

function summaryIdentifier(value: string | null | undefined) {
  const normalized = value?.trim();
  if (!normalized || normalized.startsWith("live_gateway_") || normalized.startsWith("unknown_")) {
    return "-";
  }
  return formatDisplayIdentifier(normalized);
}

function requestStatusLabel(record: LiveInvocationLogRecord, locale: Locale) {
  if (record.httpStatus >= 200 && record.httpStatus < 300) {
    return `${record.httpStatus} OK`;
  }
  if (record.httpStatus === 429) {
    return locale === "ko" ? "429 요청 제한" : "429 Rate limited";
  }
  if (record.status === "blocked") {
    return locale === "ko" ? `${record.httpStatus} 차단` : `${record.httpStatus} Blocked`;
  }
  if (record.status === "failed") {
    return locale === "ko" ? `${record.httpStatus} 실패` : `${record.httpStatus} Failed`;
  }
  return String(record.httpStatus);
}

function requestSummaryTone(record: LiveInvocationLogRecord) {
  if (record.httpStatus >= 200 && record.httpStatus < 300) {
    return "success";
  }
  if (record.httpStatus === 429 || record.status === "rate_limited") {
    return "warning";
  }
  if (record.status === "blocked") {
    return "warning";
  }
  return "error";
}

const koreanCodeLabels: Record<string, string> = {
  account_number: "계좌번호",
  api_key: "API 키",
  application: "애플리케이션",
  coding: "코딩",
  default_application: "기본 애플리케이션",
  default_project: "기본 프로젝트",
  disabled: "비활성",
  email: "이메일",
  exact: "정확 일치",
  explicit_application: "지정 애플리케이션",
  general: "일반",
  latency: "응답 속도 우선",
  low_latency: "응답 속도 우선",
  none: "사용 안 함",
  phone: "전화번호",
  phone_number: "전화번호",
  pinned: "고정 모델",
  pinned_model: "고정 모델",
  project: "프로젝트",
  project_default: "프로젝트 기본값",
  private_url: "비공개 URL",
  selected: "선택됨",
  semantic: "의미 기반",
  standard: "표준 라우팅",
  "standard routing": "표준 라우팅",
  summarization: "요약",
  team: "팀"
};

function localizedCodeList(
  values: string[] | null | undefined,
  locale: Locale,
  fallback: string
) {
  if (!values?.length) {
    return fallback;
  }

  return values.map((value) => localizedCode(value, locale)).join(", ");
}

function localizedCode(
  value: string | null | undefined,
  locale: Locale,
  fallback = "-"
) {
  const displayValue = value?.trim();
  if (!displayValue) {
    return fallback;
  }
  const normalized = displayValue.toLowerCase();
  return locale === "ko"
    ? koreanCodeLabels[normalized] ?? displayValue
    : displayValue;
}

function formatBudgetAttribution(record: LiveInvocationLogRecord, locale: Locale) {
  if (locale === "en") {
    return formatBudgetScopeDisplayName(record.budgetScope);
  }
  if (record.budgetScope.budgetScopeType === "application") {
    return "프로젝트 기본 정책";
  }

  const type = localizedCode(record.budgetScope.budgetScopeType, locale, "예산 정책");
  const scopeId = record.budgetScope.budgetScopeId?.trim();
  return scopeId ? `${type}: ${formatDisplayIdentifier(scopeId)}` : type;
}

function formatCacheResult(record: LiveInvocationLogRecord, locale: Locale) {
  if (locale === "en") {
    return `${record.cacheType}: ${record.cacheStatus}`;
  }

  return `${localizedCode(record.cacheType, locale)} · ${localizedOutcome(
    record.cacheStatus,
    locale,
    "확인 불가"
  )}`;
}

const koreanOutcomeLabels: Record<string, string> = {
  allowed: "허용",
  authenticated: "인증 완료",
  blocked: "차단",
  bypass: "우회",
  bypassed: "우회",
  completed: "완료",
  cancelled: "취소됨",
  degraded: "제한 모드",
  denied: "거부",
  deferred: "지연 기록",
  disabled: "비활성",
  error: "오류",
  failed: "실패",
  hit: "캐시 적중",
  interrupted: "중단",
  invalid_api_key: "API 키 오류",
  invalid_app_token: "앱 토큰 오류",
  last_known_safe_used: "마지막 정상 스냅샷 사용",
  masked: "마스킹됨",
  masking_applied: "마스킹 적용",
  miss: "캐시 미스",
  no_snapshot: "스냅샷 없음",
  none: "없음",
  not_called: "호출 안 함",
  not_checked: "확인 안 함",
  not_needed: "대체 경로 불필요",
  not_started: "시작 안 함",
  not_streaming: "스트리밍 아님",
  not_used: "미사용",
  passed: "통과",
  queued: "대기 중",
  rate_limited: "요청 제한",
  redacted: "마스킹됨",
  selected: "선택됨",
  skipped: "건너뜀",
  snapshot_active: "활성 스냅샷",
  stale_snapshot_used: "이전 스냅샷 사용",
  started: "시작됨",
  scope_mismatch: "범위 불일치",
  store_skipped: "저장 생략",
  success: "성공",
  timeout: "시간 초과",
  unauthorized: "인증 실패",
  warned: "경고",
  written: "기록 완료"
};

function localizedOutcome(
  value: string | null | undefined,
  locale: Locale,
  fallback: string
) {
  if (!value) {
    return fallback;
  }
  if (locale === "en") {
    return value;
  }

  return koreanOutcomeLabels[value.trim().toLowerCase()] ?? value;
}

function formatMicroUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 6,
    minimumFractionDigits: 0,
    style: "currency"
  }).format(value / 1_000_000);
}
