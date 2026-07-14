import type {
  EmployeeControlModel,
  EmployeeRecord,
  ProjectEmployeeAssignmentRecord,
  ProjectEmployeeQuotaStatus
} from "@/lib/control-plane/employees-types";

export type EmployeeProjectUsage = {
  dailyTokenLimit: number | null;
  dailyTokens: number;
  monthlyBudgetLimitUsd: number;
  monthlyCostUsd: number;
  projectId: string;
  projectName: string;
  quotaStatus: ProjectEmployeeQuotaStatus;
};

export type EmployeeUsageRow = {
  dailyTokenLimit: number | null;
  dailyTokens: number;
  department: string | null;
  email: string;
  employeeId: string;
  invitationStatus: EmployeeRecord["invitationStatus"];
  monthlyBudgetLimitUsd: number;
  monthlyCostUsd: number;
  name: string;
  projectCount: number;
  projects: EmployeeProjectUsage[];
  quotaStatus: ProjectEmployeeQuotaStatus;
  rank: number;
  status: EmployeeRecord["status"];
  tokenShare: number;
};

export type EmployeeUsageReadModel = {
  activeEmployees: number;
  averageDailyTokens: number;
  rows: EmployeeUsageRow[];
  totalDailyTokens: number;
  totalMonthlyCostUsd: number;
  trackedEmployees: number;
};

const quotaSeverity: Record<ProjectEmployeeQuotaStatus, number> = {
  exceeded: 3,
  warning: 2,
  within_limit: 1,
  not_configured: 0
};

export function buildEmployeeUsageReadModel(model: EmployeeControlModel): EmployeeUsageReadModel {
  const projectNames = new Map(model.projects.map((project) => [project.id, project.name]));
  const assignmentsByEmployeeId = new Map<string, ProjectEmployeeAssignmentRecord[]>();

  for (const assignments of Object.values(model.assignmentsByProjectId)) {
    for (const assignment of assignments) {
      if (assignment.status !== "active") {
        continue;
      }
      const current = assignmentsByEmployeeId.get(assignment.employeeId) ?? [];
      current.push(assignment);
      assignmentsByEmployeeId.set(assignment.employeeId, current);
    }
  }

  const unrankedRows = model.employees.map((employee) => {
    const assignments = assignmentsByEmployeeId.get(employee.id) ?? [];
    const projects = assignments
      .map((assignment) => buildProjectUsage(assignment, projectNames.get(assignment.projectId)))
      .sort((left, right) => left.projectName.localeCompare(right.projectName));
    const configuredTokenLimits = projects
      .map((project) => project.dailyTokenLimit)
      .filter((limit): limit is number => limit !== null);

    return {
      dailyTokenLimit:
        configuredTokenLimits.length > 0
          ? configuredTokenLimits.reduce((sum, limit) => sum + limit, 0)
          : null,
      dailyTokens: projects.reduce((sum, project) => sum + project.dailyTokens, 0),
      department: employee.department,
      email: employee.email,
      employeeId: employee.id,
      invitationStatus: employee.invitationStatus,
      monthlyBudgetLimitUsd: projects.reduce(
        (sum, project) => sum + project.monthlyBudgetLimitUsd,
        0
      ),
      monthlyCostUsd: projects.reduce((sum, project) => sum + project.monthlyCostUsd, 0),
      name: employee.name?.trim() || employee.email,
      projectCount: projects.length,
      projects,
      quotaStatus: projects.reduce<ProjectEmployeeQuotaStatus>(
        (status, project) =>
          quotaSeverity[project.quotaStatus] > quotaSeverity[status]
            ? project.quotaStatus
            : status,
        "not_configured"
      ),
      rank: 0,
      status: employee.status,
      tokenShare: 0
    } satisfies EmployeeUsageRow;
  });

  unrankedRows.sort(
    (left, right) =>
      right.dailyTokens - left.dailyTokens ||
      right.monthlyCostUsd - left.monthlyCostUsd ||
      left.name.localeCompare(right.name)
  );

  const totalDailyTokens = unrankedRows.reduce((sum, row) => sum + row.dailyTokens, 0);
  const rows = unrankedRows.map((row, index) => ({
    ...row,
    rank: index + 1,
    tokenShare: totalDailyTokens > 0 ? row.dailyTokens / totalDailyTokens : 0
  }));
  const trackedEmployees = rows.filter(
    (row) => row.dailyTokens > 0 || row.monthlyCostUsd > 0
  ).length;

  return {
    activeEmployees: model.employees.filter((employee) => employee.status === "active").length,
    averageDailyTokens: trackedEmployees > 0 ? totalDailyTokens / trackedEmployees : 0,
    rows,
    totalDailyTokens,
    totalMonthlyCostUsd: rows.reduce((sum, row) => sum + row.monthlyCostUsd, 0),
    trackedEmployees
  };
}

function buildProjectUsage(
  assignment: ProjectEmployeeAssignmentRecord,
  projectName: string | undefined
): EmployeeProjectUsage {
  return {
    dailyTokenLimit: assignment.policy.dailyTokenLimit.enabled
      ? assignment.policy.dailyTokenLimit.limit
      : null,
    dailyTokens: assignment.dailyTokenUsed,
    monthlyBudgetLimitUsd: assignment.monthlyBudgetLimitUsd,
    monthlyCostUsd: assignment.monthlyUsedUsd,
    projectId: assignment.projectId,
    projectName: projectName ?? assignment.projectId,
    quotaStatus: assignment.quotaStatus
  };
}
