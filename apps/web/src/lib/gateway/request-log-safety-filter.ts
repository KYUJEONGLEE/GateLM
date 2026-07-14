import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";

export const requestLogSafetyOutcomeFilters = [
  "passed",
  "redacted",
  "blocked",
  "not_checked"
] as const;

export type RequestLogSafetyOutcomeFilter =
  (typeof requestLogSafetyOutcomeFilters)[number];

export function normalizeRequestLogSafetyOutcomeFilter(
  value: string | undefined
): "" | RequestLogSafetyOutcomeFilter {
  return requestLogSafetyOutcomeFilters.includes(value as RequestLogSafetyOutcomeFilter)
    ? value as RequestLogSafetyOutcomeFilter
    : "";
}

export function matchesRequestLogSafetyOutcome(
  record: Pick<LiveInvocationLogRecord, "domainOutcomes" | "maskingAction">,
  filter: string | undefined
) {
  const normalizedFilter = normalizeRequestLogSafetyOutcomeFilter(filter);
  return !normalizedFilter || requestLogSafetyOutcome(record) === normalizedFilter;
}

export function requestLogSafetyOutcome(
  record: Pick<LiveInvocationLogRecord, "domainOutcomes" | "maskingAction">
): RequestLogSafetyOutcomeFilter {
  const outcome = record.domainOutcomes?.safety?.outcome?.trim().toLowerCase();
  if (requestLogSafetyOutcomeFilters.includes(outcome as RequestLogSafetyOutcomeFilter)) {
    return outcome as RequestLogSafetyOutcomeFilter;
  }
  if (record.maskingAction === "redacted" || record.maskingAction === "blocked") {
    return record.maskingAction;
  }
  return record.maskingAction === "none" ? "passed" : "not_checked";
}
