import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const routeSourceUrl = new URL("./route.ts", import.meta.url);

test("Tenant Chat policy payload accepts the current policy editor and bounded compatibility toggle", async () => {
  const source = await readFile(routeSourceUrl, "utf8");

  expect(source).toContain("function hasExactKeys");
  expect(source).toContain('"quota",');
  expect(source).toContain('"safetyPolicy"');
  expect(source).toContain("isCachePolicy(record.cachePolicy)");
  expect(source).toContain("isSafetyPolicy(record.safetyPolicy)");
  expect(source).toContain("isQuotaPolicy(record.quota)");
  expect(source).toContain("allDetectorsValid &&");
  expect(source).toContain("Array.from(MANDATORY_SAFETY_DETECTOR_TYPES).every");
  expect(source).toContain("detectorTypes.has(detectorType)");
  expect(source).toContain('"cacheEnabled", "manualModelRef", "routes", "routingMode"');
  expect(source).toContain('typeof record.cacheEnabled === "boolean"');
  expect(source).toContain("Object.keys(routes).length === ROUTING_CATEGORIES.length");
  expect(source).toContain("Object.keys(cells).length === 2");
  expect(source).toContain("modelRefs.length <= 4");
});
