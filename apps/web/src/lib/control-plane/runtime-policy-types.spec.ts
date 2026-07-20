import { expect, test } from "@playwright/test";

import { toRuntimePolicyRateLimitWriteInput } from "./runtime-policy-types";

test("keeps the edited refill window in the runtime policy write input", () => {
  expect(
    toRuntimePolicyRateLimitWriteInput({
      rateLimitEnabled: true,
      rateLimitLimit: 60,
      rateLimitWindowSeconds: 30
    })
  ).toEqual({
    enabled: true,
    limit: 60,
    windowSeconds: 30
  });
});
