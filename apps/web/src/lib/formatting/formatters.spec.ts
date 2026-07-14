import { expect, test } from "@playwright/test";
import { formatResponseTimeSeconds } from "./formatters";

test("formats dashboard response time in seconds", () => {
  expect(formatResponseTimeSeconds(250)).toBe("0.25 s");
  expect(formatResponseTimeSeconds(1250)).toBe("1.25 s");
});

test("keeps sub-second precision and hides missing response time", () => {
  expect(formatResponseTimeSeconds(1)).toBe("0.001 s");
  expect(formatResponseTimeSeconds(null)).toBe("—");
  expect(formatResponseTimeSeconds(undefined)).toBe("—");
});
