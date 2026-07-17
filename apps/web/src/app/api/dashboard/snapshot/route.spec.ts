import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const routeSourceUrl = new URL("./route.ts", import.meta.url);

test("snapshot route authorizes tenant and project access before observability reads", async () => {
  const routeSource = await readFile(routeSourceUrl, "utf8");
  const authenticationIndex = routeSource.indexOf("if (!auth.isAuthenticated)");
  const tenantAccessIndex = routeSource.indexOf("if (!hasConsoleTenantAccess(auth, tenantId))");
  const projectAccessIndex = routeSource.indexOf("if (effectiveProjectId === null)");
  const providerDirectoryReadIndex = routeSource.indexOf(
    "const providerDirectoryPromise = getLiveRequestProviderDirectory(tenantId)"
  );
  const observabilityReadIndex = routeSource.indexOf("] = await Promise.all([");

  expect(authenticationIndex).toBeGreaterThan(-1);
  expect(tenantAccessIndex).toBeGreaterThan(authenticationIndex);
  expect(projectAccessIndex).toBeGreaterThan(tenantAccessIndex);
  expect(providerDirectoryReadIndex).toBeGreaterThan(projectAccessIndex);
  expect(observabilityReadIndex).toBeGreaterThan(providerDirectoryReadIndex);
});

test("snapshot route shares one provider directory across both live-request surfaces", async () => {
  const routeSource = await readFile(routeSourceUrl, "utf8");

  expect(routeSource.match(/providerDirectoryPromise\.then/g)).toHaveLength(2);
  expect(routeSource).toMatch(/projects,\s+providerDirectory/);
  expect(routeSource).toContain("{ providerDirectory }");
});

test("snapshot route returns the whole dashboard payload without caching", async () => {
  const routeSource = (await readFile(routeSourceUrl, "utf8")).replaceAll("\r\n", "\n");

  expect(routeSource).toContain('const noStoreHeaders = { "Cache-Control": "no-store" }');
  expect(routeSource).toContain("costOverTime,");
  expect(routeSource).toContain("generatedAt: new Date().toISOString()");
  expect(routeSource).toContain("liveRequests,");
  expect(routeSource).toContain("monthToDateCostMicroUsd:");
  expect(routeSource).toContain("overview\n  }");
  expect(routeSource).toContain("isProjectScopedForTenant(auth, tenantId)");
});
