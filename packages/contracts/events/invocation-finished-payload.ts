export const INVOCATION_SCHEMA_VERSION = 1;

export type InvocationStatus =
  | "success"
  | "cache_hit"
  | "blocked"
  | "error"
  | "cancelled";

export type InvocationEventType =
  | "invocation.completed"
  | "invocation.blocked"
  | "invocation.failed"
  | "invocation.cancelled";

export type CacheStatus = "hit" | "miss" | "bypass" | "error";
export type CacheType = "none" | "exact" | "semantic";
export type MaskingAction = "none" | "redacted" | "blocked";
export type RequestSource =
  | "customer_app"
  | "chat_ui"
  | "developer_tool"
  | "internal";

export const STATUS_TO_EVENT_TYPE: Record<
  InvocationStatus,
  InvocationEventType
> = {
  success: "invocation.completed",
  cache_hit: "invocation.completed",
  blocked: "invocation.blocked",
  error: "invocation.failed",
  cancelled: "invocation.cancelled",
};

export const FORBIDDEN_LOG_FIELD_NAMES = [
  "rawPrompt",
  "rawResponse",
  "fullRequestBody",
  "fullResponseBody",
  "providerApiKey",
  "apiKeyPlaintext",
  "appTokenPlaintext",
  "authorizationHeader",
  "cookie",
  "rawProviderErrorBody",
  "maskingSampleRawValue",
] as const;

/** 호출 이벤트 envelope. */
export interface InvocationFinishedPayload {
  eventId: string;
  eventType: InvocationEventType;
  eventVersion: 1;
  occurredAt: string;
  request: LlmRequestLog;
}

/** 요청 로그 레코드. */
export interface LlmRequestLog {
  schemaVersion: 1;
  requestId: string;
  traceId: string;
  tenantId: string;
  projectId: string;
  applicationId: string | null;
  apiKeyId: string | null;
  appTokenId: string | null;
  endUserId?: string | null;
  featureId?: string | null;

  endpoint: "/v1/chat/completions" | string;
  method: "POST" | string;
  source: RequestSource;
  stream: boolean;
  requestBodyHash: string;
  promptHash: string;
  redactedPromptPreview?: string | null;

  requestedProvider?: string | null;
  requestedModel: string | null;
  provider: string;
  model: string;
  selectedProvider: string | null;
  selectedModel: string | null;
  routingReason?: string | null;
  routingRuleId?: string | null;

  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicroUsd: number;
  costUsd: string;
  savedCostMicroUsd?: number;
  currency: "USD" | string;
  latencyMs: number;
  providerLatencyMs?: number | null;

  status: InvocationStatus;
  httpStatus: number;
  errorCode: string | null;
  errorMessage: string | null;
  errorStage?: string | null;
  retryable?: boolean | null;

  cacheStatus: CacheStatus;
  cacheType: CacheType;
  cacheKeyHash?: string | null;
  cacheHitRequestId?: string | null;

  maskingAction: MaskingAction;
  maskingDetectedTypes: string[];
  maskingDetectedCount: number;
  securityPolicyVersionId?: string | null;

  createdAt: string;
  completedAt: string | null;
  ingestedAt?: string | null;
  metadata: Record<string, unknown>;
}

/** Request Log 목록 행. */
export interface RequestLogListItem {
  requestId: string;
  projectId: string;
  applicationId: string | null;
  provider: string;
  model: string;
  requestedModel: string | null;
  selectedModel: string | null;
  status: InvocationStatus;
  httpStatus: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: string;
  costMicroUsd: number;
  latencyMs: number;
  cacheStatus: CacheStatus;
  cacheType: CacheType;
  routingReason: string | null;
  maskingAction: MaskingAction;
  createdAt: string;
}

/** Request Detail 응답 데이터. */
export interface RequestDetailResponseData {
  requestId: string;
  traceId: string;
  tenantId: string;
  projectId: string;
  applicationId: string | null;
  status: InvocationStatus;
  httpStatus: number;
  provider: string;
  model: string;
  requestedModel: string | null;
  selectedModel: string | null;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: {
    costUsd: string;
    costMicroUsd: number;
    currency: string;
  };
  latency: {
    latencyMs: number;
    providerLatencyMs: number | null;
  };
  cache: {
    cacheStatus: CacheStatus;
    cacheType: CacheType;
    cacheKeyHash: string | null;
    cacheHitRequestId: string | null;
  };
  routing: {
    routingReason: string | null;
    routingRuleId: string | null;
    selectedProvider: string | null;
    selectedModel: string | null;
  };
  masking: {
    maskingAction: MaskingAction;
    maskingDetectedTypes: string[];
    maskingDetectedCount: number;
    redactedPromptPreview: string | null;
  };
  error: {
    errorCode: string | null;
    errorMessage: string | null;
    errorStage: string | null;
  };
  createdAt: string;
  completedAt: string | null;
}

/** Dashboard Overview 지표. */
export interface DashboardOverviewFields {
  totalRequests: number;
  successfulRequests: number;
  blockedRequests: number;
  cacheHitRequests: number;
  cacheHitRate: number | null;
  totalTokens: number;
  totalCostMicroUsd: number;
  totalCostUsd: string;
  averageResponseTimeMs: number | null;
}

export const REQUEST_LOG_LIST_FIELDS = [
  "requestId",
  "projectId",
  "applicationId",
  "provider",
  "model",
  "requestedModel",
  "selectedModel",
  "status",
  "httpStatus",
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "costUsd",
  "costMicroUsd",
  "latencyMs",
  "cacheStatus",
  "cacheType",
  "routingReason",
  "maskingAction",
  "createdAt",
] as const satisfies readonly (keyof RequestLogListItem)[];

/** micro USD -> USD 문자열. */
export function formatCostUsdFromMicroUsd(costMicroUsd: number | bigint): string {
  const microUsd =
    typeof costMicroUsd === "bigint"
      ? costMicroUsd
      : BigInt(Math.trunc(costMicroUsd));
  const sign = microUsd < 0n ? "-" : "";
  const absoluteMicroUsd = microUsd < 0n ? -microUsd : microUsd;
  const wholeUsd = absoluteMicroUsd / 1_000_000n;
  const fractionalUsd = (absoluteMicroUsd % 1_000_000n)
    .toString()
    .padStart(6, "0");

  return `${sign}${wholeUsd.toString()}.${fractionalUsd}`;
}

/** 요청 로그 -> 목록 행. */
export function toRequestLogListItem(
  log: LlmRequestLog,
): RequestLogListItem {
  return {
    requestId: log.requestId,
    projectId: log.projectId,
    applicationId: log.applicationId,
    provider: log.provider,
    model: log.model,
    requestedModel: log.requestedModel,
    selectedModel: log.selectedModel,
    status: log.status,
    httpStatus: log.httpStatus,
    promptTokens: log.promptTokens,
    completionTokens: log.completionTokens,
    totalTokens: log.totalTokens,
    costUsd: log.costUsd,
    costMicroUsd: log.costMicroUsd,
    latencyMs: log.latencyMs,
    cacheStatus: log.cacheStatus,
    cacheType: log.cacheType,
    routingReason: log.routingReason ?? null,
    maskingAction: log.maskingAction,
    createdAt: log.createdAt,
  };
}

/** 요청 로그 -> 상세 응답. */
export function toRequestDetailResponseData(
  log: LlmRequestLog,
): RequestDetailResponseData {
  return {
    requestId: log.requestId,
    traceId: log.traceId,
    tenantId: log.tenantId,
    projectId: log.projectId,
    applicationId: log.applicationId,
    status: log.status,
    httpStatus: log.httpStatus,
    provider: log.provider,
    model: log.model,
    requestedModel: log.requestedModel,
    selectedModel: log.selectedModel,
    usage: {
      promptTokens: log.promptTokens,
      completionTokens: log.completionTokens,
      totalTokens: log.totalTokens,
    },
    cost: {
      costUsd: log.costUsd,
      costMicroUsd: log.costMicroUsd,
      currency: log.currency,
    },
    latency: {
      latencyMs: log.latencyMs,
      providerLatencyMs: log.providerLatencyMs ?? null,
    },
    cache: {
      cacheStatus: log.cacheStatus,
      cacheType: log.cacheType,
      cacheKeyHash: log.cacheKeyHash ?? null,
      cacheHitRequestId: log.cacheHitRequestId ?? null,
    },
    routing: {
      routingReason: log.routingReason ?? null,
      routingRuleId: log.routingRuleId ?? null,
      selectedProvider: log.selectedProvider,
      selectedModel: log.selectedModel,
    },
    masking: {
      maskingAction: log.maskingAction,
      maskingDetectedTypes: log.maskingDetectedTypes,
      maskingDetectedCount: log.maskingDetectedCount,
      redactedPromptPreview: log.redactedPromptPreview ?? null,
    },
    error: {
      errorCode: log.errorCode,
      errorMessage: log.errorMessage,
      errorStage: log.errorStage ?? null,
    },
    createdAt: log.createdAt,
    completedAt: log.completedAt,
  };
}
