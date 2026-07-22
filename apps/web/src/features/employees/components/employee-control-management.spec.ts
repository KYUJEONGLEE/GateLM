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

test("employee ranking and detail controls use Tenant Chat cost observation and weekly token limits", async () => {
  const [source, styles] = await Promise.all([
    readFile(employeeManagementSourceUrl, "utf8"),
    readFile(employeeStylesSourceUrl, "utf8")
  ]);

  expect(source).toContain("AnalyticsRankedBarChart");
  expect(source).toContain('kind="micro-usd"');
  expect(source).toContain('orientation="vertical"');
  expect(source).toContain(
    'const EMPLOYEE_COST_RANK_COLORS = ["#d9a321", "#94a3b8", "#b87333", "#0f8f66"]'
  );
  expect(source).toContain("rankColors={EMPLOYEE_COST_RANK_COLORS}");
  expect(source).toContain("employeeUsage.dailyRank <= 3");
  expect(source).toContain("employeeUsage.weeklyRank <= 3");
  expect(source).toContain('useState<EmployeeCostRange>("30d")');
  expect(source).toContain("row.monthlyCostMicroUsd ?? 0");
  expect(source).toContain('locale === "ko" ? "30일" : "30d"');
  expect(source).toContain('renderEmployeeSortHeader("weeklyCost", usageText.weeklyTokens)');
  expect(source).toContain("?.weeklyCostMicroUsd ?? -1");
  expect(source).not.toContain("row.dailyCostMicroUsd ?? 0");
  expect(source).toContain('action: "updateWeeklyTokenQuota"');
  expect(source).toContain("sourceQuota && sourceQuota.version > 0");
  expect(source).toContain("expectedVersion: sourceQuota.version");
  expect(source).toContain("limitTokens,");
  expect(source).toContain("EmployeeWeeklyTokenQuotaEditor");
  expect(source).toContain("EMPLOYEE_WEEKLY_TOKEN_LIMIT_DEFAULT");
  expect(source).toContain("EMPLOYEE_WEEKLY_TOKEN_LIMIT_SLIDER_STEP = 1_000_000");
  expect(source).toContain('type="range"');
  expect(source).toContain("formatWeeklyTokenLimitInput");
  expect(source).toContain("parseWeeklyTokenLimitInput");
  expect(source).toContain("WeeklyTokenQuotaInfo");
  expect(source).toContain("TooltipProvider");
  expect(source).toContain("employee-weekly-token-slider-current");
  expect(source).toContain("tenantMonthlyTokenLimit");
  expect(source).toContain("monthlyLimitExceeded");
  expect(source).toContain("defaultEmployeeWeeklyTokenLimit");
  expect(source).toContain('locale === "ko" ? "적용" : "Apply"');
  expect(source).toContain("employeeCostRange");
  expect(source).not.toContain("Provider-confirmed Tenant Chat cost only");
  expect(source).not.toContain("employee-cost-insights-status");
  expect(source).toContain('locale === "ko" ? "직원" : "Employees"');
  expect(source).toContain("if (response.status === 409)");
  expect(source).toContain("disabled={pending}");
  expect(source).not.toContain("function costLimitUsd(");
  expect(source).not.toContain("usage.periodTimezone");
  expect(source).not.toContain("AnalyticsEmployeeTokenBarChart");
  expect(styles).toContain(".employee-weekly-token-footer {");
  expect(styles).toContain(".employee-weekly-token-slider-current {");
  expect(styles).toContain(".employee-weekly-token-switch:is([data-checked], [aria-checked=\"true\"])");
});

test("employee cost graph requests Tenant Chat ranges", async () => {
  const [pageSource, source] = await Promise.all([
    readFile(employeePageSourceUrl, "utf8"),
    readFile(employeeManagementSourceUrl, "utf8")
  ]);

  expect(pageSource).toContain("getAllEmployeeUsage({");
  expect(pageSource).toContain('metric: "cost"');
  expect(pageSource).toContain('source: "tenant_chat"');
  expect(source).toContain("&range=${employeeCostRange}");
  expect(source).toContain('["24h", "7d", "30d"]');
});

test("employee monetary values round to at most three decimal places", async () => {
  const source = await readFile(employeeManagementSourceUrl, "utf8");

  expect(source).toContain("return formatUsd(usd, locale ===");
  expect(source).toContain('return formatUsd(value, "en-US")');
  expect(source).toContain("maximumFractionDigits: 3");
  expect(source).toContain("minimumFractionDigits: 2");
  expect(source).toContain("microUsdMaximumFractionDigits={3}");
});
