import "server-only";

import { existsSync } from "node:fs";

export type LiveGatewayConfig = {
  baseUrl: string;
  projectId: string;
};

export function getGatewayObservabilityHeaders(requestId: string): Record<string, string> {
  const token = firstEnv(
    "GATELM_GATEWAY_OBSERVABILITY_INTERNAL_TOKEN",
    "GATEWAY_OBSERVABILITY_INTERNAL_TOKEN"
  );
  const headers: Record<string, string> = {
    "X-GateLM-Request-Id": requestId
  };

  if (token) {
    headers["X-GateLM-Observability-Token"] = token;
  }

  return headers;
}

export function getLiveGatewayConfig(): LiveGatewayConfig {
  return {
    baseUrl: normalizeBaseUrl(
      firstEnv("GATELM_GATEWAY_BASE_URL", "GATEWAY_BASE_URL")
        ?? `http://${defaultGatewayHost()}:${process.env.GATEWAY_PORT ?? "8080"}`
    ),
    projectId:
      firstEnv("GATELM_DEMO_PROJECT_ID", "GATELM_GATEWAY_PROJECT_ID", "GATEWAY_PROJECT_ID")
      ?? "00000000-0000-4000-8000-000000000200"
  };
}

function firstEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key]?.trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function defaultGatewayHost() {
  return existsSync("/.dockerenv") ? "host.docker.internal" : "localhost";
}
