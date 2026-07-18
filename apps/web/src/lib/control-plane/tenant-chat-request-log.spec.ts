import { expect, test } from "@playwright/test";
import type { TenantChatInvocation } from "./tenant-chat-observability-client";
import {
  shouldIncludeTenantChatRequestLogs,
  toTenantChatRequestLog
} from "./tenant-chat-request-log";

test("includes Tenant Chat for tenant-wide and explicit Tenant Chat views only", () => {
  expect(shouldIncludeTenantChatRequestLogs({ projectScoped: false })).toBe(true);
  expect(shouldIncludeTenantChatRequestLogs({
    applicationId: "tenant_chat",
    projectScoped: false
  })).toBe(true);
  expect(shouldIncludeTenantChatRequestLogs({
    applicationId: "application-1",
    projectScoped: false
  })).toBe(false);
  expect(shouldIncludeTenantChatRequestLogs({
    projectId: "project-1",
    projectScoped: false
  })).toBe(false);
  expect(shouldIncludeTenantChatRequestLogs({ projectScoped: true })).toBe(false);
});

test("maps an exact cache hit without a provider attempt or cost", () => {
  const record = toTenantChatRequestLog(invocation({
    attemptCount: 0,
    cacheOutcome: "hit",
    confirmedCostMicroUsd: 0,
    terminalOutcome: "cache_hit",
    ttftMs: 0
  }));

  expect(record.status).toBe("success");
  expect(record.cacheStatus).toBe("hit");
  expect(record.providerCalled).toBe(false);
  expect(record.providerAttempt).toBeNull();
  expect(record.costMicroUsd).toBe(0);
  expect(record.ttftMs).toBe(0);
  expect(record.domainOutcomes?.provider.outcome).toBe("not_called");
  expect(record.domainOutcomes?.safety.outcome).toBe("passed");
  expect(record.safetySummary).toMatchObject({
    maskingAction: "none",
    observationState: "observed",
    outcome: "passed"
  });
});

test("preserves a redacted masking result and detector summary", () => {
  const record = toTenantChatRequestLog(invocation({
    maskingAction: "redacted",
    maskingDetectedCount: 2,
    maskingDetectedTypes: ["email", "phone_number"]
  }));

  expect(record.maskingAction).toBe("redacted");
  expect(record.domainOutcomes?.safety.outcome).toBe("redacted");
  expect(record.safetySummary).toEqual({
    detectedCount: 2,
    detectorCategories: ["email", "phone_number"],
    maskingAction: "redacted",
    observationState: "observed",
    outcome: "redacted"
  });
});

test("does not infer passed when historical masking evidence is unavailable", () => {
  const record = toTenantChatRequestLog(invocation({
    maskingAction: null,
    maskingDetectedCount: 0,
    maskingDetectedTypes: []
  }));

  expect(record.domainOutcomes?.safety.outcome).toBe("not_checked");
  expect(record.safetySummary).toMatchObject({
    maskingAction: null,
    observationState: "unavailable",
    outcome: "not_checked"
  });
});

test("maps a safety block without exposing the detected value", () => {
  const record = toTenantChatRequestLog(invocation({
    attemptCount: 0,
    cacheOutcome: "off",
    modelKey: null,
    maskingAction: "blocked",
    maskingDetectedCount: 1,
    maskingDetectedTypes: ["api_key"],
    providerId: null,
    terminalOutcome: "safety_blocked",
    ttftMs: null
  }));

  expect(record.status).toBe("blocked");
  expect(record.maskingAction).toBe("blocked");
  expect(record.maskingDetectedTypes).toEqual(["api_key"]);
  expect(record.redactedPromptPreview).toBeNull();
  expect(record.providerCalled).toBe(false);
  expect(record.errorStage).toBe("safety");
  expect(record.ttftMs).toBeNull();
  expect(record.safetySummary?.observationState).toBe("observed");
});

test("classifies a historical safety block without inventing detector evidence", () => {
  const record = toTenantChatRequestLog(invocation({
    attemptCount: 0,
    maskingAction: null,
    maskingDetectedCount: 0,
    maskingDetectedTypes: [],
    terminalOutcome: "safety_blocked"
  }));

  expect(record.maskingAction).toBe("blocked");
  expect(record.domainOutcomes?.safety.outcome).toBe("blocked");
  expect(record.safetySummary).toMatchObject({
    maskingAction: "blocked",
    observationState: "unavailable",
    outcome: "blocked"
  });
});

function invocation(overrides: Partial<TenantChatInvocation> = {}): TenantChatInvocation {
  return {
    requestId: "req-tenant-chat-1",
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
  };
}
