import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);

test("employee management validates tenant access before loading employees", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const accessGuardIndex = pageSource.indexOf(
    "if (!hasConsoleTenantAccess(auth, effectiveTenantId))"
  );
  const employeesReadIndex = pageSource.indexOf("getEmployeeControlModel(effectiveTenantId)");
  const usageReadIndex = pageSource.indexOf("getAllEmployeeUsage({");

  expect(accessGuardIndex).toBeGreaterThan(-1);
  expect(employeesReadIndex).toBeGreaterThan(accessGuardIndex);
  expect(usageReadIndex).toBeGreaterThan(accessGuardIndex);
});
