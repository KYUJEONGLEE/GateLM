"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle
} from "@/components/ui/dialog";
import type { Locale } from "@/lib/i18n/locale";

export type FocusOriginRect = {
  height: number;
  left: number;
  top: number;
  viewportHeight: number;
  viewportWidth: number;
  width: number;
};

type LiveRequestsFocusDialogProps = {
  children: ReactNode;
  locale: Locale;
  onClose: () => void;
  open: boolean;
  origin: FocusOriginRect | null;
};

export function LiveRequestsFocusDialog({
  children,
  locale,
  onClose,
  open,
  origin
}: LiveRequestsFocusDialogProps) {
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent
        anchorStyle={focusOriginStyle(origin)}
        backdropClassName="live-requests-focus-backdrop"
        className="live-requests-focus-dialog"
        positioning="custom"
        showClose={false}
      >
        <DialogTitle className="sr-only">
          {locale === "ko" ? "실시간 요청 확대 화면" : "Live Requests focus view"}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {locale === "ko"
            ? "실시간 요청 목록의 행 순서를 고정하고 상세 정보를 확인합니다."
            : "Freeze the live request row order and inspect request details."}
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function focusOriginStyle(origin: FocusOriginRect | null): CSSProperties {
  if (!origin) {
    return {};
  }

  const isNarrowViewport = origin.viewportWidth <= 1100;
  const targetWidth = origin.viewportWidth * (isNarrowViewport ? 0.98 : 0.94);
  const targetHeight = origin.viewportHeight * (isNarrowViewport ? 0.94 : 0.88);
  const originCenterX = origin.left + origin.width / 2;
  const originCenterY = origin.top + origin.height / 2;

  return {
    "--live-focus-origin-x": originCenterX - origin.viewportWidth / 2 + "px",
    "--live-focus-origin-y": originCenterY - origin.viewportHeight / 2 + "px",
    "--live-focus-scale-x": Math.max(origin.width / targetWidth, 0.05),
    "--live-focus-scale-y": Math.max(origin.height / targetHeight, 0.05)
  } as CSSProperties;
}
