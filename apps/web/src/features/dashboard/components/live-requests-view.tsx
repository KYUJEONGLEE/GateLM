"use client";

import { Eye, Info, Maximize2, RotateCw, X } from "lucide-react";
import Link from "next/link";
import {
  primaryPolicyResult,
  projectPillTone
} from "@/features/dashboard/live-requests-format";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import { formatResponseTimeSeconds } from "@/lib/formatting/formatters";
import type {
  LiveRequestRow,
  LiveRequestStatusFilter
} from "@/lib/gateway/live-requests-types";
import type { Locale } from "@/lib/i18n/locale";

type LiveRequestsViewProps = {
  detailFocusRef?: (element: HTMLButtonElement | null) => void;
  detailFocusRequestId?: string;
  error: string | null;
  isLoading: boolean;
  locale: Locale;
  mode: "compact" | "focus";
  modelFilter: string;
  modelOptions: string[];
  onApplyPending?: () => void;
  onCloseFocus?: () => void;
  onModelFilterChange: (value: string) => void;
  onOpenFocus?: () => void;
  onOpenRequest: (row: LiveRequestRow) => void;
  onStatusFilterChange: (value: LiveRequestStatusFilter) => void;
  pendingCount?: number;
  rows: LiveRequestRow[];
  selectedRequestId?: string;
  statusFilter: LiveRequestStatusFilter;
  tenantId: string;
  viewAllLogsHref: string;
};

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  hour12: false,
  hourCycle: "h23",
  minute: "2-digit",
  second: "2-digit",
  timeZone: "Asia/Seoul"
});

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Seoul",
  year: "numeric"
});

const integerFormatter = new Intl.NumberFormat("en-US");

const liveRequestsText = {
  en: {
    allModels: "All Models",
    allStatus: "All Status",
    closeFocus: "Close Live Requests focus view",
    detail: "Detail",
    filterModel: "Filter live requests by model",
    filterStatus: "Filter live requests by status",
    focusAria: "Live Requests focus view",
    frozen: "row order frozen",
    lastRefresh: "Showing last successful refresh",
    live: "Live",
    loading: "Loading live requests",
    noRequests: "No recent requests for selected filters",
    openDetail: "Open request detail",
    openFocus: "Open Live Requests focus view",
    panelAria: "Live Requests",
    pendingPrefix: "Apply",
    pendingSuffix: "new requests",
    pendingStatus: "new requests are waiting.",
    requests: "requests",
    title: "Live Requests",
    viewAll: "View all logs",
    waiting: "New requests are held until you apply them."
  },
  ko: {
    allModels: "전체 모델",
    allStatus: "전체 상태",
    closeFocus: "실시간 요청 확대 화면 닫기",
    detail: "상세",
    filterModel: "모델로 실시간 요청 필터링",
    filterStatus: "상태로 실시간 요청 필터링",
    focusAria: "실시간 요청 확대 화면",
    frozen: "행 순서 고정",
    lastRefresh: "마지막 정상 조회 결과를 표시 중입니다",
    live: "실시간",
    loading: "실시간 요청을 불러오는 중",
    noRequests: "선택한 필터에 해당하는 최근 요청이 없습니다",
    openDetail: "요청 상세 열기",
    openFocus: "실시간 요청 확대 화면 열기",
    panelAria: "실시간 요청",
    pendingPrefix: "새 요청",
    pendingSuffix: "건 반영",
    pendingStatus: "건이 대기 중입니다.",
    requests: "건 표시",
    title: "실시간 요청",
    viewAll: "전체 로그 보기",
    waiting: "새 요청은 반영할 때까지 보류됩니다."
  }
} as const;

const liveRequestStatusFilters: Record<
  Locale,
  Array<{ label: string; value: LiveRequestStatusFilter }>
> = {
  en: [
    { label: "All Status", value: "" },
    { label: "Success", value: "success" },
    { label: "Failed", value: "failed" },
    { label: "Blocked", value: "blocked" },
    { label: "Rate limited", value: "rate_limited" }
  ],
  ko: [
    { label: "전체 상태", value: "" },
    { label: "성공", value: "success" },
    { label: "실패", value: "failed" },
    { label: "차단", value: "blocked" },
    { label: "요청 제한", value: "rate_limited" }
  ]
};

export function LiveRequestsView({
  detailFocusRef,
  detailFocusRequestId,
  error,
  isLoading,
  locale,
  mode,
  modelFilter,
  modelOptions,
  onApplyPending,
  onCloseFocus,
  onModelFilterChange,
  onOpenFocus,
  onOpenRequest,
  onStatusFilterChange,
  pendingCount = 0,
  rows,
  selectedRequestId,
  statusFilter,
  tenantId,
  viewAllLogsHref
}: LiveRequestsViewProps) {
  const isFocus = mode === "focus";
  const text = liveRequestsText[locale];
  const statusFilters = liveRequestStatusFilters[locale];

  return (
    <section
      aria-label={isFocus ? text.focusAria : text.panelAria}
      className="dashboard-live-requests-panel"
      data-live-view={mode}
    >
      <div className="dashboard-live-requests-header">
        <div className="dashboard-live-heading-wrap">
          <div className="dashboard-live-requests-title">
            <h2>{text.title}</h2>
            <Info aria-hidden="true" size={16} strokeWidth={2.1} />
          </div>
          <span className="dashboard-live-presence">
            <span aria-hidden="true" />
            {text.live}
          </span>
          {isFocus && pendingCount > 0 ? (
            <button
              className="dashboard-live-pending-button"
              onClick={onApplyPending}
              type="button"
            >
              {text.pendingPrefix} {integerFormatter.format(pendingCount)} {text.pendingSuffix}
            </button>
          ) : null}
          <span aria-live="polite" className="sr-only" role="status">
            {isFocus && pendingCount > 0
              ? pendingCount + " " + text.pendingStatus
              : ""}
          </span>
        </div>
        <div className="dashboard-live-requests-actions">
          <select
            aria-label={text.filterStatus}
            onChange={(event) =>
              onStatusFilterChange(event.target.value as LiveRequestStatusFilter)
            }
            value={statusFilter}
          >
            {statusFilters.map((status) => (
              <option key={status.value || "all"} value={status.value}>
                {status.label}
              </option>
            ))}
          </select>
          <select
            aria-label={text.filterModel}
            onChange={(event) => onModelFilterChange(event.target.value)}
            value={modelFilter}
          >
            <option value="">{text.allModels}</option>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {formatModelDisplayName(model)}
              </option>
            ))}
          </select>
          <Link className="dashboard-live-requests-view-all" href={viewAllLogsHref}>
            {text.viewAll}
          </Link>
          {isFocus ? (
            <button
              aria-label={text.closeFocus}
              className="dashboard-live-focus-button"
              onClick={onCloseFocus}
              type="button"
            >
              <X aria-hidden="true" size={21} strokeWidth={2.2} />
            </button>
          ) : (
            <button
              aria-label={text.openFocus}
              className="dashboard-live-focus-button"
              onClick={onOpenFocus}
              type="button"
            >
              <Maximize2 aria-hidden="true" size={19} strokeWidth={2.2} />
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="dashboard-live-requests-error" role="status">
          <span>{error}</span>
          {rows.length > 0 ? <small>{text.lastRefresh}</small> : null}
        </div>
      ) : null}

      <div className="dashboard-live-requests-table-wrap">
        <table className="dashboard-live-requests-table">
          <colgroup>
            <col className="dashboard-live-col-time" />
            <col className="dashboard-live-col-user" />
            <col className="dashboard-live-col-project" />
            <col className="dashboard-live-col-model" />
            <col className="dashboard-live-col-status" />
            <col className="dashboard-live-col-policy" />
            <col className="dashboard-live-col-latency" />
            <col className="dashboard-live-col-action" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">{locale === "ko" ? "시각" : "Time"}</th>
              <th scope="col">{locale === "ko" ? "사용자" : "User"}</th>
              <th scope="col">{locale === "ko" ? "프로젝트" : "Project"}</th>
              <th scope="col">{locale === "ko" ? "라우팅" : "Routing"}</th>
              <th scope="col">{locale === "ko" ? "상태" : "Status"}</th>
              <th scope="col">{locale === "ko" ? "정책 결과" : "Policy Result"}</th>
              <th scope="col">{locale === "ko" ? "응답 시간" : "Response time"}</th>
              <th scope="col">{text.detail}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <tr>
                <td className="dashboard-live-requests-state" colSpan={8}>
                  <RotateCw aria-hidden="true" size={16} strokeWidth={2.2} />
                  {text.loading}
                </td>
              </tr>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <tr>
                <td className="dashboard-live-requests-state" colSpan={8}>
                  {text.noRequests}
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr
                className={selectedRequestId === row.requestId ? "is-selected" : undefined}
                key={row.id}
              >
                <td>
                  <span className="dashboard-live-time">
                    {formatLiveTime(row.timestamp)}
                    {isFocus ? <small>{formatLiveDate(row.timestamp)}</small> : null}
                  </span>
                </td>
                <td>
                  {row.userName ? (
                    <span className="dashboard-live-user" title={row.userName}>
                      <span aria-hidden="true" className="dashboard-live-user-avatar">
                        {row.userName.trim().slice(0, 1)}
                      </span>
                      <span>{row.userName}</span>
                    </span>
                  ) : (
                    <span className="dashboard-live-muted-value">-</span>
                  )}
                </td>
                <td>
                  {row.projectId ? (
                    <Link
                      aria-label={`${row.projectName || row.projectId} ${locale === "ko" ? "프로젝트 열기" : "Open project"}`}
                      className="dashboard-live-project-pill"
                      data-project-tone={projectPillTone(row.projectId || row.projectName)}
                      href={`/tenants/${encodeURIComponent(tenantId)}/projects/${encodeURIComponent(row.projectId)}/policies`}
                      title={projectTitle(row)}
                    >
                      {row.projectName || row.projectId}
                    </Link>
                  ) : (
                    <span
                      className="dashboard-live-project-pill"
                      data-project-tone={projectPillTone(row.projectName)}
                      title={projectTitle(row)}
                    >
                      {row.projectName || "-"}
                    </span>
                  )}
                </td>
                <td>
                  <LiveRequestRouting row={row} />
                </td>
                <td>
                  <span
                    className="dashboard-live-status-badge"
                    data-status-tone={statusTone(row)}
                  >
                    {localizedStatusLabel(row, locale)}
                  </span>
                </td>
                <td>
                  <PolicyBadges locale={locale} row={row} />
                </td>
                <td>{formatResponseTimeSeconds(row.ttftMs)}</td>
                <td>
                  {row.surface === "tenant_chat" ? (
                    <span className="dashboard-live-muted-value">-</span>
                  ) : (
                    <button
                      aria-label={text.openDetail + " " + row.requestId}
                      className="dashboard-live-detail-button"
                      onClick={() => onOpenRequest(row)}
                      ref={detailFocusRequestId === row.requestId ? detailFocusRef : undefined}
                      type="button"
                    >
                      <Eye aria-hidden="true" size={16} strokeWidth={2.2} />
                      <span>{text.detail}</span>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dashboard-live-requests-footer">
        <span>
          {isFocus
            ? integerFormatter.format(rows.length) + " " + text.requests + " · " + text.frozen
            : integerFormatter.format(rows.length) + " " + text.requests}
        </span>
        {isFocus ? <small>{text.waiting}</small> : null}
      </div>
    </section>
  );
}

function PolicyBadges({ locale, row }: { locale: Locale; row: LiveRequestRow }) {
  const result = primaryPolicyResult(row, locale);

  if (!result) {
    return <span className="dashboard-live-muted-value">-</span>;
  }

  return (
    <span className="dashboard-live-policy-badges">
      <span
        className="dashboard-live-mini-badge"
        data-kind={result.kind}
        data-value={result.value}
      >
        {result.label}
      </span>
    </span>
  );
}

function LiveRequestRouting({ row }: { row: LiveRequestRow }) {
  const model = formatModelDisplayName(
    row.executedModel ?? row.requestedModel,
    "auto"
  );
  const requestMode = row.requestedModel === "auto"
    ? "Auto routing"
    : formatModelDisplayName(row.requestedModel, "Manual routing");
  const executionLabel = row.providerName
    ? `${row.providerName} · ${requestMode}`
    : `${row.category} / ${row.difficulty} / ${row.modelRef ?? "-"}`;
  const routingLabel = `${row.category} / ${row.difficulty} / ${row.modelRef ?? "no-model-ref"} / ${row.routingReason ?? "not-set"}`;
  return (
    <span
      className="dashboard-live-provider-model"
      title={routingLabel + " · " + model}
    >
      {row.providerFamily ? (
        <ProviderFamilyIcon
          className="dashboard-live-provider-icon"
          family={row.providerFamily}
          size={24}
        />
      ) : null}
      <span className="dashboard-live-provider-copy">
        <strong>{model}</strong>
        <small>{executionLabel}</small>
      </span>
    </span>
  );
}

function projectTitle(row: LiveRequestRow) {
  return row.projectId || row.projectName || "Unknown project";
}

function localizedStatusLabel(row: LiveRequestRow, locale: Locale) {
  if (locale !== "ko") {
    return row.statusLabel;
  }

  const labels: Record<LiveRequestRow["status"], string> = {
    blocked: "차단",
    failed: "실패",
    rate_limited: "요청 제한",
    success: "성공"
  };

  return labels[row.status] ?? row.statusLabel;
}
function statusTone(row: LiveRequestRow) {
  if (row.statusCode >= 500 || row.status === "failed") {
    return "error";
  }
  if (row.statusCode >= 400 || row.status === "blocked" || row.status === "rate_limited") {
    return "warning";
  }
  if (row.statusCode >= 200 && row.statusCode < 300) {
    return "success";
  }
  return "neutral";
}

function formatLiveTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : timeFormatter.format(date);
}

function formatLiveDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : dateFormatter.format(date);
}
