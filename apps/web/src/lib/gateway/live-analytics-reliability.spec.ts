import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("./live-analytics-reliability.ts", import.meta.url), "utf8");

test("loads tenant-wide reliability from the dedicated aggregate endpoint", () => {
  expect(source).toContain("/api/analytics/reliability?");
  expect(source).toContain('filters.projectId ? "project_application"');
  expect(source).toContain('filters.surface ?? "all"');
  expect(source).toContain("fallbackRecoveryRate");
  expect(source).toContain("recentIncidents");
  expect(source).not.toContain("getLiveGatewayRequestLogs");
  expect(source).not.toContain("limit: 100");
});
