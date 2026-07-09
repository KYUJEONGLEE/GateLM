import "server-only";

import credentialLifecycleFixture from "../../../../../docs/v1.0.0/fixtures/credential-lifecycle.fixture.json";
import {
  getControlPlaneBaseUrl,
  getControlPlaneProjectId
} from "@/lib/control-plane/control-plane-config";
import {
  buildControlPlaneHeaders,
  type ControlPlaneRequestOptions
} from "@/lib/control-plane/control-plane-request";
import type {
  ApiKeyIssueValues,
  ApiKeyListItem,
  ApiKeyRevokedResponse,
  ApiKeysModel,
  ApiKeyStatus,
  OneTimeApiKeyResponse
} from "@/lib/control-plane/api-keys-types";

type CredentialLifecycleFixture = {
  credentialLifecycle: {
    apiKey: {
      listItemExample: ApiKeyListItem;
    };
  };
};

type ApiKeyListResult =
  | {
      data: ApiKeyListItem[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type OneTimeApiKeyResult =
  | {
      data: OneTimeApiKeyResponse;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type ApiKeyRevokeResult =
  | {
      data: ApiKeyRevokedResponse;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

export async function getApiKeysModel(routeTenantId: string): Promise<ApiKeysModel> {
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const controlPlaneProjectId = getControlPlaneProjectId();
  const listResult = await listApiKeys(controlPlaneProjectId);

  if (listResult.ok) {
    return {
      apiKeys: listResult.data,
      controlPlaneBaseUrl,
      controlPlaneProjectId,
      loadError: null,
      routeTenantId,
      source: "control-plane"
    };
  }

  return {
    apiKeys: [getFixtureApiKey()],
    controlPlaneBaseUrl,
    controlPlaneProjectId,
    loadError: listResult.error,
    routeTenantId,
    source: "fixture"
  };
}

export async function getProjectApiKeysModel(
  routeTenantId: string,
  projectId: string
): Promise<ApiKeysModel> {
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const listResult = await listApiKeys(projectId);

  if (listResult.ok) {
    return {
      apiKeys: listResult.data,
      controlPlaneBaseUrl,
      controlPlaneProjectId: projectId,
      loadError: null,
      routeTenantId,
      source: "control-plane"
    };
  }

  return {
    apiKeys: [],
    controlPlaneBaseUrl,
    controlPlaneProjectId: projectId,
    loadError: listResult.error,
    routeTenantId,
    source: "fixture"
  };
}

export async function listApiKeysForProject(projectId: string): Promise<ApiKeyListResult> {
  return listApiKeys(projectId);
}

export async function issueApiKey(
  values: ApiKeyIssueValues,
  options?: ControlPlaneRequestOptions
): Promise<OneTimeApiKeyResult> {
  const projectId = values.projectId ?? getControlPlaneProjectId();

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/api-keys`,
      {
        body: JSON.stringify(toIssuePayload(values)),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options, {
          "Content-Type": "application/json"
        }),
        method: "POST"
      }
    );

    return readOneTimeApiKeyResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function rotateApiKey(
  apiKeyId: string,
  options?: ControlPlaneRequestOptions
): Promise<OneTimeApiKeyResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/api-keys/${encodeURIComponent(apiKeyId)}/rotate`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options),
        method: "POST"
      }
    );

    return readOneTimeApiKeyResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function revokeApiKey(
  apiKeyId: string,
  options?: ControlPlaneRequestOptions
): Promise<ApiKeyRevokeResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/api-keys/${encodeURIComponent(apiKeyId)}/revoke`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options),
        method: "POST"
      }
    );

    return readRevokeApiKeyResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

async function listApiKeys(projectId: string): Promise<ApiKeyListResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/projects/${encodeURIComponent(projectId)}/api-keys?limit=50`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders()
      }
    );

    return readApiKeyListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

function toIssuePayload(values: ApiKeyIssueValues) {
  const scopes = values.scopes
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  return {
    displayName: values.displayName.trim(),
    expiresAt: toIsoDateOrNull(values.expiresAt),
    scopes: scopes.length > 0 ? scopes : undefined
  };
}

async function readApiKeyListResponse(response: Response): Promise<ApiKeyListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const apiKeys = getApiKeysFromPayload(payload);

  if (!apiKeys) {
    return {
      error: "Control Plane response did not include API Key list.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: apiKeys,
    ok: true,
    status: response.status
  };
}

async function readOneTimeApiKeyResponse(response: Response): Promise<OneTimeApiKeyResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const apiKey = getOneTimeApiKeyFromPayload(payload);

  if (!apiKey) {
    return {
      error: "Control Plane response did not include one-time API Key data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: apiKey,
    ok: true,
    status: response.status
  };
}

async function readRevokeApiKeyResponse(response: Response): Promise<ApiKeyRevokeResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const revoked = getRevokedApiKeyFromPayload(payload);

  if (!revoked) {
    return {
      error: "Control Plane response did not include revoke data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: revoked,
    ok: true,
    status: response.status
  };
}

function getApiKeysFromPayload(payload: unknown): ApiKeyListItem[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return null;
  }

  const apiKeys = record.data.map(toApiKeyListItem);

  if (apiKeys.some((apiKey) => apiKey === null)) {
    return null;
  }

  return apiKeys as ApiKeyListItem[];
}

function getOneTimeApiKeyFromPayload(payload: unknown): OneTimeApiKeyResponse | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const apiKey = record.data ?? record;

  if (!apiKey || typeof apiKey !== "object") {
    return null;
  }

  return toOneTimeApiKeyResponse(apiKey);
}

function getRevokedApiKeyFromPayload(payload: unknown): ApiKeyRevokedResponse | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const revoked = record.data ?? record;

  if (!revoked || typeof revoked !== "object") {
    return null;
  }

  return toRevokedApiKeyResponse(revoked);
}

function getErrorMessage(payload: unknown, status: number) {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.message ?? record.error;

    if (typeof message === "string") {
      return message;
    }

    if (message && typeof message === "object") {
      const nestedMessage = (message as Record<string, unknown>).message;

      if (typeof nestedMessage === "string" && nestedMessage.trim()) {
        return nestedMessage;
      }
    }
  }

  return `Control Plane request failed with HTTP ${status}.`;
}

function getFixtureApiKey(): ApiKeyListItem {
  const fixture = credentialLifecycleFixture as CredentialLifecycleFixture;
  return fixture.credentialLifecycle.apiKey.listItemExample;
}

function toApiKeyListItem(value: unknown): ApiKeyListItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeApiKeyStatus(record.status);
  const scopes = toStringArray(record.scopes);

  if (
    typeof record.credentialId !== "string" ||
    record.credentialType !== "api_key" ||
    typeof record.displayName !== "string" ||
    typeof record.prefix !== "string" ||
    typeof record.last4 !== "string" ||
    typeof record.createdAt !== "string" ||
    !status ||
    !scopes
  ) {
    return null;
  }

  return {
    createdAt: record.createdAt,
    credentialId: record.credentialId,
    credentialType: "api_key",
    displayName: record.displayName,
    expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : null,
    last4: record.last4,
    lastUsedAt: typeof record.lastUsedAt === "string" ? record.lastUsedAt : null,
    prefix: record.prefix,
    scopes,
    status
  };
}

function toOneTimeApiKeyResponse(value: unknown): OneTimeApiKeyResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeApiKeyStatus(record.status);
  const scopes = toStringArray(record.scopes);

  if (
    typeof record.credentialId !== "string" ||
    record.credentialType !== "api_key" ||
    typeof record.plaintext !== "string" ||
    record.plaintextShownOnce !== true ||
    typeof record.prefix !== "string" ||
    typeof record.last4 !== "string" ||
    typeof record.createdAt !== "string" ||
    !status ||
    !scopes
  ) {
    return null;
  }

  return {
    createdAt: record.createdAt,
    credentialId: record.credentialId,
    credentialType: "api_key",
    expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : null,
    last4: record.last4,
    plaintext: record.plaintext,
    plaintextShownOnce: true,
    prefix: record.prefix,
    scopes,
    status,
    warning:
      typeof record.warning === "string"
        ? record.warning
        : "Store this value now. GateLM will not show it again."
  };
}

function toRevokedApiKeyResponse(value: unknown): ApiKeyRevokedResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (
    typeof record.credentialId !== "string" ||
    record.status !== "revoked" ||
    typeof record.revokedAt !== "string"
  ) {
    return null;
  }

  return {
    credentialId: record.credentialId,
    revokedAt: record.revokedAt,
    status: "revoked"
  };
}

function toStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return null;
  }

  return value;
}

function normalizeApiKeyStatus(value: unknown): ApiKeyStatus | null {
  if (
    value === "active" ||
    value === "revoked" ||
    value === "expired" ||
    value === "disabled"
  ) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.toLowerCase();

    if (
      normalized === "active" ||
      normalized === "revoked" ||
      normalized === "expired" ||
      normalized === "disabled"
    ) {
      return normalized;
    }
  }

  return null;
}

function toIsoDateOrNull(value: string) {
  if (!value.trim()) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}
