import type {
  RuntimePolicyDraftValues,
  RuntimePolicyModelConfig
} from "./runtime-policy-types";

type RuntimePolicyRouteSelection = Pick<RuntimePolicyModelConfig, "model" | "provider">;
type RuntimePolicyRouteKey = "default" | "fallback" | "highQuality" | "lowCost";

const onboardingRouteModelPreferences: Record<
  string,
  {
    default: string[];
    fallback: string[];
    highQuality: string[];
    lowCost: string[];
  }
> = {
  gemini: {
    default: ["gemini-3.5-flash"],
    fallback: ["gemini-3.5-flash"],
    highQuality: ["gemini-2.5-pro"],
    lowCost: ["gemini-3.5-flash"]
  },
  openai: {
    default: ["gpt-4o"],
    fallback: ["gpt-4o-mini"],
    highQuality: ["chat-latest"],
    lowCost: ["gpt-4o-mini"]
  }
};

export function applyInitialRuntimePolicyModelSelection(
  draftValues: RuntimePolicyDraftValues,
  selectedModel: RuntimePolicyModelConfig,
  options: {
    warningThresholdPercent?: number;
  } = {}
): RuntimePolicyDraftValues {
  const routeModels = getInitialRouteModelSelection(draftValues.models, selectedModel);

  return {
    ...draftValues,
    budgetWarningThresholdPercent:
      options.warningThresholdPercent ?? draftValues.budgetWarningThresholdPercent,
    routingDefaultModel: routeModels.default.model,
    routingDefaultProvider: routeModels.default.provider,
    routingFallbackModel: routeModels.fallback.model,
    routingFallbackProvider: routeModels.fallback.provider,
    routingHighQualityModel: routeModels.highQuality.model,
    routingHighQualityProvider: routeModels.highQuality.provider,
    routingLowCostModel: routeModels.lowCost.model,
    routingLowCostProvider: routeModels.lowCost.provider
  };
}

export function applyPrimaryRuntimePolicyRouteSelection(
  draftValues: RuntimePolicyDraftValues,
  selectedModel: RuntimePolicyRouteSelection
): RuntimePolicyDraftValues {
  const routeModels = getInitialRouteModelSelection(draftValues.models, selectedModel);

  return {
    ...draftValues,
    routingDefaultModel: routeModels.default.model,
    routingDefaultProvider: routeModels.default.provider,
    routingFallbackModel: routeModels.fallback.model,
    routingFallbackProvider: routeModels.fallback.provider,
    routingHighQualityModel: routeModels.highQuality.model,
    routingHighQualityProvider: routeModels.highQuality.provider,
    routingLowCostModel: routeModels.lowCost.model,
    routingLowCostProvider: routeModels.lowCost.provider
  };
}

export function getPreferredRuntimePolicyRouteModel(
  models: RuntimePolicyModelConfig[],
  provider: string,
  route: RuntimePolicyRouteKey,
  fallbackModel?: RuntimePolicyRouteSelection
): RuntimePolicyRouteSelection | null {
  const normalizedProvider = provider.trim();
  const activeProviderModels = models.filter(
    (model) => model.provider.trim() === normalizedProvider && model.status === "active"
  );
  const selectedModel = activeProviderModels[0] ?? fallbackModel;

  if (!selectedModel) {
    return null;
  }

  const family = getProviderFamilyForModel(selectedModel);
  const preferences = onboardingRouteModelPreferences[family]?.[route];

  if (!preferences) {
    return selectedModel;
  }

  return findPreferredModel(activeProviderModels, selectedModel, preferences);
}

function getInitialRouteModelSelection(
  models: RuntimePolicyModelConfig[],
  selectedModel: RuntimePolicyRouteSelection
) {
  return {
    default:
      getPreferredRuntimePolicyRouteModel(models, selectedModel.provider, "default", selectedModel) ??
      selectedModel,
    fallback:
      getPreferredRuntimePolicyRouteModel(models, selectedModel.provider, "fallback", selectedModel) ??
      selectedModel,
    highQuality:
      getPreferredRuntimePolicyRouteModel(
        models,
        selectedModel.provider,
        "highQuality",
        selectedModel
      ) ?? selectedModel,
    lowCost:
      getPreferredRuntimePolicyRouteModel(models, selectedModel.provider, "lowCost", selectedModel) ??
      selectedModel
  };
}

function findPreferredModel(
  models: RuntimePolicyModelConfig[],
  selectedModel: RuntimePolicyRouteSelection,
  preferredModelNames: string[]
) {
  const selectedProvider = selectedModel.provider.trim();
  const preferredModelNameSet = new Set(
    preferredModelNames.map((modelName) => normalizeModelName(modelName))
  );

  return (
    models.find(
      (model) =>
        model.provider.trim() === selectedProvider &&
        preferredModelNameSet.has(normalizeModelName(model.model))
    ) ?? selectedModel
  );
}

function getProviderFamilyForModel(model: RuntimePolicyRouteSelection) {
  const provider = model.provider.toLowerCase();
  const modelName = model.model.toLowerCase();

  if (provider.includes("gemini") || modelName.startsWith("gemini-")) {
    return "gemini";
  }

  if (
    provider.includes("openai") ||
    modelName.startsWith("gpt-") ||
    modelName.startsWith("chat")
  ) {
    return "openai";
  }

  return provider;
}

function normalizeModelName(modelName: string) {
  return modelName.trim().toLowerCase();
}
