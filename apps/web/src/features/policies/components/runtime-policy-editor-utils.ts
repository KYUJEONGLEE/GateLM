import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import { getPreferredRuntimePolicyRouteModel } from "@/lib/control-plane/runtime-policy-model-selection";
import {
  getRuntimePolicyDraftValues,
  type RuntimePolicyConfig,
  type RuntimePolicyDetector,
  type RuntimePolicyDraftValues,
  type RuntimePolicyModelConfig
} from "@/lib/control-plane/runtime-policy-types";

import type { RoutingProviderOption } from "./runtime-policy-editor-types";

export function getWritableRuntimePolicyDraftValues(
  config: RuntimePolicyConfig,
  providerConnections: ProviderConnectionRecord[]
) {
  return normalizeDraftRoutingForProviderConnections(
    getRuntimePolicyDraftValues(config),
    providerConnections
  );
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

export function getSelectedRoutingProviderConnections(
  values: RuntimePolicyDraftValues,
  providerConnections: ProviderConnectionRecord[]
) {
  const providerConnectionsByProvider = new Map(
    providerConnections.map((providerConnection) => [
      normalizePolicyText(providerConnection.provider),
      providerConnection
    ])
  );

  return getSelectedRoutingProviderNames(values)
    .map((provider) => providerConnectionsByProvider.get(provider))
    .filter(
      (providerConnection): providerConnection is ProviderConnectionRecord =>
        Boolean(providerConnection && getProviderConnectionModels(providerConnection).length > 0)
    );
}

export function getSelectedRoutingProviderNames(values: RuntimePolicyDraftValues) {
  return Array.from(
    new Set(
      [
        values.routingDefaultProvider,
        values.routingHighQualityProvider,
        values.routingLowCostProvider,
        values.routingFallbackProvider
      ]
        .map((provider) => normalizePolicyText(provider))
        .filter(Boolean)
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

export function hasRoutingModelSelection(
  provider: string | null | undefined,
  model: string | null | undefined,
  modelOptionsByProvider: Map<string, RuntimePolicyModelConfig[]>
) {
  const trimmedProvider = normalizePolicyText(provider);
  const trimmedModel = normalizePolicyText(model);

  if (!trimmedProvider || !trimmedModel) {
    return false;
  }

  return Boolean(
    modelOptionsByProvider
      .get(trimmedProvider)
      ?.some(
        (option) =>
          normalizePolicyText(option.model) === trimmedModel && option.status === "active"
      )
  );
}

export function normalizeDraftRoutingForProviderConnections(
  values: RuntimePolicyDraftValues,
  providerConnections: ProviderConnectionRecord[]
): RuntimePolicyDraftValues {
  const modelOptionsByProvider = groupRoutingModelsByProvider(values.models, providerConnections);
  const runtimeModels = getProviderConnectionRuntimeModels(providerConnections);
  const firstActiveModel = runtimeModels.find((model) => model.status === "active") ?? runtimeModels[0];

  if (!firstActiveModel) {
    return values;
  }

  const defaultRouteAvailable = hasRoutingModelSelection(
    values.routingDefaultProvider,
    values.routingDefaultModel,
    modelOptionsByProvider
  );
  const lowCostRouteAvailable = hasRoutingModelSelection(
    values.routingLowCostProvider,
    values.routingLowCostModel,
    modelOptionsByProvider
  );
  const highQualityRouteAvailable = hasRoutingModelSelection(
    values.routingHighQualityProvider,
    values.routingHighQualityModel,
    modelOptionsByProvider
  );
  const fallbackRouteAvailable = hasRoutingModelSelection(
    values.routingFallbackProvider,
    values.routingFallbackModel,
    modelOptionsByProvider
  );

  if (
    defaultRouteAvailable &&
    lowCostRouteAvailable &&
    highQualityRouteAvailable &&
    fallbackRouteAvailable
  ) {
    return values;
  }

  const normalizeRouteSelection = (
    route: "default" | "fallback" | "highQuality" | "lowCost",
    provider: string,
    model: string,
    isAvailable: boolean
  ) => {
    if (isAvailable) {
      return { model, provider };
    }

    const providerWithModels = modelOptionsByProvider.has(provider) ? provider : firstActiveModel.provider;
    return (
      getPreferredRuntimePolicyRouteModel(runtimeModels, providerWithModels, route, firstActiveModel) ??
      firstActiveModel
    );
  };

  const defaultRoute = normalizeRouteSelection(
    "default",
    values.routingDefaultProvider,
    values.routingDefaultModel,
    defaultRouteAvailable
  );
  const fallbackRoute = normalizeRouteSelection(
    "fallback",
    values.routingFallbackProvider,
    values.routingFallbackModel,
    fallbackRouteAvailable
  );
  const highQualityRoute = normalizeRouteSelection(
    "highQuality",
    values.routingHighQualityProvider,
    values.routingHighQualityModel,
    highQualityRouteAvailable
  );
  const lowCostRoute = normalizeRouteSelection(
    "lowCost",
    values.routingLowCostProvider,
    values.routingLowCostModel,
    lowCostRouteAvailable
  );

  return {
    ...values,
    routingDefaultModel: defaultRoute.model,
    routingDefaultProvider: defaultRoute.provider,
    routingFallbackModel: fallbackRoute.model,
    routingFallbackProvider: fallbackRoute.provider,
    routingHighQualityModel: highQualityRoute.model,
    routingHighQualityProvider: highQualityRoute.provider,
    routingLowCostModel: lowCostRoute.model,
    routingLowCostProvider: lowCostRoute.provider
  };
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
