"use client";

import {
  Check,
  Copy,
  Eye,
  Info,
  RotateCw
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type {
  LiveRequestRow,
  LiveRequestsPayload,
  LiveRequestStatusFilter
} from "@/lib/gateway/live-requests-types";

export const LIVE_REQUESTS_POLL_INTERVAL_MS = 2000;

type LiveRequestsCardFilters = {
  budgetScopeId: string;
  budgetScopeType: string;
  projectId: string;
  range: string;
  resolvedBy: string;
  tenantId: string;
};

type LiveRequestsCardProps = {
  filters: LiveRequestsCardFilters;
  initialPayload?: LiveRequestsPayload;
};

type LiveRequestsApiResponse = {
  data?: LiveRequestsPayload;
  error?: string;
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

const compactUsdFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 6,
  minimumFractionDigits: 4,
  style: "currency"
});

const integerFormatter = new Intl.NumberFormat("en-US");

const projectPillTones = [
  { background: "rgba(37, 99, 235, 0.24)", border: "rgba(96, 165, 250, 0.44)", text: "#bfdbfe" },
  { background: "rgba(13, 148, 136, 0.24)", border: "rgba(45, 212, 191, 0.44)", text: "#99f6e4" },
  { background: "rgba(124, 58, 237, 0.24)", border: "rgba(167, 139, 250, 0.44)", text: "#ddd6fe" },
  { background: "rgba(219, 39, 119, 0.22)", border: "rgba(244, 114, 182, 0.42)", text: "#fbcfe8" },
  { background: "rgba(217, 119, 6, 0.22)", border: "rgba(251, 191, 36, 0.42)", text: "#fde68a" },
  { background: "rgba(22, 163, 74, 0.22)", border: "rgba(74, 222, 128, 0.42)", text: "#bbf7d0" },
  { background: "rgba(8, 145, 178, 0.24)", border: "rgba(34, 211, 238, 0.42)", text: "#a5f3fc" },
  { background: "rgba(225, 29, 72, 0.21)", border: "rgba(251, 113, 133, 0.42)", text: "#fecdd3" }
];

export function LiveRequestsCard({ filters, initialPayload }: LiveRequestsCardProps) {
  const {
    budgetScopeId,
    budgetScopeType,
    projectId,
    range,
    resolvedBy,
    tenantId
  } = filters;
  const [rows, setRows] = useState<LiveRequestRow[]>(() => normalizeLiveRequestRows(initialPayload?.rows));
  const [modelOptions, setModelOptions] = useState<string[]>(() => normalizeModelOptions(initialPayload?.modelOptions));
  const [statusFilter, setStatusFilter] = useState<LiveRequestStatusFilter>("");
  const [modelFilter, setModelFilter] = useState("");
  const [isLoading, setIsLoading] = useState(!initialPayload);
  const [error, setError] = useState<string | null>(null);
  const [copiedRequestId, setCopiedRequestId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skippedInitialFetchRef = useRef(false);
  const inFlightQueryRef = useRef<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const rowCountRef = useRef(rows.length);
  const requestQueryString = useMemo(
    () =>
      liveRequestsApiQuery(
        {
          budgetScopeId,
          budgetScopeType,
          projectId,
          range,
          resolvedBy,
          tenantId
        },
        statusFilter,
        modelFilter
      ),
    [
      budgetScopeId,
      budgetScopeType,
      projectId,
      range,
      resolvedBy,
      tenantId,
      modelFilter,
      statusFilter
    ]
  );

  useEffect(() => {
    rowCountRef.current = rows.length;
  }, [rows.length]);

  const loadRequests = useCallback(
    async ({ silent }: { silent: boolean }) => {
      if (abortRef.current) {
        if (silent && inFlightQueryRef.current === requestQueryString) {
          return;
        }

        abortRef.current.abort();
      }

      const controller = new AbortController();
      abortRef.current = controller;
      inFlightQueryRef.current = requestQueryString;

      if (!silent && rowCountRef.current === 0) {
        setIsLoading(true);
      }

      try {
        const response = await fetch(`/api/dashboard/live-requests?${requestQueryString}`, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => ({}))) as LiveRequestsApiResponse;

        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Failed to load live requests");
        }

        const nextRows = normalizeLiveRequestRows(payload.data.rows);
        rowCountRef.current = nextRows.length;
        setRows(nextRows);
        setModelOptions(mergeModelOptions(payload.data.modelOptions, modelFilter));
        setError(null);
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }

        setError("Failed to load live requests");
        console.warn("Failed to load live requests", fetchError);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          inFlightQueryRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [modelFilter, requestQueryString]
  );

  useEffect(() => {
    if (initialPayload && !skippedInitialFetchRef.current) {
      skippedInitialFetchRef.current = true;
    } else {
      void loadRequests({ silent: false });
    }

    const interval = window.setInterval(() => {
      void loadRequests({ silent: true });
    }, LIVE_REQUESTS_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      abortRef.current?.abort();
      inFlightQueryRef.current = null;
    };
  }, [initialPayload, loadRequests]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const viewAllLogsHref = useMemo(
    () => requestLogsHref(tenantId, range, statusFilter, modelFilter, projectId),
    [modelFilter, projectId, range, statusFilter, tenantId]
  );

  async function copyRequestId(requestId: string) {
    try {
      await navigator.clipboard.writeText(requestId);
      setCopiedRequestId(requestId);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => setCopiedRequestId(null), 1200);
    } catch (copyError) {
      console.warn("Failed to copy request id", copyError);
    }
  }

  return (
    <section className="dashboard-live-requests-panel" aria-label="Live Requests">
      <div className="dashboard-live-requests-header">
        <div>
          <div className="dashboard-live-requests-title">
            <h2>Live Requests</h2>
            <Info aria-hidden="true" size={15} strokeWidth={2.1} />
          </div>
        </div>
        <div className="dashboard-live-requests-actions">
          <select
            aria-label="Filter live requests by status"
            onChange={(event) => setStatusFilter(event.target.value as LiveRequestStatusFilter)}
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
            onChange={(event) => setModelFilter(event.target.value)}
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
          <thead>
            <tr>
              <th>Time</th>
              <th>Request ID</th>
              <th>Project</th>
              <th>Name</th>
              <th>Provider</th>
              <th>Model</th>
              <th>Status</th>
              <th>Cache</th>
              <th>Safety</th>
              <th>Latency</th>
              <th>Tokens</th>
              <th>Cost (USD)</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 ? (
              <tr>
                <td className="dashboard-live-requests-state" colSpan={13}>
                  <RotateCw aria-hidden="true" size={16} strokeWidth={2.2} />
                  Loading live requests
                </td>
              </tr>
            ) : null}
            {!isLoading && rows.length === 0 ? (
              <tr>
                <td className="dashboard-live-requests-state" colSpan={13}>
                  No recent requests for selected filters
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{formatLiveTime(row.timestamp)}</td>
                <td>
                  <div className="dashboard-live-request-id">
                    <span title={row.requestId}>{compactRequestId(row.requestId)}</span>
                    <button
                      aria-label={`Copy request id ${row.requestId}`}
                      onClick={() => void copyRequestId(row.requestId)}
                      type="button"
                    >
                      {copiedRequestId === row.requestId ? (
                        <Check aria-hidden="true" size={14} strokeWidth={2.4} />
                      ) : (
                        <Copy aria-hidden="true" size={14} strokeWidth={2.2} />
                      )}
                    </button>
                    {copiedRequestId === row.requestId ? <em>Copied</em> : null}
                  </div>
                </td>
                <td>
                  <span
                    className="dashboard-live-project-pill"
                    style={projectPillStyle(row.projectId || row.projectName)}
                    title={row.projectId}
                  >
                    {row.projectName}
                  </span>
                </td>
                <td>
                  {row.userName ? (
                    <span title={row.userName}>{row.userName}</span>
                  ) : (
                    <span className="dashboard-live-muted-value">-</span>
                  )}
                </td>
                <td>
                  <span className="dashboard-live-provider" data-provider={row.provider}>
                    <span>{providerMark(row.provider)}</span>
                    {row.providerLabel}
                  </span>
                </td>
                <td>{row.model}</td>
                <td>
                  <span className="dashboard-live-status-badge" data-status-tone={statusTone(row)}>
                    {row.statusLabel}
                  </span>
                </td>
                <td>
                  <OptionalBadge kind="cache" value={row.cacheStatus} />
                </td>
                <td>
                  <OptionalBadge kind="safety" value={row.safetyAction} />
                </td>
                <td>{formatLiveLatency(row.latencyMs)}</td>
                <td>{integerFormatter.format(row.totalTokens)}</td>
                <td>{compactUsdFormatter.format(row.costUsd)}</td>
                <td>
                  <Link
                    aria-label={`Open request log ${row.requestId}`}
                    className="dashboard-live-action-link"
                    href={requestLogsHref(tenantId, range, statusFilter, modelFilter, projectId, row.requestId)}
                  >
                    <Eye aria-hidden="true" size={15} strokeWidth={2.2} />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="dashboard-live-requests-footer">
        <span>Showing latest 5 requests</span>
      </div>
    </section>
  );
}

function OptionalBadge({
  kind,
  value
}: {
  kind: "cache" | "safety";
  value: LiveRequestRow["cacheStatus"] | LiveRequestRow["safetyAction"];
}) {
  if (value === "NONE") {
    return <span className="dashboard-live-muted-value">-</span>;
  }

  return (
    <span className="dashboard-live-mini-badge" data-kind={kind} data-value={value}>
      {value}
    </span>
  );
}

function projectPillStyle(value: string): CSSProperties {
  const tone = projectPillTones[stableHash(value) % projectPillTones.length];

  return {
    "--project-pill-bg": tone.background,
    "--project-pill-border": tone.border,
    "--project-pill-text": tone.text
  } as CSSProperties;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function liveRequestsApiQuery(
  filters: LiveRequestsCardFilters,
  status: LiveRequestStatusFilter,
  model: string
) {
  const query = new URLSearchParams({
    range: filters.range,
    tenantId: filters.tenantId
  });
  appendQuery(query, "budgetScopeId", filters.budgetScopeId);
  appendQuery(query, "budgetScopeType", filters.budgetScopeType);
  appendQuery(query, "projectId", filters.projectId);
  appendQuery(query, "resolvedBy", filters.resolvedBy);
  appendQuery(query, "status", status);
  appendQuery(query, "model", model);

  return query.toString();
}

function requestLogsHref(
  tenantId: string,
  range: string,
  status: LiveRequestStatusFilter,
  model: string,
  projectId?: string,
  requestId?: string
) {
  const query = new URLSearchParams();
  const created = requestLogsCreatedRange(range);

  if (created !== "24h") {
    query.set("created", created);
  }
  appendQuery(query, "status", status);
  appendQuery(query, "model", model);
  appendQuery(query, "projectId", projectId);
  appendQuery(query, "requestId", requestId);

  const queryString = query.toString();
  return `/tenants/${tenantId}/request-logs${queryString ? `?${queryString}` : ""}`;
}

function appendQuery(query: URLSearchParams, key: string, value: string | undefined) {
  const normalized = value?.trim();
  if (normalized) {
    query.set(key, normalized);
  }
}

function requestLogsCreatedRange(range: string) {
  if (range === "15m" || range === "1h") {
    return range;
  }

  if (range === "1w") {
    return "7d";
  }

  return "24h";
}

function mergeModelOptions(options: string[] | undefined, selectedModel: string) {
  const merged = new Set(normalizeModelOptions(options));
  if (selectedModel.trim()) {
    merged.add(selectedModel.trim());
  }

  return Array.from(merged).sort((first, second) => first.localeCompare(second));
}

function normalizeLiveRequestRows(rows: LiveRequestRow[] | undefined) {
  return Array.isArray(rows) ? rows : [];
}

function normalizeModelOptions(options: string[] | undefined) {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .filter((option): option is string => typeof option === "string")
    .map((option) => option.trim())
    .filter(Boolean);
}

function formatLiveTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return timeFormatter.format(date);
}

function compactRequestId(value: string) {
  if (value.length <= 28) {
    return value;
  }

  return `${value.slice(0, 16)}...${value.slice(-6)}`;
}

function providerMark(provider: LiveRequestRow["provider"]) {
  const marks: Record<LiveRequestRow["provider"], string> = {
    anthropic: "A",
    gemini: "G",
    google: "G",
    mock: "M",
    openai: "O",
    unknown: "?"
  };

  return marks[provider];
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

function formatLiveLatency(value: number) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} s`;
  }

  return `${integerFormatter.format(Math.max(0, Math.round(value)))} ms`;
}
