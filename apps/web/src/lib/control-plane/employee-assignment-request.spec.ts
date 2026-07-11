import { expect, test } from "@playwright/test";
import { buildProjectEmployeeAssignmentRequestBody } from "./employee-assignment-request";

test("includes the daily token limit in the Control Plane assignment request", () => {
  expect(
    buildProjectEmployeeAssignmentRequestBody({
      allowedModelKeys: ["gpt-4o-mini"],
      allowedProviderConnectionIds: ["provider-openai"],
      dailyTokenLimit: 2000,
      employeeId: "employee-1",
      monthlyBudgetLimitUsd: 100,
      policyNote: "  daily policy  ",
      projectId: "project-1",
      rateLimitEnabled: true,
      rateLimitLimit: 60,
      rateLimitWindowSeconds: 60,
      warningThresholdPercent: 80
    })
  ).toEqual({
    allowedModelKeys: ["gpt-4o-mini"],
    allowedProviderConnectionIds: ["provider-openai"],
    dailyTokenLimit: 2000,
    monthlyBudgetLimitUsd: 100,
    policyNote: "daily policy",
    rateLimitEnabled: true,
    rateLimitLimit: 60,
    rateLimitWindowSeconds: 60,
    status: "active",
    warningThresholdPercent: 80
  });
});
