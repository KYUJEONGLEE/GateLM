import "server-only";

import {
  buildDomainOutcomesBridge,
  type DomainOutcomes,
  type InvocationLogRecord,
  type TerminalStatus
} from "@/lib/fixtures/v1-observability-fixtures";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";

type GatewayProjectLogsResponse = {
  data?: GatewayProjectLogItem[];
};

type GatewayProjectLogItem = {
  applicationId?: string;
  budgetScope?: GatewayBudgetScope;
  cacheStatus?: string;
  cacheType?: string;
  completionTokens?: number;
  costMicroUsd?: number;
  createdAt?: string;
  domainOutcomes?: DomainOutcomes;
  httpStatus?: number;
  latencyMs?: number;
  maskingAction?: string;
  model?: string;
  projectId?: string;
  promptTokens?: number;
  provider?: string;
  requestId?: string;
  requestedModel?: string;
  routingReason?: string;
  selectedModel?: string;
  status?: string;
  terminalStatus?: string;
  totalTokens?: number;
};

type GatewayBudgetScope = {
  budgetScopeId?: string;
  budgetScopeType?: string;
  resolvedBy?: string;
};

const LIVE_RANGE_HOURS = 24;

export async function getLiveGatewayRequestLogs(): Promise<InvocationLogRecord[] | undefined> {
  const config = getLiveGatewayConfig();
  const { from, to } = getLiveRange();
  const query = new URLSearchParams({
    from,
    limit: "50",
    to
  });

  const response = await fetch(
    `${config.baseUrl}/api/projects/${encodeURIComponent(config.projectId)}/logs?${query.toString()}`,
    {
      headers: {
        "X-GateLM-Request-Id": `request_web_logs_${Date.now()}`
      },
      cache: "no-store"
    }
  ).catch(() => undefined);

  if (!response?.ok) {
    return undefined;
  }

  const payload = (await response.json().catch(() => ({}))) as GatewayProjectLogsResponse;
  return (payload.data ?? []).map((item) => toInvocationRecord(item, config.projectId));
}

function getLiveRange() {
  const to = new Date();
  const from = new Date(to.getTime() - LIVE_RANGE_HOURS * 60 * 60 * 1000);

  return {
    from: from.toISOString(),
    to: to.toISOString()
  };
}

function toInvocationRecord(item: GatewayProjectLogItem, projectId: string): InvocationLogRecord {
  const requestId = item.requestId ?? "";
  const createdAt = item.createdAt ?? new Date().toISOString();
  const terminalStatus = normalizeLegacyBridgeStatus(item.terminalStatus ?? item.status);
  const cacheStatus = normalizeCacheStatus(item.domainOutcomes?.cache?.outcome, item.cacheStatus);
  const costMicroUsd = item.costMicroUsd ?? 0;
  const applicationId = item.applicationId ?? "live_gateway_application";
  const budgetScope = normalizeBudgetScope(item.budgetScope, applicationId);
  const maskingAction = normalizeMaskingAction(
    item.domainOutcomes?.safety?.maskingAction ??
      maskingActionFromSafetyOutcome(item.domainOutcomes?.safety?.outcome) ??
      item.maskingAction
  );
  const domainOutcomes =
    item.domainOutcomes ??
    buildDomainOutcomesBridge({
      applicationId,
      budgetScope,
      cacheStatus,
      cacheType: item.cacheType ?? "none",
      httpStatus: item.httpStatus ?? 0,
      maskingAction,
      providerLatencyMs: null,
      requestedModel: item.requestedModel ?? null,
      routingReason: item.routingReason || null,
      selectedModel: item.selectedModel || item.model || null,
      selectedProvider: item.provider || null,
      stream: false,
      terminalStatus
    });

  return {
    requestId,
    traceId: requestId,
    tenantId: "live_gateway_tenant",
    projectId: item.projectId ?? projectId,
    applicationId,
    budgetScope,
    apiKeyId: "live_gateway_api_key",
    appTokenId: "live_gateway_app_token",
    endUserId: null,
    featureId: null,
    endpoint: "/v1/chat/completions",
    method: "POST",
    source: "customer_demo_app",
    stream: false,
    requestBodyHash: "not-exposed-by-live-list",
    promptHash: "not-exposed-by-live-list",
    redactedPromptPreview: null,
    requestedProvider: null,
    requestedModel: item.requestedModel ?? null,
    selectedProvider: item.provider || null,
    selectedModel: item.selectedModel || item.model || null,
    routingReason: item.routingReason || null,
    cacheStatus,
    cacheType: item.cacheType ?? "none",
    cacheKeyHash: null,
    cacheHitRequestId: null,
    maskingAction,
    maskingDetectedTypes: [],
    maskingDetectedCount: 0,
    rateLimitDecision: {
      allowed: terminalStatus !== "rate_limited",
      scope: budgetScope.budgetScopeType,
      scopeId: budgetScope.budgetScopeId,
      limit: 0,
      remaining: 0,
      windowSeconds: 60,
      windowStart: createdAt,
      resetAt: createdAt,
      retryAfterSeconds: 0,
      reason: terminalStatus === "rate_limited" ? "limit_exceeded" : "not-exposed-by-live-list",
      durationMs: 0
    },
    promptTokens: item.promptTokens ?? 0,
    completionTokens: item.completionTokens ?? 0,
    totalTokens: item.totalTokens ?? 0,
    costMicroUsd,
    savedCostMicroUsd: cacheStatus === "hit" ? costMicroUsd : 0,
    latencyMs: item.latencyMs ?? 0,
    providerLatencyMs: null,
    terminalStatus,
    domainOutcomes,
    status: terminalStatus,
    httpStatus: item.httpStatus ?? 0,
    errorCode: null,
    errorMessage: null,
    errorStage: null,
    createdAt,
    completedAt: createdAt,
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

// Live Gateway list payloads may still carry legacy status names; normalize them for the v2-facing read model.
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
