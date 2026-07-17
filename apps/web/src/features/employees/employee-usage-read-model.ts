import type {
  EmployeeControlModel,
  EmployeeRecord,
  ProjectEmployeeAssignmentRecord,
  ProjectEmployeeQuotaStatus
} from "@/lib/control-plane/employees-types";
import type {
  EmployeeCostPoliciesResponse,
  EmployeeCostPolicyListItem
} from "@/lib/control-plane/employee-cost-policy-types";
import type { EmployeeUsageResponse } from "@/lib/control-plane/employee-usage-types";

const MICRO_USD_PER_USD = 1_000_000;

export type EmployeeCostPolicySnapshot = {
  costPolicies?: EmployeeCostPoliciesResponse | null;
  loadError?: string | null;
  monthlyUsage?: EmployeeUsageResponse | null;
  monthlyUsageLoadError?: string | null;
};

export type EmployeeProjectUsage = {
  dailyTokenLimit: number | null;
  dailyTokenStatus: ProjectEmployeeQuotaStatus;
  dailyTokens: number;
  monthlyBudgetLimitUsd: number;
  monthlyCostUsd: number;
  projectId: string;
  projectName: string;
  quotaStatus: ProjectEmployeeQuotaStatus;
};

export type EmployeeUsageRow = {
  costPolicy: EmployeeCostPolicyListItem | null;
  costShare: number | null;
  dailyCostMicroUsd: number | null;
  dailyRank: number;
  department: string | null;
  email: string;
  employeeId: string;
  invitationStatus: EmployeeRecord["invitationStatus"];
  monthlyBudgetLimitUsd: number;
  monthlyCostMicroUsd: number | null;
  monthlyCostUsd: number;
  monthlyRank: number;
  name: string;
  projectCount: number;
  projects: EmployeeProjectUsage[];
  quotaStatus: ProjectEmployeeQuotaStatus;
  status: EmployeeRecord["status"];
  weeklyCostMicroUsd: number | null;
  weeklyRank: number;
};

export type EmployeeUsageReadModel = {
  activeEmployees: number;
  costPolicyLoadError: string | null;
  monthlyCostLoadError: string | null;
  monthlyPeriodTimezone: string | null;
  periodTimezone: string | null;
  rows: EmployeeUsageRow[];
  totalDailyCostMicroUsd: number | null;
  totalMonthlyCostMicroUsd: number | null;
  trackedEmployees: number;
};

type EmployeeUsageCandidate = Omit<
  EmployeeUsageRow,
  "costShare" | "dailyRank" | "monthlyRank" | "weeklyRank"
>;

const quotaSeverity: Record<ProjectEmployeeQuotaStatus, number> = {
  exceeded: 3,
  warning: 2,
  within_limit: 1,
  not_configured: 0
};

export function buildEmployeeUsageReadModel(
  model: EmployeeControlModel,
  snapshot: EmployeeCostPolicySnapshot = {}
): EmployeeUsageReadModel {
  const projectNames = new Map(model.projects.map((project) => [project.id, project.name]));
  const assignmentsByEmployeeId = new Map<string, ProjectEmployeeAssignmentRecord[]>();
  const policyByEmployeeId = new Map(
    (snapshot.costPolicies?.data ?? []).map((row) => [row.employeeId, row])
  );
  const monthlyUsageByEmployeeId = new Map(
    (snapshot.monthlyUsage?.data ?? []).map((row) => [row.employeeId, row])
  );
  const modelEmployeeIds = new Set(model.employees.map((employee) => employee.id));
  const monthlyUsageComplete = Boolean(
    snapshot.monthlyUsage &&
      model.employees.every((employee) => monthlyUsageByEmployeeId.has(employee.id))
  );

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
    const costPolicy = policyByEmployeeId.get(employee.id) ?? null;

    return {
      costPolicy,
      dailyCostMicroUsd: costPolicy?.daily.confirmedCostMicroUsd ?? null,
      department: employee.department,
      email: employee.email,
      employeeId: employee.id,
      invitationStatus: employee.invitationStatus,
      monthlyBudgetLimitUsd: projects.reduce(
        (sum, project) => sum + project.monthlyBudgetLimitUsd,
        0
      ),
      monthlyCostMicroUsd: monthlyUsageComplete
        ? (monthlyUsageByEmployeeId.get(employee.id)?.total.costMicroUsd ?? null)
        : null,
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
      status: employee.status,
      weeklyCostMicroUsd: costPolicy?.weekly.confirmedCostMicroUsd ?? null
    } satisfies EmployeeUsageCandidate;
  });

  unrankedRows.sort((left, right) => {
    if (left.dailyCostMicroUsd !== null && right.dailyCostMicroUsd !== null) {
      return (
        right.dailyCostMicroUsd - left.dailyCostMicroUsd ||
        left.name.localeCompare(right.name)
      );
    }
    if (left.dailyCostMicroUsd !== null) return -1;
    if (right.dailyCostMicroUsd !== null) return 1;
    return left.name.localeCompare(right.name);
  });

  const costPoliciesComplete = Boolean(
    snapshot.costPolicies &&
      policyByEmployeeId.size === modelEmployeeIds.size &&
      model.employees.every((employee) => policyByEmployeeId.has(employee.id))
  );
  const totalDailyCostMicroUsd = costPoliciesComplete
    ? unrankedRows.reduce((sum, row) => sum + (row.dailyCostMicroUsd ?? 0), 0)
    : null;
  const totalMonthlyCostMicroUsd = monthlyUsageComplete
    ? unrankedRows.reduce((sum, row) => sum + (row.monthlyCostMicroUsd ?? 0), 0)
    : null;
  const periodTimezone = costPoliciesComplete
    ? snapshot.costPolicies?.data[0]?.policy.periodTimezone ?? null
    : null;
  const dailyRankByEmployeeId = buildCostRankByEmployeeId(
    unrankedRows,
    (row) => row.dailyCostMicroUsd
  );
  const weeklyRankByEmployeeId = buildCostRankByEmployeeId(
    unrankedRows,
    (row) => row.weeklyCostMicroUsd
  );
  const monthlyRankByEmployeeId = buildCostRankByEmployeeId(
    unrankedRows,
    (row) => row.monthlyCostMicroUsd
  );
  const rows = unrankedRows.map((row, index) => ({
    ...row,
    costShare:
      row.dailyCostMicroUsd !== null &&
      totalDailyCostMicroUsd !== null &&
      totalDailyCostMicroUsd > 0
        ? row.dailyCostMicroUsd / totalDailyCostMicroUsd
        : null,
    dailyRank: dailyRankByEmployeeId.get(row.employeeId) ?? index + 1,
    monthlyRank: monthlyRankByEmployeeId.get(row.employeeId) ?? index + 1,
    weeklyRank: weeklyRankByEmployeeId.get(row.employeeId) ?? index + 1
  }));

  return {
    activeEmployees: model.employees.filter((employee) => employee.status === "active").length,
    costPolicyLoadError:
      snapshot.loadError ??
      (snapshot.costPolicies && !costPoliciesComplete
        ? "Control Plane returned incomplete employee cost policies."
        : null),
    monthlyCostLoadError:
      snapshot.monthlyUsageLoadError ??
      (snapshot.monthlyUsage && !monthlyUsageComplete
        ? "Control Plane returned incomplete monthly employee usage."
        : null),
    monthlyPeriodTimezone: monthlyUsageComplete
      ? snapshot.monthlyUsage?.period.timezone ?? null
      : null,
    periodTimezone,
    rows,
    totalDailyCostMicroUsd,
    totalMonthlyCostMicroUsd,
    trackedEmployees: rows.filter((row) => (row.dailyCostMicroUsd ?? 0) > 0).length
  };
}

function buildCostRankByEmployeeId(
  rows: EmployeeUsageCandidate[],
  getCost: (row: EmployeeUsageCandidate) => number | null
) {
  const rankedRows = [...rows].sort((left, right) => {
    const leftCost = getCost(left);
    const rightCost = getCost(right);

    if (leftCost !== null && rightCost !== null) {
      return rightCost - leftCost || left.name.localeCompare(right.name);
    }
    if (leftCost !== null) return -1;
    if (rightCost !== null) return 1;
    return left.name.localeCompare(right.name);
  });

  return new Map(rankedRows.map((row, index) => [row.employeeId, index + 1]));
}

function buildProjectUsage(
  assignment: ProjectEmployeeAssignmentRecord,
  projectName: string | undefined
): EmployeeProjectUsage {
  return {
    dailyTokenLimit: assignment.policy.dailyTokenLimit.enabled
      ? assignment.policy.dailyTokenLimit.limit
      : null,
    dailyTokenStatus: assignment.dailyTokenStatus,
    dailyTokens: assignment.dailyTokenUsed,
    monthlyBudgetLimitUsd: assignment.monthlyBudgetLimitUsd,
    monthlyCostUsd: assignment.monthlyUsedMicroUsd / MICRO_USD_PER_USD,
    projectId: assignment.projectId,
    projectName: projectName ?? assignment.projectId,
    quotaStatus: assignment.quotaStatus
  };
}
