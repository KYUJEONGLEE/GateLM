import "server-only";

import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import type { LiveAnalyticsRange } from "@/lib/gateway/live-analytics-performance";
import { getAnalyticsPerformanceRange } from "@/lib/gateway/live-analytics-performance";
import {
  getGatewayObservabilityHeaders,
  getLiveGatewayConfig
} from "@/lib/gateway/live-gateway-config";

export type AnalyticsReliabilitySurface = "all" | "project_application" | "tenant_chat";
export type AnalyticsReliabilitySourceSurface = Exclude<AnalyticsReliabilitySurface, "all">;
export type AnalyticsReliabilityQueryStatus = "ok" | "partial" | "stale" | "unavailable";

export type AnalyticsReliabilityTotals = {
  blockedCount: number;
  cancelledCount: number;
  failedCount: number;
  fallbackRequestCount: number;
  fallbackSuccessCount: number;
  rateLimitedCount: number;
  requestCount: number;
  successCount: number;
  unknownCount: number;
};

export type AnalyticsReliabilityIncident = {
  canonicalStatus: "success" | "failed" | "blocked" | "rate_limited" | "cancelled" | "unknown";
  fallbackOutcome: "success" | "failed" | "not_attempted" | "unknown";
  httpStatus: number | null;
  model: string | null;
  occurredAt: string;
  projectId: string | null;
  provider: string | null;
  requestId: string;
  sourceOutcome: string;
  surface: AnalyticsReliabilitySourceSurface;
};

export type LiveAnalyticsReliability = {
  continuity: {
    cancelledCount: number;
    excludedPolicyCount: number;
    failedCount: number;
    fallbackRecoveredCount: number;
    successWithoutFallbackCount: number;
    unknownCount: number;
  };
  freshness: {
    complete: boolean;
    queryStatus: AnalyticsReliabilityQueryStatus;
    sources: Array<{
      lastAggregatedAt: string | null;
      lastEventAt: string | null;
      queryMode: "raw" | "rollup" | "hybrid" | "unavailable";
      queryStatus: AnalyticsReliabilityQueryStatus;
      surface: AnalyticsReliabilitySourceSurface;
    }>;
  };
  generatedAt: string;
  rates: {
    fallbackRecoveryRate: number | null;
    successRate: number | null;
    systemErrorRate: number | null;
  };
  recentIncidents: AnalyticsReliabilityIncident[];
  scope: {
    from: string;
    projectId: string | null;
    surface: AnalyticsReliabilitySurface;
    tenantId: string;
    to: string;
  };
  surfaceTotals: Array<{
    included: boolean;
    surface: AnalyticsReliabilitySourceSurface;
    totals: AnalyticsReliabilityTotals | null;
  }>;
  terminalOutcomes: Array<{
    outcome: AnalyticsReliabilityIncident["canonicalStatus"];
    requestCount: number;
  }>;
  totals: AnalyticsReliabilityTotals;
};

type GatewayAnalyticsReliabilityResponse = {
  data?: Partial<LiveAnalyticsReliability>;
};

export async function getLiveAnalyticsReliability(
  tenantId: string,
  filters: {
    incidentLimit?: number;
    projectId?: string;
    range?: LiveAnalyticsRange;
    surface?: AnalyticsReliabilitySurface;
  } = {}
): Promise<LiveAnalyticsReliability | undefined> {
  const config = getLiveGatewayConfig();
  const range = getAnalyticsPerformanceRange(filters.range);
  const effectiveSurface = filters.projectId ? "project_application" : filters.surface ?? "all";
  const query = new URLSearchParams({
    from: range.from,
    incidentLimit: String(clampInteger(filters.incidentLimit ?? 4, 1, 20)),
    surface: effectiveSurface,
    tenantId: toGatewayTenantId(tenantId),
    to: range.to
  });
  appendOptionalQuery(query, "projectId", filters.projectId);

  const response = await fetch(`${config.baseUrl}/api/analytics/reliability?${query.toString()}`, {
    headers: getGatewayObservabilityHeaders(`request_web_analytics_reliability_${Date.now()}`),
    cache: "no-store"
  }).catch(() => undefined);

  if (!response?.ok) {
    return undefined;
  }

  const payload = (await response.json().catch(() => ({}))) as GatewayAnalyticsReliabilityResponse;
  return normalizeAnalyticsReliability(payload.data, tenantId, range);
}

export function normalizeAnalyticsReliability(
  data: Partial<LiveAnalyticsReliability> | undefined,
  routeTenantId: string,
  fallbackRange: { from: string; to: string }
): LiveAnalyticsReliability | undefined {
  if (!data?.totals || !data.rates || !data.continuity || !data.freshness) {
    return undefined;
  }

  const scope = data.scope;
  const totals = normalizeTotals(data.totals);
  const reportedStatus = normalizeQueryStatus(data.freshness.queryStatus);
  const complete = data.freshness.complete === true;
  const totalsConserve = totals.requestCount ===
    totals.successCount + totals.failedCount + totals.blockedCount + totals.rateLimitedCount +
      totals.cancelledCount + totals.unknownCount;
  const queryStatus = reportedStatus === "ok" &&
    (!complete || !totalsConserve || totals.unknownCount > 0)
    ? "partial"
    : reportedStatus;
  return {
    continuity: {
      cancelledCount: normalizeCount(data.continuity.cancelledCount),
      excludedPolicyCount: normalizeCount(data.continuity.excludedPolicyCount),
      failedCount: normalizeCount(data.continuity.failedCount),
      fallbackRecoveredCount: normalizeCount(data.continuity.fallbackRecoveredCount),
      successWithoutFallbackCount: normalizeCount(data.continuity.successWithoutFallbackCount),
      unknownCount: normalizeCount(data.continuity.unknownCount)
    },
    freshness: {
      complete: complete && totalsConserve && totals.unknownCount === 0,
      queryStatus,
      sources: (data.freshness.sources ?? []).flatMap((source) => {
        const surface = normalizeSourceSurface(source.surface);
        if (!surface) return [];
        return [{
          lastAggregatedAt: normalizeTimestamp(source.lastAggregatedAt),
          lastEventAt: normalizeTimestamp(source.lastEventAt),
          queryMode: normalizeQueryMode(source.queryMode),
          queryStatus: normalizeQueryStatus(source.queryStatus),
          surface
        }];
      })
    },
    generatedAt: normalizeTimestamp(data.generatedAt) ?? fallbackRange.to,
    rates: {
      fallbackRecoveryRate: normalizeRate(data.rates.fallbackRecoveryRate),
      successRate: normalizeRate(data.rates.successRate),
      systemErrorRate: normalizeRate(data.rates.systemErrorRate)
    },
    recentIncidents: (data.recentIncidents ?? []).flatMap(normalizeIncident),
    scope: {
      from: normalizeTimestamp(scope?.from) ?? fallbackRange.from,
      projectId: normalizeNullableText(scope?.projectId),
      surface: normalizeSurface(scope?.surface),
      tenantId: normalizeText(scope?.tenantId) || routeTenantId,
      to: normalizeTimestamp(scope?.to) ?? fallbackRange.to
    },
    surfaceTotals: (data.surfaceTotals ?? []).flatMap((item) => {
      const surface = normalizeSourceSurface(item.surface);
      if (!surface) return [];
      return [{
        included: item.included === true,
        surface,
        totals: item.totals ? normalizeTotals(item.totals) : null
      }];
    }),
    terminalOutcomes: (data.terminalOutcomes ?? []).flatMap((item) => {
      const outcome = normalizeCanonicalStatus(item.outcome);
      return outcome ? [{ outcome, requestCount: normalizeCount(item.requestCount) }] : [];
    }),
    totals
  };
}

function normalizeTotals(totals: Partial<AnalyticsReliabilityTotals>): AnalyticsReliabilityTotals {
  return {
    blockedCount: normalizeCount(totals.blockedCount),
    cancelledCount: normalizeCount(totals.cancelledCount),
    failedCount: normalizeCount(totals.failedCount),
    fallbackRequestCount: normalizeCount(totals.fallbackRequestCount),
    fallbackSuccessCount: normalizeCount(totals.fallbackSuccessCount),
    rateLimitedCount: normalizeCount(totals.rateLimitedCount),
    requestCount: normalizeCount(totals.requestCount),
    successCount: normalizeCount(totals.successCount),
    unknownCount: normalizeCount(totals.unknownCount)
  };
}

function normalizeIncident(
  incident: AnalyticsReliabilityIncident
): AnalyticsReliabilityIncident[] {
  const surface = normalizeSourceSurface(incident.surface);
  const canonicalStatus = normalizeCanonicalStatus(incident.canonicalStatus);
  const occurredAt = normalizeTimestamp(incident.occurredAt);
  const requestId = normalizeText(incident.requestId);
  if (!surface || !canonicalStatus || !occurredAt || !requestId) {
    return [];
  }
  return [{
    canonicalStatus,
    fallbackOutcome: normalizeFallbackOutcome(incident.fallbackOutcome),
    httpStatus: normalizeNullableInteger(incident.httpStatus),
    model: normalizeNullableText(incident.model),
    occurredAt,
    projectId: normalizeNullableText(incident.projectId),
    provider: normalizeNullableText(incident.provider),
    requestId,
    sourceOutcome: normalizeText(incident.sourceOutcome) || "unknown",
    surface
  }];
}

function normalizeCanonicalStatus(value: unknown): AnalyticsReliabilityIncident["canonicalStatus"] | null {
  return value === "success" || value === "failed" || value === "blocked" ||
    value === "rate_limited" || value === "cancelled" || value === "unknown"
    ? value
    : null;
}

function normalizeFallbackOutcome(value: unknown): AnalyticsReliabilityIncident["fallbackOutcome"] {
  return value === "success" || value === "failed" || value === "not_attempted" ? value : "unknown";
}

function normalizeSourceSurface(value: unknown): AnalyticsReliabilitySourceSurface | null {
  return value === "project_application" || value === "tenant_chat" ? value : null;
}

function normalizeSurface(value: unknown): AnalyticsReliabilitySurface {
  return value === "project_application" || value === "tenant_chat" || value === "all" ? value : "all";
}

function normalizeQueryStatus(value: unknown): AnalyticsReliabilityQueryStatus {
  return value === "ok" || value === "partial" || value === "stale" ? value : "unavailable";
}

function normalizeQueryMode(value: unknown): "raw" | "rollup" | "hybrid" | "unavailable" {
  return value === "raw" || value === "rollup" || value === "hybrid" ? value : "unavailable";
}

function normalizeRate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : null;
}

function normalizeCount(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function normalizeNullableInteger(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNullableText(value: unknown) {
  return normalizeText(value) || null;
}

function normalizeTimestamp(value: unknown) {
  const normalized = normalizeText(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function clampInteger(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function appendOptionalQuery(query: URLSearchParams, key: string, value: string | undefined) {
  const normalized = value?.trim();
  if (normalized) query.set(key, normalized);
}

function toGatewayTenantId(tenantId: string) {
  return isUuid(tenantId) ? tenantId : getControlPlaneTenantId();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
