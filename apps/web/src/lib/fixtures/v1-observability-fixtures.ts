import dashboardOverviewFixture from "../../../../../docs/v1.0.0/fixtures/dashboard-overview.fixture.json";
import invocationLogFixture from "../../../../../docs/v1.0.0/fixtures/invocation-log.fixture.json";

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

export type ResponseCapture = {
  capturedResponse: string | null;
  enabled: boolean;
  maxChars: number;
  mode: "disabled" | "raw_full";
  truncated: boolean;
  visibility: "admin_request_detail";
};

export type InvocationLogRecord = {
  requestId: string;
  traceId: string;
  tenantId: string;
  projectId: string;
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
  requestedProvider: string | null;
  requestedModel: string | null;
  selectedProvider: string | null;
  selectedModel: string | null;
  routingReason: string | null;
  cacheStatus: string;
  cacheType: string;
  cacheDecisionReason?: string | null;
  cacheKeyHash: string | null;
  cacheHitRequestId: string | null;
  maskingAction: "none" | "redacted" | "blocked";
  maskingDetectedTypes: string[];
  maskingDetectedCount: number;
  promptCategory?: string | null;
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
  responseCapture?: ResponseCapture;
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
      selectedProvider: string;
      selectedModel: string;
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

export function getDashboardOverview(): DashboardOverview {
  return normalizeDashboardOverview(dashboardOverviewFixture as unknown as DashboardOverview);
}

export function getInvocationLogFixture(): InvocationLogFixture {
  return invocationLogFixture as unknown as InvocationLogFixture;
}

export function getInvocationRecords(): InvocationLogRecord[] {
	return getInvocationLogFixture().records.map(normalizeInvocationRecord).sort((left, right) =>
		right.createdAt.localeCompare(left.createdAt)
	);
}

export function getInvocationRecord(requestId: string): InvocationLogRecord | undefined {
	const record = getInvocationLogFixture().records.find((item) => item.requestId === requestId);
	return record ? normalizeInvocationRecord(record) : undefined;
}

function normalizeInvocationRecord(record: InvocationLogRecord): InvocationLogRecord {
	const status = normalizeLegacyBridgeStatus(record.status);
	const terminalStatus = normalizeLegacyBridgeStatus(record.terminalStatus ?? status);
	const budgetScope = normalizeBudgetScope(record.budgetScope, record.applicationId);
	const runtime = normalizeRuntimeMetadataBridge(record.metadata?.runtime, record.createdAt);
	const domainOutcomes = record.domainOutcomes ?? legacyDomainOutcomes(record, terminalStatus);
	if (status === record.status && terminalStatus === record.terminalStatus && budgetScope === record.budgetScope && runtime === record.metadata?.runtime && domainOutcomes === record.domainOutcomes) {
		return record;
	}
	return { ...record, budgetScope, domainOutcomes, metadata: { runtime }, status, terminalStatus };
}

// v1 fixture compatibility bridge: legacy status values are normalized to v2 terminal status values.
function normalizeLegacyBridgeStatus(status: string): InvocationLogRecord["status"] {
	if (
		status === "success" ||
		status === "blocked" ||
		status === "rate_limited" ||
		status === "failed" ||
		status === "cancelled"
	) {
		return status;
	}
	if (status === "cache_hit") {
		return "success";
	}
	return "failed";
}

function normalizeDashboardOverview(overview: DashboardOverview): DashboardOverview {
	const applicationId = overview.filters.applicationId;
	return {
		...overview,
		filters: {
			...overview.filters,
			budgetScopeType: overview.filters.budgetScopeType ?? "application",
			budgetScopeId: overview.filters.budgetScopeId ?? applicationId,
			resolvedBy: overview.filters.resolvedBy ?? "default_application"
		}
	};
}

// v1 fixture compatibility bridge: legacy runtime hashes stay under legacyHashes, not primary provenance.
function normalizeRuntimeMetadataBridge(value: unknown, createdAt: string): RuntimeMetadata {
	const runtime = toRecord(value);
	const snapshot = toRecord(runtime.runtimeSnapshot);
	const legacyHashes = normalizeLegacyHashes(snapshot.legacyHashes ?? runtime.legacyHashes ?? runtime);
	return {
		runtimeSnapshot: {
			runtimeSnapshotId: stringOr(snapshot.runtimeSnapshotId, "runtime_snapshot_compat"),
			runtimeSnapshotVersion: integerOr(snapshot.runtimeSnapshotVersion, 1),
			contentHash: stringOr(snapshot.contentHash, legacyHashes.configHash),
			runtimeState: normalizeActualRuntimeStateBridge(snapshot.runtimeState),
			publishedAt: stringOr(snapshot.publishedAt, createdAt),
			publishedBy: stringOr(snapshot.publishedBy, "runtime_config_compat"),
			gatewayInstanceId: stringOr(snapshot.gatewayInstanceId, "gateway_web_compat"),
			legacyHashes
		}
	};
}

function normalizeLegacyHashes(value: unknown): LegacyRuntimeHashes {
	const record = toRecord(value);
	return {
		configHash: stringOr(record.configHash, "not-exposed"),
		securityPolicyHash: stringOr(record.securityPolicyHash, "not-exposed"),
		routingPolicyHash: stringOr(record.routingPolicyHash, "not-exposed")
	};
}

function normalizeActualRuntimeStateBridge(value: unknown): RuntimeSnapshotState {
	if (
		value === "snapshot_active" ||
		value === "last_known_safe_used" ||
		value === "stale_snapshot_used"
	) {
		return value;
	}
	return "snapshot_active";
}

function toRecord(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function stringOr(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value : fallback;
}

function integerOr(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeBudgetScope(scope: BudgetScope | undefined, applicationId: string): BudgetScope {
	if (
		scope?.budgetScopeType &&
		scope.budgetScopeId &&
		scope.resolvedBy
	) {
		return scope;
	}
	return {
		budgetScopeType: "application",
		budgetScopeId: applicationId,
		resolvedBy: "default_application"
	};
}

function legacyDomainOutcomes(record: InvocationLogRecord, terminalStatus: TerminalStatus): DomainOutcomes {
	const cacheOutcome = record.cacheStatus === "hit" || record.cacheStatus === "miss" || record.cacheStatus === "error"
		? record.cacheStatus
		: record.cacheStatus === "bypass" ? "bypassed" : "not_used";
	const safetyOutcome = record.maskingAction === "blocked" || record.maskingAction === "redacted"
		? record.maskingAction
		: "passed";
	const providerOutcome = record.providerLatencyMs === null || terminalStatus === "blocked" || terminalStatus === "rate_limited"
		? "not_called"
		: terminalStatus === "failed" ? "error" : "success";
	return {
		auth: { outcome: "passed" },
		runtime: { outcome: record.metadata?.runtime?.runtimeSnapshot?.runtimeState ?? "not_checked" },
		rateLimit: { outcome: terminalStatus === "rate_limited" ? "rate_limited" : "not_checked" },
		budget: { outcome: "allowed" },
		safety: { outcome: safetyOutcome },
		routing: { outcome: record.selectedProvider || record.selectedModel ? "selected" : "not_checked" },
		cache: { outcome: cacheOutcome },
		provider: { outcome: providerOutcome, code: providerOutcome === "error" ? record.errorCode : null },
		fallback: { outcome: "not_called" },
		streaming: { outcome: record.stream ? terminalStatus === "cancelled" ? "cancelled" : "completed" : "not_streaming" },
		logging: { outcome: "written" }
	};
}
