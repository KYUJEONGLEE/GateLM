import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const routeSourceUrl = new URL("./route.ts", import.meta.url);

test("snapshot route authorizes tenant and project access before observability reads", async () => {
  const routeSource = await readFile(routeSourceUrl, "utf8");
  const authenticationIndex = routeSource.indexOf("if (!auth.isAuthenticated)");
  const tenantAccessIndex = routeSource.indexOf("if (!hasConsoleTenantAccess(auth, tenantId))");
  const projectAccessIndex = routeSource.indexOf("if (effectiveProjectId === null)");
  const observabilityReadIndex = routeSource.indexOf("] = await Promise.all([");

  expect(authenticationIndex).toBeGreaterThan(-1);
  expect(tenantAccessIndex).toBeGreaterThan(authenticationIndex);
  expect(projectAccessIndex).toBeGreaterThan(tenantAccessIndex);
  expect(observabilityReadIndex).toBeGreaterThan(projectAccessIndex);
});

test("snapshot route excludes live-request reads and filters", async () => {
  const routeSource = await readFile(routeSourceUrl, "utf8");

  expect(routeSource).not.toContain("getLiveOverviewRequests");
  expect(routeSource).not.toContain("getTenantChatLiveRequests");
  expect(routeSource).not.toContain("getLiveRequestProviderDirectory");
  expect(routeSource).not.toContain('query.get("status")');
  expect(routeSource).not.toContain('query.get("model")');
  expect(routeSource).not.toContain("liveRequests,");
});

test("snapshot route returns the aggregate dashboard payload without caching", async () => {
  const routeSource = (await readFile(routeSourceUrl, "utf8")).replaceAll("\r\n", "\n");

  expect(routeSource).toContain('const noStoreHeaders = { "Cache-Control": "no-store" }');
  expect(routeSource).toContain("costOverTime,");
  expect(routeSource).toContain("generatedAt: new Date().toISOString()");
  expect(routeSource).toContain("monthToDateCostMicroUsd:");
  expect(routeSource).toContain("overview\n  }");
  expect(routeSource).toContain("isProjectScopedForTenant(auth, tenantId)");
});
