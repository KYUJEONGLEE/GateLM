export type ProviderConnectionStatus = "ACTIVE" | "DEGRADED" | "DISABLED";

export type ProviderCredentialPreview = {
  last4: string | null;
  prefix: string | null;
};

export type ProviderConnectionRecord = {
  baseUrl: string;
  createdAt: string;
  credentialPreview: ProviderCredentialPreview;
  displayName: string;
  id: string;
  projectId: string;
  provider: string;
  providerConfig: Record<string, unknown> | null;
  resolver: string;
  status: ProviderConnectionStatus;
  tenantId: string;
  timeoutMs: number;
  updatedAt: string;
};

export type ProviderConnectionFormValues = {
  adapterType: string;
  apiVersion: string;
  baseUrl: string;
  credentialRequired: boolean;
  credentialLast4: string;
  credentialPrefix: string;
  displayName: string;
  failureMode: "fail_closed" | "fail_open_to_fallback";
  models: string;
  provider: string;
  requestFormat: "openai_chat_completions" | "mock_chat_completions";
  resolver: string;
  secretRef: string;
  status: ProviderConnectionStatus;
  timeoutMs: number;
};

export type ProviderConnectionsModel = {
  controlPlaneBaseUrl: string;
  controlPlaneProjectId: string;
  loadError: string | null;
  providers: ProviderConnectionRecord[];
  routeTenantId: string;
  source: "control-plane" | "fixture";
};
