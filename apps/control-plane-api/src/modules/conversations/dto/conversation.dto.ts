import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

function trimString(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export type ConversationStatusDto = 'active' | 'archived' | 'deleted';
export type ChatMessageRoleDto = 'user' | 'assistant';
export type ChatMessageContentPolicyDto = 'retained' | 'not_retained';

export class CreateConversationDto {
  @IsUUID('4')
  tenantId!: string;

  @IsUUID('4')
  projectId!: string;

  @IsUUID('4')
  applicationId!: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(160)
  endUserId?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsBoolean()
  contextRetentionEnabled?: boolean;
}

export class ConversationScopeQueryDto {
  @IsUUID('4')
  tenantId!: string;

  @IsUUID('4')
  projectId!: string;

  @IsUUID('4')
  applicationId!: string;
}

export class ListConversationsQueryDto extends ConversationScopeQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsUUID('4')
  cursor?: string;
}

export class ListConversationMessagesQueryDto extends ConversationScopeQueryDto {
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 50;

  @IsOptional()
  @IsUUID('4')
  cursor?: string;
}

export class UpdateConversationDto extends ConversationScopeQueryDto {
  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsIn(['active', 'archived', 'deleted'])
  status?: ConversationStatusDto;

  @IsOptional()
  @IsBoolean()
  contextRetentionEnabled?: boolean;
}

export class CreateConversationMessageDto extends ConversationScopeQueryDto {
  @IsIn(['user', 'assistant'])
  role!: ChatMessageRoleDto;

  @Transform(({ value }) => trimString(value))
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  content!: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MaxLength(180)
  requestId?: string;

  @IsOptional()
  @IsUUID('4')
  parentMessageId?: string;

  @Transform(({ value }) => trimString(value))
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  systemMessage?: string;
}

export interface ConversationResponseDto {
  applicationId: string;
  contextRetentionEnabled: boolean;
  createdAt: string;
  deletedAt: string | null;
  endUserId: string | null;
  id: string;
  projectId: string;
  status: ConversationStatusDto;
  tenantId: string;
  title: string | null;
  updatedAt: string;
}

export interface ChatMessageResponseDto {
  applicationId: string;
  contentPolicy: ChatMessageContentPolicyDto;
  conversationId: string;
  createdAt: string;
  id: string;
  parentMessageId: string | null;
  projectId: string;
  requestId: string | null;
  role: ChatMessageRoleDto;
  safeContent: string | null;
  sequence: number;
  tenantId: string;
}

export interface GatewayContextMessageDto {
  content: string;
  role: 'system' | ChatMessageRoleDto;
}

export interface ConversationContextDto {
  contextRetentionEnabled: boolean;
  maxPreviousChars: number;
  maxPreviousUserTurns: number;
  messages: GatewayContextMessageDto[];
  strategy: 'sliding_window';
}

export interface CreateConversationMessageResponseDto {
  context: ConversationContextDto;
  message: ChatMessageResponseDto;
}
