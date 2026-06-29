import { NextResponse } from "next/server";
import {
  publishRuntimePolicy,
  saveRuntimePolicyDraft
} from "@/lib/control-plane/runtime-policy-client";
import type { RuntimePolicyDraftValues } from "@/lib/control-plane/runtime-policy-types";

type RequestPayload = {
  action?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (payload.action !== "save-draft" && payload.action !== "publish") {
    return NextResponse.json({ error: "Unknown runtime policy action." }, { status: 400 });
  }

  if (!isRuntimePolicyDraftValues(payload.values)) {
    return NextResponse.json({ error: "Invalid runtime policy payload." }, { status: 400 });
  }

  const result =
    payload.action === "save-draft"
      ? await saveRuntimePolicyDraft(payload.values)
      : await publishRuntimePolicy(payload.values);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        status: result.status
      },
      { status: result.status > 0 ? result.status : 502 }
    );
  }

  return NextResponse.json({
    runtimeConfig: result.data,
    status: result.status
  });
}

function isRuntimePolicyDraftValues(value: unknown): value is RuntimePolicyDraftValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<RuntimePolicyDraftValues>;

  return (
    typeof record.cacheEnabled === "boolean" &&
    Number.isInteger(record.cacheTtlSeconds) &&
    typeof record.configVersion === "string" &&
    Array.isArray(record.detectors) &&
    Array.isArray(record.models) &&
    Array.isArray(record.pricingRules) &&
    typeof record.rateLimitEnabled === "boolean" &&
    Number.isInteger(record.rateLimitLimit) &&
    typeof record.routingDefaultModel === "string" &&
    typeof record.routingDefaultProvider === "string" &&
    typeof record.routingFallbackModel === "string" &&
    typeof record.routingFallbackProvider === "string" &&
    typeof record.routingLowCostModel === "string" &&
    typeof record.routingLowCostProvider === "string" &&
    Number.isInteger(record.routingShortPromptMaxChars) &&
    record.detectors.every(isDetector) &&
    record.models.every(isModelConfig) &&
    record.pricingRules.every(isPricingRule)
  );
}

function isDetector(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const detector = value as Record<string, unknown>;

  return (
    typeof detector.enabled === "boolean" &&
    typeof detector.placeholder === "string" &&
    (detector.action === "redact" || detector.action === "block") &&
    typeof detector.type === "string"
  );
}

function isModelConfig(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const model = value as Record<string, unknown>;

  return (
    Number.isInteger(model.contextWindowTokens) &&
    typeof model.displayName === "string" &&
    typeof model.model === "string" &&
    typeof model.provider === "string" &&
    (model.status === "active" || model.status === "disabled") &&
    typeof model.supportsJsonMode === "boolean" &&
    typeof model.supportsStreaming === "boolean"
  );
}

function isPricingRule(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const rule = value as Record<string, unknown>;

  return (
    Number.isInteger(rule.completionTokenMicroUsd) &&
    typeof rule.model === "string" &&
    typeof rule.pricingVersion === "string" &&
    Number.isInteger(rule.promptTokenMicroUsd) &&
    typeof rule.provider === "string"
  );
}
