import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { parseCompactStepperInput } from "./employee-policy-unit-stepper";

const employeeManagementSourceUrl = new URL("./employee-control-management.tsx", import.meta.url);
const employeeStylesSourceUrl = new URL("../../../app/globals.css", import.meta.url);
const employeePageSourceUrl = new URL(
  "../../../app/(console)/tenants/[tenantId]/employees/page.tsx",
  import.meta.url
);
const employeesClientSourceUrl = new URL(
  "../../../lib/control-plane/employees-client.ts",
  import.meta.url
);
const employeesRouteSourceUrl = new URL(
  "../../../app/api/control-plane/employees/route.ts",
  import.meta.url
);

test("parses compact unit values after decimal input is complete", () => {
  expect(parseCompactStepperInput("1.25USD", "USD")).toBe(1.25);
  expect(parseCompactStepperInput("2K", "K")).toBe(2);
});

test("rejects incomplete or malformed compact unit values", () => {
  expect(parseCompactStepperInput("-", "USD")).toBeNull();
  expect(parseCompactStepperInput(".", "USD")).toBeNull();
  expect(parseCompactStepperInput("1.2.3USD", "USD")).toBeNull();
});

test("bulk employee deletion always unlocks the UI and uses the latest selected employee", async () => {
  const source = (await readFile(employeeManagementSourceUrl, "utf8")).replaceAll("\r\n", "\n");

  expect(source).toContain('setPendingAction("deleteSelected")');
  expect(source).toContain("} finally {\n      setPendingAction(null);");
  expect(source).toContain("setSelectedEmployeeId((current) =>");
  expect(source).not.toContain(
    "if (selectedEmployeeId && deletedIdSet.has(selectedEmployeeId))"
  );
});

test("pending employee invitations can be deleted without deleting the employee", async () => {
  const [source, clientSource, routeSource] = await Promise.all([
    readFile(employeeManagementSourceUrl, "utf8"),
    readFile(employeesClientSourceUrl, "utf8"),
    readFile(employeesRouteSourceUrl, "utf8")
  ]);

  expect(source).toContain('employee.invitationStatus === "pending"');
  expect(source).toContain('action: "deleteInvitation"');
  expect(source).toContain('payload.employee?.invitationStatus === "revoked"');
  expect(source).toContain('invitationDeleteSelected: "초대 삭제"');
  expect(source).toContain('setPendingAction("deleteInvitations")');
  expect(source).toContain(
    'Employee records and project assignments will remain, but existing invitation links will stop working.'
  );
  expect(routeSource).toContain('| "deleteInvitation"');
  expect(routeSource).toContain("deleteEmployeeInvitation(values, requestOptions)");
  expect(clientSource).toContain("export async function deleteEmployeeInvitation(");
  expect(clientSource).toContain('method: "DELETE"');
});

test("employee list actions use the shared primary action scale", async () => {
  const [source, styles] = await Promise.all([
    readFile(employeeManagementSourceUrl, "utf8"),
    readFile(employeeStylesSourceUrl, "utf8")
  ]);

  expect(styles).toMatch(
    /\.employee-list-toolbar \[data-slot="button"\]\.employee-add-trigger \{[\s\S]*?min-width: 0;[\s\S]*?min-height: var\(--primary-action-height\);[\s\S]*?padding-inline: var\(--primary-action-padding-inline\);/
  );
  expect(styles).toMatch(
    /\.employee-list-toolbar \[data-slot="button"\]\.employee-add-trigger svg \{\s*width: 16px;\s*height: 16px;/
  );
  expect(source.match(/className="compact-action-button"/g)).toHaveLength(3);
  expect(styles).toContain("--compact-action-height: 34px;");
  expect(styles).toContain("--compact-action-radius: 8px;");
  expect(styles).toMatch(
    /\.employee-list-section > \.project-empty \{[\s\S]*?font-size: calc\(var\(--font-size-lg\) \+ var\(--global-font-lift\)\);/
  );
});

test("employee ranking and detail controls use unified cost policies", async () => {
  const source = await readFile(employeeManagementSourceUrl, "utf8");

  expect(source).toContain("AnalyticsRankedBarChart");
  expect(source).toContain('kind="micro-usd"');
  expect(source).toContain('orientation="vertical"');
  expect(source).toContain("outlierMultiplier={1.5}");
  expect(source).toContain("평균의 1.5배 이상");
  expect(source).toContain('useState<EmployeeCostChartPeriod>("daily")');
  expect(source).toContain('employeeCostChartPeriod === "daily"');
  expect(source).toContain("employeeUsage.dailyRank <= 3");
  expect(source).toContain("employeeUsage.weeklyRank <= 3");
  expect(source).toContain("row.dailyCostMicroUsd ?? 0");
  expect(source).toContain("row.monthlyCostMicroUsd ?? 0");
  expect(source).toContain('["daily", "weekly", "monthly"]');
  expect(source).toContain('action: "updateCostPolicy"');
  expect(source).toContain("expectedVersion: policy.version");
  expect(source).toContain("daily: toEmployeeCostLimit(draft.daily)");
  expect(source).toContain("weekly: toEmployeeCostLimit(draft.weekly)");
  expect(source).toContain("parseEmployeeCostPolicy(");
  expect(source).toContain("text.limitConflict");
  expect(source).toContain("if (response.status === 409)");
  expect(source).toContain("disabled={pending}");
  expect(source).toContain("decimals={6}");
  expect(source).toContain("enabled && current[card.periodKey].limitUsd <= 0");
  expect(source).toContain("!draft.enabled && draft.limitUsd <= 0 ? 0");
  expect(source).toContain("Routing remains monitor-only after the ledger is connected.");
  expect(source).not.toContain("function costLimitUsd(");
  expect(source).toContain("costPolicyItem.enforcementReady");
  expect(source).toContain("text.exposureState");
  expect(source).toContain("usage.periodTimezone");
  expect(source).toContain('draft.enforcementMode === "restrict_high_cost"');
  expect(source).not.toContain('policy?.version === 0 ? "restrict_high_cost"');
  expect(source).not.toContain("AnalyticsEmployeeTokenBarChart");
});

test("employee monthly graph loads unified month-to-date cost", async () => {
  const pageSource = await readFile(employeePageSourceUrl, "utf8");

  expect(pageSource).toContain("getAllEmployeeUsage({");
  expect(pageSource).toContain('metric: "cost"');
  expect(pageSource).toContain("monthlyUsage: monthlyEmployeeUsage.ok");
  expect(pageSource).toContain("Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1)");
});
