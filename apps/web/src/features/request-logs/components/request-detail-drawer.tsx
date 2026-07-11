"use client";

import { AlertCircle, LoaderCircle, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog";
import { RequestLogDetailPanel } from "./request-log-detail";
import { RequestIdCopyButton } from "./request-id-copy-button";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { formatDisplayIdentifier } from "@/lib/formatting/display-identifiers";
import type { Locale } from "@/lib/i18n/locale";

type RequestDetailDrawerProps = {
  error: string | null;
  locale: Locale;
  loadState: "idle" | "loading" | "ready" | "error";
  onClose: () => void;
  record?: InvocationLogRecord;
  requestId: string;
  timezone: string;
};

export function RequestDetailDrawer({
  error,
  locale,
  loadState,
  onClose,
  record,
  requestId,
  timezone
}: RequestDetailDrawerProps) {
  const [isOpen, setIsOpen] = useState(true);
  const closeTimerRef = useRef<number | null>(null);
  const requestClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      return;
    }

    setIsOpen(false);
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 0
      : 360;
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      onClose();
    }, duration);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          requestClose();
        }
      }}
      open={isOpen}
    >
      <DialogContent
        backdropClassName="request-detail-drawer-backdrop"
        className="request-detail-drawer"
        showClose={false}
      >
        <div className="request-detail-drawer-header">
          <div className="request-detail-drawer-heading">
            <DialogTitle>{locale === "ko" ? "요청 상세" : "Request detail"}</DialogTitle>
            <span className="request-detail-drawer-request-id" title={requestId}>
              <code>{formatDisplayIdentifier(requestId)}</code>
              <RequestIdCopyButton compact locale={locale} requestId={requestId} />
            </span>
            <DialogDescription className="sr-only">
              {locale === "ko"
                ? "선택한 요청의 처리 결과와 세부 정보"
                : "Processing result and details for the selected request"}
            </DialogDescription>
          </div>
          <div className="request-detail-drawer-actions">
            <button
              aria-label={locale === "ko" ? "요청 상세 닫기" : "Close request detail"}
              className="request-detail-drawer-close"
              onClick={requestClose}
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="request-detail-drawer-content">
          {loadState === "loading" && !record ? (
            <div className="request-detail-load-state" role="status">
              <LoaderCircle aria-hidden="true" className="is-spinning" />
              <strong>
                {locale === "ko" ? "요청 상세 정보를 불러오는 중입니다" : "Loading request detail"}
              </strong>
              <span>
                {locale === "ko"
                  ? "실제 요청 처리 결과를 확인하고 있습니다."
                  : "Loading the actual processing result."}
              </span>
            </div>
          ) : null}
          {loadState === "error" && !record ? (
            <div className="request-detail-load-state is-error" role="alert">
              <AlertCircle aria-hidden="true" />
              <strong>
                {locale === "ko"
                  ? "요청 상세 정보를 불러올 수 없습니다"
                  : "Request detail unavailable"}
              </strong>
              <span>{error ?? "요청 상세 정보를 불러오지 못했습니다."}</span>
            </div>
          ) : null}
          {record ? (
            <RequestLogDetailPanel locale={locale} record={record} timezone={timezone} />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
