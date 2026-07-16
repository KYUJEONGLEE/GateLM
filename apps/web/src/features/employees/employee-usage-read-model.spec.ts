import { expect, test } from "@playwright/test";

import { buildEmployeeUsageReadModel } from "./employee-usage-read-model";
import type { EmployeeControlModel } from "@/lib/control-plane/employees-types";
import type {
  EmployeeCostPoliciesResponse,
  EmployeeCostPolicyListItem
} from "@/lib/control-plane/employee-cost-policy-types";

test("ranks employees by unified daily cost and keeps weekly cost separate", () => {
  const usage = buildEmployeeUsageReadModel(buildModel(), {
    costPolicies: buildCostPolicies([
      buildCostPolicy("employee-a", 2_500_000, 12_000_000),
      buildCostPolicy("employee-b", 7_500_000, 18_000_000)
    ])
  });

  expect(usage).toMatchObject({
    activeEmployees: 2,
    costPolicyLoadError: null,
    periodTimezone: "Asia/Seoul",
    totalDailyCostMicroUsd: 10_000_000,
    trackedEmployees: 2
  });
  expect(
    usage.rows.map((row) => [
      row.rank,
      row.employeeId,
      row.dailyCostMicroUsd,
      row.weeklyCostMicroUsd
    ])
  ).toEqual([
    [1, "employee-b", 7_500_000, 18_000_000],
    [2, "employee-a", 2_500_000, 12_000_000]
  ]);
  expect(usage.rows[0]).toMatchObject({
    costShare: 0.75,
    projectCount: 1
  });
});

test("does not turn a failed policy read into zero-dollar employee usage", () => {
  const usage = buildEmployeeUsageReadModel(buildModel(), {
    loadError: "Control Plane unavailable."
  });

  expect(usage.totalDailyCostMicroUsd).toBeNull();
  expect(usage.periodTimezone).toBeNull();
  expect(usage.costPolicyLoadError).toBe("Control Plane unavailable.");
  expect(
    usage.rows.map((row) => [row.employeeId, row.dailyCostMicroUsd, row.weeklyCostMicroUsd])
  ).toEqual([
    ["employee-a", null, null],
    ["employee-b", null, null]
  ]);
});

test("keeps employees visible while ignoring disabled project assignments", () => {
  const model = buildModel();
  model.assignmentsByProjectId["project-a"][0].status = "disabled";

  const usage = buildEmployeeUsageReadModel(model, {
    costPolicies: buildCostPolicies([
      buildCostPolicy("employee-a", 0, 0),
      buildCostPolicy("employee-b", 0, 0)
    ])
  });

  expect(usage.rows.find((row) => row.employeeId === "employee-a")).toMatchObject({
    dailyCostMicroUsd: 0,
    monthlyCostUsd: 1,
    projectCount: 1
  });
  expect(usage.totalDailyCostMicroUsd).toBe(0);
});

test("marks a partial batch response as incomplete instead of publishing a partial total", () => {
  const usage = buildEmployeeUsageReadModel(buildModel(), {
    costPolicies: buildCostPolicies([buildCostPolicy("employee-a", 1_000_000, 2_000_000)])
  });

  expect(usage.totalDailyCostMicroUsd).toBeNull();
  expect(usage.costPolicyLoadError).toContain("incomplete");
  expect(usage.rows.find((row) => row.employeeId === "employee-b")?.dailyCostMicroUsd).toBeNull();
});

test("rejects cost policy rows for employees omitted by the bounded employee read", () => {
  const usage = buildEmployeeUsageReadModel(buildModel(), {
    costPolicies: buildCostPolicies([
      buildCostPolicy("employee-a", 1_000_000, 2_000_000),
      buildCostPolicy("employee-b", 2_000_000, 3_000_000),
      buildCostPolicy("employee-outside-page", 9_000_000, 12_000_000)
    ])
  });

  expect(usage.totalDailyCostMicroUsd).toBeNull();
  expect(usage.costPolicyLoadError).toContain("incomplete");
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
          monthlyUsedMicroUsd: 1_000_000,
          monthlyUsedUsd: 1,
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
          monthlyUsedMicroUsd: 500_000,
          monthlyUsedUsd: 0.5,
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

function buildCostPolicies(data: EmployeeCostPolicyListItem[]): EmployeeCostPoliciesResponse {
  return {
    data,
    pagination: { hasMore: false, limit: 100, nextCursor: null }
  };
}

function buildCostPolicy(
  employeeId: string,
  dailyCostMicroUsd: number,
  weeklyCostMicroUsd: number
): EmployeeCostPolicyListItem {
  return {
    daily: period(dailyCostMicroUsd),
    employeeId,
    enforcementReady: false,
    exposureSource: "confirmed_read_model",
    policy: {
      createdAt: null,
      currency: "USD",
      daily: { enabled: false, limitMicroUsd: 0 },
      employeeId,
      enforcementMode: "monitor",
      periodTimezone: "Asia/Seoul",
      tenantId: "tenant-a",
      updatedAt: null,
      updatedBy: null,
      version: 0,
      warningThresholdPercent: 80,
      weekly: { enabled: false, limitMicroUsd: 0 }
    },
    rolloutMode: "off",
    weekly: period(weeklyCostMicroUsd)
  };
}

function period(confirmedCostMicroUsd: number) {
  return {
    confirmedCostMicroUsd,
    periodEnd: "2026-07-15T15:00:00.000Z",
    periodStart: "2026-07-14T15:00:00.000Z",
    periodTimezone: "Asia/Seoul",
    reservedCostMicroUsd: null,
    resetAt: "2026-07-15T15:00:00.000Z",
    state: "not_configured" as const,
    unconfirmedCostMicroUsd: null
  };
}
