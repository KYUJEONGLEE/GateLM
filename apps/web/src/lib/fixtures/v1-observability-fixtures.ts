// Shared observability view types. Despite the historical filename, this module
// has no runtime dependency on v1 fixtures and exposes only the active routing shape.

export type LegacyRuntimeHashes = {
  configHash: string;
  securityPolicyHash: string;
  routingPolicyHash: string;
};

export type RuntimeSnapshotState =
  | "snapshot_active"
  | "last_known_safe_used"
  | "stale_snapshot_used";

export type RuntimeSnapshotProvenance = {
  runtimeSnapshotId: string;
  runtimeSnapshotVersion: number;
  contentHash: string;
  runtimeState: RuntimeSnapshotState;
  publishedAt: string;
  publishedBy: string;
  gatewayInstanceId: string;
  legacyHashes: LegacyRuntimeHashes;
};

export type RuntimeMetadata = {
  runtimeSnapshot: RuntimeSnapshotProvenance | null;
};

export type RateLimitDecision = {
  allowed: boolean;
  scope: string;
  scopeId: string;
  limit: number;
  remaining: number;
  windowSeconds: number;
  windowStart: string;
  resetAt: string;
  retryAfterSeconds: number;
  reason: string;
  durationMs: number;
};

export type BudgetScope = {
  budgetScopeType: string;
  budgetScopeId: string;
  resolvedBy: string;
};

export type TerminalStatus = "success" | "blocked" | "rate_limited" | "failed" | "cancelled";

export type DomainOutcome = {
  outcome: string;
  reason?: string | null;
  code?: string | null;
  policyAllowedTypes?: string[];
  mandatoryProtectedTypes?: string[];
};

export type DomainOutcomes = {
  auth: DomainOutcome;
  runtime: DomainOutcome;
  rateLimit: DomainOutcome;
  budget: DomainOutcome;
  safety: DomainOutcome;
  routing: DomainOutcome;
  cache: DomainOutcome;
  provider: DomainOutcome;
  fallback: DomainOutcome;
  streaming: DomainOutcome;
  logging: DomainOutcome;
};

export type PromptCapture = {
  capturedPrompt: string | null;
  enabled: boolean;
  maxChars: number;
  mode: "disabled" | "log_safe_full";
  truncated: boolean;
  visibility: "admin_request_detail";
};

export type InvocationLogRecord = {
  requestId: string;
  traceId: string;
  tenantId: string;
  projectId: string;
  projectName?: string | null;
  applicationId: string;
  budgetScope: BudgetScope;
  apiKeyId: string;
  appTokenId: string;
  endUserId: string | null;
  featureId: string | null;
  endpoint: string;
  method: string;
  source: string;
  stream: boolean;
  requestBodyHash: string;
  promptHash: string;
  redactedPromptPreview: string | null;
  requestedModel: string | null;
  category: string;
  difficulty: string;
  modelRef: string | null;
  routingReason: string | null;
  providerAttempt: {
    providerId: string;
    modelId: string;
    outcome: string;
    latencyMs: number | null;
    sanitizedErrorCode: string | null;
  } | null;
  cacheStatus: string;
  cacheType: string;
  cacheDecisionReason?: string | null;
  cacheKeyHash: string | null;
  cacheHitRequestId: string | null;
  maskingAction: "none" | "redacted" | "blocked";
  maskingDetectedTypes: string[];
  maskingDetectedCount: number;
  providerCalled?: boolean;
  rateLimitDecision: RateLimitDecision;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicroUsd: number;
  savedCostMicroUsd: number;
  latencyMs: number;
  providerLatencyMs: number | null;
  status: TerminalStatus;
  terminalStatus?: TerminalStatus;
  domainOutcomes?: DomainOutcomes;
  latencySummary?: {
    gatewayInternalLatencyMs: number;
    providerLatencyMs: number | null;
    totalLatencyMs: number;
  };
  usageSummary?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostMicroUsd: number;
    savedCostMicroUsd: number;
  };
  safetySummary?: {
    outcome: string;
    detectedCount: number;
    detectorCategories: string[];
    policyAllowedTypes?: string[];
    mandatoryProtectedTypes?: string[];
    maskingAction: string | null;
  };
  promptCapture?: PromptCapture;
  httpStatus: number;
  errorCode: string | null;
  errorMessage: string | null;
  errorStage: string | null;
  createdAt: string;
  completedAt: string;
  metadata: {
    runtime: RuntimeMetadata;
  };
};

export type DashboardOverview = {
  surface?: "all" | "project_application" | "tenant_chat";
  fixtureName: string;
  fixtureVersion: string;
  owner: string;
  producer: string;
  consumers: string[];
  sourceOfTruth: string[];
  range: {
    from: string;
    to: string;
    timezone: string;
    grain: string;
  };
  filters: {
    tenantId: string;
    projectId: string;
    applicationId: string;
    budgetScopeType: string;
    budgetScopeId: string;
    resolvedBy: string;
    provider: string | null;
    model: string | null;
  };
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  blockedRequests: number;
  rateLimitedRequests: number;
  cancelledRequests?: number;
  cacheHitRequests: number;
  cacheEligibleRequests: number;
  cacheHitRate: number;
  exactCacheHitRate?: number;
  fallbackSuccessCount?: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostMicroUsd: number;
  totalCostUsd: string;
  savedCostMicroUsd: number;
  savedCostUsd: string;
  averageLatencyMs: number;
  p95LatencyMs: number;
  latencyBySurface?: {
    projectApplicationP95Ms?: number;
    tenantChatP95Ms?: number;
  };
  maskingActionCounts: Record<string, number>;
  routingSummaries: Array<{
    category: "general" | "code" | "translation" | "summarization" | "reasoning";
    difficulty: "simple" | "complex";
    routingReason: string;
    requestCount: number;
  }>;
  statusCounts: Record<string, number>;
  costByModel: Array<{
    provider: string;
    model: string;
    requestCount: number;
    totalTokens: number;
    costMicroUsd: number;
    costUsd: string;
  }>;
  costByProject?: Array<{
    projectId: string;
    requestCount: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    costMicroUsd: number;
    costUsd: string;
  }>;
  requestIds: string[];
  dataFreshness: {
    source: string;
    recordCount: number;
    lastLogCreatedAt: string;
    generatedAt: string;
  };
  queryBudget?: {
    status: "ok" | "too_broad" | "partial" | "stale" | "unavailable";
    maxRangeHours: number;
    maxBreakdownItems: number;
    guidance: string | null;
  };
  performance?: {
    p95GatewayInternalLatencyMs: number;
    p99GatewayInternalLatencyMs: number;
    p95ProviderLatencyMs: number;
    p99ProviderLatencyMs: number;
    systemErrorRate: number;
  };
  breakdowns?: {
    byApplication?: Array<{ applicationId: string; requestCount: number; estimatedCostMicroUsd: number }>;
    byBudgetScope?: Array<{
      budgetScopeType: string;
      budgetScopeId: string;
      resolvedBy: string;
      requestCount: number;
      estimatedCostMicroUsd: number;
    }>;
    byProviderModel?: Array<{
      provider: string;
      model: string;
      requestCount: number;
      p95ProviderLatencyMs: number;
    }>;
    bySafetyOutcome: Array<{ outcome: string; requestCount: number }>;
    byCacheOutcome: Array<{ outcome: string; requestCount: number }>;
    byFallbackOutcome: Array<{ outcome: string; requestCount: number }>;
    byTerminalStatus: Array<{ outcome: string; requestCount: number }>;
  };
  notes: string[];
};
