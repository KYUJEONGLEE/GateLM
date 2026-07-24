import "server-only";

import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import {
  parseAnalyticsLiveUsage,
  type AnalyticsLiveUsage
} from "@/features/analytics/analytics-live-usage-contract";
import {
  getGatewayObservabilityHeaders,
  getLiveGatewayConfig
} from "@/lib/gateway/live-gateway-config";
import type { LiveAnalyticsRange } from "@/lib/gateway/live-analytics-performance";

export type LiveAnalyticsUsageResult =
  | { data: AnalyticsLiveUsage; status: "ok" }
  | { status: "error" }
  | { status: "unavailable" };

export async function getLiveAnalyticsUsage(
  tenantId: string,
  filters: {
    projectId?: string;
    range?: LiveAnalyticsRange;
    signal?: AbortSignal;
  } = {}
): Promise<LiveAnalyticsUsageResult> {
  const config = getLiveGatewayConfig();
  const range = filters.range ?? "1w";
  const liveRange = getAnalyticsLiveUsageRange(range);
  const query = new URLSearchParams({
    from: liveRange.from,
    tenantId: toGatewayTenantId(tenantId),
    to: liveRange.to
  });
  if (filters.projectId?.trim()) {
    query.set("projectId", filters.projectId.trim());
  }

  const response = await fetch(
    `${config.baseUrl}/api/analytics/live-usage?${query.toString()}`,
    {
      cache: "no-store",
      headers: getGatewayObservabilityHeaders(`request_web_live_usage_${Date.now()}`),
      signal: filters.signal
    }
  ).catch(() => undefined);

  if (!response) {
    return { status: "error" };
  }
  if (response.status === 503 || response.status === 404) {
    return { status: "unavailable" };
  }
  if (!response.ok) {
    return { status: "error" };
  }

  const payload = await response.json().catch(() => undefined) as
    | { data?: unknown }
    | undefined;
  const data = parseAnalyticsLiveUsage(payload?.data);
  return data ? { data, status: "ok" } : { status: "error" };
}

export function getAnalyticsLiveUsageRange(
  range: LiveAnalyticsRange,
  now = new Date()
) {
  const durationMs: Record<LiveAnalyticsRange, number> = {
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000
  };
  const to = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const from = new Date(to.getTime() - durationMs[range]);
  return { from: from.toISOString(), to: to.toISOString() };
}

function toGatewayTenantId(routeTenantId: string) {
  return isUuid(routeTenantId) ? routeTenantId : getControlPlaneTenantId();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
