import { ConsoleShell } from "@/components/layout/console-shell";
import { RequestLogDetailAside } from "@/features/request-logs/components/request-log-detail";
import {
  type RequestLogCreatedFilter,
  type RequestLogFilterState,
  RequestLogTable,
  requestLogCreatedFilters,
  requestLogStatusFilters
} from "@/features/request-logs/components/request-log-table";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { getLiveGatewayRequestDetail } from "@/lib/gateway/live-request-detail";
import {
  getLiveGatewayRequestLogs,
  type LiveGatewayRequestLogFilters
} from "@/lib/gateway/live-request-logs";
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
    ? getLiveGatewayRequestLogs({ from: logFilters.from, limit: 100, to: logFilters.to })
    : Promise.resolve(undefined);
  const [locale, records, optionRecords, selectedDetail] = await Promise.all([
    getRequestLocale(),
    getLiveGatewayRequestLogs(logFilters),
    optionRecordsPromise,
    selectedRequestId ? getLiveGatewayRequestDetail(selectedRequestId) : Promise.resolve(null)
  ]);
  const scopedSelectedDetail =
    selectedDetail ?? (records ?? []).find((record) => record.requestId === selectedRequestId);
  const optionRecordsForFilters = optionRecords ?? records ?? [];
  const modelOptions = getModelOptions(optionRecordsForFilters, filters.model);
  const providerOptions = getProviderOptions(optionRecordsForFilters, filters.provider);
  const applicationOptions = getApplicationOptions(optionRecordsForFilters, filters.applicationId);
  const budgetScopeIdOptions = getBudgetScopeIdOptions(optionRecordsForFilters, filters.budgetScopeId);
  const resolvedByOptions = getResolvedByOptions(optionRecordsForFilters, filters.resolvedBy);

  return (
    <ConsoleShell
      activeAnalyticsItem="request-logs"
      activeSection="analytics"
      locale={locale}
      tenantId={tenantId}
    >
      <RequestLogTable
        detailPanel={
          scopedSelectedDetail ? (
            <RequestLogDetailAside
              locale={locale}
              record={scopedSelectedDetail}
              tenantId={tenantId}
              timezone="UTC"
            />
          ) : undefined
        }
        filters={filters}
        locale={locale}
        applicationOptions={applicationOptions}
        budgetScopeIdOptions={budgetScopeIdOptions}
        modelOptions={modelOptions}
        providerOptions={providerOptions}
        records={records ?? []}
        resolvedByOptions={resolvedByOptions}
        selectedRequestId={scopedSelectedDetail?.requestId}
        sourceState={records ? "ready" : "unavailable"}
        tenantId={tenantId}
        timezone="UTC"
      />
    </ConsoleShell>
  );
}

function buildRequestLogFilters(searchParams: Awaited<RequestLogsPageProps["searchParams"]>): {
  filters: RequestLogFilterState;
  logFilters: LiveGatewayRequestLogFilters;
} {
  const created = normalizeCreatedFilter(searchParams?.created);
  const status = normalizeStatusFilter(searchParams?.status);
  const model = normalizeOptionalText(searchParams?.model);
  const provider = normalizeOptionalText(searchParams?.provider);
  const cacheStatus = normalizeCacheStatusFilter(searchParams?.cacheStatus);
  const applicationId = normalizeOptionalText(searchParams?.applicationId);
  const budgetScopeType = normalizeBudgetScopeTypeFilter(searchParams?.budgetScopeType);
  const budgetScopeId = normalizeOptionalText(searchParams?.budgetScopeId);
  const resolvedBy = normalizeOptionalText(searchParams?.resolvedBy);
  const requestId = normalizeOptionalText(searchParams?.searchRequestId);
  const { from, to } = createdRange(created);

  return {
    filters: {
      applicationId,
      budgetScopeId,
      budgetScopeType,
      cacheStatus,
      created,
      model,
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
      limit: 50,
      model: model || undefined,
      provider: provider || undefined,
      requestId: requestId || undefined,
      resolvedBy: resolvedBy || undefined,
      status: status || undefined,
      to
    }
  };
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
    options.add(selectedModel);
  }

  records.forEach((record) => {
    const model = record.selectedModel ?? record.requestedModel;
    if (model) {
      options.add(model);
    }
  });

  return Array.from(options).sort((first, second) => first.localeCompare(second));
}

function getProviderOptions(records: InvocationLogRecord[], selectedProvider: string) {
  const options = new Set<string>();

  if (selectedProvider) {
    options.add(selectedProvider);
  }

  records.forEach((record) => {
    if (record.selectedProvider) {
      options.add(record.selectedProvider);
    }
  });

  return Array.from(options).sort((first, second) => first.localeCompare(second));
}

function getApplicationOptions(records: InvocationLogRecord[], selectedApplicationId: string) {
  const options = new Set<string>();

  if (selectedApplicationId) {
    options.add(selectedApplicationId);
  }

  records.forEach((record) => {
    if (record.applicationId) {
      options.add(record.applicationId);
    }
  });

  return Array.from(options).sort((first, second) => first.localeCompare(second));
}

function getBudgetScopeIdOptions(records: InvocationLogRecord[], selectedBudgetScopeId: string) {
  const options = new Set<string>();

  if (selectedBudgetScopeId) {
    options.add(selectedBudgetScopeId);
  }

  records.forEach((record) => {
    if (record.budgetScope.budgetScopeId) {
      options.add(record.budgetScope.budgetScopeId);
    }
  });

  return Array.from(options).sort((first, second) => first.localeCompare(second));
}

function getResolvedByOptions(records: InvocationLogRecord[], selectedResolvedBy: string) {
  const options = new Set<string>();

  if (selectedResolvedBy) {
    options.add(selectedResolvedBy);
  }

  records.forEach((record) => {
    if (record.budgetScope.resolvedBy) {
      options.add(record.budgetScope.resolvedBy);
    }
  });

  return Array.from(options).sort((first, second) => first.localeCompare(second));
}
