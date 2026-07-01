import "server-only";

import type { IncomingHttpHeaders } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  getControlPlaneApplicationId,
  getControlPlaneBaseUrl
} from "@/lib/control-plane/control-plane-config";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";
import type {
  ModelCatalogGatewayMeta,
  ModelCatalogItem,
  ModelCatalogModel
} from "@/lib/gateway/model-catalog-types";

type GatewayModelListResponse = {
  data?: unknown;
  object?: unknown;
};

type GatewayModelRecord = {
  created?: unknown;
  gate_lm?: unknown;
  id?: unknown;
  object?: unknown;
  owned_by?: unknown;
};

type GatewayModelsHttpResponse = {
  body: string;
  headers: IncomingHttpHeaders;
  status: number;
};

type ProviderCatalogHttpResponse = {
  body: string;
  status: number;
};

type ProviderCatalogParseResult = {
  models: ModelCatalogItem[];
  updatedAt: string | null;
};

type ProviderCatalogProviderRecord = {
  adapterConfig?: unknown;
  adapterType?: unknown;
  credentialRef?: unknown;
  credentialRequired?: unknown;
  enabled?: unknown;
  fallbackEligible?: unknown;
  models?: unknown;
  providerName?: unknown;
  timeoutMs?: unknown;
};

type ProviderCatalogModelRecord = {
  capabilities?: unknown;
  displayName?: unknown;
  enabled?: unknown;
  modelId?: unknown;
  modelName?: unknown;
  routing?: unknown;
};

const emptyMeta: ModelCatalogGatewayMeta = {
  cacheStatus: null,
  httpStatus: null,
  maskingAction: null,
  requestId: null,
  routedModel: null,
  routedProvider: null
};

export async function getModelCatalogModel(routeTenantId: string): Promise<ModelCatalogModel> {
  const gatewayConfig = getLiveGatewayConfig();
  const gatewayBaseUrl = gatewayConfig.baseUrl;
  const controlPlaneCatalog = await getControlPlaneModelCatalog();

  try {
    const response = await requestGatewayModels({
      apiKey: gatewayConfig.apiKey,
      appToken: gatewayConfig.appToken,
      baseUrl: gatewayBaseUrl,
      requestId: buildRequestId()
    });
    const meta = getGatewayMeta(response);

    if (response.status < 200 || response.status >= 300) {
      return {
        controlPlaneLoadError: controlPlaneCatalog.loadError,
        loadError: `Gateway /v1/models failed with HTTP ${response.status}.`,
        meta,
        models: controlPlaneCatalog.models,
        routeTenantId,
        source: controlPlaneCatalog.models.length > 0 ? "control-plane" : "gateway"
      };
    }

    const payload = parseJson(response.body);
    const models = parseModelList(payload);

    if (!models) {
      return {
        loadError: "Gateway /v1/models response did not match the model catalog contract.",
        controlPlaneLoadError: controlPlaneCatalog.loadError,
        meta,
        models: controlPlaneCatalog.models,
        routeTenantId,
        source: controlPlaneCatalog.models.length > 0 ? "control-plane" : "gateway"
      };
    }

    const mergedModels = mergeModelCatalogs(models, controlPlaneCatalog.models);

    return {
      controlPlaneLoadError: controlPlaneCatalog.loadError,
      loadError: null,
      meta,
      models: mergedModels,
      routeTenantId,
      source: controlPlaneCatalog.models.length > 0 ? "gateway+control-plane" : "gateway"
    };
  } catch {
    return {
      controlPlaneLoadError: controlPlaneCatalog.loadError,
      loadError: "Gateway unavailable.",
      meta: emptyMeta,
      models: controlPlaneCatalog.models,
      routeTenantId,
      source: controlPlaneCatalog.models.length > 0 ? "control-plane" : "gateway"
    };
  }
}

function requestGatewayModels({
  apiKey,
  appToken,
  baseUrl,
  requestId
}: {
  apiKey: string;
  appToken: string;
  baseUrl: string;
  requestId: string;
}): Promise<GatewayModelsHttpResponse> {
  return new Promise((resolve, reject) => {
    const endpoint = new URL("/v1/models", `${baseUrl.replace(/\/+$/, "")}/`);
    const transport = endpoint.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(
      endpoint,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-GateLM-App-Token": appToken,
          "X-GateLM-Request-Id": requestId
        },
        method: "GET"
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf-8"),
            headers: response.headers,
            status: response.statusCode ?? 0
          });
        });
      }
    );

    request.setTimeout(5000, () => {
      request.destroy(new Error("Gateway /v1/models request timed out."));
    });
    request.on("error", reject);
    request.end();
  });
}

async function getControlPlaneModelCatalog(): Promise<{
  loadError: string | null;
  models: ModelCatalogItem[];
}> {
  const applicationId = getControlPlaneApplicationId();
  const baseUrl = getControlPlaneBaseUrl();

  try {
    const response = await requestControlPlaneProviderCatalog({
      applicationId,
      baseUrl
    });

    if (response.status < 200 || response.status >= 300) {
      return {
        loadError: `Control Plane provider catalog failed with HTTP ${response.status}.`,
        models: []
      };
    }

    const parsedCatalog = parseProviderCatalog(parseJson(response.body));

    if (!parsedCatalog) {
      return {
        loadError: "Control Plane provider catalog response did not match the catalog contract.",
        models: []
      };
    }

    return {
      loadError: null,
      models: parsedCatalog.models
    };
  } catch {
    return {
      loadError: "Control Plane unavailable.",
      models: []
    };
  }
}

function requestControlPlaneProviderCatalog({
  applicationId,
  baseUrl
}: {
  applicationId: string;
  baseUrl: string;
}): Promise<ProviderCatalogHttpResponse> {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(
      `/admin/v1/applications/${encodeURIComponent(applicationId)}/provider-catalog/active`,
      `${baseUrl.replace(/\/+$/, "")}/`
    );
    const transport = endpoint.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(
      endpoint,
      {
        method: "GET"
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        response.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf-8"),
            status: response.statusCode ?? 0
          });
        });
      }
    );

    request.setTimeout(5000, () => {
      request.destroy(new Error("Control Plane provider catalog request timed out."));
    });
    request.on("error", reject);
    request.end();
  });
}

function buildRequestId() {
  return `request_web_model_catalog_${Date.now().toString(36)}`;
}

function getGatewayMeta(response: GatewayModelsHttpResponse): ModelCatalogGatewayMeta {
  return {
    cacheStatus: getHeader(response.headers, "X-GateLM-Cache-Status"),
    httpStatus: response.status,
    maskingAction: getHeader(response.headers, "X-GateLM-Masking-Action"),
    requestId: getHeader(response.headers, "X-GateLM-Request-Id"),
    routedModel: getHeader(response.headers, "X-GateLM-Routed-Model"),
    routedProvider: getHeader(response.headers, "X-GateLM-Routed-Provider")
  };
}

function getHeader(headers: IncomingHttpHeaders, name: string) {
  const value = headers[name.toLowerCase()];

  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return typeof value === "string" ? value : null;
}

function parseJson(value: string): GatewayModelListResponse {
  try {
    return JSON.parse(value) as GatewayModelListResponse;
  } catch {
    return {};
  }
}

function parseModelList(payload: GatewayModelListResponse): ModelCatalogItem[] | null {
  if (!Array.isArray(payload.data)) {
    return null;
  }

  const models = payload.data.map(parseModelRecord);

  if (models.some((model) => model === null)) {
    return null;
  }

  return models as ModelCatalogItem[];
}

function parseModelRecord(value: unknown): ModelCatalogItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as GatewayModelRecord;

  if (
    typeof record.id !== "string" ||
    typeof record.object !== "string" ||
    typeof record.owned_by !== "string"
  ) {
    return null;
  }

  const gateLM = parseGateLMMetadata(record.gate_lm);

  return {
    alias: gateLM.alias,
    allowed: gateLM.allowed,
    adapterType: null,
    apiVersion: null,
    autoRoutingEligible: null,
    capabilities: gateLM.capabilities,
    costTier: null,
    createdAt: parseUnixTimestamp(record.created),
    credentialRequired: null,
    credentialState: null,
    fallbackEligible: null,
    fallbackPriority: null,
    id: record.id,
    object: record.object,
    ownedBy: record.owned_by,
    provider: gateLM.provider,
    requestFormat: null,
    source: "gateway",
    timeoutMs: null
  };
}

function parseProviderCatalog(payload: GatewayModelListResponse): ProviderCatalogParseResult | null {
  const catalog = getCatalogPayload(payload);

  if (!catalog || typeof catalog !== "object") {
    return null;
  }

  const record = catalog as Record<string, unknown>;

  if (!Array.isArray(record.providers)) {
    return null;
  }

  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : null;
  const models = record.providers.flatMap((provider) =>
    parseProviderCatalogProvider(provider, updatedAt)
  );

  return { models, updatedAt };
}

function getCatalogPayload(payload: GatewayModelListResponse) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  return record.data ?? record;
}

function parseProviderCatalogProvider(value: unknown, updatedAt: string | null): ModelCatalogItem[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const provider = value as ProviderCatalogProviderRecord;

  if (typeof provider.providerName !== "string" || !Array.isArray(provider.models)) {
    return [];
  }

  return provider.models
    .map((model) => parseProviderCatalogModel(provider, model, updatedAt))
    .filter((model): model is ModelCatalogItem => model !== null);
}

function parseProviderCatalogModel(
  provider: ProviderCatalogProviderRecord,
  value: unknown,
  updatedAt: string | null
): ModelCatalogItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const model = value as ProviderCatalogModelRecord;

  if (typeof model.modelName !== "string") {
    return null;
  }

  const providerName = typeof provider.providerName === "string" ? provider.providerName : null;
  const displayName = typeof model.displayName === "string" ? model.displayName : null;
  const adapterConfig = parseProviderCatalogAdapterConfig(provider.adapterConfig);
  const routing = parseProviderCatalogRouting(model.routing);

  return {
    alias: displayName && displayName !== model.modelName ? displayName : null,
    allowed: provider.enabled === false || model.enabled === false ? false : true,
    adapterType: typeof provider.adapterType === "string" ? provider.adapterType : null,
    apiVersion: adapterConfig.apiVersion,
    autoRoutingEligible: routing.autoRoutingEligible,
    capabilities: parseProviderCatalogCapabilities(model.capabilities),
    costTier: routing.costTier,
    createdAt: updatedAt,
    credentialRequired:
      typeof provider.credentialRequired === "boolean" ? provider.credentialRequired : null,
    credentialState: parseProviderCredentialState(provider.credentialRef),
    fallbackEligible:
      typeof provider.fallbackEligible === "boolean" ? provider.fallbackEligible : null,
    fallbackPriority: routing.fallbackPriority,
    id: model.modelName,
    object: "model",
    ownedBy: providerName ?? "control-plane",
    provider: providerName,
    requestFormat: adapterConfig.requestFormat,
    source: "control-plane",
    timeoutMs: typeof provider.timeoutMs === "number" ? provider.timeoutMs : null
  };
}

function parseProviderCatalogAdapterConfig(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      apiVersion: null,
      requestFormat: null
    };
  }

  const record = value as Record<string, unknown>;

  return {
    apiVersion: typeof record.apiVersion === "string" ? record.apiVersion : null,
    requestFormat: typeof record.requestFormat === "string" ? record.requestFormat : null
  };
}

function parseProviderCatalogRouting(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      autoRoutingEligible: null,
      costTier: null,
      fallbackPriority: null
    };
  }

  const record = value as Record<string, unknown>;

  return {
    autoRoutingEligible:
      typeof record.autoRoutingEligible === "boolean" ? record.autoRoutingEligible : null,
    costTier: typeof record.costTier === "string" ? record.costTier : null,
    fallbackPriority:
      typeof record.fallbackPriority === "number" ? record.fallbackPriority : null
  };
}

function parseProviderCredentialState(value: unknown) {
  if (value === null) {
    return "not_required";
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  return typeof record.credentialState === "string" ? record.credentialState : null;
}

function parseProviderCatalogCapabilities(value: unknown) {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const capabilities: string[] = [];

  if (record.streamingSupported === true) {
    capabilities.push("streaming");
  }

  if (record.supportsJsonMode === true) {
    capabilities.push("json_mode");
  }

  if (typeof record.maxInputTokens === "number") {
    capabilities.push(`input:${record.maxInputTokens}`);
  }

  if (typeof record.maxOutputTokens === "number") {
    capabilities.push(`output:${record.maxOutputTokens}`);
  }

  return capabilities;
}

function mergeModelCatalogs(
  gatewayModels: ModelCatalogItem[],
  controlPlaneModels: ModelCatalogItem[]
) {
  const modelMap = new Map<string, ModelCatalogItem>();

  for (const model of controlPlaneModels) {
    modelMap.set(getModelKey(model), model);
  }

  for (const model of gatewayModels) {
    const modelKey = getModelKey(model);
    const controlPlaneModel = modelMap.get(modelKey);

    modelMap.set(
      modelKey,
      controlPlaneModel
        ? {
            ...controlPlaneModel,
            ...model,
            adapterType: controlPlaneModel.adapterType,
            apiVersion: controlPlaneModel.apiVersion,
            autoRoutingEligible: controlPlaneModel.autoRoutingEligible,
            capabilities: mergeStringArrays(controlPlaneModel.capabilities, model.capabilities),
            costTier: controlPlaneModel.costTier,
            credentialRequired: controlPlaneModel.credentialRequired,
            credentialState: controlPlaneModel.credentialState,
            fallbackEligible: controlPlaneModel.fallbackEligible,
            fallbackPriority: controlPlaneModel.fallbackPriority,
            requestFormat: controlPlaneModel.requestFormat,
            source: "gateway+control-plane",
            timeoutMs: controlPlaneModel.timeoutMs
          }
        : model
    );
  }

  return Array.from(modelMap.values()).sort((left, right) =>
    `${left.provider ?? left.ownedBy}:${left.id}`.localeCompare(
      `${right.provider ?? right.ownedBy}:${right.id}`
    )
  );
}

function mergeStringArrays(left: string[], right: string[]) {
  return Array.from(new Set([...left, ...right]));
}

function getModelKey(model: ModelCatalogItem) {
  return `${model.provider ?? model.ownedBy}:${model.id}`;
}

function parseGateLMMetadata(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      alias: null,
      allowed: null,
      capabilities: [] as string[],
      provider: null
    };
  }

  const record = value as Record<string, unknown>;

  return {
    alias: typeof record.alias === "string" ? record.alias : null,
    allowed: typeof record.allowed === "boolean" ? record.allowed : null,
    capabilities: Array.isArray(record.capabilities)
      ? record.capabilities.filter((capability): capability is string => typeof capability === "string")
      : [],
    provider: typeof record.provider === "string" ? record.provider : null
  };
}

function parseUnixTimestamp(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }

  try {
    const date = new Date(value * 1000);

    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  } catch {
    return null;
  }
}
