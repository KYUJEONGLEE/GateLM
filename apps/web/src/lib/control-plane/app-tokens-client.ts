import "server-only";

import credentialLifecycleFixture from "../../../../../docs/v1.0.0/fixtures/credential-lifecycle.fixture.json";
import {
  getControlPlaneApplicationId,
  getControlPlaneBaseUrl
} from "@/lib/control-plane/control-plane-config";
import {
  buildControlPlaneHeaders,
  type ControlPlaneRequestOptions
} from "@/lib/control-plane/control-plane-request";
import type {
  AppTokenIssueValues,
  AppTokenListItem,
  AppTokenRevokedResponse,
  AppTokensModel,
  AppTokenStatus,
  OneTimeAppTokenResponse
} from "@/lib/control-plane/app-tokens-types";

type CredentialLifecycleFixture = {
  credentialLifecycle: {
    appToken: {
      listItemExample: AppTokenListItem;
    };
  };
};

type AppTokenListResult =
  | {
      data: AppTokenListItem[];
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type OneTimeAppTokenResult =
  | {
      data: OneTimeAppTokenResponse;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

type AppTokenRevokeResult =
  | {
      data: AppTokenRevokedResponse;
      ok: true;
      status: number;
    }
  | {
      error: string;
      ok: false;
      status: number;
    };

export async function getAppTokensModel(routeTenantId: string): Promise<AppTokensModel> {
  const controlPlaneApplicationId = getControlPlaneApplicationId();
  const controlPlaneBaseUrl = getControlPlaneBaseUrl();
  const listResult = await listAppTokensForApplication(controlPlaneApplicationId);

  if (listResult.ok) {
    return {
      appTokens: listResult.data,
      controlPlaneApplicationId,
      controlPlaneBaseUrl,
      loadError: null,
      routeTenantId,
      source: "control-plane"
    };
  }

  return {
    appTokens: [getFixtureAppToken()],
    controlPlaneApplicationId,
    controlPlaneBaseUrl,
    loadError: listResult.error,
    routeTenantId,
    source: "fixture"
  };
}

export async function issueAppToken(
  values: AppTokenIssueValues,
  options?: ControlPlaneRequestOptions
): Promise<OneTimeAppTokenResult> {
  const applicationId = values.applicationId ?? getControlPlaneApplicationId();

  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(applicationId)}/app-tokens`,
      {
        body: JSON.stringify(toIssuePayload(values)),
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options, {
          "Content-Type": "application/json"
        }),
        method: "POST"
      }
    );

    return readOneTimeAppTokenResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function rotateAppToken(
  appTokenId: string,
  options?: ControlPlaneRequestOptions
): Promise<OneTimeAppTokenResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/app-tokens/${encodeURIComponent(appTokenId)}/rotate`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options),
        method: "POST"
      }
    );

    return readOneTimeAppTokenResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function revokeAppToken(
  appTokenId: string,
  options?: ControlPlaneRequestOptions
): Promise<AppTokenRevokeResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/app-tokens/${encodeURIComponent(appTokenId)}/revoke`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders(options),
        method: "POST"
      }
    );

    return readRevokeAppTokenResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

export async function listAppTokensForApplication(
  applicationId: string
): Promise<AppTokenListResult> {
  try {
    const response = await fetch(
      `${getControlPlaneBaseUrl()}/admin/v1/applications/${encodeURIComponent(applicationId)}/app-tokens?limit=50`,
      {
        cache: "no-store",
        headers: await buildControlPlaneHeaders()
      }
    );

    return readAppTokenListResponse(response);
  } catch {
    return {
      error: "Control Plane unavailable.",
      ok: false,
      status: 0
    };
  }
}

function toIssuePayload(values: AppTokenIssueValues) {
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

async function readAppTokenListResponse(response: Response): Promise<AppTokenListResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const appTokens = getAppTokensFromPayload(payload);

  if (!appTokens) {
    return {
      error: "Control Plane response did not include App Token list.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: appTokens,
    ok: true,
    status: response.status
  };
}

async function readOneTimeAppTokenResponse(response: Response): Promise<OneTimeAppTokenResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const appToken = getOneTimeAppTokenFromPayload(payload);

  if (!appToken) {
    return {
      error: "Control Plane response did not include one-time App Token data.",
      ok: false,
      status: response.status
    };
  }

  return {
    data: appToken,
    ok: true,
    status: response.status
  };
}

async function readRevokeAppTokenResponse(response: Response): Promise<AppTokenRevokeResult> {
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return {
      error: getErrorMessage(payload, response.status),
      ok: false,
      status: response.status
    };
  }

  const revoked = getRevokedAppTokenFromPayload(payload);

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

function getAppTokensFromPayload(payload: unknown): AppTokenListItem[] | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;

  if (!Array.isArray(record.data)) {
    return null;
  }

  const appTokens = record.data.map(toAppTokenListItem);

  if (appTokens.some((appToken) => appToken === null)) {
    return null;
  }

  return appTokens as AppTokenListItem[];
}

function getOneTimeAppTokenFromPayload(payload: unknown): OneTimeAppTokenResponse | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const appToken = record.data ?? record;

  if (!appToken || typeof appToken !== "object") {
    return null;
  }

  return toOneTimeAppTokenResponse(appToken);
}

function getRevokedAppTokenFromPayload(payload: unknown): AppTokenRevokedResponse | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const revoked = record.data ?? record;

  if (!revoked || typeof revoked !== "object") {
    return null;
  }

  return toRevokedAppTokenResponse(revoked);
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

function getFixtureAppToken(): AppTokenListItem {
  const fixture = credentialLifecycleFixture as CredentialLifecycleFixture;
  return fixture.credentialLifecycle.appToken.listItemExample;
}

function toAppTokenListItem(value: unknown): AppTokenListItem | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeAppTokenStatus(record.status);
  const scopes = toStringArray(record.scopes);

  if (
    typeof record.credentialId !== "string" ||
    record.credentialType !== "app_token" ||
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
    credentialType: "app_token",
    displayName: record.displayName,
    expiresAt: typeof record.expiresAt === "string" ? record.expiresAt : null,
    last4: record.last4,
    lastUsedAt: typeof record.lastUsedAt === "string" ? record.lastUsedAt : null,
    prefix: record.prefix,
    scopes,
    status
  };
}

function toOneTimeAppTokenResponse(value: unknown): OneTimeAppTokenResponse | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  const status = normalizeAppTokenStatus(record.status);
  const scopes = toStringArray(record.scopes);

  if (
    typeof record.credentialId !== "string" ||
    record.credentialType !== "app_token" ||
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
    credentialType: "app_token",
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

function toRevokedAppTokenResponse(value: unknown): AppTokenRevokedResponse | null {
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

function normalizeAppTokenStatus(value: unknown): AppTokenStatus | null {
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
