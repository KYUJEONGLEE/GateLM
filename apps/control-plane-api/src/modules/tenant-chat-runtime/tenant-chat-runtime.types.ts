export type TenantChatRouteTier = 'high_quality' | 'standard' | 'economy';
export type TenantChatCacheStrategy = 'off' | 'exact';
export type TenantChatRoutingMode = 'auto' | 'manual';
export type TenantChatRoutingCategory =
  | 'general'
  | 'code'
  | 'translation'
  | 'summarization'
  | 'reasoning';
export type TenantChatRoutingDifficulty = 'simple' | 'complex';
export type TenantChatPricingStatus = 'available' | 'unavailable';
export type TenantChatSafetyDetectorType =
  | 'email'
  | 'phone_number'
  | 'postal_address'
  | 'person_name'
  | 'organization_name'
  | 'resident_registration_number'
  | 'api_key'
  | 'authorization_header'
  | 'jwt'
  | 'private_key';
export type TenantChatSafetyAction = 'allow' | 'redact' | 'block';

export interface TenantChatSafetyDetector {
  detectorType: TenantChatSafetyDetectorType;
  action: TenantChatSafetyAction;
}

export interface TenantChatRoutingCell {
  modelRefs: string[];
}

export type TenantChatRoutingMatrix = Record<
  TenantChatRoutingCategory,
  Record<TenantChatRoutingDifficulty, TenantChatRoutingCell>
>;

export interface TenantChatRoutingPolicyV2Bridge {
  schemaVersion: 'gatelm.routing-policy.v2';
  mode: TenantChatRoutingMode;
  bootstrapState: 'mock_bootstrap' | 'configured';
  routingPolicyHash: string;
  routes: TenantChatRoutingMatrix;
}

export interface TenantChatPricingRoute {
  routeId: string;
  providerId: string;
  modelKey: string;
  pricingStatus?: TenantChatPricingStatus;
  pricingSource?: 'model_pricing_rules' | 'bundled' | 'unavailable';
  inputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number;
  cacheReadInputMicroUsdPerMillionTokens?: number;
}

export interface TenantChatPricing {
  version: number;
  digest: string;
  currency: 'USD';
  unit: 'micro_usd_per_1m_tokens';
  effectiveAt: string;
  routes: TenantChatPricingRoute[];
}

export interface TenantChatRuntimeRoute {
  routeId: string;
  tier?: TenantChatRouteTier;
  modelRef?: string;
  providerId: string;
  modelKey: string;
  enabled: boolean;
}

export interface TenantChatRuntimePolicies {
  rateLimit: {
    requests: number;
    windowSeconds: number;
  };
  concurrency: {
    maxActiveAdmissionsPerUser: number;
    admissionTtlSeconds: 30;
  };
  quota: {
    period: 'calendar_month';
    timezone: string;
    defaultMonthlyTokenLimit: number;
    warningPercent: number;
    economyPercent: number;
    hardStopPercent: number;
  };
  budget: {
    period: 'calendar_month';
    timezone: string;
    currency: 'USD';
    monthlyLimitMicroUsd: number;
    warningPercent: number;
    economyPercent: number;
    hardStopPercent: 100;
  };
  routing: {
    routes: TenantChatRuntimeRoute[];
    policy?: TenantChatRoutingPolicyV2Bridge;
    manualModelRef?: string;
  };
  fallback: {
    enabled: boolean;
    routeIds: string[];
    maxAttempts: number;
    allowedReasons: Array<'provider_timeout' | 'provider_error_pre_delta'>;
  };
  providerTokenRate: {
    providers: Array<{
      providerId: string;
      limitTokens: number;
      windowSeconds: number;
    }>;
  };
  cache: {
    strategy: TenantChatCacheStrategy;
    enabled: boolean;
    ttlSeconds: number;
    maxEntriesPerUser: number;
    keySetId: string;
  };
  safety: {
    enabled: boolean;
    policyDigest: string;
    detectorSet: TenantChatSafetyDetector[];
  };
  streaming: {
    enabled: boolean;
    maxDurationSeconds: number;
    finalEventRequired: true;
  };
}

export interface TenantChatRuntimeSnapshotDocument {
  snapshotId: string;
  version: number;
  digest: string;
  tenantId: string;
  policyVersion: number;
  employeeNoticeVersion: number;
  pricing: TenantChatPricing;
  policies: TenantChatRuntimePolicies;
  publishedAt: string;
  publishedBy: string;
}

export interface PublishTenantChatRuntimeSnapshotInput {
  snapshot: TenantChatRuntimeSnapshotDocument;
}

export type TenantChatAdminReadiness =
  | 'needs_provider'
  | 'needs_model'
  | 'needs_activation'
  | 'ready'
  | 'degraded';

export interface TenantChatAdminModelPricing {
  inputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number;
  cacheReadInputMicroUsdPerMillionTokens?: number;
}

export interface TenantChatAdminModelCandidate {
  modelRef: string;
  modelKey: string;
  activationStatus: 'available';
  pricingStatus: TenantChatPricingStatus;
  pricing: TenantChatAdminModelPricing | null;
}

export interface TenantChatAdminProviderCandidate {
  providerConnectionId: string;
  providerKey: string;
  providerFamily: string;
  displayName: string;
  models: TenantChatAdminModelCandidate[];
}

export interface TenantChatAdminActiveSnapshot {
  snapshotId: string;
  version: number;
  digest: string;
  policyVersion: number;
  pricingVersion: number;
  providerConnectionId: string;
  modelKey: string;
  publishedAt: string;
  pricingStatus: 'current' | 'update_available' | 'unavailable';
  routingMode: TenantChatRoutingMode;
  manualModelRef: string;
  routes: TenantChatRoutingMatrix;
  cachePolicy: TenantChatAdminCachePolicy;
  safetyPolicy: TenantChatAdminSafetyPolicy;
}

export interface TenantChatAdminCachePolicy {
  enabled: boolean;
  ttlSeconds: number;
  maxEntriesPerUser: number;
}

export interface TenantChatAdminSafetyPolicy {
  detectorSet: TenantChatSafetyDetector[];
}

export interface TenantChatAdminRuntimeSetup {
  readiness: TenantChatAdminReadiness;
  providers: TenantChatAdminProviderCandidate[];
  activeSnapshot: TenantChatAdminActiveSnapshot | null;
}

export interface ActivateTenantChatRuntimeInput {
  tenantId: string;
  providerConnectionId?: string;
  modelKey?: string;
  routingMode?: TenantChatRoutingMode;
  manualModelRef?: string;
  routes?: TenantChatRoutingMatrix;
  cachePolicy?: TenantChatAdminCachePolicy;
  safetyPolicy?: TenantChatAdminSafetyPolicy;
  publishedBy: string;
}
