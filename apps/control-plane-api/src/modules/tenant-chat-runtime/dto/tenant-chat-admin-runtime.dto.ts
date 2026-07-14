import { Transform } from 'class-transformer';
import { IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import { TENANT_CHAT_MODEL_KEY_PATTERN } from '../tenant-chat-runtime.contract';

export class ActivateTenantChatRuntimeDto {
  @IsUUID()
  providerConnectionId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(200)
  @Matches(TENANT_CHAT_MODEL_KEY_PATTERN)
  modelKey!: string;
}
