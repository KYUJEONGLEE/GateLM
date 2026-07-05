import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const RUNTIME_CONFIG_VERSION_PATTERN = /^[a-zA-Z0-9._-]+$/;
const RUNTIME_CONFIG_VERSION_MESSAGE =
  'must contain only alphanumeric characters, dashes, underscores, or dots.';

export type RuntimeConfigPublishStateDto =
  | 'draft'
  | 'active'
  | 'superseded'
  | 'rolled_back';
export type ResourceStatusDto = 'active' | 'disabled' | 'archived';
export type CredentialStatusDto =
  | 'active'
  | 'revoked'
  | 'expired'
  | 'disabled';
export type ProviderStatusDto = 'active' | 'disabled' | 'degraded';
export type ModelStatusDto = 'active' | 'disabled';
export type RuntimeConfigCredentialType = 'api_key' | 'app_token';

export class RuntimeConfigRateLimitDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  limit?: number;
}

export class RuntimeConfigBudgetPolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['warn', 'block', 'disabled'])
  enforcementMode?: 'warn' | 'block' | 'disabled';

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  warningThresholdPercent?: number;

  @IsOptional()
  @IsBoolean()
  restrictHighQualityOnBudgetRisk?: boolean;
}

export class RuntimeConfigCachePolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(86400)
  ttlSeconds?: number;
}

export class RuntimeConfigPromptCapturePolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['disabled', 'log_safe_full'])
  mode?: 'disabled' | 'log_safe_full';

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20000)
  maxChars?: number;
}

export class RuntimeConfigResponseCapturePolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['disabled', 'raw_full'])
  mode?: 'disabled' | 'raw_full';

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(20000)
  maxChars?: number;
}

export class RuntimeConfigRoutingPolicyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  defaultProvider?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  defaultModel?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lowCostProvider?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  lowCostModel?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  highQualityProvider?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  highQualityModel?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  fallbackProvider?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  fallbackModel?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  shortPromptMaxChars?: number;
}

export class RuntimeConfigSafetyDetectorDto {
  @IsIn([
    'email',
    'phone_number',
    'resident_registration_number',
    'api_key',
    'authorization_header',
    'jwt',
    'private_key',
  ])
  type!:
    | 'email'
    | 'phone_number'
    | 'resident_registration_number'
    | 'api_key'
    | 'authorization_header'
    | 'jwt'
    | 'private_key';

  @IsBoolean()
  enabled!: boolean;

  @IsIn(['redact', 'block'])
  action!: 'redact' | 'block';

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  placeholder!: string;
}

export class RuntimeConfigSafetyPolicyDto {
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RuntimeConfigSafetyDetectorDto)
  @IsArray()
  @ArrayMinSize(1)
  detectors?: RuntimeConfigSafetyDetectorDto[];
}

export class RuntimeConfigModelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  provider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  model!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName?: string;

  @IsOptional()
  @IsIn(['active', 'disabled'])
  status?: ModelStatusDto;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000000)
  contextWindowTokens?: number;

  @IsOptional()
  @IsBoolean()
  supportsStreaming?: boolean;

  @IsOptional()
  @IsBoolean()
  supportsJsonMode?: boolean;
}

export class RuntimeConfigPricingRuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  provider!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  model!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  pricingVersion?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000000)
  promptTokenMicroUsd?: number;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000000000)
  completionTokenMicroUsd?: number;
}

export class UpsertRuntimeConfigDraftDto {
  @IsOptional()
  @IsString()
  @Matches(RUNTIME_CONFIG_VERSION_PATTERN, {
    message: `configVersion ${RUNTIME_CONFIG_VERSION_MESSAGE}`,
  })
  @MinLength(1)
  @MaxLength(120)
  configVersion?: string;

  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimeConfigRateLimitDto)
  rateLimit?: RuntimeConfigRateLimitDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimeConfigBudgetPolicyDto)
  budgetPolicy?: RuntimeConfigBudgetPolicyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimeConfigCachePolicyDto)
  cachePolicy?: RuntimeConfigCachePolicyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimeConfigPromptCapturePolicyDto)
  promptCapturePolicy?: RuntimeConfigPromptCapturePolicyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimeConfigResponseCapturePolicyDto)
  responseCapturePolicy?: RuntimeConfigResponseCapturePolicyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimeConfigRoutingPolicyDto)
  routingPolicy?: RuntimeConfigRoutingPolicyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RuntimeConfigSafetyPolicyDto)
  safetyPolicy?: RuntimeConfigSafetyPolicyDto;

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RuntimeConfigModelDto)
  @IsArray()
  @ArrayMinSize(1)
  models?: RuntimeConfigModelDto[];

  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RuntimeConfigPricingRuleDto)
  @IsArray()
  @ArrayMinSize(1)
  pricingRules?: RuntimeConfigPricingRuleDto[];
}

export class PublishRuntimeConfigDto {
  @IsOptional()
  @IsString()
  @Matches(RUNTIME_CONFIG_VERSION_PATTERN, {
    message: `draftConfigVersion ${RUNTIME_CONFIG_VERSION_MESSAGE}`,
  })
  @MinLength(1)
  @MaxLength(120)
  draftConfigVersion?: string;

  @IsOptional()
  @IsString()
  @Matches(RUNTIME_CONFIG_VERSION_PATTERN, {
    message: `configVersion ${RUNTIME_CONFIG_VERSION_MESSAGE}`,
  })
  @MinLength(1)
  @MaxLength(120)
  configVersion?: string;

  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;
}

export class RollbackRuntimeConfigDto {
  @IsString()
  @Matches(RUNTIME_CONFIG_VERSION_PATTERN, {
    message: `targetConfigVersion ${RUNTIME_CONFIG_VERSION_MESSAGE}`,
  })
  @MinLength(1)
  @MaxLength(120)
  targetConfigVersion!: string;

  @IsOptional()
  @IsString()
  @Matches(RUNTIME_CONFIG_VERSION_PATTERN, {
    message: `rollbackConfigVersion ${RUNTIME_CONFIG_VERSION_MESSAGE}`,
  })
  @MinLength(1)
  @MaxLength(120)
  rollbackConfigVersion?: string;

  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;
}

export class ListRuntimeConfigHistoryQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}

export interface RuntimeConfigCredentialPreviewDto {
  prefix: string;
  last4: string;
}

export interface RuntimeConfigCredentialRefDto {
  id: string;
  type: RuntimeConfigCredentialType;
  status: CredentialStatusDto;
  prefix: string;
  last4: string;
  scopes: string[];
  expiresAt: string | null;
  verification: 'prefix_then_hash_compare';
}

export interface RuntimeConfigProviderCredentialRefDto {
  credentialRefId: string;
  credentialVersion: number;
  credentialState: 'active' | 'disabled';
}

export interface RuntimeConfigProviderDto {
  providerId: string;
  provider: string;
  displayName: string;
  status: ProviderStatusDto;
  adapterType?: string;
  baseUrl: string;
  timeoutMs: number;
  credentialRequired?: boolean;
  credentialRef?: RuntimeConfigProviderCredentialRefDto | null;
  /** Legacy compatibility field. v2-facing RuntimeSnapshot/Provider Catalog consumers should use credentialRef. */
  secretRef: string | null;
  credentialPreview: RuntimeConfigCredentialPreviewDto | null;
  resolver: 'none' | 'control_plane_secret_store' | 'environment';
  adapterConfig?: ProviderCatalogAdapterConfigDto;
  models: string[];
  failureMode: 'fail_closed' | 'fail_open_to_fallback';
}

export interface RuntimeConfigModelResponseDto {
  provider: string;
  model: string;
  displayName: string;
  status: ModelStatusDto;
  contextWindowTokens: number;
  supportsStreaming: boolean;
  supportsJsonMode: boolean;
}

export interface RuntimeConfigRateLimitResponseDto {
  enabled: boolean;
  scope: 'application';
  algorithm: 'fixed_window';
  windowSeconds: 60;
  limit: number;
}

export interface RuntimeConfigBudgetPolicyResponseDto {
  enabled: boolean;
  enforcementMode: 'warn' | 'block' | 'disabled';
  warningThresholdPercent: number;
  restrictHighQualityOnBudgetRisk: boolean;
}

export interface RuntimeConfigSafetyDetectorResponseDto {
  type: RuntimeConfigSafetyDetectorDto['type'];
  enabled: boolean;
  action: RuntimeConfigSafetyDetectorDto['action'];
  placeholder: string;
}

export interface RuntimeConfigSafetyPolicyResponseDto {
  mode: 'rule_based';
  securityPolicyHash: string;
  remoteSafety: {
    enabled: false;
    mode: 'disabled';
  };
  detectors: RuntimeConfigSafetyDetectorResponseDto[];
}

export interface RuntimeConfigCachePolicyResponseDto {
  enabled: boolean;
  type: 'exact';
  ttlSeconds: number;
}

export interface RuntimeConfigPromptCapturePolicyResponseDto {
  enabled: boolean;
  mode: 'disabled' | 'log_safe_full';
  maxChars: number;
}

export interface RuntimeConfigResponseCapturePolicyResponseDto {
  enabled: boolean;
  mode: 'disabled' | 'raw_full';
  maxChars: number;
}

export interface RuntimeConfigRoutingPolicyResponseDto {
  type: 'simple';
  autoModel: 'auto';
  defaultProvider: string;
  defaultModel: string;
  lowCostProvider: string;
  lowCostModel: string;
  highQualityProvider?: string;
  highQualityModel?: string;
  fallbackProvider: string;
  fallbackModel: string;
  shortPromptMaxChars: number;
  routingPolicyHash: string;
}

export interface RuntimeConfigPricingRuleResponseDto {
  pricingRuleId: string;
  provider: string;
  model: string;
  pricingVersion: string;
  currency: 'USD';
  unit: 'token';
  promptTokenMicroUsd: number;
  completionTokenMicroUsd: number;
  effectiveAt: string;
}

export interface RuntimeConfigHashingDto {
  canonicalJson: 'utf8_json_sorted_keys_no_extra_whitespace';
  usesSecret: false;
  configHashSourceFields: string[];
  routingPolicyHashSourceFields: string[];
  securityPolicyHashSourceFields: string[];
  requestBodyHash: 'sha256(canonical_json(openai_request_body_without_credentials))';
  promptHash: 'sha256(normalized_redacted_prompt_utf8)';
  cacheKeyHash: 'sha256(canonical_json(cache_key_material))';
  cacheKeyFields: string[];
}

export interface RuntimeConfigCostingDto {
  unit: 'micro_usd';
  formula: 'ceil(promptTokens * promptTokenMicroUsd + completionTokens * completionTokenMicroUsd)';
  savedCostMicroUsdFormula: 'sourceRequestCostMicroUsd_on_exact_cache_hit_else_0';
  usdStringFormat: 'fixed_6_decimal_places';
  missingPricingRule: 'provider_error' | 'internal_error';
}

export interface ActiveRuntimeConfigResponseDto {
  schemaVersion: 'gatelm.active-runtime-config.v1';
  configVersion: string;
  configHash: string;
  configHashAlgorithm: 'sha256(canonical_json(runtimeConfig_without_configHash))';
  generatedAt: string;
  effectiveAt: string;
  publishedAt: string;
  publishState: RuntimeConfigPublishStateDto;
  tenantId: string;
  tenantStatus: ResourceStatusDto;
  projectId: string;
  projectStatus: ResourceStatusDto;
  applicationId: string;
  applicationStatus: ResourceStatusDto;
  apiKeyId: string;
  apiKeyStatus: CredentialStatusDto;
  appTokenId: string;
  appTokenStatus: CredentialStatusDto;
  apiKey: RuntimeConfigCredentialRefDto;
  appToken: RuntimeConfigCredentialRefDto;
  providers: RuntimeConfigProviderDto[];
  models: RuntimeConfigModelResponseDto[];
  defaultProvider: string;
  defaultModel: string;
  lowCostProvider: string;
  lowCostModel: string;
  fallbackProvider: string;
  fallbackModel: string;
  rateLimit: RuntimeConfigRateLimitResponseDto;
  budgetPolicy: RuntimeConfigBudgetPolicyResponseDto;
  safetyPolicy: RuntimeConfigSafetyPolicyResponseDto;
  cachePolicy: RuntimeConfigCachePolicyResponseDto;
  promptCapturePolicy: RuntimeConfigPromptCapturePolicyResponseDto;
  responseCapturePolicy: RuntimeConfigResponseCapturePolicyResponseDto;
  routingPolicy: RuntimeConfigRoutingPolicyResponseDto;
  pricingRules: RuntimeConfigPricingRuleResponseDto[];
  hashing: RuntimeConfigHashingDto;
  costing: RuntimeConfigCostingDto;
}

export interface RuntimeSnapshotLookupKeyDto {
  tenantId: string;
  projectId: string;
  applicationId: string;
}

export interface RuntimeSnapshotBudgetResolutionDto {
  budgetScopeType: 'application' | 'project' | 'team';
  budgetScopeId: string;
  resolvedBy: 'default_application' | 'runtime_snapshot' | 'control_plane_rule';
  warningThresholdPercent: number;
}

export interface RuntimeSnapshotProviderCatalogRefDto {
  catalogId: string;
  catalogVersion: number;
  contentHash: string;
}

export interface ProviderCatalogCredentialRefDto {
  credentialRefId: string;
  credentialVersion: number;
  credentialState: 'active' | 'rotating' | 'disabled';
}

export interface ProviderCatalogAdapterConfigDto {
  requestFormat:
    | 'openai_chat_completions'
    | 'anthropic_messages'
    | 'mock_chat_completions';
  apiVersion?: string;
}

export interface ProviderCatalogModelCapabilitiesDto {
  streamingSupported: boolean;
  supportsJsonMode: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
}

export interface ProviderCatalogModelRoutingDto {
  autoRoutingEligible: boolean;
  costTier?: 'low' | 'balanced' | 'premium';
  fallbackPriority?: number;
}

export interface ProviderCatalogModelDto {
  modelId: string;
  modelName: string;
  displayName?: string;
  enabled: boolean;
  capabilities: ProviderCatalogModelCapabilitiesDto;
  routing?: ProviderCatalogModelRoutingDto;
}

export interface ProviderCatalogProviderDto {
  providerId: string;
  providerName: string;
  adapterType: string;
  enabled: boolean;
  baseUrl: string;
  timeoutMs: number;
  credentialRequired: boolean;
  credentialRef: ProviderCatalogCredentialRefDto | null;
  adapterConfig: ProviderCatalogAdapterConfigDto;
  fallbackEligible?: boolean;
  models: ProviderCatalogModelDto[];
}

export interface ProviderCatalogResponseDto {
  catalogId: string;
  catalogVersion: number;
  contentHash: string;
  updatedAt?: string;
  providers: ProviderCatalogProviderDto[];
}

export interface RuntimeSnapshotSafetyPolicyDto {
  enabled: boolean;
  mode: 'enforce' | 'disabled';
  requestSideRequired: boolean;
  policyHash: string;
  detectorSet: Array<{
    detectorType: string;
    action: 'allow' | 'redact' | 'block';
  }>;
}

export interface RuntimeSnapshotRoutingPolicyDto {
  autoModelEnabled: boolean;
  defaultRequestedModel: string;
  defaultProvider: string;
  defaultModel: string;
  lowCostProvider: string;
  lowCostModel: string;
  highQualityProvider?: string;
  highQualityModel?: string;
  routingPolicyHash: string;
}

export interface RuntimeSnapshotCachePolicyDto {
  exactCacheEnabled: boolean;
  semanticCacheMode: 'evidence_only' | 'disabled';
  cachePolicyHash: string;
}

export interface RuntimeSnapshotPromptCapturePolicyDto {
  enabled: boolean;
  mode: 'disabled' | 'log_safe_full';
  maxChars: number;
}

export interface RuntimeSnapshotResponseCapturePolicyDto {
  enabled: boolean;
  mode: 'disabled' | 'raw_full';
  maxChars: number;
}

export interface RuntimeSnapshotRateLimitPolicyDto {
  enabled: boolean;
  scope: 'application';
  windowSeconds: number;
  limit: number;
}

export interface RuntimeSnapshotBudgetPolicyDto {
  enabled: boolean;
  enforcementMode: 'warn' | 'block' | 'disabled';
  warningThresholdPercent: number;
  restrictHighQualityOnBudgetRisk: boolean;
}

export interface RuntimeSnapshotFallbackPolicyDto {
  enabled: boolean;
  fallbackProvider?: string;
  fallbackModel?: string;
  allowedReasons?: Array<'provider_timeout' | 'provider_error'>;
}

export interface RuntimeSnapshotStreamingPolicyDto {
  enabled: boolean;
  thinSliceOnly: true;
}

export interface RuntimeSnapshotPoliciesDto {
  safety: RuntimeSnapshotSafetyPolicyDto;
  routing: RuntimeSnapshotRoutingPolicyDto;
  cache: RuntimeSnapshotCachePolicyDto;
  promptCapture: RuntimeSnapshotPromptCapturePolicyDto;
  responseCapture: RuntimeSnapshotResponseCapturePolicyDto;
  rateLimit: RuntimeSnapshotRateLimitPolicyDto;
  budget: RuntimeSnapshotBudgetPolicyDto;
  fallback: RuntimeSnapshotFallbackPolicyDto;
  streaming: RuntimeSnapshotStreamingPolicyDto;
}

export interface RuntimeSnapshotLegacyHashesDto {
  configHash: string;
  securityPolicyHash: string;
  routingPolicyHash: string;
}

export interface RuntimeSnapshotResponseDto {
  runtimeSnapshotId: string;
  runtimeSnapshotVersion: number;
  contentHash: string;
  runtimeState: 'snapshot_active';
  publishedAt: string;
  publishedBy: string;
  gatewayInstanceId: string;
  lookupKey: RuntimeSnapshotLookupKeyDto;
  budgetResolution: RuntimeSnapshotBudgetResolutionDto;
  providerCatalogRef: RuntimeSnapshotProviderCatalogRefDto;
  policies: RuntimeSnapshotPoliciesDto;
  legacyHashes: RuntimeSnapshotLegacyHashesDto;
}

export interface RuntimeConfigDraftResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  applicationId: string;
  configVersion: string;
  configHash: string;
  publishState: 'draft';
  effectiveAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  runtimeConfig: ActiveRuntimeConfigResponseDto;
}

export interface RuntimeConfigHistoryItemDto {
  id: string;
  configVersion: string;
  configHash: string;
  publishState: RuntimeConfigPublishStateDto;
  effectiveAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  canRollback: boolean;
}

export interface RuntimeConfigHistoryResponseDto {
  applicationId: string;
  items: RuntimeConfigHistoryItemDto[];
  pagination: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
  };
}

export interface RuntimeConfigHistoryDetailResponseDto {
  applicationId: string;
  item: RuntimeConfigHistoryItemDto;
  runtimeConfig: ActiveRuntimeConfigResponseDto;
}
