import type {
  RuntimePolicyDraftValues,
  RuntimePolicyModelConfig
} from "./runtime-policy-types";

export function applyInitialRuntimePolicyModelSelection(
  draftValues: RuntimePolicyDraftValues,
  selectedModel: RuntimePolicyModelConfig,
  options: {
    warningThresholdPercent?: number;
  } = {}
): RuntimePolicyDraftValues {
  return {
    ...draftValues,
    budgetWarningThresholdPercent:
      options.warningThresholdPercent ?? draftValues.budgetWarningThresholdPercent,
    routingDefaultModel: selectedModel.model,
    routingDefaultProvider: selectedModel.provider,
    routingFallbackModel: selectedModel.model,
    routingFallbackProvider: selectedModel.provider,
    routingLowCostModel: selectedModel.model,
    routingLowCostProvider: selectedModel.provider
  };
}
