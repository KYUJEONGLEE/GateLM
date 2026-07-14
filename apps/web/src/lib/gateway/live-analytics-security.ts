import "server-only";

import {
  buildAnalyticsSecurityEvidence,
  type AnalyticsSecurityEvidence
} from "@/features/analytics/analytics-security-evidence";
import { getLiveGatewayRequestDetail } from "@/lib/gateway/live-request-detail";
import { getLiveGatewayRequestLogs } from "@/lib/gateway/live-request-logs";

const MAX_SECURITY_DETAIL_REQUESTS = 24;
const SECURITY_DETAIL_CONCURRENCY = 4;

export async function getLiveAnalyticsSecurityEvidence(filters: {
  from: string;
  projectId?: string;
  tenantId: string;
  to: string;
}): Promise<AnalyticsSecurityEvidence | undefined> {
  const records = await getLiveGatewayRequestLogs({
    from: filters.from,
    limit: 100,
    projectId: filters.projectId,
    tenantId: filters.tenantId,
    to: filters.to
  });

  if (!records) {
    return undefined;
  }

  const protectedRecords = records.filter((record) => {
    const safetyOutcome = record.domainOutcomes?.safety?.outcome?.toLowerCase() ?? "";
    return record.maskingAction === "redacted" ||
      record.maskingAction === "blocked" ||
      safetyOutcome.includes("redact") ||
      safetyOutcome.includes("mask") ||
      safetyOutcome.includes("block");
  });
  const sampledRecords = protectedRecords.slice(0, MAX_SECURITY_DETAIL_REQUESTS);
  const details = [];

  for (let index = 0; index < sampledRecords.length; index += SECURITY_DETAIL_CONCURRENCY) {
    const batch = sampledRecords.slice(index, index + SECURITY_DETAIL_CONCURRENCY);
    details.push(...await Promise.all(batch.map((record) =>
      getLiveGatewayRequestDetail(record.requestId, {
        projectId: record.projectId,
        tenantId: filters.tenantId
      }).catch(() => undefined)
    )));
  }

  return buildAnalyticsSecurityEvidence(details, protectedRecords.length);
}
