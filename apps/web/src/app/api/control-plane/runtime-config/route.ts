import { NextResponse } from "next/server";
import {
  publishRuntimePolicy,
  rollbackRuntimePolicy,
  saveRuntimePolicyDraft
} from "@/lib/control-plane/runtime-policy-client";
import {
  controlPlaneReadCacheTags,
  revalidateControlPlaneRead,
  runtimePolicyApplicationReadCacheTag
} from "@/lib/control-plane/read-cache";
import {
  runtimeRoutingCategories,
  runtimeRoutingDifficulties,
  type RuntimePolicyDraftValues
} from "@/lib/control-plane/runtime-policy-types";

type RequestPayload = {
  action?: unknown;
  applicationId?: unknown;
  targetConfigVersion?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;
  const requestOptions = { cookieHeader: request.headers.get("cookie") };

  if (
    payload.action !== "save-draft" &&
    payload.action !== "publish" &&
    payload.action !== "rollback"
  ) {
    return NextResponse.json({ error: "Unknown runtime policy action." }, { status: 400 });
  }

  if (payload.action === "rollback") {
    if (typeof payload.targetConfigVersion !== "string" || !payload.targetConfigVersion.trim()) {
      return NextResponse.json({ error: "Invalid rollback target." }, { status: 400 });
    }

    const applicationId = getOptionalApplicationId(payload.applicationId);
    const result = await rollbackRuntimePolicy(payload.targetConfigVersion, applicationId, requestOptions);

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          status: result.status
        },
        { status: result.status > 0 ? result.status : 502 }
      );
    }

    revalidateRuntimePolicyReadCache(applicationId);

    return NextResponse.json({
      runtimeConfig: result.data,
      status: result.status
    });
  }

  if (!isRuntimePolicyDraftValues(payload.values)) {
    return NextResponse.json({ error: "Invalid runtime policy payload." }, { status: 400 });
  }

  const applicationId = getOptionalApplicationId(payload.applicationId);
  const result =
    payload.action === "save-draft"
      ? await saveRuntimePolicyDraft(payload.values, applicationId, requestOptions)
      : await publishRuntimePolicy(payload.values, applicationId, requestOptions);

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        status: result.status
      },
      { status: result.status > 0 ? result.status : 502 }
    );
  }

  revalidateRuntimePolicyReadCache(applicationId);

  return NextResponse.json({
    runtimeConfig: result.data,
    status: result.status
  });
}

function revalidateRuntimePolicyReadCache(applicationId: string | undefined) {
  revalidateControlPlaneRead([
    controlPlaneReadCacheTags.runtimePolicy,
    ...(applicationId ? [runtimePolicyApplicationReadCacheTag(applicationId)] : [])
  ]);
}

function getOptionalApplicationId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRuntimePolicyDraftValues(value: unknown): value is RuntimePolicyDraftValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<RuntimePolicyDraftValues>;

  return (
    typeof record.budgetEnabled === "boolean" &&
    (record.budgetEnforcementMode === "warn" ||
      record.budgetEnforcementMode === "block" ||
      record.budgetEnforcementMode === "disabled") &&
    Number.isInteger(record.budgetWarningThresholdPercent) &&
    typeof record.cacheEnabled === "boolean" &&
    Number.isInteger(record.cacheTtlSeconds) &&
    typeof record.configVersion === "string" &&
    Array.isArray(record.detectors) &&
    Array.isArray(record.models) &&
    Array.isArray(record.pricingRules) &&
    typeof record.promptCaptureEnabled === "boolean" &&
    typeof record.promptCaptureMaxChars === "number" &&
    Number.isInteger(record.promptCaptureMaxChars) &&
    record.promptCaptureMaxChars >= 1 &&
    record.promptCaptureMaxChars <= 20000 &&
    typeof record.rateLimitEnabled === "boolean" &&
    Number.isInteger(record.rateLimitLimit) &&
    Number.isInteger(record.rateLimitRefillTokensPerSecond) &&
    Number.isInteger(record.rateLimitWindowSeconds) &&
    Number(record.rateLimitLimit) >= 1 &&
    Number(record.rateLimitLimit) <= 100000 &&
    Number(record.rateLimitRefillTokensPerSecond) >= 1 &&
    Number(record.rateLimitRefillTokensPerSecond) <= 100000 &&
    Number(record.rateLimitWindowSeconds) >= 1 &&
    Number(record.rateLimitWindowSeconds) <= 100000 &&
    isRoutingPolicyDraft(record.routingPolicy) &&
    !hasLegacyRoutingFields(record as Record<string, unknown>) &&
    record.detectors.every(isDetector) &&
    record.models.every(isModelConfig) &&
    record.pricingRules.every(isPricingRule)
  );
}

function isRoutingPolicyDraft(value: unknown) {
  if (!value || typeof value !== "object") {
    return false;
  }

  const policy = value as Record<string, unknown>;

  if (
    Object.keys(policy).length !== 3 ||
    (policy.mode !== "auto" && policy.mode !== "manual") ||
    (policy.bootstrapState !== "mock_bootstrap" && policy.bootstrapState !== "configured") ||
    !policy.routes ||
    typeof policy.routes !== "object"
  ) {
    return false;
  }

  const routes = policy.routes as Record<string, unknown>;

  return (
    Object.keys(routes).length === runtimeRoutingCategories.length &&
    runtimeRoutingCategories.every((category) => {
      const categoryRoutes = routes[category];

      if (!categoryRoutes || typeof categoryRoutes !== "object") {
        return false;
      }

      const difficultyRoutes = categoryRoutes as Record<string, unknown>;

      return (
        Object.keys(difficultyRoutes).length === runtimeRoutingDifficulties.length &&
        runtimeRoutingDifficulties.every((difficulty) => {
          const cell = difficultyRoutes[difficulty];
          const modelRefs =
            cell && typeof cell === "object"
              ? (cell as Record<string, unknown>).modelRefs
              : null;

          return Boolean(
            cell &&
              typeof cell === "object" &&
              Object.keys(cell as Record<string, unknown>).length === 1 &&
              Array.isArray(modelRefs) &&
              modelRefs.length > 0 &&
              modelRefs.every(
                (modelRef) => typeof modelRef === "string" && modelRef.trim()
              )
          );
        })
      );
    })
  );
}

function hasLegacyRoutingFields(record: Record<string, unknown>) {
  return [
    "routingDefaultModel",
    "routingDefaultProvider",
    "routingFallbackModel",
    "routingFallbackProvider",
    "routingHighQualityModel",
    "routingHighQualityProvider",
    "routingLowCostModel",
    "routingLowCostProvider",
    "routingShortPromptMaxChars"
  ].some((field) => field in record);
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
