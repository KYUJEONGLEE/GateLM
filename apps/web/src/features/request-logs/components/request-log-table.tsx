import { Search } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { formatDisplayIdentifier } from "@/lib/formatting/display-identifiers";
import {
  formatDateTime,
  formatInteger,
  formatLatency,
  nullableText
} from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";
import { RequestLogDetailAnchor } from "./request-log-detail-anchor";

type RequestLogTableProps = {
  applicationOptions: string[];
  budgetScopeIdOptions: string[];
  detailPanel?: ReactNode;
  filters: RequestLogFilterState;
  locale: Locale;
  modelOptions: string[];
  providerOptions: string[];
  records: InvocationLogRecord[];
  resolvedByOptions: string[];
  selectedRequestId?: string;
  sourceState: "ready" | "unavailable";
  tenantId: string;
  timezone: string;
};

export const requestLogCreatedFilters = ["15m", "1h", "24h", "7d"] as const;
export const requestLogStatusFilters = [
  "success",
  "blocked",
  "rate_limited",
  "failed",
  "cancelled"
] as const satisfies readonly InvocationLogRecord["status"][];
export const requestLogCacheStatusFilters = ["hit", "miss", "bypass"] as const;
export const requestLogBudgetScopeTypeFilters = ["application", "project", "team"] as const;

export type RequestLogCreatedFilter = (typeof requestLogCreatedFilters)[number];
export type RequestLogFilterState = {
  applicationId: string;
  budgetScopeId: string;
  budgetScopeType: "" | (typeof requestLogBudgetScopeTypeFilters)[number];
  cacheStatus: "" | (typeof requestLogCacheStatusFilters)[number];
  created: RequestLogCreatedFilter;
  model: string;
  provider: string;
  requestId: string;
  resolvedBy: string;
  status: "" | InvocationLogRecord["status"];
};

const requestLogText: Record<
  Locale,
  {
    allModels: string;
    allProviders: string;
    allCacheStatuses: string;
    allApplications: string;
    allBudgetScopeTypes: string;
    allBudgetScopeIds: string;
    allResolvedBy: string;
    applicationLabel: string;
    budgetScopeIdLabel: string;
    budgetScopeTypeLabel: string;
    cacheLabel: string;
    allStatuses: string;
    createdLabel: string;
    createdOptions: Record<RequestLogCreatedFilter, string>;
    emptyPreview: string;
    filterLabel: string;
    kicker: string;
    modelLabel: string;
    providerLabel: string;
    searchLabel: string;
    searchPlaceholder: string;
    statusLabel: string;
    submitLabel: string;
    title: string;
  }
> = {
  en: {
    allApplications: "All applications",
    allBudgetScopeIds: "All budget scopes",
    allBudgetScopeTypes: "All scope types",
    allCacheStatuses: "All cache states",
    allModels: "All models",
    allProviders: "All providers",
    allResolvedBy: "All resolution sources",
    allStatuses: "All statuses",
    applicationLabel: "Application",
    budgetScopeIdLabel: "Budget scope",
    budgetScopeTypeLabel: "Scope type",
    cacheLabel: "Cache",
    createdLabel: "Created",
    createdOptions: {
      "15m": "Last 15m",
      "1h": "Last 1h",
      "24h": "Last 24h",
      "7d": "Last 7d"
    },
    emptyPreview: "No preview stored",
    filterLabel: "Log filters",
    kicker: "analytics",
    modelLabel: "Model",
    providerLabel: "Provider",
    searchLabel: "Search logs",
    searchPlaceholder: "Search by requestId",
    statusLabel: "Status",
    submitLabel: "Search",
    title: "Request logs"
  },
  ko: {
    allApplications: "전체 Application",
    allBudgetScopeIds: "전체 Budget scope",
    allBudgetScopeTypes: "전체 Scope type",
    allCacheStatuses: "전체 캐시 상태",
    allModels: "전체 모델",
    allProviders: "전체 Provider",
    allResolvedBy: "전체 결정 경로",
    allStatuses: "전체 상태",
    applicationLabel: "Application",
    budgetScopeIdLabel: "Budget scope",
    budgetScopeTypeLabel: "Scope type",
    cacheLabel: "Cache",
    createdLabel: "생성 시각",
    createdOptions: {
      "15m": "최근 15분",
      "1h": "최근 1시간",
      "24h": "최근 24시간",
      "7d": "최근 7일"
    },
    emptyPreview: "저장된 preview 없음",
    filterLabel: "로그 필터",
    kicker: "분석",
    modelLabel: "모델",
    providerLabel: "Provider",
    searchLabel: "로그 검색",
    searchPlaceholder: "requestId 검색",
    statusLabel: "상태",
    submitLabel: "검색",
    title: "요청 로그"
  }
};

export function RequestLogTable({
  applicationOptions,
  budgetScopeIdOptions,
  detailPanel,
  filters,
  locale,
  modelOptions,
  providerOptions,
  records,
  resolvedByOptions,
  selectedRequestId,
  sourceState,
  tenantId,
  timezone
}: RequestLogTableProps) {
  const text = requestLogText[locale];

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.kicker}</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      <RequestLogDetailAnchor>
        <section className="request-log-workspace" data-detail={detailPanel ? "open" : "closed"}>
          <div className="console-panel request-log-list-panel">
            <form action={`/tenants/${tenantId}/request-logs`} className="request-log-filter-bar">
              <div className="request-log-search-shell">
                <input
                  aria-label={text.searchLabel}
                  defaultValue={filters.requestId}
                  name="requestId"
                  placeholder={text.searchPlaceholder}
                  type="search"
                />
                <button aria-label={text.submitLabel} className="request-log-search-button" type="submit">
                  <Search aria-hidden="true" size={18} strokeWidth={2.2} />
                </button>
              </div>

              <div aria-label={text.filterLabel} className="request-log-filter-settings">
                <label className="request-log-filter-control">
                  <span>{text.statusLabel}</span>
                  <select defaultValue={filters.status} name="status">
                    <option value="">{text.allStatuses}</option>
                    {requestLogStatusFilters.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="request-log-filter-control">
                  <span>{text.modelLabel}</span>
                  <select defaultValue={filters.model} name="model">
                    <option value="">{text.allModels}</option>
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="request-log-filter-control">
                  <span>{text.providerLabel}</span>
                  <select defaultValue={filters.provider} name="provider">
                    <option value="">{text.allProviders}</option>
                    {providerOptions.map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="request-log-filter-control">
                  <span>{text.cacheLabel}</span>
                  <select defaultValue={filters.cacheStatus} name="cacheStatus">
                    <option value="">{text.allCacheStatuses}</option>
                    {requestLogCacheStatusFilters.map((cacheStatus) => (
                      <option key={cacheStatus} value={cacheStatus}>
                        {cacheStatus}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="request-log-filter-control">
                  <span>{text.applicationLabel}</span>
                  <select defaultValue={filters.applicationId} name="applicationId">
                    <option value="">{text.allApplications}</option>
                    {applicationOptions.map((applicationId) => (
                      <option key={applicationId} value={applicationId}>
                        {formatDisplayIdentifier(applicationId)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="request-log-filter-control">
                  <span>{text.budgetScopeTypeLabel}</span>
                  <select defaultValue={filters.budgetScopeType} name="budgetScopeType">
                    <option value="">{text.allBudgetScopeTypes}</option>
                    {requestLogBudgetScopeTypeFilters.map((scopeType) => (
                      <option key={scopeType} value={scopeType}>
                        {scopeType}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="request-log-filter-control">
                  <span>{text.budgetScopeIdLabel}</span>
                  <select defaultValue={filters.budgetScopeId} name="budgetScopeId">
                    <option value="">{text.allBudgetScopeIds}</option>
                    {budgetScopeIdOptions.map((budgetScopeId) => (
                      <option key={budgetScopeId} value={budgetScopeId}>
                        {formatDisplayIdentifier(budgetScopeId)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="request-log-filter-control">
                  <span>Resolved by</span>
                  <select defaultValue={filters.resolvedBy} name="resolvedBy">
                    <option value="">{text.allResolvedBy}</option>
                    {resolvedByOptions.map((resolvedBy) => (
                      <option key={resolvedBy} value={resolvedBy}>
                        {resolvedBy}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="request-log-filter-control">
                  <span>{text.createdLabel}</span>
                  <select defaultValue={filters.created} name="created">
                    {requestLogCreatedFilters.map((created) => (
                      <option key={created} value={created}>
                        {text.createdOptions[created]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </form>

            <div className="table-wrap">
              <table className="data-table request-table">
                <thead>
                  <tr>
                    <th>Request</th>
                    <th>Status</th>
                    <th>Model</th>
                    <th>Safety</th>
                    <th>Cache</th>
                    <th>Latency</th>
                    <th>Tokens</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceState === "unavailable" ? (
                    <tr>
                      <td colSpan={8}>Live Gateway request logs are not available right now.</td>
                    </tr>
                  ) : null}
                  {sourceState === "ready" && records.length === 0 ? (
                    <tr>
                      <td colSpan={8}>No Gateway request logs found for the current range.</td>
                    </tr>
                  ) : null}
                  {records.map((record) => {
                    const isSelected = selectedRequestId === record.requestId;

                    return (
                      <tr data-selected={isSelected ? "true" : undefined} key={record.requestId}>
                        <td>
                          <Link
                            className="request-link"
                            data-request-log-anchor
                            href={requestLogDetailHref(tenantId, record.requestId, filters)}
                            scroll={false}
                          >
                            {formatDisplayIdentifier(record.requestId)}
                          </Link>
                          <span>{nullableText(record.redactedPromptPreview, text.emptyPreview)}</span>
                        </td>
                        <td>
                          <StatusBadge status={record.status} />
                        </td>
                        <td>{nullableText(record.selectedModel, record.requestedModel ?? "not routed")}</td>
                        <td>{record.maskingAction}</td>
                        <td>
                          {record.cacheType}:{record.cacheStatus}
                        </td>
                        <td>{formatLatency(record.latencyMs)}</td>
                        <td>{formatInteger(record.totalTokens)}</td>
                        <td>{formatDateTime(record.createdAt, timezone)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          {detailPanel}
        </section>
      </RequestLogDetailAnchor>
    </main>
  );
}

function requestLogDetailHref(tenantId: string, requestId: string, filters: RequestLogFilterState) {
  const query = new URLSearchParams();
  appendRequestLogQuery(query, "applicationId", filters.applicationId);
  appendRequestLogQuery(query, "budgetScopeId", filters.budgetScopeId);
  appendRequestLogQuery(query, "budgetScopeType", filters.budgetScopeType);
  appendRequestLogQuery(query, "cacheStatus", filters.cacheStatus);
  if (filters.status) {
    query.set("status", filters.status);
  }
  if (filters.model) {
    query.set("model", filters.model);
  }
  appendRequestLogQuery(query, "provider", filters.provider);
  appendRequestLogQuery(query, "resolvedBy", filters.resolvedBy);
  if (filters.created !== "24h") {
    query.set("created", filters.created);
  }
  query.set("requestId", requestId);

  return `/tenants/${tenantId}/request-logs?${query.toString()}`;
}

function appendRequestLogQuery(query: URLSearchParams, key: string, value: string) {
  if (value) {
    query.set(key, value);
  }
}

export function StatusBadge({ status }: { status: InvocationLogRecord["status"] }) {
  return (
    <span className="status-badge" data-status={status}>
      {status}
    </span>
  );
}
