import { expect, test } from "@playwright/test";

import { resolveAnalyticsSurfaceScope } from "./analytics-surface-scope";

test("includes Tenant Chat only for a tenant-wide all-projects selection", () => {
  expect(resolveAnalyticsSurfaceScope({ projectId: "", projectScoped: false })).toBe("all");
});

test("excludes Tenant Chat when a tenant admin selects a project", () => {
  expect(resolveAnalyticsSurfaceScope({
    projectId: "project_demo",
    projectScoped: false
  })).toBe("project_application");
});

test("excludes Tenant Chat for project-scoped admins", () => {
  expect(resolveAnalyticsSurfaceScope({ projectId: "", projectScoped: true })).toBe(
    "project_application"
  );
});
