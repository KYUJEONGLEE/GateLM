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

export type TerminalStatus = "success" | "blocked" | "rate_limited" | "failed" | "cancelled";

export type DomainOutcomes = {
  auth: { outcome: string; httpStatus?: number; errorCode?: string | null };
  runtime: {
    outcome: string;
    runtimeSnapshotId?: string | null;
    runtimeSnapshotVersion?: number | null;
    runtimeState?: string | null;
  };
  rateLimit: { outcome: string; remaining?: number | null; retryAfterSeconds?: number | null };
  budget: {
    outcome: string;
    budgetScopeType: string;
    budgetScopeId: string;
    resolvedBy: string;
  };
  safety: {
    outcome: "passed" | "redacted" | "blocked" | "not_checked";
    maskingAction?: "none" | "redacted" | "blocked";
    detectedTypes?: string[];
    detectedCount: number;
    redactedPromptPreview?: string | null;
  };
  routing: {
    outcome: string;
    requestedModel?: string | null;
    selectedProvider?: string | null;
    selectedModel?: string | null;
    routingReason?: string | null;
  };
  cache: {
    outcome: "hit" | "miss" | "bypassed" | "error" | "not_used";
    cacheType?: string;
    cacheHitRequestId?: string | null;
  };
  provider: {
    outcome: "success" | "timeout" | "error" | "unauthorized" | "not_called";
    selectedProvider?: string | null;
    selectedModel?: string | null;
    latencyMs?: number | null;
    sanitizedErrorCode?: string | null;
  };
  fallback: {
    outcome: "not_needed" | "disabled" | "success" | "failed" | "not_called";
    fallbackProvider?: string | null;
    reason?: string | null;
  };
  streaming: { outcome: string; streamingRequested?: boolean };
  logging: { outcome: string; requestLogWritten?: boolean; sanitizedErrorCode?: string | null };
};

export type DomainOutcomesBridgeInput = {
  applicationId?: string;
  budgetScope: BudgetScope;
  cacheHitRequestId?: string | null;
  cacheStatus?: string;
  cacheType?: string;
  errorCode?: string | null;
  httpStatus?: number;
  maskingAction?: "none" | "redacted" | "blocked";
  maskingDetectedCount?: number;
  maskingDetectedTypes?: string[];
  providerLatencyMs?: number | null;
  redactedPromptPreview?: string | null;
  requestedModel?: string | null;
  routingReason?: string | null;
  runtime?: RuntimeMetadata;
  selectedModel?: string | null;
  selectedProvider?: string | null;
  stream?: boolean;
  terminalStatus: TerminalStatus;
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
  terminalStatus: TerminalStatus;
  domainOutcomes: DomainOutcomes;
  status: TerminalStatus;
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
	const status = normalizeLegacyBridgeStatus(record.terminalStatus ?? record.status);
	const budgetScope = normalizeBudgetScope(record.budgetScope, record.applicationId);
	const runtime = normalizeRuntimeMetadataBridge(record.metadata?.runtime, record.createdAt);
	const domainOutcomes = normalizeDomainOutcomes(record.domainOutcomes, record, status, budgetScope);
	if (
		status === record.status &&
		status === record.terminalStatus &&
		budgetScope === record.budgetScope &&
		runtime === record.metadata?.runtime &&
		domainOutcomes === record.domainOutcomes
	) {
		return record;
	}
	return { ...record, budgetScope, domainOutcomes, metadata: { runtime }, status, terminalStatus: status };
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

function normalizeDomainOutcomes(
	value: DomainOutcomes | undefined,
	record: InvocationLogRecord,
	terminalStatus: TerminalStatus,
	budgetScope: BudgetScope
): DomainOutcomes {
	if (value?.cache?.outcome && value.safety?.outcome && value.provider?.outcome) {
		return value;
	}

	return buildDomainOutcomesBridge({
		applicationId: record.applicationId,
		budgetScope,
		cacheHitRequestId: record.cacheHitRequestId,
		cacheStatus: record.cacheStatus,
		cacheType: record.cacheType,
		errorCode: record.errorCode,
		httpStatus: record.httpStatus,
		maskingAction: record.maskingAction,
		maskingDetectedCount: record.maskingDetectedCount,
		maskingDetectedTypes: record.maskingDetectedTypes,
		providerLatencyMs: record.providerLatencyMs,
		redactedPromptPreview: record.redactedPromptPreview,
		requestedModel: record.requestedModel,
		routingReason: record.routingReason,
		runtime: record.metadata.runtime,
		selectedModel: record.selectedModel,
		selectedProvider: record.selectedProvider,
		stream: record.stream,
		terminalStatus
	});
}

export function buildDomainOutcomesBridge(input: DomainOutcomesBridgeInput): DomainOutcomes {
	const safetyOutcome =
		input.maskingAction === "blocked"
			? "blocked"
			: input.maskingAction === "redacted"
				? "redacted"
				: "passed";
	const cacheOutcome =
		input.cacheStatus === "hit"
			? "hit"
			: input.cacheStatus === "miss"
				? "miss"
				: input.cacheStatus === "error"
					? "error"
					: "bypassed";
	const providerOutcome =
		cacheOutcome === "hit" || input.terminalStatus === "blocked" || input.terminalStatus === "rate_limited"
			? "not_called"
			: input.terminalStatus === "success"
				? "success"
				: "error";
	const authOutcome =
		input.errorCode === "invalid_api_key" ||
		input.errorCode === "invalid_app_token" ||
		input.errorCode === "scope_mismatch"
			? input.errorCode
			: "passed";

	return {
		auth: {
			outcome: authOutcome,
			httpStatus: input.httpStatus,
			errorCode: authOutcome === "passed" ? null : input.errorCode
		},
		runtime: {
			outcome: input.runtime?.runtimeSnapshot.runtimeState ?? "not_checked",
			runtimeSnapshotId: input.runtime?.runtimeSnapshot.runtimeSnapshotId ?? null,
			runtimeSnapshotVersion: input.runtime?.runtimeSnapshot.runtimeSnapshotVersion ?? null,
			runtimeState: input.runtime?.runtimeSnapshot.runtimeState ?? null
		},
		rateLimit: { outcome: input.terminalStatus === "rate_limited" ? "rate_limited" : "not_checked" },
		budget: {
			outcome: "not_checked",
			budgetScopeType: input.budgetScope.budgetScopeType,
			budgetScopeId: input.budgetScope.budgetScopeId,
			resolvedBy: input.budgetScope.resolvedBy
		},
		safety: {
			outcome: safetyOutcome,
			maskingAction: input.maskingAction ?? "none",
			detectedTypes: input.maskingDetectedTypes ?? [],
			detectedCount: input.maskingDetectedCount ?? 0,
			redactedPromptPreview: input.redactedPromptPreview ?? null
		},
		routing: {
			outcome: cacheOutcome === "hit" ? "skipped" : input.selectedModel ? "selected" : "not_checked",
			requestedModel: input.requestedModel ?? null,
			selectedProvider: input.selectedProvider ?? null,
			selectedModel: input.selectedModel ?? null,
			routingReason: input.routingReason ?? null
		},
		cache: {
			outcome: cacheOutcome,
			cacheType: input.cacheType ?? "none",
			cacheHitRequestId: input.cacheHitRequestId ?? null
		},
		provider: {
			outcome: providerOutcome,
			selectedProvider: input.selectedProvider ?? null,
			selectedModel: input.selectedModel ?? null,
			latencyMs: input.providerLatencyMs ?? null,
			sanitizedErrorCode: input.errorCode ?? null
		},
		fallback: {
			outcome: providerOutcome === "success" ? "not_needed" : "not_called",
			fallbackProvider: null,
			reason: null
		},
		streaming: { outcome: "not_streaming", streamingRequested: input.stream ?? false },
		logging: { outcome: "written", requestLogWritten: true, sanitizedErrorCode: null }
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
