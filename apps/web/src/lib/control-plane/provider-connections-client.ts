import "server-only";

import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";
import {
  getControlPlaneBaseUrl,
  getControlPlaneProjectId
} from "@/lib/control-plane/control-plane-config";
import type {
  ProviderConnectionFormValues,
  ProviderConnectionRecord,
  ProviderConnectionsModel
} from "@/lib/control-plane/provider-connections-types";

type RuntimeConfigFixture = {
  runtimeConfig: {
    generatedAt: string;
    projectId: string;
    tenantId: string;
    providers: Array<{
      baseUrl: string;
      credentialPreview: {
        last4: string | null;
        prefix: string | null;
      } | null;
      displayName: string;
      provider: string;
      providerId: string;
      resolver: string;
      status: string;
      timeoutMs: number;
    }>;
  };
};

type ProviderRequestResult =
  | {
      data: ProviderConnectionRecord;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ProviderListResult =
  | {
      data: ProviderConnectionRecord[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

export async function getProviderConnectionsModel(
  routeTenantId: string
): Promise<ProviderConnectionsModel> {
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const controlPlaneProjectId = getControlPlaneProjectId();
  const listResult = await listProviders(controlPlaneProjectId);

  if (listResult.ok) {
    return {
      controlPlaneBaseUrl,
      controlPlaneProjectId,
      loadError: null,
      providers: listResult.data,
      routeTenantId,
      source: "control-plane"
    };
  }

  return {
    controlPlaneBaseUrl,
    controlPlaneProjectId,
    loadError: listResult.error,
    providers: getFixtureProviders(),
    routeTenantId,
    source: "fixture"
  };
}

export async function upsertProviderConnection(
  values: ProviderConnectionFormValues
): Promise<ProviderRequestResult> {
  const projectId = getControlPlaneProjectId();

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/providers`,
      {
        body: JSON.stringify(toProviderPayload(values)),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      }
    );

    return readProviderResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function listProviders(projectId: string): Promise<ProviderListResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/providers?limit=50`,
      {
        cache: "no-store"
      }
    );

    return readProviderListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

function toProviderPayload(values: ProviderConnectionFormValues) {
  return {
    baseUrl: values.baseUrl.trim(),
    credentialLast4: values.credentialLast4.trim() || undefined,
    credentialPrefix: values.credentialPrefix.trim() || undefined,
    displayName: values.displayName.trim(),
    provider: values.provider.trim(),
    resolver: values.resolver.trim() || undefined,
    secretRef: values.secretRef.trim() || undefined,
    status: values.status,
    timeoutMs: values.timeoutMs
  };
}

async function readProviderResponse(response: Response): Promise<ProviderRequestResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const provider = getProviderFromPayload(payload);

  if (!provider) {
    return {
      error: "Control Plane response did not include provider data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: provider,
    ok: true,
    status: response.status
  };
}

async function readProviderListResponse(response: Response): Promise<ProviderListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const providers = getProvidersFromPayload(payload);

  if (!providers) {
    return {
      error: "Control Plane response did not include provider list.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: providers,
    ok: true,
    status: response.status
  };
}

function getProviderFromPayload(payload: unknown): ProviderConnectionRecord | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const provider = record.data ?? record;

  if (!provider || typeof provider !== "object") {
    return null;
  }

  return toProviderRecord(provider);
}

function getProvidersFromPayload(payload: unknown): ProviderConnectionRecord[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return null;
  }

  const providers = record.data.map(toProviderRecord);

  if (providers.some((provider) => provider === null)) {
    return null;
  }

  return providers as ProviderConnectionRecord[];
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

function getFixtureProviders(): ProviderConnectionRecord[] {
  const runtimeConfig = (runtimeConfigFixture as RuntimeConfigFixture).runtimeConfig;
  const timestamp = runtimeConfig.generatedAt;

  return runtimeConfig.providers.map((provider) => ({
    baseUrl: provider.baseUrl,
    createdAt: timestamp,
    credentialPreview: provider.credentialPreview ?? {
      last4: null,
      prefix: null
    },
    displayName: provider.displayName,
    id: provider.providerId,
    projectId: runtimeConfig.projectId,
    provider: provider.provider,
    providerConfig: null,
    resolver: provider.resolver,
    status: normalizeProviderStatus(provider.status) ?? "DISABLED",
    tenantId: runtimeConfig.tenantId,
    timeoutMs: provider.timeoutMs,
    updatedAt: timestamp
  }));
}

function toProviderRecord(value: unknown): ProviderConnectionRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeProviderStatus(record.status);

  if (
    typeof record.id !== "string" ||
    typeof record.tenantId !== "string" ||
    typeof record.projectId !== "string" ||
    typeof record.provider !== "string" ||
    typeof record.displayName !== "string" ||
    typeof record.baseUrl !== "string" ||
    typeof record.timeoutMs !== "number" ||
    typeof record.resolver !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string" ||
    !status
  ) {
    return null;
  }

  return {
    baseUrl: record.baseUrl,
    createdAt: record.createdAt,
    credentialPreview: toCredentialPreview(record.credentialPreview),
    displayName: record.displayName,
    id: record.id,
    projectId: record.projectId,
    provider: record.provider,
    providerConfig: toRecordOrNull(record.providerConfig),
    resolver: record.resolver,
    status,
    tenantId: record.tenantId,
    timeoutMs: record.timeoutMs,
    updatedAt: record.updatedAt
  };
}

function toCredentialPreview(value: unknown) {
  if (!value || typeof value !== "object") {
    return {
      last4: null,
      prefix: null
    };
  }

  const record = value as Record<string, unknown>;

  return {
    last4: typeof record.last4 === "string" ? record.last4 : null,
    prefix: typeof record.prefix === "string" ? record.prefix : null
  };
}

function toRecordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeProviderStatus(value: unknown): ProviderConnectionRecord["status"] | null {
  if (value === "ACTIVE" || value === "active") {
    return "ACTIVE";
  }

  if (value === "DEGRADED" || value === "degraded") {
    return "DEGRADED";
  }

  if (value === "DISABLED" || value === "disabled") {
    return "DISABLED";
  }

  return null;
}
