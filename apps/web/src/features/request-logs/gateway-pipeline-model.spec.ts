import { expect, test } from "@playwright/test";
import { buildGatewayPipelineModel } from "./gateway-pipeline-model";
import type { DomainOutcomes } from "@/lib/fixtures/v1-observability-fixtures";
import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";

test("maps a successful provider call without inventing adapter success", () => {
  const model = buildGatewayPipelineModel(record());

  expect(step(model, "adapter")).toMatchObject({
    statusLabel: "CALLED",
    tone: "policy"
  });
  expect(step(model, "provider")).toMatchObject({
    statusLabel: "SUCCESS",
    tone: "success"
  });
  expect(model.flow).toEqual({
    cacheOutcome: "miss",
    route: "provider",
    stopStageId: "provider"
  });
});

test("marks provider stages skipped on an exact cache hit", () => {
  const model = buildGatewayPipelineModel(
    record({
      cacheStatus: "hit",
      domainOutcomes: outcomes({
        cache: "hit",
        provider: "not_called"
      }),
      providerCalled: false
    })
  );

  expect(step(model, "cache").tone).toBe("success");
  expect(step(model, "adapter").tone).toBe("skipped");
  expect(step(model, "provider").tone).toBe("skipped");
  expect(model.flow).toEqual({
    cacheOutcome: "hit",
    route: "cache",
    stopStageId: "cache"
  });
});

test("maps safety block and rate limit from actual guardrail outcomes", () => {
  const safetyBlocked = buildGatewayPipelineModel(
    record({
      domainOutcomes: outcomes({
        safety: "blocked",
        routing: "skipped",
        cache: "bypassed",
        provider: "not_called"
      }),
      providerCalled: false,
      status: "blocked",
      terminalStatus: "blocked"
    })
  );
  const rateLimited = buildGatewayPipelineModel(
    record({
      domainOutcomes: outcomes({
        rateLimit: "rate_limited",
        routing: "skipped",
        cache: "bypassed",
        provider: "not_called"
      }),
      providerCalled: false,
      status: "rate_limited",
      terminalStatus: "rate_limited"
    })
  );

  expect(step(safetyBlocked, "guardrails")).toMatchObject({
    statusLabel: "BLOCKED",
    tone: "error"
  });
  expect(step(rateLimited, "guardrails")).toMatchObject({
    statusLabel: "RATE LIMITED",
    tone: "warning"
  });
  expect(safetyBlocked.flow).toMatchObject({
    route: "stopped",
    stopStageId: "guardrails"
  });
  expect(rateLimited.flow).toMatchObject({
    route: "stopped",
    stopStageId: "guardrails"
  });
});

test("keeps provider failure and fallback outcome separate", () => {
  const model = buildGatewayPipelineModel(
    record({
      domainOutcomes: outcomes({
        provider: "timeout",
        fallback: "success"
      }),
      errorStage: "provider",
      providerCalled: true
    })
  );

  expect(step(model, "provider").tone).toBe("error");
  expect(model.fallback).toMatchObject({
    outcome: "SUCCESS",
    tone: "success"
  });
});

test("does not promote unknown outcomes to success", () => {
  const model = buildGatewayPipelineModel(
    record({
      domainOutcomes: outcomes({
        routing: "future_outcome",
        provider: "future_outcome"
      })
    })
  );

  expect(step(model, "decision").tone).toBe("neutral");
  expect(step(model, "provider").tone).toBe("neutral");
});

test("maps real authentication failures and cache store skips", () => {
  const model = buildGatewayPipelineModel(
    record({
      cacheStatus: "miss",
      domainOutcomes: outcomes({
        auth: "invalid_api_key",
        cache: "store_skipped",
        runtime: "not_checked"
      })
    })
  );

  expect(step(model, "authentication").tone).toBe("error");
  expect(step(model, "cache").tone).toBe("skipped");
  expect(step(model, "cache").statusLabel).toBe("STORE SKIPPED");
  expect(model.flow).toEqual({
    cacheOutcome: "store_skipped",
    route: "stopped",
    stopStageId: "authentication"
  });
});

test("preserves an unknown provider call state instead of claiming a call", () => {
  const model = buildGatewayPipelineModel(
    record({
      domainOutcomes: outcomes({ provider: "future_outcome" }),
      providerCalled: undefined,
      providerAttempt: null,
      providerLatencyMs: null
    })
  );

  expect(step(model, "adapter")).toMatchObject({
    statusLabel: "UNKNOWN",
    tone: "neutral"
  });
  expect(step(model, "provider")).toMatchObject({
    statusLabel: "UNKNOWN",
    tone: "neutral"
  });
  expect(model.flow).toEqual({
    cacheOutcome: "miss",
    route: "stopped",
    stopStageId: "decision"
  });
});

test("keeps a canonical provider failure when the legacy call flag is absent", () => {
  const model = buildGatewayPipelineModel(
    record({
      domainOutcomes: outcomes({ provider: "error" }),
      providerCalled: undefined,
      providerLatencyMs: null
    })
  );

  expect(step(model, "adapter")).toMatchObject({
    statusLabel: "CALLED",
    tone: "policy"
  });
  expect(step(model, "provider")).toMatchObject({
    statusLabel: "ERROR",
    tone: "error"
  });
  expect(model.flow).toEqual({
    cacheOutcome: "miss",
    route: "provider",
    stopStageId: "provider"
  });
});

test("stops at an adapter failure even when downstream fields conflict", () => {
  const model = buildGatewayPipelineModel(
    record({ errorStage: "provider_adapter" })
  );

  expect(step(model, "adapter").tone).toBe("error");
  expect(model.flow).toEqual({
    cacheOutcome: "miss",
    route: "provider",
    stopStageId: "adapter"
  });
});

test("treats non-applied guardrails as passed when the evaluated policy passed", () => {
  const model = buildGatewayPipelineModel(
    record({
      domainOutcomes: outcomes({
        budget: "not_used",
        rateLimit: "not_checked",
        safety: "passed"
      })
    })
  );

  expect(step(model, "guardrails").tone).toBe("success");
  expect(step(model, "guardrails").statusLabel).toBe("PASSED");
});

test("does not render fallback when it was not needed or disabled", () => {
  for (const outcome of ["not_needed", "disabled"]) {
    expect(
      buildGatewayPipelineModel(
        record({ domainOutcomes: outcomes({ fallback: outcome }) })
      ).fallback
    ).toBeNull();
  }
});

test("uses warning copy and tone for a budget warning", () => {
  const model = buildGatewayPipelineModel(
    record({ domainOutcomes: outcomes({ budget: "warned" }) })
  );

  expect(step(model, "guardrails")).toMatchObject({
    description: "예산 정책 경고가 요청에 적용되었습니다.",
    statusLabel: "WARNED",
    tone: "warning"
  });
  expect(model.flow).toMatchObject({
    route: "provider",
    stopStageId: "provider"
  });
});

test("falls back safely when legacy cache status is missing", () => {
  const model = buildGatewayPipelineModel(
    record({
      cacheStatus: undefined as unknown as string,
      domainOutcomes: {
        ...outcomes(),
        cache: { outcome: "" }
      }
    })
  );

  expect(step(model, "cache")).toMatchObject({
    statusLabel: "NOT USED",
    tone: "skipped"
  });
  expect(model.flow.cacheOutcome).toBe("not_used");
});

function step(
  model: ReturnType<typeof buildGatewayPipelineModel>,
  id: ReturnType<typeof buildGatewayPipelineModel>["stages"][number]["id"]
) {
  const result = model.stages.find((stage) => stage.id === id);
  expect(result).toBeDefined();
  return result!;
}

function outcomes(
  overrides: Partial<Record<keyof DomainOutcomes, string>> = {}
): DomainOutcomes {
  return {
    auth: { outcome: overrides.auth ?? "passed" },
    runtime: { outcome: overrides.runtime ?? "snapshot_active" },
    rateLimit: { outcome: overrides.rateLimit ?? "allowed" },
    budget: { outcome: overrides.budget ?? "allowed" },
    safety: { outcome: overrides.safety ?? "passed" },
    routing: { outcome: overrides.routing ?? "selected" },
    cache: { outcome: overrides.cache ?? "miss" },
    provider: { outcome: overrides.provider ?? "success" },
    fallback: { outcome: overrides.fallback ?? "not_called" },
    streaming: { outcome: overrides.streaming ?? "not_streaming" },
    logging: { outcome: overrides.logging ?? "written" }
  };
}

function record(overrides: Partial<LiveInvocationLogRecord> = {}): LiveInvocationLogRecord {
  return {
    apiKeyId: "not-exposed",
    appTokenId: "not-exposed",
    applicationId: "application-id",
    budgetScope: {
      budgetScopeId: "application-id",
      budgetScopeType: "application",
      resolvedBy: "default_application"
    },
    cacheHitRequestId: null,
    cacheKeyHash: null,
    cacheStatus: "miss",
    cacheType: "exact",
    category: "general",
    completedAt: "2026-07-11T00:00:01.000Z",
    completionTokens: 20,
    costMicroUsd: 100,
    createdAt: "2026-07-11T00:00:00.000Z",
    domainOutcomes: outcomes(),
    difficulty: "simple",
    endUserId: null,
    endpoint: "/v1/chat/completions",
    errorCode: null,
    errorMessage: null,
    errorStage: null,
    featureId: null,
    httpStatus: 200,
    latencyMs: 1000,
    maskingAction: "none",
    maskingDetectedCount: 0,
    maskingDetectedTypes: [],
    metadata: {
      runtime: {
        runtimeSnapshot: null
      }
    },
    method: "POST",
    modelRef: "catalog:general-simple",
    projectId: "project-id",
    promptHash: "not-exposed",
    promptTokens: 10,
    providerAttempt: {
      providerId: "openai",
      modelId: "gpt-4o-mini",
      outcome: "succeeded",
      latencyMs: 900,
      sanitizedErrorCode: null
    },
    providerCalled: true,
    providerLatencyMs: 900,
    rateLimitDecision: {
      allowed: true,
      durationMs: 0,
      limit: 0,
      reason: "not-exposed",
      remaining: 0,
      resetAt: "2026-07-11T00:01:00.000Z",
      retryAfterSeconds: 0,
      scope: "application",
      scopeId: "application-id",
      windowSeconds: 60,
      windowStart: "2026-07-11T00:00:00.000Z"
    },
    redactedPromptPreview: null,
    requestBodyHash: "not-exposed",
    requestedModel: "gpt-4o-mini",
    requestId: "request-id",
    routingReason: "standard",
    savedCostMicroUsd: 0,
    source: "test",
    status: "success",
    stream: false,
    terminalStatus: "success",
    tenantId: "tenant-id",
    totalTokens: 30,
    traceId: "trace-id",
    ...overrides
  };
}
