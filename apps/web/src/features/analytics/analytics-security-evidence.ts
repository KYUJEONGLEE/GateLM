import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";
import type { TenantChatDashboard } from "@/lib/control-plane/tenant-chat-observability-client";
import type { DashboardOverview } from "@/lib/fixtures/v1-observability-fixtures";

export type AnalyticsSecurityTypeRow = {
  id: string;
  label: string;
  value: number;
};

export type AnalyticsSecurityEvidence = {
  blockedRequestCount?: number;
  detectedTypeRows: AnalyticsSecurityTypeRow[];
  detectorEvidenceMode?: "complete" | "mixed" | "partial" | "sampled" | "unavailable";
  maskedRequestCount?: number;
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

export function mergeAnalyticsSecurityEvidence(input: {
  projectApplicationEvidence?: AnalyticsSecurityEvidence;
  projectApplicationOverview?: DashboardOverview;
  tenantChatDashboard?: TenantChatDashboard | null;
}): AnalyticsSecurityEvidence | undefined {
  const { projectApplicationEvidence, projectApplicationOverview, tenantChatDashboard } = input;
  if (!projectApplicationEvidence && !projectApplicationOverview && !tenantChatDashboard) {
    return undefined;
  }

  const projectMasked = Math.max(
    countRecord(projectApplicationOverview?.maskingActionCounts, ["redacted", "masked"]),
    countOutcomes(projectApplicationOverview?.breakdowns?.bySafetyOutcome, ["redacted", "masked"])
  );
  const projectBlocked = Math.max(
    countRecord(projectApplicationOverview?.maskingActionCounts, ["blocked"]),
    countOutcomes(projectApplicationOverview?.breakdowns?.bySafetyOutcome, ["blocked"])
  );
  const tenantMasked = tenantChatDashboard?.security?.redactedRequests ?? 0;
  const tenantBlocked = tenantChatDashboard?.security?.blockedRequests ?? 0;
  const detectorCounts = new Map<string, number>();

  for (const row of projectApplicationEvidence?.detectedTypeRows ?? []) {
    detectorCounts.set(row.id, (detectorCounts.get(row.id) ?? 0) + row.value);
  }
  for (const row of tenantChatDashboard?.security?.byDetectorType ?? []) {
    const detectorType = normalizeDetectorType(row.detectorType);
    if (detectorType) {
      detectorCounts.set(
        detectorType,
        (detectorCounts.get(detectorType) ?? 0) + row.requestCount
      );
    }
  }

  const maskedRequestCount = projectMasked + tenantMasked;
  const blockedRequestCount = projectBlocked + tenantBlocked;
  return {
    blockedRequestCount,
    detectedTypeRows: Array.from(detectorCounts, ([id, value]) => ({
      id,
      label: id,
      value
    })).sort((left, right) => right.value - left.value || left.id.localeCompare(right.id)),
    detectorEvidenceMode: detectorEvidenceMode(
      Boolean(projectApplicationEvidence),
      tenantChatDashboard?.security?.coverage.state
    ),
    maskedRequestCount,
    protectedRequestCount: maskedRequestCount + blockedRequestCount,
    sampledDetailCount: projectApplicationEvidence?.sampledDetailCount ?? 0
  };
}

function detectorEvidenceMode(
  hasProjectSample: boolean,
  tenantCoverage: TenantChatDashboard["security"]["coverage"]["state"] | undefined
): AnalyticsSecurityEvidence["detectorEvidenceMode"] {
  if (!tenantCoverage) return hasProjectSample ? "sampled" : "unavailable";
  if (hasProjectSample) return tenantCoverage === "unavailable" ? "sampled" : "mixed";
  return tenantCoverage;
}

function countRecord(record: Record<string, number> | undefined, needles: string[]) {
  return Object.entries(record ?? {}).reduce((total, [key, value]) =>
    needles.some((needle) => key.toLowerCase().includes(needle)) ? total + value : total, 0);
}

function countOutcomes(
  rows: Array<{ outcome: string; requestCount: number }> | undefined,
  needles: string[]
) {
  return (rows ?? []).reduce((total, row) =>
    needles.some((needle) => row.outcome.toLowerCase().includes(needle))
      ? total + row.requestCount
      : total, 0);
}

function normalizeDetectorType(value: string) {
  return value.trim().toLowerCase();
}
