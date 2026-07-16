import "server-only";

import { getTenantEmployees } from "@/lib/control-plane/employees-client";
import { resolveControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import { listTenantProviderConnections } from "@/lib/control-plane/provider-connections-client";
import {
  buildProviderDisplayDirectory,
  resolveProviderDisplay,
  type ProviderDisplayDirectory
} from "@/lib/control-plane/provider-display";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import { formatDisplayIdentifier } from "@/lib/formatting/display-identifiers";
import { getDashboardLiveRange, type LiveDashboardRange } from "@/lib/gateway/live-dashboard-overview";
import { getLiveGatewayRequestLogs } from "@/lib/gateway/live-request-logs";
import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";
import type {
  LiveRequestCacheStatus,
  LiveRequestsPayload,
  LiveRequestSafetyAction,
  LiveRequestStatusFilter
} from "@/lib/gateway/live-requests-types";

export type LiveOverviewRequestsFilters = {
  budgetScopeId?: string;
  budgetScopeType?: string;
  model?: string;
  projectId?: string;
  range?: LiveDashboardRange;
  resolvedBy?: string;
  status?: LiveRequestStatusFilter;
};

export type LiveOverviewRequestsOptions = {
  providerDirectory?: ProviderDisplayDirectory;
  projectIds?: string[];
  projectNameSource?: LiveRequestsPayload["projectNameSource"];
  projects?: ProjectRecord[];
};

const LIVE_REQUESTS_DISPLAY_LIMIT = 9;
const LIVE_REQUESTS_FETCH_LIMIT = 50;
export async function getLiveOverviewRequests(
  tenantId: string,
  filters: LiveOverviewRequestsFilters = {},
  options: LiveOverviewRequestsOptions = {}
): Promise<LiveRequestsPayload | undefined> {
  const liveRange = getDashboardLiveRange(filters.range);
  const [projectsModel, employees, providerDirectory] = await Promise.all([
    options.projects ? Promise.resolve(undefined) : getProjectsModel(tenantId),
    getTenantEmployees(tenantId),
    options.providerDirectory
      ? Promise.resolve(options.providerDirectory)
      : getLiveRequestProviderDirectory(tenantId)
  ]);
  const projects = options.projects ?? projectsModel?.projects ?? [];
  const projectIds = options.projectIds ?? projects.map((project) => project.id).filter(Boolean);
  const records = await getLiveGatewayRequestLogs({
    budgetScopeId: filters.budgetScopeId,
    budgetScopeType: filters.budgetScopeType,
    from: liveRange.from,
    limit: LIVE_REQUESTS_FETCH_LIMIT,
    projectId: filters.projectId,
    projectIds,
    resolvedBy: filters.resolvedBy,
    status: filters.status || undefined,
    tenantId,
    to: liveRange.to
  });

  if (!records) {
    return undefined;
  }

  const projectNames = buildProjectNameMap(projects);
  const employeeNames = buildEmployeeNameMap(employees);
  const allRows = records.map((record) =>
    toLiveRequestRow(record, projectNames, employeeNames, providerDirectory)
  );
  const modelFilter = normalizeModelFilter(filters.model);
  const rows = allRows
    .filter((row) => !modelFilter || normalizeModelFilter(displayModel(row)) === modelFilter)
    .slice(0, LIVE_REQUESTS_DISPLAY_LIMIT);
  const requestedModelOptions = buildModelOptions(allRows, filters.model);

  return {
    generatedAt: new Date().toISOString(),
    requestedModelOptions,
    projectNameSource: options.projectNameSource ?? projectsModel?.source ?? "control-plane",
    rows
  };
}

export async function getLiveRequestProviderDirectory(
  tenantId: string
): Promise<ProviderDisplayDirectory> {
  const providerConnections = await listTenantProviderConnections(
    resolveControlPlaneTenantId(tenantId)
  );

  return buildProviderDisplayDirectory(
    providerConnections.ok ? providerConnections.data : []
  );
}

function buildProjectNameMap(projects: ProjectRecord[]) {
  return new Map(projects.map((project) => [project.id, project.name]));
}

function buildEmployeeNameMap(
  employees: Awaited<ReturnType<typeof getTenantEmployees>>
) {
  const names = new Map<string, string>();

  employees.forEach((employee) => {
    const name = employee.name?.trim() || employee.email;
    [employee.id, employee.userId, employee.email].forEach((alias) => {
      if (alias) {
        names.set(alias.trim().toLocaleLowerCase(), name);
      }
    });
  });

  return names;
}

function toLiveRequestRow(
  record: LiveInvocationLogRecord,
  projectNames: Map<string, string>,
  employeeNames: Map<string, string>,
  providerDirectory: ProviderDisplayDirectory
) {
  const projectId = record.projectId;
  const statusCode = record.httpStatus || statusToFallbackCode(record.status);
  const providerId = record.providerAttempt?.providerId ?? null;
  const providerDisplay = resolveProviderDisplay(providerDirectory, providerId);

  return {
    cacheStatus: normalizeCacheStatus(record.cacheStatus),
    category: record.category,
    costUsd: record.costMicroUsd / 1_000_000,
    difficulty: record.difficulty,
    executedModel: record.providerAttempt?.modelId ?? null,
    fallbackUsed: record.domainOutcomes?.fallback?.outcome === "success",
    id: record.requestId,
    latencyMs: record.latencyMs,
    ttftMs: record.ttftMs ?? null,
    modelRef: record.modelRef,
    projectId,
    projectName: projectNames.get(projectId) ?? formatDisplayIdentifier(projectId),
    providerFamily: providerDisplay?.family ?? null,
    providerId,
    providerName: providerDisplay?.name ?? null,
    requestedModel: record.requestedModel ?? "auto",
    requestId: record.requestId,
    routingReason: record.routingReason,
    safetyAction: normalizeSafetyAction(record),
    surface: "project_application" as const,
    status: record.status,
    statusCode,
    statusLabel: statusLabel(statusCode, record.status),
    timestamp: record.createdAt,
    totalTokens: record.totalTokens,
    userName: normalizeUserName(record.endUserId, employeeNames)
  };
}

function normalizeUserName(
  value: string | null | undefined,
  employeeNames: Map<string, string>
) {
  const normalized = value?.trim();

  return normalized
    ? employeeNames.get(normalized.toLocaleLowerCase()) ?? normalized
    : null;
}

function normalizeCacheStatus(value: string): LiveRequestCacheStatus {
  const normalized = value.toLowerCase();

  if (normalized === "hit") {
    return "HIT";
  }

  if (normalized === "miss") {
    return "MISS";
  }

  if (normalized === "bypass") {
    return "BYPASS";
  }

  return "NONE";
}

function normalizeSafetyAction(record: LiveInvocationLogRecord): LiveRequestSafetyAction {
  const action = record.maskingAction.toLowerCase();
  const outcome = record.domainOutcomes?.safety?.outcome?.toLowerCase() ?? "";

  if (action === "blocked" || outcome === "blocked") {
    return "BLOCKED";
  }

  if (action === "redacted" || outcome === "redacted") {
    return "REDACTED";
  }

  if (outcome === "masked" || outcome === "masking_applied") {
    return "MASKED";
  }

  return "NONE";
}

function statusToFallbackCode(status: string) {
  if (status === "success") {
    return 200;
  }

  if (status === "blocked") {
    return 403;
  }

  if (status === "rate_limited") {
    return 429;
  }

  if (status === "failed") {
    return 500;
  }

  return 0;
}

function statusLabel(statusCode: number, status: string) {
  if (statusCode <= 0) {
    return status;
  }

  const labels: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Blocked",
    404: "Not Found",
    408: "Timeout",
    429: "Rate Limited",
    500: "Error",
    502: "Bad Gateway",
    503: "Unavailable",
    504: "Timeout"
  };

  return `${statusCode} ${labels[statusCode] ?? status}`;
}

function buildModelOptions(
  rows: Array<{ executedModel: string | null; requestedModel: string }>,
  modelFilter: string | undefined
) {
  const models = new Set<string>();

  if (modelFilter?.trim()) {
    models.add(modelFilter.trim());
  }

  rows.forEach((row) => {
    const model = displayModel(row);
    if (model && model !== "auto") {
      models.add(model);
    }
  });

  return Array.from(models).sort((first, second) => first.localeCompare(second));
}

function displayModel(row: { executedModel: string | null; requestedModel: string }) {
  return row.executedModel ?? row.requestedModel;
}

function normalizeModelFilter(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}
