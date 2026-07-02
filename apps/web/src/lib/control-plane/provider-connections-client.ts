import "server-only";

import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";
import {
  getControlPlaneBaseUrl,
  getControlPlaneProjectId
} from "@/lib/control-plane/control-plane-config";
import type {
  ProviderConnectionFormValues,
  ProviderConnectionRecord,
  ProviderConnectionsModel,
  ProviderModelDiscovery,
  ProviderPresetRecord
} from "@/lib/control-plane/provider-connections-types";

type RuntimeConfigFixture = {
  runtimeConfig: {
    generatedAt: string;
    projectId: string;
    tenantId: string;
    providers: Array<{
      baseUrl: string;
      credentialPreview: {
        last4: string | null;
        prefix: string | null;
      } | null;
      displayName: string;
      failureMode?: string;
      models?: string[];
      provider: string;
      providerId: string;
      resolver: string;
      status: string;
      timeoutMs: number;
    }>;
  };
};

type ProviderRequestResult =
  | {
      data: ProviderConnectionRecord;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ProviderListResult =
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

type ProviderPresetListResult =
  | {
      data: ProviderPresetRecord[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ProviderDiscoveryResult =
  | {
      data: ProviderModelDiscovery;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

export async function getProviderConnectionsModel(
  routeTenantId: string
): Promise<ProviderConnectionsModel> {
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const controlPlaneProjectId = getControlPlaneProjectId();
  const [listResult, presetResult] = await Promise.all([
    listProviders(controlPlaneProjectId),
    listProviderPresets()
  ]);
  const providerPresets = presetResult.ok
    ? {
        items: presetResult.data,
        loadError: null,
        source: "control-plane" as const
      }
    : {
        items: getFallbackProviderPresets(),
        loadError: presetResult.error,
        source: "fallback" as const
      };

  if (listResult.ok) {
    return {
      controlPlaneBaseUrl,
      controlPlaneProjectId,
      loadError: null,
      providerPresets,
      providers: listResult.data,
      routeTenantId,
      source: "control-plane"
    };
  }

  return {
    controlPlaneBaseUrl,
    controlPlaneProjectId,
    loadError: listResult.error,
    providerPresets,
    providers: getFixtureProviders(),
    routeTenantId,
    source: "fixture"
  };
}

export async function upsertProviderConnection(
  values: ProviderConnectionFormValues
): Promise<ProviderRequestResult> {
  const projectId = getControlPlaneProjectId();

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/providers`,
      {
        body: JSON.stringify(toProviderPayload(values)),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    return readProviderResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function discoverProviderModels(provider: string): Promise<ProviderDiscoveryResult> {
  const projectId = getControlPlaneProjectId();

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/providers/${encodeURIComponent(provider)}/discover-models`,
      {
        cache: "no-store",
        method: "POST"
      }
    );

    return readProviderDiscoveryResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function listProviders(projectId: string): Promise<ProviderListResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/providers?limit=50`,
      {
        cache: "no-store"
      }
    );

    return readProviderListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function listProviderPresets(): Promise<ProviderPresetListResult> {
  try {
    const response = await fetch(`${getControlPlaneBaseUrl()}/admin/v1/provider-presets`, {
      cache: "no-store"
    });

    return readProviderPresetListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

function toProviderPayload(values: ProviderConnectionFormValues) {
  const models = splitProviderModels(values.models);
  const providerConfig = toProviderConfig(values, models);

  return {
    baseUrl: values.baseUrl.trim(),
    credentialLast4: values.credentialLast4.trim() || undefined,
    credentialPrefix: values.credentialPrefix.trim() || undefined,
    displayName: values.displayName.trim(),
    provider: values.provider.trim(),
    providerConfig,
    resolver: values.resolver.trim() || undefined,
    secretRef: values.secretRef.trim() || undefined,
    status: values.status,
    timeoutMs: values.timeoutMs
  };
}

function toProviderConfig(values: ProviderConnectionFormValues, models: string[]) {
  const adapterType = values.adapterType.trim();
  const apiVersion = values.apiVersion.trim();
  const providerConfig: Record<string, unknown> = {
    credentialRequired: values.credentialRequired,
    failureMode: values.failureMode,
    requestFormat: values.requestFormat
  };

  if (models.length > 0) {
    providerConfig.models = models;
  }

  if (adapterType) {
    providerConfig.adapterType = adapterType;
  }

  if (apiVersion) {
    providerConfig.apiVersion = apiVersion;
  }

  const modelsEndpointPath = values.modelsEndpointPath.trim();
  if (modelsEndpointPath) {
    providerConfig.modelsEndpointPath = modelsEndpointPath;
  }

  return providerConfig;
}

function splitProviderModels(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((model) => model.trim())
        .filter(Boolean)
    )
  );
}

async function readProviderResponse(response: Response): Promise<ProviderRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const provider = getProviderFromPayload(payload);

  if (!provider) {
    return {
      error: "Control Plane response did not include provider data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: provider,
    ok: true,
    status: response.status
  };
}

async function readProviderListResponse(response: Response): Promise<ProviderListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const providers = getProvidersFromPayload(payload);

  if (!providers) {
    return {
      error: "Control Plane response did not include provider list.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: providers,
    ok: true,
    status: response.status
  };
}

async function readProviderPresetListResponse(response: Response): Promise<ProviderPresetListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const presets = getProviderPresetsFromPayload(payload);

  if (!presets) {
    return {
      error: "Control Plane response did not include provider presets.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: presets,
    ok: true,
    status: response.status
  };
}

async function readProviderDiscoveryResponse(response: Response): Promise<ProviderDiscoveryResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const discovery = getProviderDiscoveryFromPayload(payload);

  if (!discovery) {
    return {
      error: "Control Plane response did not include discovered models.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: discovery,
    ok: true,
    status: response.status
  };
}

function getProviderFromPayload(payload: unknown): ProviderConnectionRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const provider = record.data ?? record;

  if (!provider || typeof provider !== "object") {
    return null;
  }

  return toProviderRecord(provider);
}

function getProviderPresetsFromPayload(payload: unknown): ProviderPresetRecord[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const data = record.data;
  const values = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).items)
      ? ((data as Record<string, unknown>).items as unknown[])
      : Array.isArray(record.items)
        ? record.items
        : null;

  if (!values) {
    return null;
  }

  const presets = values.map(toProviderPresetRecord);

  if (presets.some((preset) => preset === null)) {
    return null;
  }

  return presets as ProviderPresetRecord[];
}

function getProviderDiscoveryFromPayload(payload: unknown): ProviderModelDiscovery | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const value = record.data ?? record;

  if (!value || typeof value !== "object") {
    return null;
  }

  const discovery = value as Record<string, unknown>;
  const models = Array.isArray(discovery.models)
    ? discovery.models.map(toProviderDiscoveredModel)
    : null;

  if (
    typeof discovery.providerId !== "string" ||
    typeof discovery.provider !== "string" ||
    typeof discovery.adapterType !== "string" ||
    typeof discovery.baseUrl !== "string" ||
    typeof discovery.credentialRequired !== "boolean" ||
    typeof discovery.discoveredAt !== "string" ||
    typeof discovery.modelCount !== "number" ||
    !models ||
    models.some((model) => model === null)
  ) {
    return null;
  }

  return {
    adapterType: discovery.adapterType,
    baseUrl: discovery.baseUrl,
    credentialRequired: discovery.credentialRequired,
    discoveredAt: discovery.discoveredAt,
    modelCount: discovery.modelCount,
    models: models as ProviderModelDiscovery["models"],
    provider: discovery.provider,
    providerId: discovery.providerId
  };
}

function getProvidersFromPayload(payload: unknown): ProviderConnectionRecord[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return null;
  }

  const providers = record.data.map(toProviderRecord);

  if (providers.some((provider) => provider === null)) {
    return null;
  }

  return providers as ProviderConnectionRecord[];
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

function toProviderPresetRecord(value: unknown): ProviderPresetRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.providerKey !== "string" ||
    typeof record.displayName !== "string" ||
    typeof record.adapterType !== "string" ||
    typeof record.baseUrl !== "string" ||
    typeof record.modelsEndpointPath !== "string" ||
    typeof record.credentialRequired !== "boolean" ||
    typeof record.defaultResolver !== "string" ||
    typeof record.defaultTimeoutMs !== "number"
  ) {
    return null;
  }

  return {
    adapterType: record.adapterType,
    baseUrl: record.baseUrl,
    credentialRequired: record.credentialRequired,
    defaultResolver: record.defaultResolver,
    defaultTimeoutMs: record.defaultTimeoutMs,
    displayName: record.displayName,
    modelsEndpointPath: record.modelsEndpointPath,
    providerKey: record.providerKey
  };
}

function toProviderDiscoveredModel(value: unknown): ProviderModelDiscovery["models"][number] | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.providerId !== "string" ||
    typeof record.provider !== "string" ||
    typeof record.modelName !== "string" ||
    typeof record.displayName !== "string" ||
    typeof record.object !== "string"
  ) {
    return null;
  }

  return {
    createdAt: typeof record.createdAt === "string" ? record.createdAt : null,
    displayName: record.displayName,
    modelName: record.modelName,
    object: record.object,
    ownedBy: typeof record.ownedBy === "string" ? record.ownedBy : null,
    provider: record.provider,
    providerId: record.providerId
  };
}

function getFixtureProviders(): ProviderConnectionRecord[] {
  const runtimeConfig = (runtimeConfigFixture as RuntimeConfigFixture).runtimeConfig;
  const timestamp = runtimeConfig.generatedAt;

  return runtimeConfig.providers.map((provider) => ({
    baseUrl: provider.baseUrl,
    createdAt: timestamp,
    credentialPreview: provider.credentialPreview ?? {
      last4: null,
      prefix: null
    },
    displayName: provider.displayName,
    id: provider.providerId,
    projectId: runtimeConfig.projectId,
    provider: provider.provider,
    providerConfig: {
      adapterType: provider.provider === "mock" ? "mock" : "openai_compatible",
      credentialRequired: provider.resolver !== "none",
      failureMode: provider.failureMode ?? "fail_closed",
      models: provider.models,
      requestFormat:
        provider.provider === "mock" ? "mock_chat_completions" : "openai_chat_completions"
    },
    resolver: provider.resolver,
    status: normalizeProviderStatus(provider.status) ?? "DISABLED",
    tenantId: runtimeConfig.tenantId,
    timeoutMs: provider.timeoutMs,
    updatedAt: timestamp
  }));
}

function getFallbackProviderPresets(): ProviderPresetRecord[] {
  return [
    {
      adapterType: "openai_compatible",
      baseUrl: "https://api.openai.com/v1",
      credentialRequired: true,
      defaultResolver: "environment",
      defaultTimeoutMs: 30000,
      displayName: "OpenAI",
      modelsEndpointPath: "/models",
      providerKey: "openai"
    },
    {
      adapterType: "openai_compatible",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      credentialRequired: true,
      defaultResolver: "environment",
      defaultTimeoutMs: 30000,
      displayName: "Gemini",
      modelsEndpointPath: "/models",
      providerKey: "gemini"
    },
    {
      adapterType: "anthropic",
      baseUrl: "https://api.anthropic.com/v1",
      credentialRequired: true,
      defaultResolver: "environment",
      defaultTimeoutMs: 30000,
      displayName: "Claude",
      modelsEndpointPath: "/models",
      providerKey: "claude"
    }
  ];
}

function toProviderRecord(value: unknown): ProviderConnectionRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeProviderStatus(record.status);

  if (
    typeof record.id !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.projectId !== "string" ||
    typeof record.provider !== "string" ||
    typeof record.displayName !== "string" ||
    typeof record.baseUrl !== "string" ||
    typeof record.timeoutMs !== "number" ||
    typeof record.resolver !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    !status
  ) {
    return null;
  }

  return {
    baseUrl: record.baseUrl,
    createdAt: record.createdAt,
    credentialPreview: toCredentialPreview(record.credentialPreview),
    displayName: record.displayName,
    id: record.id,
    projectId: record.projectId,
    provider: record.provider,
    providerConfig: toRecordOrNull(record.providerConfig),
    resolver: record.resolver,
    status,
    tenantId: record.tenantId,
    timeoutMs: record.timeoutMs,
    updatedAt: record.updatedAt
  };
}

function toCredentialPreview(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      last4: null,
      prefix: null
    };
  }

  const record = value as Record<string, unknown>;

  return {
    last4: typeof record.last4 === "string" ? record.last4 : null,
    prefix: typeof record.prefix === "string" ? record.prefix : null
  };
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeProviderStatus(value: unknown): ProviderConnectionRecord["status"] | null {
  if (value === "ACTIVE" || value === "active") {
    return "ACTIVE";
  }

  if (value === "DEGRADED" || value === "degraded") {
    return "DEGRADED";
  }

  if (value === "DISABLED" || value === "disabled") {
    return "DISABLED";
  }

  return null;
}
