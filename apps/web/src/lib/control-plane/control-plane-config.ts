import "server-only";

import { existsSync } from "node:fs";

const DEFAULT_CONTROL_PLANE_PORT = "3001";

export const DEFAULT_CONTROL_PLANE_TENANT_ID = "00000000-0000-4000-8000-000000000100";
export const DEFAULT_CONTROL_PLANE_PROJECT_ID = "00000000-0000-4000-8000-000000000200";
export const DEFAULT_CONTROL_PLANE_APPLICATION_ID = "00000000-0000-4000-8000-000000000300";

export function getControlPlaneBaseUrl() {
  return normalizeBaseUrl(
    firstEnv("GATELM_CONTROL_PLANE_BASE_URL", "CONTROL_PLANE_BASE_URL")
      ?? `http://${defaultControlPlaneHost()}:${process.env.GATELM_CONTROL_PLANE_PORT ?? DEFAULT_CONTROL_PLANE_PORT}`
  );
}

export function getControlPlaneTenantId() {
  return (
    firstEnv("GATELM_CONTROL_PLANE_TENANT_ID", "GATELM_DEMO_TENANT_ID")
    ?? DEFAULT_CONTROL_PLANE_TENANT_ID
  );
}

export function resolveControlPlaneTenantId(routeTenantId?: string | null) {
  return routeTenantId && isUuid(routeTenantId)
    ? routeTenantId
    : getControlPlaneTenantId();
}

export function getControlPlaneProjectId() {
  return (
    firstEnv("GATELM_CONTROL_PLANE_PROJECT_ID", "GATELM_DEMO_PROJECT_ID")
    ?? DEFAULT_CONTROL_PLANE_PROJECT_ID
  );
}

export function getControlPlaneApplicationId() {
  return (
    firstEnv("GATELM_CONTROL_PLANE_APPLICATION_ID", "GATELM_DEMO_APPLICATION_ID")
    ?? DEFAULT_CONTROL_PLANE_APPLICATION_ID
  );
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

function defaultControlPlaneHost() {
  return existsSync("/.dockerenv") ? "host.docker.internal" : "localhost";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value);
}
