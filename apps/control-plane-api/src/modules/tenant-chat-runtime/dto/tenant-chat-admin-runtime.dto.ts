import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsBoolean,
  IsInt,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { TENANT_CHAT_MODEL_KEY_PATTERN } from '../tenant-chat-runtime.contract';

class TenantChatRoutingCellDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  @Matches(TENANT_CHAT_MODEL_KEY_PATTERN, { each: true })
  modelRefs!: string[];
}

class TenantChatRoutingDifficultyDto {
  @ValidateNested()
  @Type(() => TenantChatRoutingCellDto)
  simple!: TenantChatRoutingCellDto;

  @ValidateNested()
  @Type(() => TenantChatRoutingCellDto)
  complex!: TenantChatRoutingCellDto;
}

class TenantChatRoutingMatrixDto {
  @ValidateNested()
  @Type(() => TenantChatRoutingDifficultyDto)
  general!: TenantChatRoutingDifficultyDto;

  @ValidateNested()
  @Type(() => TenantChatRoutingDifficultyDto)
  code!: TenantChatRoutingDifficultyDto;

  @ValidateNested()
  @Type(() => TenantChatRoutingDifficultyDto)
  translation!: TenantChatRoutingDifficultyDto;

  @ValidateNested()
  @Type(() => TenantChatRoutingDifficultyDto)
  summarization!: TenantChatRoutingDifficultyDto;

  @ValidateNested()
  @Type(() => TenantChatRoutingDifficultyDto)
  reasoning!: TenantChatRoutingDifficultyDto;
}

class TenantChatAdminCachePolicyDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  ttlSeconds!: number;

  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  maxEntriesPerUser!: number;
}

class TenantChatAdminSafetyDetectorDto {
  @IsIn([
    'email',
    'phone_number',
    'postal_address',
    'person_name',
    'organization_name',
    'resident_registration_number',
    'api_key',
    'authorization_header',
    'jwt',
    'private_key',
  ])
  detectorType!:
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

  @IsIn(['allow', 'redact', 'block'])
  action!: 'allow' | 'redact' | 'block';
}

class TenantChatAdminSafetyPolicyDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique((detector: TenantChatAdminSafetyDetectorDto) => detector.detectorType)
  @ValidateNested({ each: true })
  @Type(() => TenantChatAdminSafetyDetectorDto)
  detectorSet!: TenantChatAdminSafetyDetectorDto[];
}

export class ActivateTenantChatRuntimeDto {
  // Legacy single-model activation remains accepted while old admin clients
  // are redirected to the Chat App authoring surface.
  @IsOptional()
  @IsUUID()
  providerConnectionId?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  @Matches(TENANT_CHAT_MODEL_KEY_PATTERN)
  modelKey?: string;

  @IsOptional()
  @IsIn(['auto', 'manual'])
  routingMode?: 'auto' | 'manual';

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  @Matches(TENANT_CHAT_MODEL_KEY_PATTERN)
  manualModelRef?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => TenantChatRoutingMatrixDto)
  routes?: TenantChatRoutingMatrixDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TenantChatAdminCachePolicyDto)
  cachePolicy?: TenantChatAdminCachePolicyDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => TenantChatAdminSafetyPolicyDto)
  safetyPolicy?: TenantChatAdminSafetyPolicyDto;

  @IsOptional()
  @IsBoolean()
  cacheEnabled?: boolean;
}
