import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const clientSourceUrl = new URL("./employee-cost-policy-client.ts", import.meta.url);

test("employee cost policy client uses the tenant-scoped batch and patch endpoints", async () => {
  const source = await readFile(clientSourceUrl, "utf8");

  expect(source).toContain("/employees/cost-policies?");
  expect(source).toContain("/employees/${encodeURIComponent(values.employeeId)}/cost-policy");
  expect(source).toContain('method: "PATCH"');
  expect(source).toContain("expectedVersion: values.expectedVersion");
  expect(source).not.toContain("tenantId: values.tenantId,");
});

test("all-policy reads guard cursor loops and duplicate employee rows", async () => {
  const source = await readFile(clientSourceUrl, "utf8");

  expect(source).toContain("EMPLOYEE_COST_POLICY_MAX_PAGES");
  expect(source).toContain("seenCursors.has(nextCursor)");
  expect(source).toContain("seenEmployeeIds.has(row.employeeId)");
  expect(source).toContain("invalidPaginationResult()");
  expect(source).toContain("employeeCostPolicyPeriodSignature(row)");
  expect(source).toContain("invalidPeriodResult()");
});
