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
export type TenantChatSafetyDetectorType =
  | "email"
  | "phone_number"
  | "postal_address"
  | "person_name"
  | "organization_name"
  | "resident_registration_number"
  | "api_key"
  | "authorization_header"
  | "jwt"
  | "private_key";
export type TenantChatSafetyDetector = {
  action: "allow" | "redact" | "block";
  detectorType: TenantChatSafetyDetectorType;
};
export type TenantChatAdminCachePolicy = {
  enabled: boolean;
  maxEntriesPerUser: number;
  ttlSeconds: number;
};
export type TenantChatAdminSafetyPolicy = {
  detectorSet: TenantChatSafetyDetector[];
};
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
  cachePolicy: TenantChatAdminCachePolicy;
  safetyPolicy: TenantChatAdminSafetyPolicy;
};

export type TenantChatAdminRuntimeSetup = {
  activeSnapshot: TenantChatAdminActiveSnapshot | null;
  providers: TenantChatAdminProviderCandidate[];
  readiness: TenantChatAdminReadiness;
};

export type TenantChatRuntimeActivationValues = {
  cachePolicy: TenantChatAdminCachePolicy;
  manualModelRef: string;
  routes: TenantChatRoutingMatrix;
  routingMode: TenantChatRoutingMode;
  safetyPolicy: TenantChatAdminSafetyPolicy;
};
