import "server-only";

import type {
  DomainOutcome,
  DomainOutcomes,
  TerminalStatus
} from "@/lib/fixtures/v1-observability-fixtures";
import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";
import {
  type LiveInvocationLogRecord,
  normalizeProviderAttempt,
  normalizeRequestRouting
} from "@/lib/gateway/live-observability-contract";
import { matchesRequestLogSafetyOutcome } from "@/lib/gateway/request-log-safety-filter";

type GatewayProjectLogsResponse = {
  data?: GatewayProjectLogItem[];
  meta?: {
    filterOptions?: GatewayProjectLogFilterOptions;
  };
};

type GatewayProjectLogItem = {
  applicationId?: string;
  budgetScope?: GatewayBudgetScope;
  cacheStatus?: string;
  cacheType?: string;
  category?: string;
  completionTokens?: number;
  costMicroUsd?: number;
  createdAt?: string;
  difficulty?: string;
  domainOutcomes?: GatewayDomainOutcomes;
  httpStatus?: number;
  latencyMs?: number;
  maskingAction?: string;
  modelRef?: string;
  projectId?: string;
  promptTokens?: number;
  providerAttempt?: {
    latencyMs?: number | null;
    modelId?: string;
    outcome?: string;
    providerId?: string;
    sanitizedErrorCode?: string | null;
  } | null;
  requestId?: string;
  requestedModel?: string;
  routingReason?: string;
  status?: string;
  terminalStatus?: string;
  totalTokens?: number;
  userRef?: string | null;
};

type GatewayBudgetScope = {
  budgetScopeId?: string;
  budgetScopeType?: string;
  resolvedBy?: string;
};

type GatewayProjectLogFilterOptions = {
  budgetScopes?: GatewayBudgetScope[];
  requestedModels?: string[];
};

type GatewayDomainOutcomes = Partial<
  Record<keyof DomainOutcomes, Partial<DomainOutcome> | null>
>;

export type LiveGatewayRequestLogFilters = {
  applicationId?: string;
  budgetScopeId?: string;
  budgetScopeType?: string;
  cacheStatus?: string;
  from?: string;
  limit?: number;
  requestedModel?: string;
  projectId?: string;
  projectIds?: string[];
  requestId?: string;
  resolvedBy?: string;
  safetyOutcome?: string;
  status?: string;
  tenantId?: string;
  to?: string;
};

export type LiveGatewayRequestLogBudgetScopeOption = {
  budgetScopeId: string;
  budgetScopeType: string;
  resolvedBy?: string;
};

export type LiveGatewayRequestLogFilterOptions = {
  budgetScopes: LiveGatewayRequestLogBudgetScopeOption[];
  requestedModels: string[];
};

export type LiveGatewayRequestLogsWithMeta = {
  filterOptions: LiveGatewayRequestLogFilterOptions;
  records: LiveInvocationLogRecord[];
};

type ProjectLogsFetchResult = {
  filterOptions: LiveGatewayRequestLogFilterOptions;
  records: LiveInvocationLogRecord[];
};

const LIVE_RANGE_HOURS = 24;
const MAX_LOG_PROJECT_FETCH_CONCURRENCY = 4;
const DEFAULT_LOG_LIMIT = 50;
const IN_MEMORY_FILTER_FETCH_LIMIT = 1000;

export async function getLiveGatewayRequestLogs(
  filters: LiveGatewayRequestLogFilters = {}
): Promise<LiveInvocationLogRecord[] | undefined> {
  const result = await getLiveGatewayRequestLogsPayload(filters, false);
  return result?.records;
}

export async function getLiveGatewayRequestLogsWithMeta(
  filters: LiveGatewayRequestLogFilters = {}
): Promise<LiveGatewayRequestLogsWithMeta | undefined> {
  return getLiveGatewayRequestLogsPayload(filters, true);
}

async function getLiveGatewayRequestLogsPayload(
  filters: LiveGatewayRequestLogFilters,
  includeFilterOptions: boolean
): Promise<LiveGatewayRequestLogsWithMeta | undefined> {
  const config = getLiveGatewayConfig();
  const defaultRange = getLiveRange();
  const tenantId = getGatewayTenantId(filters.tenantId);
  const finalLimit = filters.limit ?? DEFAULT_LOG_LIMIT;
  const upstreamLimit = hasInMemoryFilters(filters)
    ? Math.max(finalLimit, IN_MEMORY_FILTER_FETCH_LIMIT)
    : finalLimit;
  const query = new URLSearchParams({
    from: filters.from ?? defaultRange.from,
    limit: String(upstreamLimit),
    tenantId,
    to: filters.to ?? defaultRange.to
  });
  appendOptionalQuery(query, "applicationId", filters.applicationId);
  appendOptionalQuery(query, "cacheStatus", filters.cacheStatus);
  appendOptionalQuery(query, "status", filters.status);
  appendOptionalQuery(query, "requestedModel", filters.requestedModel);
  appendOptionalQuery(query, "requestId", filters.requestId);
  if (includeFilterOptions) {
    query.set("includeFilterOptions", "true");
  }

  const projectIds = await getLogProjectIds(
    filters.projectId,
    filters.projectIds,
    filters.tenantId,
    config.projectId
  );
  const projectResults = await fetchProjectLogsWithConcurrency(config.baseUrl, projectIds, query);
  const flattenedRecords = projectResults.flatMap((projectResult) => projectResult?.records ?? []);

  if (flattenedRecords.length === 0 && projectResults.some((projectResult) => projectResult === undefined)) {
    return undefined;
  }

  const records = flattenedRecords
    .filter((record) => matchesBudgetScopeFilter(record.budgetScope, filters))
    .filter((record) => matchesRequestedModelFilter(record, filters.requestedModel))
    .filter((record) => matchesRequestLogSafetyOutcome(record, filters.safetyOutcome))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, finalLimit);

  return {
    filterOptions: mergeProjectLogFilterOptions(
      projectResults.map((projectResult) => projectResult?.filterOptions)
    ),
    records
  };
}

async function fetchProjectLogsWithConcurrency(
  baseUrl: string,
  projectIds: string[],
  query: URLSearchParams
): Promise<Array<ProjectLogsFetchResult | undefined>> {
  const results: Array<ProjectLogsFetchResult | undefined> = [];

  for (let index = 0; index < projectIds.length; index += MAX_LOG_PROJECT_FETCH_CONCURRENCY) {
    const batch = projectIds.slice(index, index + MAX_LOG_PROJECT_FETCH_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map((projectId) => fetchProjectLogs(baseUrl, projectId, query))
    );
    results.push(...batchResults);
  }

  return results;
}

async function fetchProjectLogs(
  baseUrl: string,
  projectId: string,
  query: URLSearchParams
): Promise<ProjectLogsFetchResult | undefined> {
  const response = await fetch(
    `${baseUrl}/api/projects/${encodeURIComponent(projectId)}/logs?${query.toString()}`,
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
  return {
    filterOptions: normalizeGatewayFilterOptions(payload.meta?.filterOptions),
    records: (payload.data ?? []).map((item) => toInvocationRecord(item, projectId))
  };
}

function normalizeGatewayFilterOptions(
  value: GatewayProjectLogFilterOptions | undefined
): LiveGatewayRequestLogFilterOptions {
  return {
    budgetScopes: (value?.budgetScopes ?? [])
      .map((scope) => ({
        budgetScopeId: scope.budgetScopeId?.trim() ?? "",
        budgetScopeType: scope.budgetScopeType?.trim() ?? "",
        resolvedBy: scope.resolvedBy?.trim() || undefined
      }))
      .filter((scope) => scope.budgetScopeId && scope.budgetScopeType),
    requestedModels: (value?.requestedModels ?? []).map((model) => model.trim()).filter(Boolean)
  };
}

function mergeProjectLogFilterOptions(
  options: Array<LiveGatewayRequestLogFilterOptions | undefined>
): LiveGatewayRequestLogFilterOptions {
  const requestedModels = new Set<string>();
  const budgetScopes = new Map<string, LiveGatewayRequestLogBudgetScopeOption>();

  options.forEach((option) => {
    option?.requestedModels.forEach((model) => {
      if (model) {
        requestedModels.add(model);
      }
    });
    option?.budgetScopes.forEach((scope) => {
      if (!scope.budgetScopeId || !scope.budgetScopeType) {
        return;
      }
      budgetScopes.set(
        `${scope.budgetScopeType}:${scope.budgetScopeId}:${scope.resolvedBy ?? ""}`,
        scope
      );
    });
  });

  return {
    budgetScopes: Array.from(budgetScopes.values()).sort((first, second) => {
      const typeOrder = first.budgetScopeType.localeCompare(second.budgetScopeType);
      const idOrder = first.budgetScopeId.localeCompare(second.budgetScopeId);
      return typeOrder || idOrder || (first.resolvedBy ?? "").localeCompare(second.resolvedBy ?? "");
    }),
    requestedModels: Array.from(requestedModels).sort((first, second) => first.localeCompare(second))
  };
}

async function getLogProjectIds(
  projectId: string | undefined,
  scopedProjectIds: string[] | undefined,
  routeTenantId: string | undefined,
  fallbackProjectId: string
) {
  const requestedProjectId = projectId?.trim();
  const scopedIds = dedupeProjectIds(scopedProjectIds);

  if (scopedProjectIds) {
    return requestedProjectId
      ? scopedIds.includes(requestedProjectId)
        ? [requestedProjectId]
        : []
      : scopedIds;
  }

  if (requestedProjectId) {
    return [requestedProjectId];
  }

  const projectsModel = await getProjectsModel(routeTenantId ?? getControlPlaneTenantId());
  const projectIds = projectsModel.projects.map((project) => project.id).filter(Boolean);

  return projectIds.length > 0 ? projectIds : [fallbackProjectId];
}

function dedupeProjectIds(projectIds: string[] | undefined) {
  return Array.from(
    new Set((projectIds ?? []).map((projectId) => projectId.trim()).filter(Boolean))
  );
}

function appendOptionalQuery(query: URLSearchParams, key: string, value: string | undefined) {
  const normalized = value?.trim();
  if (normalized) {
    query.set(key, normalized);
  }
}

function hasInMemoryFilters(filters: LiveGatewayRequestLogFilters) {
  return Boolean(
    filters.budgetScopeType?.trim() ||
      filters.budgetScopeId?.trim() ||
      filters.resolvedBy?.trim() ||
      filters.requestedModel?.trim() ||
      filters.safetyOutcome?.trim()
  );
}

function matchesBudgetScopeFilter(
  scope: LiveInvocationLogRecord["budgetScope"],
  filters: LiveGatewayRequestLogFilters
) {
  const budgetScopeType = filters.budgetScopeType?.trim();
  const budgetScopeId = filters.budgetScopeId?.trim();
  const resolvedBy = filters.resolvedBy?.trim();

  if (budgetScopeType && scope.budgetScopeType !== budgetScopeType) {
    return false;
  }

  if (budgetScopeId && scope.budgetScopeId !== budgetScopeId) {
    return false;
  }

  if (resolvedBy && scope.resolvedBy !== resolvedBy) {
    return false;
  }

  return true;
}

function matchesRequestedModelFilter(record: LiveInvocationLogRecord, modelFilter: string | undefined) {
  const model = modelFilter?.trim();

  if (!model) {
    return true;
  }

  const normalizedModel = model.toLowerCase();

  return record.requestedModel?.toLowerCase() === normalizedModel;
}

function getLiveRange() {
  const to = new Date();
  const from = new Date(to.getTime() - LIVE_RANGE_HOURS * 60 * 60 * 1000);

  return {
    from: from.toISOString(),
    to: to.toISOString()
  };
}

function getGatewayTenantId(routeTenantId: string | undefined) {
  const tenantId = routeTenantId?.trim();

  return tenantId && isUuid(tenantId) ? tenantId : getControlPlaneTenantId();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toInvocationRecord(item: GatewayProjectLogItem, projectId: string): LiveInvocationLogRecord {
  const requestId = item.requestId ?? "";
  const createdAt = item.createdAt ?? new Date().toISOString();
  const cacheStatus = item.cacheStatus ?? "bypass";
  const status = normalizeLegacyBridgeStatus(item.terminalStatus ?? item.status);
  const rawMaskingAction = normalizeMaskingAction(item.maskingAction);
  const costMicroUsd = item.costMicroUsd ?? 0;
  const applicationId = item.applicationId ?? "live_gateway_application";
  const budgetScope = normalizeBudgetScope(item.budgetScope, applicationId);
  const domainOutcomes = normalizeDomainOutcomes(
    item.domainOutcomes,
    legacyDomainOutcomes(status, cacheStatus, rawMaskingAction)
  );
  const maskingAction =
    rawMaskingAction === "none"
      ? maskingActionFromSafetyOutcome(domainOutcomes.safety.outcome)
      : rawMaskingAction;
  const routing = normalizeRequestRouting(item);

  return {
    requestId,
    traceId: requestId,
    tenantId: "live_gateway_tenant",
    projectId: item.projectId ?? projectId,
    applicationId,
    budgetScope,
    apiKeyId: "live_gateway_api_key",
    appTokenId: "live_gateway_app_token",
    endUserId: normalizeUserRef(item.userRef),
    featureId: null,
    endpoint: "/v1/chat/completions",
    method: "POST",
    source: "customer_demo_app",
    stream: false,
    requestBodyHash: "not-exposed-by-live-list",
    promptHash: "not-exposed-by-live-list",
    redactedPromptPreview: null,
    requestedModel: routing.requestedModel,
    category: routing.category,
    difficulty: routing.difficulty,
    modelRef: routing.modelRef,
    routingReason: routing.routingReason,
    providerAttempt: normalizeProviderAttempt(item.providerAttempt),
    cacheStatus,
    cacheType: item.cacheType ?? "none",
    cacheDecisionReason: null,
    cacheKeyHash: null,
    cacheHitRequestId: null,
    maskingAction,
    maskingDetectedTypes: [],
    maskingDetectedCount: 0,
    providerCalled: domainOutcomes.provider.outcome !== "not_called",
    rateLimitDecision: {
      allowed: status !== "rate_limited",
      scope: budgetScope.budgetScopeType,
      scopeId: budgetScope.budgetScopeId,
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
    terminalStatus: status,
    domainOutcomes,
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

function normalizeUserRef(value: string | null | undefined) {
  const normalized = value?.trim();

  return normalized ? normalized : null;
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

function normalizeDomainOutcomes(
  value: GatewayDomainOutcomes | undefined,
  fallback: DomainOutcomes
): DomainOutcomes {
  return {
    auth: normalizeDomainOutcome(value?.auth, fallback.auth),
    runtime: normalizeDomainOutcome(value?.runtime, fallback.runtime),
    rateLimit: normalizeDomainOutcome(value?.rateLimit, fallback.rateLimit),
    budget: normalizeDomainOutcome(value?.budget, fallback.budget),
    safety: normalizeDomainOutcome(value?.safety, fallback.safety),
    routing: normalizeDomainOutcome(value?.routing, fallback.routing),
    cache: normalizeDomainOutcome(value?.cache, fallback.cache),
    provider: normalizeDomainOutcome(value?.provider, fallback.provider),
    fallback: normalizeDomainOutcome(value?.fallback, fallback.fallback),
    streaming: normalizeDomainOutcome(value?.streaming, fallback.streaming),
    logging: normalizeDomainOutcome(value?.logging, fallback.logging)
  };
}

function normalizeDomainOutcome(
  value: Partial<DomainOutcome> | null | undefined,
  fallback: DomainOutcome
): DomainOutcome {
  return {
    outcome: value?.outcome ?? fallback.outcome,
    reason: value?.reason ?? fallback.reason ?? null,
    code: value?.code ?? fallback.code ?? null
  };
}

function legacyDomainOutcomes(
  status: TerminalStatus,
  cacheStatus: string,
  maskingAction: LiveInvocationLogRecord["maskingAction"]
): DomainOutcomes {
  const cacheOutcome =
    cacheStatus === "hit" || cacheStatus === "miss" || cacheStatus === "error"
      ? cacheStatus
      : cacheStatus === "bypass"
        ? "bypassed"
        : "not_used";
  const safetyOutcome =
    maskingAction === "blocked" || maskingAction === "redacted" ? maskingAction : "passed";
  const providerOutcome =
    status === "blocked" || status === "rate_limited" || cacheOutcome === "hit"
      ? "not_called"
      : status === "failed"
        ? "error"
        : "success";

  return {
    auth: { outcome: "passed" },
    runtime: { outcome: "snapshot_active" },
    rateLimit: { outcome: status === "rate_limited" ? "rate_limited" : "not_checked" },
    budget: { outcome: "allowed" },
    safety: { outcome: safetyOutcome },
    routing: { outcome: cacheOutcome === "hit" ? "skipped" : "selected" },
    cache: { outcome: cacheOutcome },
    provider: { outcome: providerOutcome },
    fallback: { outcome: "not_called" },
    streaming: { outcome: "not_streaming" },
    logging: { outcome: "written" }
  };
}

function maskingActionFromSafetyOutcome(outcome: string): LiveInvocationLogRecord["maskingAction"] {
  if (outcome === "redacted" || outcome === "blocked") {
    return outcome;
  }

  return "none";
}

// Live Gateway list payloads may still carry legacy status names; normalize them for the v2-facing read model.
function normalizeLegacyBridgeStatus(value: string | undefined): LiveInvocationLogRecord["status"] {
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

function normalizeMaskingAction(value: string | undefined): LiveInvocationLogRecord["maskingAction"] {
  if (value === "none" || value === "redacted" || value === "blocked") {
    return value;
  }

  return "none";
}
