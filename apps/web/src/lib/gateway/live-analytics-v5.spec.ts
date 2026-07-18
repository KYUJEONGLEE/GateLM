import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./live-analytics-v5.ts", import.meta.url), "utf8");

test("loads unified policy impact and model traffic from the uncapped aggregate API", () => {
  expect(source).toContain("/api/analytics/policy-impact?");
  expect(source).toContain("modelBuckets");
  expect(source).toContain("routingRoles");
  expect(source).toContain("usageSources");
  expect(source).toContain("metricCoverage");
  expect(source).not.toContain("getLiveGatewayRequestLogs");
  expect(source).not.toContain("limit: 1000");
});
