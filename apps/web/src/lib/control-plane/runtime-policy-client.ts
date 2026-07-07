import "server-only";

import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";
import {
  getControlPlaneApplicationId,
  getControlPlaneBaseUrl,
  getControlPlaneTenantId,
  getControlPlaneProjectId
} from "@/lib/control-plane/control-plane-config";
import {
  listApplicationProviderConnections,
  listTenantProviderConnections
} from "@/lib/control-plane/provider-connections-client";
import { applyInitialRuntimePolicyModelSelection } from "@/lib/control-plane/runtime-policy-model-selection";
import { getRuntimePolicyDraftValues } from "@/lib/control-plane/runtime-policy-types";
import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import type {
  RuntimePolicyConfig,
  RuntimePolicyDraftValues,
  RuntimePolicyHistoryDetailSummary,
  RuntimePolicyHistoryItem,
  RuntimePolicyModelConfig,
  RuntimePolicyPricingRule,
  RuntimePolicyProviderCatalogSummary,
  RuntimePolicySnapshot,
  RuntimePolicyModel,
  RuntimePolicyProvider
} from "@/lib/control-plane/runtime-policy-types";

type RuntimeConfigFixture = {
  runtimeConfig: RuntimePolicyConfig;
};

type RuntimeConfigHistoryResponse = {
  items?: unknown;
};

type RuntimeConfigHistoryDetailResponse = {
  item?: unknown;
  runtimeConfig?: unknown;
};

type ProviderCatalogResponse = {
  catalogId?: unknown;
  catalogVersion?: unknown;
  contentHash?: unknown;
  providers?: unknown;
  updatedAt?: unknown;
};

type ControlPlaneRequestResult =
  | {
      data: RuntimePolicyConfig;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type RuntimeConfigHistoryResult =
  | {
      data: RuntimePolicyHistoryItem[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type RuntimeConfigHistoryDetailResult =
  | {
      data: RuntimePolicyHistoryDetailSummary;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type RuntimeSnapshotResult =
  | {
      data: RuntimePolicySnapshot;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ProviderCatalogResult =
  | {
      data: RuntimePolicyProviderCatalogSummary;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

const RUNTIME_POLICY_DRAFT_CONFIG_VERSION = "draft";

export async function getRuntimePolicyModel(routeTenantId: string): Promise<RuntimePolicyModel> {
  return getRuntimePolicyModelForApplication(routeTenantId, getControlPlaneApplicationId());
}

export async function getRuntimePolicyModelForApplication(
  routeTenantId: string,
  applicationId: string,
  projectId = getControlPlaneProjectId()
): Promise<RuntimePolicyModel> {
  void projectId;

  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const fallbackConfig = getFixtureRuntimeConfig();

  const [
    activeConfig,
    history,
    runtimeSnapshot,
    providerCatalog,
    providerConnections,
    tenantProviderConnections
  ] = await Promise.all([
    fetchActiveRuntimeConfig(applicationId),
    fetchRuntimeConfigHistory(applicationId),
    fetchActiveRuntimeSnapshot(applicationId),
    fetchActiveProviderCatalog(applicationId),
    listApplicationProviderConnections(applicationId),
    listTenantProviderConnections(getControlPlaneTenantId())
  ]);
  const providerConnectionState = toProviderConnectionState(
    tenantProviderConnections,
    providerConnections
  );
  const historyDetail =
    history.ok && history.data[0]
      ? await fetchRuntimeConfigHistoryDetail(applicationId, history.data[0].configVersion)
      : null;
  const canonicalProviderCatalog =
    providerCatalog.ok
      ? await fetchProviderCatalog(providerCatalog.data.catalogId)
      : null;

  if (activeConfig.ok) {
    const mergedActiveConfig = mergeProviderConnectionCandidates(
      activeConfig.data,
      providerConnections.ok ? providerConnections.data : []
    );

    return {
      activeConfig: mergedActiveConfig,
      applicationId,
      controlPlaneBaseUrl,
      history: {
        detail: historyDetail?.ok ? historyDetail.data : null,
        detailLoadError: historyDetail && !historyDetail.ok ? historyDetail.error : null,
        items: history.ok ? history.data : [],
        loadError: history.ok ? null : history.error
      },
      loadError: null,
      providerCatalog: {
        canonicalLoadError:
          canonicalProviderCatalog && !canonicalProviderCatalog.ok
            ? canonicalProviderCatalog.error
            : null,
        canonicalVerified:
          canonicalProviderCatalog?.ok && providerCatalog.ok
            ? canonicalProviderCatalog.data.contentHash === providerCatalog.data.contentHash
            : null,
        loadError: providerCatalog.ok ? null : providerCatalog.error,
        summary: providerCatalog.ok ? providerCatalog.data : null
      },
      providerConnections: providerConnectionState,
      routeTenantId,
      runtimeSnapshot: {
        loadError: runtimeSnapshot.ok ? null : runtimeSnapshot.error,
        snapshot: runtimeSnapshot.ok ? runtimeSnapshot.data : null
      },
      source: "control-plane"
    };
  }

  if (activeConfig.status === 404) {
    const templateConfig = makeRuntimePolicyConfigTemplate(
      fallbackConfig,
      routeTenantId,
      applicationId,
      getTemplateProviderConnections(providerConnections, tenantProviderConnections)
    );

    return {
      activeConfig: templateConfig,
      applicationId,
      controlPlaneBaseUrl,
      history: {
        detail: null,
        detailLoadError: null,
        items: history.ok ? history.data : [],
        loadError: history.ok ? null : history.error
      },
      loadError: activeConfig.error,
      providerCatalog: {
        canonicalLoadError: null,
        canonicalVerified: null,
        loadError: providerCatalog.ok ? null : providerCatalog.error,
        summary: providerCatalog.ok ? providerCatalog.data : null
      },
      providerConnections: providerConnectionState,
      routeTenantId,
      runtimeSnapshot: {
        loadError: runtimeSnapshot.ok ? null : runtimeSnapshot.error,
        snapshot: runtimeSnapshot.ok ? runtimeSnapshot.data : null
      },
      source: "template"
    };
  }

  return {
    activeConfig: fallbackConfig,
    applicationId,
    controlPlaneBaseUrl,
    history: {
      detail: null,
      detailLoadError: activeConfig.error,
      items: [],
      loadError: activeConfig.error
    },
    loadError: activeConfig.error,
    providerCatalog: {
      canonicalLoadError: activeConfig.error,
      canonicalVerified: null,
      loadError: activeConfig.error,
      summary: null
    },
    providerConnections: providerConnectionState,
    routeTenantId,
    runtimeSnapshot: {
      loadError: activeConfig.error,
      snapshot: null
    },
    source: "fixture"
  };
}

function getTemplateProviderConnections(
  applicationProviderConnections: ProviderListLikeResult,
  tenantProviderConnections: ProviderListLikeResult
) {
  return getWritableProviderConnections(
    applicationProviderConnections.ok ? applicationProviderConnections.data : [],
    tenantProviderConnections.ok ? tenantProviderConnections.data : []
  );
}

function toProviderConnectionState(
  tenantProviderConnections: ProviderListLikeResult,
  applicationProviderConnections: ProviderListLikeResult
): RuntimePolicyModel["providerConnections"] {
  const applicationConnections = applicationProviderConnections.ok
    ? applicationProviderConnections.data
    : [];
  const writableConnections = getWritableProviderConnections(
    applicationConnections,
    tenantProviderConnections.ok ? tenantProviderConnections.data : []
  );

  return {
    available: writableConnections,
    loadError: [
      tenantProviderConnections.ok ? null : tenantProviderConnections.error,
      applicationProviderConnections.ok ? null : applicationProviderConnections.error
    ]
      .filter(Boolean)
      .join(" "),
    selectedIds: applicationProviderConnections.ok
      ? applicationConnections
          .filter(isTenantLevelProviderConnection)
          .map((providerConnection) => providerConnection.id)
      : []
  };
}

function getWritableProviderConnections(
  primaryConnections: ProviderConnectionRecord[],
  fallbackConnections: ProviderConnectionRecord[]
) {
  const merged = new Map<string, ProviderConnectionRecord>();

  for (const providerConnection of [...primaryConnections, ...fallbackConnections].filter(
    isTenantLevelProviderConnection
  )) {
    const providerKey = typeof providerConnection.provider === "string" ? providerConnection.provider.trim() : "";

    if (!providerKey) {
      continue;
    }

    const existing = merged.get(providerKey);

    if (!existing || (!hasProviderConfigModels(existing) && hasProviderConfigModels(providerConnection))) {
      merged.set(providerKey, providerConnection);
    }
  }

  return Array.from(merged.values());
}

function isTenantLevelProviderConnection(providerConnection: ProviderConnectionRecord) {
  return providerConnection.projectId === null;
}

function hasProviderConfigModels(providerConnection: ProviderConnectionRecord) {
  return getProviderConfigModels(providerConnection.providerConfig).length > 0;
}

type ProviderListLikeResult =
  | {
      data: ProviderConnectionRecord[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

function mergeProviderConnectionCandidates(
  config: RuntimePolicyConfig,
  providerConnections: ProviderConnectionRecord[]
): RuntimePolicyConfig {
  if (providerConnections.length === 0) {
    return config;
  }

  const providersByKey = new Map(config.providers.map((provider) => [provider.provider, provider]));
  const modelsByKey = new Map(
    config.models.map((model) => [runtimePolicyModelKey(model.provider, model.model), model])
  );

  for (const providerConnection of providerConnections) {
    const configuredModels = getProviderConfigModels(providerConnection.providerConfig);

    if (!providersByKey.has(providerConnection.provider)) {
      providersByKey.set(providerConnection.provider, toRuntimePolicyProvider(providerConnection, configuredModels));
    }

    for (const modelName of configuredModels) {
      const key = runtimePolicyModelKey(providerConnection.provider, modelName);

      if (!modelsByKey.has(key)) {
        modelsByKey.set(key, toRuntimePolicyModelConfig(providerConnection, modelName));
      }
    }
  }

  return {
    ...config,
    models: Array.from(modelsByKey.values()),
    providers: Array.from(providersByKey.values())
  };
}

function runtimePolicyModelKey(provider: string, model: string) {
  return `${provider.trim()}::${model.trim()}`;
}

function getProviderConfigModels(providerConfig: Record<string, unknown> | null) {
  const models = providerConfig?.models;

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

function toRuntimePolicyProvider(
  providerConnection: ProviderConnectionRecord,
  models: string[]
): RuntimePolicyProvider {
  return {
    baseUrl: providerConnection.baseUrl,
    credentialPreview: providerConnection.credentialPreview,
    displayName: providerConnection.displayName,
    failureMode: normalizeRuntimeProviderFailureMode(providerConnection.providerConfig),
    models,
    provider: providerConnection.provider,
    providerId: providerConnection.id,
    resolver: normalizeRuntimeProviderResolver(providerConnection.resolver),
    secretRef: null,
    status: normalizeRuntimeProviderStatus(providerConnection.status),
    timeoutMs: providerConnection.timeoutMs
  };
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

function toRuntimePolicyPricingRule(
  fallbackConfig: RuntimePolicyConfig,
  provider: string,
  model: string
): RuntimePolicyPricingRule {
  const fallbackRule = fallbackConfig.pricingRules.find(
    (rule) => rule.provider === provider && rule.model === model
  );

  return {
    completionTokenMicroUsd: fallbackRule?.completionTokenMicroUsd ?? 10,
    model,
    pricingVersion: fallbackRule?.pricingVersion ?? "default",
    promptTokenMicroUsd: fallbackRule?.promptTokenMicroUsd ?? 10,
    provider
  };
}

function normalizeRuntimeProviderFailureMode(
  providerConfig: Record<string, unknown> | null
): RuntimePolicyProvider["failureMode"] {
  return providerConfig?.failureMode === "fail_open_to_fallback"
    ? "fail_open_to_fallback"
    : "fail_closed";
}

function normalizeRuntimeProviderResolver(value: string): RuntimePolicyProvider["resolver"] {
  if (
    value === "none" ||
    value === "control_plane_secret_store" ||
    value === "environment"
  ) {
    return value;
  }

  return "none";
}

function normalizeRuntimeProviderStatus(value: string): RuntimePolicyProvider["status"] {
  if (value === "ACTIVE") {
    return "active";
  }

  if (value === "DEGRADED") {
    return "degraded";
  }

  return "disabled";
}

export async function getRuntimePolicyConfigForApplication(
  applicationId: string
): Promise<RuntimePolicyConfig | null> {
  const activeConfig = await fetchActiveRuntimeConfig(applicationId);

  return activeConfig.ok ? activeConfig.data : null;
}

export async function publishRuntimePolicyModelSelectionForApplication(
  applicationId: string,
  selectedModelKey: string,
  options: {
    warningThresholdPercent?: number;
  } = {}
): Promise<{ error?: string; ok: boolean }> {
  const selected = parseRuntimePolicyModelKey(selectedModelKey);

  if (!selected) {
    return {
      error: "Selected model is invalid.",
      ok: false
    };
  }

  if (
    options.warningThresholdPercent !== undefined &&
    !isWarningThresholdPercent(options.warningThresholdPercent)
  ) {
    return {
      error: "Warning threshold must be an integer between 0 and 100.",
      ok: false
    };
  }

  const activeConfig = await fetchRuntimeConfigForModelSelection(applicationId);

  if (!activeConfig) {
    return {
      error: "Runtime Policy model selection is not available for this application.",
      ok: false
    };
  }

  const selectedModel = activeConfig.models.find(
    (model) => model.provider === selected.provider && model.model === selected.model
  );

  if (!selectedModel) {
    return {
      error: "Selected model is not available in Runtime Policy.",
      ok: false
    };
  }

  const draftValues = getRuntimePolicyDraftValues(activeConfig);
  const nextValues = applyInitialRuntimePolicyModelSelection(draftValues, selectedModel, {
    warningThresholdPercent: options.warningThresholdPercent
  });
  const draftConfigVersion = createApplicationRuntimeDraftVersion(applicationId);
  const draft = await writeRuntimeConfig("draft", nextValues, {
    applicationId,
    draftConfigVersion
  });

  if (!draft.ok) {
    return {
      error: draft.error,
      ok: false
    };
  }

  const published = await writeRuntimeConfig("publish", nextValues, {
    applicationId,
    draftConfigVersion,
    publishedConfigVersion: createPublishedRuntimeConfigVersion()
  });

  return published.ok
    ? { ok: true }
    : {
        error: published.error,
        ok: false
      };
}

async function fetchRuntimeConfigForModelSelection(
  applicationId: string
): Promise<RuntimePolicyConfig | null> {
  const targetActiveConfig = await fetchActiveRuntimeConfig(applicationId);

  if (targetActiveConfig.ok) {
    return targetActiveConfig.data;
  }

  if (targetActiveConfig.status !== 404) {
    return null;
  }

  const providerConnections = await listApplicationProviderConnections(applicationId);

  if (!providerConnections.ok) {
    return null;
  }

  return makeRuntimePolicyConfigTemplate(
    getFixtureRuntimeConfig(),
    getControlPlaneTenantId(),
    applicationId,
    providerConnections.data
  );
}

export async function saveRuntimePolicyDraft(
  values: RuntimePolicyDraftValues,
  applicationId?: string
): Promise<ControlPlaneRequestResult> {
  const targetApplicationId = applicationId ?? getControlPlaneApplicationId();

  return writeRuntimeConfig("draft", values, {
    applicationId: targetApplicationId,
    draftConfigVersion: getRuntimePolicyDraftConfigVersion(values, targetApplicationId)
  });
}

export async function publishRuntimePolicy(
  values: RuntimePolicyDraftValues,
  applicationId?: string
): Promise<ControlPlaneRequestResult> {
  const targetApplicationId = applicationId ?? getControlPlaneApplicationId();
  const draftConfigVersion = getRuntimePolicyDraftConfigVersion(values, targetApplicationId);
  const publishedConfigVersion = createPublishedRuntimeConfigVersion();
  const draft = await writeRuntimeConfig("draft", values, {
    applicationId: targetApplicationId,
    draftConfigVersion
  });

  if (!draft.ok) {
    return draft;
  }

  return writeRuntimeConfig("publish", values, {
    applicationId: targetApplicationId,
    draftConfigVersion,
    publishedConfigVersion
  });
}

export async function rollbackRuntimePolicy(
  targetConfigVersion: string,
  applicationId = getControlPlaneApplicationId()
): Promise<ControlPlaneRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(applicationId)}/runtime-config/rollback`,
      {
        body: JSON.stringify({
          targetConfigVersion: targetConfigVersion.trim()
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    return readControlPlaneResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

function getFixtureRuntimeConfig() {
  return (runtimeConfigFixture as RuntimeConfigFixture).runtimeConfig;
}

function makeRuntimePolicyConfigTemplate(
  fallbackConfig: RuntimePolicyConfig,
  routeTenantId: string,
  applicationId: string,
  providerConnections: ProviderConnectionRecord[]
): RuntimePolicyConfig {
  const now = new Date().toISOString();
  const providers = providerConnections.map((providerConnection) =>
    toRuntimePolicyProvider(
      providerConnection,
      getProviderConfigModels(providerConnection.providerConfig)
    )
  );
  const models = providerConnections.flatMap((providerConnection) =>
    getProviderConfigModels(providerConnection.providerConfig).map((modelName) =>
      toRuntimePolicyModelConfig(providerConnection, modelName)
    )
  );
  const pricingRules = models.map((model) =>
    toRuntimePolicyPricingRule(fallbackConfig, model.provider, model.model)
  );
  const mergedConfig = mergeProviderConnectionCandidates(
    {
      ...fallbackConfig,
      applicationId,
      configHash: "",
      configVersion: createApplicationRuntimeDraftVersion(applicationId),
      effectiveAt: now,
      generatedAt: now,
      models,
      pricingRules,
      providers,
      publishState: "draft",
      publishedAt: "",
      tenantId: routeTenantId
    },
    []
  );
  const preferredModel =
    mergedConfig.models.find((model) => model.status === "active") ?? mergedConfig.models[0];

  if (!preferredModel) {
    return {
      ...mergedConfig,
      routingPolicy: {
        ...mergedConfig.routingPolicy,
        defaultModel: "",
        defaultProvider: "",
        fallbackModel: "",
        fallbackProvider: "",
        lowCostModel: "",
        lowCostProvider: ""
      }
    };
  }

  return {
    ...mergedConfig,
    routingPolicy: {
      ...mergedConfig.routingPolicy,
      defaultModel: preferredModel.model,
      defaultProvider: preferredModel.provider,
      fallbackModel: preferredModel.model,
      fallbackProvider: preferredModel.provider,
      lowCostModel: preferredModel.model,
      lowCostProvider: preferredModel.provider
    }
  };
}

function getRuntimePolicyDraftConfigVersion(
  values: RuntimePolicyDraftValues,
  applicationId: string
) {
  if (values.configVersion === RUNTIME_POLICY_DRAFT_CONFIG_VERSION) {
    return values.configVersion;
  }

  if (values.configVersion.startsWith("draft_")) {
    return values.configVersion;
  }

  return `draft_${applicationId.replaceAll("-", "_")}`;
}

async function fetchActiveRuntimeConfig(
  applicationId: string
): Promise<ControlPlaneRequestResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(applicationId)}/runtime-config/active`,
      {
        cache: "no-store"
      }
    );

    return readControlPlaneResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function fetchRuntimeConfigHistory(
  applicationId: string
): Promise<RuntimeConfigHistoryResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(applicationId)}/runtime-config/history?limit=20`,
      {
        cache: "no-store"
      }
    );

    return readRuntimeConfigHistoryResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function fetchRuntimeConfigHistoryDetail(
  applicationId: string,
  configVersion: string
): Promise<RuntimeConfigHistoryDetailResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(applicationId)}/runtime-config/history/${encodeURIComponent(configVersion)}`,
      {
        cache: "no-store"
      }
    );

    return readRuntimeConfigHistoryDetailResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function fetchActiveRuntimeSnapshot(
  applicationId: string
): Promise<RuntimeSnapshotResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(applicationId)}/runtime-snapshot/active`,
      {
        cache: "no-store"
      }
    );

    return readRuntimeSnapshotResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function fetchActiveProviderCatalog(
  applicationId: string
): Promise<ProviderCatalogResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(applicationId)}/provider-catalog/active`,
      {
        cache: "no-store"
      }
    );

    return readProviderCatalogResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function fetchProviderCatalog(catalogId: string): Promise<ProviderCatalogResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/provider-catalogs/${encodeURIComponent(catalogId)}`,
      {
        cache: "no-store"
      }
    );

    return readProviderCatalogResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function writeRuntimeConfig(
  mode: "draft" | "publish",
  values: RuntimePolicyDraftValues,
  options: {
    applicationId?: string;
    draftConfigVersion?: string;
    publishedConfigVersion?: string;
  } = {}
): Promise<ControlPlaneRequestResult> {
  const applicationId = options.applicationId ?? getControlPlaneApplicationId();
  const endpoint = mode === "draft" ? "draft" : "publish";
  const body =
    mode === "draft"
      ? toDraftRequest(values, options.draftConfigVersion ?? values.configVersion)
      : {
          configVersion: options.publishedConfigVersion ?? createPublishedRuntimeConfigVersion(),
          draftConfigVersion: options.draftConfigVersion ?? values.configVersion,
          effectiveAt: new Date().toISOString()
        };

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(applicationId)}/runtime-config/${endpoint}`,
      {
        body: JSON.stringify(body),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    return readControlPlaneResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

function createPublishedRuntimeConfigVersion() {
  return `runtime_config_${Date.now()}`;
}

function createApplicationRuntimeDraftVersion(applicationId: string) {
  return `draft_${applicationId.replaceAll("-", "_")}_${Date.now()}`;
}

function parseRuntimePolicyModelKey(value: string) {
  const [provider, ...modelParts] = value.split("::");
  const model = modelParts.join("::");

  if (!provider?.trim() || !model.trim()) {
    return null;
  }

  return {
    model: model.trim(),
    provider: provider.trim()
  };
}

function isWarningThresholdPercent(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

function toDraftRequest(values: RuntimePolicyDraftValues, configVersion: string) {
  return {
    budgetPolicy: {
      enabled: values.budgetEnabled,
      enforcementMode: values.budgetEnabled ? values.budgetEnforcementMode : "disabled",
      warningThresholdPercent: values.budgetWarningThresholdPercent
    },
    cachePolicy: {
      enabled: values.cacheEnabled,
      ttlSeconds: values.cacheTtlSeconds
    },
    configVersion,
    effectiveAt: new Date().toISOString(),
    promptCapturePolicy: {
      enabled: values.promptCaptureEnabled,
      maxChars: values.promptCaptureMaxChars,
      mode: values.promptCaptureEnabled ? "log_safe_full" : "disabled"
    },
    responseCapturePolicy: {
      enabled: values.responseCaptureEnabled,
      maxChars: values.responseCaptureMaxChars,
      mode: values.responseCaptureEnabled ? "raw_full" : "disabled"
    },
    rateLimit: {
      enabled: values.rateLimitEnabled,
      limit: values.rateLimitLimit
    },
    routingPolicy: {
      defaultModel: values.routingDefaultModel,
      defaultProvider: values.routingDefaultProvider,
      fallbackModel: values.routingFallbackModel,
      fallbackProvider: values.routingFallbackProvider,
      lowCostModel: values.routingLowCostModel,
      lowCostProvider: values.routingLowCostProvider,
      shortPromptMaxChars: values.routingShortPromptMaxChars
    },
    safetyPolicy: {
      detectors: values.detectors.map((detector) => ({
        action: isMandatorySafetyDetector(detector.type) ? "block" : detector.action,
        enabled: isMandatorySafetyDetector(detector.type) ? true : detector.enabled,
        placeholder: detector.placeholder,
        type: detector.type
      }))
    },
    models: values.models.map((model) => ({
      contextWindowTokens: model.contextWindowTokens,
      displayName: model.displayName.trim() || model.model,
      model: model.model.trim(),
      provider: model.provider.trim(),
      status: model.status,
      supportsJsonMode: model.supportsJsonMode,
      supportsStreaming: model.supportsStreaming
    })),
    pricingRules: values.pricingRules.map((rule) => ({
      completionTokenMicroUsd: rule.completionTokenMicroUsd,
      model: rule.model.trim(),
      pricingVersion: rule.pricingVersion.trim() || undefined,
      promptTokenMicroUsd: rule.promptTokenMicroUsd,
      provider: rule.provider.trim()
    }))
  };
}

function isMandatorySafetyDetector(detectorType: string) {
  return (
    detectorType === "resident_registration_number" ||
    detectorType === "api_key" ||
    detectorType === "authorization_header" ||
    detectorType === "jwt" ||
    detectorType === "private_key"
  );
}

async function readControlPlaneResponse(response: Response): Promise<ControlPlaneRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const runtimeConfig = getRuntimeConfigFromPayload(payload);

  if (!runtimeConfig) {
    return {
      error: "Control Plane response did not include runtime config.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: runtimeConfig,
    ok: true,
    status: response.status
  };
}

async function readRuntimeConfigHistoryResponse(
  response: Response
): Promise<RuntimeConfigHistoryResult> {
  const payload = (await response.json().catch(() => ({}))) as RuntimeConfigHistoryResponse;

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const items = getRuntimeConfigHistoryItems(payload);

  if (!items) {
    return {
      error: "Control Plane response did not include runtime config history.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: items,
    ok: true,
    status: response.status
  };
}

async function readRuntimeConfigHistoryDetailResponse(
  response: Response
): Promise<RuntimeConfigHistoryDetailResult> {
  const payload = (await response.json().catch(() => ({}))) as RuntimeConfigHistoryDetailResponse;

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const detail = getRuntimeConfigHistoryDetailSummary(payload);

  if (!detail) {
    return {
      error: "Control Plane response did not include runtime config history detail.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: detail,
    ok: true,
    status: response.status
  };
}

async function readRuntimeSnapshotResponse(response: Response): Promise<RuntimeSnapshotResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const snapshot = getRuntimeSnapshotFromPayload(payload);

  if (!snapshot) {
    return {
      error: "Control Plane response did not include active RuntimeSnapshot.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: snapshot,
    ok: true,
    status: response.status
  };
}

async function readProviderCatalogResponse(response: Response): Promise<ProviderCatalogResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const summary = getProviderCatalogSummaryFromPayload(payload);

  if (!summary) {
    return {
      error: "Control Plane response did not include active Provider Catalog.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: summary,
    ok: true,
    status: response.status
  };
}

function getRuntimeConfigFromPayload(payload: unknown): RuntimePolicyConfig | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const runtimeConfig = record.runtimeConfig ?? record;

  if (!runtimeConfig || typeof runtimeConfig !== "object") {
    return null;
  }

  return runtimeConfig as RuntimePolicyConfig;
}

function getRuntimeConfigHistoryItems(payload: RuntimeConfigHistoryResponse) {
  if (!Array.isArray(payload.items)) {
    return null;
  }

  const items = payload.items.map(toRuntimeConfigHistoryItem);

  if (items.some((item) => item === null)) {
    return null;
  }

  return items as RuntimePolicyHistoryItem[];
}

function toRuntimeConfigHistoryItem(value: unknown): RuntimePolicyHistoryItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.id !== "string" ||
    typeof record.configVersion !== "string" ||
    typeof record.configHash !== "string" ||
    typeof record.publishState !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    typeof record.canRollback !== "boolean"
  ) {
    return null;
  }

  return {
    canRollback: record.canRollback,
    configHash: record.configHash,
    configVersion: record.configVersion,
    createdAt: record.createdAt,
    effectiveAt: typeof record.effectiveAt === "string" ? record.effectiveAt : null,
    id: record.id,
    publishedAt: typeof record.publishedAt === "string" ? record.publishedAt : null,
    publishState: record.publishState,
    updatedAt: record.updatedAt
  };
}

function getRuntimeConfigHistoryDetailSummary(
  payload: RuntimeConfigHistoryDetailResponse
): RuntimePolicyHistoryDetailSummary | null {
  const item = toRuntimeConfigHistoryItem(payload.item);
  const runtimeConfig = getRuntimeConfigFromPayload(payload.runtimeConfig);

  if (!item || !runtimeConfig) {
    return null;
  }

  return {
    configHash: item.configHash,
    configVersion: item.configVersion,
    detectorCount: runtimeConfig.safetyPolicy?.detectors?.length ?? 0,
    modelCount: runtimeConfig.models.length,
    providerCount: runtimeConfig.providers.length,
    publishState: item.publishState
  };
}

function getRuntimeSnapshotFromPayload(payload: unknown): RuntimePolicySnapshot | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const snapshot = payload as Partial<RuntimePolicySnapshot>;

  if (
    typeof snapshot.runtimeSnapshotId !== "string" ||
    typeof snapshot.runtimeSnapshotVersion !== "number" ||
    typeof snapshot.contentHash !== "string" ||
    typeof snapshot.runtimeState !== "string" ||
    typeof snapshot.publishedAt !== "string" ||
    typeof snapshot.publishedBy !== "string" ||
    typeof snapshot.gatewayInstanceId !== "string" ||
    !snapshot.lookupKey ||
    !snapshot.budgetResolution ||
    !snapshot.providerCatalogRef ||
    !snapshot.policies
  ) {
    return null;
  }

  return snapshot as RuntimePolicySnapshot;
}

function getProviderCatalogSummaryFromPayload(
  payload: unknown
): RuntimePolicyProviderCatalogSummary | null {
  const catalog = getProviderCatalogPayload(payload);

  if (!catalog || typeof catalog !== "object") {
    return null;
  }

  const record = catalog as ProviderCatalogResponse;

  if (
    typeof record.catalogId !== "string" ||
    typeof record.catalogVersion !== "number" ||
    typeof record.contentHash !== "string" ||
    !Array.isArray(record.providers)
  ) {
    return null;
  }

  const modelCount = record.providers.reduce((count, provider) => {
    if (!provider || typeof provider !== "object") {
      return count;
    }

    const models = (provider as Record<string, unknown>).models;

    return count + (Array.isArray(models) ? models.length : 0);
  }, 0);

  return {
    catalogId: record.catalogId,
    catalogVersion: record.catalogVersion,
    contentHash: record.contentHash,
    modelCount,
    providerCount: record.providers.length,
    updatedAt: typeof record.updatedAt === "string" ? record.updatedAt : null
  };
}

function getProviderCatalogPayload(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  return record.data ?? record;
}

function getErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.message ?? record.error;

    if (typeof message === "string") {
      return message;
    }

    if (Array.isArray(message)) {
      const messages = message
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean);

      if (messages.length > 0) {
        return messages.join(" ");
      }
    }

    if (record.error && typeof record.error === "object") {
      const nested = record.error as Record<string, unknown>;
      const nestedMessage = nested.message;

      if (typeof nestedMessage === "string") {
        return nestedMessage;
      }

      if (Array.isArray(nestedMessage)) {
        const messages = nestedMessage
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean);

        if (messages.length > 0) {
          return messages.join(" ");
        }
      }
    }
  }

  return `Control Plane request failed with HTTP ${status}.`;
}
