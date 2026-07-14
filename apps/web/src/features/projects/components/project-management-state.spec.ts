import { expect, test } from "@playwright/test";
import {
  compareProjectCreatedAtDescending,
  getProjectCreateActionLocation,
  getProjectSettingsHref,
  isProjectVisibleInList
} from "./project-management-state";

test("places the Tenant Admin create action in the empty state", () => {
  expect(getProjectCreateActionLocation(0, true)).toBe("empty");
});

test("keeps the Tenant Admin create action in the populated toolbar", () => {
  expect(getProjectCreateActionLocation(1, true)).toBe("toolbar");
});

test("does not expose the create action to Project Admins", () => {
  expect(getProjectCreateActionLocation(0, false)).toBeNull();
  expect(getProjectCreateActionLocation(1, false)).toBeNull();
});

test("keeps DRAFT projects in the main list and excludes only ARCHIVED projects", () => {
  expect(isProjectVisibleInList("ACTIVE")).toBe(true);
  expect(isProjectVisibleInList("DRAFT")).toBe(true);
  expect(isProjectVisibleInList("DISABLED")).toBe(true);
  expect(isProjectVisibleInList("ARCHIVED")).toBe(false);
});

test("opens the project policy workspace for every project state", () => {
  expect(
    getProjectSettingsHref("tenant-1", {
      id: "project-1"
    })
  ).toBe("/tenants/tenant-1/projects/project-1/policies");
});

test("sorts the newest project first", () => {
  expect(
    compareProjectCreatedAtDescending(
      { createdAt: "2026-07-11T12:00:00.000Z" },
      { createdAt: "2026-07-10T12:00:00.000Z" }
    )
  ).toBeLessThan(0);
});

test("keeps projects with invalid creation dates after valid projects", () => {
  expect(
    compareProjectCreatedAtDescending(
      { createdAt: "not-a-date" },
      { createdAt: "2026-07-11T12:00:00.000Z" }
    )
  ).toBeGreaterThan(0);
  expect(
    compareProjectCreatedAtDescending(
      { createdAt: "2026-07-11T12:00:00.000Z" },
      { createdAt: "not-a-date" }
    )
  ).toBeLessThan(0);
  expect(
    compareProjectCreatedAtDescending(
      { createdAt: "invalid-left" },
      { createdAt: "invalid-right" }
    )
  ).toBe(0);
});
