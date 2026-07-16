import { Type, Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
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

import { MAX_EPHEMERAL_MESSAGE_CHARACTERS } from '@/execution/execution.types';

const trim = (value: unknown) => (typeof value === 'string' ? value.trim() : value);

export class ConversationIdParams {
  @IsUUID('4')
  conversationId!: string;
}

export class TurnIdParams extends ConversationIdParams {
  @IsUUID('4')
  turnId!: string;
}

export class CreateConversationDto {
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  idempotencyKey!: string;

  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;
}

export class RenameConversationDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

class CursorQueryDto {
  @IsOptional()
  @IsString()
  @MinLength(32)
  @MaxLength(2048)
  @Matches(/^[A-Za-z0-9_.-]+$/)
  cursor?: string;

}

export class ConversationPageQueryDto extends CursorQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

export class MessagePageQueryDto extends CursorQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class UsageIntentDto {
  @IsInt()
  @Min(1)
  @Max(8192)
  maxOutputTokens!: number;

  @IsIn(['auto', 'high_quality', 'standard', 'economy'])
  requestedTier!: 'auto' | 'high_quality' | 'standard' | 'economy';

  @IsIn(['off', 'exact'])
  cacheStrategy!: 'off' | 'exact';
}

export class CreateTurnDto {
  @IsString()
  @MinLength(16)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9_-]+$/)
  idempotencyKey!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(MAX_EPHEMERAL_MESSAGE_CHARACTERS)
  content!: string;

  @IsOptional()
  @IsIn(['conversation', 'single_turn'])
  contextMode?: 'conversation' | 'single_turn';

  @Type(() => UsageIntentDto)
  @ValidateNested()
  usageIntent!: UsageIntentDto;
}
