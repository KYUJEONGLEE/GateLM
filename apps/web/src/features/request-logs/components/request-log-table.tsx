import {
  AlertTriangle,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleMinus,
  Coins,
  Database,
  Eye,
  RotateCw,
  Search
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";
import { formatDisplayIdentifier } from "@/lib/formatting/display-identifiers";
import {
  formatInteger,
  formatLatency,
  nullableText
} from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";
import { RequestLogDetailAnchor } from "./request-log-detail-anchor";
import { RequestLogScopeFilterControls } from "./request-log-scope-filter-controls";
import { StatusBadge } from "./request-log-status-badge";

type RequestLogTableProps = {
  allowAllProjects?: boolean;
  budgetScopeOptions: RequestLogBudgetScopeOption[];
  detailPanel?: ReactNode;
  filters: RequestLogFilterState;
  locale: Locale;
  modelOptions: string[];
  projects?: ProjectRecord[];
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
export const requestLogBudgetScopeTypeFilters = ["application", "project", "team"] as const;

export type RequestLogCreatedFilter = (typeof requestLogCreatedFilters)[number];
export type RequestLogFilterState = {
  applicationId: string;
  budgetScopeId: string;
  budgetScopeType: "" | (typeof requestLogBudgetScopeTypeFilters)[number];
  cacheStatus: "" | (typeof requestLogCacheStatusFilters)[number];
  created: RequestLogCreatedFilter;
  model: string;
  page: number;
  projectId: string;
  provider: string;
  requestId: string;
  resolvedBy: string;
  status: "" | InvocationLogRecord["status"];
};

export type RequestLogBudgetScopeOption = {
  budgetScopeId: string;
  budgetScopeType: (typeof requestLogBudgetScopeTypeFilters)[number];
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
      cache: string;
      cacheBypass: string;
      cacheHit: string;
      cacheMiss: string;
      cacheUnknown: string;
      cost: string;
      empty: string;
      latency: string;
      model: string;
      name: string;
      project: string;
      provider: string;
      requestId: string;
      safety: string;
      status: string;
      time: string;
      tokens: string;
      unavailable: string;
    };
    title: string;
  }
> = {
  en: {
    allApplications: "All applications",
    allBudgetScopeIds: "All policies/budgets",
    allBudgetScopeTypes: "All policy boundaries",
    allCacheStatuses: "All cache states",
    allModels: "All models",
    allProviders: "All providers",
    allResolvedBy: "All resolution sources",
    allStatuses: "All statuses",
    applicationLabel: "Application",
    budgetScopeIdLabel: "Project policy/budget",
    budgetScopeTypeLabel: "Policy boundary",
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
    kicker: "Monitoring",
    modelLabel: "Model",
    nextPage: "Next",
    pageSummary: "Showing {start}-{end} of {total}",
    previousPage: "Previous",
    providerLabel: "Provider",
    rangeEndLabel: "End of logs in this range",
    refreshLabel: "Refresh",
    searchLabel: "Search logs",
    searchPlaceholder: "Search by requestId",
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
      cache: "Cache",
      cacheBypass: "Bypass",
      cacheHit: "Hit",
      cacheMiss: "Miss",
      cacheUnknown: "-",
      cost: "Cost",
      empty: "No Gateway request logs found for the current range.",
      latency: "Latency",
      model: "Model",
      name: "Name",
      project: "Project",
      provider: "Provider",
      requestId: "Request ID",
      safety: "Safety",
      status: "Status",
      time: "Time",
      tokens: "Tokens",
      unavailable: "Live Gateway request logs are not available right now."
    },
    title: "Live Logs"
  },
  ko: {
    allApplications: "전체 Application",
    allBudgetScopeIds: "전체 정책/예산",
    allBudgetScopeTypes: "전체 정책 경계",
    allCacheStatuses: "전체 캐시 상태",
    allModels: "전체 모델",
    allProviders: "전체 Provider",
    allResolvedBy: "전체 결정 경로",
    allStatuses: "전체 상태",
    applicationLabel: "Application",
    budgetScopeIdLabel: "Project 정책/예산",
    budgetScopeTypeLabel: "정책 경계",
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
    kicker: "모니터링",
    modelLabel: "모델",
    nextPage: "다음",
    pageSummary: "{total}개 중 {start}-{end}개 표시",
    previousPage: "이전",
    providerLabel: "Provider",
    rangeEndLabel: "현재 범위의 마지막 로그",
    refreshLabel: "새로고침",
    searchLabel: "로그 검색",
    searchPlaceholder: "requestId 검색",
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
      cache: "Cache",
      cacheBypass: "Bypass",
      cacheHit: "Hit",
      cacheMiss: "Miss",
      cacheUnknown: "-",
      cost: "비용",
      empty: "현재 범위에 Gateway 요청 로그가 없습니다.",
      latency: "지연 시간",
      model: "모델",
      name: "Name",
      project: "Project",
      provider: "Provider",
      requestId: "요청 ID",
      safety: "Safety",
      status: "상태",
      time: "시간",
      tokens: "토큰",
      unavailable: "현재 Gateway 요청 로그를 불러올 수 없습니다."
    },
    title: "실시간 로그"
  }
};

export function RequestLogTable({
  allowAllProjects = true,
  budgetScopeOptions,
  detailPanel,
  filters,
  locale,
  modelOptions,
  projects = [],
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
  const headerDate = formatHeaderDate(records);
  const projectNameById = new Map(projects.map((project) => [project.id, project.name]));

  return (
    <main className="console-content request-log-screen">
      <section className="request-log-hero">
        <div>
          <p className="console-kicker">{text.kicker}</p>
          <h2>{text.title}</h2>
        </div>
        <div className="request-log-hero-actions" aria-label="Live log controls">
          <span className="request-log-hero-control">
            <CalendarDays aria-hidden="true" size={16} strokeWidth={2.2} />
            {headerDate}
          </span>
          <span className="request-log-hero-control">{text.createdOptions[filters.created]}</span>
          <Link className="request-log-refresh-link" href={refreshHref}>
            <RotateCw aria-hidden="true" size={16} strokeWidth={2.2} />
            {text.refreshLabel}
          </Link>
        </div>
      </section>

      <RequestLogDetailAnchor>
        <section className="request-log-workspace" data-detail={selectedRequestId ? "open" : "closed"}>
          <div className="console-panel request-log-list-panel">
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

            <form action={`/tenants/${tenantId}/request-logs`} className="request-log-search-panel">
              <input name="page" type="hidden" value="1" />
              <div className="request-log-search-shell">
                <input
                  aria-label={text.searchLabel}
                  defaultValue={filters.requestId}
                  name="searchRequestId"
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

                <label className="request-log-filter-control">
                  <span>Project</span>
                  <div className="dashboard-filter-input">
                    <Building2 aria-hidden="true" size={16} strokeWidth={2.1} />
                    <select defaultValue={filters.projectId} name="projectId">
                      {allowAllProjects ? <option value="">All projects</option> : null}
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                  </div>
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

                <RequestLogScopeFilterControls
                  allBudgetScopeIds={text.allBudgetScopeIds}
                  allBudgetScopeTypes={text.allBudgetScopeTypes}
                  budgetScopeId={filters.budgetScopeId}
                  budgetScopeIdLabel={text.budgetScopeIdLabel}
                  budgetScopeOptions={budgetScopeOptions}
                  budgetScopeType={filters.budgetScopeType}
                  budgetScopeTypeLabel={text.budgetScopeTypeLabel}
                  scopeTypeOptions={requestLogBudgetScopeTypeFilters}
                />

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
            </form>

            <div className="table-wrap">
              <table className="data-table request-table">
                <thead>
                  <tr>
                    <th>{text.table.time}</th>
                    <th>{text.table.requestId}</th>
                    <th>{text.table.project}</th>
                    <th>{text.table.name}</th>
                    <th>{text.table.provider}</th>
                    <th>{text.table.model}</th>
                    <th>{text.table.status}</th>
                    <th>{text.table.cache}</th>
                    <th>{text.table.safety}</th>
                    <th>{text.table.latency}</th>
                    <th>{text.table.tokens}</th>
                    <th>{text.table.cost}</th>
                    <th aria-label={text.table.actions} />
                  </tr>
                </thead>
                <tbody>
                  {sourceState === "unavailable" ? (
                    <tr>
                      <td colSpan={13}>{text.table.unavailable}</td>
                    </tr>
                  ) : null}
                  {sourceState === "ready" && records.length === 0 ? (
                    <tr>
                      <td colSpan={13}>{text.table.empty}</td>
                    </tr>
                  ) : null}
                  {pageRecords.map((record) => {
                    const isSelected = selectedRequestId === record.requestId;
                    const detailHref = requestLogDetailHref(tenantId, record.requestId, filters);
                    const displayRequestId = formatDisplayIdentifier(record.requestId);
                    const projectName = projectNameById.get(record.projectId) ?? formatDisplayIdentifier(record.projectId);

                    return (
                      <tr data-selected={isSelected ? "true" : undefined} key={record.requestId}>
                        <td className="request-log-time-cell">
                          {formatShortTime(record.createdAt, timezone)}
                        </td>
                        <td>
                          <Link
                            className="request-link"
                            data-request-log-anchor
                            data-request-log-project-id={record.projectId}
                            data-request-log-request-id={record.requestId}
                            href={detailHref}
                            scroll={false}
                          >
                            {displayRequestId}
                          </Link>
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
                          {record.endUserId ? (
                            <span className="request-log-name-cell" title={record.endUserId}>
                              {formatDisplayIdentifier(record.endUserId)}
                            </span>
                          ) : (
                            <span className="request-log-muted-value">-</span>
                          )}
                        </td>
                        <td>
                          <ProviderBadge provider={record.selectedProvider ?? record.requestedProvider} />
                        </td>
                        <td>{nullableText(record.selectedModel, record.requestedModel ?? "not routed")}</td>
                        <td>
                          <StatusBadge label={formatHttpStatus(record)} status={record.status} />
                        </td>
                        <td>
                          <CacheHitBadge record={record} text={text.table} />
                        </td>
                        <td>
                          <SafetyBadge record={record} />
                        </td>
                        <td>{formatLatency(record.latencyMs)}</td>
                        <td>{formatInteger(record.totalTokens)}</td>
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
  appendRequestLogQuery(query, "budgetScopeId", filters.budgetScopeId);
  appendRequestLogQuery(query, "budgetScopeType", filters.budgetScopeType);
  appendRequestLogQuery(query, "cacheStatus", filters.cacheStatus);
  if (filters.status) {
    query.set("status", filters.status);
  }
  appendRequestLogQuery(query, "searchRequestId", filters.requestId);
  if (filters.model) {
    query.set("model", filters.model);
  }
  if (filters.page > 1) {
    query.set("page", String(filters.page));
  }
  appendRequestLogQuery(query, "provider", filters.provider);
  appendRequestLogQuery(query, "projectId", filters.projectId);
  appendRequestLogQuery(query, "resolvedBy", filters.resolvedBy);
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
  appendRequestLogQuery(query, "budgetScopeId", filters.budgetScopeId);
  appendRequestLogQuery(query, "budgetScopeType", filters.budgetScopeType);
  appendRequestLogQuery(query, "cacheStatus", filters.cacheStatus);
  appendRequestLogQuery(query, "model", filters.model);
  appendRequestLogQuery(query, "provider", filters.provider);
  appendRequestLogQuery(query, "projectId", filters.projectId);
  appendRequestLogQuery(query, "resolvedBy", filters.resolvedBy);
  appendRequestLogQuery(query, "searchRequestId", filters.requestId);
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

function CacheHitBadge({
  record,
  text
}: {
  record: InvocationLogRecord;
  text: (typeof requestLogText)[Locale]["table"];
}) {
  const cache = getCacheHitDisplay(record, text);
  const Icon = cache.tone === "hit" ? CheckCircle2 : cache.tone === "miss" ? CircleMinus : Database;

  return (
    <span className="request-log-cache-badge" data-cache-tone={cache.tone}>
      <Icon aria-hidden="true" size={16} strokeWidth={2.4} />
      {cache.label}
    </span>
  );
}

function getCacheHitDisplay(
  record: InvocationLogRecord,
  text: (typeof requestLogText)[Locale]["table"]
) {
  const cacheSignal = `${record.cacheStatus} ${record.domainOutcomes?.cache?.outcome ?? ""}`.toLowerCase();

  if (cacheSignal.includes("hit")) {
    return {
      label: text.cacheHit,
      tone: "hit"
    } as const;
  }

  if (cacheSignal.includes("miss")) {
    return {
      label: text.cacheMiss,
      tone: "miss"
    } as const;
  }

  if (cacheSignal.includes("bypass")) {
    return {
      label: text.cacheBypass,
      tone: "bypass"
    } as const;
  }

  return {
    label: text.cacheUnknown,
    tone: "unknown"
  } as const;
}

function ProviderBadge({ provider }: { provider: string | null | undefined }) {
  const normalized = normalizeProvider(provider);

  return (
    <span className="request-log-provider-badge" data-provider={normalized}>
      <span>{providerMark(normalized)}</span>
      {providerLabel(normalized, provider)}
    </span>
  );
}

function SafetyBadge({ record }: { record: InvocationLogRecord }) {
  const outcome = record.domainOutcomes?.safety?.outcome ?? record.maskingAction;
  const normalized = normalizeSafetyOutcome(outcome);

  if (normalized === "none") {
    return <span className="request-log-muted-value">-</span>;
  }

  return (
    <span className="request-log-safety-badge" data-safety-tone={normalized}>
      {safetyLabel(normalized)}
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

function providerMark(provider: string) {
  if (provider === "openai") {
    return "O";
  }
  if (provider === "anthropic") {
    return "A";
  }
  if (provider === "gemini") {
    return "G";
  }
  if (provider === "mock") {
    return "M";
  }

  return "?";
}

function normalizeSafetyOutcome(value: string | null | undefined) {
  const normalized = value?.trim().toLowerCase() ?? "";

  if (!normalized || normalized === "none" || normalized === "passed" || normalized === "pass") {
    return "none";
  }
  if (normalized.includes("mask") || normalized.includes("redact")) {
    return "masked";
  }
  if (normalized.includes("block")) {
    return "blocked";
  }

  return "flagged";
}

function safetyLabel(value: string) {
  if (value === "masked") {
    return "MASKED";
  }
  if (value === "blocked") {
    return "BLOCKED";
  }

  return "FLAGGED";
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

function formatHeaderDate(records: InvocationLogRecord[]) {
  const latest = records[0]?.createdAt;
  const date = latest ? new Date(latest) : new Date();
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
