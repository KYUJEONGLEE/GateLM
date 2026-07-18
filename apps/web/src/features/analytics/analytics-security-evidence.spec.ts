import { expect, test } from "@playwright/test";
import {
  buildAnalyticsSecurityEvidence,
  mergeAnalyticsSecurityEvidence
} from "./analytics-security-evidence";

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

test("merges Tenant Chat aggregate evidence without treating general policy blocks as safety blocks", () => {
  const evidence = mergeAnalyticsSecurityEvidence({
    projectApplicationEvidence: {
      detectedTypeRows: [{ id: "email", label: "email", value: 1 }],
      protectedRequestCount: 4,
      sampledDetailCount: 1
    },
    projectApplicationOverview: {
      maskingActionCounts: { redacted: 4, blocked: 2 },
      blockedRequests: 99,
      breakdowns: { bySafetyOutcome: [] }
    } as never,
    tenantChatDashboard: {
      security: {
        protectedRequests: 4,
        redactedRequests: 3,
        blockedRequests: 1,
        byDetectorType: [
          { detectorType: "email", requestCount: 2 },
          { detectorType: "api_key", requestCount: 1 }
        ],
        coverage: { state: "complete", observedFrom: "2026-07-12T00:00:00Z" }
      }
    } as never
  });

  expect(evidence).toMatchObject({
    maskedRequestCount: 7,
    blockedRequestCount: 3,
    protectedRequestCount: 10,
    sampledDetailCount: 1,
    detectorEvidenceMode: "mixed",
    detectedTypeRows: [
      { id: "email", label: "email", value: 3 },
      { id: "api_key", label: "api_key", value: 1 }
    ]
  });
});

test("treats a legacy Tenant Chat aggregate without security evidence as unavailable", () => {
  const evidence = mergeAnalyticsSecurityEvidence({
    tenantChatDashboard: {} as never
  });

  expect(evidence).toEqual({
    blockedRequestCount: 0,
    detectedTypeRows: [],
    detectorEvidenceMode: "unavailable",
    maskedRequestCount: 0,
    protectedRequestCount: 0,
    sampledDetailCount: 0
  });
});
