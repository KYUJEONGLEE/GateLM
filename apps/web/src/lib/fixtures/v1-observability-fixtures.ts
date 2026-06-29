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
  runtimeSnapshot: RuntimeSnapshotProvenance;
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
  status: "success" | "blocked" | "rate_limited" | "failed" | "cancelled";
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
	const budgetScope = normalizeBudgetScope(record.budgetScope, record.applicationId);
	const runtime = normalizeRuntimeMetadataBridge(record.metadata?.runtime, record.createdAt);
	if (status === record.status && budgetScope === record.budgetScope && runtime === record.metadata?.runtime) {
		return record;
	}
	return { ...record, budgetScope, metadata: { runtime }, status };
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
