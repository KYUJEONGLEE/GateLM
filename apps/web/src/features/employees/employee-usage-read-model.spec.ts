import { expect, test } from "@playwright/test";

import { buildEmployeeUsageReadModel } from "./employee-usage-read-model";
import type { EmployeeControlModel } from "@/lib/control-plane/employees-types";
import type { EmployeeWeeklyTokenQuotasResponse } from "@/lib/control-plane/employee-weekly-token-quota-types";
import type { EmployeeUsageResponse } from "@/lib/control-plane/employee-usage-types";

test("ranks employees by Tenant Chat confirmed cost and keeps project usage separate", () => {
  const usage = buildEmployeeUsageReadModel(buildModel(), {
    tenantChatUsage: buildTenantChatUsage([
      usageRow("employee-a", 2_500_000),
      usageRow("employee-b", 7_500_000)
    ]),
    weeklyUsage: buildTenantChatUsage([
      usageRow("employee-a", 5_000_000),
      usageRow("employee-b", 9_000_000)
    ]),
    weeklyTokenQuotas: buildWeeklyTokenQuotas(["employee-a", "employee-b"])
  });

  expect(usage).toMatchObject({
    activeEmployees: 2,
    quotaLoadError: null,
    periodTimezone: "Asia/Seoul",
    totalDailyCostMicroUsd: 10_000_000,
    trackedEmployees: 2
  });
  expect(
    usage.rows.map((row) => [
      row.dailyRank,
      row.employeeId,
      row.dailyCostMicroUsd,
      row.weeklyCostMicroUsd
    ])
  ).toEqual([
    [1, "employee-b", 7_500_000, 9_000_000],
    [2, "employee-a", 2_500_000, 5_000_000]
  ]);
  expect(usage.rows[0]).toMatchObject({
    costShare: 0.75,
    projectCount: 1
  });
});

test("does not turn a failed Tenant Chat usage read into zero-dollar employee usage", () => {
  const usage = buildEmployeeUsageReadModel(buildModel(), {
    loadError: "Control Plane unavailable."
  });

  expect(usage.totalDailyCostMicroUsd).toBeNull();
  expect(usage.periodTimezone).toBeNull();
  expect(usage.quotaLoadError).toBe("Control Plane unavailable.");
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
    tenantChatUsage: buildTenantChatUsage([
      usageRow("employee-a", 0),
      usageRow("employee-b", 0)
    ]),
    weeklyTokenQuotas: buildWeeklyTokenQuotas(["employee-a", "employee-b"])
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
    tenantChatUsage: buildTenantChatUsage([usageRow("employee-a", 1_000_000)]),
    weeklyTokenQuotas: buildWeeklyTokenQuotas(["employee-a", "employee-b"])
  });

  expect(usage.totalDailyCostMicroUsd).toBeNull();
  expect(usage.quotaLoadError).toContain("incomplete");
  expect(usage.rows.find((row) => row.employeeId === "employee-b")?.dailyCostMicroUsd).toBeNull();
});

test("rejects Tenant Chat usage rows for employees omitted by the bounded employee read", () => {
  const usage = buildEmployeeUsageReadModel(buildModel(), {
    tenantChatUsage: buildTenantChatUsage([
      usageRow("employee-a", 1_000_000),
      usageRow("employee-b", 2_000_000),
      usageRow("employee-outside-page", 9_000_000)
    ]),
    weeklyTokenQuotas: buildWeeklyTokenQuotas(["employee-a", "employee-b"])
  });

  expect(usage.totalDailyCostMicroUsd).toBeNull();
  expect(usage.quotaLoadError).toContain("incomplete");
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

function buildTenantChatUsage(data: EmployeeUsageResponse["data"]): EmployeeUsageResponse {
  return {
    data,
    pagination: { hasMore: false, limit: 100, nextCursor: null },
    period: {
      from: "2026-07-14T15:00:00.000Z",
      timezone: "UTC",
      to: "2026-07-15T15:00:00.000Z"
    },
    provenance: { generatedAt: "2026-07-15T15:00:00.000Z", lastSourceAt: null, source: "raw" },
    unattributed: {
      sources: { projectApplication: emptyMetric(), tenantChat: emptyMetric() },
      total: emptyMetric()
    }
  };
}

function usageRow(employeeId: string, costMicroUsd: number): EmployeeUsageResponse["data"][number] {
  return {
    department: null,
    email: `${employeeId}@example.invalid`,
    employeeId,
    name: employeeId === "employee-a" ? "Alice" : "Bob",
    rank: 1,
    sources: { projectApplication: emptyMetric(), tenantChat: { ...emptyMetric(), costMicroUsd } },
    status: "active",
    total: { ...emptyMetric(), costMicroUsd }
  };
}

function buildWeeklyTokenQuotas(employeeIds: string[]): EmployeeWeeklyTokenQuotasResponse {
  return {
    data: employeeIds.map((employeeId) => ({
      currentWeek: null,
      employeeId,
      enabled: false,
      limitTokens: 0,
      snapshotVersion: 1,
      tenantId: "tenant-a",
      timezone: "Asia/Seoul",
      version: 0
    })),
    pagination: { hasMore: false, limit: employeeIds.length, nextCursor: null }
  };
}

function emptyMetric() {
  return {
    costMicroUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    requestCount: 0,
    totalTokens: 0
  };
}
