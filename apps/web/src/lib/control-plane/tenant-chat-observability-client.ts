import "server-only";

import { getControlPlaneBaseUrl } from "@/lib/control-plane/control-plane-config";
import { buildControlPlaneHeaders } from "@/lib/control-plane/control-plane-request";

export type TenantChatInvocation = {
  requestId: string;
  surface: "tenant_chat";
  executionScopeKind: "tenant_chat";
  tenantId: string;
  userId: string;
  employeeId: string | null;
  actorKind: string;
  turnId: string;
  terminalOutcome: string;
  providerId: string | null;
  modelKey: string | null;
  attemptCount: number;
  confirmedInputTokens: number;
  confirmedOutputTokens: number;
  confirmedTotalTokens: number;
  confirmedCostMicroUsd: number;
  quotaState: string;
  budgetState: string;
  cacheOutcome: string;
  latencyMs: number;
  snapshotVersion: number;
  pricingVersion: number;
  startedAt: string;
  completedAt: string;
  projectionVersion: number;
};

export type TenantChatDashboard = {
  surface: "tenant_chat";
  from: string;
  to: string;
  freshness: {
    projectedAt: string;
    lagSeconds: number;
    state: "fresh" | "stale" | "partial";
  };
  requests: {
    total: number;
    activeUsers: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    cacheHits: number;
    cacheMisses: number;
    cacheOff: number;
    cacheEligible: number;
    cacheHitRate: number;
    rateLimited: number;
    concurrencyLimited: number;
    safetyBlocked: number;
    quotaBlocked: number;
    budgetBlocked: number;
    fallbackRequests: number;
    fallbackSucceeded: number;
    providerAttempts: number;
    billableAttempts: number;
  };
  usage: {
    confirmedInputTokens: number;
    confirmedOutputTokens: number;
    confirmedTotalTokens: number;
    confirmedCostMicroUsd: number;
    unconfirmedIncidentCount: number;
    unconfirmedExposureMicroUsd: number;
  };
  policyStates: {
    quota: Record<"normal" | "warning" | "economy" | "blocked", number>;
    budget: Record<"normal" | "warning" | "economy" | "blocked", number>;
  };
  latency: {
    averageMs: number;
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    providerP95Ms: number;
  };
  breakdowns: Array<{
    providerId: string;
    modelKey: string;
    routeTier: "high_quality" | "standard" | "economy";
    requestCount: number;
    attemptCount: number;
    billableAttemptCount: number;
    fallbackSuccessCount: number;
    confirmedCostMicroUsd: number;
  }>;
};

export type TenantChatCostSeries = {
  surface: "tenant_chat";
  from: string;
  to: string;
  bucket: "7s" | "1m" | "5m" | "1h" | "1d";
  generatedAt: string;
  points: Array<{
    periodStart: string;
    requestCount: number;
    totalTokens: number;
    confirmedCostMicroUsd: number;
  }>;
};

export async function getTenantChatDashboard(
  tenantId: string,
  from: string,
  to: string
): Promise<TenantChatDashboard | undefined> {
  const query = new URLSearchParams({ from, surface: "tenant_chat", to });
  const payload = await getJson<{ data?: TenantChatDashboard }>(
    `/admin/v1/tenants/${encodeURIComponent(tenantId)}/tenant-chat/dashboard?${query}`
  );
  return payload?.data?.surface === "tenant_chat" ? payload.data : undefined;
}

export async function getTenantChatInvocations(
  tenantId: string,
  from: string,
  to: string,
  limit = 20,
  filters: { modelKey?: string; status?: string } = {}
): Promise<TenantChatInvocation[] | undefined> {
  const query = new URLSearchParams({
    from,
    limit: String(limit),
    to
  });
  if (filters.modelKey) query.set("modelKey", filters.modelKey);
  if (filters.status) query.set("status", filters.status);
  const payload = await getJson<{ data?: TenantChatInvocation[] }>(
    `/admin/v1/tenants/${encodeURIComponent(tenantId)}/tenant-chat/invocations?${query}`
  );
  return Array.isArray(payload?.data) ? payload.data : undefined;
}

export async function getTenantChatCostSeries(
  tenantId: string,
  from: string,
  to: string,
  bucket: TenantChatCostSeries["bucket"]
): Promise<TenantChatCostSeries | undefined> {
  const query = new URLSearchParams({ bucket, from, to });
  const payload = await getJson<{ data?: TenantChatCostSeries }>(
    `/admin/v1/tenants/${encodeURIComponent(tenantId)}/tenant-chat/cost-series?${query}`
  );
  return payload?.data?.surface === "tenant_chat" ? payload.data : undefined;
}

async function getJson<T>(path: string): Promise<T | undefined> {
  try {
    const response = await fetch(`${getControlPlaneBaseUrl()}${path}`, {
      cache: "no-store",
      headers: await buildControlPlaneHeaders()
    });
    if (!response.ok) {
      console.error("Tenant Chat Control Plane request failed", {
        status: response.status
      });
      return undefined;
    }
    return (await response.json()) as T;
  } catch (error) {
    console.error("Tenant Chat Control Plane request failed", {
      errorType: error instanceof Error ? error.name : "UnknownError"
    });
    return undefined;
  }
}
