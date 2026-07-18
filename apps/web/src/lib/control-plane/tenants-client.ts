import "server-only";

import {
  getControlPlaneBaseUrl,
  resolveControlPlaneTenantId
} from "@/lib/control-plane/control-plane-config";
import {
  buildControlPlaneHeaders,
  type ControlPlaneRequestOptions
} from "@/lib/control-plane/control-plane-request";

type TenantListPage = {
  data: Array<{
    id: string;
    name: string;
  }>;
  nextCursor: string | null;
};

type TenantNameCacheEntry = {
  expiresAt: number;
  name: string;
};

const TENANT_NAME_CACHE_TTL_MS = 5 * 60 * 1000;
const TENANT_NAME_CACHE_MAX_ENTRIES = 256;
const tenantNameCache = new Map<string, TenantNameCacheEntry>();
const tenantNameLoads = new Map<string, Promise<string | null>>();

export async function getControlPlaneTenantName(
  routeTenantId: string,
  options?: ControlPlaneRequestOptions
): Promise<string | null> {
  const tenantId = resolveControlPlaneTenantId(routeTenantId);
  const cachedName = readCachedTenantName(tenantId);

  if (cachedName) {
    return cachedName;
  }

  const pendingLoad = tenantNameLoads.get(tenantId);

  if (pendingLoad) {
    return pendingLoad;
  }

  const load = loadControlPlaneTenantName(tenantId, options)
    .then((name) => {
      if (name) {
        cacheTenantName(tenantId, name);
      }

      return name;
    })
    .finally(() => {
      tenantNameLoads.delete(tenantId);
    });

  tenantNameLoads.set(tenantId, load);
  return load;
}

async function loadControlPlaneTenantName(
  tenantId: string,
  options?: ControlPlaneRequestOptions
): Promise<string | null> {
  const visitedCursors = new Set<string>();
  let cursor: string | null = null;

  try {
    do {
      const query = new URLSearchParams({ limit: "100" });

      if (cursor) {
        query.set("cursor", cursor);
      }

      const response = await fetch(`${getControlPlaneBaseUrl()}/admin/v1/tenants?${query}`, {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options)
      });

      if (!response.ok) {
        return null;
      }

      const page = readTenantListPage(await response.json().catch(() => null));

      if (!page) {
        return null;
      }

      const tenant = page.data.find((candidate) => candidate.id === tenantId);

      if (tenant) {
        return tenant.name;
      }

      cursor = page.nextCursor;

      if (cursor && visitedCursors.has(cursor)) {
        return null;
      }

      if (cursor) {
        visitedCursors.add(cursor);
      }
    } while (cursor);
  } catch {
    return null;
  }

  return null;
}

function readTenantListPage(payload: unknown): TenantListPage | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return null;
  }

  const data = record.data
    .map((value) => {
      if (!value || typeof value !== "object") {
        return null;
      }

      const tenant = value as Record<string, unknown>;
      const id = typeof tenant.id === "string" ? tenant.id.trim() : "";
      const name = typeof tenant.name === "string" ? tenant.name.trim() : "";

      return id && name ? { id, name } : null;
    })
    .filter((tenant): tenant is { id: string; name: string } => tenant !== null);

  const pagination =
    record.pagination && typeof record.pagination === "object"
      ? record.pagination as Record<string, unknown>
      : null;
  const nextCursor =
    typeof pagination?.nextCursor === "string" && pagination.nextCursor.trim()
      ? pagination.nextCursor.trim()
      : null;

  return {
    data,
    nextCursor
  };
}

function readCachedTenantName(tenantId: string) {
  const entry = tenantNameCache.get(tenantId);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= Date.now()) {
    tenantNameCache.delete(tenantId);
    return null;
  }

  return entry.name;
}

function cacheTenantName(tenantId: string, name: string) {
  tenantNameCache.delete(tenantId);
  tenantNameCache.set(tenantId, {
    expiresAt: Date.now() + TENANT_NAME_CACHE_TTL_MS,
    name
  });

  while (tenantNameCache.size > TENANT_NAME_CACHE_MAX_ENTRIES) {
    const oldestTenantId = tenantNameCache.keys().next().value;

    if (oldestTenantId === undefined) {
      break;
    }

    tenantNameCache.delete(oldestTenantId);
  }
}
