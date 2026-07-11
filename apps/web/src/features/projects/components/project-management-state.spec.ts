import { expect, test } from "@playwright/test";
import {
  getProjectCreateActionLocation,
  getRelativeTokenUsagePercent
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

test("compares token usage with the highest visible project", () => {
  expect(getRelativeTokenUsagePercent(5_000_000, 10_000_000)).toBe(50);
  expect(getRelativeTokenUsagePercent(10_000_000, 10_000_000)).toBe(100);
});

test("keeps unavailable and zero token usage distinguishable", () => {
  expect(getRelativeTokenUsagePercent(null, null)).toBeNull();
  expect(getRelativeTokenUsagePercent(0, 0)).toBe(0);
});
