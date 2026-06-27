import dashboardOverviewFixture from "../../../../../docs/v1.0.0/fixtures/dashboard-overview.fixture.json";
import invocationLogFixture from "../../../../../docs/v1.0.0/fixtures/invocation-log.fixture.json";

export type RuntimeMetadata = {
  configHash: string;
  securityPolicyHash: string;
  routingPolicyHash: string;
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

export type InvocationLogRecord = {
  requestId: string;
  traceId: string;
  tenantId: string;
  projectId: string;
  applicationId: string;
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
  requestedProvider: string | null;
  requestedModel: string | null;
  selectedProvider: string | null;
  selectedModel: string | null;
  routingReason: string | null;
  cacheStatus: string;
  cacheType: string;
  cacheKeyHash: string | null;
  cacheHitRequestId: string | null;
  maskingAction: "none" | "redacted" | "blocked";
  maskingDetectedTypes: string[];
  maskingDetectedCount: number;
  rateLimitDecision: RateLimitDecision;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costMicroUsd: number;
  savedCostMicroUsd: number;
  latencyMs: number;
  providerLatencyMs: number | null;
  status: "success" | "cache_hit" | "blocked" | "rate_limited" | "error" | "cancelled";
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

export type InvocationLogFixture = {
  fixtureName: string;
  fixtureVersion: string;
  owner: string;
  producer: string[];
  consumers: string[];
  sourceOfTruth: string[];
  notes: string[];
  records: InvocationLogRecord[];
};

export type DashboardOverview = {
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
    provider: string | null;
    model: string | null;
  };
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  blockedRequests: number;
  rateLimitedRequests: number;
  cacheHitRequests: number;
  cacheEligibleRequests: number;
  cacheHitRate: number;
  totalTokens: number;
  promptTokens: number;
  completionTokens: number;
  totalCostMicroUsd: number;
  totalCostUsd: string;
  savedCostMicroUsd: number;
  savedCostUsd: string;
  averageLatencyMs: number;
  p95LatencyMs: number;
  maskingActionCounts: Record<string, number>;
  routingCountByModel: Array<{
    selectedProvider: string;
    selectedModel: string;
    routingReason: string;
    requestCount: number;
  }>;
  statusCounts: Record<string, number>;
  costByModel: Array<{
    selectedProvider: string;
    selectedModel: string;
    requestCount: number;
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
  notes: string[];
};

export function getDashboardOverview(): DashboardOverview {
  return dashboardOverviewFixture as DashboardOverview;
}

export function getInvocationLogFixture(): InvocationLogFixture {
  return invocationLogFixture as InvocationLogFixture;
}

export function getInvocationRecords(): InvocationLogRecord[] {
  return [...getInvocationLogFixture().records].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  );
}

export function getInvocationRecord(requestId: string): InvocationLogRecord | undefined {
  return getInvocationLogFixture().records.find((record) => record.requestId === requestId);
}
