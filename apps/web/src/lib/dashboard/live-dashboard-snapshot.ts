import type { CostOverTimeSummary } from "@/lib/gateway/cost-over-time-types";
import type { LiveDashboardOverview } from "@/lib/gateway/live-dashboard-overview";
import type {
  LiveRequestsPayload,
  LiveRequestStatusFilter
} from "@/lib/gateway/live-requests-types";

export const DASHBOARD_SNAPSHOT_POLL_INTERVAL_MS = 1000;

export type LiveDashboardSnapshot = {
  costOverTime: CostOverTimeSummary;
  generatedAt: string;
  liveRequests: LiveRequestsPayload;
  monthToDateCostMicroUsd: number;
  overview: LiveDashboardOverview;
};

export type LiveDashboardSnapshotFilters = {
  budgetScopeId: string;
  budgetScopeType: string;
  liveModel: string;
  liveStatus: LiveRequestStatusFilter;
  projectId: string;
  range: string;
  resolvedBy: string;
  surface: "all" | "project_application" | "tenant_chat";
  tenantId: string;
};

export function buildLiveDashboardSnapshotQuery(filters: LiveDashboardSnapshotFilters) {
  const query = new URLSearchParams({
    range: filters.range,
    surface: filters.surface,
    tenantId: filters.tenantId
  });
  appendQuery(query, "budgetScopeId", filters.budgetScopeId);
  appendQuery(query, "budgetScopeType", filters.budgetScopeType);
  appendQuery(query, "projectId", filters.projectId);
  appendQuery(query, "resolvedBy", filters.resolvedBy);
  appendQuery(query, "status", filters.liveStatus);
  appendQuery(query, "model", filters.liveModel);
  return query.toString();
}

export function isNewerDashboardSnapshot(
  candidate: Pick<LiveDashboardSnapshot, "generatedAt">,
  currentGeneratedAt: string | null
) {
  if (!currentGeneratedAt) {
    return true;
  }

  const candidateTime = Date.parse(candidate.generatedAt);
  const currentTime = Date.parse(currentGeneratedAt);
  return Number.isFinite(candidateTime) &&
    (!Number.isFinite(currentTime) || candidateTime > currentTime);
}

function appendQuery(query: URLSearchParams, key: string, value: string | undefined) {
  const normalized = value?.trim();
  if (normalized) {
    query.set(key, normalized);
  }
}
