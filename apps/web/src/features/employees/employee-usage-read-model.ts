import type {
  EmployeeControlModel,
  EmployeeRecord,
  ProjectEmployeeAssignmentRecord,
  ProjectEmployeeQuotaStatus
} from "@/lib/control-plane/employees-types";
import type {
  EmployeeUsageRecord,
  EmployeeUsageResponse
} from "@/lib/control-plane/employee-usage-types";

const MICRO_USD_PER_USD = 1_000_000;
const DAY_MS = 24 * 60 * 60 * 1_000;

export type EmployeeUsageSnapshots = {
  monthToDate?: EmployeeUsageResponse | null;
  today?: EmployeeUsageResponse | null;
  trailingSevenDays?: EmployeeUsageResponse | null;
};

export type EmployeeUsagePeriods = {
  monthToDate: EmployeeUsagePeriod;
  today: EmployeeUsagePeriod;
  trailingSevenDays: EmployeeUsagePeriod;
};

type EmployeeUsagePeriod = {
  from: string;
  to: string;
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
  weeklyTokens: number | null;
};

export type EmployeeUsageReadModel = {
  activeEmployees: number;
  averageDailyTokens: number;
  rows: EmployeeUsageRow[];
  totalDailyTokens: number;
  totalMonthlyCostUsd: number;
  trackedEmployees: number;
};

type EmployeeUsageCandidate = EmployeeUsageRow & {
  canonicalRank: number | null;
};

const quotaSeverity: Record<ProjectEmployeeQuotaStatus, number> = {
  exceeded: 3,
  warning: 2,
  within_limit: 1,
  not_configured: 0
};

export function buildEmployeeUsageReadModel(
  model: EmployeeControlModel,
  snapshots?: EmployeeUsageSnapshots
): EmployeeUsageReadModel {
  const projectNames = new Map(model.projects.map((project) => [project.id, project.name]));
  const assignmentsByEmployeeId = new Map<string, ProjectEmployeeAssignmentRecord[]>();
  const todayByEmployeeId = indexUsageByEmployeeId(snapshots?.today);
  const trailingSevenDaysByEmployeeId = indexUsageByEmployeeId(
    snapshots?.trailingSevenDays
  );
  const monthToDateByEmployeeId = indexUsageByEmployeeId(snapshots?.monthToDate);

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
    const fallbackDailyTokens = projects.reduce(
      (sum, project) => sum + project.dailyTokens,
      0
    );
    const fallbackMonthlyCostUsd = projects.reduce(
      (sum, project) => sum + project.monthlyCostUsd,
      0
    );
    const todayUsage = todayByEmployeeId.get(employee.id);
    const trailingSevenDaysUsage = trailingSevenDaysByEmployeeId.get(employee.id);
    const monthToDateUsage = monthToDateByEmployeeId.get(employee.id);

    return {
      canonicalRank: snapshots?.today ? todayUsage?.rank ?? null : null,
      dailyTokenLimit:
        projects.length === 0 || projects.some((project) => project.dailyTokenLimit === null)
          ? null
          : configuredTokenLimits.reduce((sum, limit) => sum + limit, 0),
      dailyTokens: snapshots?.today
        ? todayUsage?.total.totalTokens ?? 0
        : fallbackDailyTokens,
      department: employee.department,
      email: employee.email,
      employeeId: employee.id,
      invitationStatus: employee.invitationStatus,
      monthlyBudgetLimitUsd: projects.reduce(
        (sum, project) => sum + project.monthlyBudgetLimitUsd,
        0
      ),
      monthlyCostUsd: snapshots?.monthToDate
        ? (monthToDateUsage?.total.costMicroUsd ?? 0) / MICRO_USD_PER_USD
        : fallbackMonthlyCostUsd,
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
      tokenShare: 0,
      weeklyTokens: snapshots?.trailingSevenDays
        ? trailingSevenDaysUsage?.total.totalTokens ?? 0
        : null
    } satisfies EmployeeUsageCandidate;
  });

  unrankedRows.sort((left, right) => {
    if (left.canonicalRank !== null && right.canonicalRank !== null) {
      return left.canonicalRank - right.canonicalRank;
    }
    if (left.canonicalRank !== null) return -1;
    if (right.canonicalRank !== null) return 1;
    return (
      right.dailyTokens - left.dailyTokens ||
      right.monthlyCostUsd - left.monthlyCostUsd ||
      left.name.localeCompare(right.name)
    );
  });

  const totalDailyTokens = unrankedRows.reduce((sum, row) => sum + row.dailyTokens, 0);
  const rows = unrankedRows.map((candidate, index) => {
    const { canonicalRank, ...row } = candidate;
    return {
      ...row,
      rank: canonicalRank ?? index + 1,
      tokenShare: totalDailyTokens > 0 ? row.dailyTokens / totalDailyTokens : 0
    };
  });
  const trackedEmployees = rows.filter(
    (row) =>
      row.dailyTokens > 0 ||
      (row.weeklyTokens ?? 0) > 0 ||
      row.monthlyCostUsd > 0
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

export function buildEmployeeUsagePeriods(now = new Date()): EmployeeUsagePeriods {
  const to = now.toISOString();
  return {
    monthToDate: {
      from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      to
    },
    today: {
      from: new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
      ).toISOString(),
      to
    },
    trailingSevenDays: {
      from: new Date(now.getTime() - 7 * DAY_MS).toISOString(),
      to
    }
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
    dailyTokenStatus: assignment.dailyTokenStatus,
    dailyTokens: assignment.dailyTokenUsed,
    monthlyBudgetLimitUsd: assignment.monthlyBudgetLimitUsd,
    monthlyCostUsd: assignment.monthlyUsedUsd,
    projectId: assignment.projectId,
    projectName: projectName ?? assignment.projectId,
    quotaStatus: assignment.quotaStatus
  };
}

function indexUsageByEmployeeId(response: EmployeeUsageResponse | null | undefined) {
  return new Map<string, EmployeeUsageRecord>(
    (response?.data ?? []).map((row) => [row.employeeId, row])
  );
}
