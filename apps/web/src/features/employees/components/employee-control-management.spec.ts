import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import { parseCompactStepperInput } from "./employee-policy-unit-stepper";

const employeeManagementSourceUrl = new URL("./employee-control-management.tsx", import.meta.url);

test("parses compact unit values after decimal input is complete", () => {
  expect(parseCompactStepperInput("1.25USD", "USD")).toBe(1.25);
  expect(parseCompactStepperInput("2K", "K")).toBe(2);
});

test("rejects incomplete or malformed compact unit values", () => {
  expect(parseCompactStepperInput("-", "USD")).toBeNull();
  expect(parseCompactStepperInput(".", "USD")).toBeNull();
  expect(parseCompactStepperInput("1.2.3USD", "USD")).toBeNull();
});

test("bulk employee deletion always unlocks the UI and uses the latest selected employee", async () => {
  const source = await readFile(employeeManagementSourceUrl, "utf8");

  expect(source).toContain('setPendingAction("deleteSelected")');
  expect(source).toContain("} finally {\n      setPendingAction(null);");
  expect(source).toContain("setSelectedEmployeeId((current) =>");
  expect(source).not.toContain(
    "if (selectedEmployeeId && deletedIdSet.has(selectedEmployeeId))"
  );
});
