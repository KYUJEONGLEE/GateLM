import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const sourceUrl = new URL("./route.ts", import.meta.url);

test("live usage BFF derives identity scope and accepts only range and project filters", async () => {
  const source = await readFile(sourceUrl, "utf8");
  expect(source).toContain("getCurrentConsoleAuthForCookieHeader");
  expect(source).toContain("hasConsoleTenantAccess");
  expect(source).toContain('projectsModel.source !== "control-plane"');
  expect(source).toContain("projectsModel.projects.some((project) => project.id === requestedProjectId)");
  expect(source).toContain("resolveProjectIdForConsoleAuth({");
  expect(source).toContain("effectiveProjectId ?? requestedProjectId");
  expect(source).toContain("normalizeRange(query.get");
  expect(source).not.toContain('query.get("from")');
  expect(source).not.toContain('query.get("to")');
  expect(source).not.toContain('query.get("employeeId")');
  expect(source).toContain("request.signal");
  expect(source).toContain('"Cache-Control": "no-store"');
});

test("live usage BFF preserves unavailable separately from upstream errors", async () => {
  const source = await readFile(sourceUrl, "utf8");
  expect(source).toContain('result.status === "unavailable"');
  expect(source).toContain('jsonError("Live usage is unavailable", 503)');
  expect(source).toContain('jsonError("Failed to load live usage", 502)');
});
