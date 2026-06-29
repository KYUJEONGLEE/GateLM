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
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

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
  @Type(() => RuntimeConfigCachePolicyDto)
  cachePolicy?: RuntimeConfigCachePolicyDto;

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
  @MinLength(1)
  @MaxLength(120)
  draftConfigVersion?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  configVersion?: string;

  @IsOptional()
  @IsISO8601()
  effectiveAt?: string;
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
  baseUrl: string;
  timeoutMs: number;
  credentialRef?: RuntimeConfigProviderCredentialRefDto | null;
  /** Legacy compatibility field. v2-facing RuntimeSnapshot/Provider Catalog consumers should use credentialRef. */
  secretRef: string | null;
  credentialPreview: RuntimeConfigCredentialPreviewDto | null;
  resolver: 'none' | 'control_plane_secret_store' | 'environment';
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

export interface RuntimeConfigRoutingPolicyResponseDto {
  type: 'simple';
  autoModel: 'auto';
  defaultProvider: string;
  defaultModel: string;
  lowCostProvider: string;
  lowCostModel: string;
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
  safetyPolicy: RuntimeConfigSafetyPolicyResponseDto;
  cachePolicy: RuntimeConfigCachePolicyResponseDto;
  routingPolicy: RuntimeConfigRoutingPolicyResponseDto;
  pricingRules: RuntimeConfigPricingRuleResponseDto[];
  hashing: RuntimeConfigHashingDto;
  costing: RuntimeConfigCostingDto;
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
