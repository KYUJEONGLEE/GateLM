import { ProviderConnectionStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpsertProviderDto {
  @Transform(({ value }) => trimString(value))
  @IsString()
  @Matches(/^[a-z][a-z0-9_-]{1,63}$/)
  provider!: string;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  displayName!: string;

  @Transform(({ value }) => trimString(value))
  @IsUrl({ require_protocol: true, require_tld: false })
  @MaxLength(2048)
  baseUrl!: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(120000)
  timeoutMs?: number;

  @IsOptional()
  @IsEnum(ProviderConnectionStatus)
  status?: ProviderConnectionStatus;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(200)
  secretRef?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(40)
  credentialPrefix?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(16)
  credentialLast4?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(80)
  resolver?: string;

  @IsOptional()
  @IsObject()
  providerConfig?: Record<string, unknown> | null;
}

export class ListProvidersQueryDto {
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

export interface ProviderCredentialPreviewDto {
  prefix: string | null;
  last4: string | null;
}

export interface ProviderResponseDto {
  id: string;
  tenantId: string;
  projectId: string;
  provider: string;
  displayName: string;
  status: ProviderConnectionStatus;
  baseUrl: string;
  timeoutMs: number;
  resolver: string;
  credentialPreview: ProviderCredentialPreviewDto;
  providerConfig: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderModelDiscoveryItemDto {
  createdAt: string | null;
  displayName: string;
  modelName: string;
  object: string | null;
  ownedBy: string | null;
  provider: string;
  providerId: string;
  source: 'provider_models_endpoint';
}

export interface ProviderModelDiscoveryResponseDto {
  adapterType: string;
  baseUrl: string;
  credentialRequired: boolean;
  discoveredAt: string;
  modelCount: number;
  models: ProviderModelDiscoveryItemDto[];
  provider: string;
  providerId: string;
}
