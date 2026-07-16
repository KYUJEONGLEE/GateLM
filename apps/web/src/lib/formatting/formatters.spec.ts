import { expect, test } from "@playwright/test";
import { formatMicroUsdCurrency, formatResponseTimeSeconds } from "./formatters";

test("formats dashboard response time in seconds", () => {
  expect(formatResponseTimeSeconds(250)).toBe("0.25 s");
  expect(formatResponseTimeSeconds(1250)).toBe("1.25 s");
});

test("keeps sub-second precision and hides missing response time", () => {
  expect(formatResponseTimeSeconds(1)).toBe("0.001 s");
  expect(formatResponseTimeSeconds(null)).toBe("—");
  expect(formatResponseTimeSeconds(undefined)).toBe("—");
});

test("keeps micro-USD precision instead of presenting small costs as zero", () => {
  expect(formatMicroUsdCurrency(1)).toBe("$0.000001");
  expect(formatMicroUsdCurrency(49)).toBe("$0.000049");
  expect(formatMicroUsdCurrency(100)).toBe("$0.0001");
  expect(formatMicroUsdCurrency(1_000_000)).toBe("$1");
});
