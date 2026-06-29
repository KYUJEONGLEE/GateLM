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
    | "private_key";
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
  status: string;
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

export type RuntimePolicyConfig = {
  applicationId: string;
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

export type RuntimePolicyDraftValues = {
  cacheEnabled: boolean;
  cacheTtlSeconds: number;
  configVersion: string;
  detectors: RuntimePolicyDetector[];
  models: RuntimePolicyModelConfig[];
  pricingRules: RuntimePolicyPricingRule[];
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
  loadError: string | null;
  routeTenantId: string;
  source: "control-plane" | "fixture";
};

export function getRuntimePolicyDraftValues(
  config: RuntimePolicyConfig
): RuntimePolicyDraftValues {
  return {
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
