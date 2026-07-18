import { expect, test } from "@playwright/test";
import type { TenantChatInvocation } from "@/lib/control-plane/tenant-chat-observability-client";
import { toTenantChatRequestLog } from "@/lib/control-plane/tenant-chat-request-log";
import {
  buildRequestLogSafetyDetail,
  maskingUnavailableLabel
} from "../request-log-safety-detail";

test("localizes unavailable masking evidence", () => {
  expect(maskingUnavailableLabel("en")).toBe("Masking unavailable");
  expect(maskingUnavailableLabel("ko")).toBe("마스킹 관측 불가");
});

test("formats observed redaction evidence in the request detail", () => {
  const detail = buildRequestLogSafetyDetail(
    record({
      maskingAction: "redacted",
      maskingDetectedCount: 2,
      maskingDetectedTypes: ["email", "phone_number"]
    })
  );

  expect(detail).toEqual({
    outcome: "redacted",
    maskingAction: "redacted",
    detectedCount: 2,
    detectedTypes: ["email", "phone_number"]
  });
});

test("formats an explicitly observed no-masking result as none", () => {
  expect(buildRequestLogSafetyDetail(record())).toEqual({
    outcome: "passed",
    maskingAction: "none",
    detectedCount: 0,
    detectedTypes: []
  });
});

test("shows unavailable instead of none for missing historical evidence", () => {
  expect(buildRequestLogSafetyDetail(record({ maskingAction: null }))).toEqual({
    outcome: "not_checked",
    maskingAction: null,
    detectedCount: null,
    detectedTypes: null
  });
});

test("shows a historical safety block while keeping detector evidence unavailable", () => {
  expect(
    buildRequestLogSafetyDetail(
      record({ maskingAction: null, terminalOutcome: "safety_blocked" })
    )
  ).toEqual({
    outcome: "blocked",
    maskingAction: "blocked",
    detectedCount: null,
    detectedTypes: null
  });
});

function record(overrides: Partial<TenantChatInvocation> = {}) {
  return toTenantChatRequestLog({
    requestId: "req-tenant-chat-detail",
    surface: "tenant_chat",
    executionScopeKind: "tenant_chat",
    tenantId: "tenant-1",
    userId: "user-1",
    employeeId: "employee-1",
    actorKind: "employee",
    turnId: "turn-1",
    terminalOutcome: "succeeded",
    providerId: "openai",
    modelKey: "gpt-5.4-mini",
    attemptCount: 1,
    confirmedInputTokens: 10,
    confirmedOutputTokens: 20,
    confirmedTotalTokens: 30,
    confirmedCostMicroUsd: 12,
    maskingAction: "none",
    maskingDetectedTypes: [],
    maskingDetectedCount: 0,
    quotaState: "normal",
    budgetState: "normal",
    cacheOutcome: "miss",
    latencyMs: 350,
    ttftMs: 84,
    snapshotVersion: 14,
    pricingVersion: 1,
    startedAt: "2026-07-15T00:00:00.000Z",
    completedAt: "2026-07-15T00:00:00.350Z",
    projectionVersion: 1,
    ...overrides
  });
}
