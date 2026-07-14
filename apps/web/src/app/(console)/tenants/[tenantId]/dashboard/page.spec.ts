import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);

test("dashboard validates tenant access before projects or observability reads", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const accessGuardIndex = pageSource.indexOf(
    "if (!hasConsoleTenantAccess(auth, effectiveTenantId))"
  );
  const projectsReadIndex = pageSource.indexOf("getProjectsModel(effectiveTenantId)");
  const gatewayReadIndex = pageSource.indexOf("getLiveDashboardOverview(effectiveTenantId");

  expect(accessGuardIndex).toBeGreaterThan(-1);
  expect(projectsReadIndex).toBeGreaterThan(accessGuardIndex);
  expect(gatewayReadIndex).toBeGreaterThan(accessGuardIndex);
});

test("month-to-date spend tolerates missing Tenant Chat usage", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain("tenantChat?.usage?.confirmedCostMicroUsd ?? 0");
});
