import "server-only";

import { getControlPlaneTenantId } from "@/lib/control-plane/control-plane-config";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import { getProviderConnectionsModel } from "@/lib/control-plane/provider-connections-client";
import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import {
  getDashboardLiveRange,
  getLiveDashboardOverview,
  type LiveDashboardOverview as DashboardOverview
} from "@/lib/gateway/live-dashboard-overview";
import { getGatewayHealthModel } from "@/lib/gateway/health-client";
import type { GatewayHealthModel } from "@/lib/gateway/health-types";
import { getLiveGatewayRequestLogs } from "@/lib/gateway/live-request-logs";
import type { LiveInvocationLogRecord as InvocationLogRecord } from "@/lib/gateway/live-observability-contract";

export const gatewayAdminSections = [
  "overview",
  "traffic",
  "providers",
  "tenants",
  "errors",
  "cost",
  "cache",
  "alerts",
  "audit-logs"
] as const;

export type GatewayAdminSection = (typeof gatewayAdminSections)[number];
export type GatewayAdminRange = "15m" | "1h" | "1d" | "1w";
export type GatewayAdminHealthStatus = "healthy" | "degraded" | "down" | "unknown";

export type GatewayAdminFilters = {
  model?: string;
  projectId?: string;
  provider?: string;
  range: GatewayAdminRange;
  status?: InvocationLogRecord["status"];
};

export type GatewayAdminProviderRow = {
  connectionStatus: ProviderConnectionRecord["status"] | "UNREGISTERED";
  costMicroUsd: number;
  health: GatewayAdminHealthStatus;
  modelCount: number;
  models: string[];
  p95LatencyMs: number | null;
  provider: string;
  requestCount: number;
  timeoutMs: number | null;
};

export type GatewayAdminProjectUsageRow = {
  budgetUsd: number;
  cacheHitRate: number;
  costMicroUsd: number;
  failedRequests: number;
  projectId: string;
  projectName: string;
  requestCount: number;
  status: ProjectRecord["status"];
  totalTokens: number;
};

export type GatewayAdminTenantRow = {
  activeProjectCount: number;
  budgetUsd: number;
  cacheHitRate: number;
  costMicroUsd: number;
  errorRate: number;
  failedRequests: number;
  projectCount: number;
  requestCount: number;
  tenantId: string;
  totalTokens: number;
};

export type GatewayAdminModel = {
  dataWarnings: string[];
  filters: GatewayAdminFilters;
  generatedAt: string;
  health: GatewayHealthModel;
  overview: DashboardOverview | null;
  projectUsageRows: GatewayAdminProjectUsageRow[];
  projects: ProjectRecord[];
  providerRows: GatewayAdminProviderRow[];
  providers: ProviderConnectionRecord[];
  range: {
    from: string;
    to: string;
  };
  recentErrors: InvocationLogRecord[];
  records: InvocationLogRecord[];
  tenantRows: GatewayAdminTenantRow[];
  tenantId: string;
};

export function normalizeGatewayAdminSection(value: string): GatewayAdminSection | null {
  return gatewayAdminSections.includes(value as GatewayAdminSection)
    ? (value as GatewayAdminSection)
    : null;
}

export function normalizeGatewayAdminRange(value: string | undefined): GatewayAdminRange {
  if (value === "1h" || value === "1d" || value === "1w") {
    return value;
  }

  return "15m";
}

export function normalizeGatewayAdminStatus(
  value: string | undefined
): InvocationLogRecord["status"] | undefined {
  if (
    value === "success" ||
    value === "blocked" ||
    value === "rate_limited" ||
    value === "failed" ||
    value === "cancelled"
  ) {
    return value;
  }

  return undefined;
}

export async function getGatewayAdminModel(filters: GatewayAdminFilters): Promise<GatewayAdminModel> {
  const tenantId = getControlPlaneTenantId();
  const range = getDashboardLiveRange(filters.range);
  const [health, overview, records, projectsModel, providersModel] = await Promise.all([
    getGatewayHealthModel(tenantId),
    getLiveDashboardOverview(tenantId, { projectId: filters.projectId, range: filters.range }),
    getLiveGatewayRequestLogs({
      from: range.from,
      limit: 200,
      requestedModel: filters.model,
      projectId: filters.projectId,
      status: filters.status,
      tenantId,
      to: range.to
    }),
    getProjectsModel(tenantId),
    getProviderConnectionsModel(tenantId)
  ]);
  const safeRecords = records ?? [];
  const projects = projectsModel.projects;
  const providers = providersModel.providers;

  return {
    dataWarnings: getDataWarnings({
      overview,
      projectsLoadError: projectsModel.loadError,
      providersLoadError: providersModel.loadError,
      records
    }),
    filters,
    generatedAt: new Date().toISOString(),
    health,
    overview: overview ?? null,
    projectUsageRows: buildProjectUsageRows(projects, safeRecords),
    projects,
    providerRows: buildProviderRows(providers, overview),
    providers,
    range,
    recentErrors: safeRecords.filter(isProblemRecord).slice(0, 8),
    records: safeRecords,
    tenantRows: [buildTenantRow(tenantId, projects, safeRecords, overview ?? null)],
    tenantId
  };
}

function getDataWarnings({
  overview,
  projectsLoadError,
  providersLoadError,
  records
}: {
  overview: DashboardOverview | undefined;
  projectsLoadError: string | null;
  providersLoadError: string | null;
  records: InvocationLogRecord[] | undefined;
}) {
  const warnings: string[] = [];

  if (!overview) {
    warnings.push("Gateway overview API is unavailable.");
  }

  if (!records) {
    warnings.push("Gateway request log API is unavailable.");
  }

  if (projectsLoadError) {
    warnings.push(projectsLoadError);
  }

  if (providersLoadError) {
    warnings.push(providersLoadError);
  }

  return Array.from(new Set(warnings));
}

function buildProviderRows(
  providers: ProviderConnectionRecord[],
  overview: DashboardOverview | undefined
): GatewayAdminProviderRow[] {
  const providerNames = new Set<string>();
  const latencyRows = overview?.breakdowns?.byProviderModel ?? [];
  const costRows = overview?.costByModel ?? [];

  for (const provider of providers) {
    providerNames.add(provider.provider);
  }

  for (const row of [...latencyRows, ...costRows]) {
    providerNames.add(row.provider);
  }

  return [...providerNames]
    .sort((left, right) => left.localeCompare(right))
    .map((providerName) => {
      const provider = providers.find((item) => item.provider === providerName);
      const providerLatencyRows = latencyRows.filter((row) => row.provider === providerName);
      const providerCostRows = costRows.filter((row) => row.provider === providerName);
      const requestCount = Math.max(
        sum(providerLatencyRows.map((row) => row.requestCount)),
        sum(providerCostRows.map((row) => row.requestCount))
      );
      const models = getProviderModels(
        provider,
        [...providerLatencyRows, ...providerCostRows].map((row) => row.model)
      );

      return {
        connectionStatus: provider?.status ?? "UNREGISTERED",
        costMicroUsd: sum(providerCostRows.map((row) => row.costMicroUsd)),
        health: deriveProviderConnectionHealth(provider?.status),
        modelCount: models.length,
        models,
        p95LatencyMs: maximumOrNull(providerLatencyRows.map((row) => row.p95ProviderLatencyMs)),
        provider: providerName,
        requestCount,
        timeoutMs: provider?.timeoutMs ?? null
      };
    });
}

function buildProjectUsageRows(
  projects: ProjectRecord[],
  records: InvocationLogRecord[]
): GatewayAdminProjectUsageRow[] {
  const knownProjectIds = new Set(projects.map((project) => project.id));
  const unknownProjectIds = Array.from(
    new Set(records.map((record) => record.projectId).filter((projectId) => !knownProjectIds.has(projectId)))
  );
  const projectRows = [
    ...projects,
    ...unknownProjectIds.map((projectId) => ({
      createdAt: "",
      description: null,
      id: projectId,
      name: "Unknown project",
      runtimeApplicationId: null,
      status: "ACTIVE" as const,
      tenantId: "",
      totalBudgetUsd: 0,
      updatedAt: ""
    }))
  ];

  return projectRows.map((project) => {
    const projectRecords = records.filter((record) => record.projectId === project.id);
    const requestCount = projectRecords.length;
    const cacheHitCount = projectRecords.filter((record) => record.cacheStatus === "hit").length;

    return {
      budgetUsd: project.totalBudgetUsd,
      cacheHitRate: safeRate(cacheHitCount, requestCount),
      costMicroUsd: sum(projectRecords.map((record) => record.costMicroUsd)),
      failedRequests: projectRecords.filter(isFailedRecord).length,
      projectId: project.id,
      projectName: project.name,
      requestCount,
      status: project.status,
      totalTokens: sum(projectRecords.map((record) => record.totalTokens))
    };
  });
}

function buildTenantRow(
  tenantId: string,
  projects: ProjectRecord[],
  records: InvocationLogRecord[],
  overview: DashboardOverview | null
): GatewayAdminTenantRow {
  const requestCount = overview?.totalRequests ?? records.length;
  const failedRequests =
    overview?.failedRequests ?? records.filter((record) => record.status === "failed").length;
  const cacheHitRequests = overview?.cacheHitRequests ?? records.filter((record) => record.cacheStatus === "hit").length;

  return {
    activeProjectCount: projects.filter((project) => project.status === "ACTIVE").length,
    budgetUsd: sum(projects.map((project) => project.totalBudgetUsd)),
    cacheHitRate: overview?.cacheHitRate ?? safeRate(cacheHitRequests, requestCount),
    costMicroUsd: overview?.totalCostMicroUsd ?? sum(records.map((record) => record.costMicroUsd)),
    errorRate: safeRate(failedRequests, requestCount),
    failedRequests,
    projectCount: projects.length,
    requestCount,
    tenantId,
    totalTokens: overview?.totalTokens ?? sum(records.map((record) => record.totalTokens))
  };
}

function getProviderModels(
  provider: ProviderConnectionRecord | undefined,
  aggregateModels: string[]
) {
  const configModels = provider?.providerConfig?.models;
  const models = new Set<string>();

  if (Array.isArray(configModels)) {
    for (const model of configModels) {
      if (typeof model === "string" && model.trim()) {
        models.add(model.trim());
      }
    }
  }

  for (const model of aggregateModels) {
    if (model) {
      models.add(model);
    }
  }

  return [...models].sort((left, right) => left.localeCompare(right));
}

function deriveProviderConnectionHealth(
  status: ProviderConnectionRecord["status"] | undefined
): GatewayAdminHealthStatus {
  if (!status) {
    return "unknown";
  }
  if (status === "DISABLED") {
    return "down";
  }
  if (status === "DEGRADED") {
    return "degraded";
  }
  return "healthy";
}

function isFailedRecord(record: InvocationLogRecord) {
  return record.status === "failed";
}

function isProblemRecord(record: InvocationLogRecord) {
  return record.status === "failed" || record.status === "blocked" || record.status === "rate_limited";
}

function safeRate(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }

  return numerator / denominator;
}

function maximumOrNull(values: number[]) {
  const finiteValues = values.filter((value) => Number.isFinite(value));

  if (finiteValues.length === 0) {
    return null;
  }

  return Math.max(...finiteValues);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}
