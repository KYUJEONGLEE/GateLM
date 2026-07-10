import "server-only";

import { unstable_cache } from "next/cache";
import { getTenantEmployees } from "@/lib/control-plane/employees-client";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { formatDisplayIdentifier, formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import { getDashboardLiveRange, type LiveDashboardRange } from "@/lib/gateway/live-dashboard-overview";
import { getLiveGatewayRequestLogs } from "@/lib/gateway/live-request-logs";
import type {
  LiveRequestCacheStatus,
  LiveRequestProvider,
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
  projectIds?: string[];
  projectNameSource?: LiveRequestsPayload["projectNameSource"];
  projects?: ProjectRecord[];
};

const LIVE_REQUESTS_DISPLAY_LIMIT = 5;
const LIVE_REQUESTS_FILTER_FETCH_LIMIT = 50;
const getCachedTenantEmployees = unstable_cache(
  async (tenantId: string) => getTenantEmployees(tenantId),
  ["live-overview-request-employees"],
  { revalidate: 30 }
);

export async function getLiveOverviewRequests(
  tenantId: string,
  filters: LiveOverviewRequestsFilters = {},
  options: LiveOverviewRequestsOptions = {}
): Promise<LiveRequestsPayload | undefined> {
  const liveRange = getDashboardLiveRange(filters.range);
  const [projectsModel, employees] = await Promise.all([
    options.projects ? Promise.resolve(undefined) : getProjectsModel(tenantId),
    getCachedTenantEmployees(tenantId)
  ]);
  const projects = options.projects ?? projectsModel?.projects ?? [];
  const projectIds = options.projectIds ?? projects.map((project) => project.id).filter(Boolean);
  const records = await getLiveGatewayRequestLogs({
    budgetScopeId: filters.budgetScopeId,
    budgetScopeType: filters.budgetScopeType,
    from: liveRange.from,
    limit: filters.model ? LIVE_REQUESTS_FILTER_FETCH_LIMIT : LIVE_REQUESTS_DISPLAY_LIMIT,
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
  const allRows = records.map((record) => toLiveRequestRow(record, projectNames, employeeNames));
  const modelFilter = normalizeModelFilter(filters.model);
  const rows = allRows
    .filter((row) => !modelFilter || normalizeModelFilter(row.model) === modelFilter)
    .slice(0, LIVE_REQUESTS_DISPLAY_LIMIT);
  const modelOptions = buildModelOptions(allRows, filters.model);

  return {
    generatedAt: new Date().toISOString(),
    modelOptions,
    projectNameSource: options.projectNameSource ?? projectsModel?.source ?? "control-plane",
    rows
  };
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
  record: InvocationLogRecord,
  projectNames: Map<string, string>,
  employeeNames: Map<string, string>
) {
  const projectId = record.projectId;
  const provider = normalizeProvider(record.selectedProvider ?? record.requestedProvider);
  const statusCode = record.httpStatus || statusToFallbackCode(record.status);

  return {
    cacheStatus: normalizeCacheStatus(record.cacheStatus),
    costUsd: record.costMicroUsd / 1_000_000,
    id: record.requestId,
    latencyMs: record.latencyMs,
    model: formatModelDisplayName(record.selectedModel ?? record.requestedModel, "Unknown"),
    projectId,
    projectName: projectNames.get(projectId) ?? formatDisplayIdentifier(projectId),
    provider,
    providerLabel: providerLabel(provider),
    requestId: record.requestId,
    safetyAction: normalizeSafetyAction(record),
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

function normalizeProvider(value: string | null | undefined): LiveRequestProvider {
  const provider = (value ?? "").toLowerCase();

  if (provider.includes("openai")) {
    return "openai";
  }

  if (provider.includes("anthropic") || provider.includes("claude")) {
    return "anthropic";
  }

  if (provider.includes("gemini")) {
    return "gemini";
  }

  if (provider.includes("google")) {
    return "google";
  }

  if (provider.includes("mock")) {
    return "mock";
  }

  return "unknown";
}

function providerLabel(provider: LiveRequestProvider) {
  const labels: Record<LiveRequestProvider, string> = {
    anthropic: "Anthropic",
    gemini: "Gemini",
    google: "Google",
    mock: "Mock",
    openai: "OpenAI",
    unknown: "Unknown"
  };

  return labels[provider];
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

function normalizeSafetyAction(record: InvocationLogRecord): LiveRequestSafetyAction {
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
  rows: Array<{ model: string }>,
  selectedModel: string | undefined
) {
  const models = new Set<string>();

  if (selectedModel?.trim()) {
    models.add(selectedModel.trim());
  }

  rows.forEach((row) => {
    if (row.model && row.model !== "Unknown") {
      models.add(row.model);
    }
  });

  return Array.from(models).sort((first, second) => first.localeCompare(second));
}

function normalizeModelFilter(value: string | undefined) {
  return value?.trim().toLowerCase() ?? "";
}
