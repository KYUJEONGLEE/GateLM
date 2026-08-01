import {
  getProviderFamilyFromKey,
  resolveProviderDisplay,
  type ProviderDisplayDirectory
} from "@/lib/control-plane/provider-display";

export function resolveAnalyticsModelProviderFamily(
  rowId: string,
  modelLabel: string,
  providerDirectory: ProviderDisplayDirectory
) {
  const identity = parseAnalyticsModelRowId(rowId);
  const configuredProvider = resolveProviderDisplay(
    providerDirectory,
    identity.provider
  );

  if (configuredProvider) {
    return configuredProvider.family;
  }

  return getProviderFamilyFromKey(
    identity.model || identity.provider || modelLabel
  );
}

function parseAnalyticsModelRowId(rowId: string) {
  try {
    const value = JSON.parse(rowId) as unknown;

    if (Array.isArray(value)) {
      return {
        model: typeof value[1] === "string" ? value[1] : "",
        provider: typeof value[0] === "string" ? value[0] : ""
      };
    }
  } catch {
    // Legacy rows can use a plain model identifier instead of the provider/model tuple.
  }

  return {
    model: rowId,
    provider: ""
  };
}
