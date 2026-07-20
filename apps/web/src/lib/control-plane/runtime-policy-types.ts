import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";

export type RuntimePolicyDetector = {
  action: "redact" | "block";
  enabled: boolean;
  placeholder: string;
  type:
    | "email"
    | "phone_number"
    | "person_name"
    | "postal_address"
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

export const runtimeRoutingCategories = [
  "general",
  "code",
  "translation",
  "summarization",
  "reasoning"
] as const;

export const runtimeRoutingDifficulties = ["simple", "complex"] as const;

export function isRuntimeRoutingPolicyHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value);
}

export type RuntimeRoutingCategory = (typeof runtimeRoutingCategories)[number];
export type RuntimeRoutingDifficulty = (typeof runtimeRoutingDifficulties)[number];

export type RuntimePolicyRouteCell = {
  modelRefs: string[];
};

export type RuntimePolicyRoutingRoutes = Record<
  RuntimeRoutingCategory,
  Record<RuntimeRoutingDifficulty, RuntimePolicyRouteCell>
>;

export type RuntimePolicyModelRoles = {
  complexModelRef: string;
  fallbackModelRef: string | null;
  simpleModelRef: string;
};

export type RuntimePolicyRoutingDraft = {
  bootstrapState: "mock_bootstrap" | "configured";
  mode: "auto" | "manual";
  routes: RuntimePolicyRoutingRoutes;
};

export type RuntimePolicyRoutingPolicy = RuntimePolicyRoutingDraft & {
  schemaVersion: "gatelm.routing-policy.v2";
  routingPolicyHash: string;
};

export type RuntimePolicySnapshotRoutingPolicy = RuntimePolicyRoutingDraft & {
  routingPolicyHash: string;
};

export type RuntimePolicyPromptCapturePolicy = {
  enabled: boolean;
  maxChars: number;
  mode: "disabled" | "log_safe_full";
};

export type RuntimePolicyResponseCapturePolicy = {
  enabled: boolean;
  maxChars: number;
  mode: "disabled" | "raw_full";
};

export type RuntimePolicyConfig = {
  schemaVersion: "gatelm.active-runtime-config.v2";
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
  responseCapturePolicy?: RuntimePolicyResponseCapturePolicy;
  providers: RuntimePolicyProvider[];
  publishState: string;
  publishedAt: string;
  rateLimit: {
    algorithm: "fixed_window" | "token_bucket";
    enabled: boolean;
    limit: number;
    scope: "application";
    windowSeconds: number;
  };
  routingPolicy: RuntimePolicyRoutingPolicy;
  safetyPolicy?: {
    detectors?: RuntimePolicyDetector[];
    mode?: "rule_based";
    securityPolicyHash?: string;
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
  schemaVersion: "gatelm.runtime-snapshot.v2";
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
    responseCapture?: RuntimePolicyResponseCapturePolicy;
    rateLimit: {
      enabled: boolean;
      limit: number;
      scope: string;
      windowSeconds: number;
    };
    routing: RuntimePolicySnapshotRoutingPolicy;
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
  responseCaptureEnabled: boolean;
  responseCaptureMaxChars: number;
  rateLimitEnabled: boolean;
  rateLimitLimit: number;
  rateLimitRefillTokensPerSecond: number;
  rateLimitWindowSeconds: number;
  routingPolicy: RuntimePolicyRoutingDraft;
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

const defaultRuntimePolicyDetectors: RuntimePolicyDetector[] = [
  {
    type: "email",
    enabled: true,
    action: "redact",
    placeholder: "[EMAIL_REDACTED]"
  },
  {
    type: "phone_number",
    enabled: true,
    action: "redact",
    placeholder: "[PHONE_NUMBER_REDACTED]"
  },
  {
    type: "person_name",
    enabled: true,
    action: "redact",
    placeholder: "[PERSON_NAME_REDACTED]"
  },
  {
    type: "postal_address",
    enabled: true,
    action: "redact",
    placeholder: "[POSTAL_ADDRESS_REDACTED]"
  },
  {
    type: "organization_name",
    enabled: true,
    action: "redact",
    placeholder: "[ORGANIZATION_NAME_REDACTED]"
  },
  {
    type: "resident_registration_number",
    enabled: true,
    action: "block",
    placeholder: "[RESIDENT_REGISTRATION_NUMBER_REDACTED]"
  },
  {
    type: "api_key",
    enabled: true,
    action: "block",
    placeholder: "[API_KEY_REDACTED]"
  },
  {
    type: "authorization_header",
    enabled: true,
    action: "block",
    placeholder: "[AUTHORIZATION_HEADER_REDACTED]"
  },
  {
    type: "jwt",
    enabled: true,
    action: "block",
    placeholder: "[JWT_REDACTED]"
  },
  {
    type: "private_key",
    enabled: true,
    action: "block",
    placeholder: "[SECRET_REDACTED]"
  }
];

export function getRuntimePolicyDraftValues(
  config: RuntimePolicyConfig
): RuntimePolicyDraftValues {
  const budgetPolicy = config.budgetPolicy ?? getDefaultRuntimePolicyBudgetPolicy();
  const promptCapturePolicy =
    config.promptCapturePolicy ?? getDefaultRuntimePolicyPromptCapturePolicy();
  const responseCapturePolicy =
    config.responseCapturePolicy ?? getDefaultRuntimePolicyResponseCapturePolicy();

  return {
    budgetEnabled: budgetPolicy.enabled,
    budgetEnforcementMode: budgetPolicy.enforcementMode,
    budgetWarningThresholdPercent: budgetPolicy.warningThresholdPercent,
    cacheEnabled: config.cachePolicy.enabled,
    cacheTtlSeconds: config.cachePolicy.ttlSeconds,
    configVersion: config.configVersion,
    detectors: mergeRuntimePolicyDetectors(config.safetyPolicy?.detectors),
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
    responseCaptureEnabled: responseCapturePolicy.enabled,
    responseCaptureMaxChars: responseCapturePolicy.maxChars,
    rateLimitEnabled: config.rateLimit.enabled,
    rateLimitLimit: config.rateLimit.limit,
    rateLimitRefillTokensPerSecond: getRateLimitRefillTokensPerSecond(
      config.rateLimit.limit,
      config.rateLimit.windowSeconds
    ),
    rateLimitWindowSeconds: config.rateLimit.windowSeconds,
    routingPolicy: {
      bootstrapState: config.routingPolicy.bootstrapState,
      mode: config.routingPolicy.mode,
      routes: cloneRuntimePolicyRoutingRoutes(config.routingPolicy.routes)
    }
  };
}

export function cloneRuntimePolicyRoutingRoutes(
  routes: RuntimePolicyRoutingRoutes
): RuntimePolicyRoutingRoutes {
  return Object.fromEntries(
    runtimeRoutingCategories.map((category) => [
      category,
      Object.fromEntries(
        runtimeRoutingDifficulties.map((difficulty) => [
          difficulty,
          { modelRefs: [...routes[category][difficulty].modelRefs] }
        ])
      )
    ])
  ) as RuntimePolicyRoutingRoutes;
}

export function createRuntimePolicyRoleRoutes(
  roles: RuntimePolicyModelRoles
): RuntimePolicyRoutingRoutes {
  const fallbackModelRef = normalizeRuntimePolicyModelRef(roles.fallbackModelRef);
  const simpleModelRef = normalizeRuntimePolicyModelRef(roles.simpleModelRef);
  const complexModelRef = normalizeRuntimePolicyModelRef(roles.complexModelRef);
  const usableFallback =
    fallbackModelRef &&
    fallbackModelRef !== simpleModelRef &&
    fallbackModelRef !== complexModelRef
      ? fallbackModelRef
      : null;

  return Object.fromEntries(
    runtimeRoutingCategories.map((category) => [
      category,
      {
        simple: {
          modelRefs: usableFallback
            ? [simpleModelRef, usableFallback]
            : [simpleModelRef]
        },
        complex: {
          modelRefs: usableFallback
            ? [complexModelRef, usableFallback]
            : [complexModelRef]
        }
      }
    ])
  ) as RuntimePolicyRoutingRoutes;
}

export function getRuntimePolicyModelRoles(
  routes: RuntimePolicyRoutingRoutes
): RuntimePolicyModelRoles | null {
  const proposed = getRuntimePolicyModelRoleConversion(routes);

  if (!proposed) {
    return null;
  }

  const expectedRoutes = createRuntimePolicyRoleRoutes(proposed);
  const matches = runtimeRoutingCategories.every((category) =>
    runtimeRoutingDifficulties.every((difficulty) => {
      const current = routes[category]?.[difficulty]?.modelRefs;
      const expected = expectedRoutes[category][difficulty].modelRefs;

      return (
        Array.isArray(current) &&
        current.length === expected.length &&
        current.every(
          (modelRef, index) =>
            normalizeRuntimePolicyModelRef(modelRef) === expected[index]
        )
      );
    })
  );

  return matches ? proposed : null;
}

export function getRuntimePolicyModelRoleConversion(
  routes: RuntimePolicyRoutingRoutes
): RuntimePolicyModelRoles | null {
  const simpleModelRef = normalizeRuntimePolicyModelRef(
    routes.general?.simple?.modelRefs?.[0]
  );
  const complexModelRef = normalizeRuntimePolicyModelRef(
    routes.general?.complex?.modelRefs?.[0]
  );

  if (!simpleModelRef || !complexModelRef) {
    return null;
  }

  let sharedFallback: string | null | undefined;
  for (const category of runtimeRoutingCategories) {
    for (const difficulty of runtimeRoutingDifficulties) {
      const modelRefs = routes[category]?.[difficulty]?.modelRefs;
      const candidate =
        Array.isArray(modelRefs) && modelRefs.length === 2
          ? normalizeRuntimePolicyModelRef(modelRefs[1])
          : null;

      if (!candidate) {
        sharedFallback = null;
        break;
      }
      if (sharedFallback === undefined) {
        sharedFallback = candidate;
      } else if (sharedFallback !== candidate) {
        sharedFallback = null;
        break;
      }
    }
    if (sharedFallback === null) {
      break;
    }
  }

  const fallbackModelRef =
    sharedFallback &&
    sharedFallback !== simpleModelRef &&
    sharedFallback !== complexModelRef
      ? sharedFallback
      : null;

  return {
    complexModelRef,
    fallbackModelRef,
    simpleModelRef
  };
}

export function countRuntimePolicyModelRoleConversionChanges(
  routes: RuntimePolicyRoutingRoutes,
  roles: RuntimePolicyModelRoles
) {
  const convertedRoutes = createRuntimePolicyRoleRoutes(roles);

  return runtimeRoutingCategories.reduce(
    (changeCount, category) =>
      changeCount +
      runtimeRoutingDifficulties.filter((difficulty) => {
        const current = routes[category]?.[difficulty]?.modelRefs;
        const converted = convertedRoutes[category][difficulty].modelRefs;

        return (
          !Array.isArray(current) ||
          current.length !== converted.length ||
          current.some(
            (modelRef, index) =>
              normalizeRuntimePolicyModelRef(modelRef) !== converted[index]
          )
        );
      }).length,
    0
  );
}

export function isRuntimePolicyModelRoleProfile(
  routes: RuntimePolicyRoutingRoutes
) {
  return getRuntimePolicyModelRoles(routes) !== null;
}

export function toRuntimePolicyRoutingWriteInput(policy: RuntimePolicyRoutingDraft) {
  return {
    mode: policy.mode,
    routes: cloneRuntimePolicyRoutingRoutes(policy.routes)
  };
}

function normalizeRuntimePolicyModelRef(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function getRateLimitRefillTokensPerSecond(limit: number, windowSeconds: number) {
  return Math.max(1, Math.round(limit / Math.max(windowSeconds, 1)));
}

export function getRateLimitWindowSeconds(limit: number, refillTokensPerSecond: number) {
  return Math.max(1, Math.round(limit / Math.max(refillTokensPerSecond, 1)));
}

export function toRuntimePolicyRateLimitWriteInput(
  values: Pick<
    RuntimePolicyDraftValues,
    "rateLimitEnabled" | "rateLimitLimit" | "rateLimitWindowSeconds"
  >
) {
  return {
    enabled: values.rateLimitEnabled,
    limit: values.rateLimitLimit,
    windowSeconds: values.rateLimitWindowSeconds
  };
}

function mergeRuntimePolicyDetectors(
  detectors?: RuntimePolicyDetector[] | null
): RuntimePolicyDetector[] {
  const safeDetectors = detectors ?? [];
  const configuredByType = new Map(
    safeDetectors.map((detector) => [detector.type, detector])
  );
  const defaultTypes = new Set(
    defaultRuntimePolicyDetectors.map((detector) => detector.type)
  );
  const mergedDefaults = defaultRuntimePolicyDetectors.map((defaultDetector) => ({
    ...defaultDetector,
    ...configuredByType.get(defaultDetector.type)
  }));
  const configuredExtras = safeDetectors
    .filter((detector) => !defaultTypes.has(detector.type))
    .map((detector) => ({ ...detector }));

  return [...mergedDefaults, ...configuredExtras];
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

export function getDefaultRuntimePolicyResponseCapturePolicy(): RuntimePolicyResponseCapturePolicy {
  return {
    enabled: false,
    maxChars: 8000,
    mode: "disabled"
  };
}
