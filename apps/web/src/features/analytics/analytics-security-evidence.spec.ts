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
      breakdowns: { bySafetyOutcome: [] },
      totalRequests: 20
    } as never,
    tenantChatDashboard: {
      requests: { total: 12 },
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
    ],
    sources: [
      {
        id: "project_application",
        protectedRequestCount: 6,
        maskedRequestCount: 4,
        blockedRequestCount: 2,
        detectorEvidenceMode: "sampled",
        totalRequestCount: 20
      },
      {
        id: "tenant_chat",
        protectedRequestCount: 4,
        maskedRequestCount: 3,
        blockedRequestCount: 1,
        detectorEvidenceMode: "complete",
        totalRequestCount: 12
      }
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
    sampledDetailCount: 0,
    sources: [
      {
        id: "tenant_chat",
        protectedRequestCount: 0,
        maskedRequestCount: 0,
        blockedRequestCount: 0,
        detectorEvidenceMode: "unavailable",
        totalRequestCount: 0
      }
    ]
  });
});

test("keeps Tenant Chat absent from project-scoped security evidence", () => {
  const evidence = mergeAnalyticsSecurityEvidence({
    projectApplicationOverview: {
      maskingActionCounts: { redacted: 2, blocked: 1 },
      breakdowns: { bySafetyOutcome: [] },
      totalRequests: 5
    } as never
  });

  expect(evidence?.sources).toEqual([
    {
      id: "project_application",
      protectedRequestCount: 3,
      maskedRequestCount: 2,
      blockedRequestCount: 1,
      detectorEvidenceMode: "unavailable",
      totalRequestCount: 5
    }
  ]);
});
