import type {
  EmployeeCostEnforcementMode,
  EmployeeCostExposureSource,
  EmployeeCostLimit,
  EmployeeCostPoliciesResponse,
  EmployeeCostPolicy,
  EmployeeCostPolicyListItem,
  EmployeeCostPolicyPeriod,
  EmployeeCostRolloutMode,
  EmployeeCostPolicyState
} from "@/lib/control-plane/employee-cost-policy-types";
import { MAX_EMPLOYEE_COST_LIMIT_MICRO_USD } from "@/lib/control-plane/employee-cost-policy-types";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENFORCEMENT_MODES = new Set<EmployeeCostEnforcementMode>([
  "monitor",
  "restrict_high_cost"
]);
const EXPOSURE_SOURCES = new Set<EmployeeCostExposureSource>([
  "authoritative_ledger",
  "confirmed_read_model"
]);
const ROLLOUT_MODES = new Set<EmployeeCostRolloutMode>(["off", "shadow", "enforce"]);
const POLICY_STATES = new Set<EmployeeCostPolicyState>([
  "exceeded",
  "normal",
  "not_configured",
  "pending_ledger",
  "warning"
]);

export function parseEmployeeCostPoliciesResponse(
  value: unknown,
  expectedTenantId?: string
): EmployeeCostPoliciesResponse | null {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return null;
  }

  const data = value.data.map((item) => parseListItem(item, expectedTenantId));
  if (data.some((item) => item === null)) {
    return null;
  }

  const pagination = parsePagination(value.pagination);
  if (!pagination || data.length > pagination.limit) {
    return null;
  }

  const parsedData = data as EmployeeCostPolicyListItem[];
  if (new Set(parsedData.map((item) => item.employeeId)).size !== parsedData.length) {
    return null;
  }

  return { data: parsedData, pagination };
}

export function parseEmployeeCostPolicy(
  value: unknown,
  expectedTenantId?: string,
  expectedEmployeeId?: string
): EmployeeCostPolicy | null {
  if (
    !isRecord(value) ||
    !isUuid(value.tenantId) ||
    !isUuid(value.employeeId) ||
    value.currency !== "USD" ||
    typeof value.periodTimezone !== "string" ||
    !isIanaTimezone(value.periodTimezone) ||
    !isIntegerInRange(value.warningThresholdPercent, 1, 99) ||
    typeof value.enforcementMode !== "string" ||
    !ENFORCEMENT_MODES.has(value.enforcementMode as EmployeeCostEnforcementMode) ||
    !isNonNegativeSafeInteger(value.version) ||
    !isNullableNonEmptyString(value.updatedBy) ||
    !isNullableIsoTimestamp(value.createdAt) ||
    !isNullableIsoTimestamp(value.updatedAt) ||
    (expectedTenantId !== undefined && value.tenantId !== expectedTenantId) ||
    (expectedEmployeeId !== undefined && value.employeeId !== expectedEmployeeId)
  ) {
    return null;
  }

  const daily = parseLimit(value.daily);
  const weekly = parseLimit(value.weekly);
  if (!daily || !weekly) {
    return null;
  }

  return {
    createdAt: value.createdAt,
    currency: "USD",
    daily,
    employeeId: value.employeeId,
    enforcementMode: value.enforcementMode as EmployeeCostEnforcementMode,
    periodTimezone: value.periodTimezone,
    tenantId: value.tenantId,
    updatedAt: value.updatedAt,
    updatedBy: value.updatedBy,
    version: value.version,
    warningThresholdPercent: value.warningThresholdPercent,
    weekly
  };
}

function parseListItem(
  value: unknown,
  expectedTenantId: string | undefined
): EmployeeCostPolicyListItem | null {
  if (
    !isRecord(value) ||
    !isUuid(value.employeeId) ||
    typeof value.enforcementReady !== "boolean" ||
    typeof value.exposureSource !== "string" ||
    !EXPOSURE_SOURCES.has(value.exposureSource as EmployeeCostExposureSource) ||
    typeof value.rolloutMode !== "string" ||
    !ROLLOUT_MODES.has(value.rolloutMode as EmployeeCostRolloutMode)
  ) {
    return null;
  }

  const policy = parseEmployeeCostPolicy(value.policy, expectedTenantId, value.employeeId);
  const daily = parsePeriod(value.daily);
  const weekly = parsePeriod(value.weekly);
  if (!policy || !daily || !weekly) {
    return null;
  }

  const item = {
    daily,
    employeeId: value.employeeId,
    enforcementReady: value.enforcementReady,
    exposureSource: value.exposureSource as EmployeeCostExposureSource,
    policy,
    rolloutMode: value.rolloutMode as EmployeeCostRolloutMode,
    weekly
  } satisfies EmployeeCostPolicyListItem;

  return isConsistentExposure(item) ? item : null;
}

function parseLimit(value: unknown): EmployeeCostLimit | null {
  if (
    !isRecord(value) ||
    typeof value.enabled !== "boolean" ||
    !isIntegerInRange(value.limitMicroUsd, 0, MAX_EMPLOYEE_COST_LIMIT_MICRO_USD) ||
    (value.enabled && value.limitMicroUsd === 0)
  ) {
    return null;
  }

  return {
    enabled: value.enabled,
    limitMicroUsd: value.limitMicroUsd
  };
}

function parsePeriod(value: unknown): EmployeeCostPolicyPeriod | null {
  if (
    !isRecord(value) ||
    !isIsoTimestamp(value.periodStart) ||
    !isIsoTimestamp(value.periodEnd) ||
    !isIsoTimestamp(value.resetAt) ||
    typeof value.periodTimezone !== "string" ||
    !isIanaTimezone(value.periodTimezone) ||
    new Date(value.periodStart).getTime() >= new Date(value.periodEnd).getTime() ||
    value.resetAt !== value.periodEnd ||
    !isNonNegativeSafeInteger(value.confirmedCostMicroUsd) ||
    !isNullableNonNegativeSafeInteger(value.reservedCostMicroUsd) ||
    !isNullableNonNegativeSafeInteger(value.unconfirmedCostMicroUsd) ||
    typeof value.state !== "string" ||
    !POLICY_STATES.has(value.state as EmployeeCostPolicyState)
  ) {
    return null;
  }

  return {
    confirmedCostMicroUsd: value.confirmedCostMicroUsd,
    periodEnd: value.periodEnd,
    periodStart: value.periodStart,
    periodTimezone: value.periodTimezone,
    reservedCostMicroUsd: value.reservedCostMicroUsd,
    resetAt: value.resetAt,
    state: value.state as EmployeeCostPolicyState,
    unconfirmedCostMicroUsd: value.unconfirmedCostMicroUsd
  };
}

function parsePagination(value: unknown): EmployeeCostPoliciesResponse["pagination"] | null {
  if (
    !isRecord(value) ||
    typeof value.hasMore !== "boolean" ||
    !isIntegerInRange(value.limit, 1, 100) ||
    !(value.nextCursor === null || isUuid(value.nextCursor)) ||
    (value.hasMore && value.nextCursor === null) ||
    (!value.hasMore && value.nextCursor !== null)
  ) {
    return null;
  }

  return {
    hasMore: value.hasMore,
    limit: value.limit,
    nextCursor: value.nextCursor
  };
}

function isConsistentExposure(item: EmployeeCostPolicyListItem) {
  if (
    item.daily.periodTimezone !== item.policy.periodTimezone ||
    item.weekly.periodTimezone !== item.policy.periodTimezone ||
    (item.enforcementReady && item.rolloutMode !== "enforce") ||
    (item.rolloutMode === "off" && item.exposureSource !== "confirmed_read_model")
  ) {
    return false;
  }

  if (item.exposureSource === "authoritative_ledger") {
    return (
      item.rolloutMode !== "off" &&
      isAuthoritativePeriod(
        item.daily,
        item.policy.daily,
        item.policy.warningThresholdPercent
      ) &&
      isAuthoritativePeriod(
        item.weekly,
        item.policy.weekly,
        item.policy.warningThresholdPercent
      )
    );
  }

  return (
    !item.enforcementReady &&
    isPendingPeriod(item.daily, item.policy.daily) &&
    isPendingPeriod(item.weekly, item.policy.weekly)
  );
}

function isAuthoritativePeriod(
  period: EmployeeCostPolicyPeriod,
  limit: EmployeeCostLimit,
  warningThresholdPercent: number
) {
  if (period.reservedCostMicroUsd === null || period.unconfirmedCostMicroUsd === null) {
    return false;
  }
  if (!limit.enabled) {
    return period.state === "not_configured";
  }

  const exposureMicroUsd =
    period.confirmedCostMicroUsd +
    period.reservedCostMicroUsd +
    period.unconfirmedCostMicroUsd;
  if (!Number.isSafeInteger(exposureMicroUsd)) {
    return false;
  }

  const exposure = BigInt(exposureMicroUsd);
  const limitAmount = BigInt(limit.limitMicroUsd);
  const expectedState: EmployeeCostPolicyState =
    exposure >= limitAmount
      ? "exceeded"
      : exposure * 100n >= limitAmount * BigInt(warningThresholdPercent)
        ? "warning"
        : "normal";

  return period.state === expectedState;
}

function isPendingPeriod(period: EmployeeCostPolicyPeriod, limit: EmployeeCostLimit) {
  return (
    period.reservedCostMicroUsd === null &&
    period.unconfirmedCostMicroUsd === null &&
    period.state === (limit.enabled ? "pending_ledger" : "not_configured")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNullableNonNegativeSafeInteger(value: unknown): value is number | null {
  return value === null || isNonNegativeSafeInteger(value);
}

function isNullableNonEmptyString(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.trim().length > 0);
}

function isNullableIsoTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string") {
    return false;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
}

function isIanaTimezone(value: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
