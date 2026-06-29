import "server-only";

import type { IncomingHttpHeaders } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
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
        loadError: `Gateway /v1/models failed with HTTP ${response.status}.`,
        meta,
        models: [],
        routeTenantId,
        source: "gateway"
      };
    }

    const payload = parseJson(response.body);
    const models = parseModelList(payload);

    if (!models) {
      return {
        loadError: "Gateway /v1/models response did not match the model catalog contract.",
        meta,
        models: [],
        routeTenantId,
        source: "gateway"
      };
    }

    return {
      loadError: null,
      meta,
      models,
      routeTenantId,
      source: "gateway"
    };
  } catch {
    return {
      loadError: "Gateway unavailable.",
      meta: emptyMeta,
      models: [],
      routeTenantId,
      source: "gateway"
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
    capabilities: gateLM.capabilities,
    createdAt: parseUnixTimestamp(record.created),
    id: record.id,
    object: record.object,
    ownedBy: record.owned_by,
    provider: gateLM.provider
  };
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

  return new Date(value * 1000).toISOString();
}
