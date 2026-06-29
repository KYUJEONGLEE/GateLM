export type AppTokenStatus = "active" | "revoked" | "expired" | "disabled";

export type AppTokenListItem = {
  createdAt: string;
  credentialId: string;
  credentialType: "app_token";
  displayName: string;
  expiresAt: string | null;
  last4: string;
  lastUsedAt: string | null;
  prefix: string;
  scopes: string[];
  status: AppTokenStatus;
};

export type OneTimeAppTokenResponse = {
  createdAt: string;
  credentialId: string;
  credentialType: "app_token";
  expiresAt: string | null;
  last4: string;
  plaintext: string;
  plaintextShownOnce: true;
  prefix: string;
  scopes: string[];
  status: AppTokenStatus;
  warning: string;
};

export type AppTokenIssueValues = {
  applicationId?: string;
  displayName: string;
  expiresAt: string;
  scopes: string;
};

export type AppTokensModel = {
  appTokens: AppTokenListItem[];
  controlPlaneApplicationId: string;
  controlPlaneBaseUrl: string;
  loadError: string | null;
  routeTenantId: string;
  source: "control-plane" | "fixture";
};

export type AppTokenRevokedResponse = {
  credentialId: string;
  revokedAt: string;
  status: "revoked";
};
