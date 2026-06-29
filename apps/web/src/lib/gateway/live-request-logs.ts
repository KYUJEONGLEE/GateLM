import "server-only";

import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";

type GatewayProjectLogsResponse = {
  data?: GatewayProjectLogItem[];
};

type GatewayProjectLogItem = {
  applicationId?: string;
  cacheStatus?: string;
  cacheType?: string;
  completionTokens?: number;
  costMicroUsd?: number;
  createdAt?: string;
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
  totalTokens?: number;
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
  const cacheStatus = item.cacheStatus ?? "bypass";
  const status = normalizeStatus(item.status);
  const costMicroUsd = item.costMicroUsd ?? 0;

  return {
    requestId,
    traceId: requestId,
    tenantId: "live_gateway_tenant",
    projectId: item.projectId ?? projectId,
    applicationId: item.applicationId ?? "live_gateway_application",
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
    maskingAction: normalizeMaskingAction(item.maskingAction),
    maskingDetectedTypes: [],
    maskingDetectedCount: 0,
    rateLimitDecision: {
      allowed: status !== "rate_limited",
      scope: "application",
      scopeId: item.applicationId ?? "live_gateway_application",
      limit: 0,
      remaining: 0,
      windowSeconds: 60,
      windowStart: createdAt,
      resetAt: createdAt,
      retryAfterSeconds: 0,
      reason: status === "rate_limited" ? "limit_exceeded" : "not-exposed-by-live-list",
      durationMs: 0
    },
    promptTokens: item.promptTokens ?? 0,
    completionTokens: item.completionTokens ?? 0,
    totalTokens: item.totalTokens ?? 0,
    costMicroUsd,
    savedCostMicroUsd: cacheStatus === "hit" ? costMicroUsd : 0,
    latencyMs: item.latencyMs ?? 0,
    providerLatencyMs: null,
    status,
    httpStatus: item.httpStatus ?? 0,
    errorCode: null,
    errorMessage: null,
    errorStage: null,
    createdAt,
    completedAt: createdAt,
    metadata: {
      runtime: {
        configHash: "live-gateway",
        securityPolicyHash: "live-gateway",
        routingPolicyHash: "live-gateway"
      }
    }
  };
}

function normalizeStatus(value: string | undefined): InvocationLogRecord["status"] {
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
