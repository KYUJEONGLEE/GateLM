import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";
import type { Locale } from "@/lib/i18n/locale";

export type RequestLogSafetyDetail = {
  detectedCount: number | null;
  detectedTypes: string[] | null;
  maskingAction: string | null;
  outcome: string | null;
};

export function buildRequestLogSafetyDetail(
  record: LiveInvocationLogRecord
): RequestLogSafetyDetail {
  const summary = record.safetySummary;
  const observationUnavailable = summary?.observationState === "unavailable";

  return {
    outcome:
      summary?.outcome ??
      record.domainOutcomes?.safety?.outcome ??
      record.maskingAction,
    maskingAction:
      observationUnavailable && !summary?.maskingAction
        ? null
        : summary?.maskingAction ?? record.maskingAction,
    detectedCount: observationUnavailable
      ? null
      : summary?.detectedCount ?? record.maskingDetectedCount,
    detectedTypes: observationUnavailable
      ? null
      : summary?.detectorCategories?.length
        ? summary.detectorCategories
        : record.maskingDetectedTypes
  };
}

export function maskingUnavailableLabel(locale: Locale) {
  return locale === "ko" ? "마스킹 관측 불가" : "Masking unavailable";
}
