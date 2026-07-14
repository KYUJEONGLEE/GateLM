import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);

test("request logs validates tenant access before directory or Gateway reads", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const accessGuardIndex = pageSource.indexOf(
    "if (!hasConsoleTenantAccess(auth, effectiveTenantId))"
  );
  const projectsReadIndex = pageSource.indexOf("getProjectsModel(effectiveTenantId)");
  const employeesReadIndex = pageSource.indexOf("getTenantEmployees(effectiveTenantId)");
  const gatewayReadIndex = pageSource.indexOf("getLiveGatewayRequestLogsWithMeta({");

  expect(accessGuardIndex).toBeGreaterThan(-1);
  expect(projectsReadIndex).toBeGreaterThan(accessGuardIndex);
  expect(employeesReadIndex).toBeGreaterThan(accessGuardIndex);
  expect(gatewayReadIndex).toBeGreaterThan(accessGuardIndex);
});
