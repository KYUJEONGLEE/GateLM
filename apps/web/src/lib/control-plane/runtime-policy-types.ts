import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";

export type RuntimePolicyDetector = {
  action: "redact" | "block";
  enabled: boolean;
  placeholder: string;
  type:
    | "email"
    | "phone_number"
    | "resident_registration_number"
    | "api_key"
    | "authorization_header"
    | "jwt"
    | "private_key"
    | "organization_name";
};

export type RuntimePolicyProvider = {
  baseUrl: string;
  credentialPreview: {
    last4: string | null;
    prefix: string | null;
  } | null;
  displayName: string;
  failureMode: "fail_closed" | "fail_open_to_fallback";
  models: string[];
  provider: string;
  providerId: string;
  resolver: "none" | "control_plane_secret_store" | "environment";
  secretRef: string | null;
  status: "active" | "disabled" | "degraded";
  timeoutMs: number;
};

export type RuntimePolicyModelConfig = {
  contextWindowTokens: number;
  displayName: string;
  model: string;
  provider: string;
  status: "active" | "disabled";
  supportsJsonMode: boolean;
  supportsStreaming: boolean;
};

export type RuntimePolicyPricingRule = {
  completionTokenMicroUsd: number;
  currency?: "USD";
  effectiveAt?: string;
  model: string;
  pricingRuleId?: string;
  pricingVersion: string;
  promptTokenMicroUsd: number;
  provider: string;
  unit?: "token";
};

export type RuntimePolicyBudgetPolicy = {
  enabled: boolean;
  enforcementMode: "warn" | "block" | "disabled";
  warningThresholdPercent: number;
};

export type RuntimePolicyPromptCapturePolicy = {
  enabled: boolean;
  maxChars: number;
  mode: "disabled" | "log_safe_full";
};

export type RuntimePolicyConfig = {
  applicationId: string;
  budgetPolicy?: RuntimePolicyBudgetPolicy;
  cachePolicy: {
    enabled: boolean;
    ttlSeconds: number;
    type: "exact";
  };
  configHash: string;
  configVersion: string;
  effectiveAt: string;
  generatedAt: string;
  models: RuntimePolicyModelConfig[];
  pricingRules: RuntimePolicyPricingRule[];
  promptCapturePolicy?: RuntimePolicyPromptCapturePolicy;
  providers: RuntimePolicyProvider[];
  publishState: string;
  publishedAt: string;
  rateLimit: {
    algorithm: "fixed_window";
    enabled: boolean;
    limit: number;
    scope: "application";
    windowSeconds: 60;
  };
  routingPolicy: {
    defaultModel: string;
    defaultProvider: string;
    fallbackModel: string;
    fallbackProvider: string;
    lowCostModel: string;
    lowCostProvider: string;
    routingPolicyHash: string;
    shortPromptMaxChars: number;
  };
  safetyPolicy: {
    detectors: RuntimePolicyDetector[];
    mode: "rule_based";
    securityPolicyHash: string;
  };
  tenantId: string;
};

export type RuntimePolicyHistoryItem = {
  canRollback: boolean;
  configHash: string;
  configVersion: string;
  createdAt: string;
  effectiveAt: string | null;
  id: string;
  publishedAt: string | null;
  publishState: string;
  updatedAt: string;
};

export type RuntimePolicyHistoryDetailSummary = {
  configHash: string;
  configVersion: string;
  detectorCount: number;
  modelCount: number;
  providerCount: number;
  publishState: string;
};

export type RuntimePolicySnapshot = {
  budgetResolution: {
    budgetScopeId: string;
    budgetScopeType: "application" | "project" | "team";
    resolvedBy: string;
    warningThresholdPercent: number;
  };
  contentHash: string;
  gatewayInstanceId: string;
  lookupKey: {
    applicationId: string;
    projectId: string;
    tenantId: string;
  };
  policies: {
    budget: {
      enabled: boolean;
      enforcementMode: string;
      warningThresholdPercent: number;
    };
    cache: {
      cachePolicyHash: string;
      exactCacheEnabled: boolean;
      semanticCacheMode: string;
    };
    promptCapture?: RuntimePolicyPromptCapturePolicy;
    fallback: {
      allowedReasons?: string[];
      enabled: boolean;
      fallbackModel?: string;
      fallbackProvider?: string;
    };
    rateLimit: {
      enabled: boolean;
      limit: number;
      scope: string;
      windowSeconds: number;
    };
    routing: {
      autoModelEnabled: boolean;
      defaultModel: string;
      defaultProvider: string;
      defaultRequestedModel: string;
      routingPolicyHash: string;
    };
    safety: {
      detectorSet?: Array<{
        action: string;
        detectorType: string;
      }>;
      enabled: boolean;
      mode: string;
      policyHash: string;
      requestSideRequired: boolean;
    };
    streaming: {
      enabled: boolean;
      thinSliceOnly: true;
    };
  };
  providerCatalogRef: {
    catalogId: string;
    catalogVersion: number;
    contentHash: string;
  };
  publishedAt: string;
  publishedBy: string;
  runtimeSnapshotId: string;
  runtimeSnapshotVersion: number;
  runtimeState: string;
};

export type RuntimePolicyProviderCatalogSummary = {
  catalogId: string;
  catalogVersion: number;
  contentHash: string;
  modelCount: number;
  providerCount: number;
  updatedAt: string | null;
};

export type RuntimePolicyDraftValues = {
  budgetEnabled: boolean;
  budgetEnforcementMode: "warn" | "block" | "disabled";
  budgetWarningThresholdPercent: number;
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  configVersion: string;
  detectors: RuntimePolicyDetector[];
  models: RuntimePolicyModelConfig[];
  pricingRules: RuntimePolicyPricingRule[];
  promptCaptureEnabled: boolean;
  promptCaptureMaxChars: number;
  rateLimitEnabled: boolean;
  rateLimitLimit: number;
  routingDefaultModel: string;
  routingDefaultProvider: string;
  routingFallbackModel: string;
  routingFallbackProvider: string;
  routingLowCostModel: string;
  routingLowCostProvider: string;
  routingShortPromptMaxChars: number;
};

export type RuntimePolicyModel = {
  activeConfig: RuntimePolicyConfig;
  applicationId: string;
  controlPlaneBaseUrl: string;
  history: {
    detail: RuntimePolicyHistoryDetailSummary | null;
    detailLoadError: string | null;
    items: RuntimePolicyHistoryItem[];
    loadError: string | null;
  };
  loadError: string | null;
  providerCatalog: {
    canonicalLoadError: string | null;
    canonicalVerified: boolean | null;
    loadError: string | null;
    summary: RuntimePolicyProviderCatalogSummary | null;
  };
  providerConnections: {
    available: ProviderConnectionRecord[];
    loadError: string | null;
    selectedIds: string[];
  };
  routeTenantId: string;
  runtimeSnapshot: {
    loadError: string | null;
    snapshot: RuntimePolicySnapshot | null;
  };
  source: "control-plane" | "fixture" | "template";
};

export function getRuntimePolicyDraftValues(
  config: RuntimePolicyConfig
): RuntimePolicyDraftValues {
  const budgetPolicy = config.budgetPolicy ?? getDefaultRuntimePolicyBudgetPolicy();
  const promptCapturePolicy =
    config.promptCapturePolicy ?? getDefaultRuntimePolicyPromptCapturePolicy();

  return {
    budgetEnabled: budgetPolicy.enabled,
    budgetEnforcementMode: budgetPolicy.enforcementMode,
    budgetWarningThresholdPercent: budgetPolicy.warningThresholdPercent,
    cacheEnabled: config.cachePolicy.enabled,
    cacheTtlSeconds: config.cachePolicy.ttlSeconds,
    configVersion: config.configVersion,
    detectors: config.safetyPolicy.detectors.map((detector) => ({ ...detector })),
    models: config.models.map((model) => ({ ...model })),
    pricingRules: config.pricingRules.map((rule) => ({
      completionTokenMicroUsd: rule.completionTokenMicroUsd,
      model: rule.model,
      pricingVersion: rule.pricingVersion,
      promptTokenMicroUsd: rule.promptTokenMicroUsd,
      provider: rule.provider
    })),
    promptCaptureEnabled: promptCapturePolicy.enabled,
    promptCaptureMaxChars: promptCapturePolicy.maxChars,
    rateLimitEnabled: config.rateLimit.enabled,
    rateLimitLimit: config.rateLimit.limit,
    routingDefaultModel: config.routingPolicy.defaultModel,
    routingDefaultProvider: config.routingPolicy.defaultProvider,
    routingFallbackModel: config.routingPolicy.fallbackModel,
    routingFallbackProvider: config.routingPolicy.fallbackProvider,
    routingLowCostModel: config.routingPolicy.lowCostModel,
    routingLowCostProvider: config.routingPolicy.lowCostProvider,
    routingShortPromptMaxChars: config.routingPolicy.shortPromptMaxChars
  };
}

export function getDefaultRuntimePolicyBudgetPolicy(): RuntimePolicyBudgetPolicy {
  return {
    enabled: false,
    enforcementMode: "disabled",
    warningThresholdPercent: 80
  };
}

export function getDefaultRuntimePolicyPromptCapturePolicy(): RuntimePolicyPromptCapturePolicy {
  return {
    enabled: false,
    maxChars: 8000,
    mode: "disabled"
  };
}
