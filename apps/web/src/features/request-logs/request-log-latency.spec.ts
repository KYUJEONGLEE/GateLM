import { expect, test } from "@playwright/test";

import { formatRequestLogTtft } from "./request-log-latency";

test("formats an observed TTFT without changing zero into an unknown value", () => {
  expect(formatRequestLogTtft(84)).toBe("84 ms");
  expect(formatRequestLogTtft(0)).toBe("0 ms");
});

test("renders missing or invalid TTFT as an em dash", () => {
  expect(formatRequestLogTtft(null)).toBe("—");
  expect(formatRequestLogTtft(undefined)).toBe("—");
  expect(formatRequestLogTtft(Number.NaN)).toBe("—");
  expect(formatRequestLogTtft(-1)).toBe("—");
});
