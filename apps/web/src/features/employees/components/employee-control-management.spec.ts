import { expect, test } from "@playwright/test";

import { parseCompactStepperInput } from "./employee-policy-unit-stepper";

test("parses compact unit values after decimal input is complete", () => {
  expect(parseCompactStepperInput("1.25USD", "USD")).toBe(1.25);
  expect(parseCompactStepperInput("2K", "K")).toBe(2);
});

test("rejects incomplete or malformed compact unit values", () => {
  expect(parseCompactStepperInput("-", "USD")).toBeNull();
  expect(parseCompactStepperInput(".", "USD")).toBeNull();
  expect(parseCompactStepperInput("1.2.3USD", "USD")).toBeNull();
});
