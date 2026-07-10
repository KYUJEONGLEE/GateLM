"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RequestDetailDrawer } from "./request-detail-drawer";
import { RequestLogDetailAside } from "./request-log-detail";
import {
  REQUEST_LOG_DETAIL_CLOSE_EVENT,
  REQUEST_LOG_DETAIL_SELECT_EVENT
} from "./request-log-detail-anchor";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import type { Locale } from "@/lib/i18n/locale";

type RequestLogDetailClientProps = {
  initialProjectId?: string;
  initialRecord?: InvocationLogRecord;
  initialRequestId?: string;
  locale: Locale;
  onClose?: () => void;
  records?: InvocationLogRecord[];
  selectedProjectId?: string;
  selectedRequestId?: string;
  tenantId: string;
  timezone: string;
  variant?: "aside" | "drawer";
};

type DetailSelection = {
  projectId?: string;
  requestId?: string;
};

type DetailApiResponse = {
  data?: InvocationLogRecord | null;
};

type DetailLoadState = "idle" | "loading" | "ready" | "error";

const emptyRecords: InvocationLogRecord[] = [];

export function RequestLogDetailClient({
  initialProjectId,
  initialRecord,
  initialRequestId,
  locale,
  onClose,
  records = emptyRecords,
  selectedProjectId,
  selectedRequestId,
  tenantId,
  timezone,
  variant = "aside"
}: RequestLogDetailClientProps) {
  const searchParams = useSearchParams();
  const requestIdFromUrl = searchParams.get("requestId")?.trim() || undefined;
  const initialSelectedRequestId =
    variant === "drawer"
      ? selectedRequestId
      : initialRequestId ?? requestIdFromUrl;
  const [selection, setSelection] = useState<DetailSelection>({
    projectId:
      variant === "drawer" ? selectedProjectId : initialProjectId,
    requestId: initialSelectedRequestId
  });
  const [detail, setDetail] = useState<InvocationLogRecord | undefined>(
    initialRecord
  );
  const [loadState, setLoadState] = useState<DetailLoadState>(
    initialSelectedRequestId ? (initialRecord ? "ready" : "loading") : "idle"
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const recordsByRequestId = useMemo(() => {
    return new Map(records.map((record) => [record.requestId, record]));
  }, [records]);

  useEffect(() => {
    if (variant !== "drawer") {
      return;
    }

    const nextRequestId = selectedRequestId?.trim() || undefined;
    const nextRecord = nextRequestId
      ? recordsByRequestId.get(nextRequestId)
      : undefined;

    setSelection({
      projectId: selectedProjectId?.trim() || nextRecord?.projectId,
      requestId: nextRequestId
    });
    setDetail(nextRecord);
    setLoadError(null);
    setLoadState(nextRequestId ? (nextRecord ? "ready" : "loading") : "idle");
  }, [
    recordsByRequestId,
    selectedProjectId,
    selectedRequestId,
    variant
  ]);

  useEffect(() => {
    if (variant !== "aside") {
      return;
    }

    setSelection((current) => {
      const nextRequestId = requestIdFromUrl ?? initialRequestId;

      if (current.requestId === nextRequestId) {
        return current;
      }

      const nextRecord = nextRequestId
        ? recordsByRequestId.get(nextRequestId)
        : undefined;

      setDetail(nextRecord);
      setLoadError(null);
      setLoadState(nextRequestId ? (nextRecord ? "ready" : "loading") : "idle");

      return {
        projectId: nextRecord?.projectId ?? initialProjectId,
        requestId: nextRequestId
      };
    });
  }, [
    initialProjectId,
    initialRequestId,
    recordsByRequestId,
    requestIdFromUrl,
    variant
  ]);

  useEffect(() => {
    if (variant !== "aside") {
      return;
    }

    function closeDetail() {
      setDetail(undefined);
      setSelection({});
      setLoadError(null);
      setLoadState("idle");
    }

    function selectDetail(event: Event) {
      const customEvent = event as CustomEvent<DetailSelection>;
      const requestId = customEvent.detail?.requestId?.trim();

      if (!requestId) {
        return;
      }

      const nextRecord = recordsByRequestId.get(requestId);
      setDetail(nextRecord);
      setLoadError(null);
      setLoadState(nextRecord ? "ready" : "loading");
      setSelection({
        projectId:
          customEvent.detail?.projectId?.trim() || nextRecord?.projectId,
        requestId
      });
    }

    function syncDetailFromHistory() {
      const requestId = new URLSearchParams(window.location.search)
        .get("requestId")
        ?.trim();

      if (!requestId) {
        closeDetail();
        return;
      }

      const nextRecord = recordsByRequestId.get(requestId);
      setDetail(nextRecord);
      setLoadError(null);
      setLoadState(nextRecord ? "ready" : "loading");
      setSelection({
        projectId: nextRecord?.projectId,
        requestId
      });
    }

    window.addEventListener(REQUEST_LOG_DETAIL_CLOSE_EVENT, closeDetail);
    window.addEventListener(REQUEST_LOG_DETAIL_SELECT_EVENT, selectDetail);
    window.addEventListener("popstate", syncDetailFromHistory);

    return () => {
      window.removeEventListener(REQUEST_LOG_DETAIL_CLOSE_EVENT, closeDetail);
      window.removeEventListener(REQUEST_LOG_DETAIL_SELECT_EVENT, selectDetail);
      window.removeEventListener("popstate", syncDetailFromHistory);
    };
  }, [recordsByRequestId, variant]);

  useEffect(() => {
    if (!selection.requestId) {
      setDetail(undefined);
      setLoadError(null);
      setLoadState("idle");
      return;
    }

    const fallbackRecord = recordsByRequestId.get(selection.requestId);
    const controller = new AbortController();
    const query = new URLSearchParams({
      requestId: selection.requestId,
      tenantId
    });

    if (selection.projectId) {
      query.set("projectId", selection.projectId);
    }

    setDetail(fallbackRecord);
    setLoadError(null);
    setLoadState(fallbackRecord ? "ready" : "loading");

    fetch("/api/request-logs/detail?" + query.toString(), {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Request detail returned status " + response.status);
        }
        return (await response.json()) as DetailApiResponse;
      })
      .then((payload) => {
        if (controller.signal.aborted) {
          return;
        }

        if (payload.data) {
          setDetail(toDisplayModelRecord(payload.data));
          setLoadState("ready");
          return;
        }

        if (fallbackRecord) {
          setDetail(fallbackRecord);
          setLoadState("ready");
          return;
        }

        setDetail(undefined);
        setLoadError("요청 상세 정보를 찾을 수 없습니다.");
        setLoadState("error");
      })
      .catch(() => {
        if (controller.signal.aborted) {
          return;
        }

        if (fallbackRecord) {
          setDetail(fallbackRecord);
          setLoadState("ready");
          return;
        }

        setDetail(undefined);
        setLoadError("요청 상세 정보를 불러오지 못했습니다.");
        setLoadState("error");
      });

    return () => {
      controller.abort();
    };
  }, [recordsByRequestId, selection.projectId, selection.requestId, tenantId]);

  const record =
    detail ??
    (selection.requestId
      ? recordsByRequestId.get(selection.requestId)
      : undefined);

  if (variant === "drawer") {
    return selection.requestId ? (
      <RequestDetailDrawer
        error={loadError}
        loadState={loadState}
        locale={locale}
        onClose={() => onClose?.()}
        record={record}
        requestId={selection.requestId}
        timezone={timezone}
      />
    ) : null;
  }

  if (!selection.requestId || !record) {
    return null;
  }

  return (
    <RequestLogDetailAside
      locale={locale}
      record={record}
      tenantId={tenantId}
      timezone={timezone}
    />
  );
}

function toDisplayModelRecord(record: InvocationLogRecord): InvocationLogRecord {
  return {
    ...record,
    requestedModel: record.requestedModel
      ? formatModelDisplayName(record.requestedModel)
      : record.requestedModel,
    selectedModel: record.selectedModel
      ? formatModelDisplayName(record.selectedModel)
      : record.selectedModel
  };
}
