"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LiveRequestsFocusDialog, type FocusOriginRect } from "./live-requests-focus-dialog";
import { LiveRequestsView } from "./live-requests-view";
import {
  countPendingLiveRequests,
  liveRequestHistoryCutoff,
  mergeLiveRequestHistory
} from "@/features/dashboard/live-requests-history";
import { RequestLogDetailClient } from "@/features/request-logs/components/request-log-detail-client";
import { DEFAULT_DISPLAY_TIMEZONE } from "@/lib/formatting/formatters";
import type {
  LiveRequestRow,
  LiveRequestsPayload,
  LiveRequestStatusFilter
} from "@/lib/gateway/live-requests-types";
import type { Locale } from "@/lib/i18n/locale";

const COMPACT_LIVE_REQUEST_LIMIT = 5;
const FOCUS_LIVE_REQUEST_LIMIT = 9;

export const LIVE_REQUESTS_POLL_INTERVAL_MS = 2000;

type LiveRequestsCardFilters = {
  budgetScopeId: string;
  budgetScopeType: string;
  projectId: string;
  range: string;
  resolvedBy: string;
  surface: "all" | "project_application" | "tenant_chat";
  tenantId: string;
};

type LiveRequestsCardProps = {
  filters: LiveRequestsCardFilters;
  initialPayload?: LiveRequestsPayload;
  locale: Locale;
};

type LiveRequestsApiResponse = {
  data?: LiveRequestsPayload;
  error?: string;
};

type SelectedRequest = {
  projectId: string;
  requestId: string;
};

type LiveRequestsError = "load_failed";

const liveRequestsErrorText: Record<Locale, Record<LiveRequestsError, string>> = {
  en: { load_failed: "Failed to load live requests" },
  ko: { load_failed: "실시간 요청을 불러오지 못했습니다" }
};

export function LiveRequestsCard({
  filters,
  initialPayload,
  locale
}: LiveRequestsCardProps) {
  const {
    budgetScopeId,
    budgetScopeType,
    projectId,
    range,
    resolvedBy,
    surface,
    tenantId
  } = filters;
  const initialRows = normalizeLiveRequestRows(initialPayload?.rows);
  const [rows, setRows] = useState<LiveRequestRow[]>(initialRows);
  const [historyRows, setHistoryRows] = useState<LiveRequestRow[]>(initialRows);
  const [focusRows, setFocusRows] = useState<LiveRequestRow[]>([]);
  const [modelOptions, setModelOptions] = useState<string[]>(() =>
    normalizeModelOptions(initialPayload?.requestedModelOptions)
  );
  const [statusFilter, setStatusFilter] = useState<LiveRequestStatusFilter>("");
  const [modelFilter, setModelFilter] = useState("");
  const [isLoading, setIsLoading] = useState(!initialPayload);
  const [error, setError] = useState<LiveRequestsError | null>(null);
  const [isFocusOpen, setIsFocusOpen] = useState(false);
  const [focusOrigin, setFocusOrigin] = useState<FocusOriginRect | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<SelectedRequest | null>(null);
  const [detailFocusRequestId, setDetailFocusRequestId] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const detailReturnButtonRef = useRef<HTMLButtonElement | null>(null);
  const detailOpenTimerRef = useRef<number | null>(null);
  const focusTriggerRef = useRef<HTMLElement | null>(null);
  const isFocusOpenRef = useRef(false);
  const skippedInitialFetchRef = useRef(false);
  const inFlightQueryRef = useRef<string | null>(null);
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
          surface,
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
      surface,
      tenantId,
      modelFilter,
      statusFilter
    ]
  );
  const historyQueryRef = useRef(requestQueryString);

  const bindDetailReturnButton = useCallback((element: HTMLButtonElement | null) => {
    detailReturnButtonRef.current = element;
  }, []);

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
        const response = await fetch("/api/dashboard/live-requests?" + requestQueryString, {
          cache: "no-store",
          signal: controller.signal
        });
        const payload = (await response.json().catch(() => ({}))) as LiveRequestsApiResponse;

        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Failed to load live requests");
        }

        const nextRows = normalizeLiveRequestRows(payload.data.rows);
        const queryChanged = historyQueryRef.current !== requestQueryString;
        historyQueryRef.current = requestQueryString;
        rowCountRef.current = nextRows.length;
        setRows(nextRows);
        if (queryChanged) {
          setHistoryRows(nextRows);
          if (isFocusOpenRef.current) {
            setFocusRows(nextRows);
          }
        } else {
          setHistoryRows((currentRows) =>
            mergeLiveRequestHistory(currentRows, nextRows, {
              minimumTimestampMs: liveRequestHistoryCutoff(range)
            })
          );
        }
        setModelOptions(mergeModelOptions(payload.data.requestedModelOptions, modelFilter));
        setError(null);
      } catch (fetchError) {
        if (controller.signal.aborted) {
          return;
        }

        setError("load_failed");
        console.warn("Failed to load live requests", fetchError);
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          inFlightQueryRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [modelFilter, range, requestQueryString]
  );

  useEffect(() => {
    let stopped = false;
    let timeoutId: number | null = null;

    function clearScheduledPoll() {
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    }

    function schedulePoll() {
      clearScheduledPoll();
      timeoutId = window.setTimeout(() => {
        void poll();
      }, LIVE_REQUESTS_POLL_INTERVAL_MS);
    }

    async function poll() {
      if (stopped || document.visibilityState !== "visible") {
        return;
      }

      await loadRequests({ silent: true });
      if (!stopped) {
        schedulePoll();
      }
    }

    function handleVisibilityChange() {
      clearScheduledPoll();

      if (document.visibilityState !== "visible") {
        abortRef.current?.abort();
        return;
      }

      void poll();
    }

    if (initialPayload && !skippedInitialFetchRef.current) {
      skippedInitialFetchRef.current = true;
      schedulePoll();
    } else if (document.visibilityState === "visible") {
      void loadRequests({ silent: false }).finally(() => {
        if (!stopped) {
          schedulePoll();
        }
      });
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      stopped = true;
      clearScheduledPoll();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      abortRef.current?.abort();
      inFlightQueryRef.current = null;
    };
  }, [initialPayload, loadRequests]);

  useEffect(() => {
    if (!isFocusOpen) {
      return;
    }

    function updateOrigin() {
      setFocusOrigin(readFocusOrigin(cardRef.current));
    }

    window.addEventListener("resize", updateOrigin);
    return () => window.removeEventListener("resize", updateOrigin);
  }, [isFocusOpen]);

  useEffect(() => {
    return () => {
      if (detailOpenTimerRef.current !== null) {
        window.clearTimeout(detailOpenTimerRef.current);
      }
    };
  }, []);

  const viewAllLogsHref = useMemo(
    () => requestLogsHref(tenantId, range, statusFilter, modelFilter, projectId, surface),
    [modelFilter, projectId, range, statusFilter, surface, tenantId]
  );
  const pendingCount = isFocusOpen
    ? countPendingLiveRequests(focusRows, historyRows)
    : 0;
  const errorMessage = error ? liveRequestsErrorText[locale][error] : null;

  function openFocusView() {
    focusTriggerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setFocusOrigin(readFocusOrigin(cardRef.current));
    setFocusRows(historyRows);
    isFocusOpenRef.current = true;
    setIsFocusOpen(true);
  }

  function closeFocusView() {
    if (detailOpenTimerRef.current !== null) {
      window.clearTimeout(detailOpenTimerRef.current);
      detailOpenTimerRef.current = null;
    }

    setSelectedRequest(null);
    setDetailFocusRequestId(undefined);
    isFocusOpenRef.current = false;
    setIsFocusOpen(false);
    window.setTimeout(() => {
      focusTriggerRef.current?.focus({ preventScroll: true });
    }, motionDuration(380));
  }

  function openRequestDetail(row: LiveRequestRow) {
    setDetailFocusRequestId(row.requestId);

    const selectRequest = () => {
      setSelectedRequest({
        projectId: row.projectId,
        requestId: row.requestId
      });
      detailOpenTimerRef.current = null;
    };

    if (isFocusOpen) {
      selectRequest();
      return;
    }

    openFocusView();
    detailOpenTimerRef.current = window.setTimeout(() => {
      detailReturnButtonRef.current?.focus({ preventScroll: true });
      selectRequest();
    }, motionDuration(380));
  }

  function closeRequestDetail() {
    setSelectedRequest(null);
  }

  return (
    <>
      <div className="dashboard-live-requests-slot" ref={cardRef}>
        <LiveRequestsView
          error={errorMessage}
          isLoading={isLoading}
          locale={locale}
          mode="compact"
          modelFilter={modelFilter}
          modelOptions={modelOptions}
          onModelFilterChange={setModelFilter}
          onOpenFocus={openFocusView}
          onOpenRequest={openRequestDetail}
          onStatusFilterChange={setStatusFilter}
          rows={rows.slice(0, COMPACT_LIVE_REQUEST_LIMIT)}
          statusFilter={statusFilter}
          tenantId={tenantId}
          viewAllLogsHref={viewAllLogsHref}
        />
      </div>

      <LiveRequestsFocusDialog
        locale={locale}
        onClose={closeFocusView}
        open={isFocusOpen}
        origin={focusOrigin}
      >
        <LiveRequestsView
          detailFocusRef={bindDetailReturnButton}
          detailFocusRequestId={detailFocusRequestId}
          error={errorMessage}
          isLoading={isLoading}
          locale={locale}
          mode="focus"
          modelFilter={modelFilter}
          modelOptions={modelOptions}
          onApplyPending={() => setFocusRows(historyRows)}
          onCloseFocus={closeFocusView}
          onModelFilterChange={setModelFilter}
          onOpenRequest={openRequestDetail}
          onStatusFilterChange={setStatusFilter}
          pendingCount={pendingCount}
          rows={focusRows.slice(0, FOCUS_LIVE_REQUEST_LIMIT)}
          selectedRequestId={selectedRequest?.requestId}
          statusFilter={statusFilter}
          tenantId={tenantId}
          viewAllLogsHref={viewAllLogsHref}
        />
        <RequestLogDetailClient
          locale={locale}
          onClose={closeRequestDetail}
          selectedProjectId={selectedRequest?.projectId}
          selectedRequestId={selectedRequest?.requestId}
          tenantId={tenantId}
          timezone={DEFAULT_DISPLAY_TIMEZONE}
          variant="drawer"
        />
      </LiveRequestsFocusDialog>
    </>
  );
}

function readFocusOrigin(element: HTMLElement | null): FocusOriginRect | null {
  if (!element) {
    return null;
  }

  const rect = element.getBoundingClientRect();
  return {
    height: rect.height,
    left: rect.left,
    top: rect.top,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
    width: rect.width
  };
}

function motionDuration(durationMs: number) {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : durationMs;
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
  appendQuery(query, "surface", filters.surface);
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
  surface: LiveRequestsCardFilters["surface"] = "project_application"
) {
  if (surface === "tenant_chat") {
    const query = new URLSearchParams({ range, surface });
    return `/tenants/${tenantId}/dashboard?${query}`;
  }
  const query = new URLSearchParams();
  const created = requestLogsCreatedRange(range);

  if (created !== "24h") {
    query.set("created", created);
  }
  appendQuery(query, "status", status);
  appendQuery(query, "model", model);
  appendQuery(query, "projectId", projectId);

  const queryString = query.toString();
  return "/tenants/" + tenantId + "/request-logs" + (queryString ? "?" + queryString : "");
}

function appendQuery(query: URLSearchParams, key: string, value: string | undefined) {
  const normalized = value?.trim();
  if (normalized) {
    query.set(key, normalized);
  }
}

function requestLogsCreatedRange(range: string) {
  if (range === "5m") {
    return "15m";
  }
  if (range === "15m" || range === "1h") {
    return range;
  }
  if (range === "1w") {
    return "7d";
  }
  return "24h";
}

function mergeModelOptions(options: string[] | undefined, modelFilter: string) {
  const merged = new Set(normalizeModelOptions(options));
  if (modelFilter.trim()) {
    merged.add(modelFilter.trim());
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
