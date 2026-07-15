import type { TenantChatInvocation } from "@/lib/control-plane/tenant-chat-observability-client";
import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";

export function toTenantChatRequestLog(
  invocation: TenantChatInvocation
): LiveInvocationLogRecord {
  const status = normalizeStatus(invocation.terminalOutcome);
  const cacheStatus = normalizeCacheStatus(invocation.cacheOutcome);
  const safetyBlocked = invocation.terminalOutcome === "safety_blocked";
  const providerCalled = invocation.attemptCount > 0;
  const modelKey = invocation.modelKey?.trim() || null;
  const providerId = invocation.providerId?.trim() || null;

  return {
    requestId: invocation.requestId,
    traceId: invocation.requestId,
    tenantId: invocation.tenantId,
    projectId: "",
    projectName: "Tenant Chat",
    applicationId: "tenant_chat",
    budgetScope: {
      budgetScopeType: "employee",
      budgetScopeId: invocation.employeeId ?? invocation.userId,
      resolvedBy: invocation.employeeId ? "tenant_chat_employee" : "tenant_chat_user"
    },
    apiKeyId: "tenant_chat_private_workload",
    appTokenId: "tenant_chat_private_workload",
    endUserId: invocation.employeeId ?? invocation.userId,
    featureId: "tenant_chat",
    endpoint: "/internal/v1/tenant-chat/completions",
    method: "POST",
    source: "tenant_chat",
    stream: true,
    requestBodyHash: "not-exposed-by-tenant-chat-projection",
    promptHash: "not-exposed-by-tenant-chat-projection",
    redactedPromptPreview: null,
    requestedModel: modelKey,
    category: "general",
    difficulty: "simple",
    modelRef: modelKey,
    routingReason: cacheStatus === "hit" ? "exact_cache_hit" : "tenant_chat_runtime",
    providerAttempt:
      providerCalled && providerId && modelKey
        ? {
            providerId,
            modelId: modelKey,
            outcome: status === "success" ? "success" : "error",
            latencyMs: null,
            sanitizedErrorCode: status === "failed" ? "TENANT_CHAT_PROVIDER_FAILED" : null
          }
        : null,
    cacheStatus,
    cacheType: cacheStatus === "bypass" ? "none" : "exact",
    cacheDecisionReason: cacheDecisionReason(cacheStatus),
    cacheKeyHash: null,
    cacheHitRequestId: null,
    maskingAction: safetyBlocked ? "blocked" : "none",
    maskingDetectedTypes: safetyBlocked ? ["sensitive_information"] : [],
    maskingDetectedCount: safetyBlocked ? 1 : 0,
    providerCalled,
    rateLimitDecision: {
      allowed: status !== "rate_limited",
      scope: "tenant_user",
      scopeId: invocation.userId,
      limit: 0,
      remaining: 0,
      windowSeconds: 0,
      windowStart: invocation.startedAt,
      resetAt: invocation.completedAt,
      retryAfterSeconds: 0,
      reason: status === "rate_limited" ? invocation.terminalOutcome : "not_exposed_by_projection",
      durationMs: 0
    },
    promptTokens: invocation.confirmedInputTokens,
    completionTokens: invocation.confirmedOutputTokens,
    totalTokens: invocation.confirmedTotalTokens,
    costMicroUsd: invocation.confirmedCostMicroUsd,
    savedCostMicroUsd: 0,
    latencyMs: invocation.latencyMs,
    ttftMs: null,
    providerLatencyMs: null,
    status,
    terminalStatus: status,
    domainOutcomes: buildDomainOutcomes(invocation, status, cacheStatus, providerCalled),
    safetySummary: {
      outcome: safetyBlocked ? "blocked" : "passed",
      detectedCount: safetyBlocked ? 1 : 0,
      detectorCategories: safetyBlocked ? ["sensitive_information"] : [],
      maskingAction: safetyBlocked ? "blocked" : null
    },
    httpStatus: httpStatus(status),
    errorCode: status === "success" ? null : terminalErrorCode(invocation.terminalOutcome),
    errorMessage: null,
    errorStage: safetyBlocked ? "safety" : status === "failed" ? "provider" : null,
    createdAt: invocation.startedAt,
    completedAt: invocation.completedAt,
    metadata: {
      runtime: {
        runtimeSnapshot: {
          runtimeSnapshotId: `tenant_chat_snapshot_v${invocation.snapshotVersion}`,
          runtimeSnapshotVersion: invocation.snapshotVersion,
          contentHash: "not-exposed-by-tenant-chat-projection",
          runtimeState: "snapshot_active",
          publishedAt: invocation.startedAt,
          publishedBy: "tenant_chat_runtime",
          gatewayInstanceId: "tenant_chat_gateway",
          legacyHashes: {
            configHash: "not-applicable",
            securityPolicyHash: "not-applicable",
            routingPolicyHash: "not-applicable"
          }
        }
      }
    }
  };
}

function normalizeStatus(outcome: string): LiveInvocationLogRecord["status"] {
  if (outcome === "succeeded" || outcome === "cache_hit") return "success";
  if (outcome === "rate_limited" || outcome === "concurrency_limited") return "rate_limited";
  if (["safety_blocked", "quota_blocked", "budget_blocked", "policy_ack_required"].includes(outcome)) {
    return "blocked";
  }
  if (outcome === "cancelled") return "cancelled";
  return "failed";
}

function normalizeCacheStatus(outcome: string) {
  if (outcome === "hit" || outcome === "miss") return outcome;
  return "bypass";
}

function cacheDecisionReason(status: string) {
  if (status === "hit") return "exact_cache_hit";
  if (status === "miss") return "exact_cache_miss";
  return "cache_disabled";
}

function buildDomainOutcomes(
  invocation: TenantChatInvocation,
  status: LiveInvocationLogRecord["status"],
  cacheStatus: string,
  providerCalled: boolean
) {
  const safetyBlocked = invocation.terminalOutcome === "safety_blocked";
  return {
    auth: { outcome: "passed" },
    runtime: { outcome: "snapshot_active" },
    rateLimit: {
      outcome: status === "rate_limited" ? invocation.terminalOutcome : "allowed"
    },
    budget: { outcome: invocation.budgetState || "allowed" },
    safety: { outcome: safetyBlocked ? "blocked" : "passed" },
    routing: { outcome: cacheStatus === "hit" ? "skipped" : providerCalled ? "selected" : "not_called" },
    cache: { outcome: cacheStatus === "bypass" ? "bypassed" : cacheStatus },
    provider: {
      outcome: providerCalled ? (status === "success" ? "success" : "error") : "not_called"
    },
    fallback: { outcome: "not_called" },
    streaming: { outcome: status === "success" ? "completed" : "not_started" },
    logging: { outcome: "projected" }
  };
}

function httpStatus(status: LiveInvocationLogRecord["status"]) {
  if (status === "success") return 200;
  if (status === "rate_limited") return 429;
  if (status === "blocked") return 403;
  if (status === "cancelled") return 499;
  return 502;
}

function terminalErrorCode(outcome: string) {
  return `TENANT_CHAT_${outcome.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}`;
}
