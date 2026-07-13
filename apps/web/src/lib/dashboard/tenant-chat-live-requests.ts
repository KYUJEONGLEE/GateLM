import "server-only";

import { getTenantEmployees } from "@/lib/control-plane/employees-client";
import { getTenantChatInvocations } from "@/lib/control-plane/tenant-chat-observability-client";
import { formatModelDisplayName } from "@/lib/formatting/display-identifiers";
import { getDashboardLiveRange, type LiveDashboardRange } from "@/lib/gateway/live-dashboard-overview";
import type {
  LiveRequestProvider,
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
      const provider = normalizeProvider(invocation.providerId);
      const status = normalizeStatus(invocation.terminalOutcome);
      return {
        cacheStatus:
          invocation.cacheOutcome === "hit"
            ? "HIT" as const
            : invocation.cacheOutcome === "miss"
              ? "MISS" as const
              : "NONE" as const,
        costUsd: invocation.confirmedCostMicroUsd / 1_000_000,
        id: invocation.requestId,
        latencyMs: invocation.latencyMs,
        model: formatModelDisplayName(invocation.modelKey, "Not routed"),
        projectId: "",
        projectName: "Tenant Chat",
        provider,
        providerLabel: providerLabel(provider),
        requestId: invocation.requestId,
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
    .filter((row) => !filters.model || row.model === filters.model)
    .filter((row) => !filters.status || row.status === filters.status)
    .slice(0, 5);

  return {
    generatedAt: new Date().toISOString(),
    modelOptions: [...new Set(rows.map((row) => row.model))],
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
    modelOptions: [
      ...new Set([...projectApplication.modelOptions, ...tenantChat.modelOptions])
    ],
    projectNameSource: projectApplication.projectNameSource,
    rows: [...projectApplication.rows, ...tenantChat.rows]
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
      .slice(0, 5)
  };
}

function normalizeProvider(value: string | null): LiveRequestProvider {
  const normalized = value?.toLowerCase() ?? "";
  if (normalized.includes("openai")) return "openai";
  if (normalized.includes("anthropic")) return "anthropic";
  if (normalized.includes("google") || normalized.includes("gemini")) return "google";
  if (normalized.includes("mock")) return "mock";
  return "unknown";
}

function providerLabel(provider: LiveRequestProvider) {
  if (provider === "openai") return "OpenAI";
  if (provider === "anthropic") return "Anthropic";
  if (provider === "google" || provider === "gemini") return "Google";
  if (provider === "mock") return "Mock";
  return "Unknown";
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
