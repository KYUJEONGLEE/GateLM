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
});

test("maps a safety block without exposing the detected value", () => {
  const record = toTenantChatRequestLog(invocation({
    attemptCount: 0,
    cacheOutcome: "off",
    modelKey: null,
    providerId: null,
    terminalOutcome: "safety_blocked",
    ttftMs: null
  }));

  expect(record.status).toBe("blocked");
  expect(record.maskingAction).toBe("blocked");
  expect(record.maskingDetectedTypes).toEqual(["sensitive_information"]);
  expect(record.redactedPromptPreview).toBeNull();
  expect(record.providerCalled).toBe(false);
  expect(record.errorStage).toBe("safety");
  expect(record.ttftMs).toBeNull();
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
