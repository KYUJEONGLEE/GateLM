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
    p50Ms: number;
    p95Ms: number;
    p99Ms: number;
    providerP95Ms: number;
  };
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
  limit = 20
): Promise<TenantChatInvocation[] | undefined> {
  const query = new URLSearchParams({
    from,
    limit: String(limit),
    to
  });
  const payload = await getJson<{ data?: TenantChatInvocation[] }>(
    `/admin/v1/tenants/${encodeURIComponent(tenantId)}/tenant-chat/invocations?${query}`
  );
  return Array.isArray(payload?.data) ? payload.data : undefined;
}

async function getJson<T>(path: string): Promise<T | undefined> {
  try {
    const response = await fetch(`${getControlPlaneBaseUrl()}${path}`, {
      cache: "no-store",
      headers: await buildControlPlaneHeaders()
    });
    if (!response.ok) {
      return undefined;
    }
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}
