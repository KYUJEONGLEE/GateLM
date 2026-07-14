import "server-only";

import { getTenantEmployees } from "@/lib/control-plane/employees-client";
import { getTenantChatInvocations } from "@/lib/control-plane/tenant-chat-observability-client";
import { getDashboardLiveRange, type LiveDashboardRange } from "@/lib/gateway/live-dashboard-overview";
import type {
  LiveRequestsPayload,
  LiveRequestStatusFilter
} from "@/lib/gateway/live-requests-types";

export async function getTenantChatLiveRequests(
  tenantId: string,
  filters: {
    model?: string;
    range: LiveDashboardRange;
    status?: LiveRequestStatusFilter;
  }
): Promise<LiveRequestsPayload | undefined> {
  const { from, to } = getDashboardLiveRange(filters.range);
  const [invocations, employees] = await Promise.all([
    getTenantChatInvocations(tenantId, from, to, filters.model ? 50 : 5),
    getTenantEmployees(tenantId)
  ]);
  if (!invocations) {
    return undefined;
  }
  const names = new Map(
    employees.flatMap((employee) =>
      [employee.id, employee.userId]
        .filter((value): value is string => Boolean(value))
        .map((value) => [value, employee.name?.trim() || employee.email] as const)
    )
  );
  const rows = invocations
    .map((invocation) => {
      const status = normalizeStatus(invocation.terminalOutcome);
      return {
        cacheStatus:
          invocation.cacheOutcome === "hit"
            ? "HIT" as const
            : invocation.cacheOutcome === "miss"
              ? "MISS" as const
              : "NONE" as const,
        category: "general" as const,
        costUsd: invocation.confirmedCostMicroUsd / 1_000_000,
        difficulty: "simple" as const,
        id: invocation.requestId,
        latencyMs: invocation.latencyMs,
        ttftMs: null,
        modelRef: null,
        projectId: "",
        projectName: "Tenant Chat",
        requestedModel: invocation.modelKey ?? "auto",
        requestId: invocation.requestId,
        routingReason: "tenant_chat",
        safetyAction:
          invocation.terminalOutcome === "safety_blocked"
            ? "BLOCKED" as const
            : "NONE" as const,
        surface: "tenant_chat" as const,
        status: status.value,
        statusCode: status.code,
        statusLabel: status.label,
        timestamp: invocation.completedAt,
        totalTokens: invocation.confirmedTotalTokens,
        userName:
          (invocation.employeeId ? names.get(invocation.employeeId) : undefined) ??
          names.get(invocation.userId) ??
          (invocation.actorKind === "tenant_admin" ? "Tenant admin" : null)
      };
    })
    .filter(
      (row) =>
        !filters.model ||
        row.requestedModel.trim().toLowerCase() === filters.model.trim().toLowerCase()
    )
    .filter((row) => !filters.status || row.status === filters.status)
    .slice(0, 9);

  return {
    generatedAt: new Date().toISOString(),
    requestedModelOptions: [
      ...new Set(
        rows
          .map((row) => row.requestedModel)
          .filter((model) => model !== "auto")
      )
    ],
    projectNameSource: "control-plane",
    rows
  };
}

export function mergeLiveRequestPayloads(
  projectApplication: LiveRequestsPayload,
  tenantChat: LiveRequestsPayload
): LiveRequestsPayload {
  return {
    generatedAt:
      projectApplication.generatedAt >= tenantChat.generatedAt
        ? projectApplication.generatedAt
        : tenantChat.generatedAt,
    requestedModelOptions: [
      ...new Set([
        ...projectApplication.requestedModelOptions,
        ...tenantChat.requestedModelOptions
      ])
    ],
    projectNameSource: projectApplication.projectNameSource,
    rows: [...projectApplication.rows, ...tenantChat.rows]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, 9)
  };
}

function normalizeStatus(outcome: string) {
  if (outcome === "succeeded" || outcome === "cache_hit") {
    return { code: 200, label: "Success", value: "success" };
  }
  if (outcome === "rate_limited" || outcome === "concurrency_limited") {
    return { code: 429, label: "Rate limited", value: "rate_limited" };
  }
  if (
    outcome === "safety_blocked" ||
    outcome === "quota_blocked" ||
    outcome === "budget_blocked" ||
    outcome === "policy_ack_required"
  ) {
    return { code: 403, label: "Blocked", value: "blocked" };
  }
  if (outcome === "cancelled") {
    return { code: 499, label: "Cancelled", value: "cancelled" };
  }
  return { code: 502, label: "Failed", value: "failed" };
}
