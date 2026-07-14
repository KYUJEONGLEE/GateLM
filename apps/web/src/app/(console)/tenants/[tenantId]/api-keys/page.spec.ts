import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);

test("API Key management validates tenant access before loading keys", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const accessGuardIndex = pageSource.indexOf(
    "if (!hasConsoleTenantAccess(auth, effectiveTenantId))"
  );
  const apiKeysReadIndex = pageSource.indexOf("getApiKeysModel(effectiveTenantId)");

  expect(accessGuardIndex).toBeGreaterThan(-1);
  expect(apiKeysReadIndex).toBeGreaterThan(accessGuardIndex);
});
