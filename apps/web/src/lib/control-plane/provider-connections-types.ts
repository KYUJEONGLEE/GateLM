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
  projectId: string | null;
  provider: string;
  providerConfig: Record<string, unknown> | null;
  resolver: string;
  status: ProviderConnectionStatus;
  tenantId: string;
  timeoutMs: number;
  updatedAt: string;
};

export type ProviderPresetRecord = {
  adapterType: string;
  baseUrl: string;
  credentialRequired: boolean;
  defaultResolver: string;
  defaultTimeoutMs: number;
  displayName: string;
  modelsEndpointPath: string;
  providerConfig: Record<string, unknown> | null;
  providerKey: string;
};

export type ProviderDiscoveredModel = {
  createdAt: string | null;
  displayName: string;
  modelName: string;
  object: string;
  ownedBy: string | null;
  provider: string;
  providerId: string;
};

export type ProviderModelDiscovery = {
  adapterType: string;
  baseUrl: string;
  credentialRequired: boolean;
  discoveredAt: string;
  modelCount: number;
  models: ProviderDiscoveredModel[];
  provider: string;
  providerId: string;
};

export type ProviderConnectionFormValues = {
  adapterType: string;
  apiVersion: string;
  baseUrl: string;
  credentialRequired: boolean;
  credentialValue?: string;
  credentialLast4: string;
  credentialPrefix: string;
  displayName: string;
  failureMode: "fail_closed" | "fail_open_to_fallback";
  isEdit?: boolean;
  models: string;
  modelsEndpointPath: string;
  provider: string;
  requestFormat:
    | "openai_chat_completions"
    | "anthropic_messages"
    | "mock_chat_completions";
  resolver: string;
  secretRef: string;
  status: ProviderConnectionStatus;
  timeoutMs: number;
};

export type ProviderConnectionsModel = {
  controlPlaneBaseUrl: string;
  controlPlaneProjectId: string;
  loadError: string | null;
  providerPresets: {
    items: ProviderPresetRecord[];
    loadError: string | null;
    source: "control-plane" | "fallback";
  };
  providers: ProviderConnectionRecord[];
  routeTenantId: string;
  source: "control-plane" | "fixture";
};
