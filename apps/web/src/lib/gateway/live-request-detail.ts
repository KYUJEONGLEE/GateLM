import "server-only";

import type {
  DomainOutcome,
  DomainOutcomes,
  RuntimeSnapshotProvenance,
  TerminalStatus
} from "@/lib/fixtures/v1-observability-fixtures";
import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import {
  getGatewayObservabilityHeaders,
  getLiveGatewayConfig
} from "@/lib/gateway/live-gateway-config";
import {
  type LiveInvocationLogRecord,
  normalizeProviderAttempt,
  normalizeRequestDetailRouting
} from "@/lib/gateway/live-observability-contract";

type GatewayRequestDetailResponse = {
  data?: {
    applicationId?: string | null;
    budgetScope?: GatewayBudgetScope;
    cache?: {
      cacheDecisionReason?: string | null;
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
    domainOutcomes?: GatewayDomainOutcomes;
    latency?: {
      latencyMs?: number;
      providerLatencyMs?: number | null;
      ttftMs?: number | null;
    };
    latencySummary?: {
      gatewayInternalLatencyMs?: number;
      providerLatencyMs?: number | null;
      totalLatencyMs?: number;
      ttftMs?: number | null;
    };
    masking?: {
      maskingAction?: "none" | "redacted" | "blocked";
      maskingDetectedCount?: number;
      maskingDetectedTypes?: string[];
      policyAllowedTypes?: string[];
      mandatoryProtectedTypes?: string[];
      redactedPromptPreview?: string | null;
    };
    promptCapture?: {
      capturedPrompt?: string | null;
      enabled?: boolean;
      maxChars?: number;
      mode?: "disabled" | "log_safe_full";
      truncated?: boolean;
      visibility?: "admin_request_detail";
    };
    projectId?: string;
    providerAttempt?: {
      providerId?: string;
      modelId?: string;
      outcome?: string;
      latencyMs?: number | null;
      sanitizedErrorCode?: string | null;
    } | null;
    providerCalled?: boolean;
    requestedModel?: string;
    requestId?: string;
    routing?: {
      category?: string | null;
      difficulty?: string | null;
      modelRef?: string | null;
      routingReason?: string | null;
    };
    runtimeSnapshot?: RuntimeSnapshotProvenance | null;
    status?: LiveInvocationLogRecord["status"];
    terminalStatus?: TerminalStatus;
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
    safetySummary?: {
      detectedCount?: number;
      detectorCategories?: string[];
      policyAllowedTypes?: string[];
      mandatoryProtectedTypes?: string[];
      maskingAction?: string | null;
      outcome?: string;
    };
    stream?: boolean;
  };
};

type GatewayBudgetScope = {
  budgetScopeId?: string;
  budgetScopeType?: string;
  resolvedBy?: string;
};

type GatewayDomainOutcomes = Partial<
  Record<keyof DomainOutcomes, Partial<DomainOutcome> | null>
>;

export async function getLiveGatewayRequestDetail(
  requestId: string,
  options: {
    projectId?: string;
    tenantId?: string;
  } = {}
): Promise<LiveInvocationLogRecord | undefined> {
  const config = getLiveGatewayConfig();
  const query = new URLSearchParams();

  appendOptionalQuery(query, "projectId", options.projectId);
  appendOptionalQuery(query, "tenantId", getGatewayTenantId(options.tenantId));

  const serializedQuery = query.toString();
  const response = await fetch(
    `${config.baseUrl}/api/llm-requests/${encodeURIComponent(requestId)}${serializedQuery ? `?${serializedQuery}` : ""}`,
    {
      headers: getGatewayObservabilityHeaders(`request_web_detail_${Date.now()}`),
      cache: "no-store"
    }
  ).catch(() => undefined);

  if (!response || response.status === 404 || !response.ok) {
    return undefined;
  }

  const payload = (await response.json().catch(() => ({}))) as GatewayRequestDetailResponse;

  if (!payload.data?.requestId) {
    return undefined;
  }

  return toInvocationRecord(payload.data);
}

function appendOptionalQuery(query: URLSearchParams, key: string, value: string | undefined) {
  const normalized = value?.trim();

  if (normalized) {
    query.set(key, normalized);
  }
}

function getGatewayTenantId(routeTenantId: string | undefined) {
  const tenantId = routeTenantId?.trim();

  return tenantId && isUuid(tenantId) ? tenantId : getControlPlaneTenantId();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toInvocationRecord(data: NonNullable<GatewayRequestDetailResponse["data"]>): LiveInvocationLogRecord {
  const createdAt = data.createdAt ?? new Date().toISOString();
  const completedAt = data.completedAt ?? createdAt;
  const status = normalizeLegacyBridgeStatus(data.terminalStatus ?? data.status);
  const cacheStatus = data.cache?.cacheStatus ?? "bypass";
  const maskingAction = data.masking?.maskingAction ?? "none";
  const applicationId = data.applicationId ?? "live_gateway_application";
  const budgetScope = normalizeBudgetScope(data.budgetScope, applicationId);
  const runtimeSnapshot = normalizeRuntimeSnapshot(data.runtimeSnapshot);
  const domainOutcomes = normalizeDomainOutcomes(
    data.domainOutcomes,
    legacyDomainOutcomes(status, cacheStatus, maskingAction, data.latency?.providerLatencyMs ?? null, data.error?.errorCode ?? null)
  );
  const stream = data.stream ?? isStreamingOutcome(domainOutcomes.streaming.outcome);
  const ttftMs = normalizeNullableLatency(
    data.latencySummary?.ttftMs ?? data.latency?.ttftMs
  );
  const latencySummary = {
    gatewayInternalLatencyMs: data.latencySummary?.gatewayInternalLatencyMs ?? Math.max((data.latency?.latencyMs ?? 0) - (data.latency?.providerLatencyMs ?? 0), 0),
    providerLatencyMs: data.latencySummary?.providerLatencyMs ?? data.latency?.providerLatencyMs ?? null,
    totalLatencyMs: data.latencySummary?.totalLatencyMs ?? data.latency?.latencyMs ?? 0,
    ttftMs
  };
  const usageSummary = {
    promptTokens: data.usageSummary?.promptTokens ?? data.usage?.promptTokens ?? 0,
    completionTokens: data.usageSummary?.completionTokens ?? data.usage?.completionTokens ?? 0,
    totalTokens: data.usageSummary?.totalTokens ?? data.usage?.totalTokens ?? 0,
    estimatedCostMicroUsd: data.usageSummary?.estimatedCostMicroUsd ?? data.cost?.costMicroUsd ?? 0,
    savedCostMicroUsd: data.usageSummary?.savedCostMicroUsd ?? (cacheStatus === "hit" ? data.cost?.costMicroUsd ?? 0 : 0)
  };
  const routing = normalizeRequestDetailRouting(data.requestedModel, data.routing);
  const providerAttempt = normalizeProviderAttempt(data.providerAttempt);

  return {
    requestId: data.requestId ?? "",
    traceId: data.traceId ?? data.requestId ?? "",
    tenantId: data.tenantId ?? "live_gateway_tenant",
    projectId: data.projectId ?? "live_gateway_project",
    applicationId,
    budgetScope,
    apiKeyId: "not-exposed",
    appTokenId: "not-exposed",
    endUserId: "customer_user_demo_live",
    featureId: "support-reply",
    endpoint: "/v1/chat/completions",
    method: "POST",
    source: "customer_demo_app",
    stream,
    requestBodyHash: "not-exposed-by-live-detail",
    promptHash: "not-exposed-by-live-detail",
    redactedPromptPreview: data.masking?.redactedPromptPreview ?? null,
    requestedModel: routing.requestedModel,
    category: routing.category,
    difficulty: routing.difficulty,
    modelRef: routing.modelRef,
    routingReason: routing.routingReason,
    providerAttempt,
    cacheStatus,
    cacheType: data.cache?.cacheType ?? "none",
    cacheDecisionReason: data.cache?.cacheDecisionReason ?? null,
    cacheKeyHash: data.cache?.cacheKeyHash ?? null,
    cacheHitRequestId: data.cache?.cacheHitRequestId ?? null,
    maskingAction,
    maskingDetectedTypes: data.masking?.maskingDetectedTypes ?? [],
    maskingDetectedCount: data.masking?.maskingDetectedCount ?? 0,
    providerCalled: data.providerCalled ?? providerAttempt !== null,
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
    promptTokens: usageSummary.promptTokens,
    completionTokens: usageSummary.completionTokens,
    totalTokens: usageSummary.totalTokens,
    costMicroUsd: usageSummary.estimatedCostMicroUsd,
    savedCostMicroUsd: usageSummary.savedCostMicroUsd,
    latencyMs: latencySummary.totalLatencyMs,
    ttftMs,
    providerLatencyMs: latencySummary.providerLatencyMs,
    status,
    terminalStatus: status,
    domainOutcomes,
    latencySummary,
    usageSummary,
    safetySummary: {
      outcome: data.safetySummary?.outcome ?? domainOutcomes.safety.outcome,
      detectedCount: data.safetySummary?.detectedCount ?? data.masking?.maskingDetectedCount ?? 0,
      detectorCategories: data.safetySummary?.detectorCategories ?? data.masking?.maskingDetectedTypes ?? [],
      policyAllowedTypes: data.safetySummary?.policyAllowedTypes ?? data.masking?.policyAllowedTypes ?? [],
      mandatoryProtectedTypes:
        data.safetySummary?.mandatoryProtectedTypes ?? data.masking?.mandatoryProtectedTypes ?? [],
      maskingAction: data.safetySummary?.maskingAction ?? maskingAction
    },
    promptCapture: normalizePromptCapture(data.promptCapture),
    httpStatus: data.httpStatus ?? 0,
    errorCode: data.error?.errorCode ?? null,
    errorMessage: data.error?.errorMessage ?? null,
    errorStage: data.error?.errorStage ?? null,
    createdAt,
    completedAt,
    metadata: {
      runtime: {
        runtimeSnapshot
      }
    }
  };
}

function normalizeNullableLatency(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function normalizePromptCapture(
  value: NonNullable<GatewayRequestDetailResponse["data"]>["promptCapture"]
) {
  return {
    capturedPrompt: value?.capturedPrompt ?? null,
    enabled: value?.enabled ?? false,
    maxChars: value?.maxChars ?? 8000,
    mode: value?.mode ?? "disabled",
    truncated: value?.truncated ?? false,
    visibility: value?.visibility ?? "admin_request_detail"
  } as const;
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

function normalizeRuntimeSnapshot(value: RuntimeSnapshotProvenance | null | undefined): RuntimeSnapshotProvenance | null {
  if (value) {
    return {
      ...value,
      legacyHashes: value.legacyHashes ?? {
        configHash: "not-exposed",
        securityPolicyHash: "not-exposed",
        routingPolicyHash: "not-exposed"
      }
    };
  }

  return null;
}

function normalizeDomainOutcomes(
  value: GatewayDomainOutcomes | undefined,
  fallback: DomainOutcomes
): DomainOutcomes {
  return {
    auth: normalizeDomainOutcome(value?.auth, fallback.auth),
    runtime: normalizeDomainOutcome(value?.runtime, fallback.runtime),
    rateLimit: normalizeDomainOutcome(value?.rateLimit, fallback.rateLimit),
    budget: normalizeDomainOutcome(value?.budget, fallback.budget),
    safety: normalizeDomainOutcome(value?.safety, fallback.safety),
    routing: normalizeDomainOutcome(value?.routing, fallback.routing),
    cache: normalizeDomainOutcome(value?.cache, fallback.cache),
    provider: normalizeDomainOutcome(value?.provider, fallback.provider),
    fallback: normalizeDomainOutcome(value?.fallback, fallback.fallback),
    streaming: normalizeDomainOutcome(value?.streaming, fallback.streaming),
    logging: normalizeDomainOutcome(value?.logging, fallback.logging)
  };
}

function normalizeDomainOutcome(
  value: Partial<DomainOutcome> | null | undefined,
  fallback: DomainOutcome
): DomainOutcome {
  return {
    outcome: value?.outcome ?? fallback.outcome,
    reason: value?.reason ?? fallback.reason ?? null,
    code: value?.code ?? fallback.code ?? null
  };
}

function isStreamingOutcome(outcome: string | undefined): boolean {
  return Boolean(
    outcome &&
      outcome !== "not_streaming" &&
      outcome !== "not_started" &&
      outcome !== "not_called"
  );
}

function legacyDomainOutcomes(
  status: TerminalStatus,
  cacheStatus: string,
  maskingAction: string,
  providerLatencyMs: number | null,
  errorCode: string | null
): DomainOutcomes {
  const cacheOutcome = cacheStatus === "hit" || cacheStatus === "miss" || cacheStatus === "error"
    ? cacheStatus
    : cacheStatus === "bypass" ? "bypassed" : "not_used";
  const safetyOutcome = maskingAction === "blocked" || maskingAction === "redacted" ? maskingAction : "passed";
  const providerOutcome = providerLatencyMs === null || status === "blocked" || status === "rate_limited"
    ? "not_called"
    : status === "failed" ? "error" : "success";

  return {
    auth: { outcome: "passed" },
    runtime: { outcome: "snapshot_active" },
    rateLimit: { outcome: status === "rate_limited" ? "rate_limited" : "not_checked", code: status === "rate_limited" ? errorCode : null },
    budget: { outcome: "allowed" },
    safety: { outcome: safetyOutcome, code: safetyOutcome === "blocked" ? errorCode : null },
    routing: { outcome: cacheOutcome === "hit" ? "skipped" : "selected" },
    cache: { outcome: cacheOutcome },
    provider: { outcome: providerOutcome, code: providerOutcome === "error" ? errorCode : null },
    fallback: { outcome: "not_called" },
    streaming: { outcome: "not_streaming" },
    logging: { outcome: "written" }
  };
}

// Live Gateway detail payloads may still carry legacy status names; normalize them for the v2-facing read model.
function normalizeLegacyBridgeStatus(value: string | undefined): LiveInvocationLogRecord["status"] {
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
