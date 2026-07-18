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

export async function getControlPlaneTenantName(
  routeTenantId: string,
  options?: ControlPlaneRequestOptions
): Promise<string | null> {
  const tenantId = resolveControlPlaneTenantId(routeTenantId);
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

  const data = record.data.map((value) => {
    if (!value || typeof value !== "object") {
      return null;
    }

    const tenant = value as Record<string, unknown>;
    const id = typeof tenant.id === "string" ? tenant.id.trim() : "";
    const name = typeof tenant.name === "string" ? tenant.name.trim() : "";

    return id && name ? { id, name } : null;
  });

  if (data.some((tenant) => tenant === null)) {
    return null;
  }

  const pagination =
    record.pagination && typeof record.pagination === "object"
      ? record.pagination as Record<string, unknown>
      : null;
  const nextCursor =
    typeof pagination?.nextCursor === "string" && pagination.nextCursor.trim()
      ? pagination.nextCursor.trim()
      : null;

  return {
    data: data as TenantListPage["data"],
    nextCursor
  };
}
