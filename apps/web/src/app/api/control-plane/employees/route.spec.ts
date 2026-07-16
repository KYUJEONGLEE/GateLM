import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const routeSourceUrl = new URL("./route.ts", import.meta.url);

test("employee route forwards updateCostPolicy through the authenticated PATCH proxy", async () => {
  const source = await readFile(routeSourceUrl, "utf8");

  expect(source).toContain('| "updateCostPolicy"');
  expect(source).toContain('value === "updateCostPolicy"');
  expect(source).toContain('if (action === "updateCostPolicy")');
  expect(source).toContain("updateEmployeeCostPolicy(values, requestOptions)");
  expect(source).toContain(
    "/admin/v1/tenants/${encodeURIComponent(values.tenantId)}/employees/${encodeURIComponent(values.employeeId)}/cost-policy"
  );
  expect(source).toContain('method: "PATCH"');
  expect(source).toContain('cache: "no-store"');
  expect(source).toContain("headers: await buildControlPlaneHeaders(requestOptions");
  expect(source).toContain('return NextResponse.json({ costPolicy: result.data, status: result.status })');
});

test("employee cost policy proxy validates every bounded request field", async () => {
  const source = await readFile(routeSourceUrl, "utf8");

  expect(source).toContain("const UUID_PATTERN =");
  expect(source).toContain("UUID_PATTERN.test(record.employeeId)");
  expect(source).toContain("UUID_PATTERN.test(record.tenantId)");
  expect(source).toContain("isEmployeeCostLimitValues(record.daily)");
  expect(source).toContain("isEmployeeCostLimitValues(record.weekly)");
  expect(source).toContain("Number.isSafeInteger(record.limitMicroUsd)");
  expect(source).toContain("record.limitMicroUsd >= 0");
  expect(source).toContain("record.limitMicroUsd <= MAX_EMPLOYEE_COST_LIMIT_MICRO_USD");
  expect(source).toContain("(!record.enabled || record.limitMicroUsd > 0)");
  expect(source).toContain('record.enforcementMode === "monitor"');
  expect(source).toContain('record.enforcementMode === "restrict_high_cost"');
  expect(source).toContain("isNonNegativeSafeInteger(record.expectedVersion)");
  expect(source).toContain("record.warningThresholdPercent >= 1");
  expect(source).toContain("record.warningThresholdPercent <= 99");
});

test("employee cost policy proxy forwards only contract fields and bounds errors", async () => {
  const source = await readFile(routeSourceUrl, "utf8");
  const bodyStart = source.indexOf("body: JSON.stringify({", source.indexOf("updateEmployeeCostPolicy"));
  const bodyEnd = source.indexOf("}),\n        cache:", bodyStart);
  const forwardedBody = source.slice(bodyStart, bodyEnd);

  expect(bodyStart).toBeGreaterThan(-1);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  expect(forwardedBody).toContain("daily:");
  expect(forwardedBody).toContain("enforcementMode: values.enforcementMode");
  expect(forwardedBody).toContain("expectedVersion: values.expectedVersion");
  expect(forwardedBody).toContain("warningThresholdPercent: values.warningThresholdPercent");
  expect(forwardedBody).toContain("weekly:");
  expect(forwardedBody).not.toMatch(/credential|cookie|authorization|tenantId|employeeId/i);
  expect(source).toContain("error: getControlPlaneErrorMessage(payload, response.status)");
  expect(source).toContain("const nestedMessage = (message as Record<string, unknown>).message");
  expect(source).toContain('{ status: result.status > 0 ? result.status : 502 }');
});
