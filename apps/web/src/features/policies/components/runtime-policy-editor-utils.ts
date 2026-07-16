import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import {
  getRuntimePolicyDraftValues,
  runtimeRoutingCategories,
  runtimeRoutingDifficulties,
  type RuntimePolicyConfig,
  type RuntimePolicyDetector,
  type RuntimePolicyDraftValues,
  type RuntimePolicyModelConfig,
  type RuntimePolicyRoutingDraft,
  type RuntimePolicyRoutingRoutes
} from "@/lib/control-plane/runtime-policy-types";

import type { RoutingProviderOption } from "./runtime-policy-editor-types";

export type RoutingModelOption = {
  family: string;
  label: string;
  modelName: string;
  modelRef: string;
  providerConnectionId: string;
  providerDisplayName: string;
  providerName: string;
};

export type RoutingProviderModelOption = {
  displayName: string;
  family: string;
  models: RoutingModelOption[];
  providerConnectionId: string;
};

export function areRuntimePolicyDraftValuesEqual(
  left: RuntimePolicyDraftValues,
  right: RuntimePolicyDraftValues
) {
  return deepEqualPolicyValue(left, right);
}

export function getWritableRuntimePolicyDraftValues(
  config: RuntimePolicyConfig
) {
  return getRuntimePolicyDraftValues(config);
}

export function groupRoutingModelsByProvider(
  _models: RuntimePolicyModelConfig[],
  providerConnections: ProviderConnectionRecord[]
) {
  return groupModelsByProvider(getProviderConnectionRuntimeModels(providerConnections));
}

export function getRoutingProviderOptions(
  providerConnections: ProviderConnectionRecord[],
  _models: RuntimePolicyModelConfig[],
  selectedProviders: Array<string | null | undefined>
): RoutingProviderOption[] {
  const providerOptions = new Map<string, RoutingProviderOption>();

  for (const providerConnection of providerConnections) {
    const providerName = normalizePolicyText(providerConnection.provider);
    const displayName = normalizePolicyText(providerConnection.displayName) || providerName;

    if (providerName && getProviderConnectionModels(providerConnection).length > 0) {
      providerOptions.set(providerName, {
        displayName,
        family: getProviderConnectionFamily(providerConnection),
        provider: providerName,
        providerId: providerConnection.id
      });
    }
  }

  for (const provider of selectedProviders) {
    const providerName = normalizePolicyText(provider);
    const providerConnection = providerConnections.find(
      (connection) => normalizePolicyText(connection.provider) === providerName
    );

    if (providerName && !providerOptions.has(providerName) && providerConnection) {
      providerOptions.set(providerName, {
        displayName: normalizePolicyText(providerConnection.displayName) || providerName,
        family: getProviderConnectionFamily(providerConnection),
        provider: providerName,
        providerId: `selected-provider-${providerName}`
      });
    }
  }

  return Array.from(providerOptions.values());
}

export function getRoutingModelOptions(
  providerConnections: ProviderConnectionRecord[]
): RoutingModelOption[] {
  const options = new Map<string, RoutingModelOption>();

  for (const providerConnection of providerConnections) {
    if (
      providerConnection.projectId !== null ||
      providerConnection.status !== "ACTIVE"
    ) {
      continue;
    }

    const providerName = normalizePolicyText(providerConnection.provider);
    const displayName =
      normalizePolicyText(providerConnection.displayName) || providerName;

    if (!providerName) {
      continue;
    }

    for (const modelId of getProviderConnectionModels(providerConnection)) {
      const modelRef =
        providerName === "mock" && modelId === "mock-balanced"
          ? "mock-balanced"
          : getRoutingModelRef(providerConnection, modelId);

      options.set(modelRef, {
        family: getProviderConnectionFamily(providerConnection),
        label: `${displayName} / ${modelId}`,
        modelName: modelId,
        modelRef,
        providerConnectionId: providerConnection.id,
        providerDisplayName: displayName,
        providerName
      });
    }
  }

  return Array.from(options.values());
}

export function groupRoutingModelOptionsByProvider(
  modelOptions: RoutingModelOption[]
): RoutingProviderModelOption[] {
  const providers = new Map<string, RoutingProviderModelOption>();

  for (const modelOption of modelOptions) {
    const provider = providers.get(modelOption.providerConnectionId);

    if (provider) {
      provider.models.push(modelOption);
      continue;
    }

    providers.set(modelOption.providerConnectionId, {
      displayName: modelOption.providerDisplayName,
      family: modelOption.family,
      models: [modelOption],
      providerConnectionId: modelOption.providerConnectionId
    });
  }

  return Array.from(providers.values());
}

export function getSelectedRoutingProviderConnections(
  values: RuntimePolicyDraftValues,
  providerConnections: ProviderConnectionRecord[]
) {
  const selectedProviderIds = new Set(
    getRoutingModelRefs(values.routingPolicy.routes)
      .map((modelRef) => findProviderConnectionForModelRef(modelRef, providerConnections)?.id)
      .filter((providerId): providerId is string => Boolean(providerId))
  );

  return providerConnections.filter((connection) => selectedProviderIds.has(connection.id));
}

export function getSelectedRoutingProviderNames(
  values: RuntimePolicyDraftValues,
  providerConnections: ProviderConnectionRecord[] = []
) {
  return Array.from(
    new Set(
      getSelectedRoutingProviderConnections(values, providerConnections).map(
        (connection) => connection.provider
      )
    )
  );
}

export function mergeDraftValuesWithProviderConnections(
  values: RuntimePolicyDraftValues,
  providerConnections: ProviderConnectionRecord[]
): RuntimePolicyDraftValues {
  const providerModels = getProviderConnectionRuntimeModels(providerConnections);
  const models = mergeRuntimePolicyModels([], providerModels);
  const providerModelKeys = new Set(
    providerModels.map((model) => runtimePolicyModelKey(model.provider, model.model))
  );

  return {
    ...values,
    models,
    pricingRules: mergeRuntimePolicyPricingRules(
      values.pricingRules.filter((pricingRule) =>
        providerModelKeys.has(runtimePolicyModelKey(pricingRule.provider, pricingRule.model))
      ),
      providerModels
    )
  };
}

export function getRoutingModelRef(
  providerConnection: Pick<ProviderConnectionRecord, "id">,
  modelId: string
) {
  return `${providerConnection.id}:${modelId.trim()}`;
}

export function createMockBootstrapRoutingPolicy(): RuntimePolicyRoutingDraft {
  return {
    bootstrapState: "mock_bootstrap",
    mode: "auto",
    routes: Object.fromEntries(
      runtimeRoutingCategories.map((category) => [
        category,
        Object.fromEntries(
          runtimeRoutingDifficulties.map((difficulty) => [
            difficulty,
            { modelRefs: ["mock-balanced"] }
          ])
        )
      ])
    ) as RuntimePolicyRoutingRoutes
  };
}

export function hasCompleteRoutingMatrix(routes: RuntimePolicyRoutingRoutes) {
  return runtimeRoutingCategories.every((category) =>
    runtimeRoutingDifficulties.every((difficulty) => {
      const modelRefs = routes[category]?.[difficulty]?.modelRefs;
      return (
        Array.isArray(modelRefs) &&
        modelRefs.length > 0 &&
        modelRefs.every((modelRef) => typeof modelRef === "string" && modelRef.trim())
      );
    })
  );
}

export function hasResolvableRoutingMatrix(
  policy: RuntimePolicyRoutingDraft,
  providerConnections: ProviderConnectionRecord[]
) {
  if (!hasCompleteRoutingMatrix(policy.routes)) {
    return false;
  }

  return getRoutingModelRefs(policy.routes).every(
    (modelRef) =>
      modelRef === "mock-balanced" ||
      Boolean(findProviderConnectionForModelRef(modelRef, providerConnections))
  );
}

export function getRoutingModelRefs(routes: RuntimePolicyRoutingRoutes) {
  return Array.from(
    new Set(
      runtimeRoutingCategories.flatMap((category) =>
        runtimeRoutingDifficulties.flatMap(
          (difficulty) => routes[category][difficulty].modelRefs
        )
      )
    )
  );
}

export function findProviderConnectionForModelRef(
  modelRef: string,
  providerConnections: ProviderConnectionRecord[]
) {
  return providerConnections.find((connection) =>
    getProviderConnectionModels(connection).some(
      (modelId) => getRoutingModelRef(connection, modelId) === modelRef
    )
  );
}

export function parseBoundedInteger(value: string, min: number, max: number) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return min;
  }

  return Math.min(Math.max(parsed, min), max);
}

export function isMandatorySafetyDetector(detectorType: RuntimePolicyDetector["type"]) {
  return (
    detectorType === "resident_registration_number" ||
    detectorType === "api_key" ||
    detectorType === "authorization_header" ||
    detectorType === "jwt" ||
    detectorType === "private_key"
  );
}

function groupModelsByProvider(models: RuntimePolicyModelConfig[]) {
  const groups = new Map<string, RuntimePolicyModelConfig[]>();

  for (const model of models) {
    const modelsForProvider = groups.get(model.provider) ?? [];
    modelsForProvider.push(model);
    groups.set(model.provider, modelsForProvider);
  }

  return groups;
}

function getProviderConnectionRuntimeModels(providerConnections: ProviderConnectionRecord[]) {
  return providerConnections.flatMap((providerConnection) =>
    getProviderConnectionModels(providerConnection).map((modelName) =>
      toRuntimePolicyModelConfig(providerConnection, modelName)
    )
  );
}

function toRuntimePolicyModelConfig(
  providerConnection: ProviderConnectionRecord,
  modelName: string
): RuntimePolicyModelConfig {
  return {
    contextWindowTokens: 128000,
    displayName: modelName,
    model: modelName,
    provider: providerConnection.provider,
    status: providerConnection.status === "ACTIVE" ? "active" : "disabled",
    supportsJsonMode: true,
    supportsStreaming: true
  };
}

function mergeRuntimePolicyModels(
  models: RuntimePolicyModelConfig[],
  nextModels: RuntimePolicyModelConfig[]
) {
  const merged = new Map<string, RuntimePolicyModelConfig>();

  for (const model of [...models, ...nextModels]) {
    const provider = normalizePolicyText(model.provider);
    const modelName = normalizePolicyText(model.model);

    if (provider && modelName) {
      merged.set(`${provider}::${modelName}`, {
        ...model,
        displayName: normalizePolicyText(model.displayName) || modelName,
        model: modelName,
        provider
      });
    }
  }

  return Array.from(merged.values());
}

function runtimePolicyModelKey(provider: unknown, model: unknown) {
  return `${normalizePolicyText(provider)}::${normalizePolicyText(model)}`;
}

function mergeRuntimePolicyPricingRules(
  pricingRules: RuntimePolicyDraftValues["pricingRules"],
  models: RuntimePolicyModelConfig[]
) {
  const merged = new Map<string, RuntimePolicyDraftValues["pricingRules"][number]>();

  for (const pricingRule of pricingRules) {
    const provider = normalizePolicyText(pricingRule.provider);
    const model = normalizePolicyText(pricingRule.model);

    if (provider && model) {
      merged.set(`${provider}::${model}`, {
        ...pricingRule,
        model,
        provider
      });
    }
  }

  for (const model of models) {
    const provider = normalizePolicyText(model.provider);
    const modelName = normalizePolicyText(model.model);
    const key = `${provider}::${modelName}`;

    if (provider && modelName && !merged.has(key)) {
      merged.set(key, {
        completionTokenMicroUsd: 10,
        model: modelName,
        pricingVersion: "default",
        promptTokenMicroUsd: 10,
        provider
      });
    }
  }

  return Array.from(merged.values());
}

function getProviderConnectionModels(providerConnection: ProviderConnectionRecord) {
  const models = providerConnection.providerConfig?.models;

  if (!Array.isArray(models)) {
    return [];
  }

  return Array.from(
    new Set(
      models
        .map((model) => (typeof model === "string" ? model.trim() : ""))
        .filter(Boolean)
    )
  );
}

function getProviderConnectionFamily(provider: ProviderConnectionRecord) {
  const configuredFamily = getProviderConfigString(
    provider.providerConfig,
    "providerFamily",
    ""
  );

  if (configuredFamily) {
    return configuredFamily;
  }

  return getProviderFamilyFromKey(provider.provider, provider.baseUrl);
}

function getProviderFamilyFromKey(providerKey: string, baseUrl = "") {
  const normalizedProvider = providerKey.toLowerCase();
  const normalizedBaseUrl = baseUrl.toLowerCase();

  if (
    normalizedProvider.includes("gemini") ||
    normalizedBaseUrl.includes("generativelanguage.googleapis.com")
  ) {
    return "gemini";
  }

  if (
    normalizedProvider.includes("claude") ||
    normalizedProvider.includes("anthropic") ||
    normalizedBaseUrl.includes("anthropic.com")
  ) {
    return "claude";
  }

  if (normalizedProvider === "mock") {
    return "mock";
  }

  if (normalizedProvider === "new-provider") {
    return "new-provider";
  }

  return "openai";
}

function getProviderConfigString(
  providerConfig: Record<string, unknown> | null,
  key: string,
  fallback: string
) {
  const value = providerConfig?.[key];

  return typeof value === "string" ? value : fallback;
}

function normalizePolicyText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function deepEqualPolicyValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => deepEqualPolicyValue(value, right[index]))
    );
  }

  if (!isPolicyRecord(left) || !isPolicyRecord(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);

  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        deepEqualPolicyValue(left[key], right[key])
    )
  );
}

function isPolicyRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
