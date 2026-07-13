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
  cache: {
    strategy: TenantChatCacheStrategy;
    enabled: boolean;
    ttlSeconds: number;
    maxEntriesPerUser: number;
  };
  safety: {
    enabled: boolean;
    policyDigest: string;
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
