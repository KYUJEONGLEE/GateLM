import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
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
}
