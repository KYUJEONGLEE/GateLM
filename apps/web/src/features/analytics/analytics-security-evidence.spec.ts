import { expect, test } from "@playwright/test";
import { buildAnalyticsSecurityEvidence } from "./analytics-security-evidence";

test("counts each detector type once per protected request", () => {
  const evidence = buildAnalyticsSecurityEvidence([
    {
      maskingDetectedTypes: ["email", "phone_number", "email"],
      safetySummary: {
        detectedCount: 3,
        detectorCategories: ["email"],
        mandatoryProtectedTypes: [],
        maskingAction: "redacted",
        outcome: "redacted",
        policyAllowedTypes: []
      }
    },
    {
      maskingDetectedTypes: ["EMAIL"],
      safetySummary: undefined
    },
    undefined
  ], 3);

  expect(evidence).toEqual({
    detectedTypeRows: [
      { id: "email", label: "email", value: 2 },
      { id: "phone_number", label: "phone_number", value: 1 }
    ],
    protectedRequestCount: 3,
    sampledDetailCount: 2
  });
});
