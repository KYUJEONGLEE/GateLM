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
  activationStatus: "available";
  modelRef: string;
  modelKey: string;
  pricingStatus: "available" | "unavailable";
  pricing: TenantChatAdminModelPricing | null;
};

export type TenantChatRoutingMode = "auto" | "manual";
export type TenantChatRoutingCategory =
  | "general"
  | "code"
  | "translation"
  | "summarization"
  | "reasoning";
export type TenantChatRoutingDifficulty = "simple" | "complex";
export type TenantChatRoutingCell = { modelRefs: string[] };
export type TenantChatRoutingMatrix = Record<
  TenantChatRoutingCategory,
  Record<TenantChatRoutingDifficulty, TenantChatRoutingCell>
>;

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
  manualModelRef: string;
  routes: TenantChatRoutingMatrix;
  routingMode: TenantChatRoutingMode;
};

export type TenantChatAdminRuntimeSetup = {
  activeSnapshot: TenantChatAdminActiveSnapshot | null;
  providers: TenantChatAdminProviderCandidate[];
  readiness: TenantChatAdminReadiness;
};

export type TenantChatRuntimeActivationValues = {
  manualModelRef: string;
  routes: TenantChatRoutingMatrix;
  routingMode: TenantChatRoutingMode;
};
