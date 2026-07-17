import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const routeSourceUrl = new URL("./route.ts", import.meta.url);

test("employee route forwards the weekly token quota through the authenticated PATCH proxy", async () => {
  const source = await readFile(routeSourceUrl, "utf8");

  expect(source).toContain('| "updateWeeklyTokenQuota"');
  expect(source).toContain('value === "updateWeeklyTokenQuota"');
  expect(source).toContain('if (action === "updateWeeklyTokenQuota")');
  expect(source).toContain("updateEmployeeWeeklyTokenQuota(values, requestOptions)");
  expect(source).toContain(
    "/admin/v1/tenants/${encodeURIComponent(values.tenantId)}/employees/${encodeURIComponent(values.employeeId)}/weekly-token-quota"
  );
  expect(source).toContain('method: "PATCH"');
  expect(source).toContain('cache: "no-store"');
  expect(source).toContain("headers: await buildControlPlaneHeaders(requestOptions");
  expect(source).toContain('return NextResponse.json({ weeklyTokenQuota: result.data, status: result.status })');
  expect(source).not.toContain('value === "updateCostPolicy"');
});

test("employee weekly token quota proxy validates bounded request fields", async () => {
  const source = await readFile(routeSourceUrl, "utf8");

  expect(source).toContain("const UUID_PATTERN =");
  expect(source).toContain("UUID_PATTERN.test(record.employeeId)");
  expect(source).toContain("UUID_PATTERN.test(record.tenantId)");
  expect(source).toContain("isNonNegativeSafeInteger(record.limitTokens)");
  expect(source).toContain("record.expectedVersion === undefined");
  expect(source).toContain("Number.isSafeInteger(record.expectedVersion)");
  expect(source).toContain("record.expectedVersion > 0");
});

test("employee weekly token quota proxy forwards only contract fields and bounds errors", async () => {
  const source = await readFile(routeSourceUrl, "utf8");
  const bodyStart = source.indexOf("body: JSON.stringify({", source.indexOf("updateEmployeeWeeklyTokenQuota"));
  const bodyEnd = source.indexOf('cache: "no-store"', bodyStart);
  const forwardedBody = source.slice(bodyStart, bodyEnd);

  expect(bodyStart).toBeGreaterThan(-1);
  expect(bodyEnd).toBeGreaterThan(bodyStart);
  expect(forwardedBody).toContain("enabled: values.enabled");
  expect(forwardedBody).toContain("limitTokens: values.limitTokens");
  expect(forwardedBody).toContain(
    "...(values.expectedVersion !== undefined ? { expectedVersion: values.expectedVersion } : {})"
  );
  expect(forwardedBody).not.toMatch(/credential|cookie|authorization|tenantId|employeeId/i);
  expect(source).toContain("error: getControlPlaneErrorMessage(payload, response.status)");
  expect(source).toContain("const nestedMessage = (message as Record<string, unknown>).message");
  expect(source).toContain('{ status: result.status > 0 ? result.status : 502 }');
});
