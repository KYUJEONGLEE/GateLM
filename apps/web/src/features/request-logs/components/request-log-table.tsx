import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  Database,
  Eye,
  RotateCw
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import { formatDisplayIdentifier } from "@/lib/formatting/display-identifiers";
import {
  formatInteger,
  formatLatency
} from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";
import { RequestLogDetailAnchor } from "./request-log-detail-anchor";
import {
  RequestLogFilterForm,
  RequestLogUnifiedSearch
} from "./request-log-filter-form";
import { StatusBadge } from "./request-log-status-badge";

type RequestLogTableProps = {
  allowAllProjects?: boolean;
  detailPanel?: ReactNode;
  employeeDirectory: Record<string, RequestLogEmployeeDisplay>;
  filters: RequestLogFilterState;
  locale: Locale;
  modelOptions: string[];
  projects?: ProjectRecord[];
  providerOptions: string[];
  records: InvocationLogRecord[];
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

export type RequestLogCreatedFilter = (typeof requestLogCreatedFilters)[number];
export type RequestLogFilterState = {
  applicationId: string;
  cacheStatus: "" | (typeof requestLogCacheStatusFilters)[number];
  created: RequestLogCreatedFilter;
  model: string;
  page: number;
  projectId: string;
  provider: string;
  search: string;
  status: "" | InvocationLogRecord["status"];
};

export type RequestLogEmployeeDisplay = {
  department: string | null;
  email: string;
  employeeId: string;
  name: string;
  userId: string | null;
};

const requestLogText: Record<
  Locale,
  {
    allModels: string;
    allProviders: string;
    allCacheStatuses: string;
    cacheLabel: string;
    allStatuses: string;
    createdLabel: string;
    createdOptions: Record<RequestLogCreatedFilter, string>;
    emptyPreview: string;
    filterLabel: string;
    modelLabel: string;
    nextPage: string;
    pageSummary: string;
    previousPage: string;
    providerLabel: string;
    rangeEndLabel: string;
    refreshLabel: string;
    searchLabel: string;
    searchPlaceholder: string;
    statusLabel: string;
    summary: {
      blocked: string;
      countUnit: string;
      failed: string;
      successful: string;
      totalCost: string;
      totalRequests: string;
    };
    submitLabel: string;
    table: {
      actions: string;
      cost: string;
      empty: string;
      latency: string;
      model: string;
      name: string;
      project: string;
      status: string;
      time: string;
      unavailable: string;
    };
    title: string;
  }
> = {
  en: {
    allCacheStatuses: "All cache states",
    allModels: "All models",
    allProviders: "All providers",
    allStatuses: "All statuses",
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
    modelLabel: "Detailed model",
    nextPage: "Next",
    pageSummary: "Showing {start}-{end} of {total}",
    previousPage: "Previous",
    providerLabel: "Provider",
    rangeEndLabel: "End of logs in this range",
    refreshLabel: "Refresh",
    searchLabel: "Search logs",
    searchPlaceholder: "Project, department, employee, model",
    statusLabel: "Status",
    summary: {
      blocked: "Blocked",
      countUnit: "requests",
      failed: "Failed",
      successful: "Success",
      totalCost: "Total cost",
      totalRequests: "Total requests"
    },
    submitLabel: "Search",
    table: {
      actions: "Open detail",
      cost: "Cost",
      empty: "No Gateway request logs found for the current range.",
      latency: "Latency",
      model: "Model",
      name: "Name",
      project: "Project",
      status: "Status",
      time: "Time",
      unavailable: "Live Gateway request logs are not available right now."
    },
    title: "Live Logs"
  },
  ko: {
    allCacheStatuses: "전체 캐시 상태",
    allModels: "전체 모델",
    allProviders: "전체 Provider",
    allStatuses: "전체 상태",
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
    modelLabel: "상세 모델",
    nextPage: "다음",
    pageSummary: "{total}개 중 {start}-{end}개 표시",
    previousPage: "이전",
    providerLabel: "Provider",
    rangeEndLabel: "현재 범위의 마지막 로그",
    refreshLabel: "새로고침",
    searchLabel: "로그 검색",
    searchPlaceholder: "프로젝트, 부서, 직원, 모델 검색",
    statusLabel: "상태",
    summary: {
      blocked: "차단",
      countUnit: "건",
      failed: "실패",
      successful: "성공",
      totalCost: "총 비용",
      totalRequests: "전체 요청"
    },
    submitLabel: "검색",
    table: {
      actions: "상세 보기",
      cost: "비용",
      empty: "현재 범위에 Gateway 요청 로그가 없습니다.",
      latency: "지연 시간",
      model: "모델",
      name: "이름",
      project: "프로젝트",
      status: "상태",
      time: "요청 시각",
      unavailable: "현재 Gateway 요청 로그를 불러올 수 없습니다."
    },
    title: "실시간 로그"
  }
};

export function RequestLogTable({
  allowAllProjects = true,
  detailPanel,
  employeeDirectory = {},
  filters,
  locale,
  modelOptions,
  projects = [],
  providerOptions = [],
  records,
  selectedRequestId,
  sourceState,
  tenantId,
  timezone
}: RequestLogTableProps) {
  const text = requestLogText[locale];
  const pageSize = 20;
  const totalRecords = records.length;
  const pageCount = Math.max(1, Math.ceil(totalRecords / pageSize));
  const currentPage = Math.min(Math.max(filters.page, 1), pageCount);
  const pageStartIndex = (currentPage - 1) * pageSize;
  const pageRecords = records.slice(pageStartIndex, pageStartIndex + pageSize);
  const displayStart = totalRecords === 0 ? 0 : pageStartIndex + 1;
  const displayEnd = Math.min(pageStartIndex + pageSize, totalRecords);
  const pageSummary = text.pageSummary
    .replace("{start}", String(displayStart))
    .replace("{end}", String(displayEnd))
    .replace("{total}", String(totalRecords));
  const summaryItems = buildRequestLogSummaryItems(records, text.summary);
  const refreshHref = requestLogPageHref(tenantId, filters, currentPage);
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <main className="console-content request-log-screen">
      <section className="request-log-hero">
        <div>
          <h2>{text.title}</h2>
        </div>
      </section>

      <RequestLogDetailAnchor>
        <section className="request-log-workspace" data-detail={selectedRequestId ? "open" : "closed"}>
          <div className="request-log-list-panel">
            <section className="request-log-summary-strip" aria-label="Request log summary">
              {summaryItems.map((item) => (
                <article className="request-log-summary-item" data-tone={item.tone} key={item.label}>
                  <span className="request-log-summary-icon">{item.icon}</span>
                  <div>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    {item.detail ? <em>{item.detail}</em> : null}
                  </div>
                </article>
              ))}
            </section>

            <RequestLogFilterForm action={`/tenants/${tenantId}/request-logs`}>
              <input name="page" type="hidden" value="1" />
              {filters.applicationId ? (
                <input name="applicationId" type="hidden" value={filters.applicationId} />
              ) : null}

              <div aria-label={text.filterLabel} className="request-log-filter-settings">
                <label className="request-log-filter-control request-log-filter-control-status">
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

                <label className="request-log-filter-control request-log-filter-control-provider">
                  <span>Provider</span>
                  <select defaultValue={filters.provider} name="provider">
                    <option value="">{text.allProviders}</option>
                    {providerOptions.map((provider) => (
                      <option key={provider} value={provider}>
                        {provider}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="request-log-filter-control request-log-filter-control-model">
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

                <label className="request-log-filter-control request-log-filter-control-project">
                  <span>Project</span>
                  <select defaultValue={filters.projectId} name="projectId">
                    {allowAllProjects ? <option value="">All projects</option> : null}
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="request-log-filter-control request-log-filter-control-cache">
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

                <label className="request-log-filter-control request-log-filter-control-created">
                  <span>{text.createdLabel}</span>
                  <select defaultValue={filters.created} name="created">
                    {requestLogCreatedFilters.map((created) => (
                      <option key={created} value={created}>
                        {text.createdOptions[created]}
                      </option>
                    ))}
                  </select>
                </label>

                <RequestLogUnifiedSearch
                  defaultValue={filters.search}
                  label={text.searchLabel}
                  placeholder={text.searchPlaceholder}
                  submitLabel={text.submitLabel}
                />
                <Link
                  aria-label={text.refreshLabel}
                  className="request-log-refresh-button"
                  href={refreshHref}
                  title={text.refreshLabel}
                >
                  <RotateCw aria-hidden="true" size={18} strokeWidth={2.2} />
                </Link>
              </div>

              <div className="request-log-pagination">
                <Link
                  aria-disabled={currentPage <= 1}
                  aria-label={text.previousPage}
                  className="request-log-page-link"
                  data-disabled={currentPage <= 1}
                  href={requestLogPageHref(tenantId, filters, currentPage - 1)}
                >
                  <ChevronLeft aria-hidden="true" size={18} strokeWidth={2.4} />
                </Link>
                <span>{pageSummary}</span>
                <Link
                  aria-disabled={currentPage >= pageCount}
                  aria-label={text.nextPage}
                  className="request-log-page-link"
                  data-disabled={currentPage >= pageCount}
                  href={requestLogPageHref(tenantId, filters, currentPage + 1)}
                >
                  <ChevronRight aria-hidden="true" size={18} strokeWidth={2.4} />
                </Link>
              </div>
            </RequestLogFilterForm>

            <div className="table-wrap">
              <table className="data-table request-table">
                <thead>
                  <tr>
                    <th>{text.table.time}</th>
                    <th>{text.table.name}</th>
                    <th>{text.table.project}</th>
                    <th>{text.table.model}</th>
                    <th>{text.table.status}</th>
                    <th>{text.table.latency}</th>
                    <th>{text.table.cost}</th>
                    <th aria-label={text.table.actions} />
                  </tr>
                </thead>
                <tbody>
                  {sourceState === "unavailable" ? (
                    <tr>
                      <td colSpan={8}>{text.table.unavailable}</td>
                    </tr>
                  ) : null}
                  {sourceState === "ready" && records.length === 0 ? (
                    <tr>
                      <td colSpan={8}>{text.table.empty}</td>
                    </tr>
                  ) : null}
                  {pageRecords.map((record) => {
                    const isSelected = selectedRequestId === record.requestId;
                    const detailHref = requestLogDetailHref(tenantId, record.requestId, filters);
                    const displayRequestId = formatDisplayIdentifier(record.requestId);
                    const projectName = projectNameById.get(record.projectId) ?? formatDisplayIdentifier(record.projectId);
                    const employee = record.endUserId
                      ? employeeDirectory[record.endUserId.trim().toLocaleLowerCase()]
                      : undefined;

                    return (
                      <tr data-selected={isSelected ? "true" : undefined} key={record.requestId}>
                        <td className="request-log-time-cell">
                          {formatShortTime(record.createdAt, timezone)}
                        </td>
                        <td>
                          {record.endUserId ? (
                            <span className="request-log-name-cell" title={record.endUserId}>
                              <strong>{employee?.name || formatDisplayIdentifier(record.endUserId)}</strong>
                              {employee?.department ? <small>{employee.department}</small> : null}
                            </span>
                          ) : (
                            <span className="request-log-muted-value">-</span>
                          )}
                        </td>
                        <td>
                          <span
                            className="request-log-project-pill"
                            data-project-tone={projectTone(record.projectId || projectName)}
                            title={record.projectId}
                          >
                            {projectName}
                          </span>
                        </td>
                        <td>
                          <ProviderModelCell
                            model={record.selectedModel ?? record.requestedModel}
                            provider={record.selectedProvider ?? record.requestedProvider}
                          />
                        </td>
                        <td>
                          <StatusBadge label={formatHttpStatus(record)} status={record.status} />
                        </td>
                        <td>{formatLatency(record.latencyMs)}</td>
                        <td>{formatMicroUsd(record.costMicroUsd)}</td>
                        <td className="request-log-action-cell">
                          <Link
                            aria-label={`${text.table.actions}: ${displayRequestId}`}
                            className="request-log-action-link"
                            data-request-log-anchor
                            data-request-log-project-id={record.projectId}
                            data-request-log-request-id={record.requestId}
                            href={detailHref}
                            scroll={false}
                          >
                            <Eye aria-hidden="true" size={16} strokeWidth={2.3} />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="request-log-list-end" role="status">
              <span>{text.rangeEndLabel}</span>
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
  appendRequestLogQuery(query, "cacheStatus", filters.cacheStatus);
  if (filters.status) {
    query.set("status", filters.status);
  }
  appendRequestLogQuery(query, "search", filters.search);
  if (filters.model) {
    query.set("model", filters.model);
  }
  if (filters.page > 1) {
    query.set("page", String(filters.page));
  }
  appendRequestLogQuery(query, "provider", filters.provider);
  appendRequestLogQuery(query, "projectId", filters.projectId);
  if (filters.created !== "24h") {
    query.set("created", filters.created);
  }
  query.set("requestId", requestId);

  return `/tenants/${tenantId}/request-logs?${query.toString()}`;
}

function requestLogPageHref(
  tenantId: string,
  filters: RequestLogFilterState,
  page: number
) {
  const query = new URLSearchParams();
  appendRequestLogQuery(query, "applicationId", filters.applicationId);
  appendRequestLogQuery(query, "cacheStatus", filters.cacheStatus);
  appendRequestLogQuery(query, "model", filters.model);
  appendRequestLogQuery(query, "provider", filters.provider);
  appendRequestLogQuery(query, "projectId", filters.projectId);
  appendRequestLogQuery(query, "search", filters.search);
  appendRequestLogQuery(query, "status", filters.status);
  if (filters.created !== "24h") {
    query.set("created", filters.created);
  }
  if (page > 1) {
    query.set("page", String(page));
  }

  return `/tenants/${tenantId}/request-logs?${query.toString()}`;
}

function appendRequestLogQuery(query: URLSearchParams, key: string, value: string) {
  if (value) {
    query.set(key, value);
  }
}

function ProviderModelCell({
  model,
  provider
}: {
  model: string | null | undefined;
  provider: string | null | undefined;
}) {
  const normalized = normalizeProvider(provider);
  const providerName = providerLabel(normalized, provider);
  const modelName = model?.trim() || "not routed";

  return (
    <span className="request-log-provider-model" title={`${providerName} · ${modelName}`}>
      <ProviderFamilyIcon
        className="request-log-provider-icon"
        family={providerFamily(normalized)}
        size={24}
      />
      <strong>{modelName}</strong>
    </span>
  );
}

function normalizeProvider(provider: string | null | undefined) {
  const normalized = provider?.trim().toLowerCase() ?? "";

  if (normalized.includes("openai")) {
    return "openai";
  }
  if (normalized.includes("anthropic") || normalized.includes("claude")) {
    return "anthropic";
  }
  if (normalized.includes("gemini") || normalized.includes("google")) {
    return "gemini";
  }
  if (normalized.includes("mock")) {
    return "mock";
  }

  return "unknown";
}

function providerLabel(normalized: string, provider: string | null | undefined) {
  if (normalized === "openai") {
    return "OpenAI";
  }
  if (normalized === "anthropic") {
    return "Anthropic";
  }
  if (normalized === "gemini") {
    return "Gemini";
  }
  if (normalized === "mock") {
    return "Mock";
  }

  return provider?.trim() ? formatDisplayIdentifier(provider) : "Unknown";
}

function providerFamily(provider: string) {
  if (provider === "anthropic") {
    return "claude";
  }

  if (provider === "gemini") {
    return "gemini";
  }

  if (provider === "mock") {
    return "mock";
  }

  return provider === "openai" ? "openai" : "new-provider";
}

function projectTone(value: string) {
  return String(stableHash(value) % 8);
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildRequestLogSummaryItems(
  records: InvocationLogRecord[],
  text: (typeof requestLogText)[Locale]["summary"]
) {
  const summary = records.reduce(
    (accumulator, record) => {
      accumulator.totalRequests += 1;
      accumulator.totalCostMicroUsd += record.costMicroUsd;

      if (record.status === "success") {
        accumulator.successfulRequests += 1;
      } else if (record.status === "blocked" || record.status === "rate_limited") {
        accumulator.blockedRequests += 1;
      } else if (record.status === "failed" || record.status === "cancelled") {
        accumulator.failedRequests += 1;
      }

      return accumulator;
    },
    {
      blockedRequests: 0,
      failedRequests: 0,
      successfulRequests: 0,
      totalCostMicroUsd: 0,
      totalRequests: 0
    }
  );
  const successRate = safeRatio(summary.successfulRequests, summary.totalRequests);
  const blockedRate = safeRatio(summary.blockedRequests, summary.totalRequests);
  const failedRate = safeRatio(summary.failedRequests, summary.totalRequests);

  return [
    {
      detail: text.countUnit,
      icon: <CheckCircle2 aria-hidden="true" size={20} strokeWidth={2.3} />,
      label: text.totalRequests,
      tone: "total",
      value: formatInteger(summary.totalRequests)
    },
    {
      detail: `${text.countUnit} (${formatPercent(successRate)})`,
      icon: <CheckCircle2 aria-hidden="true" size={20} strokeWidth={2.3} />,
      label: text.successful,
      tone: "success",
      value: formatInteger(summary.successfulRequests)
    },
    {
      detail: `${text.countUnit} (${formatPercent(blockedRate)})`,
      icon: <AlertTriangle aria-hidden="true" size={20} strokeWidth={2.3} />,
      label: text.blocked,
      tone: "blocked",
      value: formatInteger(summary.blockedRequests)
    },
    {
      detail: `${text.countUnit} (${formatPercent(failedRate)})`,
      icon: <Database aria-hidden="true" size={20} strokeWidth={2.3} />,
      label: text.failed,
      tone: "failed",
      value: formatInteger(summary.failedRequests)
    },
    {
      detail: "",
      icon: <Coins aria-hidden="true" size={20} strokeWidth={2.3} />,
      label: text.totalCost,
      tone: "cost",
      value: formatMicroUsd(summary.totalCostMicroUsd)
    }
  ];
}

function safeRatio(numerator: number, denominator: number) {
  return denominator > 0 ? numerator / denominator : 0;
}

function formatPercent(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
    style: "percent"
  }).format(value);
}

function formatMicroUsd(value: number) {
  const dollars = value / 1_000_000;

  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: dollars > 0 && dollars < 1 ? 6 : 2,
    minimumFractionDigits: 2,
    style: "currency"
  }).format(dollars);
}

function formatHttpStatus(record: InvocationLogRecord) {
  if (record.httpStatus >= 200 && record.httpStatus < 300) {
    return `${record.httpStatus} OK`;
  }
  if (record.httpStatus === 400) {
    return "400 Bad Request";
  }
  if (record.httpStatus === 401) {
    return "401 Unauthorized";
  }
  if (record.httpStatus === 403) {
    return "403 Forbidden";
  }
  if (record.httpStatus === 404) {
    return "404 Not Found";
  }
  if (record.httpStatus === 408) {
    return "408 Timeout";
  }
  if (record.httpStatus === 429) {
    return "429 Rate Limited";
  }
  if (record.httpStatus === 500) {
    return "500 Error";
  }
  if (record.httpStatus === 502) {
    return "502 Bad Gateway";
  }
  if (record.httpStatus === 503) {
    return "503 Unavailable";
  }
  if (record.httpStatus > 0) {
    return String(record.httpStatus);
  }

  return record.status;
}

function formatShortTime(value: string | null | undefined, timezone: string) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hour12: false,
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
    timeZone: timezone
  }).format(date);
}
