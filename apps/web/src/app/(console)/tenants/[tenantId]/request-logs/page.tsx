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
    created?: string;
    model?: string;
    requestId?: string;
    status?: string;
  }>;
};

export default async function RequestLogsPage({ params, searchParams }: RequestLogsPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const selectedRequestId = resolvedSearchParams?.requestId;
  const { filters, logFilters } = buildRequestLogFilters(resolvedSearchParams);
  const shouldLoadUnfilteredModels = Boolean(filters.status || filters.model);
  const modelOptionRecordsPromise = shouldLoadUnfilteredModels
    ? getLiveGatewayRequestLogs({ from: logFilters.from, limit: 100, to: logFilters.to })
    : Promise.resolve(undefined);
  const [locale, records, modelOptionRecords, selectedDetail] = await Promise.all([
    getRequestLocale(),
    getLiveGatewayRequestLogs(logFilters),
    modelOptionRecordsPromise,
    selectedRequestId ? getLiveGatewayRequestDetail(selectedRequestId) : Promise.resolve(null)
  ]);
  const scopedSelectedDetail =
    selectedDetail ?? (records ?? []).find((record) => record.requestId === selectedRequestId);
  const modelOptions = getModelOptions(modelOptionRecords ?? records ?? [], filters.model);

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
        modelOptions={modelOptions}
        records={records ?? []}
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
  const { from, to } = createdRange(created);

  return {
    filters: {
      created,
      model,
      status
    },
    logFilters: {
      from,
      limit: 50,
      model: model || undefined,
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

function normalizeOptionalText(value: string | undefined) {
  return value?.trim() ?? "";
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
