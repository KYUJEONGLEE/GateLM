export type TenantChatAdminReadiness =
  | "needs_provider"
  | "needs_model"
  | "needs_activation"
  | "ready"
  | "degraded";

export type TenantChatAdminModelPricing = {
  cacheReadInputMicroUsdPerMillionTokens?: number;
  inputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number;
};

export type TenantChatAdminModelCandidate = {
  activationStatus: "available" | "pricing_unavailable";
  modelKey: string;
  pricing: TenantChatAdminModelPricing | null;
};

export type TenantChatAdminProviderCandidate = {
  displayName: string;
  models: TenantChatAdminModelCandidate[];
  providerConnectionId: string;
  providerFamily: string;
  providerKey: string;
};

export type TenantChatAdminActiveSnapshot = {
  digest: string;
  modelKey: string;
  policyVersion: number;
  pricingStatus: "current" | "update_available" | "unavailable";
  pricingVersion: number;
  providerConnectionId: string;
  publishedAt: string;
  snapshotId: string;
  version: number;
};

export type TenantChatAdminRuntimeSetup = {
  activeSnapshot: TenantChatAdminActiveSnapshot | null;
  providers: TenantChatAdminProviderCandidate[];
  readiness: TenantChatAdminReadiness;
};

export type TenantChatRuntimeActivationValues = {
  modelKey: string;
  providerConnectionId: string;
};
