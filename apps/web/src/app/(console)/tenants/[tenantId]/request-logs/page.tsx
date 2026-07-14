import { notFound } from "next/navigation";
import {
  getCurrentConsoleAuth,
  getProjectAdminProjectIdsForTenant,
  getVisibleProjectsForConsoleAuth,
  isProjectScopedForTenant,
  resolveConsoleTenantIdForAuth,
  resolveProjectIdForConsoleAuth
} from "@/lib/auth/current-console-auth";
import { RequestLogDetailClient } from "@/features/request-logs/components/request-log-detail-client";
import {
  type RequestLogCreatedFilter,
  type RequestLogEmployeeDisplay,
  type RequestLogFilterState,
  RequestLogTable,
  requestLogCreatedFilters,
  requestLogStatusFilters
} from "@/features/request-logs/components/request-log-table";
import { DEFAULT_DISPLAY_TIMEZONE } from "@/lib/formatting/formatters";
import {
  getLiveGatewayRequestLogsWithMeta,
  type LiveGatewayRequestLogFilterOptions,
  type LiveGatewayRequestLogFilters
} from "@/lib/gateway/live-request-logs";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import { getTenantEmployees } from "@/lib/control-plane/employees-client";
import { resolveControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import { listTenantProviderConnections } from "@/lib/control-plane/provider-connections-client";
import { buildProviderDisplayDirectory } from "@/lib/control-plane/provider-display";
import type { EmployeeRecord } from "@/lib/control-plane/employees-types";
import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";
import { normalizeRequestLogSafetyOutcomeFilter } from "@/lib/gateway/request-log-safety-filter";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type RequestLogsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
  searchParams?: Promise<{
    applicationId?: string;
    cacheStatus?: string;
    created?: string;
    latest?: string;
    model?: string;
    page?: string;
    projectId?: string;
    requestId?: string;
    search?: string;
    searchRequestId?: string;
    safetyOutcome?: string;
    status?: string;
  }>;
};

export default async function RequestLogsPage({ params, searchParams }: RequestLogsPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const explicitSelectedRequestId = normalizeOptionalText(resolvedSearchParams?.requestId);
  const shouldSelectLatestProjectRequest = resolvedSearchParams?.latest === "project";
  const { filters, logFilters } = buildRequestLogFilters(resolvedSearchParams);
  const [locale, auth] = await Promise.all([
    getRequestLocale(),
    getCurrentConsoleAuth()
  ]);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, tenantId);
  const [projectsModel, employees, providerConnections] = await Promise.all([
    getProjectsModel(effectiveTenantId),
    getTenantEmployees(effectiveTenantId),
    listTenantProviderConnections(resolveControlPlaneTenantId(effectiveTenantId))
  ]);
  const projectScoped = isProjectScopedForTenant(auth, effectiveTenantId);
  const allowedProjectIds = projectScoped ? getProjectAdminProjectIdsForTenant(auth, effectiveTenantId) : undefined;
  const scopedProjectIds = allowedProjectIds ?? projectsModel.projects.map((project) => project.id).filter(Boolean);
  const effectiveProjectId = resolveProjectIdForConsoleAuth({
    auth,
    projects: projectsModel.projects,
    requestedProjectId: logFilters.projectId,
    routeTenantId: effectiveTenantId
  });

  if (effectiveProjectId === null) {
    notFound();
  }

  const scopedFilters: RequestLogFilterState = {
    ...filters,
    projectId: effectiveProjectId ?? filters.projectId
  };
  const scopedLogFilters: LiveGatewayRequestLogFilters = {
    ...logFilters,
    projectId: effectiveProjectId ?? logFilters.projectId,
    projectIds: scopedProjectIds
  };
  const visibleProjects = getVisibleProjectsForConsoleAuth(projectsModel.projects, auth, effectiveTenantId)
    .filter((project) => project.status !== "ARCHIVED");
  const logsResult = await getLiveGatewayRequestLogsWithMeta({
    ...scopedLogFilters,
    tenantId: effectiveTenantId
  });
  const rawRecords = logsResult?.records;
  const employeeDirectory = buildRequestLogEmployeeDirectory(employees);
  const providerDirectory = buildProviderDisplayDirectory(
    providerConnections.ok ? providerConnections.data : []
  );
  const projectNamesById = new Map(
    visibleProjects.map((project) => [project.id, project.name] as const)
  );
  const records = rawRecords
    ? filterRequestLogRecords(rawRecords, scopedFilters, projectNamesById, employeeDirectory)
    : undefined;
  const latestSelectedRecord = shouldSelectLatestProjectRequest ? (records ?? [])[0] : undefined;
  const selectedRequestId = explicitSelectedRequestId || latestSelectedRecord?.requestId;
  const selectedRecord = selectedRequestId
    ? (records ?? []).find((record) => record.requestId === selectedRequestId) ?? latestSelectedRecord
    : undefined;
  const optionRecordsForFilters = rawRecords ?? [];
  const modelOptions = getModelOptions(
    optionRecordsForFilters,
    scopedFilters.model,
    logsResult?.filterOptions
  );
  const displayRecords = records ?? [];
  const fallbackSelectedRecord = selectedRecord;

  return (
    <RequestLogTable
      detailPanel={
        <RequestLogDetailClient
          initialProjectId={selectedRecord?.projectId ?? scopedLogFilters.projectId}
          initialRecord={fallbackSelectedRecord}
          initialRequestId={selectedRequestId || undefined}
          locale={locale}
          providerDirectory={providerDirectory}
          records={displayRecords}
          tenantId={effectiveTenantId}
          timezone={DEFAULT_DISPLAY_TIMEZONE}
        />
      }
      allowAllProjects={!projectScoped}
      employeeDirectory={employeeDirectory}
      filters={scopedFilters}
      locale={locale}
      modelOptions={modelOptions}
      projects={visibleProjects}
      providerDirectory={providerDirectory}
      records={displayRecords}
      selectedRequestId={selectedRequestId || undefined}
      sourceState={records ? "ready" : "unavailable"}
      tenantId={effectiveTenantId}
      timezone={DEFAULT_DISPLAY_TIMEZONE}
    />
  );
}

function buildRequestLogFilters(searchParams: Awaited<RequestLogsPageProps["searchParams"]>): {
  filters: RequestLogFilterState;
  logFilters: LiveGatewayRequestLogFilters;
} {
  const created = normalizeCreatedFilter(searchParams?.created);
  const status = normalizeStatusFilter(searchParams?.status);
  const model = normalizeModelFilter(searchParams?.model);
  const projectId = normalizeOptionalText(searchParams?.projectId);
  const cacheStatus = normalizeCacheStatusFilter(searchParams?.cacheStatus);
  const applicationId = normalizeOptionalText(searchParams?.applicationId);
  const search = normalizeOptionalText(searchParams?.search ?? searchParams?.searchRequestId);
  const safetyOutcome = normalizeRequestLogSafetyOutcomeFilter(searchParams?.safetyOutcome);
  const page = normalizePage(searchParams?.page);
  const { from, to } = createdRange(created);

  return {
    filters: {
      applicationId,
      cacheStatus,
      created,
      model,
      page,
      projectId,
      safetyOutcome,
      search,
      status
    },
    logFilters: {
      applicationId: applicationId || undefined,
      cacheStatus: cacheStatus || undefined,
      from,
      limit: search || model ? 1000 : 100,
      projectId: projectId || undefined,
      safetyOutcome: safetyOutcome || undefined,
      status: status || undefined,
      to
    }
  };
}

function normalizePage(value: string | undefined) {
  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

function normalizeCreatedFilter(value: string | undefined): RequestLogCreatedFilter {
  if (requestLogCreatedFilters.includes(value as RequestLogCreatedFilter)) {
    return value as RequestLogCreatedFilter;
  }

  return "24h";
}

function normalizeStatusFilter(value: string | undefined): RequestLogFilterState["status"] {
  const status = value as (typeof requestLogStatusFilters)[number];
  if (requestLogStatusFilters.includes(status)) {
    return status;
  }

  return "";
}

function normalizeCacheStatusFilter(value: string | undefined): RequestLogFilterState["cacheStatus"] {
  if (value === "hit" || value === "miss" || value === "bypass") {
    return value;
  }

  return "";
}

function normalizeOptionalText(value: string | undefined) {
  return value?.trim() ?? "";
}

function normalizeModelFilter(value: string | undefined) {
  return normalizeOptionalText(value);
}

function createdRange(created: RequestLogCreatedFilter) {
  const durationMs: Record<RequestLogCreatedFilter, number> = {
    "15m": 15 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000
  };
  const to = new Date();
  const from = new Date(to.getTime() - durationMs[created]);

  return {
    from: from.toISOString(),
    to: to.toISOString()
  };
}

function getModelOptions(
  records: LiveInvocationLogRecord[],
  modelFilter: string,
  filterOptions: LiveGatewayRequestLogFilterOptions | undefined
) {
  const options = new Set<string>();

  if (modelFilter) {
    options.add(modelFilter);
  }

  records.forEach((record) => {
    const model = displayedModel(record);
    if (model && model !== "auto") {
      options.add(model);
    }
  });

  if (options.size === 0) {
    (filterOptions?.requestedModels ?? [])
      .filter((model) => model !== "auto")
      .forEach((model) => options.add(model));
  }

  return Array.from(options).sort((first, second) => first.localeCompare(second));
}

function buildRequestLogEmployeeDirectory(
  employees: EmployeeRecord[]
): Record<string, RequestLogEmployeeDisplay> {
  const directory: Record<string, RequestLogEmployeeDisplay> = {};

  employees.forEach((employee) => {
    const display: RequestLogEmployeeDisplay = {
      department: employee.department?.trim() || null,
      email: employee.email,
      employeeId: employee.id,
      name: employee.name?.trim() || employee.email,
      userId: employee.userId
    };

    [employee.id, employee.userId, employee.email].forEach((alias) => {
      if (alias) {
        directory[normalizeSearchValue(alias)] = display;
      }
    });
  });

  return directory;
}

function filterRequestLogRecords(
  records: LiveInvocationLogRecord[],
  filters: RequestLogFilterState,
  projectNamesById: Map<string, string>,
  employeeDirectory: Record<string, RequestLogEmployeeDisplay>
) {
  const search = normalizeSearchValue(filters.search);

  return records.filter((record) => {
    const model = displayedModel(record);
    if (filters.model && !valuesMatch(model, filters.model)) {
      return false;
    }

    if (!search) {
      return true;
    }

    const employee = record.endUserId
      ? employeeDirectory[normalizeSearchValue(record.endUserId)]
      : undefined;
    const candidates = [
      record.requestId,
      record.traceId,
      record.projectId,
      projectNamesById.get(record.projectId),
      record.applicationId,
      record.endUserId,
      employee?.employeeId,
      employee?.userId,
      employee?.name,
      employee?.email,
      employee?.department,
      record.requestedModel,
      record.category,
      record.difficulty,
      record.modelRef,
      record.routingReason,
      record.status,
      record.cacheStatus,
      JSON.stringify(record),
      record.budgetScope.budgetScopeType,
      record.budgetScope.budgetScopeId,
      record.budgetScope.resolvedBy
    ];

    return candidates.some((value) => normalizeSearchValue(value).includes(search));
  });
}

function displayedModel(record: LiveInvocationLogRecord) {
  return record.providerAttempt?.modelId ?? record.requestedModel ?? "";
}

function valuesMatch(first: string, second: string) {
  return normalizeSearchValue(first) === normalizeSearchValue(second);
}

function normalizeSearchValue(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase() ?? "";
}
