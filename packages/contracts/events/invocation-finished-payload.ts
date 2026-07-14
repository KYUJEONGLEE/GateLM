export const INVOCATION_SCHEMA_VERSION = 2;

export type InvocationStatus =
  | "success"
  | "blocked"
  | "rate_limited"
  | "failed"
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

export type RoutingCategory =
  | "general"
  | "code"
  | "translation"
  | "summarization"
  | "reasoning";
export type RoutingDifficulty = "simple" | "complex";
export type ProviderAttemptOutcome =
  | "success"
  | "timeout"
  | "error"
  | "unauthorized"
  | "cancelled";

export const STATUS_TO_EVENT_TYPE: Record<
  InvocationStatus,
  InvocationEventType
> = {
  success: "invocation.completed",
  blocked: "invocation.blocked",
  rate_limited: "invocation.failed",
  failed: "invocation.failed",
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
  eventVersion: 2;
  occurredAt: string;
  request: LlmRequestLog;
  providerAttempts: ProviderAttemptRecord[];
  costSettlement: CostSettlementRecord | null;
}

/** Routing summary never exposes a resolved provider/model target. */
export interface InvocationRoutingSummary {
  category: RoutingCategory;
  difficulty: RoutingDifficulty;
  modelRef: string | null;
  routingReason: string | null;
  routingRuleId: string | null;
}

/** Actual provider/model identity is confined to the provider-attempt boundary. */
export interface ProviderAttemptRecord {
  attempt: number;
  providerId: string;
  modelId: string;
  executionMode: "provider" | "mock";
  outcome: ProviderAttemptOutcome;
  latencyMs: number | null;
  sanitizedErrorCode: string | null;
}

/** Actual provider/model identity is also allowed on the cost-settlement record. */
export interface CostSettlementRecord {
  providerId: string | null;
  modelId: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicroUsd: number;
  costUsd: string;
  currency: "USD" | string;
}

/** 요청 로그 레코드. */
export interface LlmRequestLog {
  schemaVersion: 2;
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

  requestedModel: string | null;
  routing: InvocationRoutingSummary;

  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicroUsd: number;
  costUsd: string;
  savedCostMicroUsd?: number;
  currency: "USD" | string;
  latencyMs: number;
  ttftMs?: number | null;

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
  requestedModel: string | null;
  category: RoutingCategory;
  difficulty: RoutingDifficulty;
  modelRef: string | null;
  status: InvocationStatus;
  httpStatus: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: string;
  costMicroUsd: number;
  latencyMs: number;
  ttftMs: number | null;
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
  requestedModel: string | null;
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
    ttftMs: number | null;
  };
  cache: {
    cacheStatus: CacheStatus;
    cacheType: CacheType;
    cacheKeyHash: string | null;
    cacheHitRequestId: string | null;
  };
  routing: {
    category: RoutingCategory;
    difficulty: RoutingDifficulty;
    modelRef: string | null;
    routingReason: string | null;
    routingRuleId: string | null;
  };
  providerAttempts: ProviderAttemptRecord[];
  costSettlement: CostSettlementRecord | null;
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
  performance?: {
    gatewayTtft?: {
      scope: "project_application";
      averageMs: number | null;
      p50Ms: number | null;
      p95Ms: number | null;
      p99Ms: number | null;
      eligibleStreamRequests: number;
      observedRequests: number;
      coverageRate: number | null;
    };
  };
}

export const REQUEST_LOG_LIST_FIELDS = [
  "requestId",
  "projectId",
  "applicationId",
  "requestedModel",
  "category",
  "difficulty",
  "modelRef",
  "status",
  "httpStatus",
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "costUsd",
  "costMicroUsd",
  "latencyMs",
  "ttftMs",
  "cacheStatus",
  "cacheType",
  "routingReason",
  "maskingAction",
  "createdAt",
] as const satisfies readonly (keyof RequestLogListItem)[];

/** micro USD -> USD 문자열. */
export function formatCostUsdFromMicroUsd(costMicroUsd: number | bigint): string {
  if (typeof costMicroUsd === "number" && !Number.isFinite(costMicroUsd)) {
    return "0.000000";
  }
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
    requestedModel: log.requestedModel,
    category: log.routing.category,
    difficulty: log.routing.difficulty,
    modelRef: log.routing.modelRef,
    status: log.status,
    httpStatus: log.httpStatus,
    promptTokens: log.promptTokens,
    completionTokens: log.completionTokens,
    totalTokens: log.totalTokens,
    costUsd: log.costUsd,
    costMicroUsd: log.costMicroUsd,
    latencyMs: log.latencyMs,
    ttftMs: log.ttftMs ?? null,
    cacheStatus: log.cacheStatus,
    cacheType: log.cacheType,
    routingReason: log.routing.routingReason,
    maskingAction: log.maskingAction,
    createdAt: log.createdAt,
  };
}

/** 요청 로그 -> 상세 응답. */
export function toRequestDetailResponseData(
  log: LlmRequestLog,
  providerAttempts: ProviderAttemptRecord[] = [],
  costSettlement: CostSettlementRecord | null = null,
): RequestDetailResponseData {
  return {
    requestId: log.requestId,
    traceId: log.traceId,
    tenantId: log.tenantId,
    projectId: log.projectId,
    applicationId: log.applicationId,
    status: log.status,
    httpStatus: log.httpStatus,
    requestedModel: log.requestedModel,
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
      ttftMs: log.ttftMs ?? null,
    },
    cache: {
      cacheStatus: log.cacheStatus,
      cacheType: log.cacheType,
      cacheKeyHash: log.cacheKeyHash ?? null,
      cacheHitRequestId: log.cacheHitRequestId ?? null,
    },
    routing: {
      category: log.routing.category,
      difficulty: log.routing.difficulty,
      modelRef: log.routing.modelRef,
      routingReason: log.routing.routingReason,
      routingRuleId: log.routing.routingRuleId,
    },
    providerAttempts: providerAttempts.map((attempt) => ({ ...attempt })),
    costSettlement: costSettlement ? { ...costSettlement } : null,
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
