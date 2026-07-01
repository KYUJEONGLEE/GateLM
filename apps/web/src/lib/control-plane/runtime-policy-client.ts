import "server-only";

import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";
import {
  getControlPlaneApplicationId,
  getControlPlaneBaseUrl
} from "@/lib/control-plane/control-plane-config";
import type {
  RuntimePolicyConfig,
  RuntimePolicyDraftValues,
  RuntimePolicyModel
} from "@/lib/control-plane/runtime-policy-types";

type RuntimeConfigFixture = {
  runtimeConfig: RuntimePolicyConfig;
};

type ControlPlaneRequestResult =
  | {
      data: RuntimePolicyConfig;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

export async function getRuntimePolicyModel(routeTenantId: string): Promise<RuntimePolicyModel> {
  const applicationId = getControlPlaneApplicationId();
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const fallbackConfig = getFixtureRuntimeConfig();

  const activeConfig = await fetchActiveRuntimeConfig(applicationId);

  if (activeConfig.ok) {
    return {
      activeConfig: activeConfig.data,
      applicationId,
      controlPlaneBaseUrl,
      loadError: null,
      routeTenantId,
      source: "control-plane"
    };
  }

  return {
    activeConfig: fallbackConfig,
    applicationId,
    controlPlaneBaseUrl,
    loadError: activeConfig.error,
    routeTenantId,
    source: "fixture"
  };
}

export async function getRuntimePolicyConfigForApplication(
  applicationId: string
): Promise<RuntimePolicyConfig | null> {
  const activeConfig = await fetchActiveRuntimeConfig(applicationId);

  return activeConfig.ok ? activeConfig.data : null;
}

export async function saveRuntimePolicyDraft(
  values: RuntimePolicyDraftValues
): Promise<ControlPlaneRequestResult> {
  return writeRuntimeConfig("draft", values);
}

export async function publishRuntimePolicy(
  values: RuntimePolicyDraftValues
): Promise<ControlPlaneRequestResult> {
  const draft = await writeRuntimeConfig("draft", values);

  if (!draft.ok) {
    return draft;
  }

  return writeRuntimeConfig("publish", values);
}

function getFixtureRuntimeConfig() {
  return (runtimeConfigFixture as RuntimeConfigFixture).runtimeConfig;
}

async function fetchActiveRuntimeConfig(
  applicationId: string
): Promise<ControlPlaneRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(applicationId)}/runtime-config/active`,
      {
        cache: "no-store"
      }
    );

    return readControlPlaneResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function writeRuntimeConfig(
  mode: "draft" | "publish",
  values: RuntimePolicyDraftValues
): Promise<ControlPlaneRequestResult> {
  const applicationId = getControlPlaneApplicationId();
  const endpoint = mode === "draft" ? "draft" : "publish";
  const body =
    mode === "draft"
      ? toDraftRequest(values)
      : {
          configVersion: values.configVersion,
          draftConfigVersion: values.configVersion,
          effectiveAt: new Date().toISOString()
        };

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(applicationId)}/runtime-config/${endpoint}`,
      {
        body: JSON.stringify(body),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    return readControlPlaneResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

function toDraftRequest(values: RuntimePolicyDraftValues) {
  return {
    budgetPolicy: {
      enabled: values.budgetEnabled,
      enforcementMode: values.budgetEnabled ? values.budgetEnforcementMode : "disabled",
      warningThresholdPercent: values.budgetWarningThresholdPercent
    },
    cachePolicy: {
      enabled: values.cacheEnabled,
      ttlSeconds: values.cacheTtlSeconds
    },
    configVersion: values.configVersion,
    effectiveAt: new Date().toISOString(),
    rateLimit: {
      enabled: values.rateLimitEnabled,
      limit: values.rateLimitLimit
    },
    routingPolicy: {
      defaultModel: values.routingDefaultModel,
      defaultProvider: values.routingDefaultProvider,
      fallbackModel: values.routingFallbackModel,
      fallbackProvider: values.routingFallbackProvider,
      lowCostModel: values.routingLowCostModel,
      lowCostProvider: values.routingLowCostProvider,
      shortPromptMaxChars: values.routingShortPromptMaxChars
    },
    safetyPolicy: {
      detectors: values.detectors.map((detector) => ({
        action: detector.action,
        enabled: detector.enabled,
        placeholder: detector.placeholder,
        type: detector.type
      }))
    },
    models: values.models.map((model) => ({
      contextWindowTokens: model.contextWindowTokens,
      displayName: model.displayName.trim() || model.model,
      model: model.model.trim(),
      provider: model.provider.trim(),
      status: model.status,
      supportsJsonMode: model.supportsJsonMode,
      supportsStreaming: model.supportsStreaming
    })),
    pricingRules: values.pricingRules.map((rule) => ({
      completionTokenMicroUsd: rule.completionTokenMicroUsd,
      model: rule.model.trim(),
      pricingVersion: rule.pricingVersion.trim() || undefined,
      promptTokenMicroUsd: rule.promptTokenMicroUsd,
      provider: rule.provider.trim()
    }))
  };
}

async function readControlPlaneResponse(response: Response): Promise<ControlPlaneRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const runtimeConfig = getRuntimeConfigFromPayload(payload);

  if (!runtimeConfig) {
    return {
      error: "Control Plane response did not include runtime config.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: runtimeConfig,
    ok: true,
    status: response.status
  };
}

function getRuntimeConfigFromPayload(payload: unknown): RuntimePolicyConfig | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const runtimeConfig = record.runtimeConfig ?? record;

  if (!runtimeConfig || typeof runtimeConfig !== "object") {
    return null;
  }

  return runtimeConfig as RuntimePolicyConfig;
}

function getErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.message ?? record.error;

    if (typeof message === "string") {
      return message;
    }
  }

  return `Control Plane request failed with HTTP ${status}.`;
}
