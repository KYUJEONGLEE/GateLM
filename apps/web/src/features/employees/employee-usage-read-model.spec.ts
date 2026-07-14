import { expect, test } from "@playwright/test";
import { buildEmployeeUsageReadModel } from "./employee-usage-read-model";
import type { EmployeeControlModel } from "@/lib/control-plane/employees-types";

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
    tokenShare: 0.75
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
