"use client";

import { Eye, Info, Maximize2, RotateCw, X } from "lucide-react";
import Link from "next/link";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import type {
  LiveRequestRow,
  LiveRequestStatusFilter
} from "@/lib/gateway/live-requests-types";

type LiveRequestsViewProps = {
  detailFocusRef?: (element: HTMLButtonElement | null) => void;
  detailFocusRequestId?: string;
  error: string | null;
  isLoading: boolean;
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
  viewAllLogsHref: string;
};

const statusFilters: Array<{ label: string; value: LiveRequestStatusFilter }> = [
  { label: "All Status", value: "" },
  { label: "success", value: "success" },
  { label: "failed", value: "failed" },
  { label: "blocked", value: "blocked" },
  { label: "rate_limited", value: "rate_limited" }
];

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

const projectPillToneCount = 6;

export function LiveRequestsView({
  detailFocusRef,
  detailFocusRequestId,
  error,
  isLoading,
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
  viewAllLogsHref
}: LiveRequestsViewProps) {
  const isFocus = mode === "focus";

  return (
    <section
      aria-label={isFocus ? "Live Requests focus view" : "Live Requests"}
      className="dashboard-live-requests-panel"
      data-live-view={mode}
    >
      <div className="dashboard-live-requests-header">
        <div className="dashboard-live-heading-wrap">
          <div className="dashboard-live-requests-title">
            <h2>Live Requests</h2>
            <Info aria-hidden="true" size={16} strokeWidth={2.1} />
          </div>
          <span className="dashboard-live-presence">
            <span aria-hidden="true" />
            Live
          </span>
          {isFocus && pendingCount > 0 ? (
            <button
              className="dashboard-live-pending-button"
              onClick={onApplyPending}
              type="button"
            >
              새 요청 {integerFormatter.format(pendingCount)}건 반영
            </button>
          ) : null}
          <span aria-live="polite" className="sr-only" role="status">
            {isFocus && pendingCount > 0
              ? "새 요청 " + pendingCount + "건이 대기 중입니다."
              : ""}
          </span>
        </div>
        <div className="dashboard-live-requests-actions">
          <select
            aria-label="Filter live requests by status"
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
            aria-label="Filter live requests by model"
            onChange={(event) => onModelFilterChange(event.target.value)}
            value={modelFilter}
          >
            <option value="">All Models</option>
            {modelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
          <Link className="dashboard-live-requests-view-all" href={viewAllLogsHref}>
            View all logs
          </Link>
          {isFocus ? (
            <button
              aria-label="Close Live Requests focus view"
              className="dashboard-live-focus-button"
              onClick={onCloseFocus}
              type="button"
            >
              <X aria-hidden="true" size={21} strokeWidth={2.2} />
            </button>
          ) : (
            <button
              aria-label="Open Live Requests focus view"
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
          {rows.length > 0 ? <small>Showing last successful refresh</small> : null}
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
              <th scope="col">Time</th>
              <th scope="col">User</th>
              <th scope="col">Project</th>
              <th scope="col">Provider / Model</th>
              <th scope="col">Status</th>
              <th scope="col">Policy Results</th>
              <th scope="col">Latency</th>
              <th scope="col">Detail</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <tr>
                <td className="dashboard-live-requests-state" colSpan={8}>
                  <RotateCw aria-hidden="true" size={16} strokeWidth={2.2} />
                  Loading live requests
                </td>
              </tr>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <tr>
                <td className="dashboard-live-requests-state" colSpan={8}>
                  No recent requests for selected filters
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
                  <span
                    className="dashboard-live-project-pill"
                    data-project-tone={projectPillTone(row.projectId || row.projectName)}
                    title={row.projectId}
                  >
                    {row.projectName}
                  </span>
                </td>
                <td>
                  <LiveProviderModel row={row} />
                </td>
                <td>
                  <span
                    className="dashboard-live-status-badge"
                    data-status-tone={statusTone(row)}
                  >
                    {row.statusLabel}
                  </span>
                </td>
                <td>
                  <PolicyBadges row={row} />
                </td>
                <td>{formatLiveLatency(row.latencyMs)}</td>
                <td>
                  <button
                    aria-label={"Open request detail " + row.requestId}
                    className="dashboard-live-detail-button"
                    onClick={() => onOpenRequest(row)}
                    ref={detailFocusRequestId === row.requestId ? detailFocusRef : undefined}
                    type="button"
                  >
                    <Eye aria-hidden="true" size={16} strokeWidth={2.2} />
                    <span>Detail</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dashboard-live-requests-footer">
        <span>
          {isFocus
            ? "Showing " + integerFormatter.format(rows.length) + " observed recent requests · row order frozen"
            : "Showing latest " + integerFormatter.format(rows.length) + " requests"}
        </span>
        {isFocus ? <small>New requests are held until you apply them.</small> : null}
      </div>
    </section>
  );
}

function PolicyBadges({ row }: { row: LiveRequestRow }) {
  if (row.cacheStatus === "NONE" && row.safetyAction === "NONE") {
    return <span className="dashboard-live-muted-value">-</span>;
  }

  return (
    <span className="dashboard-live-policy-badges">
      {row.safetyAction !== "NONE" ? (
        <span
          className="dashboard-live-mini-badge"
          data-kind="safety"
          data-value={row.safetyAction}
        >
          {"PII " + row.safetyAction}
        </span>
      ) : null}
      {row.cacheStatus !== "NONE" ? (
        <span
          className="dashboard-live-mini-badge"
          data-kind="cache"
          data-value={row.cacheStatus}
        >
          {"CACHE " + row.cacheStatus}
        </span>
      ) : null}
    </span>
  );
}

function LiveProviderModel({ row }: { row: LiveRequestRow }) {
  return (
    <span
      className="dashboard-live-provider-model"
      title={row.providerLabel + " · " + row.model}
    >
      <ProviderFamilyIcon
        className="dashboard-live-provider-icon"
        family={liveProviderFamily(row.provider)}
        size={24}
      />
      <span className="dashboard-live-provider-copy">
        <strong>{row.model}</strong>
        <small>{row.providerLabel}</small>
      </span>
    </span>
  );
}

function projectPillTone(value: string) {
  return stableHash(value) % projectPillToneCount;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function liveProviderFamily(provider: LiveRequestRow["provider"]) {
  if (provider === "anthropic") {
    return "claude";
  }
  if (provider === "gemini" || provider === "google") {
    return "gemini";
  }
  if (provider === "mock") {
    return "mock";
  }
  return provider === "openai" ? "openai" : "new-provider";
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

function formatLiveLatency(value: number) {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (value >= 1000) {
    return (value / 1000).toFixed(2) + " s";
  }
  return integerFormatter.format(Math.max(0, Math.round(value))) + " ms";
}
