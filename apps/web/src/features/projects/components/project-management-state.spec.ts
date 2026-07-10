import { expect, test } from "@playwright/test";
import { getProjectCreateActionLocation } from "./project-management-state";

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
