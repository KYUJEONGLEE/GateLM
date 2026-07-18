import "server-only";

import { getControlPlaneBaseUrl } from "@/lib/control-plane/control-plane-config";
import { buildControlPlaneHeaders } from "@/lib/control-plane/control-plane-request";

const tenantChatRuntimeUnavailableMessage = "Tenant Chat runtime provenance is unavailable.";

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
  maskingAction: "none" | "redacted" | "blocked" | null;
  maskingDetectedTypes: string[];
  maskingDetectedCount: number;
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
  security: {
    protectedRequests: number;
    redactedRequests: number;
    blockedRequests: number;
    byDetectorType: Array<{
      detectorType: string;
      requestCount: number;
    }>;
    coverage: {
      state: "complete" | "partial" | "unavailable";
      observedFrom: string | null;
    };
  };
};

export type TenantChatCostSeries = {
  surface: "tenant_chat";
  from: string;
  to: string;
  bucket: "1s" | "7s" | "1m" | "5m" | "1h" | "1d";
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
): Promise<TenantChatDashboard | null | undefined> {
  const query = new URLSearchParams({ from, surface: "tenant_chat", to });
  const result = await getJson<{ data?: TenantChatDashboard }>(
    `/admin/v1/tenants/${encodeURIComponent(tenantId)}/tenant-chat/dashboard?${query}`
  );
  if (result.payload?.data?.surface === "tenant_chat") {
    return result.payload.data;
  }
  if (
    result.status === 503 &&
    result.errorMessage === tenantChatRuntimeUnavailableMessage
  ) {
    return null;
  }
  return undefined;
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
  const { payload } = await getJson<{ data?: TenantChatInvocation[] }>(
    `/admin/v1/tenants/${encodeURIComponent(tenantId)}/tenant-chat/invocations?${query}`
  );
  return Array.isArray(payload?.data) ? payload.data : undefined;
}

export async function getTenantChatInvocation(
  tenantId: string,
  requestId: string
): Promise<TenantChatInvocation | undefined> {
  const result = await getJson<{ data?: TenantChatInvocation }>(
    `/admin/v1/tenants/${encodeURIComponent(tenantId)}/tenant-chat/invocations/${encodeURIComponent(requestId)}`,
    { suppressNotFoundWarning: true }
  );
  return result.payload?.data?.requestId === requestId ? result.payload.data : undefined;
}

export async function getTenantChatCostSeries(
  tenantId: string,
  from: string,
  to: string,
  bucket: TenantChatCostSeries["bucket"]
): Promise<TenantChatCostSeries | undefined> {
  const query = new URLSearchParams({ bucket, from, to });
  const { payload } = await getJson<{ data?: TenantChatCostSeries }>(
    `/admin/v1/tenants/${encodeURIComponent(tenantId)}/tenant-chat/cost-series?${query}`
  );
  return payload?.data?.surface === "tenant_chat" ? payload.data : undefined;
}

type ControlPlaneJsonResult<T> = {
  errorMessage?: string;
  payload?: T;
  status?: number;
};

async function getJson<T>(
  path: string,
  options: { suppressNotFoundWarning?: boolean } = {}
): Promise<ControlPlaneJsonResult<T>> {
  try {
    const response = await fetch(`${getControlPlaneBaseUrl()}${path}`, {
      cache: "no-store",
      headers: await buildControlPlaneHeaders()
    });
    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => undefined)) as unknown;
      const errorMessage = readErrorMessage(errorPayload);
      const expectedRuntimeUnavailable =
        response.status === 503 && errorMessage === tenantChatRuntimeUnavailableMessage;
      const expectedNotFound = options.suppressNotFoundWarning && response.status === 404;

      if (!expectedRuntimeUnavailable && !expectedNotFound) {
        console.warn("Tenant Chat Control Plane request unavailable", {
          status: response.status
        });
      }

      return {
        errorMessage,
        status: response.status
      };
    }
    return {
      payload: (await response.json()) as T,
      status: response.status
    };
  } catch (error) {
    console.warn("Tenant Chat Control Plane request unavailable", {
      errorType: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message : "Unknown error"
    });
    return {};
  }
}

function readErrorMessage(value: unknown) {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as { error?: unknown; message?: unknown };
  if (typeof record.message === "string") {
    return record.message;
  }

  if (Array.isArray(record.message)) {
    const message = record.message.find((item): item is string => typeof item === "string");
    if (message) {
      return message;
    }
  }

  const error = record.error;
  if (!error || typeof error !== "object") {
    return undefined;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}
