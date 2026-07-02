export type ApiKeyStatus = "active" | "revoked" | "expired" | "disabled";

export type ApiKeyListItem = {
  createdAt: string;
  credentialId: string;
  credentialType: "api_key";
  displayName: string;
  expiresAt: string | null;
  last4: string;
  lastUsedAt: string | null;
  prefix: string;
  scopes: string[];
  status: ApiKeyStatus;
};

export type OneTimeApiKeyResponse = {
  createdAt: string;
  credentialId: string;
  credentialType: "api_key";
  expiresAt: string | null;
  last4: string;
  plaintext: string;
  plaintextShownOnce: true;
  prefix: string;
  scopes: string[];
  status: ApiKeyStatus;
  warning: string;
};

export type ApiKeyIssueValues = {
  displayName: string;
  expiresAt: string;
  projectId?: string;
  scopes: string;
};

export type ApiKeysModel = {
  apiKeys: ApiKeyListItem[];
  controlPlaneBaseUrl: string;
  controlPlaneProjectId: string;
  loadError: string | null;
  routeTenantId: string;
  source: "control-plane" | "fixture";
};

export type ApiKeyRevokedResponse = {
  credentialId: string;
  revokedAt: string;
  status: "revoked";
};
