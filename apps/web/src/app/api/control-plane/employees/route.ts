import { NextResponse } from "next/server";
import {
  getCurrentConsoleAuthForCookieHeader,
  resolveConsoleTenantIdForAuth
} from "@/lib/auth/current-console-auth";
import { hasConsoleTenantAccess } from "@/lib/auth/console-tenant-access";
import {
  createEmployee,
  deleteEmployeeInvitation,
  disableProjectEmployeeAssignment,
  importEmployeeOrganizationCsv,
  importEmployeesCsv,
  sendEmployeeInvitation,
  updateEmployee,
  upsertProjectEmployeeAssignment
} from "@/lib/control-plane/employees-client";
import {
  controlPlaneReadCacheTags,
  controlPlaneTenantReadCacheTag,
  revalidateControlPlaneRead
} from "@/lib/control-plane/read-cache";
import {
  getControlPlaneBaseUrl,
  resolveControlPlaneTenantId
} from "@/lib/control-plane/control-plane-config";
import { buildControlPlaneHeaders } from "@/lib/control-plane/control-plane-request";
import { getEmployeeUsage } from "@/lib/control-plane/employee-usage-client";
import type {
  EmployeeCreateValues,
  EmployeeCsvImportValues,
  EmployeeInvitationStatus,
  EmployeeInvitationValues,
  EmployeeOrganizationCsvImportValues,
  EmployeeStatus,
  EmployeeUpdateValues,
  ProjectEmployeeAssignmentValues,
  ProjectEmployeeStatus
} from "@/lib/control-plane/employees-types";

type RequestPayload = {
  action?: unknown;
  values?: unknown;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type EmployeeWeeklyTokenQuotaRequestResult =
  | {
      data: Record<string, unknown>;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type EmployeeWeeklyTokenQuotaUpdateValues = {
  employeeId: string;
  enabled: boolean;
  expectedVersion?: number;
  limitTokens: number;
  tenantId: string;
};

type TenantChatUsageRange = "24h" | "7d" | "30d";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const routeTenantId = url.searchParams.get("tenantId")?.trim();
  const range = url.searchParams.get("range") as TenantChatUsageRange | null;
  if (!routeTenantId || !range || !isTenantChatUsageRange(range)) {
    return NextResponse.json({ error: "Invalid tenant chat usage query." }, { status: 400 });
  }

  const cookieHeader = request.headers.get("cookie");
  const auth = await getCurrentConsoleAuthForCookieHeader(cookieHeader);
  const effectiveTenantId = resolveConsoleTenantIdForAuth(auth, routeTenantId);
  if (!hasConsoleTenantAccess(auth, effectiveTenantId)) {
    return NextResponse.json({ error: "Tenant access is required." }, { status: 403 });
  }

  const to = new Date();
  const from = new Date(to.getTime() - tenantChatUsageRangeMs(range));
  const result = await getEmployeeUsage(
    {
      from: from.toISOString(),
      metric: "cost",
      order: "desc",
      source: "tenant_chat",
      tenantId: resolveControlPlaneTenantId(effectiveTenantId),
      to: to.toISOString()
    },
    { cookieHeader }
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, status: result.status },
      { status: result.status > 0 ? result.status : 502 }
    );
  }
  return NextResponse.json({ data: result.data });
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;
  const requestOptions = { cookieHeader: request.headers.get("cookie") };

  if (!isEmployeeAction(payload.action)) {
    return NextResponse.json({ error: "Unknown employee action." }, { status: 400 });
  }

  const result = await runEmployeeAction(payload.action, payload.values, requestOptions);

  if (!result) {
    return NextResponse.json({ error: "Invalid employee payload." }, { status: 400 });
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        status: result.status
      },
      { status: result.status > 0 ? result.status : 502 }
    );
  }

  const tenantId = getEmployeeMutationTenantId(payload.values, result.data);
  if (tenantId) {
    revalidateControlPlaneRead([
      controlPlaneReadCacheTags.employees,
      controlPlaneTenantReadCacheTag("employees", tenantId)
    ]);
  }

  if (payload.action === "assign" || payload.action === "disableAssignment") {
    return NextResponse.json({ assignment: result.data, status: result.status });
  }

  if (payload.action === "importCsv" || payload.action === "importOrganizationCsv") {
    return NextResponse.json({ importResult: result.data, status: result.status });
  }

  if (payload.action === "invite") {
    return NextResponse.json({ invitation: result.data, status: result.status });
  }

  if (payload.action === "updateWeeklyTokenQuota") {
    return NextResponse.json({ weeklyTokenQuota: result.data, status: result.status });
  }

  return NextResponse.json({ employee: result.data, status: result.status });
}

type EmployeeAction =
  | "assign"
  | "create"
  | "deleteInvitation"
  | "disableAssignment"
  | "importCsv"
  | "importOrganizationCsv"
  | "invite"
  | "update"
  | "updateWeeklyTokenQuota";

async function runEmployeeAction(
  action: EmployeeAction,
  values: unknown,
  requestOptions: { cookieHeader: string | null }
) {
  if (action === "importCsv") {
    return isEmployeeCsvImportValues(values) ? importEmployeesCsv(values, requestOptions) : null;
  }

  if (action === "importOrganizationCsv") {
    return isEmployeeOrganizationCsvImportValues(values)
      ? importEmployeeOrganizationCsv(values, requestOptions)
      : null;
  }

  if (action === "invite") {
    return isEmployeeInvitationValues(values) ? sendEmployeeInvitation(values, requestOptions) : null;
  }

  if (action === "deleteInvitation") {
    return isEmployeeInvitationValues(values)
      ? deleteEmployeeInvitation(values, requestOptions)
      : null;
  }

  if (action === "create") {
    return isEmployeeCreateValues(values) ? createEmployee(values, requestOptions) : null;
  }

  if (action === "update") {
    return isEmployeeUpdateValues(values) ? updateEmployee(values, requestOptions) : null;
  }

  if (action === "updateWeeklyTokenQuota") {
    return isEmployeeWeeklyTokenQuotaUpdateValues(values)
      ? updateEmployeeWeeklyTokenQuota(values, requestOptions)
      : null;
  }

  if (action === "assign") {
    return isProjectEmployeeAssignmentValues(values)
      ? upsertProjectEmployeeAssignment(values, requestOptions)
      : null;
  }

  return isProjectEmployeeDisableValues(values)
    ? disableProjectEmployeeAssignment(values, requestOptions)
    : null;
}

function isEmployeeAction(value: unknown): value is EmployeeAction {
  return (
    value === "assign" ||
    value === "create" ||
    value === "deleteInvitation" ||
    value === "disableAssignment" ||
    value === "importCsv" ||
    value === "importOrganizationCsv" ||
    value === "invite" ||
    value === "update" || value === "updateWeeklyTokenQuota"
  );
}

async function updateEmployeeWeeklyTokenQuota(
  values: EmployeeWeeklyTokenQuotaUpdateValues,
  requestOptions: { cookieHeader: string | null }
): Promise<EmployeeWeeklyTokenQuotaRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(values.tenantId)}/employees/${encodeURIComponent(values.employeeId)}/weekly-token-quota`,
      {
        body: JSON.stringify({
          enabled: values.enabled,
          limitTokens: values.limitTokens,
          ...(values.expectedVersion !== undefined ? { expectedVersion: values.expectedVersion } : {})
        }),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(requestOptions, { "Content-Type": "application/json" }),
        method: "PATCH"
      }
    );
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { error: getControlPlaneErrorMessage(payload, response.status), ok: false, status: response.status };
    }
    const data = getControlPlaneData(payload);
    return data
      ? { data, ok: true, status: response.status }
      : { error: "Control Plane response did not include employee weekly token quota data.", ok: false, status: response.status };
  } catch {
    return { error: "Control Plane unavailable.", ok: false, status: 0 };
  }
}

function isEmployeeWeeklyTokenQuotaUpdateValues(value: unknown): value is EmployeeWeeklyTokenQuotaUpdateValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<EmployeeWeeklyTokenQuotaUpdateValues>;
  return (
    typeof record.employeeId === "string" && UUID_PATTERN.test(record.employeeId) &&
    typeof record.tenantId === "string" && UUID_PATTERN.test(record.tenantId) &&
    typeof record.enabled === "boolean" &&
    isNonNegativeSafeInteger(record.limitTokens) &&
    (record.expectedVersion === undefined || (Number.isSafeInteger(record.expectedVersion) && record.expectedVersion > 0))
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTenantChatUsageRange(value: string): value is TenantChatUsageRange {
  return value === "24h" || value === "7d" || value === "30d";
}

function tenantChatUsageRangeMs(range: TenantChatUsageRange) {
  if (range === "24h") return 24 * 60 * 60 * 1000;
  if (range === "7d") return 7 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

function getControlPlaneData(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const data = (payload as Record<string, unknown>).data;
  return data && typeof data === "object" && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

function getControlPlaneErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    const message = record.message ?? record.error;

    if (typeof message === "string" && message.trim()) {
      return message;
    }

    if (message && typeof message === "object" && !Array.isArray(message)) {
      const nestedMessage = (message as Record<string, unknown>).message;
      if (typeof nestedMessage === "string" && nestedMessage.trim()) {
        return nestedMessage;
      }
    }
  }

  return `Control Plane request failed with HTTP ${status}.`;
}

function isEmployeeCreateValues(value: unknown): value is EmployeeCreateValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<EmployeeCreateValues>;
  return (
    typeof record.department === "string" &&
    typeof record.email === "string" &&
    typeof record.name === "string" &&
    typeof record.tenantId === "string"
  );
}

function isEmployeeCsvImportValues(value: unknown): value is EmployeeCsvImportValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<EmployeeCsvImportValues>;
  return (
    typeof record.csvText === "string" &&
    typeof record.defaultDepartment === "string" &&
    typeof record.tenantId === "string"
  );
}

function isEmployeeOrganizationCsvImportValues(
  value: unknown
): value is EmployeeOrganizationCsvImportValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<EmployeeOrganizationCsvImportValues>;
  return typeof record.csvText === "string" && typeof record.tenantId === "string";
}

function isEmployeeInvitationValues(value: unknown): value is EmployeeInvitationValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<EmployeeInvitationValues>;
  return typeof record.employeeId === "string" && typeof record.tenantId === "string";
}

function isEmployeeUpdateValues(value: unknown): value is EmployeeUpdateValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<EmployeeUpdateValues>;
  return (
    (record.department === undefined || typeof record.department === "string") &&
    typeof record.employeeId === "string" &&
    (record.invitationStatus === undefined || isInvitationStatus(record.invitationStatus)) &&
    (record.name === undefined || typeof record.name === "string") &&
    (record.status === undefined || isEmployeeStatus(record.status)) &&
    typeof record.tenantId === "string"
  );
}

function getEmployeeMutationTenantId(values: unknown, data: unknown) {
  if (values && typeof values === "object" && "tenantId" in values) {
    const tenantId = (values as { tenantId?: unknown }).tenantId;
    if (typeof tenantId === "string") {
      return tenantId;
    }
  }

  if (data && typeof data === "object" && "tenantId" in data) {
    const tenantId = (data as { tenantId?: unknown }).tenantId;
    if (typeof tenantId === "string") {
      return tenantId;
    }
  }

  return null;
}

function isProjectEmployeeAssignmentValues(
  value: unknown
): value is ProjectEmployeeAssignmentValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProjectEmployeeAssignmentValues>;
  return (
    (record.dailyTokenLimit === undefined ||
      (typeof record.dailyTokenLimit === "number" &&
        Number.isInteger(record.dailyTokenLimit) &&
        record.dailyTokenLimit >= 0 &&
        record.dailyTokenLimit <= 1000000000)) &&
    typeof record.employeeId === "string" &&
    typeof record.monthlyBudgetLimitUsd === "number" &&
    Number.isFinite(record.monthlyBudgetLimitUsd) &&
    record.monthlyBudgetLimitUsd >= 0 &&
    record.monthlyBudgetLimitUsd <= 100000000 &&
    typeof record.policyNote === "string" &&
    typeof record.projectId === "string" &&
    (record.rateLimitEnabled === undefined || typeof record.rateLimitEnabled === "boolean") &&
    (record.rateLimitLimit === undefined ||
      (typeof record.rateLimitLimit === "number" &&
        Number.isInteger(record.rateLimitLimit) &&
        record.rateLimitLimit >= 1 &&
        record.rateLimitLimit <= 100000)) &&
    (record.rateLimitWindowSeconds === undefined ||
      (typeof record.rateLimitWindowSeconds === "number" &&
        Number.isInteger(record.rateLimitWindowSeconds) &&
        record.rateLimitWindowSeconds >= 1 &&
        record.rateLimitWindowSeconds <= 3600)) &&
    (record.status === undefined || isProjectEmployeeStatus(record.status)) &&
    typeof record.warningThresholdPercent === "number" &&
    Number.isInteger(record.warningThresholdPercent) &&
    record.warningThresholdPercent >= 0 &&
    record.warningThresholdPercent <= 100
  );
}

function isProjectEmployeeDisableValues(
  value: unknown
): value is Pick<ProjectEmployeeAssignmentValues, "employeeId" | "projectId"> {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProjectEmployeeAssignmentValues>;
  return typeof record.employeeId === "string" && typeof record.projectId === "string";
}

function isEmployeeStatus(value: unknown): value is EmployeeStatus {
  return value === "active" || value === "archived" || value === "staged" || value === "suspended";
}

function isInvitationStatus(value: unknown): value is EmployeeInvitationStatus {
  return value === "accepted" || value === "not_sent" || value === "pending" || value === "revoked";
}

function isProjectEmployeeStatus(value: unknown): value is ProjectEmployeeStatus {
  return value === "active" || value === "disabled";
}
