import "server-only";

import {
  getControlPlaneBaseUrl,
  getControlPlaneTenantId
} from "@/lib/control-plane/control-plane-config";
import type {
  TenantCreateValues,
  TenantRecord,
  TenantsModel
} from "@/lib/control-plane/tenants-types";
import { formatTenantDisplayName } from "@/lib/formatting/display-identifiers";

type TenantRequestResult =
  | {
      data: TenantRecord;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type TenantListResult =
  | {
      data: TenantRecord[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

export async function getTenantsModel(routeTenantId: string): Promise<TenantsModel> {
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const controlPlaneTenantId = getControlPlaneTenantId();
  const listResult = await listTenants();

  if (listResult.ok) {
    return {
      controlPlaneBaseUrl,
      controlPlaneTenantId,
      loadError: null,
      routeTenantId,
      source: "control-plane",
      tenants: listResult.data
    };
  }

  return {
    controlPlaneBaseUrl,
    controlPlaneTenantId,
    loadError: listResult.error,
    routeTenantId,
    source: "fixture",
    tenants: [getFixtureTenant(routeTenantId)]
  };
}

export async function createTenant(values: TenantCreateValues): Promise<TenantRequestResult> {
  try {
    const response = await fetch(`${getControlPlaneBaseUrl()}/admin/v1/tenants`, {
      body: JSON.stringify({
        name: values.name.trim()
      }),
      cache: "no-store",
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });

    return readTenantResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function listTenants(): Promise<TenantListResult> {
  try {
    const response = await fetch(`${getControlPlaneBaseUrl()}/admin/v1/tenants?limit=100`, {
      cache: "no-store"
    });

    return readTenantListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function readTenantResponse(response: Response): Promise<TenantRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const tenant = getTenantFromPayload(payload);

  if (!tenant) {
    return {
      error: "Control Plane response did not include tenant data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: tenant,
    ok: true,
    status: response.status
  };
}

async function readTenantListResponse(response: Response): Promise<TenantListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const tenants = getTenantsFromPayload(payload);

  if (!tenants) {
    return {
      error: "Control Plane response did not include tenant list.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: tenants,
    ok: true,
    status: response.status
  };
}

function getTenantFromPayload(payload: unknown): TenantRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const tenant = record.data ?? record;

  return toTenantRecord(tenant);
}

function getTenantsFromPayload(payload: unknown): TenantRecord[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return null;
  }

  const tenants = record.data.map(toTenantRecord);

  if (tenants.some((tenant) => tenant === null)) {
    return null;
  }

  return tenants as TenantRecord[];
}

function toTenantRecord(value: unknown): TenantRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeTenantStatus(record.status);

  if (
    typeof record.id !== "string" ||
    typeof record.name !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    !status
  ) {
    return null;
  }

  return {
    createdAt: record.createdAt,
    id: record.id,
    name: record.name,
    status,
    updatedAt: record.updatedAt
  };
}

function normalizeTenantStatus(value: unknown): TenantRecord["status"] | null {
  if (value === "ACTIVE" || value === "active") {
    return "ACTIVE";
  }

  if (value === "ARCHIVED" || value === "archived") {
    return "ARCHIVED";
  }

  if (value === "DISABLED" || value === "disabled") {
    return "DISABLED";
  }

  return null;
}

function getFixtureTenant(routeTenantId: string): TenantRecord {
  const now = new Date().toISOString();

  return {
    createdAt: now,
    id: routeTenantId,
    name: formatTenantDisplayName(routeTenantId),
    status: "ACTIVE",
    updatedAt: now
  };
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
