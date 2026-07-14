export type TenantChatRouteTier = 'high_quality' | 'standard' | 'economy';
export type TenantChatCacheStrategy = 'off' | 'exact';

export interface TenantChatPricingRoute {
  routeId: string;
  providerId: string;
  modelKey: string;
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
  tier: TenantChatRouteTier;
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
    detectorSet: Array<{
      detectorType:
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
      action: 'allow' | 'redact' | 'block';
    }>;
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
  modelKey: string;
  activationStatus: 'available' | 'pricing_unavailable';
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
}

export interface TenantChatAdminRuntimeSetup {
  readiness: TenantChatAdminReadiness;
  providers: TenantChatAdminProviderCandidate[];
  activeSnapshot: TenantChatAdminActiveSnapshot | null;
}

export interface ActivateTenantChatRuntimeInput {
  tenantId: string;
  providerConnectionId: string;
  modelKey: string;
  publishedBy: string;
}
