import { NextResponse } from "next/server";
import {
  createEmployee,
  disableProjectEmployeeAssignment,
  importEmployeesCsv,
  updateEmployee,
  upsertProjectEmployeeAssignment
} from "@/lib/control-plane/employees-client";
import type {
  EmployeeCreateValues,
  EmployeeCsvImportValues,
  EmployeeInvitationStatus,
  EmployeeStatus,
  EmployeeUpdateValues,
  ProjectEmployeeAssignmentValues,
  ProjectEmployeeStatus
} from "@/lib/control-plane/employees-types";

type RequestPayload = {
  action?: unknown;
  values?: unknown;
};

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

  if (payload.action === "assign" || payload.action === "disableAssignment") {
    return NextResponse.json({ assignment: result.data, status: result.status });
  }

  if (payload.action === "importCsv") {
    return NextResponse.json({ importResult: result.data, status: result.status });
  }

  return NextResponse.json({ employee: result.data, status: result.status });
}

type EmployeeAction = "assign" | "create" | "disableAssignment" | "importCsv" | "update";

async function runEmployeeAction(
  action: EmployeeAction,
  values: unknown,
  requestOptions: { cookieHeader: string | null }
) {
  if (action === "importCsv") {
    return isEmployeeCsvImportValues(values) ? importEmployeesCsv(values, requestOptions) : null;
  }

  if (action === "create") {
    return isEmployeeCreateValues(values) ? createEmployee(values, requestOptions) : null;
  }

  if (action === "update") {
    return isEmployeeUpdateValues(values) ? updateEmployee(values, requestOptions) : null;
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
    value === "disableAssignment" ||
    value === "importCsv" ||
    value === "update"
  );
}

function isEmployeeCreateValues(value: unknown): value is EmployeeCreateValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<EmployeeCreateValues>;
  return (
    typeof record.department === "string" &&
    typeof record.email === "string" &&
    typeof record.jobTitle === "string" &&
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

function isEmployeeUpdateValues(value: unknown): value is EmployeeUpdateValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<EmployeeUpdateValues>;
  return (
    typeof record.department === "string" &&
    typeof record.employeeId === "string" &&
    isInvitationStatus(record.invitationStatus) &&
    typeof record.jobTitle === "string" &&
    typeof record.name === "string" &&
    isEmployeeStatus(record.status) &&
    typeof record.tenantId === "string"
  );
}

function isProjectEmployeeAssignmentValues(
  value: unknown
): value is ProjectEmployeeAssignmentValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ProjectEmployeeAssignmentValues>;
  return (
    Array.isArray(record.allowedModelKeys) &&
    record.allowedModelKeys.every((item) => typeof item === "string") &&
    Array.isArray(record.allowedProviderConnectionIds) &&
    record.allowedProviderConnectionIds.every((item) => typeof item === "string") &&
    typeof record.employeeId === "string" &&
    typeof record.monthlyBudgetLimitUsd === "number" &&
    typeof record.policyNote === "string" &&
    typeof record.projectId === "string" &&
    (record.status === undefined || isProjectEmployeeStatus(record.status)) &&
    typeof record.warningThresholdPercent === "number"
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
