import type { ProjectEmployeeAssignmentValues } from "@/lib/control-plane/employees-types";

export function buildProjectEmployeeAssignmentRequestBody(
  values: ProjectEmployeeAssignmentValues
) {
  return {
    allowedModelKeys: values.allowedModelKeys,
    allowedProviderConnectionIds: values.allowedProviderConnectionIds,
    dailyTokenLimit: values.dailyTokenLimit,
    monthlyBudgetLimitUsd: values.monthlyBudgetLimitUsd,
    policyNote: values.policyNote.trim() || undefined,
    rateLimitEnabled: values.rateLimitEnabled,
    rateLimitLimit: values.rateLimitLimit,
    rateLimitWindowSeconds: values.rateLimitWindowSeconds,
    status: values.status ?? "active",
    warningThresholdPercent: values.warningThresholdPercent
  };
}
