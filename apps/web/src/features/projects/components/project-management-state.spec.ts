import { expect, test } from "@playwright/test";
import {
  compareProjectCreatedAtDescending,
  getProjectCreateActionLocation,
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

test("sorts the newest project first", () => {
  expect(
    compareProjectCreatedAtDescending(
      { createdAt: "2026-07-11T12:00:00.000Z" },
      { createdAt: "2026-07-10T12:00:00.000Z" }
    )
  ).toBeLessThan(0);
});
