import type { ProjectRecord } from "@/lib/control-plane/projects-types";

export type EmployeeStatus = "active" | "archived" | "staged" | "suspended";
export type EmployeeInvitationStatus = "accepted" | "not_sent" | "pending" | "revoked";
export type ProjectEmployeeStatus = "active" | "disabled";

export type EmployeeRecord = {
  acceptedAt: string | null;
  createdAt: string;
  department: string | null;
  email: string;
  id: string;
  invitationStatus: EmployeeInvitationStatus;
  invitedAt: string | null;
  name: string | null;
  projectCount: number;
  status: EmployeeStatus;
  tenantId: string;
  updatedAt: string;
  userId: string | null;
};

export type EmployeeCsvSkippedRow = {
  reason: string;
  rowNumber: number;
};

export type EmployeeCsvImportResult = {
  createdCount: number;
  employees: EmployeeRecord[];
  skippedRows: EmployeeCsvSkippedRow[];
  updatedCount: number;
};

export type EmployeeOrganizationCsvImportResult = EmployeeCsvImportResult & {
  assignmentCreatedCount: number;
  assignmentUpdatedCount: number;
  assignments: ProjectEmployeeAssignmentRecord[];
  projectCreatedCount: number;
  projectUpdatedCount: number;
  projects: ProjectRecord[];
};

export type EmployeeInvitationResult = {
  employee: EmployeeRecord;
  expiresAt: string;
  signupUrl: string;
};

export type ProjectEmployeePolicy = {
  allowedModelKeys: string[];
  allowedProviderConnectionIds: string[];
  note: string | null;
};

export type ProjectEmployeeAssignmentRecord = {
  createdAt: string;
  employeeDepartment: string | null;
  employeeEmail: string;
  employeeId: string;
  employeeName: string | null;
  employeeStatus: EmployeeStatus;
  id: string;
  invitationStatus: EmployeeInvitationStatus;
  monthlyBudgetLimitMicroUsd: number;
  monthlyBudgetLimitUsd: number;
  policy: ProjectEmployeePolicy;
  projectId: string;
  status: ProjectEmployeeStatus;
  tenantId: string;
  updatedAt: string;
  warningThresholdPercent: number;
};

export type ProjectEmployeeBudgetSummary = {
  assignedBudgetUsd: number;
  projectBudgetUsd: number;
  remainingBudgetUsd: number;
};

export type ProjectEmployeesRecord = {
  budget: ProjectEmployeeBudgetSummary;
  data: ProjectEmployeeAssignmentRecord[];
  projectId: string;
  tenantId: string;
};

export type EmployeeControlModel = {
  assignmentsByProjectId: Record<string, ProjectEmployeeAssignmentRecord[]>;
  controlPlaneBaseUrl: string;
  controlPlaneTenantId: string;
  employees: EmployeeRecord[];
  loadError: string | null;
  projects: ProjectRecord[];
  routeTenantId: string;
  source: "control-plane" | "fixture";
};

export type EmployeeCreateValues = {
  department: string;
  email: string;
  name: string;
  tenantId?: string;
};

export type EmployeeUpdateValues = {
  department: string;
  employeeId: string;
  invitationStatus: EmployeeInvitationStatus;
  name: string;
  status: EmployeeStatus;
  tenantId: string;
};

export type EmployeeCsvImportValues = {
  csvText: string;
  defaultDepartment: string;
  tenantId: string;
};

export type EmployeeOrganizationCsvImportValues = {
  csvText: string;
  tenantId: string;
};

export type EmployeeInvitationValues = {
  employeeId: string;
  tenantId: string;
};

export type ProjectEmployeeAssignmentValues = {
  allowedModelKeys: string[];
  allowedProviderConnectionIds: string[];
  employeeId: string;
  monthlyBudgetLimitUsd: number;
  policyNote: string;
  projectId: string;
  status?: ProjectEmployeeStatus;
  warningThresholdPercent: number;
};
