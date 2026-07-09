"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RequestLogDetailAside } from "@/features/request-logs/components/request-log-detail";
import {
  REQUEST_LOG_DETAIL_CLOSE_EVENT,
  REQUEST_LOG_DETAIL_SELECT_EVENT
} from "@/features/request-logs/components/request-log-detail-anchor";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import type { Locale } from "@/lib/i18n/locale";

type RequestLogDetailClientProps = {
  initialProjectId?: string;
  initialRecord?: InvocationLogRecord;
  initialRequestId?: string;
  locale: Locale;
  records: InvocationLogRecord[];
  tenantId: string;
  timezone: string;
};

type DetailSelection = {
  projectId?: string;
  requestId?: string;
};

type DetailApiResponse = {
  data?: InvocationLogRecord | null;
};

export function RequestLogDetailClient({
  initialProjectId,
  initialRecord,
  initialRequestId,
  locale,
  records,
  tenantId,
  timezone
}: RequestLogDetailClientProps) {
  const searchParams = useSearchParams();
  const requestIdFromUrl = searchParams.get("requestId")?.trim() || undefined;
  const [selection, setSelection] = useState<DetailSelection>({
    projectId: initialProjectId,
    requestId: initialRequestId ?? requestIdFromUrl
  });
  const [detail, setDetail] = useState<InvocationLogRecord | undefined>(
    initialRecord
  );

  const recordsByRequestId = useMemo(() => {
    return new Map(records.map((record) => [record.requestId, record]));
  }, [records]);

  useEffect(() => {
    setSelection((current) => {
      const nextRequestId = requestIdFromUrl ?? initialRequestId;

      if (current.requestId === nextRequestId) {
        return current;
      }

      const nextRecord = nextRequestId
        ? recordsByRequestId.get(nextRequestId)
        : undefined;

      setDetail(nextRecord);

      return {
        projectId: nextRecord?.projectId ?? initialProjectId,
        requestId: nextRequestId
      };
    });
  }, [initialProjectId, initialRequestId, recordsByRequestId, requestIdFromUrl]);

  useEffect(() => {
    function closeDetail() {
      setDetail(undefined);
      setSelection({});
    }

    function selectDetail(event: Event) {
      const customEvent = event as CustomEvent<DetailSelection>;
      const requestId = customEvent.detail?.requestId?.trim();

      if (!requestId) {
        return;
      }

      const nextRecord = recordsByRequestId.get(requestId);
      setDetail(nextRecord);
      setSelection({
        projectId: customEvent.detail?.projectId?.trim() || nextRecord?.projectId,
        requestId
      });
    }

    function syncDetailFromHistory() {
      const requestId = new URLSearchParams(window.location.search).get("requestId")?.trim();

      if (!requestId) {
        closeDetail();
        return;
      }

      const nextRecord = recordsByRequestId.get(requestId);
      setDetail(nextRecord);
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
  }, [recordsByRequestId]);

  useEffect(() => {
    if (!selection.requestId) {
      setDetail(undefined);
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

    fetch(`/api/request-logs/detail?${query.toString()}`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then((response) => (response.ok ? response.json() : undefined))
      .then((payload: DetailApiResponse | undefined) => {
        if (controller.signal.aborted) {
          return;
        }

        setDetail(
          payload?.data
            ? toDisplayModelRecord(payload.data)
            : fallbackRecord
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetail(fallbackRecord);
        }
      });

    return () => {
      controller.abort();
    };
  }, [recordsByRequestId, selection.projectId, selection.requestId, tenantId]);

  const record = detail ?? (
    selection.requestId ? recordsByRequestId.get(selection.requestId) : undefined
  );

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
