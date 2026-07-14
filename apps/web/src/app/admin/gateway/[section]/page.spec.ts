import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);

test("gateway admin validates a real tenant-admin session before observability reads", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const authGuardIndex = pageSource.indexOf("!auth.isAuthenticated || !isTenantAdminForTenant(auth, tenantId)");
  const modelReadIndex = pageSource.indexOf("getGatewayAdminModel({");

  expect(authGuardIndex).toBeGreaterThan(-1);
  expect(modelReadIndex).toBeGreaterThan(authGuardIndex);
});
