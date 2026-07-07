import { ConsoleShell } from "@/components/layout/console-shell";
import { RequestLogDetailAside } from "@/features/request-logs/components/request-log-detail";
import {
  type RequestLogCreatedFilter,
  type RequestLogBudgetScopeOption,
  type RequestLogFilterState,
  RequestLogTable,
  requestLogCreatedFilters,
  requestLogStatusFilters
} from "@/features/request-logs/components/request-log-table";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { DEFAULT_DISPLAY_TIMEZONE } from "@/lib/formatting/formatters";
import { getLiveGatewayRequestDetail } from "@/lib/gateway/live-request-detail";
import {
  getLiveGatewayRequestLogs,
  type LiveGatewayRequestLogFilters
} from "@/lib/gateway/live-request-logs";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import { getRequestLocale } from "@/lib/i18n/server-locale";

type RequestLogsPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
  searchParams?: Promise<{
    applicationId?: string;
    budgetScopeId?: string;
    budgetScopeType?: string;
    cacheStatus?: string;
    created?: string;
    model?: string;
    page?: string;
    provider?: string;
    requestId?: string;
    resolvedBy?: string;
    searchRequestId?: string;
    status?: string;
  }>;
};

export default async function RequestLogsPage({ params, searchParams }: RequestLogsPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const selectedRequestId = resolvedSearchParams?.requestId;
  const { filters, logFilters } = buildRequestLogFilters(resolvedSearchParams);
  const shouldLoadUnfilteredOptions = hasNarrowingFilters(filters);
  const optionRecordsPromise = shouldLoadUnfilteredOptions
    ? getLiveGatewayRequestLogs({ from: logFilters.from, limit: 100, tenantId, to: logFilters.to })
    : Promise.resolve(undefined);
  const [locale, records, optionRecords] = await Promise.all([
    getRequestLocale(),
    getLiveGatewayRequestLogs({ ...logFilters, tenantId }),
    optionRecordsPromise
  ]);
  const selectedRecord = selectedRequestId
    ? (records ?? []).find((record) => record.requestId === selectedRequestId)
    : undefined;
  const selectedDetail = selectedRequestId
    ? await getLiveGatewayRequestDetail(selectedRequestId, {
        projectId: selectedRecord?.projectId,
        tenantId
      })
    : null;
  const scopedSelectedDetail =
    selectedDetail ?? (records ?? []).find((record) => record.requestId === selectedRequestId);
  const optionRecordsForFilters = optionRecords ?? records ?? [];
  const modelOptions = getModelOptions(optionRecordsForFilters, filters.model);
  const budgetScopeOptions = getBudgetScopeOptions(optionRecordsForFilters, filters);
  const displayRecords = (records ?? []).map(toDisplayModelRecord);
  const displaySelectedDetail = scopedSelectedDetail ? toDisplayModelRecord(scopedSelectedDetail) : undefined;

  return (
    <ConsoleShell
      activeMonitoringItem="live-logs"
      activeSection="monitoring"
      locale={locale}
      tenantId={tenantId}
    >
      <RequestLogTable
        detailPanel={
          displaySelectedDetail ? (
            <RequestLogDetailAside
              locale={locale}
              record={displaySelectedDetail}
              tenantId={tenantId}
              timezone={DEFAULT_DISPLAY_TIMEZONE}
            />
          ) : undefined
        }
        filters={filters}
        locale={locale}
        budgetScopeOptions={budgetScopeOptions}
        modelOptions={modelOptions}
        records={displayRecords}
        selectedRequestId={displaySelectedDetail?.requestId}
        sourceState={records ? "ready" : "unavailable"}
        tenantId={tenantId}
        timezone={DEFAULT_DISPLAY_TIMEZONE}
      />
    </ConsoleShell>
  );
}

function toDisplayModelRecord(record: InvocationLogRecord): InvocationLogRecord {
  return {
    ...record,
    requestedModel: record.requestedModel ? formatModelDisplayName(record.requestedModel) : record.requestedModel,
    selectedModel: record.selectedModel ? formatModelDisplayName(record.selectedModel) : record.selectedModel
  };
}

function buildRequestLogFilters(searchParams: Awaited<RequestLogsPageProps["searchParams"]>): {
  filters: RequestLogFilterState;
  logFilters: LiveGatewayRequestLogFilters;
} {
  const created = normalizeCreatedFilter(searchParams?.created);
  const status = normalizeStatusFilter(searchParams?.status);
  const model = normalizeModelFilter(searchParams?.model);
  const provider = normalizeOptionalText(searchParams?.provider);
  const cacheStatus = normalizeCacheStatusFilter(searchParams?.cacheStatus);
  const applicationId = normalizeOptionalText(searchParams?.applicationId);
  const budgetScopeType = normalizeBudgetScopeTypeFilter(searchParams?.budgetScopeType);
  const budgetScopeId = normalizeOptionalText(searchParams?.budgetScopeId);
  const resolvedBy = normalizeOptionalText(searchParams?.resolvedBy);
  const requestId = normalizeOptionalText(searchParams?.searchRequestId);
  const page = normalizePage(searchParams?.page);
  const { from, to } = createdRange(created);

  return {
    filters: {
      applicationId,
      budgetScopeId,
      budgetScopeType,
      cacheStatus,
      created,
      model,
      page,
      provider,
      requestId,
      resolvedBy,
      status
    },
    logFilters: {
      applicationId: applicationId || undefined,
      budgetScopeId: budgetScopeId || undefined,
      budgetScopeType: budgetScopeType || undefined,
      cacheStatus: cacheStatus || undefined,
      from,
      limit: 100,
      model: model || undefined,
      provider: provider || undefined,
      requestId: requestId || undefined,
      resolvedBy: resolvedBy || undefined,
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

function normalizeBudgetScopeTypeFilter(
  value: string | undefined
): RequestLogFilterState["budgetScopeType"] {
  if (value === "application" || value === "project" || value === "team") {
    return value;
  }

  return "";
}

function normalizeOptionalText(value: string | undefined) {
  return value?.trim() ?? "";
}

function normalizeModelFilter(value: string | undefined) {
  const normalized = normalizeOptionalText(value);
  return normalized ? formatModelDisplayName(normalized, "") : "";
}

function hasNarrowingFilters(filters: RequestLogFilterState) {
  return Boolean(
    filters.applicationId ||
      filters.budgetScopeId ||
      filters.budgetScopeType ||
      filters.cacheStatus ||
      filters.model ||
      filters.provider ||
      filters.requestId ||
      filters.resolvedBy ||
      filters.status
  );
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

function getModelOptions(records: InvocationLogRecord[], selectedModel: string) {
  const options = new Set<string>();

  if (selectedModel) {
    options.add(formatModelDisplayName(selectedModel, ""));
  }

  records.forEach((record) => {
    const model = record.selectedModel ?? record.requestedModel;
    if (model) {
      options.add(formatModelDisplayName(model, ""));
    }
  });

  return Array.from(options).sort((first, second) => first.localeCompare(second));
}

function getBudgetScopeOptions(
  records: InvocationLogRecord[],
  filters: RequestLogFilterState
): RequestLogBudgetScopeOption[] {
  const options = new Map<string, RequestLogBudgetScopeOption>();

  records.forEach((record) => {
    const scopeType = normalizeBudgetScopeTypeFilter(record.budgetScope.budgetScopeType);
    const scopeId = record.budgetScope.budgetScopeId;

    if (!scopeType || !scopeId) {
      return;
    }

    options.set(`${scopeType}:${scopeId}`, {
      budgetScopeId: scopeId,
      budgetScopeType: scopeType
    });
  });

  if (filters.budgetScopeId && filters.budgetScopeType) {
    options.set(`${filters.budgetScopeType}:${filters.budgetScopeId}`, {
      budgetScopeId: filters.budgetScopeId,
      budgetScopeType: filters.budgetScopeType
    });
  }

  return Array.from(options.values()).sort((first, second) => {
    const typeOrder = first.budgetScopeType.localeCompare(second.budgetScopeType);
    return typeOrder || first.budgetScopeId.localeCompare(second.budgetScopeId);
  });
}
