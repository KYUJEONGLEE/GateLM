import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const routeSourceUrl = new URL("./route.ts", import.meta.url);

test("Tenant Chat policy payload requires the bounded cache toggle and 5 x 2 routing matrix", async () => {
  const source = await readFile(routeSourceUrl, "utf8");

  expect(source).toContain("Object.keys(record).length === 4");
  expect(source).toContain('typeof record.cacheEnabled === "boolean"');
  expect(source).toContain("Object.keys(routes).length === ROUTING_CATEGORIES.length");
  expect(source).toContain("Object.keys(cells).length === 2");
  expect(source).toContain("modelRefs.length <= 4");
});
