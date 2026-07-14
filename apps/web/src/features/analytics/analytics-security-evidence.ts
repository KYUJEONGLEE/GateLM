import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";

export type AnalyticsSecurityTypeRow = {
  id: string;
  label: string;
  value: number;
};

export type AnalyticsSecurityEvidence = {
  detectedTypeRows: AnalyticsSecurityTypeRow[];
  protectedRequestCount: number;
  sampledDetailCount: number;
};

type SafetyDetail = Pick<
  LiveInvocationLogRecord,
  "maskingDetectedTypes" | "safetySummary"
>;

export function buildAnalyticsSecurityEvidence(
  details: Array<SafetyDetail | undefined>,
  protectedRequestCount: number
): AnalyticsSecurityEvidence {
  const detectedRequestCounts = new Map<string, number>();
  let sampledDetailCount = 0;

  for (const detail of details) {
    if (!detail) {
      continue;
    }

    sampledDetailCount += 1;
    const detectedTypes = new Set([
      ...(detail.safetySummary?.detectorCategories ?? []),
      ...(detail.maskingDetectedTypes ?? [])
    ].map(normalizeDetectorType).filter(Boolean));

    for (const detectorType of detectedTypes) {
      detectedRequestCounts.set(
        detectorType,
        (detectedRequestCounts.get(detectorType) ?? 0) + 1
      );
    }
  }

  return {
    detectedTypeRows: Array.from(detectedRequestCounts, ([id, value]) => ({
      id,
      label: id,
      value
    })).sort((left, right) => right.value - left.value || left.id.localeCompare(right.id)),
    protectedRequestCount,
    sampledDetailCount
  };
}

function normalizeDetectorType(value: string) {
  return value.trim().toLowerCase();
}
