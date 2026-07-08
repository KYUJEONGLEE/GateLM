import type {
  RuntimePolicyDraftValues,
  RuntimePolicyModelConfig
} from "./runtime-policy-types";

type RuntimePolicyRouteSelection = Pick<RuntimePolicyModelConfig, "model" | "provider">;

const onboardingRouteModelPreferences: Record<
  string,
  {
    default: string[];
    fallback: string[];
    high: string[];
  }
> = {
  gemini: {
    default: ["gemini-3.5-flash"],
    fallback: ["gemini-3.5-flash"],
    high: ["gemini-2.5-pro"]
  },
  openai: {
    default: ["gpt-4o"],
    fallback: ["gpt-4o-mini"],
    high: ["chat-latest"]
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
    routingLowCostModel: routeModels.high.model,
    routingLowCostProvider: routeModels.high.provider
  };
}

export function applyPrimaryRuntimePolicyRouteSelection(
  draftValues: RuntimePolicyDraftValues,
  selectedModel: RuntimePolicyRouteSelection
): RuntimePolicyDraftValues {
  return {
    ...draftValues,
    routingDefaultModel: selectedModel.model,
    routingDefaultProvider: selectedModel.provider,
    routingFallbackModel: selectedModel.model,
    routingFallbackProvider: selectedModel.provider,
    routingLowCostModel: selectedModel.model,
    routingLowCostProvider: selectedModel.provider
  };
}

function getInitialRouteModelSelection(
  models: RuntimePolicyModelConfig[],
  selectedModel: RuntimePolicyModelConfig
) {
  const family = getProviderFamilyForModel(selectedModel);
  const preferences = onboardingRouteModelPreferences[family];

  if (!preferences) {
    return {
      default: selectedModel,
      fallback: selectedModel,
      high: selectedModel
    };
  }

  return {
    default: findPreferredModel(models, selectedModel, preferences.default),
    fallback: findPreferredModel(models, selectedModel, preferences.fallback),
    high: findPreferredModel(models, selectedModel, preferences.high)
  };
}

function findPreferredModel(
  models: RuntimePolicyModelConfig[],
  selectedModel: RuntimePolicyModelConfig,
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

function getProviderFamilyForModel(model: RuntimePolicyModelConfig) {
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
