import "server-only";

import { existsSync } from "node:fs";

const DEFAULT_RATE_LIMIT_MAX_ATTEMPTS = 60;
const HARD_RATE_LIMIT_MAX_ATTEMPTS = 60;

export type LiveGatewayConfig = {
  apiKey: string;
  appToken: string;
  baseUrl: string;
  projectId: string;
  rateLimitMaxAttempts: number;
};

export function getLiveGatewayConfig(): LiveGatewayConfig {
  return {
    apiKey: firstEnv("GATELM_DEMO_API_KEY", "GATELM_GATEWAY_API_KEY", "GATEWAY_API_KEY")
      ?? "glm_api_test_redacted",
    appToken:
      firstEnv("GATELM_DEMO_APP_TOKEN", "GATELM_GATEWAY_APP_TOKEN", "GATEWAY_APP_TOKEN")
      ?? "glm_app_token_test_redacted",
    baseUrl: normalizeBaseUrl(
      firstEnv("GATELM_GATEWAY_BASE_URL", "GATEWAY_BASE_URL")
        ?? `http://${defaultGatewayHost()}:${process.env.GATEWAY_PORT ?? "8080"}`
    ),
    projectId:
      firstEnv("GATELM_DEMO_PROJECT_ID", "GATELM_GATEWAY_PROJECT_ID", "GATEWAY_PROJECT_ID")
      ?? "00000000-0000-4000-8000-000000000200",
    rateLimitMaxAttempts: getRateLimitMaxAttempts()
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

function getRateLimitMaxAttempts() {
  const explicitMaxAttempts = parsePositiveInt(process.env.GATELM_WEB_RATE_LIMIT_MAX_ATTEMPTS);

  if (explicitMaxAttempts) {
    return clamp(explicitMaxAttempts, 1, HARD_RATE_LIMIT_MAX_ATTEMPTS);
  }

  return DEFAULT_RATE_LIMIT_MAX_ATTEMPTS;
}

function parsePositiveInt(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}
