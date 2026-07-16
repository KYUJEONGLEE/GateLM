import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Coins,
  Database,
  RotateCw
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import {
  resolveProviderDisplay,
  type ProviderDisplayDirectory
} from "@/lib/control-plane/provider-display";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";
import {
  type RequestLogSafetyOutcomeFilter,
  requestLogSafetyOutcomeFilters
} from "@/lib/gateway/request-log-safety-filter";
import {
  formatDisplayIdentifier,
  formatModelDisplayName
} from "@/lib/formatting/display-identifiers";
import {
  formatInteger,
  formatLatency
} from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";
import { formatRequestLogTtft } from "../request-log-latency";
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
  providerDirectory: ProviderDisplayDirectory;
  records: LiveInvocationLogRecord[];
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
] as const satisfies readonly LiveInvocationLogRecord["status"][];
export const requestLogCacheStatusFilters = ["hit", "miss", "bypass"] as const;

export type RequestLogCreatedFilter = (typeof requestLogCreatedFilters)[number];
export type RequestLogFilterState = {
  applicationId: string;
  cacheStatus: "" | (typeof requestLogCacheStatusFilters)[number];
  created: RequestLogCreatedFilter;
  model: string;
  page: number;
  projectId: string;
  safetyOutcome: "" | RequestLogSafetyOutcomeFilter;
  search: string;
  status: "" | LiveInvocationLogRecord["status"];
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
    rangeEndLabel: string;
    refreshLabel: string;
    safetyLabel: string;
    safetyOptions: Record<RequestLogSafetyOutcomeFilter, string>;
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
      totalLatency: string;
      ttft: string;
      unavailable: string;
    };
    title: string;
  }
> = {
  en: {
    allCacheStatuses: "All cache states",
    allModels: "All models",
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
    modelLabel: "Executed model",
    nextPage: "Next",
    pageSummary: "Showing {start}-{end} of {total}",
    previousPage: "Previous",
    rangeEndLabel: "End of logs in this range",
    refreshLabel: "Refresh",
    safetyLabel: "Safety",
    safetyOptions: {
      blocked: "Filtered / blocked",
      not_checked: "Not checked",
      passed: "Passed",
      redacted: "Masked"
    },
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
      totalLatency: "Total",
      ttft: "TTFT",
      unavailable: "Live Gateway request logs are not available right now."
    },
    title: "Live Logs"
  },
  ko: {
    allCacheStatuses: "전체 캐시 상태",
    allModels: "전체 모델",
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
    modelLabel: "실행 모델",
    nextPage: "다음",
    pageSummary: "{total}개 중 {start}-{end}개 표시",
    previousPage: "이전",
    rangeEndLabel: "현재 범위의 마지막 로그",
    refreshLabel: "새로고침",
    safetyLabel: "마스킹 / 필터링",
    safetyOptions: {
      blocked: "필터링(차단)",
      not_checked: "검사 안 함",
      passed: "통과",
      redacted: "마스킹"
    },
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
      totalLatency: "전체",
      ttft: "TTFT",
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
  providerDirectory,
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
                    <span className="request-log-summary-value">
                      <strong>{item.value}</strong>
                      {item.detail ? <em>{item.detail}</em> : null}
                    </span>
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

                <label className="request-log-filter-control request-log-filter-control-model">
                  <span>{text.modelLabel}</span>
                  <select defaultValue={filters.model} name="model">
                    <option value="">{text.allModels}</option>
                    {modelOptions.map((model) => (
                      <option key={model} value={model}>
                        {formatModelDisplayName(model)}
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

                <label className="request-log-filter-control request-log-filter-control-safety">
                  <span>{text.safetyLabel}</span>
                  <select defaultValue={filters.safetyOutcome} name="safetyOutcome">
                    <option value="">{locale === "ko" ? "전체 보호 처리" : "All safety outcomes"}</option>
                    {requestLogSafetyOutcomeFilters.map((outcome) => (
                      <option key={outcome} value={outcome}>
                        {text.safetyOptions[outcome]}
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

            </RequestLogFilterForm>

            <div className="table-wrap">
              <table className="data-table request-table">
                <colgroup>
                  <col className="request-log-col-time" />
                  <col className="request-log-col-name" />
                  <col className="request-log-col-project" />
                  <col className="request-log-col-model" />
                  <col className="request-log-col-cost" />
                  <col className="request-log-col-latency" />
                  <col className="request-log-col-status" />
                </colgroup>
                <thead>
                  <tr>
                    <th>{text.table.time}</th>
                    <th>{text.table.name}</th>
                    <th>{text.table.project}</th>
                    <th>{text.table.model}</th>
                    <th>{text.table.cost}</th>
                    <th>{text.table.latency}</th>
                    <th>{text.table.status}</th>
                  </tr>
                </thead>
                <tbody>
                  {sourceState === "unavailable" ? (
                    <tr>
                      <td colSpan={7}>{text.table.unavailable}</td>
                    </tr>
                  ) : null}
                  {sourceState === "ready" && records.length === 0 ? (
                    <tr>
                      <td colSpan={7}>{text.table.empty}</td>
                    </tr>
                  ) : null}
                  {pageRecords.map((record) => {
                    const isSelected = selectedRequestId === record.requestId;
                    const detailHref = requestLogDetailHref(tenantId, record.requestId, filters);
                    const displayRequestId = formatDisplayIdentifier(record.requestId);
                    const projectName = record.projectName ?? projectNameById.get(record.projectId) ?? formatDisplayIdentifier(record.projectId);
                    const employee = record.endUserId
                      ? employeeDirectory[record.endUserId.trim().toLocaleLowerCase()]
                      : undefined;

                    return (
                      <tr
                        data-request-log-row
                        data-selected={isSelected ? "true" : undefined}
                        key={record.requestId}
                      >
                        <td className="request-log-time-cell">
                          <Link
                            className="request-log-row-link"
                            data-request-log-anchor
                            data-request-log-project-id={record.projectId}
                            data-request-log-request-id={record.requestId}
                            href={detailHref}
                            scroll={false}
                          >
                            <span>{formatShortTime(record.createdAt, timezone)}</span>
                            <span className="sr-only">{`${text.table.actions}: ${displayRequestId}`}</span>
                          </Link>
                        </td>
                        <td>
                          {record.endUserId ? (
                            <span className="request-log-name-cell" title={record.endUserId}>
                              <span className="request-log-name-primary">
                                {employee?.name || formatDisplayIdentifier(record.endUserId)}
                              </span>
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
                          <RequestRoutingCell
                            providerDirectory={providerDirectory}
                            record={record}
                          />
                        </td>
                        <td className="request-log-cost-cell">{formatMicroUsd(record.costMicroUsd)}</td>
                        <td>
                          <dl className="request-log-latency-cell">
                            <div>
                              <dt>{text.table.totalLatency}</dt>
                              <dd>{formatLatency(record.latencyMs)}</dd>
                            </div>
                            <div>
                              <dt>{text.table.ttft}</dt>
                              <dd>{formatRequestLogTtft(record.ttftMs)}</dd>
                            </div>
                          </dl>
                        </td>
                        <td>
                          <StatusBadge label={formatHttpStatus(record)} status={record.status} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
  appendRequestLogQuery(query, "safetyOutcome", filters.safetyOutcome);
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
  appendRequestLogQuery(query, "projectId", filters.projectId);
  appendRequestLogQuery(query, "safetyOutcome", filters.safetyOutcome);
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

function RequestRoutingCell({
  providerDirectory,
  record
}: {
  providerDirectory: ProviderDisplayDirectory;
  record: LiveInvocationLogRecord;
}) {
  const modelName = formatModelDisplayName(
    record.providerAttempt?.modelId ?? record.requestedModel,
    "not called"
  );
  const provider = resolveProviderDisplay(
    providerDirectory,
    record.providerAttempt?.providerId
  );
  const requestMode = record.requestedModel === "auto"
    ? "Auto routing"
    : formatModelDisplayName(record.requestedModel, "Manual routing");
  const executionLabel = provider
    ? `${provider.name} · ${requestMode}`
    : `${record.category} / ${record.difficulty} / ${record.modelRef ?? "-"}`;
  const routingEvidence = `${record.category} / ${record.difficulty} / ${record.modelRef ?? "no-model-ref"} / ${record.routingReason ?? "not-set"}`;

  return (
    <span
      className="request-log-provider-model"
      title={`${modelName} · ${executionLabel} · ${routingEvidence}`}
    >
      {provider ? (
        <ProviderFamilyIcon
          className="request-log-provider-icon"
          family={provider.family}
          size={24}
        />
      ) : null}
      <strong>{modelName}</strong>
    </span>
  );
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
  records: LiveInvocationLogRecord[],
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
      icon: <CheckCircle2 aria-hidden="true" size={16} strokeWidth={1.9} />,
      label: text.totalRequests,
      tone: "total",
      value: formatInteger(summary.totalRequests)
    },
    {
      detail: `${text.countUnit} (${formatPercent(successRate)})`,
      icon: <CheckCircle2 aria-hidden="true" size={16} strokeWidth={1.9} />,
      label: text.successful,
      tone: "success",
      value: formatInteger(summary.successfulRequests)
    },
    {
      detail: `${text.countUnit} (${formatPercent(blockedRate)})`,
      icon: <AlertTriangle aria-hidden="true" size={16} strokeWidth={1.9} />,
      label: text.blocked,
      tone: "blocked",
      value: formatInteger(summary.blockedRequests)
    },
    {
      detail: `${text.countUnit} (${formatPercent(failedRate)})`,
      icon: <Database aria-hidden="true" size={16} strokeWidth={1.9} />,
      label: text.failed,
      tone: "failed",
      value: formatInteger(summary.failedRequests)
    },
    {
      detail: "",
      icon: <Coins aria-hidden="true" size={16} strokeWidth={1.9} />,
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

function formatHttpStatus(record: LiveInvocationLogRecord) {
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
