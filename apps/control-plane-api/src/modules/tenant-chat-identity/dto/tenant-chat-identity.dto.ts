import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PASSWORD_POLICY_MESSAGE,
} from '@/modules/auth/password-policy';

function trim(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class TenantChatPasswordDto {
  @Transform(({ value }) => trim(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}

export class TenantChatPasswordResetRequestDto {
  @Transform(({ value }) => trim(value))
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

export class TenantChatPasswordResetConfirmDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(32)
  @MaxLength(512)
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_POLICY_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
}

export class TenantChatPasswordChangeDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(256)
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_POLICY_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_POLICY_MESSAGE })
  newPassword!: string;
}

export class TenantChatInvitationTokenDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  token!: string;
}

export class TenantChatInvitationPasswordDto extends TenantChatInvitationTokenDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH, { message: PASSWORD_POLICY_MESSAGE })
  @MaxLength(PASSWORD_MAX_LENGTH, { message: PASSWORD_POLICY_MESSAGE })
  password!: string;
}

export class TenantChatInvitationBindDto extends TenantChatInvitationTokenDto {
  @IsUUID()
  userId!: string;
}

export class TenantChatGoogleStartDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(24)
  @MaxLength(256)
  state!: string;
}

export class TenantChatGoogleCompleteDto {
  @Transform(({ value }) => trim(value))
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  code!: string;

  @Transform(({ value }) => trim(value))
  @IsOptional()
  @IsString()
  @MinLength(16)
  @MaxLength(512)
  invitationToken?: string;
}
