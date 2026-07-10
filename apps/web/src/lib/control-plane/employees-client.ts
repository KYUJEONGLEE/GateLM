import "server-only";

import {
  getControlPlaneBaseUrl,
  resolveControlPlaneTenantId
} from "@/lib/control-plane/control-plane-config";
import {
  buildControlPlaneHeaders,
  type ControlPlaneRequestOptions
} from "@/lib/control-plane/control-plane-request";
import {
  cachedControlPlaneRead,
  CONTROL_PLANE_READ_CACHE_SECONDS,
  controlPlaneReadCacheTags,
  controlPlaneTenantReadCacheTag
} from "@/lib/control-plane/read-cache";
import { listControlPlaneProjectsFresh } from "@/lib/control-plane/projects-client";
import type {
  EmployeeControlModel,
  EmployeeCreateValues,
  EmployeeCsvImportResult,
  EmployeeCsvImportValues,
  EmployeeInvitationResult,
  EmployeeInvitationStatus,
  EmployeeInvitationValues,
  EmployeeOrganizationCsvImportResult,
  EmployeeOrganizationCsvImportValues,
  EmployeeRecord,
  EmployeeStatus,
  EmployeeUpdateValues,
  ProjectEmployeeAssignmentRecord,
  ProjectEmployeeAssignmentValues,
  ProjectEmployeePolicy,
  ProjectEmployeesRecord,
  ProjectEmployeeStatus
} from "@/lib/control-plane/employees-types";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";

type EmployeeRequestResult =
  | {
      data: EmployeeRecord;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type EmployeeImportRequestResult =
  | {
      data: EmployeeCsvImportResult;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type EmployeeOrganizationImportRequestResult =
  | {
      data: EmployeeOrganizationCsvImportResult;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type EmployeeInvitationRequestResult =
  | {
      data: EmployeeInvitationResult;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type EmployeeListResult =
  | {
      data: EmployeeRecord[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ProjectEmployeeRequestResult =
  | {
      data: ProjectEmployeeAssignmentRecord;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ProjectEmployeesRequestResult =
  | {
      data: ProjectEmployeesRecord;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

export async function getEmployeeControlModel(
  routeTenantId: string
): Promise<EmployeeControlModel> {
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const controlPlaneTenantId = resolveControlPlaneTenantId(routeTenantId);
  const [employeesResult, projectsResult] = await Promise.all([
    listEmployees(controlPlaneTenantId),
    listControlPlaneProjectsFresh(controlPlaneTenantId)
  ]);

  if (employeesResult.ok && projectsResult.ok) {
    const assignmentResults = await Promise.all(
      projectsResult.data.map((project) => listProjectEmployees(project.id))
    );
    const failedAssignment = assignmentResults.find((result) => !result.ok);

    return {
      assignmentsByProjectId: Object.fromEntries(
        assignmentResults
          .filter((result): result is Extract<ProjectEmployeesRequestResult, { ok: true }> =>
            result.ok
          )
          .map((result) => [result.data.projectId, result.data.data])
      ),
      controlPlaneBaseUrl,
      controlPlaneTenantId,
      employees: employeesResult.data,
      loadError: failedAssignment && !failedAssignment.ok ? failedAssignment.error : null,
      projects: projectsResult.data,
      routeTenantId,
      source: failedAssignment ? "fixture" : "control-plane"
    };
  }

  const projects = projectsResult.ok ? projectsResult.data : getFixtureProjects(controlPlaneTenantId);

  return {
    assignmentsByProjectId: {},
    controlPlaneBaseUrl,
    controlPlaneTenantId,
    employees: employeesResult.ok ? employeesResult.data : getFixtureEmployees(controlPlaneTenantId),
    loadError: employeesResult.ok
      ? projectsResult.ok
        ? null
        : projectsResult.error
      : employeesResult.error,
    projects,
    routeTenantId,
    source: "fixture"
  };
}

export async function getTenantEmployees(routeTenantId: string): Promise<EmployeeRecord[]> {
  const controlPlaneTenantId = resolveControlPlaneTenantId(routeTenantId);
  try {
    return await cachedControlPlaneRead(
      ["control-plane", "employees", controlPlaneTenantId],
      async () => {
        const result = await listEmployees(controlPlaneTenantId);
        if (!result.ok) {
          throw new Error(result.error);
        }
        return result.data;
      },
      {
        revalidate: CONTROL_PLANE_READ_CACHE_SECONDS.employees,
        tags: [
          controlPlaneReadCacheTags.employees,
          controlPlaneTenantReadCacheTag("employees", controlPlaneTenantId)
        ]
      }
    );
  } catch {
    return getFixtureEmployees(controlPlaneTenantId);
  }
}

export async function getProjectEmployeeControlModel(
  routeTenantId: string,
  project: ProjectRecord
): Promise<EmployeeControlModel> {
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const controlPlaneTenantId = resolveControlPlaneTenantId(routeTenantId);
  const [employeesResult, assignmentsResult] = await Promise.all([
    listEmployees(controlPlaneTenantId),
    listProjectEmployees(project.id)
  ]);

  if (employeesResult.ok && assignmentsResult.ok) {
    return {
      assignmentsByProjectId: {
        [project.id]: assignmentsResult.data.data
      },
      controlPlaneBaseUrl,
      controlPlaneTenantId,
      employees: employeesResult.data,
      loadError: null,
      projects: [project],
      routeTenantId,
      source: "control-plane"
    };
  }

  const loadError = [
    employeesResult.ok ? null : employeesResult.error,
    assignmentsResult.ok ? null : assignmentsResult.error
  ]
    .filter((error): error is string => Boolean(error))
    .join(" ");

  return {
    assignmentsByProjectId: assignmentsResult.ok
      ? { [project.id]: assignmentsResult.data.data }
      : {},
    controlPlaneBaseUrl,
    controlPlaneTenantId,
    employees: employeesResult.ok
      ? employeesResult.data
      : getFixtureEmployees(controlPlaneTenantId),
    loadError,
    projects: [project],
    routeTenantId,
    source: "fixture"
  };
}

export async function importEmployeesCsv(
  values: EmployeeCsvImportValues,
  options?: ControlPlaneRequestOptions
): Promise<EmployeeImportRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(values.tenantId)}/employees/import-csv`,
      {
        body: JSON.stringify({
          csvText: values.csvText,
          defaultDepartment: values.defaultDepartment.trim() || undefined
        }),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options, {
          "Content-Type": "application/json"
        }),
        method: "POST"
      }
    );

    return readEmployeeImportResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function importEmployeeOrganizationCsv(
  values: EmployeeOrganizationCsvImportValues,
  options?: ControlPlaneRequestOptions
): Promise<EmployeeOrganizationImportRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(values.tenantId)}/employees/import-organization-csv`,
      {
        body: JSON.stringify({
          csvText: values.csvText
        }),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options, {
          "Content-Type": "application/json"
        }),
        method: "POST"
      }
    );

    return readEmployeeOrganizationImportResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function sendEmployeeInvitation(
  values: EmployeeInvitationValues,
  options?: ControlPlaneRequestOptions
): Promise<EmployeeInvitationRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(values.tenantId)}/employees/${encodeURIComponent(values.employeeId)}/invitations`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options),
        method: "POST"
      }
    );

    return readEmployeeInvitationResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function createEmployee(
  values: EmployeeCreateValues,
  options?: ControlPlaneRequestOptions
): Promise<EmployeeRequestResult> {
  const tenantId = values.tenantId?.trim();

  if (!tenantId) {
    return {
      error: "Tenant id is required.",
      ok: false,
      status: 400
    };
  }

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/employees`,
      {
        body: JSON.stringify({
          department: values.department.trim() || undefined,
          email: values.email.trim(),
          name: values.name.trim() || undefined
        }),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options, {
          "Content-Type": "application/json"
        }),
        method: "POST"
      }
    );

    return readEmployeeResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function updateEmployee(
  values: EmployeeUpdateValues,
  options?: ControlPlaneRequestOptions
): Promise<EmployeeRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(values.tenantId)}/employees/${encodeURIComponent(values.employeeId)}`,
      {
        body: JSON.stringify({
          department: values.department?.trim(),
          invitationStatus: values.invitationStatus,
          name: values.name?.trim(),
          status: values.status
        }),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options, {
          "Content-Type": "application/json"
        }),
        method: "PATCH"
      }
    );

    return readEmployeeResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function upsertProjectEmployeeAssignment(
  values: ProjectEmployeeAssignmentValues,
  options?: ControlPlaneRequestOptions
): Promise<ProjectEmployeeRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(values.projectId)}/employees/${encodeURIComponent(values.employeeId)}`,
      {
        body: JSON.stringify({
          allowedModelKeys: values.allowedModelKeys,
          allowedProviderConnectionIds: values.allowedProviderConnectionIds,
          monthlyBudgetLimitUsd: values.monthlyBudgetLimitUsd,
          policyNote: values.policyNote.trim() || undefined,
          status: values.status ?? "active",
          warningThresholdPercent: values.warningThresholdPercent
        }),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options, {
          "Content-Type": "application/json"
        }),
        method: "POST"
      }
    );

    return readProjectEmployeeResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function disableProjectEmployeeAssignment(
  values: Pick<ProjectEmployeeAssignmentValues, "employeeId" | "projectId">,
  options?: ControlPlaneRequestOptions
): Promise<ProjectEmployeeRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(values.projectId)}/employees/${encodeURIComponent(values.employeeId)}`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options),
        method: "DELETE"
      }
    );

    return readProjectEmployeeResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function listEmployees(tenantId: string): Promise<EmployeeListResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/tenants/${encodeURIComponent(tenantId)}/employees?limit=200`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders()
      }
    );

    return readEmployeeListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function listProjectEmployees(projectId: string): Promise<ProjectEmployeesRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/employees`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders()
      }
    );

    return readProjectEmployeesResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function readEmployeeResponse(response: Response): Promise<EmployeeRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const employee = getEmployeeFromPayload(payload);

  if (!employee) {
    return {
      error: "Control Plane response did not include employee data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: employee,
    ok: true,
    status: response.status
  };
}

async function readEmployeeImportResponse(
  response: Response
): Promise<EmployeeImportRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const result = getEmployeeImportFromPayload(payload);

  if (!result) {
    return {
      error: "Control Plane response did not include employee import data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: result,
    ok: true,
    status: response.status
  };
}

async function readEmployeeOrganizationImportResponse(
  response: Response
): Promise<EmployeeOrganizationImportRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const result = getEmployeeOrganizationImportFromPayload(payload);

  if (!result) {
    return {
      error: "Control Plane response did not include organization import data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: result,
    ok: true,
    status: response.status
  };
}

async function readEmployeeInvitationResponse(
  response: Response
): Promise<EmployeeInvitationRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const invitation = getEmployeeInvitationFromPayload(payload);

  if (!invitation) {
    return {
      error: "Control Plane response did not include employee invitation data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: invitation,
    ok: true,
    status: response.status
  };
}

async function readEmployeeListResponse(response: Response): Promise<EmployeeListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const employees = getEmployeesFromPayload(payload);

  if (!employees) {
    return {
      error: "Control Plane response did not include employee list.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: employees,
    ok: true,
    status: response.status
  };
}

async function readProjectEmployeeResponse(
  response: Response
): Promise<ProjectEmployeeRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const assignment = getProjectEmployeeFromPayload(payload);

  if (!assignment) {
    return {
      error: "Control Plane response did not include project employee data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: assignment,
    ok: true,
    status: response.status
  };
}

async function readProjectEmployeesResponse(
  response: Response
): Promise<ProjectEmployeesRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const projectEmployees = getProjectEmployeesFromPayload(payload);

  if (!projectEmployees) {
    return {
      error: "Control Plane response did not include project employees.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: projectEmployees,
    ok: true,
    status: response.status
  };
}

function getEmployeeFromPayload(payload: unknown): EmployeeRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  return toEmployeeRecord(record.data ?? record);
}

function getEmployeesFromPayload(payload: unknown): EmployeeRecord[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.data)) {
    return null;
  }

  const employees = record.data.map(toEmployeeRecord);
  return employees.some((employee) => employee === null) ? null : (employees as EmployeeRecord[]);
}

function getEmployeeImportFromPayload(payload: unknown): EmployeeCsvImportResult | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const data = record.data ?? record;

  if (!data || typeof data !== "object") {
    return null;
  }

  const value = data as Record<string, unknown>;
  const employees = Array.isArray(value.employees) ? value.employees.map(toEmployeeRecord) : null;
  const skippedRows = Array.isArray(value.skippedRows)
    ? value.skippedRows
        .map((row) => {
          if (!row || typeof row !== "object") {
            return null;
          }
          const skipped = row as Record<string, unknown>;
          return typeof skipped.reason === "string" && typeof skipped.rowNumber === "number"
            ? { reason: skipped.reason, rowNumber: skipped.rowNumber }
            : null;
        })
        .filter((row): row is { reason: string; rowNumber: number } => row !== null)
    : [];

  if (
    !employees ||
    employees.some((employee) => employee === null) ||
    typeof value.createdCount !== "number" ||
    typeof value.updatedCount !== "number"
  ) {
    return null;
  }

  return {
    createdCount: value.createdCount,
    employees: employees as EmployeeRecord[],
    skippedRows,
    updatedCount: value.updatedCount
  };
}

function getEmployeeOrganizationImportFromPayload(
  payload: unknown
): EmployeeOrganizationCsvImportResult | null {
  const base = getEmployeeImportFromPayload(payload);
  if (!base || !payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const data = record.data ?? record;
  if (!data || typeof data !== "object") {
    return null;
  }

  const value = data as Record<string, unknown>;
  const projects = Array.isArray(value.projects) ? value.projects.map(toProjectRecord) : null;
  const assignments = Array.isArray(value.assignments)
    ? value.assignments.map(toProjectEmployeeAssignmentRecord)
    : null;

  if (
    !projects ||
    !assignments ||
    projects.some((project) => project === null) ||
    assignments.some((assignment) => assignment === null) ||
    typeof value.projectCreatedCount !== "number" ||
    typeof value.projectUpdatedCount !== "number" ||
    typeof value.assignmentCreatedCount !== "number" ||
    typeof value.assignmentUpdatedCount !== "number"
  ) {
    return null;
  }

  return {
    ...base,
    assignmentCreatedCount: value.assignmentCreatedCount,
    assignmentUpdatedCount: value.assignmentUpdatedCount,
    assignments: assignments as ProjectEmployeeAssignmentRecord[],
    projectCreatedCount: value.projectCreatedCount,
    projectUpdatedCount: value.projectUpdatedCount,
    projects: projects as ProjectRecord[]
  };
}

function getEmployeeInvitationFromPayload(payload: unknown): EmployeeInvitationResult | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const data = record.data ?? record;
  if (!data || typeof data !== "object") {
    return null;
  }

  const value = data as Record<string, unknown>;
  const employee = toEmployeeRecord(value.employee);
  if (!employee || typeof value.expiresAt !== "string" || typeof value.signupUrl !== "string") {
    return null;
  }

  return {
    employee,
    expiresAt: value.expiresAt,
    signupUrl: value.signupUrl
  };
}

function getProjectEmployeeFromPayload(payload: unknown): ProjectEmployeeAssignmentRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  return toProjectEmployeeAssignmentRecord(record.data ?? record);
}

function getProjectEmployeesFromPayload(payload: unknown): ProjectEmployeesRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const value = record.data ?? record;

  if (!value || typeof value !== "object") {
    return null;
  }

  const projectEmployees = value as Record<string, unknown>;
  if (
    typeof projectEmployees.projectId !== "string" ||
    typeof projectEmployees.tenantId !== "string" ||
    !Array.isArray(projectEmployees.data)
  ) {
    return null;
  }

  const assignments = projectEmployees.data.map(toProjectEmployeeAssignmentRecord);
  if (assignments.some((assignment) => assignment === null)) {
    return null;
  }

  const budget = toProjectEmployeeBudget(projectEmployees.budget);
  if (!budget) {
    return null;
  }

  return {
    budget,
    data: assignments as ProjectEmployeeAssignmentRecord[],
    projectId: projectEmployees.projectId,
    tenantId: projectEmployees.tenantId
  };
}

function toEmployeeRecord(value: unknown): EmployeeRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeEmployeeStatus(record.status);
  const invitationStatus = normalizeInvitationStatus(record.invitationStatus);

  if (
    typeof record.id !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.email !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.projectCount !== "number" ||
    !status ||
    !invitationStatus
  ) {
    return null;
  }

  return {
    acceptedAt: typeof record.acceptedAt === "string" ? record.acceptedAt : null,
    createdAt: record.createdAt,
    department: typeof record.department === "string" ? record.department : null,
    email: record.email,
    id: record.id,
    invitationStatus,
    invitedAt: typeof record.invitedAt === "string" ? record.invitedAt : null,
    name: typeof record.name === "string" ? record.name : null,
    projectCount: record.projectCount,
    status,
    tenantId: record.tenantId,
    updatedAt: record.updatedAt,
    userId: typeof record.userId === "string" ? record.userId : null
  };
}

function toProjectRecord(value: unknown): ProjectRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeProjectStatus(record.status);
  if (
    typeof record.id !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.name !== "string" ||
    typeof record.totalBudgetUsd !== "number" ||
    typeof record.warningThresholdPercent !== "number" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    !status
  ) {
    return null;
  }

  return {
    createdAt: record.createdAt,
    description: typeof record.description === "string" ? record.description : null,
    id: record.id,
    name: record.name,
    runtimeApplicationId:
      typeof record.runtimeApplicationId === "string" ? record.runtimeApplicationId : null,
    status,
    tenantId: record.tenantId,
    totalBudgetUsd: record.totalBudgetUsd,
    updatedAt: record.updatedAt,
    warningThresholdPercent: record.warningThresholdPercent
  };
}

function toProjectEmployeeAssignmentRecord(
  value: unknown
): ProjectEmployeeAssignmentRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const employeeStatus = normalizeEmployeeStatus(record.employeeStatus);
  const invitationStatus = normalizeInvitationStatus(record.invitationStatus);
  const status = normalizeProjectEmployeeStatus(record.status);
  const policy = toProjectEmployeePolicy(record.policy);

  if (
    typeof record.id !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.projectId !== "string" ||
    typeof record.employeeId !== "string" ||
    typeof record.employeeEmail !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.monthlyBudgetLimitMicroUsd !== "number" ||
    typeof record.monthlyBudgetLimitUsd !== "number" ||
    typeof record.warningThresholdPercent !== "number" ||
    !employeeStatus ||
    !invitationStatus ||
    !status ||
    !policy
  ) {
    return null;
  }

  return {
    createdAt: record.createdAt,
    employeeDepartment:
      typeof record.employeeDepartment === "string" ? record.employeeDepartment : null,
    employeeEmail: record.employeeEmail,
    employeeId: record.employeeId,
    employeeName: typeof record.employeeName === "string" ? record.employeeName : null,
    employeeStatus,
    id: record.id,
    invitationStatus,
    monthlyBudgetLimitMicroUsd: record.monthlyBudgetLimitMicroUsd,
    monthlyBudgetLimitUsd: record.monthlyBudgetLimitUsd,
    policy,
    projectId: record.projectId,
    status,
    tenantId: record.tenantId,
    updatedAt: record.updatedAt,
    warningThresholdPercent: record.warningThresholdPercent
  };
}

function toProjectEmployeePolicy(value: unknown): ProjectEmployeePolicy | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  return {
    allowedModelKeys: readStringArray(record.allowedModelKeys),
    allowedProviderConnectionIds: readStringArray(record.allowedProviderConnectionIds),
    note: typeof record.note === "string" && record.note.trim() ? record.note : null
  };
}

function toProjectEmployeeBudget(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.assignedBudgetUsd !== "number" ||
    typeof record.projectBudgetUsd !== "number" ||
    typeof record.remainingBudgetUsd !== "number"
  ) {
    return null;
  }

  return {
    assignedBudgetUsd: record.assignedBudgetUsd,
    projectBudgetUsd: record.projectBudgetUsd,
    remainingBudgetUsd: record.remainingBudgetUsd
  };
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function normalizeEmployeeStatus(value: unknown): EmployeeStatus | null {
  return value === "active" || value === "archived" || value === "staged" || value === "suspended"
    ? value
    : null;
}

function normalizeInvitationStatus(value: unknown): EmployeeInvitationStatus | null {
  return value === "accepted" || value === "not_sent" || value === "pending" || value === "revoked"
    ? value
    : null;
}

function normalizeProjectEmployeeStatus(value: unknown): ProjectEmployeeStatus | null {
  return value === "active" || value === "disabled" ? value : null;
}

function normalizeProjectStatus(value: unknown): ProjectRecord["status"] | null {
  return value === "ACTIVE" || value === "ARCHIVED" || value === "DISABLED" || value === "DRAFT"
    ? value
    : null;
}

function getErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.message ?? record.error;

    if (typeof message === "string") {
      return message;
    }

    if (message && typeof message === "object") {
      const nestedMessage = (message as Record<string, unknown>).message;

      if (typeof nestedMessage === "string" && nestedMessage.trim()) {
        return nestedMessage;
      }
    }
  }

  return `Control Plane request failed with HTTP ${status}.`;
}

function getFixtureEmployees(tenantId: string): EmployeeRecord[] {
  const timestamp = "2026-07-09T00:00:00.000Z";

  return [
    {
      acceptedAt: null,
      createdAt: timestamp,
      department: "Support",
      email: "minji@example.com",
      id: "employee_fixture_minji",
      invitationStatus: "not_sent",
      invitedAt: null,
      name: "Minji Kim",
      projectCount: 0,
      status: "staged",
      tenantId,
      updatedAt: timestamp,
      userId: null
    },
    {
      acceptedAt: null,
      createdAt: timestamp,
      department: "Platform",
      email: "junho@example.com",
      id: "employee_fixture_junho",
      invitationStatus: "not_sent",
      invitedAt: null,
      name: "Junho Lee",
      projectCount: 0,
      status: "staged",
      tenantId,
      updatedAt: timestamp,
      userId: null
    }
  ];
}

function getFixtureProjects(tenantId: string): ProjectRecord[] {
  const timestamp = "2026-07-09T00:00:00.000Z";

  return [
    {
      createdAt: timestamp,
      description: "Employee chatbot access project.",
      id: "project_fixture_employee_chat",
      name: "Employee Chat",
      runtimeApplicationId: null,
      status: "ACTIVE",
      tenantId,
      totalBudgetUsd: 100,
      updatedAt: timestamp,
      warningThresholdPercent: 80
    }
  ];
}
