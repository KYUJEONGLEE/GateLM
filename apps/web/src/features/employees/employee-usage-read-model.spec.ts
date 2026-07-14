import { expect, test } from "@playwright/test";
import {
  buildEmployeeUsagePeriods,
  buildEmployeeUsageReadModel
} from "./employee-usage-read-model";
import type { EmployeeControlModel } from "@/lib/control-plane/employees-types";
import type {
  EmployeeUsageMetric,
  EmployeeUsageRecord,
  EmployeeUsageResponse
} from "@/lib/control-plane/employee-usage-types";

test("aggregates employee usage across active project assignments and ranks it", () => {
  const model = buildModel();
  const usage = buildEmployeeUsageReadModel(model);

  expect(usage).toMatchObject({
    activeEmployees: 2,
    averageDailyTokens: 100,
    totalDailyTokens: 200,
    totalMonthlyCostUsd: 3.5,
    trackedEmployees: 2
  });
  expect(usage.rows.map((row) => [row.rank, row.employeeId, row.dailyTokens])).toEqual([
    [1, "employee-a", 150],
    [2, "employee-b", 50]
  ]);
  expect(usage.rows[0]).toMatchObject({
    dailyTokenLimit: 300,
    monthlyBudgetLimitUsd: 5,
    monthlyCostUsd: 3,
    projectCount: 2,
    quotaStatus: "warning",
    tokenShare: 0.75,
    weeklyTokens: null
  });
  expect(usage.rows[0]?.projects[0]).toMatchObject({
    dailyTokenStatus: "within_limit"
  });
});

test("keeps employees without usage visible and ignores disabled assignments", () => {
  const model = buildModel();
  model.assignmentsByProjectId["project-a"][0].status = "disabled";
  model.employees.push({
    ...model.employees[0],
    email: "unused@example.invalid",
    id: "employee-c",
    name: "Unused"
  });

  const usage = buildEmployeeUsageReadModel(model);

  expect(usage.rows.find((row) => row.employeeId === "employee-c")).toMatchObject({
    dailyTokens: 0,
    monthlyCostUsd: 0,
    projectCount: 0
  });
  expect(usage.totalDailyTokens).toBe(100);
});

test("keeps the aggregate daily token limit unlimited when any project is unlimited", () => {
  const model = buildModel();
  model.assignmentsByProjectId["project-b"][0].policy.dailyTokenLimit = {
    enabled: false,
    limit: 0
  };

  const usage = buildEmployeeUsageReadModel(model);

  expect(usage.rows.find((row) => row.employeeId === "employee-a")?.dailyTokenLimit).toBeNull();
});

test("uses unified today, seven-day, and month-to-date usage when available", () => {
  const model = buildModel();
  const usage = buildEmployeeUsageReadModel(model, {
    monthToDate: buildUsageResponse([
      buildUsageRow("employee-a", 1, { costMicroUsd: 7_500_000 }),
      buildUsageRow("employee-b", 2, { costMicroUsd: 2_500_000 })
    ]),
    today: buildUsageResponse([
      buildUsageRow("employee-b", 1, { totalTokens: 600 }),
      buildUsageRow("employee-a", 2, { totalTokens: 400 })
    ]),
    trailingSevenDays: buildUsageResponse([
      buildUsageRow("employee-b", 1, { totalTokens: 3_000 }),
      buildUsageRow("employee-a", 2, { totalTokens: 2_000 })
    ])
  });

  expect(usage).toMatchObject({
    averageDailyTokens: 500,
    totalDailyTokens: 1_000,
    totalMonthlyCostUsd: 10,
    trackedEmployees: 2
  });
  expect(usage.rows.map((row) => [row.rank, row.employeeId])).toEqual([
    [1, "employee-b"],
    [2, "employee-a"]
  ]);
  expect(usage.rows[0]).toMatchObject({
    dailyTokens: 600,
    monthlyCostUsd: 2.5,
    weeklyTokens: 3_000
  });
});

test("builds UTC today, trailing seven-day, and month-to-date periods", () => {
  const periods = buildEmployeeUsagePeriods(new Date("2026-07-14T12:34:56.000Z"));

  expect(periods).toEqual({
    monthToDate: {
      from: "2026-07-01T00:00:00.000Z",
      to: "2026-07-14T12:34:56.000Z"
    },
    today: {
      from: "2026-07-14T00:00:00.000Z",
      to: "2026-07-14T12:34:56.000Z"
    },
    trailingSevenDays: {
      from: "2026-07-07T12:34:56.000Z",
      to: "2026-07-14T12:34:56.000Z"
    }
  });
});

function buildModel() {
  const employee = {
    acceptedAt: null,
    createdAt: "2026-07-14T00:00:00.000Z",
    department: "Platform",
    email: "a@example.invalid",
    id: "employee-a",
    invitationStatus: "accepted" as const,
    invitedAt: null,
    name: "Alice",
    projectCount: 2,
    status: "active" as const,
    tenantId: "tenant-a",
    updatedAt: "2026-07-14T00:00:00.000Z",
    userId: "user-a"
  };
  const assignment = {
    createdAt: "2026-07-14T00:00:00.000Z",
    dailyTokenRemaining: 100,
    dailyTokenStatus: "within_limit" as const,
    dailyTokenUsagePercent: 50,
    dailyTokenUsed: 100,
    employeeDepartment: "Platform",
    employeeEmail: employee.email,
    employeeId: employee.id,
    employeeName: employee.name,
    employeeStatus: employee.status,
    id: "assignment-a",
    invitationStatus: employee.invitationStatus,
    monthlyBudgetLimitMicroUsd: 3_000_000,
    monthlyBudgetLimitUsd: 3,
    monthlyRemainingUsd: 1,
    monthlyUsedMicroUsd: 2_000_000,
    monthlyUsedUsd: 2,
    policy: {
      dailyTokenLimit: { enabled: true, limit: 200 },
      note: null,
      rateLimit: { enabled: false, limit: 0, windowSeconds: 60 }
    },
    projectId: "project-a",
    quotaStatus: "within_limit" as const,
    quotaUsagePercent: 66,
    status: "active" as const,
    tenantId: "tenant-a",
    updatedAt: "2026-07-14T00:00:00.000Z",
    warningThresholdPercent: 80
  };

  return {
    assignmentsByProjectId: {
      "project-a": [assignment],
      "project-b": [
        {
          ...assignment,
          dailyTokenUsed: 50,
          employeeId: "employee-a",
          id: "assignment-b",
          monthlyBudgetLimitUsd: 2,
          monthlyUsedUsd: 1,
          policy: {
            ...assignment.policy,
            dailyTokenLimit: { enabled: true, limit: 100 }
          },
          projectId: "project-b",
          quotaStatus: "warning" as const
        },
        {
          ...assignment,
          dailyTokenUsed: 50,
          employeeEmail: "b@example.invalid",
          employeeId: "employee-b",
          employeeName: "Bob",
          id: "assignment-c",
          monthlyBudgetLimitUsd: 1,
          monthlyUsedUsd: 0.5,
          policy: {
            ...assignment.policy,
            dailyTokenLimit: { enabled: false, limit: 0 }
          },
          projectId: "project-b"
        }
      ]
    },
    controlPlaneBaseUrl: "http://control-plane.invalid",
    controlPlaneTenantId: "tenant-a",
    employees: [
      employee,
      {
        ...employee,
        email: "b@example.invalid",
        id: "employee-b",
        name: "Bob",
        projectCount: 1,
        userId: "user-b"
      }
    ],
    loadError: null,
    projects: [
      { id: "project-a", name: "Alpha", status: "ACTIVE" },
      { id: "project-b", name: "Beta", status: "ACTIVE" }
    ],
    routeTenantId: "tenant-a",
    source: "control-plane"
  } as unknown as EmployeeControlModel;
}

function buildUsageResponse(data: EmployeeUsageRecord[]): EmployeeUsageResponse {
  return {
    data,
    pagination: { hasMore: false, limit: 100, nextCursor: null },
    period: {
      from: "2026-07-01T00:00:00.000Z",
      timezone: "UTC",
      to: "2026-07-14T12:34:56.000Z"
    },
    provenance: {
      generatedAt: "2026-07-14T12:35:00.000Z",
      lastSourceAt: "2026-07-14T12:34:56.000Z",
      source: "hybrid"
    },
    unattributed: {
      sources: { projectApplication: metric(), tenantChat: metric() },
      total: metric()
    }
  };
}

function buildUsageRow(
  employeeId: string,
  rank: number,
  totalOverrides: Partial<EmployeeUsageMetric>
): EmployeeUsageRecord {
  const total = metric(totalOverrides);
  return {
    department: "Platform",
    email: `${employeeId}@example.invalid`,
    employeeId,
    name: employeeId,
    rank,
    sources: { projectApplication: total, tenantChat: metric() },
    status: "active",
    total
  };
}

function metric(overrides: Partial<EmployeeUsageMetric> = {}): EmployeeUsageMetric {
  return {
    costMicroUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 0,
    totalTokens: 0,
    ...overrides
  };
}
