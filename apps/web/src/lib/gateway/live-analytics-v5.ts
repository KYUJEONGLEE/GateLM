import "server-only";

import {
  buildAnalyticsV5Evidence,
  type AnalyticsV5Evidence
} from "@/features/analytics/analytics-v5-evidence";
import {
  getAnalyticsPerformanceRange,
  type LiveAnalyticsRange
} from "@/lib/gateway/live-analytics-performance";
import { getLiveGatewayRequestLogs } from "@/lib/gateway/live-request-logs";

export async function getLiveAnalyticsV5Evidence(
  tenantId: string,
  filters: { projectId?: string; range: LiveAnalyticsRange }
): Promise<AnalyticsV5Evidence | undefined> {
  const range = getAnalyticsPerformanceRange(filters.range);
  const records = await getLiveGatewayRequestLogs({
    from: range.from,
    limit: 1000,
    projectId: filters.projectId,
    tenantId,
    to: range.to
  });

  return records
    ? buildAnalyticsV5Evidence(records, {
        from: range.from,
        range: filters.range,
        to: range.to
      })
    : undefined;
}
