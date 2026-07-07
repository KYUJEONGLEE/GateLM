import type {
  RuntimePolicyDraftValues,
  RuntimePolicyModelConfig
} from "./runtime-policy-types";

type RuntimePolicyRouteSelection = Pick<RuntimePolicyModelConfig, "model" | "provider">;

export function applyInitialRuntimePolicyModelSelection(
  draftValues: RuntimePolicyDraftValues,
  selectedModel: RuntimePolicyModelConfig,
  options: {
    warningThresholdPercent?: number;
  } = {}
): RuntimePolicyDraftValues {
  return applyPrimaryRuntimePolicyRouteSelection(
    {
      ...draftValues,
      budgetWarningThresholdPercent:
        options.warningThresholdPercent ?? draftValues.budgetWarningThresholdPercent
    },
    selectedModel
  );
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
