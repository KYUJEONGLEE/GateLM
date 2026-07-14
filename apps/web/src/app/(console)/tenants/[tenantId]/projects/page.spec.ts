import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);

test("projects validates tenant access before projects or cost reads", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const accessGuardIndex = pageSource.indexOf(
    "if (!hasConsoleTenantAccess(auth, effectiveTenantId))"
  );
  const projectsReadIndex = pageSource.indexOf("getProjectsModel(effectiveTenantId)");
  const costReadIndex = pageSource.indexOf(
    "getLiveMonthlyProjectCostReport(effectiveTenantId)"
  );

  expect(accessGuardIndex).toBeGreaterThan(-1);
  expect(projectsReadIndex).toBeGreaterThan(accessGuardIndex);
  expect(costReadIndex).toBeGreaterThan(accessGuardIndex);
});
