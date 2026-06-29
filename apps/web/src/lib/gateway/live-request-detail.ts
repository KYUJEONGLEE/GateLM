import "server-only";

import {
  buildDomainOutcomesBridge,
  type DomainOutcomes,
  type InvocationLogRecord,
  type TerminalStatus
} from "@/lib/fixtures/v1-observability-fixtures";
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
    errorCode?: string | null;
    cost?: {
      costMicroUsd?: number;
    };
    domainOutcomes?: DomainOutcomes;
    createdAt?: string;
    error?: {
      errorCode?: string | null;
      errorMessage?: string | null;
      errorStage?: string | null;
    };
    httpStatus?: number;
    latencySummary?: {
      gatewayInternalLatencyMs?: number;
      providerLatencyMs?: number | null;
      totalLatencyMs?: number;
    };
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
      requestedModel?: string;
      routingReason?: string | null;
      selectedModel?: string | null;
      selectedProvider?: string | null;
    };
    safetySummary?: {
      detectorCategories?: string[];
      detectedCount?: number;
      maskingAction?: "none" | "redacted" | "blocked" | null;
      outcome?: string;
    };
    selectedModel?: string;
    status?: string;
    terminalStatus?: string;
    tenantId?: string;
    traceId?: string;
    usage?: {
      completionTokens?: number;
      promptTokens?: number;
      totalTokens?: number;
    };
    usageSummary?: {
      completionTokens?: number;
      estimatedCostMicroUsd?: number;
      promptTokens?: number;
      savedCostMicroUsd?: number;
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
  const terminalStatus = normalizeLegacyBridgeStatus(data.terminalStatus ?? data.status);
  const cacheStatus = normalizeCacheStatus(data.domainOutcomes?.cache?.outcome, data.cache?.cacheStatus);
  const maskingAction = normalizeMaskingAction(
    data.safetySummary?.maskingAction ??
      data.domainOutcomes?.safety?.maskingAction ??
      maskingActionFromSafetyOutcome(data.domainOutcomes?.safety?.outcome) ??
      data.masking?.maskingAction
  );
  const applicationId = data.applicationId ?? "live_gateway_application";
  const budgetScope = normalizeBudgetScope(data.budgetScope, applicationId);
  const requestedModel = data.routing?.requestedModel ?? data.requestedModel ?? "auto";
  const selectedModel = data.routing?.selectedModel ?? data.selectedModel ?? data.model ?? null;
  const selectedProvider = data.routing?.selectedProvider ?? data.provider ?? null;
  const detectorCategories =
    data.safetySummary?.detectorCategories ?? data.domainOutcomes?.safety?.detectedTypes ?? data.masking?.maskingDetectedTypes ?? [];
  const detectedCount =
    data.safetySummary?.detectedCount ?? data.domainOutcomes?.safety?.detectedCount ?? data.masking?.maskingDetectedCount ?? 0;
  const providerLatencyMs = data.latencySummary?.providerLatencyMs ?? data.latency?.providerLatencyMs ?? null;
  const totalLatencyMs = data.latencySummary?.totalLatencyMs ?? data.latency?.latencyMs ?? 0;
  const promptTokens = data.usageSummary?.promptTokens ?? data.usage?.promptTokens ?? 0;
  const completionTokens = data.usageSummary?.completionTokens ?? data.usage?.completionTokens ?? 0;
  const totalTokens = data.usageSummary?.totalTokens ?? data.usage?.totalTokens ?? 0;
  const costMicroUsd = data.usageSummary?.estimatedCostMicroUsd ?? data.cost?.costMicroUsd ?? 0;
  const savedCostMicroUsd = data.usageSummary?.savedCostMicroUsd ?? 0;
  const errorCode = data.errorCode ?? data.error?.errorCode ?? null;
  const domainOutcomes =
    data.domainOutcomes ??
    buildDomainOutcomesBridge({
      applicationId,
      budgetScope,
      cacheHitRequestId: null,
      cacheStatus,
      cacheType: data.cache?.cacheType ?? "none",
      errorCode,
      httpStatus: data.httpStatus ?? 0,
      maskingAction,
      maskingDetectedCount: detectedCount,
      maskingDetectedTypes: detectorCategories,
      providerLatencyMs,
      redactedPromptPreview: null,
      requestedModel,
      routingReason: data.routing?.routingReason ?? null,
      selectedModel,
      selectedProvider,
      stream: false,
      terminalStatus
    });

  return {
    requestId: data.requestId ?? "",
    traceId: data.traceId ?? data.requestId ?? "",
    tenantId: data.tenantId ?? "live_gateway_tenant",
    projectId: data.projectId ?? "live_gateway_project",
    applicationId,
    budgetScope,
    apiKeyId: "",
    appTokenId: "",
    endUserId: "customer_user_demo_live",
    featureId: "support-reply",
    endpoint: "/v1/chat/completions",
    method: "POST",
    source: "customer_demo_app",
    stream: false,
    requestBodyHash: "",
    promptHash: "",
    redactedPromptPreview: null,
    requestedProvider: null,
    requestedModel,
    selectedProvider,
    selectedModel,
    routingReason: data.routing?.routingReason ?? null,
    cacheStatus,
    cacheType: data.cache?.cacheType ?? "none",
    cacheKeyHash: null,
    cacheHitRequestId: null,
    maskingAction,
    maskingDetectedTypes: detectorCategories,
    maskingDetectedCount: detectedCount,
    rateLimitDecision: {
      allowed: terminalStatus !== "rate_limited",
      scope: budgetScope.budgetScopeType,
      scopeId: budgetScope.budgetScopeId,
      limit: 0,
      remaining: 0,
      windowSeconds: 60,
      windowStart: createdAt,
      resetAt: completedAt,
      retryAfterSeconds: 0,
      reason: terminalStatus === "rate_limited" ? "limit_exceeded" : "not-exposed-by-live-detail",
      durationMs: 0
    },
    promptTokens,
    completionTokens,
    totalTokens,
    costMicroUsd,
    savedCostMicroUsd,
    latencyMs: totalLatencyMs,
    providerLatencyMs,
    terminalStatus,
    domainOutcomes,
    status: terminalStatus,
    httpStatus: data.httpStatus ?? 0,
    errorCode,
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
function normalizeLegacyBridgeStatus(value: string | undefined): TerminalStatus {
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

function normalizeMaskingAction(value: string | undefined): InvocationLogRecord["maskingAction"] {
  if (value === "none" || value === "redacted" || value === "blocked") {
    return value;
  }

  return "none";
}

function normalizeCacheStatus(value: string | undefined, fallback: string | undefined) {
  switch (value) {
    case "hit":
    case "miss":
    case "error":
      return value;
    case "bypassed":
      return "bypass";
    default:
      return fallback ?? "bypass";
  }
}

function maskingActionFromSafetyOutcome(value: string | undefined) {
  if (value === "blocked" || value === "redacted") {
    return value;
  }
  if (value === "passed") {
    return "none";
  }
  return undefined;
}
