"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Locale } from "@/lib/i18n/locale";

export function RequestIdCopyButton({
  compact = false,
  locale,
  requestId
}: {
  compact?: boolean;
  locale: Locale;
  requestId: string;
}) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  async function copyRequestId() {
    if (!navigator.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(requestId);
    setCopied(true);

    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
    resetTimerRef.current = window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <button
      aria-label={
        copied
          ? locale === "ko" ? "요청 ID가 복사됨" : "Request ID copied"
          : locale === "ko" ? "요청 ID 복사" : "Copy Request ID"
      }
      className="request-detail-copy-button"
      data-compact={compact || undefined}
      data-copied={copied || undefined}
      onClick={() => void copyRequestId()}
      type="button"
    >
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {!compact ? (
        <span>
          {copied
            ? locale === "ko" ? "복사됨" : "Copied"
            : locale === "ko" ? "복사" : "Copy"}
        </span>
      ) : null}
    </button>
  );
}
