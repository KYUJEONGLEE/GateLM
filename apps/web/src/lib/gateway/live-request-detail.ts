import "server-only";

import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";

type GatewayRequestDetailResponse = {
  data?: {
    applicationId?: string | null;
    budgetScope?: GatewayBudgetScope;
    cache?: {
      cacheHitRequestId?: string | null;
      cacheKeyHash?: string | null;
      cacheStatus?: string;
      cacheType?: string;
    };
    completedAt?: string | null;
    cost?: {
      costMicroUsd?: number;
    };
    createdAt?: string;
    error?: {
      errorCode?: string | null;
      errorMessage?: string | null;
      errorStage?: string | null;
    };
    httpStatus?: number;
    latency?: {
      latencyMs?: number;
      providerLatencyMs?: number | null;
    };
    masking?: {
      maskingAction?: "none" | "redacted" | "blocked";
      maskingDetectedCount?: number;
      maskingDetectedTypes?: string[];
      redactedPromptPreview?: string | null;
    };
    model?: string;
    projectId?: string;
    provider?: string;
    requestedModel?: string;
    requestId?: string;
    routing?: {
      routingReason?: string | null;
      selectedModel?: string | null;
      selectedProvider?: string | null;
    };
    selectedModel?: string;
    status?: InvocationLogRecord["status"];
    tenantId?: string;
    traceId?: string;
    usage?: {
      completionTokens?: number;
      promptTokens?: number;
      totalTokens?: number;
    };
  };
};

type GatewayBudgetScope = {
  budgetScopeId?: string;
  budgetScopeType?: string;
  resolvedBy?: string;
};

export async function getLiveGatewayRequestDetail(
  requestId: string
): Promise<InvocationLogRecord | undefined> {
  const config = getLiveGatewayConfig();
  const response = await fetch(`${config.baseUrl}/api/llm-requests/${encodeURIComponent(requestId)}`, {
    headers: {
      "X-GateLM-Request-Id": `request_web_detail_${Date.now()}`
    },
    cache: "no-store"
  }).catch(() => undefined);

  if (!response || response.status === 404 || !response.ok) {
    return undefined;
  }

  const payload = (await response.json().catch(() => ({}))) as GatewayRequestDetailResponse;

  if (!payload.data?.requestId) {
    return undefined;
  }

  return toInvocationRecord(payload.data);
}

function toInvocationRecord(data: NonNullable<GatewayRequestDetailResponse["data"]>): InvocationLogRecord {
  const createdAt = data.createdAt ?? new Date().toISOString();
  const completedAt = data.completedAt ?? createdAt;
  const status = normalizeLegacyBridgeStatus(data.status);
  const cacheStatus = data.cache?.cacheStatus ?? "bypass";
  const maskingAction = data.masking?.maskingAction ?? "none";
  const applicationId = data.applicationId ?? "live_gateway_application";
  const budgetScope = normalizeBudgetScope(data.budgetScope, applicationId);

  return {
    requestId: data.requestId ?? "",
    traceId: data.traceId ?? data.requestId ?? "",
    tenantId: data.tenantId ?? "live_gateway_tenant",
    projectId: data.projectId ?? "live_gateway_project",
    applicationId,
    budgetScope,
    apiKeyId: "live_gateway_api_key",
    appTokenId: "live_gateway_app_token",
    endUserId: "customer_user_demo_live",
    featureId: "support-reply",
    endpoint: "/v1/chat/completions",
    method: "POST",
    source: "customer_demo_app",
    stream: false,
    requestBodyHash: "not-exposed-by-live-detail",
    promptHash: "not-exposed-by-live-detail",
    redactedPromptPreview: data.masking?.redactedPromptPreview ?? null,
    requestedProvider: null,
    requestedModel: data.requestedModel ?? null,
    selectedProvider: data.routing?.selectedProvider ?? data.provider ?? null,
    selectedModel: data.routing?.selectedModel ?? data.selectedModel ?? data.model ?? null,
    routingReason: data.routing?.routingReason ?? null,
    cacheStatus,
    cacheType: data.cache?.cacheType ?? "none",
    cacheKeyHash: data.cache?.cacheKeyHash ?? null,
    cacheHitRequestId: data.cache?.cacheHitRequestId ?? null,
    maskingAction,
    maskingDetectedTypes: data.masking?.maskingDetectedTypes ?? [],
    maskingDetectedCount: data.masking?.maskingDetectedCount ?? 0,
    rateLimitDecision: {
      allowed: status !== "rate_limited",
      scope: budgetScope.budgetScopeType,
      scopeId: budgetScope.budgetScopeId,
      limit: 0,
      remaining: 0,
      windowSeconds: 60,
      windowStart: createdAt,
      resetAt: completedAt,
      retryAfterSeconds: 0,
      reason: status === "rate_limited" ? "limit_exceeded" : "not-exposed-by-live-detail",
      durationMs: 0
    },
    promptTokens: data.usage?.promptTokens ?? 0,
    completionTokens: data.usage?.completionTokens ?? 0,
    totalTokens: data.usage?.totalTokens ?? 0,
    costMicroUsd: data.cost?.costMicroUsd ?? 0,
    savedCostMicroUsd: cacheStatus === "hit" ? data.cost?.costMicroUsd ?? 0 : 0,
    latencyMs: data.latency?.latencyMs ?? 0,
    providerLatencyMs: data.latency?.providerLatencyMs ?? null,
    status,
    httpStatus: data.httpStatus ?? 0,
    errorCode: data.error?.errorCode ?? null,
    errorMessage: data.error?.errorMessage ?? null,
    errorStage: data.error?.errorStage ?? null,
    createdAt,
    completedAt,
    metadata: {
      runtime: {
        runtimeSnapshot: {
          runtimeSnapshotId: "runtime_snapshot_live_gateway",
          runtimeSnapshotVersion: 1,
          contentHash: "live-gateway",
          runtimeState: "snapshot_active",
          publishedAt: createdAt,
          publishedBy: "runtime_config_compat",
          gatewayInstanceId: "gateway_web_live",
          legacyHashes: {
            configHash: "live-gateway",
            securityPolicyHash: "live-gateway",
            routingPolicyHash: "live-gateway"
          }
        }
      }
    }
  };
}

function normalizeBudgetScope(scope: GatewayBudgetScope | undefined, applicationId: string) {
  if (scope?.budgetScopeType && scope.budgetScopeId && scope.resolvedBy) {
    return {
      budgetScopeType: scope.budgetScopeType,
      budgetScopeId: scope.budgetScopeId,
      resolvedBy: scope.resolvedBy
    };
  }

  return {
    budgetScopeType: "application",
    budgetScopeId: applicationId,
    resolvedBy: "default_application"
  };
}

// Live Gateway detail payloads may still carry legacy status names; normalize them for the v2-facing read model.
function normalizeLegacyBridgeStatus(value: string | undefined): InvocationLogRecord["status"] {
	if (
		value === "success" ||
		value === "blocked" ||
		value === "rate_limited" ||
		value === "failed" ||
		value === "cancelled"
	) {
		return value;
	}
	if (value === "cache_hit") {
		return "success";
	}
	if (value === "error") {
		return "failed";
	}

	return "failed";
}
