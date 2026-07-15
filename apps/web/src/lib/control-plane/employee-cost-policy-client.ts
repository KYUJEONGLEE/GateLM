import "server-only";

import { getControlPlaneBaseUrl } from "@/lib/control-plane/control-plane-config";
import {
  buildControlPlaneHeaders,
  type ControlPlaneRequestOptions
} from "@/lib/control-plane/control-plane-request";
import {
  parseEmployeeCostPoliciesResponse,
  parseEmployeeCostPolicy
} from "@/lib/control-plane/employee-cost-policy-parser";
import type {
  EmployeeCostPoliciesResponse,
  EmployeeCostPolicyRequestResult,
  EmployeeCostPolicyUpdate
} from "@/lib/control-plane/employee-cost-policy-types";

const EMPLOYEE_COST_POLICY_PAGE_LIMIT = 100;
const EMPLOYEE_COST_POLICY_MAX_PAGES = 100;

type EmployeeCostPolicyPageQuery = {
  cursor?: string;
  limit?: number;
  tenantId: string;
};

export async function getEmployeeCostPolicies(
  query: EmployeeCostPolicyPageQuery,
  options?: ControlPlaneRequestOptions
): Promise<EmployeeCostPolicyRequestResult<EmployeeCostPoliciesResponse>> {
  const search = new URLSearchParams();
  if (query.cursor) search.set("cursor", query.cursor);
  if (query.limit !== undefined) search.set("limit", String(query.limit));

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(query.tenantId)}/employees/cost-policies?${search.toString()}`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options)
      }
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      return failureResult(payload, response.status, "Employee cost policy request failed.");
    }

    const parsed = parseEmployeeCostPoliciesResponse(payload, query.tenantId);
    if (!parsed) {
      return invalidResponse("Control Plane returned an invalid employee cost policy response.");
    }

    return { data: parsed, ok: true, status: response.status };
  } catch {
    return {
      code: null,
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function getAllEmployeeCostPolicies(
  tenantId: string,
  options?: ControlPlaneRequestOptions
): Promise<EmployeeCostPolicyRequestResult<EmployeeCostPoliciesResponse>> {
  const rows: EmployeeCostPoliciesResponse["data"] = [];
  const seenCursors = new Set<string>();
  const seenEmployeeIds = new Set<string>();
  let periodSignature: string | null = null;
  let cursor: string | undefined;

  for (let page = 0; page < EMPLOYEE_COST_POLICY_MAX_PAGES; page += 1) {
    const result = await getEmployeeCostPolicies(
      { cursor, limit: EMPLOYEE_COST_POLICY_PAGE_LIMIT, tenantId },
      options
    );
    if (!result.ok) return result;

    for (const row of result.data.data) {
      const rowPeriodSignature = employeeCostPolicyPeriodSignature(row);
      if (periodSignature !== null && rowPeriodSignature !== periodSignature) {
        return invalidPeriodResult();
      }
      periodSignature = rowPeriodSignature;
      if (seenEmployeeIds.has(row.employeeId)) {
        return invalidPaginationResult();
      }
      seenEmployeeIds.add(row.employeeId);
      rows.push(row);
    }

    if (!result.data.pagination.hasMore) {
      return {
        data: {
          data: rows,
          pagination: {
            hasMore: false,
            limit: EMPLOYEE_COST_POLICY_PAGE_LIMIT,
            nextCursor: null
          }
        },
        ok: true,
        status: result.status
      };
    }

    const nextCursor = result.data.pagination.nextCursor;
    if (!nextCursor || seenCursors.has(nextCursor)) {
      return invalidPaginationResult();
    }
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return invalidPaginationResult();
}

function employeeCostPolicyPeriodSignature(
  row: EmployeeCostPoliciesResponse["data"][number]
) {
  return [
    row.policy.periodTimezone,
    row.daily.periodStart,
    row.daily.periodEnd,
    row.daily.resetAt,
    row.weekly.periodStart,
    row.weekly.periodEnd,
    row.weekly.resetAt
  ].join("|");
}

function invalidPeriodResult(): EmployeeCostPolicyRequestResult<EmployeeCostPoliciesResponse> {
  return {
    code: null,
    error: "Control Plane returned employee costs from inconsistent periods.",
    ok: false,
    status: 502
  };
}

export async function updateEmployeeCostPolicy(
  values: EmployeeCostPolicyUpdate,
  options?: ControlPlaneRequestOptions
): Promise<EmployeeCostPolicyRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(values.tenantId)}/employees/${encodeURIComponent(values.employeeId)}/cost-policy`,
      {
        body: JSON.stringify({
          daily: values.daily,
          enforcementMode: values.enforcementMode,
          expectedVersion: values.expectedVersion,
          warningThresholdPercent: values.warningThresholdPercent,
          weekly: values.weekly
        }),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options, {
          "Content-Type": "application/json"
        }),
        method: "PATCH"
      }
    );
    const payload = (await response.json().catch(() => null)) as unknown;
    if (!response.ok) {
      return failureResult(payload, response.status, "Employee cost policy update failed.");
    }

    const data = isRecord(payload) && "data" in payload ? payload.data : payload;
    const parsed = parseEmployeeCostPolicy(data, values.tenantId, values.employeeId);
    if (!parsed) {
      return invalidResponse("Control Plane returned an invalid employee cost policy update.");
    }

    return { data: parsed, ok: true, status: response.status };
  } catch {
    return {
      code: null,
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

function failureResult(
  payload: unknown,
  status: number,
  fallback: string
): Extract<EmployeeCostPolicyRequestResult<unknown>, { ok: false }> {
  const error = readError(payload);
  return {
    code: error.code,
    error: error.message ?? fallback,
    ok: false,
    status
  };
}

function readError(payload: unknown): { code: string | null; message: string | null } {
  if (!isRecord(payload)) {
    return { code: null, message: null };
  }

  const nestedError = isRecord(payload.error) ? payload.error : null;
  const code = readNonEmptyString(payload.code) ?? readNonEmptyString(nestedError?.code);
  const message =
    readNonEmptyString(payload.message) ??
    readNonEmptyString(nestedError?.message) ??
    (typeof payload.error === "string" ? readNonEmptyString(payload.error) : null);
  return { code, message };
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(
  error: string
): Extract<EmployeeCostPolicyRequestResult<never>, { ok: false }> {
  return {
    code: "EMPLOYEE_COST_POLICY_INVALID_RESPONSE",
    error,
    ok: false,
    status: 502
  };
}

function invalidPaginationResult(): EmployeeCostPolicyRequestResult<never> {
  return invalidResponse("Control Plane employee cost policy pagination did not terminate.");
}
