import "server-only";

import type { IncomingHttpHeaders } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { getLiveGatewayConfig } from "@/lib/gateway/live-gateway-config";
import type {
  GatewayDependencyStatus,
  GatewayEndpointStatus,
  GatewayHealthModel
} from "@/lib/gateway/health-types";

type GatewayHealthHttpResponse = {
  body: string;
  headers: IncomingHttpHeaders;
  status: number;
};

type ParsedHealthPayload = {
  dependencies?: unknown;
  service?: unknown;
  status?: unknown;
  time?: unknown;
};

export async function getGatewayHealthModel(routeTenantId: string): Promise<GatewayHealthModel> {
  const checkedAt = new Date().toISOString();
  const gatewayConfig = getLiveGatewayConfig();
  const [healthz, readyz] = await Promise.all([
    getGatewayHealthEndpoint(gatewayConfig.baseUrl, "/healthz", checkedAt),
    getGatewayHealthEndpoint(gatewayConfig.baseUrl, "/readyz", checkedAt)
  ]);
  const dependencies = readyz.dependencies;
  const failingDependencyCount = dependencies.filter((dependency) => dependency.status !== "ok").length;

  return {
    checkedAt,
    healthz,
    readyz,
    routeTenantId,
    summary: {
      dependencyCount: dependencies.length,
      failingDependencyCount,
      isAlive: healthz.httpStatus === 200 && healthz.status === "ok",
      isReady: readyz.httpStatus === 200 && readyz.status === "ready" && failingDependencyCount === 0,
      requiredDependencyCount: dependencies.filter((dependency) => dependency.required).length
    }
  };
}

async function getGatewayHealthEndpoint(
  baseUrl: string,
  path: "/healthz" | "/readyz",
  checkedAt: string
): Promise<GatewayHealthModel["readyz"]> {
  try {
    const response = await requestGatewayHealth(baseUrl, path);
    const payload = parseJson(response.body);
    const status = parseEndpointStatus(payload.status);

    return {
      checkedAt,
      dependencies: path === "/readyz" ? parseDependencies(payload.dependencies) : [],
      httpStatus: response.status,
      loadError:
        response.status >= 200 && response.status < 300
          ? null
          : `Gateway ${path} failed with HTTP ${response.status}.`,
      service: typeof payload.service === "string" ? payload.service : null,
      status,
      time: typeof payload.time === "string" ? payload.time : null
    };
  } catch {
    return {
      checkedAt,
      dependencies: [],
      httpStatus: null,
      loadError: "Gateway unavailable.",
      service: null,
      status: "error",
      time: null
    };
  }
}

function requestGatewayHealth(
  baseUrl: string,
  path: "/healthz" | "/readyz"
): Promise<GatewayHealthHttpResponse> {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(path, `${baseUrl.replace(/\/+$/, "")}/`);
    const transport = endpoint.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(endpoint, { method: "GET" }, (response) => {
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
    });

    request.setTimeout(5000, () => {
      request.destroy(new Error(`Gateway ${path} request timed out.`));
    });
    request.on("error", reject);
    request.end();
  });
}

function parseJson(value: string): ParsedHealthPayload {
  try {
    return JSON.parse(value) as ParsedHealthPayload;
  } catch {
    return {};
  }
}

function parseEndpointStatus(value: unknown): GatewayEndpointStatus {
  if (value === "ok" || value === "ready") {
    return value;
  }

  if (value === "error" || value === "not_ready") {
    return "error";
  }

  return "unknown";
}

function parseDependencies(value: unknown): GatewayDependencyStatus[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value as Record<string, unknown>)
    .map(([name, dependency]) => parseDependency(name, dependency))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseDependency(name: string, value: unknown): GatewayDependencyStatus {
  if (typeof value === "string") {
    return {
      message: null,
      name,
      required: null,
      status: value
    };
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;

    return {
      message: typeof record.message === "string" ? record.message : null,
      name,
      required: typeof record.required === "boolean" ? record.required : null,
      status: typeof record.status === "string" ? record.status : "unknown"
    };
  }

  return {
    message: null,
    name,
    required: null,
    status: "unknown"
  };
}
