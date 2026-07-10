import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";

export const CONTROL_PLANE_READ_CACHE_SECONDS = {
  employees: 30,
  projects: 15,
  providerConnections: 15,
  providerPresets: 300,
  runtimePolicy: 15
} as const;

export const controlPlaneReadCacheTags = {
  employees: "control-plane:employees",
  projects: "control-plane:projects",
  providerConnections: "control-plane:provider-connections",
  providerPresets: "control-plane:provider-presets",
  runtimePolicy: "control-plane:runtime-policy"
} as const;

export async function cachedControlPlaneRead<T>(
  keyParts: string[],
  loader: () => Promise<T>,
  options: {
    revalidate: number;
    tags: string[];
  }
): Promise<T> {
  return unstable_cache(loader, keyParts, {
    revalidate: options.revalidate,
    tags: options.tags
  })();
}

export function controlPlaneTenantReadCacheTag(
  kind: "employees" | "projects" | "providerConnections",
  tenantId: string
) {
  return `${controlPlaneReadCacheTags[kind]}:${tenantId}`;
}

export function runtimePolicyApplicationReadCacheTag(applicationId: string) {
  return `${controlPlaneReadCacheTags.runtimePolicy}:${applicationId}`;
}

export function revalidateControlPlaneRead(tags: string[]) {
  for (const tag of new Set(tags)) {
    revalidateTag(tag);
  }
}
