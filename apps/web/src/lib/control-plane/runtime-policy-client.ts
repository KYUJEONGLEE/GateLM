import "server-only";

import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";
import {
  getControlPlaneApplicationId,
  getControlPlaneBaseUrl,
  getControlPlaneProjectId
} from "@/lib/control-plane/control-plane-config";
import {
  listProviderConnections
} from "@/lib/control-plane/provider-connections-client";
import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import type {
  RuntimePolicyConfig,
  RuntimePolicyDraftValues,
  RuntimePolicyHistoryDetailSummary,
  RuntimePolicyHistoryItem,
  RuntimePolicyModelConfig,
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
  const applicationId = getControlPlaneApplicationId();
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const controlPlaneProjectId = getControlPlaneProjectId();
  const fallbackConfig = getFixtureRuntimeConfig();

  const [
    activeConfig,
    history,
    runtimeSnapshot,
    providerCatalog,
    providerConnections
  ] = await Promise.all([
    fetchActiveRuntimeConfig(applicationId),
    fetchRuntimeConfigHistory(applicationId),
    fetchActiveRuntimeSnapshot(applicationId),
    fetchActiveProviderCatalog(applicationId),
    listProviderConnections(controlPlaneProjectId)
  ]);
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
      routeTenantId,
      runtimeSnapshot: {
        loadError: runtimeSnapshot.ok ? null : runtimeSnapshot.error,
        snapshot: runtimeSnapshot.ok ? runtimeSnapshot.data : null
      },
      source: "control-plane"
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
    routeTenantId,
    runtimeSnapshot: {
      loadError: activeConfig.error,
      snapshot: null
    },
    source: "fixture"
  };
}

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
    status: providerConnection.status,
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

export async function getRuntimePolicyConfigForApplication(
  applicationId: string
): Promise<RuntimePolicyConfig | null> {
  const activeConfig = await fetchActiveRuntimeConfig(applicationId);

  return activeConfig.ok ? activeConfig.data : null;
}

export async function saveRuntimePolicyDraft(
  values: RuntimePolicyDraftValues
): Promise<ControlPlaneRequestResult> {
  return writeRuntimeConfig("draft", values, {
    draftConfigVersion: RUNTIME_POLICY_DRAFT_CONFIG_VERSION
  });
}

export async function publishRuntimePolicy(
  values: RuntimePolicyDraftValues
): Promise<ControlPlaneRequestResult> {
  const draftConfigVersion = RUNTIME_POLICY_DRAFT_CONFIG_VERSION;
  const publishedConfigVersion = createPublishedRuntimeConfigVersion();
  const draft = await writeRuntimeConfig("draft", values, {
    draftConfigVersion
  });

  if (!draft.ok) {
    return draft;
  }

  return writeRuntimeConfig("publish", values, {
    draftConfigVersion,
    publishedConfigVersion
  });
}

export async function rollbackRuntimePolicy(
  targetConfigVersion: string
): Promise<ControlPlaneRequestResult> {
  const applicationId = getControlPlaneApplicationId();

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
    draftConfigVersion?: string;
    publishedConfigVersion?: string;
  } = {}
): Promise<ControlPlaneRequestResult> {
  const applicationId = getControlPlaneApplicationId();
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
        action: detector.action,
        enabled: detector.enabled,
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
    detectorCount: runtimeConfig.safetyPolicy.detectors.length,
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
  }

  return `Control Plane request failed with HTTP ${status}.`;
}
