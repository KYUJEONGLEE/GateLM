import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);

test("analytics fails closed before loading tenant observability data", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const accessGuardIndex = pageSource.indexOf("hasConsoleTenantAccess(auth, effectiveTenantId)");
  const overviewReadIndex = pageSource.indexOf("getLiveDashboardOverview(effectiveTenantId");

  expect(accessGuardIndex).toBeGreaterThan(-1);
  expect(overviewReadIndex).toBeGreaterThan(accessGuardIndex);
  expect(pageSource).not.toContain("getLiveDashboardOverview(tenantId");
});

test("analytics forces project admins onto an assigned project", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain("resolveProjectIdForConsoleAuth({");
  expect(pageSource).toContain("projectId: effectiveProjectId ?? requestedFilters.projectId");
  expect(pageSource).toContain("getVisibleProjectsForConsoleAuth(");
  expect(pageSource).toContain("projectScoped ? null");
});

test("performance places provider filters before the shared range and project filters", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const providerFilterIndex = pageSource.indexOf("<span>{text.provider}</span>");
  const rangeFilterIndex = pageSource.indexOf("<span>{text.range}</span>");
  const projectFilterIndex = pageSource.indexOf("<span>{text.project}</span>");

  expect(providerFilterIndex).toBeGreaterThan(-1);
  expect(rangeFilterIndex).toBeGreaterThan(providerFilterIndex);
  expect(projectFilterIndex).toBeGreaterThan(rangeFilterIndex);
  expect(pageSource).not.toContain("analytics-v3-filter-row-secondary");
});
